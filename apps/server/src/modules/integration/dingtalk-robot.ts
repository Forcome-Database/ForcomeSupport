import { createHmac } from 'node:crypto';
import { z } from 'zod';
import type { AlertMessage, AlertSender, DingtalkRobotConfig } from '../core';
import { defineClient, type FakeClient } from './definition';
import { ClientNotConfiguredError, ExternalCallFailedError, FaultInjector } from './faults';
import { createHttpClient, type HttpClient } from './http';

/*
 * 运维群的钉钉自定义机器人（待办 28，ADR 0013 修订「监控告警」）：worker 每分钟自检发现异常时往群里发一条 markdown 消息。
 * 与钉钉企业内部应用（dingtalk.ts，通讯录、登录、工作通知）是两回事：群机器人只有一个 Webhook，不需要应用凭据。
 * 全局客户端，按 CLIENT_MODE_DINGTALK_ROBOT 选择：生产默认真实接口，开发与测试默认 Fake（只记下、写日志）。
 *
 * 真实现按钉钉开放平台「自定义机器人发送群消息」的写法：
 * - POST Webhook（https://oapi.dingtalk.com/robot/send?access_token=…），JSON 体 { msgtype: 'markdown', markdown: { title, text } }；
 * - 安全设置选「加签」时，地址另带 timestamp（毫秒）与 sign：以密钥为 key 对「timestamp + "\n" + 密钥」做 HmacSHA256，
 *   Base64 后再 URL 编码；时间戳与钉钉服务器相差超过 1 小时会被拒，所以取系统时间（不取运行时的时钟：开发测试环境可设 CLOCK_START）；
 * - 返回 HTTP 200 与 { errcode, errmsg }：errcode 为 0 才算发出（310000 是签名或关键词不对，每分钟超过 20 条会被限流）。
 * 经出站 HTTP 客户端工厂（钉钉是境内域名，按 NO_PROXY 直连，ADR 0003）；Webhook 的 access_token 与 sign 在调用记录里写成 ***。
 */

/** 群机器人的接口：发一条告警（core 的 AlertSender） */
export type DingtalkRobotClient = AlertSender;

const SYSTEM = 'dingtalk_robot';
const OPERATION = 'robot.send';

const robotResponseSchema = z.object({ errcode: z.number(), errmsg: z.string().optional() });

/** 加签：timestamp + "\n" + 密钥，HmacSHA256 后 Base64（调用方再做 URL 编码） */
export function dingtalkRobotSign(timestamp: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64');
}

/** 发送用的地址：Webhook，加签时另带 timestamp 与 sign */
export function dingtalkRobotUrl(config: DingtalkRobotConfig, now: Date): string {
  if (!config.secret) return config.webhook;
  const url = new URL(config.webhook);
  const timestamp = String(now.getTime());
  url.searchParams.set('timestamp', timestamp);
  url.searchParams.set('sign', dingtalkRobotSign(timestamp, config.secret));
  return url.toString();
}

export function createRealDingtalkRobot(
  http: HttpClient,
  config: DingtalkRobotConfig | null,
  now: () => Date = () => new Date(),
): DingtalkRobotClient {
  return {
    async sendAlert(message: AlertMessage) {
      if (!config) {
        throw new ClientNotConfiguredError(SYSTEM, OPERATION, '没有配置 DINGTALK_ROBOT_WEBHOOK');
      }
      const json = await http.postJson(
        dingtalkRobotUrl(config, now()),
        { msgtype: 'markdown', markdown: { title: message.title, text: message.markdown } },
        { operation: OPERATION },
      );
      const parsed = robotResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new ExternalCallFailedError(SYSTEM, OPERATION, {
          message: '返回内容不认识（没有 errcode）',
          retryable: false,
        });
      }
      if (parsed.data.errcode !== 0) {
        throw new ExternalCallFailedError(SYSTEM, OPERATION, {
          message: `钉钉群机器人返回 ${parsed.data.errcode}：${parsed.data.errmsg ?? ''}`,
          // 130101：发送太快（每分钟最多 20 条），等一会儿可以再发；其余（签名、关键词、access_token 不对）重试也没用
          retryable: parsed.data.errcode === 130101,
        });
      }
    },
  };
}

// ---------------------------------------------------------------- Fake

/**
 * Fake 群机器人：发出的消息记在 sent 里（测试断言、开发测试环境默认就是它，worker 日志里也有同一条）；
 * faults 让发送失败（操作名 robot.send）
 */
export class FakeDingtalkRobot implements FakeClient<DingtalkRobotClient> {
  readonly faults = new FaultInjector(SYSTEM);
  readonly sent: AlertMessage[] = [];

  client(): DingtalkRobotClient {
    return {
      sendAlert: async (message) => {
        await this.faults.check(OPERATION);
        this.sent.push(message);
      },
    };
  }

  reset(): void {
    this.sent.length = 0;
    this.faults.reset();
  }
}

/** 运维群的钉钉机器人（全局，按 CLIENT_MODE_DINGTALK_ROBOT 选择；不设时非生产为 Fake、生产为真实接口） */
export const dingtalkRobotClient = defineClient({
  system: SYSTEM,
  scope: 'global',
  createReal: ({ dingtalkRobot, callRecorder }) =>
    createRealDingtalkRobot(createHttpClient(SYSTEM, { recorder: callRecorder }), dingtalkRobot),
  createFake: () => new FakeDingtalkRobot(),
});
