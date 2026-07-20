'use strict';

/**
 * Windows 凭证库抽象。
 *
 * 写入/删除使用系统自带 cmdkey；读取通过 PowerShell 调用 CredReadW。
 * 密码不写配置文件，PowerShell 脚本从 stdin 读取，凭证 target 通过环境变量传递。
 */

const { CliError, ERROR_CODES } = require('./errors');
const fs = require('fs');
const path = require('path');
const os = require('os');

const KEYRING_SERVICE = 'tfs-cli';

// C# 类型定义：base64 编码，避免 PowerShell @'...'@ here-string 在 stdin 管道下不工作。
// 脚本运行时解码后传给 Add-Type -TypeDefinition。
const CSHARP_TYPE = Buffer.from(`
using System;
using System.Runtime.InteropServices;

public static class TfsCliCredentialManager {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public UInt32 Flags;
    public UInt32 Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }

  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredReadW(string target, UInt32 type, UInt32 flags, out IntPtr credential);

  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr credential);
}
`.trim(), 'utf-8').toString('base64');

const READ_CREDENTIAL_SCRIPT = `
$csharpB64 = '${CSHARP_TYPE}'
$csharp = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($csharpB64))
Add-Type -TypeDefinition $csharp

$credential = [IntPtr]::Zero
if (-not [TfsCliCredentialManager]::CredReadW($env:TFS_CLI_CRED_TARGET, 1, 0, [ref]$credential)) {
  $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  if ($code -eq 1168) {
    [Console]::Out.Write('NOT_FOUND')
    exit 2
  }
  [Console]::Error.Write("CredReadW failed ($code)")
  exit 1
}

try {
  $value = [Runtime.InteropServices.Marshal]::PtrToStructure(
    $credential,
    [Type][TfsCliCredentialManager+CREDENTIAL]
  )
  if ($value.CredentialBlobSize -eq 0) {
    $password = ''
  } else {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringUni(
      $value.CredentialBlob,
      [int]($value.CredentialBlobSize / 2)
    )
  }
  $bytes = [Text.Encoding]::UTF8.GetBytes($password)
  [Console]::Out.Write('FOUND:' + [Convert]::ToBase64String($bytes))
} finally {
  [TfsCliCredentialManager]::CredFree($credential)
}
`;

function target(username) {
  return `${KEYRING_SERVICE}:${username}`;
}

function ensureWindows() {
  if (process.platform !== 'win32') {
    throw new CliError(
      ERROR_CODES.INTERNAL_ERROR,
      'tfs-cli 目前仅支持 Windows（tf.exe 是 Windows 程序）'
    );
  }
}

/**
 * @param {string} username
 * @param {string} password
 * @param {{spawn?: Function}} [opts]
 */
async function setPassword(username, password, opts = {}) {
  ensureWindows();
  if (!username) throw new CliError(ERROR_CODES.INVALID_ARGS, 'username 不能为空');
  if (!password) throw new CliError(ERROR_CODES.INVALID_ARGS, 'password 不能为空');

  const spawn = opts.spawn || require('child_process').spawn;
  await runCmdkey(spawn, [
    '/generic:' + target(username),
    '/user:' + username,
    '/pass:' + password
  ]);
}

/**
 * @param {string} username
 * @param {{spawnSync?: Function}} [opts]
 * @returns {string}
 */
function getPassword(username, opts = {}) {
  ensureWindows();
  if (!username) throw new CliError(ERROR_CODES.INVALID_ARGS, 'username 不能为空');

  const password = readPassword(username, opts.spawnSync);
  if (password === null) {
    throw new CliError(
      ERROR_CODES.CREDENTIAL_MISSING,
      `未找到凭证 (service=${KEYRING_SERVICE}, user=${username})。请运行: tfs-cli init`,
      { username, target: target(username) }
    );
  }
  return password;
}

/**
 * @param {string} username
 * @param {{spawnSync?: Function}} [opts]
 * @returns {boolean}
 */
