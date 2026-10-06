import { WebSocket } from 'undici';
import { z } from 'zod';
import type { DingtalkCredentials } from '../core';
import type { DingtalkEvent } from './dingtalk';
import { ConnectionLostError, ExternalCallFailedError } from './faults';
import { outboundDispatcher, type HttpClient } from './http';

/*
 * 钉钉 Stream 长连接（规格 org「钉钉 Stream 通讯录事件」、ADR 0003：只出站，不开回调地址）。协议：
 * 1. POST api.dingtalk.com/v1.0/gateway/connections/open（Client ID、Client Secret、订阅 EVENT *）拿到 endpoint 与 ticket；
 * 2. 连 WebSocket `endpoint?ticket=…`（undici 的 WebSocket，经进程共用的出站连接，钉钉在 NO_PROXY 里直连）；
 * 3. 收到 SYSTEM ping 原样回应、SYSTEM disconnect 断开重连；EVENT 先放进缓冲，worker 的常驻拉取取走、转成后台任务后
 *    再按 messageId 回执——没回执的钉钉稍后重推，所以进程在中途退出也不丢（处理是幂等的，重推无害）。
 * 没用官方 Node SDK（dingtalk-stream）：它在回调里同步回执（不能等转成任务后再确认）、连接失败只在内部重试不报给调用方
 * （连接状态与退避要由常驻拉取掌握）、日志直接写 console、WebSocket 不经代理分流；协议本身只有上面几步。
 */

const GATEWAY = 'https://api.dingtalk.com/v1.0/gateway/connections/open';
/** 多久没收到任何消息就当连接已静默断开、重连（钉钉会定期发 ping；只防网络静默掉线，免得频繁重连占配额） */
const SILENT_TIMEOUT_MS = 30 * 60_000;

export interface DingtalkStream {
  /** 取缓冲里的事件；没有就最多等 waitSeconds 秒。没连上时先连；连不上或已断开且没有事件时抛 ConnectionLostError 等 */
  pull(options: { readonly waitSeconds: number }): Promise<DingtalkEvent[]>;
  /** 回执已处理的事件（连接已断开时不发，钉钉会在新连接上重推） */
  acknowledge(messageIds: readonly string[]): Promise<void>;
  /** 断开（下次 pull 重新连） */
  close(): Promise<void>;
}

// ---------------------------------------------------------------- 一帧的解析（纯函数）

const frameSchema = z.looseObject({
  type: z.string(),
  headers: z.looseObject({
    messageId: z.string(),
    topic: z.string().optional(),
    eventType: z.string().optional(),
    eventId: z.string().optional(),
  }),
  data: z.string().optional(),
});

/** 事件内容里的成员与部门（文档的写法是 userId、deptId 数组；旧版回调首字母大写，一并认） */
const eventDataSchema = z.looseObject({
  userId: z.array(z.union([z.string(), z.number()])).optional(),
  UserId: z.array(z.union([z.string(), z.number()])).optional(),
  deptId: z.array(z.union([z.string(), z.number()])).optional(),
  DeptId: z.array(z.union([z.string(), z.number()])).optional(),
});

export type StreamFrame =
  /** 通讯录事件：放进缓冲，处理后回执 */
  | { readonly kind: 'event'; readonly event: DingtalkEvent }
  /** 要原样回应的系统消息（ping） */
  | { readonly kind: 'reply'; readonly text: string }
  /** 服务端要断开：主动断开重连 */
  | { readonly kind: 'disconnect' }
  /** 不用处理（连接成功、注册成功等） */
  | { readonly kind: 'ignore' };

function idsOf(values: readonly (string | number)[] | undefined): string[] {
  return (values ?? []).map(String);
}

