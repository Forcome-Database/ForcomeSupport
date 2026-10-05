// 入口：import-aftersales（一次性，开发测试与生产都用）。售后登记表导入（PRD 第 14 节，待办 27，不用模型）：
//   node dist/import-aftersales.mjs <登记表.xlsx|.csv> [--mapping <映射表.json>] [--dry-run]
// 按映射表（默认随镜像打包的 history-mapping.json）把原表逐行导入台账，创建路径「历史导入」；--dry-run 只报告将导入的行
// 与错误、不写库。先跑 migrate；金额按费用发生日的汇率折算（汇率表由 worker 同步，生产库第一次同步就装入全量历史）。
// 报告逐行写到标准输出；有未导入的行时退出码为 1（其余行照常导入，改好后重跑，已导入的行会跳过）。命令本身在
// import-aftersales-command.ts，这里只组装运行时。
import { runImportAftersalesCommand } from './import-aftersales-command';
import { createLogger, loadConfig, startRuntime } from './modules/core';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, name: 'import-aftersales' });

try {
  process.exitCode = await runImportAftersalesCommand(
    process.argv.slice(2),
    async () => {
      const { runtime, stop } = await startRuntime(config.databaseUrl, {
        role: 'api',
        logger,
        poolMax: 1,
      });
      return { runtime, stop: () => stop({ graceful: false }) };
    },
    {
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    },
  );
} catch (error) {
  logger.error({ err: error }, '售后登记表导入失败');
  process.exitCode = 1;
}
