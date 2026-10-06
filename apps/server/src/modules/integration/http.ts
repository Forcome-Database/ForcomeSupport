import pThrottle from 'p-throttle';
import { EnvHttpProxyAgent, fetch, type Dispatcher } from 'undici';
import { noCallRecords, summarize, type CallRecorder } from './call-records';
import { ExternalCallFailedError, ExternalTimeoutError } from './faults';

/*
 * 出站 HTTP 客户端工厂（规格 integration 一节、ADR 0003、0009 修订）：所有外部 HTTP 调用经这里——
 * - 代理：undici 的 EnvHttpProxyAgent 读 HTTPS_PROXY / HTTP_PROXY / NO_PROXY（大小写都认），境外经固定代理、
 *   NO_PROXY 里的境内域名直连；整个进程共用一个（钉钉 Stream 的 WebSocket 也经它，同样遵守 NO_PROXY）；
 * - 超时：每次调用有上限，到点以 ExternalTimeoutError 结束；
 * - 错误：非 2xx 抛 ExternalCallFailedError（带状态码；429 与 5xx 可重试），网络错误抛不带状态码、可重试的
 *   ExternalCallFailedError——业务代码只处理 faults.ts 的这一套错误（同 Fake）；
 * - 限流（待办 09）：按「系统 × 接口」，各系统在建客户端时给出每个接口（或 '*' 为每个接口各自）每秒最多几次，
 *   超出的调用排队等（p-throttle）；限流器整个进程共用，同一系统的几个客户端实例（如按店铺新建的 Gmail）一起算；
 * - 调用记录（待办 09）：每次调用（含失败、超时）交给 CallRecorder 一条：系统、动作、店铺、耗时、状态码、请求与响应摘要
 *   （请求写方法与地址，查询参数里像凭证的值换成 ***；换令牌这类 secretResponse 的响应体不记）。
 */

let sharedDispatcher: Dispatcher | undefined;

/** 本进程共用的出站连接（按代理环境变量分流）；HTTP 调用与钉钉 Stream 的 WebSocket 共用 */
export function outboundDispatcher(): Dispatcher {
  sharedDispatcher ??= new EnvHttpProxyAgent();
  return sharedDispatcher;
}

/** 默认超时 30 秒；大文件（欧洲央行全量历史）与长轮询调用方另给 */
const DEFAULT_TIMEOUT_MS = 30_000;

export interface HttpRequestOptions {
  /** 操作名（写进错误与调用记录，也是限流的接口，如 users.history.list） */
  readonly operation: string;
  readonly timeoutMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
  /** 成功的响应体是凭证（换令牌）：调用记录里不留 */
  readonly secretResponse?: boolean;
}

export interface HttpClient {
  /** GET 并读成文本 */
  getText(url: string, options: HttpRequestOptions): Promise<string>;
  /** GET 并按 JSON 解析（解析结果由调用方用 zod 校验） */
  getJson(url: string, options: HttpRequestOptions): Promise<unknown>;
  /** POST JSON 并按 JSON 解析返回（解析结果由调用方用 zod 校验） */
  postJson(url: string, body: unknown, options: HttpRequestOptions): Promise<unknown>;
  /** POST 表单（application/x-www-form-urlencoded，OAuth 换令牌）并按 JSON 解析返回 */
  postForm(
    url: string,
    form: Readonly<Record<string, string>>,
    options: HttpRequestOptions,
  ): Promise<unknown>;
}

/** 一个接口每秒最多几次 */
export interface RateLimit {
  readonly perSecond: number;
}

export interface HttpClientOptions {
  /** 只给测试用（undici 的 MockAgent）；生产与开发都走共用的代理分流连接 */
  readonly dispatcher?: Dispatcher;
  /** 调用记录写到哪里；不给不记 */
  readonly recorder?: CallRecorder;
  /** 店铺级客户端的店铺（写进调用记录） */
  readonly storeId?: string;
  /** 按接口限流：键为操作名，'*' 为没单独写的每个接口各自的上限；不给不限 */
  readonly rateLimits?: Readonly<Record<string, RateLimit>>;
}

/** 进程共用的限流器：键为「系统 × 接口」 */
const throttles = new Map<string, <T>(call: () => Promise<T>) => Promise<T>>();

function throttled(
  system: string,
  operation: string,
  limits: Readonly<Record<string, RateLimit>> | undefined,
): (<T>(call: () => Promise<T>) => Promise<T>) | null {
  const limit = limits?.[operation] ?? limits?.['*'];
  if (!limit) return null;
  const key = `${system} × ${operation}`;
  let throttle = throttles.get(key);
  if (!throttle) {
    const run = pThrottle({ limit: limit.perSecond, interval: 1000 })(
      (call: () => Promise<unknown>) => call(),
    );
    throttle = <T>(call: () => Promise<T>) => run(call) as Promise<T>;
    throttles.set(key, throttle);
  }
  return throttle;
}

