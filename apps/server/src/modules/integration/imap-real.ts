import {
  ImapFlow,
  type FetchMessageObject,
  type ImapFlowError,
  type MailboxObject,
} from 'imapflow';
import type { CallRecordEntry } from './call-records';
import { summarize } from './call-records';
import type { RealClientContext } from './definition';
import {
  ClientNotConfiguredError,
  ConnectionLostError,
  CursorExpiredError,
  ExternalCallFailedError,
  ExternalServiceError,
  ExternalTimeoutError,
  MailboxAccessError,
} from './faults';
import type {
  ImapAccount,
  ImapClient,
  ImapFolderRole,
  ImapIdle,
  ImapMessageInfo,
  ImapRawMessage,
  ImapSession,
} from './imap';

/*
 * 163 企业邮箱 IMAP 的真实现（ADR 0015，待办 35）：用 imapflow（Nodemailer 作者维护，IDLE、SPECIAL-USE、UID 增量、ID 命令与 TLS），
 * 不自己写 IMAP 协议。
 * - 登录：登录名是完整邮箱地址，口令是客户端授权码（按邮箱加密存库，经 credentialVault 读；按行测试连接时用调用方给的）；
 *   TLS 直连（993），登录后先发 IMAP ID（clientInfo，网易要求，否则选文件夹时报 Unsafe Login）；
 * - 只读：文件夹一律 EXAMINE（mailboxOpen readOnly），原文用 BODY.PEEK[]（fetch source），不改已读状态；
 * - TCP 直连，不读 HTTPS_PROXY（境内服务从公司固定 IP 直连，ADR 0003 修订）；
 * - 每个操作记一条调用记录（系统 qiye163，请求写服务器、操作与邮箱，不写授权码）；
 * - imapflow 的错误翻译成 MailboxAccessError（授权码、登录 IP、连不上）、ExternalTimeoutError 与 ExternalCallFailedError（classifyImapError）。
 * 本机没有网易账号，真实环境的核对点在待办 29；单元测试 imap-real.test.ts 把 imapflow 换成替身，核对调用方式与错误翻译。
 */

/**
 * 「已发送」文件夹的识别（ADR 0015，RFC 6154）：LIST 返回的特殊用途标记 \Sent 优先，没有时按名字兜底（「已发送」、Sent Messages、Sent，
 * 不分大小写、按这个先后）；都没有为 null
 */
export function findSentFolder(
  folders: readonly { readonly path: string; readonly specialUse?: string | null }[],
): string | null {
  const marked = folders.find((folder) => folder.specialUse === '\\Sent');
  if (marked) return marked.path;
  for (const name of SENT_FOLDER_NAMES) {
    const found = folders.find((folder) => folder.path.toLowerCase() === name.toLowerCase());
    if (found) return found.path;
  }
  return null;
}

const SENT_FOLDER_NAMES = ['已发送', 'Sent Messages', 'Sent'] as const;

/** 登录后经 IMAP ID 报给服务器的客户端信息（RFC 2971；网易要求，ADR 0015） */
export const IMAP_CLIENT_INFO = { name: 'Forcome Support', version: '1.0', vendor: 'Forcome' };

const SYSTEM = 'qiye163';

/** 超时：连上服务器（含 DNS、TLS）30 秒、等问候 16 秒、连接上没有任何数据 5 分钟（IDLE 由 imapflow 定时重发） */
const TIMEOUTS = { connectionTimeout: 30_000, greetingTimeout: 16_000, socketTimeout: 5 * 60_000 };

/** IMAP SEARCH 只到日期（服务器时区，网易为北京时间）：前后各多取一天，取回后按 INTERNALDATE 精确筛 */
const SEARCH_MARGIN_MS = 24 * 60 * 60_000;

const TIMEOUT_CODES = new Set([
  'CONNECT_TIMEOUT',
  'GREETING_TIMEOUT',
  'UPGRADE_TIMEOUT',
  'ETIMEOUT',
  'ETIMEDOUT',
]);

const UNREACHABLE_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'NoConnection',
  'EConnectionClosed',
  'ClosedAfterConnectText',
  'ClosedAfterConnectTLS',
]);

/** 网易的登录 IP 限制（ERR.LOGIN.IPDENY 等写法） */
const IP_DENIED = /IPDENY|IP[\s_.-]*DEN(Y|IED)|IP\s*限制|登录\s*IP/i;
/** 授权码不对、客户端登录没开、没先发 ID（Unsafe Login） */
const AUTH_FAILED =
  /AUTHENTICATIONFAILED|AUTHORIZATIONFAILED|LOGIN\s*FAIL|Unsafe Login|invalid (credentials|password)|ERR\.LOGIN/i;

