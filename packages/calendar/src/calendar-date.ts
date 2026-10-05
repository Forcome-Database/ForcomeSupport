/*
 * 日历日期（`YYYY-MM-DD`）的加减与星期：费用发生日、汇率日期这类「某一天」而不是时刻的值，按 UTC 的零点换算，
 * 与时区无关。
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function toUtc(date: string): Date {
  const instant = new Date(`${date}T00:00:00Z`);
  if (
    !DATE.test(date) ||
    Number.isNaN(instant.getTime()) ||
    !instant.toISOString().startsWith(date)
  ) {
    throw new RangeError(`不是合法的日期：${date}`);
  }
  return instant;
}

/** 日期加减天数 */
export function addDays(date: string, days: number): string {
  return new Date(toUtc(date).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** 是否周一到周五 */
export function isWeekday(date: string): boolean {
  const day = toUtc(date).getUTCDay();
  return day !== 0 && day !== 6;
}
