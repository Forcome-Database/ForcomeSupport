/** 业务时区：日界、工单编号日期、报表归期都按北京时间（规格「数据约定」） */
export const BUSINESS_TIME_ZONE = 'Asia/Shanghai';

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 某一时刻在业务时区的日期，格式 `YYYY-MM-DD` */
export function businessDate(instant: Date): string {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError('businessDate：无效的时间');
  }
  const parts = formatter.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
