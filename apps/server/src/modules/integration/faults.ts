/*
 * 外部调用的错误与 Fake 的故障注入（ADR 0009 修订，规格 integration 一节）。
 * 真实现把 HTTP 与 SDK 的错误翻译成下面这几类，Fake 按测试安排抛同样的错误，
 * 业务代码因此只处理一套错误：失败、超时、游标过期、断线。
 */

export class ExternalServiceError extends Error {
  override name = 'ExternalServiceError';
  /** 外部系统名，如 gmail、dingtalk */
  readonly system: string;
  /** 出错的操作，如 history.list、listChanges */
  readonly operation: string;
  /** 原样重试是否可能成功（限流、5xx、超时、断线可以；4xx、游标过期不行） */
  readonly retryable: boolean;

  constructor(
    system: string,
    operation: string,
    message: string,
    retryable: boolean,
    /** 真实现翻译前的原始错误（网络错误、解析错误），留着排错 */
    cause?: unknown,
  ) {
    super(`${system} ${operation}：${message}`, cause === undefined ? undefined : { cause });
    this.system = system;
    this.operation = operation;
    this.retryable = retryable;
  }
}

/** 外部接口返回了错误 */
export class ExternalCallFailedError extends ExternalServiceError {
  override name = 'ExternalCallFailedError';
  /** HTTP 状态码；不是 HTTP 错误时为 null */
  readonly status: number | null;

  constructor(
    system: string,
    operation: string,
    options: {
      status?: number | null;
      message?: string;
      retryable?: boolean;
      cause?: unknown;
    } = {},
  ) {
    const status = options.status ?? null;
    // 没说明时：限流与服务端错误可重试，其余 4xx 不可重试
    const retryable = options.retryable ?? (status === null || status === 429 || status >= 500);
    super(
      system,
      operation,
      options.message ?? `调用失败（${status ?? '无状态码'}）`,
      retryable,
      options.cause,
    );
    this.status = status;
  }
}

/** 等不到响应 */
export class ExternalTimeoutError extends ExternalServiceError {
  override name = 'ExternalTimeoutError';

  constructor(system: string, operation: string) {
    super(system, operation, '调用超时', true);
  }
}

/** 增量游标已过期（Gmail history.list 404 等），调用方要按时间区间全量补拉 */
export class CursorExpiredError extends ExternalServiceError {
  override name = 'CursorExpiredError';

  constructor(system: string, operation: string) {
    super(system, operation, '增量游标已过期，需要全量补拉', false);
  }
}

/**
 * 真实现要的凭据没有配置（例如 Gmail 的 Google 服务账号）：不是连接出了故障，而是还没接通——调用方不把它算进连续失败
 * （连接状态为「未连接」，PRD 6.9），不可重试
 */
export class ClientNotConfiguredError extends ExternalServiceError {
  override name = 'ClientNotConfiguredError';

  constructor(system: string, operation: string, message: string) {
    super(system, operation, message, false);
  }
}

/**
 * 平台只让读近一段时间的订单（待办 13）：Shopify 没有 read_all_orders 时只能读近 60 天的订单。不是连接故障，
 * 调用方（订单回补）把回补窗口缩短到 days 天后重来；原样重试没用
 */
export class HistoryLimitedError extends ExternalServiceError {
  override name = 'HistoryLimitedError';
  /** 平台允许读的天数 */
  readonly days: number;

  constructor(system: string, operation: string, days: number, message: string) {
    super(system, operation, message, false);
    this.days = days;
  }
}

/** 连接断开（长连接掉线、网络不通），恢复后再继续 */
export class ConnectionLostError extends ExternalServiceError {
  override name = 'ConnectionLostError';

  constructor(system: string, operation: string) {
    super(system, operation, '连接已断开', true);
  }
}

/** 安排给 Fake 的一种故障 */
export type FaultSpec =
  | { kind: 'error'; status?: number; message?: string; retryable?: boolean }
  | { kind: 'timeout' }
  | { kind: 'cursor_expired' };

interface PlannedFault {
  readonly fault: FaultSpec;
  /** 只对这个操作生效；不填对所有操作生效 */
  readonly operation?: string;
  remaining: number;
}

/**
 * Fake 的故障注入：测试安排「接下来几次调用失败、超时、游标过期」或「断线直到恢复」，
 * Fake 在每个操作开头 `await faults.check('操作名')`。同时记下调用过的操作，供测试断言重试次数。
 * 超时不真的等待，立即以超时错误结束（测试不 sleep）。
 */
export class FaultInjector {
  readonly #system: string;
  #planned: PlannedFault[] = [];
  #disconnected = false;
  #calls: string[] = [];

  constructor(system: string) {
    this.#system = system;
  }

  /** 让接下来的调用失败；times 默认 1，operation 不填对所有操作生效。多次安排按先后排队 */
  failNext(
    fault: FaultSpec = { kind: 'error' },
    options: { times?: number; operation?: string } = {},
  ): void {
    const times = options.times ?? 1;
    if (!Number.isInteger(times) || times < 1) {
      throw new RangeError(`故障次数必须是正整数：${times}`);
    }
    this.#planned.push({ fault, operation: options.operation, remaining: times });
  }

  /** 断线：之后每次调用都以 ConnectionLostError 结束，直到 reconnect */
  disconnect(): void {
    this.#disconnected = true;
  }

  reconnect(): void {
    this.#disconnected = false;
  }

  /** 调用过的操作（按先后），包括失败的调用 */
  get calls(): readonly string[] {
    return this.#calls;
  }

  /** Fake 在每个操作开头调用：记一次调用；有安排的故障就以对应错误结束 */
  check(operation: string): Promise<void> {
    this.#calls.push(operation);
    if (this.#disconnected) {
      return Promise.reject(new ConnectionLostError(this.#system, operation));
    }
    const index = this.#planned.findIndex((p) => !p.operation || p.operation === operation);
    const planned = this.#planned[index];
    if (!planned) {
      return Promise.resolve();
    }
    planned.remaining -= 1;
    if (planned.remaining === 0) {
      this.#planned.splice(index, 1);
    }
    return Promise.reject(this.#toError(planned.fault, operation));
  }

  /** 清空安排的故障、断线状态与调用记录 */
  reset(): void {
    this.#planned = [];
    this.#disconnected = false;
    this.#calls = [];
  }

  #toError(fault: FaultSpec, operation: string): ExternalServiceError {
    switch (fault.kind) {
      case 'error':
        return new ExternalCallFailedError(this.#system, operation, fault);
      case 'timeout':
        return new ExternalTimeoutError(this.#system, operation);
      case 'cursor_expired':
        return new CursorExpiredError(this.#system, operation);
    }
  }
}
