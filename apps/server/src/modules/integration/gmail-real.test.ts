import { generateKeyPairSync } from 'node:crypto';
import { decodeJwt } from 'jose';
import { MockAgent } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { systemClock, type GoogleCredentials } from '../core';
import type { CallRecordEntry, CallRecorder } from './call-records';
import { ClientNotConfiguredError, CursorExpiredError, ExternalCallFailedError } from './faults';
import { createRealGmail, createRealGmailClient, createRealGmailPushClient } from './gmail-real';
import { createGoogleTokens } from './google-auth';
import { createHttpClient } from './http';
import { MailRecipientGuard } from './mail-recipient-guard';

/*
 * Gmail 与 Pub/Sub 的真实现（待办 09）：服务账号令牌（全域委派的 sub、缓存、被拒后换新）、Gmail REST 各接口（watch 不按标签过滤、
 * history.list 分页与 404 游标过期、按 internalDate 区间列消息、format=raw 原文）、Pub/Sub 一元 pull 与确认，以及每次调用的调用记录。
 * 不连外网：undici 的 MockAgent 按 URL 回放照 Google 文档写的返回，没登记的请求直接失败。
 */

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const CREDENTIALS: GoogleCredentials = {
  clientEmail: 'forcome-support@forcome-mail.iam.gserviceaccount.com',
  privateKey,
  tokenUri: 'https://oauth2.googleapis.com/token',
  pubsubTopic: 'projects/forcome-mail/topics/gmail',
  pubsubSubscription: 'projects/forcome-mail/subscriptions/gmail-staging',
};
const MAILBOX = 'support@forcome.mx';
const USER = `/gmail/v1/users/${encodeURIComponent(MAILBOX)}`;

let agent: MockAgent;
let records: CallRecordEntry[];
const recorder: CallRecorder = {
  record: (entry) => {
    records.push(entry);
    return Promise.resolve();
  },
};
/** 换令牌时提交的 JWT（按先后） */
let assertions: ReturnType<typeof decodeJwt>[];

function tokens() {
  return createGoogleTokens(
    createHttpClient('google_oauth', { dispatcher: agent, recorder }),
    CREDENTIALS,
  );
}

function gmail(sharedTokens = tokens()) {
  return createRealGmailClient(
    createHttpClient('gmail', { dispatcher: agent, recorder, storeId: 'store-mx' }),
    sharedTokens,
    CREDENTIALS.pubsubTopic,
  );
}

/** 换一次令牌（记下提交的 JWT） */
function tokenExchange(accessToken = 'token-1') {
  agent
    .get('https://oauth2.googleapis.com')
    .intercept({ path: '/token', method: 'POST' })
    .reply(200, (options) => {
      const form = new URLSearchParams(typeof options.body === 'string' ? options.body : '');
      expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
      assertions.push(decodeJwt(form.get('assertion') ?? ''));
      return { access_token: accessToken, expires_in: 3600, token_type: 'Bearer' };
    });
}

const googleapis = () => agent.get('https://gmail.googleapis.com');

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  records = [];
  assertions = [];
});

afterEach(async () => {
  await agent.close();
});

describe('服务账号令牌', () => {
  it('以邮箱身份（sub）换只读令牌，带在 Authorization 里；同一邮箱的令牌缓存，换邮箱另换', async () => {
    tokenExchange('token-mx');
    googleapis()
      .intercept({
        path: `${USER}/profile`,
        headers: { authorization: 'Bearer token-mx' },
      })
      .reply(200, { emailAddress: MAILBOX, historyId: '1234' })
      .times(2);
    const shared = tokens();
    const client = gmail(shared);
    await expect(client.profile(MAILBOX)).resolves.toEqual({ historyId: '1234' });
    await expect(client.profile(MAILBOX)).resolves.toEqual({ historyId: '1234' });
    expect(assertions).toHaveLength(1);
    expect(assertions[0]).toMatchObject({
      iss: CREDENTIALS.clientEmail,
      sub: MAILBOX,
      aud: CREDENTIALS.tokenUri,
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
    });

    tokenExchange('token-com');
    googleapis()
      .intercept({
        path: `/gmail/v1/users/${encodeURIComponent('support@forcome.com')}/profile`,
        headers: { authorization: 'Bearer token-com' },
      })
      .reply(200, { emailAddress: 'support@forcome.com', historyId: '99' });
    await gmail(shared).profile('support@forcome.com');
    expect(assertions.map((a) => a.sub)).toEqual([MAILBOX, 'support@forcome.com']);
  });

  it('令牌被拒（401）时换新令牌再试一次', async () => {
    tokenExchange('stale');
    tokenExchange('fresh');
    googleapis()
      .intercept({ path: `${USER}/profile`, headers: { authorization: 'Bearer stale' } })
      .reply(401, { error: { code: 401, message: 'Invalid Credentials' } });
    googleapis()
      .intercept({ path: `${USER}/profile`, headers: { authorization: 'Bearer fresh' } })
      .reply(200, { historyId: '7' });
    await expect(gmail().profile(MAILBOX)).resolves.toEqual({ historyId: '7' });
  });

  it('全域委派没授权（换令牌 401 unauthorized_client）是不可重试的调用失败', async () => {
    agent
      .get('https://oauth2.googleapis.com')
      .intercept({ path: '/token', method: 'POST' })
      .reply(401, { error: 'unauthorized_client' });
    const failure = await gmail()
      .profile(MAILBOX)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ExternalCallFailedError);
    expect(failure).toMatchObject({ status: 401, retryable: false });
  });
});

