import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualClock } from '../core';
import type { CallRecordEntry } from './call-records';
import type { RealClientContext } from './definition';
import {
  ClientNotConfiguredError,
  CursorExpiredError,
  ExternalCallFailedError,
  ExternalTimeoutError,
  MailboxAccessError,
} from './faults';
import { imapMessageId } from './imap';
import { classifyImapError, createRealImap, findSentFolder, IMAP_CLIENT_INFO } from './imap-real';

/*
 * 163 企业邮箱 IMAP 真实现（imap-real.ts，待办 35）：本机没有网易账号，把 imapflow 换成替身，核对调用方式（TLS、ID 命令、只读 EXAMINE、
 * UID 取信与搜索、授权码从哪里来）、「已发送」的识别、UIDVALIDITY 变化与错误翻译。真实环境的核对点在待办 29。
 */

interface FakeMailbox {
  uidValidity: bigint;
  uidNext: number;
  messages: { uid: number; internalDate: Date; source: Buffer }[];
}

/** imapflow 的替身：记下构造参数与调用，按 folders / mailboxes 回答 */
const flow = {
  options: [] as Record<string, unknown>[],
  calls: [] as string[],
  folders: [] as { path: string; specialUse?: string }[],
  mailboxes: new Map<string, FakeMailbox>(),
  connectError: null as Error | null,
  listeners: new Map<string, ((...args: unknown[]) => void)[]>(),
};

