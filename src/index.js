'use strict';

const { Command } = require('commander');
const pkg = require('../package.json');

const { format } = require('./formatters/output');
const { withExecutor } = require('./commands/_helpers');

const { init } = require('./commands/init');
const cfgCmd = require('./commands/config');
const { checkout } = require('./commands/checkout');
const { undo } = require('./commands/undo');
const { edit } = require('./commands/edit');
const { add } = require('./commands/add');
const { getlatest } = require('./commands/getlatest');
const { status } = require('./commands/status');
const { diff } = require('./commands/diff');
const { history } = require('./commands/history');
const { testConnection } = require('./commands/test-connection');
const { inject } = require('./commands/inject');

const { CliError } = require('./errors');

/**
 * 把 commander action 标准化为 (opts) -> {response, exitCode}
 * —— 处理 CliError 输出 + process.exit
 *
 * actionCallback 接收 (positionalOrOpts, optsOrCommand, command)
 * 我们把第一个非 undefined 的"位置参数"塞进 opts.inputPath，并始终取 args[length-1] 为 command。
 */
function makeRunner(fn, { needsExecutor = false } = {}) {
  return async (...actionArgs) => {
    // commander 总是以 Command 实例结尾，倒数第二个是 options（即便没声明也传 {}）
    const cmd = actionArgs[actionArgs.length - 1];
    const optsIdx = actionArgs.length - 2;
    const opts = actionArgs[optsIdx] && typeof actionArgs[optsIdx] === 'object'
      ? actionArgs[optsIdx]
      : {};
    // positional 参数位于 [0, optsIdx)：支持 0/1/2+ 个（如 `config set <key> <value>`）
    const positionals = actionArgs.slice(0, optsIdx);
    opts.positionals = positionals;
    // 兼容：单 positional 命令（如 `checkout <path>`）仍可从 opts.inputPath 取
    if (positionals.length > 0 && opts.inputPath === undefined) {
      opts.inputPath = positionals[0];
    }

    // 全局 option（--text / --pretty）必须用 optsWithGlobals() 读取；
    // cmd.parent.opts() 在子命令 action 中拿不到 program 级 option。
    const globalOpts = cmd.optsWithGlobals();
    const text = globalOpts.text;
    const pretty = globalOpts.pretty;

    let result;
    try {
      result = needsExecutor
        ? await withExecutor((ctx) => fn(opts, ctx))
        : await fn(opts);
    } catch (e) {
      if (e instanceof CliError) {
        result = {
          response: {
            ok: false,
            action: 'cli',
            path: opts.inputPath || null,
            data: null,
            error: { code: e.code, message: e.message, details: e.details },
            meta: { duration_ms: 0 }
          },
          exitCode: e.exitCode || 1
        };
      } else {
        throw e;
      }
    }

    process.stdout.write(format(result.response, { text, pretty }) + '\n');
    process.exit(result.exitCode);
  };
}

