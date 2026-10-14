// 宿主机检查发钉钉群机器人消息（待办 28）：部署脚本只依赖 Node 自带的模块，不引用应用代码，所以这里按钉钉自定义机器人的文档
// 另写一份加签与发送（应用里的是 apps/server/src/modules/integration/dingtalk-robot.ts，两边的加签由 dingtalk-robot.test.mjs 对照）。
// 钉钉是境内服务，直连（Node 的 fetch 不读代理变量）。
import { createHmac } from 'node:crypto';

/** 加签：timestamp + "\n" + 密钥，HmacSHA256 后 Base64 */
export function robotSign(timestamp, secret) {
  return createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64');
}

/** 发送用的地址：Webhook，加签时另带 timestamp（毫秒）与 sign（URL 编码） */
export function robotUrl(webhook, secret, now) {
  if (!secret) return webhook;
  const url = new URL(webhook);
  const timestamp = String(now.getTime());
  url.searchParams.set('timestamp', timestamp);
  url.searchParams.set('sign', robotSign(timestamp, secret));
  return url.toString();
}

/**
 * 发一条 markdown 消息；HTTP 不是 200 或 errcode 不为 0 时抛错
 * @param {{ webhook: string, secret: string | null }} robot
 * @param {{ title: string, markdown: string }} message
 * @param {{ now?: Date, fetchImpl?: typeof fetch }} [options]
 */
export async function sendRobotMessage(robot, message, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(robotUrl(robot.webhook, robot.secret, options.now ?? new Date()), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: { title: message.title, text: message.markdown },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // 下面按「返回内容不认识」处理
  }
  if (!res.ok || typeof body?.errcode !== 'number') {
    throw new Error(`钉钉群机器人返回 ${res.status}：${text.slice(0, 200)}`);
  }
  if (body.errcode !== 0) {
    throw new Error(`钉钉群机器人返回 ${body.errcode}：${body.errmsg ?? ''}`);
  }
}
