// 入口：alert-test（一次性，开发测试与生产都用）。经 worker 自检用的同一个钉钉群机器人客户端发一条「告警通道已连通」
// （待办 28，协调者 2026-10-14 决定 Q1）：
//   node dist/alert-test.mjs [--release <版本>]
// 不连数据库。没配置 Webhook、或钉钉拒收（签名、关键词不对）时退出码 1。部署脚本子命令：node deploy/deploy.mjs <环境> alert-test
// （同时经宿主机检查的那一路再发一条）。
import { parseArgs } from 'node:util';
import { alertTestMessage, loadConfig, systemClock } from './modules/core';
import { createIntegrationClients, dingtalkRobotClient } from './modules/integration';

const config = loadConfig();

try {
  const { values } = parseArgs({ options: { release: { type: 'string' } } });
  const clients = createIntegrationClients(config);
  const robot = clients.global(dingtalkRobotClient);
  const mode = clients.globalMode('dingtalk_robot');
  await robot.sendAlert(
    alertTestMessage(config.appEnv, systemClock.now(), 'worker 每分钟自检', values.release ?? null),
  );
  process.stdout.write(
    mode === 'fake'
      ? '钉钉群机器人用的是 Fake（CLIENT_MODE_DINGTALK_ROBOT 没设为 real）：消息没有发出，只验证了配置\n'
      : '已经 worker 的钉钉群机器人客户端发出「告警通道已连通」\n',
  );
} catch (error) {
  process.stderr.write(`发送失败：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
