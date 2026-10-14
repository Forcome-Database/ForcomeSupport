import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { dingtalkRobotSign } from '../../apps/server/src/modules/integration/dingtalk-robot.ts';
import { robotSign, robotUrl, sendRobotMessage } from './dingtalk-robot.mjs';

/*
 * 宿主机检查发钉钉群机器人消息（待办 28）：部署脚本不引用应用代码，另写了一份加签。这里对照应用里的实现（同一组输入同一个签名），
 * 再用一个本地 HTTP 服务当钉钉，核对地址里的 timestamp 与 sign、体与 errcode 的处理。
 */

const SECRET = 'SEC0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd';

let server;
afterEach(() => server?.close());

/** 本地的「钉钉」：记下收到的请求，按 reply 返回 */
function fakeDingtalk(reply) {
  const received = [];
  server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ received, webhook: `http://127.0.0.1:${port}/robot/send?access_token=drill` });
    });
  });
}

describe('加签', () => {
  it('与应用里的实现一致', () => {
    for (const timestamp of ['1792000000000', '1792000012345']) {
      expect(robotSign(timestamp, SECRET)).toBe(dingtalkRobotSign(timestamp, SECRET));
    }
  });

  it('没有密钥时地址原样；有密钥时带毫秒时间戳与 URL 编码的签名', () => {
    const webhook = 'https://oapi.dingtalk.com/robot/send?access_token=abc';
    expect(robotUrl(webhook, null, new Date())).toBe(webhook);
    const now = new Date('2026-10-14T02:20:00Z');
    const url = new URL(robotUrl(webhook, SECRET, now));
    expect(url.searchParams.get('access_token')).toBe('abc');
    expect(url.searchParams.get('timestamp')).toBe(String(now.getTime()));
    expect(url.searchParams.get('sign')).toBe(robotSign(String(now.getTime()), SECRET));
  });
});

describe('发送', () => {
  it('POST markdown 消息；errcode 为 0 算发出', async () => {
    const { received, webhook } = await fakeDingtalk({ errcode: 0, errmsg: 'ok' });
    await sendRobotMessage({ webhook, secret: SECRET }, { title: '标题', markdown: '#### 标题' });
    expect(received).toHaveLength(1);
    expect(received[0].url).toMatch(/^\/robot\/send\?access_token=drill&timestamp=\d+&sign=/);
    expect(received[0].body).toEqual({
      msgtype: 'markdown',
      markdown: { title: '标题', text: '#### 标题' },
    });
  });

  it('errcode 不为 0 时抛错（签名不对、关键词不对、太快）', async () => {
    const { webhook } = await fakeDingtalk({ errcode: 310000, errmsg: 'sign not match' });
    await expect(
      sendRobotMessage({ webhook, secret: SECRET }, { title: 't', markdown: 'm' }),
    ).rejects.toThrow('钉钉群机器人返回 310000：sign not match');
  });
});