type Body =
  | { readonly kind: 'none' }
  | { readonly kind: 'json'; readonly value: unknown }
  | { readonly kind: 'form'; readonly value: Readonly<Record<string, string>> };

/** 查询参数里像凭证的（access_token、appsecret、appkey、授权码、分页令牌等）：调用记录里写成 *** */
const SECRET_PARAM = /token|secret|key|password|assertion|code|ticket/i;

/** 调用记录里的请求：方法与地址，查询参数照写（排错要看 startHistoryId 这类参数），像凭证的值换成 *** */
function requestSummary(method: string, url: string): string {
  const parsed = new URL(url);
  for (const name of new Set(parsed.searchParams.keys())) {
    if (SECRET_PARAM.test(name)) parsed.searchParams.set(name, '***');
  }
  return `${method} ${parsed.origin}${parsed.pathname}${decodeURIComponent(parsed.search)}`;
}

/**
 * 某个外部系统的 HTTP 客户端。dispatcher 只给测试用（undici 的 MockAgent），生产与开发都走共用的代理分流连接
 */
export function createHttpClient(system: string, options: HttpClientOptions = {}): HttpClient {
  const recorder = options.recorder ?? noCallRecords;

  function translate(error: unknown, operation: string, signal: AbortSignal): Error {
    if (signal.aborted) return new ExternalTimeoutError(system, operation);
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    return new ExternalCallFailedError(system, operation, {
      message: `网络错误：${cause instanceof Error ? cause.message : String(cause)}`,
      cause: error,
    });
  }

  /** 发一次请求并把响应体读成文本；非 2xx、超时、网络错误翻译成 faults.ts 的错误。每次都写一条调用记录 */
  async function exchange(url: string, request: HttpRequestOptions, body: Body): Promise<string> {
    const method = body.kind === 'none' ? 'GET' : 'POST';
    const startedAt = new Date();
    const began = performance.now();
    const signal = AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let status: number | null = null;
    let outcome: 'ok' | 'failed' | 'timeout' | 'network' = 'ok';
    let response: string | null = null;
    try {
      let res: Awaited<ReturnType<typeof fetch>>;
      try {
        res = await fetch(url, {
          method,
          dispatcher: options.dispatcher ?? outboundDispatcher(),
          signal,
          headers: {
            ...(body.kind === 'json'
              ? { 'content-type': 'application/json', accept: 'application/json' }
              : body.kind === 'form'
                ? {
                    'content-type': 'application/x-www-form-urlencoded',
                    accept: 'application/json',
                  }
                : {}),
            ...request.headers,
          },
          body:
            body.kind === 'json'
              ? JSON.stringify(body.value)
              : body.kind === 'form'
                ? new URLSearchParams(body.value).toString()
                : undefined,
        });
      } catch (error) {
        throw translate(error, request.operation, signal);
      }
      status = res.status;
      let text: string;
      try {
        text = await res.text();
      } catch (error) {
        throw translate(error, request.operation, signal);
      }
      response = text;
      if (!res.ok) {
        throw new ExternalCallFailedError(system, request.operation, {
          status: res.status,
          message: `调用失败（${res.status}）：${summarize(text) ?? ''}`,
        });
      }
      if (request.secretResponse) response = '（凭证，不记录）';
      return text;
    } catch (error) {
      outcome =
        error instanceof ExternalTimeoutError ? 'timeout' : status === null ? 'network' : 'failed';
      response ??= error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      await recorder.record({
        system,
        operation: request.operation,
        storeId: options.storeId ?? null,
        startedAt,
        durationMs: performance.now() - began,
        outcome,
        status,
        request: requestSummary(method, url),
        response: summarize(response),
      });
    }
  }

  function send(url: string, request: HttpRequestOptions, body: Body): Promise<string> {
    const throttle = throttled(system, request.operation, options.rateLimits);
    return throttle ? throttle(() => exchange(url, request, body)) : exchange(url, request, body);
  }

  function parseJson(text: string, request: HttpRequestOptions): unknown {
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new ExternalCallFailedError(system, request.operation, {
        message: `返回的不是 JSON：${error instanceof Error ? error.message : String(error)}`,
        retryable: false,
        cause: error,
      });
    }
  }

  return {
    getText: (url, request) => send(url, request, { kind: 'none' }),
    async getJson(url, request) {
      return parseJson(await send(url, request, { kind: 'none' }), request);
    },
    async postJson(url, body, request) {
      return parseJson(await send(url, request, { kind: 'json', value: body }), request);
    },
    async postForm(url, form, request) {
      return parseJson(await send(url, request, { kind: 'form', value: form }), request);
    },
  };
}
