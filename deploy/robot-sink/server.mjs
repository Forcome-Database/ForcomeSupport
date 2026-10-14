// 钉钉群机器人的接收替身（待办 28，只用于开发测试环境的告警演练；docs/运维手册.md 第 6 节）。
// 照钉钉自定义机器人的接口：POST /robot/send?access_token=…[&timestamp=…&sign=…]，JSON 体 { msgtype, markdown | text }；
// 设了 DINGTALK_ROBOT_SECRET 时按钉钉的加签规则核对（HmacSHA256(timestamp + "\n" + 密钥) 的 Base64，时间戳与现在相差 1 小时以内），
// 对不上返回 errcode 310000（同钉钉），对上返回 { errcode: 0, errmsg: 'ok' }。收到的每条消息打一行 JSON 日志，GET /messages 取回全部。
// 为什么自己写：现成的回显服务不返回钉钉的 errcode、也不核对加签，用它演练不出「签名对不对」。
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const secret = process.env.DINGTALK_ROBOT_SECRET || null;
const port = Number(process.env.PORT || 8080);
const messages = [];

function signatureValid(timestamp, sign) {
  if (!secret) return null;
  if (!timestamp || !sign) return false;
  if (Math.abs(Date.now() - Number(timestamp)) > 60 * 60 * 1000) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest();
  const given = Buffer.from(sign, 'base64');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function reply(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://robot-sink');
  if (req.method === 'GET' && url.pathname === '/messages') {
    reply(res, 200, messages);
    return;
  }
  if (req.method !== 'POST' || url.pathname !== '/robot/send') {
    reply(res, 404, { errcode: 404, errmsg: 'not found' });
    return;
  }
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      reply(res, 200, { errcode: 300001, errmsg: 'invalid json' });
      return;
    }
    const valid = signatureValid(url.searchParams.get('timestamp'), url.searchParams.get('sign'));
    const message = {
      receivedAt: new Date().toISOString(),
      accessToken: url.searchParams.get('access_token'),
      signatureValid: valid,
      msgtype: body.msgtype,
      title: body.markdown?.title ?? null,
      text: body.markdown?.text ?? body.text?.content ?? null,
    };
    console.log(JSON.stringify(message));
    if (valid === false) {
      reply(res, 200, { errcode: 310000, errmsg: 'sign not match' });
      return;
    }
    messages.push(message);
    reply(res, 200, { errcode: 0, errmsg: 'ok' });
  });
}).listen(port, () => {
  console.log(
    `钉钉群机器人的接收替身在 ${port} 端口，${secret ? '核对加签' : '不核对加签（没设 DINGTALK_ROBOT_SECRET）'}`,
  );
});
