import { z } from 'zod';
import type { GoogleCredentials } from '../core';
import type { RealClientContext } from './definition';
import { CursorExpiredError, ExternalCallFailedError, ExternalTimeoutError } from './faults';
import type { GmailClient, GmailNotification, GmailPushClient, GmailRawMessage } from './gmail';
import { createGoogleTokens, type GoogleTokens } from './google-auth';
import { createHttpClient, type HttpClient, type RateLimit } from './http';

/*
 * Gmail 与 Pub/Sub 的真实现（规格 channel「Gmail 客户端」、ADR 0008、0009 修订，待办 09）：
 * - 邮箱：服务账号 + 全域委派，以邮箱本人的身份调 Gmail REST 接口（只读权限 gmail.readonly，watch 也够用）；
 *   watch 不按标签过滤（收件箱与「已发送」都推送），推到 GMAIL_PUBSUB_TOPIC；
 * - 推送：Pub/Sub REST 的一元 pull（StreamingPull 是 gRPC，经 HTTP 代理不一定通，ADR 0008 已定退回一元 Pull）；
 *   长轮询到点没有通知时 Google 返回空或连接超时，都当作「这次没有」；
 * - 都经出站 HTTP 客户端工厂：代理分流、调用时限、按接口限流（Gmail 每个接口每秒 20 次，远低于每个邮箱每秒 250 配额单位）、
 *   每次调用一条调用记录；HTTP 错误翻译成 faults.ts 的那一套：history.list 404 为游标过期，其余照工厂的规则。
 * 真实环境的验收（服务账号授权、推送到达、游标过期补拉）随待办 29 的验收矩阵；这里的单元测试用 undici MockAgent 回放。
 */

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users';
const PUBSUB = 'https://pubsub.googleapis.com/v1';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const PUBSUB_SCOPE = 'https://www.googleapis.com/auth/pubsub';
/** Gmail 每个接口每秒最多几次（整个进程、所有邮箱合计） */
const GMAIL_RATE_LIMITS: Readonly<Record<string, RateLimit>> = { '*': { perSecond: 20 } };
/** history.list 与 messages.list 每页最多几条 */
const PAGE_SIZE = 500;
/** 一元 pull 比长轮询多等这么久才算超时 */
const PULL_GRACE_MS = 15_000;

const watchSchema = z.object({ historyId: z.coerce.string(), expiration: z.coerce.number() });
const profileSchema = z.object({ historyId: z.coerce.string() });
const historySchema = z.object({
  history: z
    .array(
      z.object({
        messagesAdded: z.array(z.object({ message: z.object({ id: z.string() }) })).optional(),
      }),
    )
    .optional(),
  historyId: z.coerce.string(),
  nextPageToken: z.string().optional(),
});
const messageListSchema = z.object({
  messages: z.array(z.object({ id: z.string() })).optional(),
  nextPageToken: z.string().optional(),
});
const rawMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).optional(),
  internalDate: z.coerce.number(),
  raw: z.string(),
});
const pullSchema = z.object({
  receivedMessages: z
    .array(z.object({ ackId: z.string(), message: z.object({ data: z.string().optional() }) }))
    .optional(),
});
const notificationSchema = z.object({ emailAddress: z.string(), historyId: z.coerce.string() });

function parse<T extends z.ZodType>(
  system: string,
  operation: string,
  schema: T,
  value: unknown,
): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ExternalCallFailedError(system, operation, {
      message: '返回的内容与接口约定不符',
      retryable: false,
    });
  }
  return parsed.data;
}

function notConfigured(system: string, operation: string): ExternalCallFailedError {
  return new ExternalCallFailedError(system, operation, {
    message:
      '没有配置 Google 服务账号与 Pub/Sub（GOOGLE_SERVICE_ACCOUNT_KEY_FILE 等，docs/部署说明.md 第 12 节）',
    retryable: false,
  });
}

const isStatus = (error: unknown, status: number) =>
  error instanceof ExternalCallFailedError && error.status === status;