/** 解析 Stream 推来的一帧；认不出的忽略（不让一帧坏数据把连接搞断） */
export function parseStreamFrame(text: string): StreamFrame {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: 'ignore' };
  }
  const frame = frameSchema.safeParse(json);
  if (!frame.success) return { kind: 'ignore' };
  const { type, headers, data } = frame.data;
  if (type === 'SYSTEM') {
    if (headers.topic === 'ping') {
      return {
        kind: 'reply',
        text: JSON.stringify({ code: 200, headers, message: 'OK', data: data ?? '' }),
      };
    }
    return headers.topic === 'disconnect' ? { kind: 'disconnect' } : { kind: 'ignore' };
  }
  if (type !== 'EVENT' || !headers.eventType) return { kind: 'ignore' };
  let content: z.infer<typeof eventDataSchema> = {};
  try {
    const parsed = eventDataSchema.safeParse(JSON.parse(data ?? '{}'));
    if (parsed.success) content = parsed.data;
  } catch {
    // 内容不是 JSON：只知道事件类型，处理时按类型做（全量对账兜底）
  }
  return {
    kind: 'event',
    event: {
      messageId: headers.messageId,
      type: headers.eventType,
      eventId: headers.eventId ?? null,
      userIds: idsOf(content.userId ?? content.UserId),
      departmentIds: idsOf(content.deptId ?? content.DeptId),
    },
  };
}

/** 事件的回执：处理成功（钉钉不再重推） */
export function ackFrame(messageId: string): string {
  return JSON.stringify({
    code: 200,
    headers: { contentType: 'application/json', messageId },
    message: 'OK',
    data: JSON.stringify({ status: 'SUCCESS', message: 'success' }),
  });
}

// ---------------------------------------------------------------- 连接

const endpointSchema = z.object({ endpoint: z.string().min(1), ticket: z.string().min(1) });

export function createDingtalkStream(
  http: HttpClient,
  credentials: DingtalkCredentials,
): DingtalkStream {
  let socket: WebSocket | null = null;
  let lastFrameAt = 0;
  const buffer: DingtalkEvent[] = [];
  let wake: (() => void) | null = null;

  function lost(): ConnectionLostError {
    return new ConnectionLostError('dingtalk', 'stream');
  }

  function drop(target: WebSocket): void {
    if (socket !== target) return;
    socket = null;
    wake?.();
  }

  async function open(): Promise<WebSocket> {
    const body = await http.postJson(
      GATEWAY,
      {
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        subscriptions: [{ type: 'EVENT', topic: '*' }],
        ua: 'forcome-support',
        localIp: '',
      },
      { operation: 'gateway/connections/open' },
    );
    const parsed = endpointSchema.safeParse(body);
    if (!parsed.success) {
      throw new ExternalCallFailedError('dingtalk', 'gateway/connections/open', {
        message: '返回内容不认识：没有 endpoint 或 ticket',
        retryable: false,
      });
    }
    const url = `${parsed.data.endpoint}?ticket=${encodeURIComponent(parsed.data.ticket)}`;
    const ws = new WebSocket(url, { dispatcher: outboundDispatcher() });
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(lost());
      ws.onclose = () => reject(lost());
    });
    lastFrameAt = Date.now();
    ws.onmessage = (message: MessageEvent) => {
      lastFrameAt = Date.now();
      const frame = parseStreamFrame(String(message.data));
      switch (frame.kind) {
        case 'event':
          buffer.push(frame.event);
          wake?.();
          break;
        case 'reply':
          ws.send(frame.text);
          break;
        case 'disconnect':
          ws.close();
          drop(ws);
          break;
        case 'ignore':
          break;
      }
    };
    ws.onerror = () => drop(ws);
    ws.onclose = () => drop(ws);
    return ws;
  }

  function waitForEvent(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      wake = done;
      function done() {
        clearTimeout(timer);
        wake = null;
        resolve();
      }
    });
  }

  return {
    async pull({ waitSeconds }) {
      if (socket && Date.now() - lastFrameAt > SILENT_TIMEOUT_MS) {
        socket.close();
        socket = null;
      }
      socket ??= await open();
      if (buffer.length === 0 && waitSeconds > 0) await waitForEvent(waitSeconds * 1000);
      if (buffer.length === 0 && !socket) throw lost();
      return buffer.splice(0);
    },
    acknowledge(messageIds) {
      if (socket?.readyState === WebSocket.OPEN) {
        for (const id of messageIds) socket.send(ackFrame(id));
      }
      return Promise.resolve();
    },
    close() {
      const current = socket;
      socket = null;
      current?.close();
      wake?.();
      return Promise.resolve();
    },
  };
}
