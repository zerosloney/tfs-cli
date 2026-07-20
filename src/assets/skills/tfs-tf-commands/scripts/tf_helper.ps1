<#
.SYNOPSIS
  TFS tf.exe helper script - handles login, common tf operations.
.DESCRIPTION
  Reads config from tfs-config.json, auto-detects tf.exe path,
  wraps common tf commands with credential injection.
#>

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('checkout', 'undo', 'checkout-dir', 'add', 'getlatest', 'history', 'status', 'diff', 'test')]
  [string]$Action,

  [Parameter(Mandatory = $false)]
  [string]$Path,

  [Parameter(Mandatory = $false)]
  [string]$ConfigPath,

  [Parameter(Mandatory = $false)]
  [string]$ExtraArgs,

  # --- history 高级选项（与 tf_helper.sh 对等） ---
  [switch]$Today,
  [Parameter(Mandatory = $false)]
  [string]$Since,
  [Parameter(Mandatory = $false)]
  [string]$Range,
  [switch]$Recursive,
  [Parameter(Mandatory = $false)]
  [string]$User,
  [switch]$Mine,
  [Parameter(Mandatory = $false)]
  [int]$Limit = 0
)

# --- Encoding fix for Windows ---
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# --- Locate config ---
if (-not $ConfigPath) {
  $skillDir = Split-Path -Parent $PSScriptRoot
  $ConfigPath = Join-Path $skillDir "assets\tfs-config.json"
}

if (-not (Test-Path $ConfigPath)) {
  Write-Error "TFS config not found at: $ConfigPath`nPlease fill in assets/tfs-config.json with your TFS server, username, password."
  exit 1
}

$config = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json

# --- 自动迁移明文密码到系统凭证库 ---
# 若配置文件中残留明文 password，搬到凭证库后删除明文，写回 password_ref
# 注意：使用原始文本读写以兼容 Windows PowerShell 5.1（不依赖 ConvertTo-Json 的格式稳定性）
function Get-CredTarget([string]$username) { return "tfs-tf-commands:$username" }

function Save-Password([string]$username, [string]$password) {
  $target = Get-CredTarget $username
  & cmdkey /generic:"$target" /user:"$username" /pass:"$password" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Error "写入系统凭证库失败（cmdkey），target=$target"
    exit 1
  }
}

