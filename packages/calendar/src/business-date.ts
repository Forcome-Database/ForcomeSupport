/** 业务时区：日界、工单编号日期、报表归期都按北京时间（规格「数据约定」） */
export const BUSINESS_TIME_ZONE = 'Asia/Shanghai';

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function partsOf(instant: Date, caller: string): (type: Intl.DateTimeFormatPartTypes) => string {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError(`${caller}：无效的时间`);
  }
  const parts = formatter.formatToParts(instant);
  return (type) => parts.find((p) => p.type === type)?.value ?? '';
}

/** 某一时刻在业务时区的日期，格式 `YYYY-MM-DD` */
export function businessDate(instant: Date): string {
  const part = partsOf(instant, 'businessDate');
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** 某一时刻在业务时区的日期与时间，格式 `YYYY-MM-DD HH:mm:ss`（审计日志等显示时刻的地方截取需要的部分） */
export function businessDateTime(instant: Date): string {
  const part = partsOf(instant, 'businessDateTime');
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
}

/**
 * 某个业务日期（`YYYY-MM-DD`）的起点，即北京时间当天 0 点。北京时间没有夏令时，固定 UTC+8；
 * 按日期区间查时刻列时用「≥ 起始日 0 点、< 截止日次日 0 点」
 */
export function startOfBusinessDate(date: string): Date {
  const instant = new Date(`${date}T00:00:00+08:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(instant.getTime())) {
    throw new RangeError(`startOfBusinessDate：无效的日期 ${date}`);
  }
  return instant;
}