vi.mock('imapflow', () => {
  class ImapFlow {
    constructor(options: Record<string, unknown>) {
      flow.options.push(options);
    }
    #open: FakeMailbox | null = null;
    on(event: string, listener: (...args: unknown[]) => void) {
      flow.listeners.set(event, [...(flow.listeners.get(event) ?? []), listener]);
      return this;
    }
    once(event: string, listener: (...args: unknown[]) => void) {
      return this.on(event, listener);
    }
    connect() {
      flow.calls.push('connect');
      return flow.connectError ? Promise.reject(flow.connectError) : Promise.resolve();
    }
    list() {
      flow.calls.push('list');
      return Promise.resolve(flow.folders.map((f) => ({ ...f, name: f.path })));
    }
    mailboxOpen(path: string, options: { readOnly?: boolean }) {
      flow.calls.push(`open:${path}:${options.readOnly ? 'readonly' : 'readwrite'}`);
      const box = flow.mailboxes.get(path);
      if (!box) {
        return Promise.reject(
          Object.assign(new Error('no such mailbox'), { mailboxMissing: true }),
        );
      }
      this.#open = box;
      return Promise.resolve({
        path,
        uidValidity: box.uidValidity,
        uidNext: box.uidNext,
        exists: box.messages.length,
      });
    }
    *fetch(range: string | number[], query: Record<string, boolean>, options: { uid?: boolean }) {
      flow.calls.push(
        `fetch:${Array.isArray(range) ? range.join(',') : range}:${options.uid ? 'uid' : 'seq'}`,
      );
      const messages = this.#open?.messages ?? [];
      const wanted = Array.isArray(range)
        ? messages.filter((m) => range.includes(m.uid))
        : (() => {
            const from = Number(range.split(':')[0]);
            const found = messages.filter((m) => m.uid >= from);
            // IMAP 的 n:* 在没有更大 UID 时也返回最后一封
            return found.length > 0 ? found : messages.slice(-1);
          })();
      for (const m of wanted) {
        yield {
          uid: m.uid,
          seq: m.uid,
          internalDate: m.internalDate,
          ...(query.source ? { source: m.source, size: m.source.length } : {}),
        };
      }
    }
    search(query: { since?: Date; before?: Date }, options: { uid?: boolean }) {
      flow.calls.push(`search:${options.uid ? 'uid' : 'seq'}`);
      return Promise.resolve(
        (this.#open?.messages ?? [])
          .filter(
            (m) =>
              (!query.since || m.internalDate >= query.since) &&
              (!query.before || m.internalDate < query.before),
          )
          .map((m) => m.uid),
      );
    }
    logout() {
      flow.calls.push('logout');
      return Promise.resolve();
    }
    close() {
      flow.calls.push('close');
    }
  }
  return { ImapFlow };
});

const ACCOUNT = { address: 'amz-auto@forcome.com', host: 'imap.qiye.163.com', port: 993 };
const raw = (text: string) => Buffer.from(`Subject: ${text}\r\n\r\n${text}\r\n`);

function context(overrides: Partial<RealClientContext> = {}) {
  const records: CallRecordEntry[] = [];
  const ctx = {
    storeId: '0199a0c0-0000-7000-8000-000000000002',
    mailRecipientGuard: {} as RealClientContext['mailRecipientGuard'],
    dingtalk: null,
    google: null,
    callRecorder: {
      record: (entry: CallRecordEntry) => {
        records.push(entry);
        return Promise.resolve();
      },
    },
    shopify: null,
    spApi: null,
    amazonSqs: null,
    credentialVault: {
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      readMailboxAuthCode: (address: string) =>
        Promise.resolve(address === ACCOUNT.address ? 'saved-auth-code' : null),
      writeMailboxAuthCode: () => Promise.resolve(),
    },
    clock: new ManualClock('2026-09-11T02:20:00Z'),
    dingtalkRobot: null,
    ...overrides,
  } satisfies RealClientContext;
  return { ctx, records };
}

beforeEach(() => {
  flow.options = [];
  flow.calls = [];
  flow.connectError = null;
  flow.listeners = new Map();
  flow.folders = [
    { path: 'INBOX', specialUse: '\\Inbox' },
    { path: '已发送', specialUse: '\\Sent' },
    { path: '草稿箱', specialUse: '\\Drafts' },
  ];
  flow.mailboxes = new Map([
    [
      'INBOX',
      {
        uidValidity: 1_700_000_001n,
        uidNext: 4,
        messages: [1, 2, 3].map((uid) => ({
          uid,
          internalDate: new Date(Date.UTC(2026, 8, 9 + uid, 2)),
          source: raw(`inbox ${uid}`),
        })),
      },
    ],
    ['已发送', { uidValidity: 1_700_000_002n, uidNext: 1, messages: [] }],
  ]);
});

describe('163 企业邮箱 IMAP 的真实现（imapflow）', () => {
  it('登录：TLS 直连服务器与端口，登录名为邮箱地址、口令为已保存的客户端授权码，先发 IMAP ID；不配代理', async () => {
    const { ctx } = context();
    const session = await createRealImap(ctx).connect(ACCOUNT);
    expect(flow.options[0]).toMatchObject({
      host: 'imap.qiye.163.com',
      port: 993,
      secure: true,
      auth: { user: 'amz-auto@forcome.com', pass: 'saved-auth-code' },
      clientInfo: IMAP_CLIENT_INFO,
      disableAutoIdle: true,
      logger: false,
    });
    expect(flow.options[0]).not.toHaveProperty('proxy');
    expect(session.sentFolder).toBe('已发送');
    await session.close();
    expect(flow.calls).toEqual(['connect', 'list', 'logout']);
  });

  it('按行测试连接带了授权码就用它；没保存授权码、没有主密钥为「未配置」（未连接，不算失败）', async () => {
    const { ctx } = context();
    await createRealImap(ctx).connect({ ...ACCOUNT, authCode: 'typed-code' });
    expect(flow.options[0]).toMatchObject({ auth: { pass: 'typed-code' } });
    await expect(
      createRealImap(ctx).connect({ ...ACCOUNT, address: 'other@forcome.com' }),
    ).rejects.toBeInstanceOf(ClientNotConfiguredError);
    await expect(
      createRealImap(context({ credentialVault: null }).ctx).connect(ACCOUNT),
    ).rejects.toBeInstanceOf(ClientNotConfiguredError);
  });

  it('文件夹一律只读 EXAMINE；位置为 UIDVALIDITY 与 UIDNEXT；按 UID 列游标之后的信（只取到达时间，UID FETCH n:* 多给的最后一封筛掉），原文按 UID 取', async () => {
    const session = await createRealImap(context().ctx).connect(ACCOUNT);
    expect(await session.position('inbox')).toEqual({ uidValidity: '1700000001', uidNext: 4 });
    const after = await session.fetchAfter('inbox', { uidValidity: '1700000001', uid: 1 });
    expect(after).toEqual([
      { uid: 2, internalDate: new Date(Date.UTC(2026, 8, 11, 2)) },
      { uid: 3, internalDate: new Date(Date.UTC(2026, 8, 12, 2)) },
    ]);
    const [raw] = await session.fetch('inbox', '1700000001', [2]);
    expect(new TextDecoder().decode(raw!.raw)).toContain('inbox 2');
    // 没有新信：不发 FETCH
    expect(await session.fetchAfter('inbox', { uidValidity: '1700000001', uid: 3 })).toEqual([]);
    expect(flow.calls.filter((c) => c.startsWith('open:'))).toEqual(
      Array(4).fill('open:INBOX:readonly'),
    );
    expect(flow.calls).toContain('fetch:2:*:uid');
  });

  it('UIDVALIDITY 变了：增量与按 UID 取信都抛「游标过期」，调用方按到达时间区间补拉', async () => {
    const session = await createRealImap(context().ctx).connect(ACCOUNT);
    await expect(
      session.fetchAfter('inbox', { uidValidity: '1600000000', uid: 1 }),
    ).rejects.toBeInstanceOf(CursorExpiredError);
    await expect(session.fetch('inbox', '1600000000', [1])).rejects.toBeInstanceOf(
      CursorExpiredError,
    );
  });

  it('按日期区间搜索：前后多取一天再按 INTERNALDATE 精确筛 [since, before)', async () => {
    const session = await createRealImap(context().ctx).connect(ACCOUNT);
    const found = await session.search('inbox', {
      since: new Date(Date.UTC(2026, 8, 11, 2)),
      before: new Date(Date.UTC(2026, 8, 12, 2)),
    });
    expect(found).toEqual({
      uidValidity: '1700000001',
      messages: [{ uid: 2, internalDate: new Date(Date.UTC(2026, 8, 11, 2)) }],
    });
  });

  it('每个操作记一条调用记录（系统 qiye163，请求写服务器、操作与邮箱，不写授权码）', async () => {
    const { ctx, records } = context();
    const session = await createRealImap(ctx).connect(ACCOUNT);
    await session.position('sent');
    expect(records.map((r) => [r.system, r.operation, r.outcome])).toEqual([
      ['qiye163', 'connect', 'ok'],
      ['qiye163', 'position:sent', 'ok'],
    ]);
    expect(records[0]!.request).toBe('IMAP imap.qiye.163.com:993 connect amz-auto@forcome.com');
    expect(JSON.stringify(records)).not.toContain('saved-auth-code');
  });

  it('登录失败翻译成要管理员处理的错误（授权码、IP 限制），连不上服务器为可重试的 unreachable，超时为超时', async () => {
    const { ctx, records } = context();
    flow.connectError = Object.assign(new Error('Authentication failed.'), {
      authenticationFailed: true,
      responseText: 'LOGIN Login error user suspended',
    });
    const auth = await createRealImap(ctx)
      .connect(ACCOUNT)
      .catch((e: unknown) => e);
    expect(auth).toBeInstanceOf(MailboxAccessError);
    expect(auth).toMatchObject({ reason: 'auth_failed', needsAdmin: true, retryable: false });
    expect(flow.calls).toContain('close');
    expect(records.at(-1)).toMatchObject({ operation: 'connect', outcome: 'failed' });

    flow.connectError = Object.assign(new Error('Command failed'), {
      responseText: 'ERR.LOGIN.IPDENY',
    });
    await expect(createRealImap(ctx).connect(ACCOUNT)).rejects.toMatchObject({
      reason: 'login_denied_ip',
    });

    flow.connectError = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    await expect(createRealImap(ctx).connect(ACCOUNT)).rejects.toMatchObject({
      reason: 'unreachable',
      retryable: true,
      needsAdmin: false,
    });
    expect(records.at(-1)).toMatchObject({ outcome: 'network' });

    flow.connectError = Object.assign(new Error('Timeout'), { code: 'CONNECT_TIMEOUT' });
    await expect(createRealImap(ctx).connect(ACCOUNT)).rejects.toBeInstanceOf(ExternalTimeoutError);
  });

  it('常驻连接：只读打开收件箱，EXISTS 增多时回调；不是我们关的断开以「连接已断开」结束', async () => {
    const onNewMail = vi.fn();
    const idle = await createRealImap(context().ctx).idle(ACCOUNT, onNewMail);
    expect(flow.options[0]).toMatchObject({ disableAutoIdle: false });
    expect(flow.calls).toContain('open:INBOX:readonly');
    for (const listener of flow.listeners.get('exists') ?? []) {
      listener({ path: 'INBOX', count: 4, prevCount: 3 });
      listener({ path: 'INBOX', count: 3, prevCount: 4 });
    }
    expect(onNewMail).toHaveBeenCalledTimes(1);
    for (const listener of flow.listeners.get('close') ?? []) listener();
    await expect(idle.closed).rejects.toMatchObject({ name: 'ConnectionLostError' });
  });
});

describe('纯函数', () => {
  it('「已发送」按特殊用途标记 \\Sent 优先，没有时按名字兜底（「已发送」、Sent Messages、Sent），都没有为 null', () => {
    expect(findSentFolder([{ path: 'INBOX' }, { path: 'Sent Items', specialUse: '\\Sent' }])).toBe(
      'Sent Items',
    );
    expect(findSentFolder([{ path: 'INBOX' }, { path: 'Sent' }, { path: '已发送' }])).toBe(
      '已发送',
    );
    expect(findSentFolder([{ path: 'INBOX' }, { path: 'sent messages' }])).toBe('sent messages');
    expect(
      findSentFolder([{ path: 'INBOX' }, { path: '草稿箱', specialUse: '\\Drafts' }]),
    ).toBeNull();
  });

  it('服务商的消息标识：文件夹角色 : UIDVALIDITY : UID', () => {
    expect(imapMessageId('inbox', '1700000001', 4521)).toBe('inbox:1700000001:4521');
    expect(imapMessageId('sent', '7', 1)).toBe('sent:7:1');
  });

  it('错误归类：Unsafe Login 当认证失败；其余没认出的为可重试的调用失败；已经翻译过的原样返回', () => {
    expect(
      classifyImapError(new Error('NO Unsafe Login. Please contact kefu@188.com'), 'open'),
    ).toMatchObject({
      reason: 'auth_failed',
    });
    expect(
      classifyImapError(Object.assign(new Error('x'), { tlsFailed: true }), 'connect'),
    ).toMatchObject({
      reason: 'unreachable',
    });
    const other = classifyImapError(new Error('BAD something'), 'fetch');
    expect(other).toBeInstanceOf(ExternalCallFailedError);
    expect(other.retryable).toBe(true);
    const already = new CursorExpiredError('qiye163', 'fetch');
    expect(classifyImapError(already, 'fetch')).toBe(already);
  });
});
