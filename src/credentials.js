'use strict';

/**
 * 系统凭证库抽象。
 *
 * Windows: 用 wincred 包调 advapi32 CredReadW/CredWriteW/CredDeleteW。
 *          非 Windows: 抛 CliError(INTERNAL_ERROR) — tfs-cli 不支持其他平台。
 *
 * 服务名（target prefix）：tfs-cli（与旧的 tfs-tf-commands 互不通用，
 *                          这是重写后的新 service）。
 *
 * 读写都接受 username 一个标识，返回/写入对应明文密码。
 * 配置文件中只保留 password_ref 占位，不存明文。
 */

const { spawn } = require('child_process');
const { CliError, ERROR_CODES } = require('./errors');

const KEYRING_SERVICE = 'tfs-cli';

function target(username) {
  return `${KEYRING_SERVICE}:${username}`;
}

let wincred = null;
function loadWincred() {
  if (wincred !== null) return wincred;
  try {
    // 尝试加载可选依赖；非 Windows 平台不存在或加载失败
    wincred = require('wincred');
  } catch (e) {
    wincred = false;
  }
  return wincred || false;
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
 * 把密码写入系统凭证库。
 *
 * @param {string} username
 * @param {string} password
 */
async function setPassword(username, password) {
  ensureWindows();
  if (!username) throw new CliError(ERROR_CODES.INVALID_ARGS, 'username 不能为空');
  if (!password) throw new CliError(ERROR_CODES.INVALID_ARGS, 'password 不能为空');

  const wc = loadWincred();
  if (wc) {
    try {
      wc.set(target(username), username, password);
      return;
    } catch (e) {
      // 落到 cmdkey 回退（处理一些奇怪的 wincred 错误）
    }
  }

  // cmdkey 回退：纯 ASCII 密码可用
  await runCmdkey(['/generic:' + target(username), '/user:' + username, '/pass:' + password]);
}

/**
 * 从系统凭证库读取密码。
 *
 * @param {string} username
 * @returns {string}
 */
function getPassword(username) {
  ensureWindows();
  if (!username) throw new CliError(ERROR_CODES.INVALID_ARGS, 'username 不能为空');

  const wc = loadWincred();
  if (wc) {
    const cred = wc.get(target(username));
    if (!cred) {
      throw new CliError(
        ERROR_CODES.CREDENTIAL_MISSING,
        `未找到凭证 (service=${KEYRING_SERVICE}, user=${username})。请运行: tfs-cli init`,
        { username, target: target(username) }
      );
    }
    return cred.password;
  }

  // cmdkey /list 输出形如：
  //   Target: tfs-cli:alice
  //   Type: Generic
  //   User: alice
  // cmdkey /list 不暴露密码本身，无法直接读——降级：通过 wincred 没装的事实报错
  throw new CliError(
    ERROR_CODES.CREDENTIAL_MISSING,
    `未找到凭证。请安装 wincred 或运行: tfs-cli init`,
    { username }
  );
}

/**
 * 删除凭证。
 *
 * @param {string} username
 */
function deletePassword(username) {
  ensureWindows();
  if (!username) throw new CliError(ERROR_CODES.INVALID_ARGS, 'username 不能为空');

  const wc = loadWincred();
  if (wc) {
    try {
      wc.remove(target(username));
      return true;
    } catch (e) {
      return false;
    }
  }
  // cmdkey 回退
  try {
    const { status } = spawnSync('cmdkey', ['/delete:' + target(username)], { windowsHide: true });
    return status === 0;
  } catch (e) {
    return false;
  }
}

/**
 * 是否已存在凭证。
 *
 * @param {string} username
 * @returns {boolean}
 */
function hasPassword(username) {
  ensureWindows();
  const wc = loadWincred();
  if (wc) {
    try {
      return !!wc.get(target(username));
    } catch (e) {
      return false;
    }
  }
  return false;
}

function runCmdkey(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('cmdkey', args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new CliError(ERROR_CODES.INTERNAL_ERROR, `cmdkey 失败 (exit=${code}): ${stderr.trim()}`));
    });
  });
}

function spawnSync(cmd, args, opts) {
  // 同步版本的 cmdkey 调用（仅 delete 用到）；保留本地实现避免和 child_process.spawnSync 混淆
  const { spawnSync: real } = require('child_process');
  return real(cmd, args, opts);
}

module.exports = {
  KEYRING_SERVICE,
  target,
  setPassword,
  getPassword,
  deletePassword,
  hasPassword
};