/** 带访问令牌调用；接口拒绝令牌（401）时换新令牌再试一次（换令牌本身失败不再试，照常抛出） */
async function authorized<T>(
  tokens: GoogleTokens,
  scope: string,
  subject: string | undefined,
  call: (headers: Record<string, string>) => Promise<T>,
): Promise<T> {
  const token = await tokens.get(scope, subject);
  try {
    return await call({ authorization: `Bearer ${token}` });
  } catch (error) {
    if (!isStatus(error, 401)) throw error;
    tokens.forget(scope, subject);
    return call({ authorization: `Bearer ${await tokens.get(scope, subject)}` });
  }
}

/** base64url 解码成字节（Gmail 的 raw） */
function decodeRaw(raw: string): Uint8Array {
  return new Uint8Array(Buffer.from(raw, 'base64url'));
}

/** Gmail 邮箱的真实现（可测：http 与令牌从外面给） */
export function createRealGmailClient(
  http: HttpClient,
  tokens: GoogleTokens,
  topicName: string,
): GmailClient {
  const user = (mailbox: string) => `${GMAIL}/${encodeURIComponent(mailbox)}`;
  const get = (mailbox: string, url: string, operation: string) =>
    authorized(tokens, GMAIL_SCOPE, mailbox, (headers) =>
      http.getJson(url, { operation, headers }),
    );

  return {
    async watch(mailbox) {
      const operation = 'users.watch';
      const body = await authorized(tokens, GMAIL_SCOPE, mailbox, (headers) =>
        // 不写 labelIds：不按标签过滤，收件箱与「已发送」的变化都推送（ADR 0008）
        http.postJson(`${user(mailbox)}/watch`, { topicName }, { operation, headers }),
      );
      const watch = parse('gmail', operation, watchSchema, body);
      return { historyId: watch.historyId, expiration: new Date(watch.expiration) };
    },
    async profile(mailbox) {
      const operation = 'users.getProfile';
      return parse(
        'gmail',
        operation,
        profileSchema,
        await get(mailbox, `${user(mailbox)}/profile`, operation),
      );
    },
    async listHistory(mailbox, startHistoryId) {
      const operation = 'users.history.list';
      const messageIds: string[] = [];
      let historyId: string;
      let pageToken: string | undefined;
      do {
        const query = new URLSearchParams({
          startHistoryId,
          historyTypes: 'messageAdded',
          maxResults: String(PAGE_SIZE),
          ...(pageToken ? { pageToken } : {}),
        });
        let body: unknown;
        try {
          body = await get(mailbox, `${user(mailbox)}/history?${query.toString()}`, operation);
        } catch (error) {
          // 游标太旧（Gmail 只保留约一周的 history）：调用方改按 internalDate 区间补拉
          if (isStatus(error, 404)) throw new CursorExpiredError('gmail', operation);
          throw error;
        }
        const page = parse('gmail', operation, historySchema, body);
        for (const entry of page.history ?? []) {
          for (const added of entry.messagesAdded ?? []) messageIds.push(added.message.id);
        }
        historyId = page.historyId;
        pageToken = page.nextPageToken;
      } while (pageToken);
      return { messageIds, historyId };
    },
    async listMessages(mailbox, { after }) {
      const operation = 'users.messages.list';
      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        const query = new URLSearchParams({
          q: `after:${Math.floor(after.getTime() / 1000)}`,
          maxResults: String(PAGE_SIZE),
          ...(pageToken ? { pageToken } : {}),
        });
        const page = parse(
          'gmail',
          operation,
          messageListSchema,
          await get(mailbox, `${user(mailbox)}/messages?${query.toString()}`, operation),
        );
        for (const message of page.messages ?? []) ids.push(message.id);
        pageToken = page.nextPageToken;
      } while (pageToken);
      return ids;
    },
    async getMessage(mailbox, messageId): Promise<GmailRawMessage> {
      const operation = 'users.messages.get';
      const message = parse(
        'gmail',
        operation,
        rawMessageSchema,
        await get(
          mailbox,
          `${user(mailbox)}/messages/${encodeURIComponent(messageId)}?format=raw`,
          operation,
        ),
      );
      return {
        id: message.id,
        threadId: message.threadId,
        labelIds: message.labelIds ?? [],
        internalDate: new Date(message.internalDate),
        raw: decodeRaw(message.raw),
      };
    },
  };
}

