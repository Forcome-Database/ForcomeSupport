import { EnvHttpProxyAgent, fetch, type Dispatcher } from 'undici';
import { ExternalCallFailedError, ExternalTimeoutError } from './faults';

/*
 * 出站 HTTP 客户端工厂（规格 integration 一节、ADR 0003、0009 修订）：所有外部 HTTP 调用经这里——
 * - 代理：undici 的 EnvHttpProxyAgent 读 HTTPS_PROXY / HTTP_PROXY / NO_PROXY（大小写都认），境外经固定代理、
 *   NO_PROXY 里的境内域名直连；整个进程共用一个；
 * - 超时：每次调用有上限，到点以 ExternalTimeoutError 结束；
 * - 错误：非 2xx 抛 ExternalCallFailedError（带状态码；429 与 5xx 可重试），网络错误抛不带状态码、可重试的
 *   ExternalCallFailedError——业务代码只处理 faults.ts 的这一套错误（同 Fake）。
 * 按「系统 × 接口」的限流与调用记录随 09 号待办（Gmail，第一个高频的真实现）加在这里；汇率每天一次，用不上限流。
 */

let sharedDispatcher: Dispatcher | undefined;

/** 本进程共用的出站连接（按代理环境变量分流） */
function outboundDispatcher(): Dispatcher {
  sharedDispatcher ??= new EnvHttpProxyAgent();
  return sharedDispatcher;
}

/** 默认超时 30 秒；大文件（欧洲央行全量历史）调用方另给 */
const DEFAULT_TIMEOUT_MS = 30_000;

export interface HttpRequestOptions {
  /** 操作名（写进错误，如 eurofxref-daily.xml） */
  readonly operation: string;
  readonly timeoutMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface HttpClient {
  /** GET 并读成文本 */
  getText(url: string, options: HttpRequestOptions): Promise<string>;
  /** GET 并按 JSON 解析（解析结果由调用方用 zod 校验） */
  getJson(url: string, options: HttpRequestOptions): Promise<unknown>;
}

/**
 * 某个外部系统的 HTTP 客户端。dispatcher 只给测试用（undici 的 MockAgent），生产与开发都走共用的代理分流连接
 */
export function createHttpClient(
  system: string,
  options: { dispatcher?: Dispatcher } = {},
): HttpClient {
  async function get(url: string, request: HttpRequestOptions) {
    const signal = AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(url, {
        dispatcher: options.dispatcher ?? outboundDispatcher(),
        signal,
        headers: request.headers,
      });
    } catch (error) {
      throw translate(error, request.operation, signal);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ExternalCallFailedError(system, request.operation, { status: response.status });
    }
    return { response, signal };
  }

  function translate(error: unknown, operation: string, signal: AbortSignal): Error {
    if (signal.aborted) return new ExternalTimeoutError(system, operation);
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    return new ExternalCallFailedError(system, operation, {
      message: `网络错误：${cause instanceof Error ? cause.message : String(cause)}`,
      cause: error,
    });
  }

  async function read<T>(
    request: HttpRequestOptions,
    signal: AbortSignal,
    body: () => Promise<T>,
  ): Promise<T> {
    try {
      return await body();
    } catch (error) {
      throw translate(error, request.operation, signal);
    }
  }

  return {
    async getText(url, request) {
      const { response, signal } = await get(url, request);
      return read(request, signal, () => response.text());
    },
    async getJson(url, request) {
      const { response, signal } = await get(url, request);
      const text = await read(request, signal, () => response.text());
      try {
        return JSON.parse(text) as unknown;
      } catch (error) {
        throw new ExternalCallFailedError(system, request.operation, {
          message: `返回的不是 JSON：${error instanceof Error ? error.message : String(error)}`,
          retryable: false,
          cause: error,
        });
      }
    },
  };
}
