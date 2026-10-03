import { pino, type Logger } from 'pino';

export type { Logger };

/** pino JSON 日志写到标准输出，由 Docker json-file 驱动轮转（ADR 0013） */
export function createLogger(options: { level: string; name: string }): Logger {
  return pino({ level: options.level, name: options.name, base: { service: options.name } });
}

/** 测试与工具脚本用的静默日志 */
export const silentLogger: Logger = pino({ level: 'silent' });