function deletePassword(username, opts = {}) {
  ensureWindows();
  if (!username) throw new CliError(ERROR_CODES.INVALID_ARGS, 'username 不能为空');

  const spawnSync = opts.spawnSync || require('child_process').spawnSync;
  try {
    const result = spawnSync('cmdkey', ['/delete:' + target(username)], { windowsHide: true });
    return !result.error && result.status === 0;
  } catch (e) {
    return false;
  }
}

/**
 * @param {string} username
 * @param {{spawnSync?: Function}} [opts]
 * @returns {boolean}
 */
function hasPassword(username, opts = {}) {
  ensureWindows();
  if (!username) throw new CliError(ERROR_CODES.INVALID_ARGS, 'username 不能为空');
  return readPassword(username, opts.spawnSync) !== null;
}

function readPassword(username, spawnSyncFn) {
  const spawnSync = spawnSyncFn || require('child_process').spawnSync;
  const credentialTarget = target(username);
  const tmpScript = path.join(os.tmpdir(), `tfs-cli-cred-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ps1`);

  // intentional-simple: 写临时 .ps1 文件执行（-File），因为 PowerShell 的
  // -Command -（stdin）对一些语法结构（如 Add-Type 的 C# 代码）处理不稳定。
  try {
    fs.writeFileSync(tmpScript, READ_CREDENTIAL_SCRIPT, 'utf-8');
  } catch (e) {
    throw new CliError(ERROR_CODES.INTERNAL_ERROR, `无法写入临时脚本: ${e.message}`, {
      username,
      target: credentialTarget
    });
  }

  let result;
  try {
    result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-File', tmpScript],
      {
        windowsHide: true,
        encoding: 'utf-8',
        env: { ...process.env, TFS_CLI_CRED_TARGET: credentialTarget }
      }
    );
  } catch (e) {
    throw new CliError(ERROR_CODES.INTERNAL_ERROR, `无法启动 PowerShell 读取凭证: ${e.message}`, {
      username,
      target: credentialTarget
    });
  } finally {
    try { fs.unlinkSync(tmpScript); } catch (_) { /* 清理失败不影响主流程 */ }
  }

  const stdout = (result.stdout || '').trim();
  if (result.status === 2 && stdout === 'NOT_FOUND') return null;
  if (result.error || result.status !== 0) {
    const reason = result.error ? result.error.message : (result.stderr || '').trim();
    throw new CliError(
      ERROR_CODES.INTERNAL_ERROR,
      `读取 Windows 凭证失败${reason ? `: ${reason}` : ` (exit=${result.status})`}`,
      { username, target: credentialTarget }
    );
  }
  if (!stdout.startsWith('FOUND:')) {
    throw new CliError(ERROR_CODES.INTERNAL_ERROR, '读取 Windows 凭证时收到无法识别的响应', {
      username,
      target: credentialTarget
    });
  }

  try {
    return Buffer.from(stdout.slice('FOUND:'.length), 'base64').toString('utf-8');
  } catch (e) {
    throw new CliError(ERROR_CODES.INTERNAL_ERROR, 'Windows 凭证内容解码失败', {
      username,
      target: credentialTarget
    });
  }
}

function runCmdkey(spawn, args) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('cmdkey', args, { windowsHide: true });
    } catch (e) {
      reject(new CliError(ERROR_CODES.INTERNAL_ERROR, `无法启动 cmdkey: ${e.message}`));
      return;
    }

    let output = '';
    if (child.stdout) child.stdout.on('data', (d) => (output += d.toString()));
    if (child.stderr) child.stderr.on('data', (d) => (output += d.toString()));
    child.on('error', (e) => {
      reject(new CliError(ERROR_CODES.INTERNAL_ERROR, `cmdkey 启动失败: ${e.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new CliError(ERROR_CODES.INTERNAL_ERROR, `cmdkey 失败 (exit=${code}): ${output.trim()}`));
    });
  });
}

module.exports = {
  KEYRING_SERVICE,
  target,
  setPassword,
  getPassword,
  deletePassword,
  hasPassword
};