/** Pub/Sub 消息的 data（{emailAddress, historyId} 的 JSON）；认不出为 null */
function parseNotification(data: string): z.infer<typeof notificationSchema> | null {
  try {
    const parsed = notificationSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Pub/Sub 推送的真实现（可测：http 与令牌从外面给） */
export function createRealGmailPushClient(
  http: HttpClient,
  tokens: GoogleTokens,
  subscription: string,
): GmailPushClient {
  return {
    async pull({ maxMessages, waitSeconds }) {
      const operation = 'subscriptions.pull';
      let body: unknown;
      try {
        body = await authorized(tokens, PUBSUB_SCOPE, undefined, (headers) =>
          http.postJson(
            `${PUBSUB}/${subscription}:pull`,
            // 0 秒为有就拿、没有立即返回（测试与「跑完任务」）；否则等到有通知或 Google 的长轮询到点
            { maxMessages, ...(waitSeconds === 0 ? { returnImmediately: true } : {}) },
            { operation, headers, timeoutMs: waitSeconds * 1000 + PULL_GRACE_MS },
          ),
        );
      } catch (error) {
        // 长轮询一直没等到通知：这次没有（兜底有每 5 分钟的 history.list）
        if (error instanceof ExternalTimeoutError) return [];
        throw error;
      }
      const notifications: GmailNotification[] = [];
      for (const received of parse('gmail_push', operation, pullSchema, body).receivedMessages ??
        []) {
        const data = received.message.data
          ? Buffer.from(received.message.data, 'base64').toString('utf8')
          : '';
        const notification = parseNotification(data);
        // 认不出的消息照样交给调用方确认（mailbox 为空串，会被当作「不是登记的进线邮箱」忽略），免得反复重投
        notifications.push({
          ackId: received.ackId,
          mailbox: notification?.emailAddress.toLowerCase() ?? '',
          historyId: notification?.historyId ?? '',
        });
      }
      return notifications;
    },
    async acknowledge(ackIds) {
      if (ackIds.length === 0) return;
      await authorized(tokens, PUBSUB_SCOPE, undefined, (headers) =>
        http.postJson(
          `${PUBSUB}/${subscription}:acknowledge`,
          { ackIds },
          { operation: 'subscriptions.acknowledge', headers },
        ),
      );
    },
  };
}

function withCredentials<C>(
  system: string,
  credentials: GoogleCredentials | null,
  create: (credentials: GoogleCredentials) => C,
  operations: readonly (keyof C)[],
): C {
  if (credentials) return create(credentials);
  // 没配置：每个操作都以「未配置」失败（不可重试），P18 据此显示连接异常
  return Object.fromEntries(
    operations.map((operation) => [
      operation,
      () => Promise.reject(notConfigured(system, String(operation))),
    ]),
  ) as C;
}

/** gmailClient 的 createReal：店铺级，按店铺每次新建（令牌缓存在进程级的 tokenCaches 里） */
export function createRealGmail(context: RealClientContext): GmailClient {
  return withCredentials(
    'gmail',
    context.google,
    (credentials) => {
      const http = createHttpClient('gmail', {
        recorder: context.callRecorder,
        storeId: context.storeId,
        rateLimits: GMAIL_RATE_LIMITS,
      });
      return createRealGmailClient(http, tokensFor(credentials, context), credentials.pubsubTopic);
    },
    ['watch', 'profile', 'listHistory', 'listMessages', 'getMessage'],
  );
}

/** gmailPushClient 的 createReal：全局，一个进程只建一次 */
export function createRealGmailPush(context: RealClientContext): GmailPushClient {
  return withCredentials(
    'gmail_push',
    context.google,
    (credentials) =>
      createRealGmailPushClient(
        createHttpClient('gmail_push', { recorder: context.callRecorder }),
        tokensFor(credentials, context),
        credentials.pubsubSubscription,
      ),
    ['pull', 'acknowledge'],
  );
}

/** 令牌缓存按服务账号共用：店铺级的 Gmail 客户端每次新建，令牌不能跟着丢 */
const tokenCaches = new Map<string, GoogleTokens>();

function tokensFor(credentials: GoogleCredentials, context: RealClientContext): GoogleTokens {
  let tokens = tokenCaches.get(credentials.clientEmail);
  if (!tokens) {
    tokens = createGoogleTokens(
      createHttpClient('google_oauth', { recorder: context.callRecorder }),
      credentials,
    );
    tokenCaches.set(credentials.clientEmail, tokens);
  }
  return tokens;
}
