#!/usr/bin/env node
'use strict';

// tfs-cli — TFS (tf.exe) 命令行包装工具
// 安装后由 package.json bin 字段暴露为 `tfs-cli` 命令。
// 本文件只是启动入口，实际逻辑在 src/index.js。

require('../src/index').main(process.argv);
