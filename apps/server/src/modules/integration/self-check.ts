import { sql } from 'drizzle-orm';
import type { SelfCheckProbe } from '../core';

/*
 * worker 自检的外部调用一项（待办 28，协调者 2026-10-14 决定 Q2 c）：近 ALERT_CALL_ERROR_WINDOW_MINUTES 某外部系统的调用
 * 不少于 ALERT_CALL_ERROR_MIN_CALLS 次、且失败（非 2xx、超时、网络错误，含 429 限流）占比达到 ALERT_CALL_ERROR_PERCENT 时告警。
 * SP-API、Shopify 的限流（429、THROTTLED）也归在这里。数据是真实现经出站 HTTP 客户端写的调用记录（integration.call_record）；
 * Fake 不写调用记录。调用记录的时刻是进程的系统时间，所以按数据库的 now() 取窗口（不按运行时的时钟）。
 */

/** 告警里外部系统的叫法 */
const SYSTEM_LABELS: Readonly<Record<string, string>> = {
  gmail: 'Gmail',
  gmail_push: 'Gmail 推送（Pub/Sub）',
  dingtalk: '钉钉',
  dingtalk_robot: '钉钉群机器人',
  exchange_rate: '汇率（欧洲央行 / Frankfurter）',
  shopify: 'Shopify',
  sp_api: '亚马逊 SP-API',
  amazon_sqs: '亚马逊 SQS',
};

interface ErrorRateRow extends Record<string, unknown> {
  system: string;
  calls: number;
  failed: number;
  throttled: number;
}

export const integrationSelfCheckProbe: SelfCheckProbe = {
  name: '外部调用错误率',
  async check({ db, settings }) {
    const result = await db.execute<ErrorRateRow>(sql`
      SELECT system, count(*)::int AS calls,
             count(*) FILTER (WHERE outcome <> 'ok')::int AS failed,
             count(*) FILTER (WHERE status = 429)::int AS throttled
        FROM integration.call_record
       WHERE started_at >= now() - make_interval(secs => ${settings.callErrorWindowMs / 1000})
       GROUP BY system
       ORDER BY system`);
    const minutes = Math.round(settings.callErrorWindowMs / 60_000);
    return result.rows
      .filter(
        (row) =>
          row.calls >= settings.callErrorMinCalls &&
          row.failed * 100 >= row.calls * settings.callErrorPercent,
      )
      .map((row) => ({
        key: `calls:${row.system}`,
        subject: `外部调用 ${SYSTEM_LABELS[row.system] ?? row.system}`,
        problem: `近 ${minutes} 分钟 ${row.calls} 次调用失败 ${row.failed} 次（${Math.round((row.failed * 100) / row.calls)}%${row.throttled > 0 ? `，其中限流 ${row.throttled} 次` : ''}）`,
      }));
  },
};