function buildProgram() {
  const program = new Command();

  program
    .name('tfs-cli')
    .description(
      'TFS (tf.exe) 命令行包装工具，为 AI Agent 提供结构化 JSON 输出和自动化工作流。'
    )
    .version(pkg.version)
    .option('--text', '输出人类可读文本（默认 JSON）')
    .option('--pretty', '输出带缩进的 JSON（默认 compact，省 token；人类调试用）')
    .option('--no-color', '禁用 ANSI 转义（保留供未来扩展）');

  program.addHelpText(
    'after',
    `
  退出码：
    0  成功
    1  通用错误（凭证、tf、网络）
    2  文件被他人签出（仅 edit 命令）
    3  配置缺失（需运行 tfs-cli init）
    4  tf.exe 未找到

  输出：
    所有命令默认输出 JSON，便于 AI 解析；加 --text 切换人类可读文本。
`
  );

  // init
  program
    .command('init')
    .description('初始化全局配置（服务器 / 用户名 / 密码）')
    .option('-U, --url <url>', 'TFS 服务器 URL（含 /tfs/<collection>）')
    .option('-u, --username <u>', '用户名')
    .option('-p, --password <p>', '密码（建议用环境变量 TFS_PASSWORD）')
    .option('-d, --domain <d>', '域（可选）', '')
    .option('-w, --workspace <w>', '工作区名（可选）', '')
    .action(
      makeRunner(
        async (opts) =>
          await init({
            url: process.env.TFS_URL || opts.url,
            username: process.env.TFS_USERNAME || opts.username,
            password: process.env.TFS_PASSWORD || opts.password,
            domain: opts.domain,
            workspace: opts.workspace
          })
      )
    );

  // config
  const configCmd = program.command('config').description('全局配置管理');
  configCmd
    .command('show')
    .description('打印当前配置')
    .action(makeRunner(async () => cfgCmd.show()));
  configCmd
    .command('set <key> <value>')
    .description('设置 server/username/domain/workspace/collection 之一')
    .action(makeRunner((opts) => cfgCmd.set(opts.positionals[0], opts.positionals[1])));
  configCmd
    .command('reset')
    .description('删除全局配置 + 凭证')
    .action(makeRunner(async () => cfgCmd.reset()));

  // 文件操作（需要 executor）
  const tfCmd = (name, desc, fn) =>
    program
      .command(name)
      .description(desc)
      .action(makeRunner(fn, { needsExecutor: true }));

  tfCmd('checkout <path>', '签出文件', checkout);
  tfCmd('undo <path>', '撤销签出', undo);
  tfCmd('edit <path>', '编辑前自动签出 + 冲突检测（推荐在 Edit/Write 工具前调用）', edit);
  tfCmd('add <path>', '加入源代码管理（递归目录）', add);
  tfCmd('getlatest [path]', '获取最新版本（默认当前目录递归）', getlatest);
  tfCmd('status [path]', '查看待定更改', status);
  tfCmd('diff [path]', '查看与 TFS 最新版本的差异（unified diff）', diff);

  program
    .command('history [path]')
    .description('查看历史')
    .option('--today', '仅今天')
    .option('--since <date>', '从指定日期到今天（YYYY-MM-DD）')
    .option('--range <r>', '版本范围，格式 DYYYY-MM-DD~DYYYY-MM-DD（可省略 D 前缀）')
    .option('-r, --recursive', '递归子目录')
    .option('--user <name>', '按用户筛选')
    .option('--mine', '仅当前用户')
    .option('--limit <n>', '最多 N 条')
    .action(makeRunner(history, { needsExecutor: true }));

  program
    .command('test')
    .description('测试连接（验证凭证 + 集合可达）')
    .action(makeRunner(() => withExecutor((ctx) => testConnection({}, ctx)), { needsExecutor: true }));

  // inject
  program
    .command('inject')
    .description('把 TFS 规则写入 AGENTS.md / rules/ 等项目文件')
    .option('-t, --target <dir>', '目标项目目录（默认 cwd）', process.cwd())
    .option('-a, --agent <name>', '目标 agent（可重复，默认 auto-detect）')
    .option('-f, --force', '已存在 marker 强制覆盖')
    .option('--dry-run', '只打印计划，不写文件')
    .action(
      makeRunner(
        async (opts) =>
          await inject({
            target: opts.target,
            agent: opts.agent ? [opts.agent] : null,
            force: opts.force,
            dryRun: opts.dryRun
          })
      )
    );

  return program;
}

function main(argv) {
  const program = buildProgram();
  program.exitOverride();
  try {
    program.parse(argv);
  } catch (e) {
    const isCommander = e && e.code && typeof e.code === 'string' && e.code.startsWith('commander');
    if (isCommander) {
      // help/version 已由 commander 自己输出，安静退出
      if (e.code === 'commander.helpDisplayed' || e.code === 'commander.help' || e.code === 'commander.version') {
        process.exit(e.exitCode || 0);
      }
      const text = argv.includes('--text');
      const pretty = argv.includes('--pretty');
      process.stdout.write(
        format(
          {
            ok: false,
            action: 'cli',
            path: null,
            data: null,
            error: { code: 'INVALID_ARGS', message: e.message, details: null },
            meta: { duration_ms: 0 }
          },
          { text, pretty }
        ) + '\n'
      );
      process.exit(e.exitCode || 1);
    }
    throw e;
  }
}

module.exports = { main, buildProgram };