/**
 * 把 imapflow（与 Node 网络层）的错误翻译成 integration 的错误（ADR 0009 修订）：登录 IP 受限、认证失败（授权码不对、客户端登录被关、
 * Unsafe Login）为要管理员处理的 MailboxAccessError；连不上服务器、TLS 握手失败、连接被关为 unreachable；各种超时为 ExternalTimeoutError；
 * 其余为可重试的 ExternalCallFailedError。已经是 integration 的错误原样返回
 */
export function classifyImapError(error: unknown, operation: string): ExternalServiceError {
  if (error instanceof ExternalServiceError) return error;
  const e = (error ?? {}) as ImapFlowError;
  const text = [
    e.message,
    e.responseText,
    e.serverResponseCode,
    typeof e.response === 'string' ? e.response : '',
  ]
    .filter(Boolean)
    .join(' ');
  if (IP_DENIED.test(text))
    return new MailboxAccessError(SYSTEM, operation, 'login_denied_ip', error);
  if (e.authenticationFailed || AUTH_FAILED.test(text)) {
    return new MailboxAccessError(SYSTEM, operation, 'auth_failed', error);
  }
  if (e.code && TIMEOUT_CODES.has(e.code)) return new ExternalTimeoutError(SYSTEM, operation);
  if (e.tlsFailed || (e.code && UNREACHABLE_CODES.has(e.code))) {
    return new MailboxAccessError(SYSTEM, operation, 'unreachable', error);
  }
  return new ExternalCallFailedError(SYSTEM, operation, {
    message: text || '调用失败',
    retryable: true,
    cause: error,
  });
}

function outcomeOf(error: ExternalServiceError): CallRecordEntry['outcome'] {
  if (error instanceof ExternalTimeoutError) return 'timeout';
  if (error instanceof MailboxAccessError && error.reason === 'unreachable') return 'network';
  return 'failed';
}

/** 到达时间（imapflow 给 Date 或字符串） */
function dateOf(value: Date | string | undefined): Date {
  return value instanceof Date ? value : new Date(value ?? 0);
}

function rawOf(message: FetchMessageObject): ImapRawMessage {
  const raw = message.source ?? Buffer.alloc(0);
  return {
    uid: message.uid,
    internalDate: dateOf(message.internalDate),
    size: message.size ?? raw.length,
    raw: new Uint8Array(raw),
  };
}

/** 新建一个 imapflow 客户端：TLS 直连、先发 ID、不写日志（错误经调用记录与上层日志） */
function newImapFlow(account: ImapAccount, pass: string, idle: boolean): ImapFlow {
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: true,
    auth: { user: account.address, pass },
    clientInfo: IMAP_CLIENT_INFO,
    logger: false,
    // 同步用的会话不 IDLE（取完就 LOGOUT）；常驻连接由 imapflow 在空闲时自动 IDLE
    disableAutoIdle: !idle,
    ...TIMEOUTS,
  });
  // 连接级的错误另由 close 体现；不挂监听器的话 EventEmitter 会把它当未处理的错误抛出
  client.on('error', () => undefined);
  return client;
}

