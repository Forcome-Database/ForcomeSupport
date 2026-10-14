import { createHmac } from 'node:crypto';
import { MockAgent } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { noCallRecords, type CallRecordEntry } from './call-records';
import { createRealDingtalkRobot, dingtalkRobotSign, FakeDingtalkRobot } from './dingtalk-robot';
import { createHttpClient } from './http';

/*
 * 运维群的钉钉自定义机器人（待办 28）：真实现按钉钉开放平台「自定义机器人发送群消息」的写法发 markdown、加签、翻译 errcode。
 * 不连外网：undici 的 MockAgent 按 URL 回放钉钉的返回，没登记的请求直接失败。
 */

const OAPI = 'https://oapi.dingtalk.com';
const WEBHOOK = `${OAPI}/robot/send?access_token=robot-token`;
const SECRET = 'SEC0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd';
/** 2026-10-14 10:20:00 北京时间（毫秒时间戳） */
const NOW = new Date('2026-10-14T10:20:00+08:00');
const MESSAGE = {
  title: '【Forcome Support · 生产】自检发现 1 项异常',
  markdown: '#### 标题\n\n- 一项',
};

let agent: MockAgent;
beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
});
afterEach(async () => {
  await agent.close();
});

function robot(
  config = { webhook: WEBHOOK, secret: SECRET as string | null },
  records = noCallRecords,
) {
  return createRealDingtalkRobot(
    createHttpClient('dingtalk_robot', { dispatcher: agent, recorder: records }),
    config,
    () => NOW,
  );
}

describe('真实现：加签与发送', () => {
  it('POST Webhook，地址带毫秒时间戳与签名（HmacSHA256(timestamp\\n密钥)，Base64 后 URL 编码），体是 markdown 消息', async () => {
    const timestamp = String(NOW.getTime());
    const sign = createHmac('sha256', SECRET).update(`${timestamp}\n${SECRET}`).digest('base64');
    let seenPath = '';
    let seenBody: unknown = null;
    agent
      .get(OAPI)
      .intercept({
        path: (path) => {
          seenPath = path;
          return path.startsWith('/robot/send?');
        },
        method: 'POST',
        body: (body) => {
          seenBody = JSON.parse(body);
          return true;
        },
      })
      .reply(200, { errcode: 0, errmsg: 'ok' });

    await robot().sendAlert(MESSAGE);

    const url = new URL(`${OAPI}${seenPath}`);
    expect(url.searchParams.get('access_token')).toBe('robot-token');
    expect(url.searchParams.get('timestamp')).toBe(timestamp);
    expect(url.searchParams.get('sign')).toBe(sign);
    // URL 里 Base64 的 + / = 都要编码
    expect(seenPath).toContain(`sign=${encodeURIComponent(sign)}`);
    expect(seenBody).toEqual({
      msgtype: 'markdown',
      markdown: { title: MESSAGE.title, text: MESSAGE.markdown },
    });
    agent.assertNoPendingInterceptors();
  });

  it('签名与钉钉文档的算法一致（固定输入的结果）', () => {
    expect(dingtalkRobotSign('1792000000000', 'SECtest')).toBe(
      createHmac('sha256', 'SECtest').update('1792000000000\nSECtest').digest('base64'),
    );
  });

  it('没选加签的群机器人：地址原样，不带 timestamp 与 sign', async () => {
    agent
      .get(OAPI)
      .intercept({ path: '/robot/send?access_token=robot-token', method: 'POST' })
      .reply(200, { errcode: 0, errmsg: 'ok' });
    await robot({ webhook: WEBHOOK, secret: null }).sendAlert(MESSAGE);
    agent.assertNoPendingInterceptors();
  });

  it('errcode 不为 0 算发送失败：310000（签名或关键词不对）不可重试，130101（太快）可重试', async () => {
    agent
      .get(OAPI)
      .intercept({ path: (path) => path.startsWith('/robot/send?'), method: 'POST' })
      .reply(200, { errcode: 310000, errmsg: 'sign not match' });
    await expect(robot().sendAlert(MESSAGE)).rejects.toThrow(
      '钉钉群机器人返回 310000：sign not match',
    );
    agent
      .get(OAPI)
      .intercept({ path: (path) => path.startsWith('/robot/send?'), method: 'POST' })
      .reply(200, { errcode: 310000, errmsg: 'sign not match' });
    await expect(robot().sendAlert(MESSAGE)).rejects.toMatchObject({
      name: 'ExternalCallFailedError',
      retryable: false,
    });
    agent
      .get(OAPI)
      .intercept({ path: (path) => path.startsWith('/robot/send?'), method: 'POST' })
      .reply(200, { errcode: 130101, errmsg: 'send too fast' });
    await expect(robot().sendAlert(MESSAGE)).rejects.toMatchObject({ retryable: true });
  });

  it('调用记录里 access_token 与 sign 写成 ***', async () => {
    const entries: CallRecordEntry[] = [];
    agent
      .get(OAPI)
      .intercept({ path: (path) => path.startsWith('/robot/send?'), method: 'POST' })
      .reply(200, { errcode: 0, errmsg: 'ok' });
    await robot(undefined, {
      record: (entry) => {
        entries.push(entry);
        return Promise.resolve();
      },
    }).sendAlert(MESSAGE);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ system: 'dingtalk_robot', operation: 'robot.send' });
    expect(entries[0]?.request).toContain('access_token=***');
    expect(entries[0]?.request).toContain('sign=***');
    expect(entries[0]?.request).not.toContain('robot-token');
  });

  it('没配置 Webhook：以「未配置」失败（自检据此只写日志）', async () => {
    await expect(
      createRealDingtalkRobot(
        createHttpClient('dingtalk_robot', { dispatcher: agent }),
        null,
      ).sendAlert(MESSAGE),
    ).rejects.toMatchObject({ name: 'ClientNotConfiguredError' });
  });
});

describe('Fake', () => {
  it('记下发出的消息；故障注入让发送失败', async () => {
    const fake = new FakeDingtalkRobot();
    await fake.client().sendAlert(MESSAGE);
    expect(fake.sent).toEqual([MESSAGE]);
    fake.faults.failNext();
    await expect(fake.client().sendAlert(MESSAGE)).rejects.toThrow();
    fake.reset();
    expect(fake.sent).toEqual([]);
  });
});