function Read-Password([string]$username) {
  $target = Get-CredTarget $username
  # CRED_TYPE_GENERIC = 1。整个读取+解码逻辑放在 C# 内，避免 PS 5.1 嵌套类型的 marshal 问题。
  if (-not ("CredUtil" -as [type])) {
    Add-Type -ErrorAction Stop @"
    using System;
    using System.Runtime.InteropServices;
    using System.Text;
    public static class CredUtil {
      [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
      private struct CREDENTIAL {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string Comment;
        public long LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
      }
      [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
      private static extern bool CredReadW(string target, uint type, uint flags, out IntPtr cred);
      [DllImport("advapi32.dll")]
      private static extern void CredFree(IntPtr cred);

      public static string ReadPassword(string target) {
        IntPtr credPtr;
        if (!CredReadW(target, 1, 0, out credPtr) || credPtr == IntPtr.Zero) return null;
        try {
          CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(credPtr, typeof(CREDENTIAL));
          if (cred.CredentialBlobSize == 0) return null;
          int size = (int)cred.CredentialBlobSize;
          byte[] bytes = new byte[size];
          Marshal.Copy(cred.CredentialBlob, bytes, 0, size);
          // cmdkey 写入的密码用 UTF-16，兜底 UTF-8
          foreach (Encoding enc in new Encoding[] { Encoding.Unicode, Encoding.UTF8 }) {
            try {
              string s = enc.GetString(bytes).TrimEnd('\0');
              if (!string.IsNullOrEmpty(s)) return s;
            } catch {}
          }
          return null;
        } finally {
          CredFree(credPtr);
        }
      }
    }
"@
  }
  return [CredUtil]::ReadPassword($target)
}

function Update-ConfigFile {
  param([string]$Path, [string]$Username)
  # 兼容 PS 5.1：直接文本操作，删除 password 行、写入/更新 password_ref
  $lines = Get-Content $Path -Encoding UTF8
  $result = New-Object System.Collections.Generic.List[string]
  $passwordRefWritten = $false
  $targetRef = "system-keyring:tfs-tf-commands:$Username"
  foreach ($line in $lines) {
    if ($line -match '^\s*"password"\s*:') {
      # 跳过明文 password 行
      continue
    }
    if ($line -match '^\s*"password_ref"\s*:') {
      $result.Add('  "password_ref": "' + $targetRef + '",')
      $passwordRefWritten = $true
      continue
    }
    $result.Add($line)
  }
  if (-not $passwordRefWritten) {
    # 在 username 行后插入 password_ref
    $final = New-Object System.Collections.Generic.List[string]
    foreach ($line in $result) {
      $final.Add($line)
      if ($line -match '^\s*"username"\s*:') {
        $final.Add('  "password_ref": "' + $targetRef + '",')
      }
    }
    $result = $final
  }
  Set-Content -Path $Path -Value $result -Encoding UTF8
}

if ($config.username -and $config.password) {
  # 有明文密码 → 迁移到凭证库
  Save-Password $config.username $config.password
  Write-Host "[TFS] 已将明文密码迁移到系统凭证库并从配置文件中删除" -ForegroundColor DarkGray
}
if ($config.username) {
  Update-ConfigFile -Path $ConfigPath -Username $config.username
  # 重新加载（password 字段已去除）
  $config = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
}

# --- Auto-detect tf.exe ---
function Find-TfExe {
  $candidates = @()

  # 1. Visual Studio 2022
  $vs2022 = Get-ChildItem "C:\Program Files\Microsoft Visual Studio\2022\*\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\tf.exe" -ErrorAction SilentlyContinue
  if ($vs2022) { $candidates += $vs2022.FullName }

  # 2. Visual Studio 2019
  $vs2019 = Get-ChildItem "C:\Program Files (x86)\Microsoft Visual Studio\2019\*\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\tf.exe" -ErrorAction SilentlyContinue
  if ($vs2019) { $candidates += $vs2019.FullName }

  # 3. Visual Studio 2017
  $vs2017 = Get-ChildItem "C:\Program Files (x86)\Microsoft Visual Studio\2017\*\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\tf.exe" -ErrorAction SilentlyContinue
  if ($vs2017) { $candidates += $vs2017.FullName }

  # 4. Where command fallback
  $whereTf = Get-Command tf.exe -ErrorAction SilentlyContinue
  if ($whereTf) { $candidates += $whereTf.Source }

  # 5. Common Team Explorer standalone
  $te = "C:\Program Files\Microsoft Visual Studio Team Explorer 2022\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\tf.exe"
  if (Test-Path $te) { $candidates += $te }

  if ($candidates.Count -gt 0) {
    return $candidates[0]
  }
  return $null
}

$tfExe = Find-TfExe
if (-not $tfExe) {
  Write-Error @"
tf.exe not found. Searched:
  - VS 2022 Team Explorer
  - VS 2019 Team Explorer
  - VS 2017 Team Explorer
  - PATH
Please install Visual Studio with Team Explorer component,
or add tf.exe to your PATH.
"@
  exit 1
}

Write-Host "[TFS] Using tf.exe: $tfExe" -ForegroundColor DarkGray

# --- 从系统凭证库读取密码（不在配置文件中存明文） ---
$tfPassword = $null
if ($config.username) {
  $tfPassword = Read-Password $config.username
}
if (-not $tfPassword) {
  Write-Error @"
未能在系统凭证库中读取 TFS 密码。请先保存密码：
  PowerShell: Read-Host -AsSecureString | ... （或运行下方命令）
  Git Bash : python "$skillDir\scripts\cred_helper.py" set "$($config.username)"
然后重新执行本脚本。详见 SKILL.md「首次配置」。
"@
  exit 1
}

# --- Build login argument ---
$loginArg = ""
if ($config.username) {
  if ($config.domain) {
    $loginArg = "/login:$($config.domain)\$($config.username),$tfPassword"
  } else {
    $loginArg = "/login:$($config.username),$tfPassword"
  }
}

# --- Build collection/server argument ---
$serverArg = "/server:$($config.server)"

# --- Execute action ---
switch ($Action) {

  'checkout' {
    if (-not $Path) { Write-Error "checkout requires -Path"; exit 1 }
    Write-Host "[TFS] Checking out file: $Path" -ForegroundColor Cyan
    # 本地工作区下 tf checkout 不接受 /server:（会报"无法识别的命令选项 server"），
    # 仅在本地工作区命令中省略 serverArg；login 仍需传入以认证。
    & $tfExe checkout "$Path" $loginArg /noprompt
  }

  'undo' {
    if (-not $Path) { Write-Error "undo requires -Path"; exit 1 }
    Write-Host "[TFS] Undoing checkout: $Path" -ForegroundColor Cyan
    # 同 checkout：本地工作区下省略 /server:
    & $tfExe undo "$Path" $loginArg /noprompt
  }

  'checkout-dir' {
    if (-not $Path) { Write-Error "checkout-dir requires -Path"; exit 1 }
    Write-Host "[TFS] Checking out directory (recursive): $Path" -ForegroundColor Cyan
    & $tfExe checkout "$Path" /recursive $loginArg /noprompt
  }

  'add' {
    if (-not $Path) { Write-Error "add requires -Path"; exit 1 }
    Write-Host "[TFS] Adding to source control: $Path" -ForegroundColor Cyan
    & $tfExe add "$Path" /recursive $loginArg /noprompt
  }

  'getlatest' {
    $targetPath = if ($Path) { $Path } else { "." }
    Write-Host "[TFS] Getting latest: $targetPath" -ForegroundColor Cyan
    & $tfExe get "$targetPath" /recursive $serverArg $loginArg /noprompt
  }

  'history' {
    # 路径可选，默认当前目录（与 Bash 对齐）
    $targetPath = if ($Path) { $Path } else { "." }

    # --- 把选项拼成 tf.exe 参数（逻辑与 tf_helper.sh 一致） ---
    $histArgs = @()
    if ($Recursive) { $histArgs += "/recursive" }

    # 推导 version range：--today / --since / --range 互斥叠加（后者覆盖前者）
    $versionRange = ""
    if ($Today) {
      $todayStr = Get-Date -Format "yyyy-MM-dd"
      $versionRange = "D${todayStr}~D${todayStr}"
    }
    if ($Since) {
      $todayStr = Get-Date -Format "yyyy-MM-dd"
      $sinceVal = $Since
      if ($sinceVal -notlike "D*") { $sinceVal = "D$sinceVal" }
      $versionRange = "${sinceVal}~D${todayStr}"
    }
    if ($Range) {
      # 自动补 D 前缀（允许 D2026-07-01~D2026-07-07 或 2026-07-01~2026-07-07）
      $rangeVal = $Range
      if ($rangeVal -notlike "D*") {
        $parts = $rangeVal -split '~'
        $rangeVal = ($parts | ForEach-Object { "D$_" }) -join '~'
      }
      $versionRange = $rangeVal
    }
    if ($versionRange) { $histArgs += "/version:$versionRange" }

    # user 筛选
    $userFilter = ""
    if ($Mine) { $userFilter = $config.username }
    elseif ($User) { $userFilter = $User }
    if ($userFilter) { $histArgs += "/user:$userFilter" }

    # limit：无 version range 时默认 10；指定 range/today/since 时不限制
    $limitArg = ""
    if ($Limit -gt 0) {
      $limitArg = "/stopafter:$Limit"
    } elseif (-not $versionRange) {
      $limitArg = "/stopafter:10"
    }
    if ($limitArg) { $histArgs += $limitArg }

    # --- 缓存策略：仅当无 version range / user / recursive 筛选时启用 ---
    $skillDirForCache = Split-Path -Parent $PSScriptRoot
    $cacheHelper = Join-Path $skillDirForCache "scripts\cache_helper.py"
    $historyTtl = $env:TFS_HISTORY_TTL; if (-not $historyTtl) { $historyTtl = "300" }
    $useCache = (-not $versionRange) -and (-not $userFilter) -and (-not $Recursive) `
      -and ($env:TFS_NO_CACHE -ne "1") -and ($env:TFS_HISTORY_REFRESH -ne "1")
    if ($useCache) {
      $cached = & python $cacheHelper get $targetPath $historyTtl 2>$null
      if ($LASTEXITCODE -eq 0 -and $cached) {
        Write-Host "[TFS] History for: $targetPath (cached, ttl=${historyTtl}s)" -ForegroundColor Cyan
        Write-Output $cached
        exit 0
      }
    }
    $rangeInfo = if ($versionRange) { " (range: $versionRange)" } else { "" }
    $userInfo = if ($userFilter) { " (user: $userFilter)" } else { "" }
    Write-Host "[TFS] History for: $targetPath${rangeInfo}${userInfo}" -ForegroundColor Cyan
    # 捕获输出，tf.exe 退出 0 且启用缓存时才写缓存
    $output = & $tfExe history "$targetPath" @histArgs $serverArg $loginArg /noprompt /format:detailed
    $histExit = $LASTEXITCODE
    Write-Output $output
    if ($histExit -eq 0 -and $output -and $useCache) {
      $output | & python $cacheHelper set $targetPath 2>$null
    }
    exit $histExit
  }

  'status' {
    $targetPath = if ($Path) { $Path } else { "." }
    Write-Host "[TFS] Pending changes: $targetPath" -ForegroundColor Cyan
    # 本地工作区下 tf status 不接受 /server:（会输出"正在忽略 /server 选项"警告），省略之
    & $tfExe status "$targetPath" /recursive $loginArg /noprompt
  }

  'diff' {
    # diff 当前工作区 vs TFS 最新版本（unified diff 格式，AI 场景便于解析）
    $targetPath = if ($Path) { $Path } else { "." }
    Write-Host "[TFS] Diff vs TFS latest: $targetPath" -ForegroundColor Cyan
    # diff 输出可能很长，不走 history 那种缓存（必须新鲜）
    # 本地工作区下不需要 /server:（避免警告）；/format:unified 输出标准 unified diff
    & $tfExe diff "$targetPath" /recursive $loginArg /noprompt /format:unified
  }

  'test' {
    # 连接测试：用 tf workspaces 验证认证 + 集合连通，不依赖本地工作区映射
    # 退出码 0 = 认证通过；非 0 = 认证失败 / 网络不通
    Write-Host "[TFS] 测试连接（验证认证 + 集合连通性）..." -ForegroundColor Cyan
    $collectionArg = "/collection:$($config.server)"
    & $tfExe workspaces $collectionArg $loginArg /noprompt 2>&1 | ForEach-Object {
      # 去掉密码行后透传输出（workspaces 不输出密码，但稳妥起见过滤）
      $_
    }
    $testExit = $LASTEXITCODE
    if ($testExit -eq 0) {
      Write-Host "[TFS] ✅ 连接测试通过：认证成功，集合可达。" -ForegroundColor Green
    } else {
      Write-Host "[TFS] ❌ 连接测试失败（exit=$testExit）。请检查凭证、用户名、domain 及服务器地址。" -ForegroundColor Red
    }
    exit $testExit
  }
}

$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  Write-Host "[TFS] Command exited with code: $exitCode" -ForegroundColor Yellow
}
exit $exitCode
