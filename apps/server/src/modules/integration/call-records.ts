import type { Logger, Runtime } from '../core';
import { callRecord } from './schema';

/*
 * 外部调用记录（规格 integration「每次外部调用写一条调用记录」、ADR 0009，待办 09）：出站 HTTP 客户端工厂每次调用后交给
 * CallRecorder 一条记录。api 与 worker 用 databaseCallRecorder 写进 integration.call_record；写失败只记日志——
 * 调用记录是排错用的，不能因为它让外部调用本身失败。测试经 IntegrationClients 的选项换成内存里的记录器。
 */

export interface CallRecordEntry {
  readonly system: string;
  readonly operation: string;
  readonly storeId: string | null;
  readonly startedAt: Date;
  readonly durationMs: number;
  readonly outcome: 'ok' | 'failed' | 'timeout' | 'network';
  readonly status: number | null;
  /** 方法与地址；查询参数里像凭证的值换成 *** */
  readonly request: string;
  /** 响应体的前一段或错误说明 */
  readonly response: string | null;
}

export interface CallRecorder {
  record(entry: CallRecordEntry): Promise<void>;
}

/** 不记（单元测试、没有数据库的脚本） */
export const noCallRecords: CallRecorder = { record: () => Promise.resolve() };

/** 摘要最多留这么长 */
const SUMMARY_LENGTH = 500;

export function summarize(text: string | null): string | null {
  if (text === null) return null;
  return text.length > SUMMARY_LENGTH ? `${text.slice(0, SUMMARY_LENGTH)}…` : text;
}

/** 写进 integration.call_record（api、worker 用） */
export function databaseCallRecorder(runtime: Runtime, logger: Logger): CallRecorder {
  return {
    async record(entry) {
      try {
        await runtime.db
          .insert(callRecord)
          .values({ ...entry, durationMs: Math.round(entry.durationMs) });
      } catch (error) {
        logger.warn(
          { err: error, system: entry.system, operation: entry.operation },
          '写调用记录失败',
        );
      }
    },
  };
}