describe('Gmail 接口', () => {
  it('watch 不按标签过滤（不写 labelIds），推到配置的主题', async () => {
    tokenExchange();
    googleapis()
      .intercept({
        path: `${USER}/watch`,
        method: 'POST',
        body: JSON.stringify({ topicName: CREDENTIALS.pubsubTopic }),
      })
      .reply(200, { historyId: '5000', expiration: '1789000000000' });
    await expect(gmail().watch(MAILBOX)).resolves.toEqual({
      historyId: '5000',
      expiration: new Date(1_789_000_000_000),
    });
  });

  it('history.list 取完全部分页，只要新到的消息；返回最后的 historyId', async () => {
    tokenExchange();
    googleapis()
      .intercept({
        path: `${USER}/history?startHistoryId=100&historyTypes=messageAdded&maxResults=500`,
      })
      .reply(200, {
        history: [{ messagesAdded: [{ message: { id: 'm1', threadId: 't1' } }] }, { id: '101' }],
        historyId: '105',
        nextPageToken: 'p2',
      });
    googleapis()
      .intercept({
        path: `${USER}/history?startHistoryId=100&historyTypes=messageAdded&maxResults=500&pageToken=p2`,
      })
      .reply(200, {
        history: [{ messagesAdded: [{ message: { id: 'm2', threadId: 't2' } }] }],
        historyId: '110',
      });
    await expect(gmail().listHistory(MAILBOX, '100')).resolves.toEqual({
      messageIds: ['m1', 'm2'],
      historyId: '110',
    });
  });

  it('history.list 返回 404（游标过期）抛 CursorExpiredError', async () => {
    tokenExchange();
    googleapis()
      .intercept({ path: /\/history\?/ })
      .reply(404, { error: { code: 404, message: 'Requested entity was not found.' } });
    await expect(gmail().listHistory(MAILBOX, '1')).rejects.toBeInstanceOf(CursorExpiredError);
  });

  it('区间补拉按 internalDate（q=after:<秒>）列出全部分页的消息', async () => {
    tokenExchange();
    const after = new Date('2026-09-11T02:00:00Z');
    const q = encodeURIComponent(`after:${after.getTime() / 1000}`).replace(/%20/g, '+');
    googleapis()
      .intercept({ path: `${USER}/messages?q=${q}&maxResults=500` })
      .reply(200, { messages: [{ id: 'a' }, { id: 'b' }], nextPageToken: 'n' });
    googleapis()
      .intercept({ path: `${USER}/messages?q=${q}&maxResults=500&pageToken=n` })
      .reply(200, { messages: [{ id: 'c' }], resultSizeEstimate: 1 });
    await expect(gmail().listMessages(MAILBOX, { after })).resolves.toEqual(['a', 'b', 'c']);
  });

  it('messages.get 取 format=raw 原文：base64url 解码、标签与 internalDate', async () => {
    tokenExchange();
    const raw = 'Subject: Hi\r\n\r\nHello ✓';
    googleapis()
      .intercept({ path: `${USER}/messages/m1?format=raw` })
      .reply(200, {
        id: 'm1',
        threadId: 't1',
        labelIds: ['SENT'],
        internalDate: '1789000000000',
        raw: Buffer.from(raw, 'utf8').toString('base64url'),
      });
    const message = await gmail().getMessage(MAILBOX, 'm1');
    expect(message).toMatchObject({
      id: 'm1',
      threadId: 't1',
      labelIds: ['SENT'],
      internalDate: new Date(1_789_000_000_000),
    });
    expect(new TextDecoder().decode(message.raw)).toBe(raw);
  });

  it('每次调用写一条调用记录：系统、动作、店铺、状态码、请求（含查询参数）与响应摘要；失败也记', async () => {
    tokenExchange();
    googleapis()
      .intercept({ path: /\/history\?/ })
      .reply(404, { error: { code: 404, message: 'Requested entity was not found.' } });
    await gmail()
      .listHistory(MAILBOX, '1')
      .catch(() => undefined);
    expect(records.map((r) => [r.system, r.operation, r.outcome, r.status])).toEqual([
      ['google_oauth', 'oauth2.token', 'ok', 200],
      ['gmail', 'users.history.list', 'failed', 404],
    ]);
    const [token, history] = records;
    expect(token?.response).not.toContain('token-1');
    expect(history).toMatchObject({
      storeId: 'store-mx',
      request: `GET https://gmail.googleapis.com${USER}/history?startHistoryId=1&historyTypes=messageAdded&maxResults=500`,
    });
    expect(history?.response).toContain('Requested entity was not found.');
    expect(history?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('没有配置 Google 凭据时每个操作都以「没有配置」失败（不可重试），不会退回 Fake', async () => {
    const client = createRealGmail({
      storeId: 'store-mx',
      google: null,
      dingtalk: null,
      callRecorder: recorder,
      mailRecipientGuard: new MailRecipientGuard({ allowlistOnly: true, allowlist: [] }),
      shopify: null,
      credentialVault: null,
      clock: systemClock,
    });
    const failure = await client.watch(MAILBOX).catch((error: unknown) => error);
    // 不是连接故障而是还没接通：收信不把它算进连续失败（P18 为「未连接」）
    expect(failure).toBeInstanceOf(ClientNotConfiguredError);
    expect(failure).toMatchObject({ retryable: false });
    expect((failure as Error).message).toContain('GOOGLE_SERVICE_ACCOUNT_KEY_FILE');
  });
});

describe('Pub/Sub 推送', () => {
  const pubsub = () => agent.get('https://pubsub.googleapis.com');
  const push = () =>
    createRealGmailPushClient(
      createHttpClient('gmail_push', { dispatcher: agent, recorder }),
      tokens(),
      CREDENTIALS.pubsubSubscription,
    );

  it('一元 pull 取通知（data 是 base64 的 {emailAddress, historyId}），以服务账号本身换 pubsub 令牌；确认按 ackId', async () => {
    tokenExchange('pubsub-token');
    const data = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64');
    pubsub()
      .intercept({
        path: `/v1/${CREDENTIALS.pubsubSubscription}:pull`,
        method: 'POST',
        headers: { authorization: 'Bearer pubsub-token' },
        body: JSON.stringify({ maxMessages: 100 }),
      })
      .reply(200, {
        receivedMessages: [
          {
            ackId: 'ack-1',
            message: { data: data({ emailAddress: 'Support@Forcome.MX', historyId: 9876 }) },
          },
          { ackId: 'ack-2', message: { data: Buffer.from('not json').toString('base64') } },
        ],
      });
    pubsub()
      .intercept({
        path: `/v1/${CREDENTIALS.pubsubSubscription}:acknowledge`,
        method: 'POST',
        body: JSON.stringify({ ackIds: ['ack-1', 'ack-2'] }),
      })
      .reply(200, {});
    const client = push();
    const notifications = await client.pull({ maxMessages: 100, waitSeconds: 20 });
    expect(notifications).toEqual([
      { ackId: 'ack-1', mailbox: 'support@forcome.mx', historyId: '9876' },
      // 认不出的消息照样交出去确认（邮箱为空，同步时当作不是登记的进线邮箱忽略），免得反复重投
      { ackId: 'ack-2', mailbox: '', historyId: '' },
    ]);
    expect(assertions[0]).toMatchObject({ scope: 'https://www.googleapis.com/auth/pubsub' });
    expect(assertions[0]?.sub).toBeUndefined();
    await client.acknowledge(notifications.map((n) => n.ackId));
  });

  it('不等待的拉取写 returnImmediately；没有通知时为空', async () => {
    tokenExchange();
    pubsub()
      .intercept({
        path: `/v1/${CREDENTIALS.pubsubSubscription}:pull`,
        method: 'POST',
        body: JSON.stringify({ maxMessages: 10, returnImmediately: true }),
      })
      .reply(200, {});
    await expect(push().pull({ maxMessages: 10, waitSeconds: 0 })).resolves.toEqual([]);
  });
});