export function createRealImap(context: RealClientContext): ImapClient {
  const storeId = context.storeId ?? null;

  /** 执行一个 IMAP 操作并记调用记录；失败翻译成 integration 的错误 */
  async function recorded<T>(
    account: ImapAccount,
    operation: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const startedAt = context.clock.now();
    const started = performance.now();
    const request = `IMAP ${account.host}:${account.port} ${operation} ${account.address}`;
    try {
      const result = await run();
      await context.callRecorder.record({
        system: SYSTEM,
        operation,
        storeId,
        startedAt,
        durationMs: performance.now() - started,
        outcome: 'ok',
        status: null,
        request,
        response: null,
      });
      return result;
    } catch (error) {
      const translated = classifyImapError(error, operation);
      await context.callRecorder.record({
        system: SYSTEM,
        operation,
        storeId,
        startedAt,
        durationMs: performance.now() - started,
        outcome: outcomeOf(translated),
        status: null,
        request,
        response: summarize(translated.message),
      });
      throw translated;
    }
  }

  /** 登录口令：调用方给的授权码，或该地址已保存的（没有主密钥或没保存为「未配置」，未连接、不算失败） */
  async function passwordOf(account: ImapAccount): Promise<string> {
    if (account.authCode) return account.authCode;
    if (!context.credentialVault) {
      throw new ClientNotConfiguredError(
        SYSTEM,
        'connect',
        '没有配置主密钥 CREDENTIAL_MASTER_KEY，读不到客户端授权码',
      );
    }
    const saved = await context.credentialVault.readMailboxAuthCode(account.address);
    if (!saved) {
      throw new ClientNotConfiguredError(
        SYSTEM,
        'connect',
        `${account.address} 没有保存客户端授权码（或解不开），请在 P18 重新填写`,
      );
    }
    return saved;
  }

  return {
    async connect(account) {
      const client = newImapFlow(account, await passwordOf(account), false);
      const folders = await recorded(account, 'connect', async () => {
        try {
          await client.connect();
          return await client.list();
        } catch (error) {
          client.close();
          throw error;
        }
      });
      const sentFolder = findSentFolder(
        folders.map((folder) => ({ path: folder.path, specialUse: folder.specialUse ?? null })),
      );

      /** EXAMINE 一个文件夹（已选中同一个时 imapflow 直接返回） */
      async function examine(role: ImapFolderRole): Promise<MailboxObject> {
        const path = role === 'inbox' ? 'INBOX' : sentFolder;
        if (!path) throw new Error('qiye163：没有「已发送」文件夹');
        return client.mailboxOpen(path, { readOnly: true });
      }

      async function fetchRaw(range: string | number[]): Promise<ImapRawMessage[]> {
        const messages: ImapRawMessage[] = [];
        for await (const message of client.fetch(
          range,
          { uid: true, internalDate: true, size: true, source: true },
          { uid: true },
        )) {
          messages.push(rawOf(message));
        }
        return messages.sort((a, b) => a.uid - b.uid);
      }

      const session: ImapSession = {
        sentFolder,
        position: (role) =>
          recorded(account, `position:${role}`, async () => {
            const mailbox = await examine(role);
            return { uidValidity: String(mailbox.uidValidity), uidNext: mailbox.uidNext };
          }),
        fetchAfter: (role, from) =>
          recorded(account, `fetchAfter:${role}`, async () => {
            const mailbox = await examine(role);
            if (String(mailbox.uidValidity) !== from.uidValidity) {
              throw new CursorExpiredError(SYSTEM, `fetchAfter:${role}`);
            }
            if (mailbox.uidNext <= from.uid + 1) return [];
            // UID FETCH n:* 在没有更大 UID 时也会返回最后一封，按 UID 再筛一次
            return (await fetchRaw(`${from.uid + 1}:*`)).filter((m) => m.uid > from.uid);
          }),
        search: (role, { since, before }) =>
          recorded(account, `search:${role}`, async () => {
            const mailbox = await examine(role);
            const found = await client.search(
              {
                since: new Date(since.getTime() - SEARCH_MARGIN_MS),
                ...(before ? { before: new Date(before.getTime() + SEARCH_MARGIN_MS) } : {}),
              },
              { uid: true },
            );
            const uids = Array.isArray(found) ? found : [];
            const messages: ImapMessageInfo[] = [];
            if (uids.length > 0) {
              for await (const message of client.fetch(
                uids,
                { uid: true, internalDate: true },
                { uid: true },
              )) {
                const at = dateOf(message.internalDate);
                if (at < since || (before && at >= before)) continue;
                messages.push({ uid: message.uid, internalDate: at });
              }
            }
            return {
              uidValidity: String(mailbox.uidValidity),
              messages: messages.sort((a, b) => a.uid - b.uid),
            };
          }),
        fetch: (role, uidValidity, uids) =>
          recorded(account, `fetch:${role}`, async () => {
            const mailbox = await examine(role);
            if (String(mailbox.uidValidity) !== uidValidity) {
              throw new CursorExpiredError(SYSTEM, `fetch:${role}`);
            }
            if (uids.length === 0) return [];
            return fetchRaw([...uids]);
          }),
        async close() {
          await client.logout().catch(() => client.close());
        },
      };
      return session;
    },

    async idle(account, onNewMail) {
      const client = newImapFlow(account, await passwordOf(account), true);
      let closing = false;
      await recorded(account, 'idle', async () => {
        try {
          await client.connect();
          await client.mailboxOpen('INBOX', { readOnly: true });
        } catch (error) {
          client.close();
          throw error;
        }
      });
      client.on('exists', (data) => {
        if (data.count > data.prevCount) onNewMail();
      });
      const closed = new Promise<void>((resolve, reject) => {
        client.once('close', () => {
          if (closing) resolve();
          else reject(new ConnectionLostError(SYSTEM, 'idle'));
        });
      });
      closed.catch(() => undefined);
      const idle: ImapIdle = {
        closed,
        async close() {
          closing = true;
          await client.logout().catch(() => client.close());
        },
      };
      return idle;
    },
  };
}
