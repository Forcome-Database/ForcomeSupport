import { addDays, businessDate } from '@forcome/calendar';
import {
  crossRate,
  foreignCurrencies,
  type ExchangeRate,
  type ExchangeRatesOn,
  type ForeignCurrency,
} from '@forcome/contracts';
import { and, desc, eq, lte, max } from 'drizzle-orm';
import { z } from 'zod';
import type { DbExecutor } from './db';
import { defineJob, handleJob, type AnyJobHandler } from './jobs';
import type { Logger } from './logger';
import { transaction, type Runtime } from './runtime';
import { exchangeRate } from './schema';

/*
 * 汇率（规格 core「汇率」、R-FL-06、E-20、PRD 11.1 ExchangeRate）：
 * - 每日任务从欧洲央行取参考汇率（1 EUR 兑 USD、MXN、CAD），以 EUR 交叉计算 USD/MXN、USD/CAD 入库；
 *   欧洲央行取不到时改用 Frankfurter（数据同样来自欧洲央行），两者都取不到任务失败、按队列设置重试；
 * - 「按日期取汇率」：当天没有（周末、假日、还没公布、或两个来源都取不到）时取此前最近一个有汇率的日期，
 *   带实际日期与来源；不取之后的日期。
 * 外部客户端在 integration（exchangeRateClient）；core 不能依赖 integration，所以这里只定义要用的接口，
 * 由入口把客户端交给任务处理器（apps/server/src/jobs.ts）。
 */

/** 欧洲央行最早的参考汇率日期：库里还没有汇率时，第一次同步从这里取全量历史（历史导入也能按原日期折算） */
export const RATE_HISTORY_START = '1999-01-04';

/** 欧洲央行一天的参考汇率：1 EUR = 这么多 USD、CAD、MXN（十进制字符串） */
export interface EurReferenceRates {
  readonly date: string;
  readonly usd: string;
  readonly cad: string;
  readonly mxn: string;
}

/** 日期区间（含两端，YYYY-MM-DD） */
export interface DateRange {
  readonly from: string;
  readonly to: string;
}

/** 汇率的两个来源（integration 的 exchangeRateClient 实现它；测试里是 Fake） */
export interface ExchangeRateSource {
  /** 欧洲央行（主源）：区间内有汇率的日子 */
  ecbRates(range: DateRange): Promise<EurReferenceRates[]>;
  /** Frankfurter（备用源，只取欧洲央行的数据）：区间内有汇率的日子 */
  frankfurterRates(range: DateRange): Promise<EurReferenceRates[]>;
}

const eurRateOf: Record<ForeignCurrency, keyof Omit<EurReferenceRates, 'date' | 'usd'>> = {
  CAD: 'cad',
  MXN: 'mxn',
};

/**
 * 某币种在某日可用的汇率：当天有就取当天，否则取此前最近一个有汇率的日期（E-20）；一个都没有为 null
 */
export async function exchangeRateOn(
  db: DbExecutor,
  currency: ForeignCurrency,
  date: string,
): Promise<ExchangeRate | null> {
  const [row] = await db
    .select({ rate: exchangeRate.rate, date: exchangeRate.date, source: exchangeRate.source })
    .from(exchangeRate)
    .where(and(eq(exchangeRate.currency, currency), lte(exchangeRate.date, date)))
    .orderBy(desc(exchangeRate.date))
    .limit(1);
  return row ?? null;
}

/** 某日可用的各币种汇率（新建登记抽屉即时折算用） */
export async function exchangeRatesOn(db: DbExecutor, date: string): Promise<ExchangeRatesOn> {
  const [CAD, MXN] = await Promise.all(foreignCurrencies.map((c) => exchangeRateOn(db, c, date)));
  return { date, rates: { CAD: CAD ?? null, MXN: MXN ?? null } };
}

/** 一次同步的结果 */
export interface ExchangeRateSyncReport {
  readonly range: DateRange | null;
  /** 用了哪个来源；区间为空（已是最新）时为 null */
  readonly source: 'ecb' | 'frankfurter' | null;
  /** 新写入的汇率行数（每天每币种一行） */
  readonly stored: number;
}

/**
 * 同步汇率：从库里最近一个有汇率的日期的次日（库里没有时从 RATE_HISTORY_START）取到今天（北京时间），
 * 先欧洲央行、失败改 Frankfurter，两者都失败抛错（不写任何数据，按日期取汇率时自然回退到此前的日期）。
 * 已有的日期不覆盖：汇率只增不改，已保存的金额冻结了自己的汇率，不受影响（E-20「恢复后不回改」）。
 */
export async function syncExchangeRates(
  runtime: Runtime,
  source: ExchangeRateSource,
  logger: Logger,
): Promise<ExchangeRateSyncReport> {
  const [latest] = await runtime.db.select({ date: max(exchangeRate.date) }).from(exchangeRate);
  const to = businessDate(runtime.clock.now());
  const from = latest?.date ? addDays(latest.date, 1) : RATE_HISTORY_START;
  if (from > to) return { range: null, source: null, stored: 0 };
  const range = { from, to };

  let used: 'ecb' | 'frankfurter' = 'ecb';
  let days: EurReferenceRates[];
  try {
    days = await source.ecbRates(range);
  } catch (ecbError) {
    logger.warn({ err: ecbError, range }, '欧洲央行汇率取不到，改用备用源 Frankfurter');
    used = 'frankfurter';
    try {
      days = await source.frankfurterRates(range);
    } catch (fallbackError) {
      throw new Error(
        `汇率主源（欧洲央行）与备用源（Frankfurter）都取不到。主源：${String(ecbError)}；备用源：${String(fallbackError)}`,
        { cause: fallbackError },
      );
    }
  }

  const rows = days
    .filter((day) => day.date >= from && day.date <= to)
    .flatMap((day) =>
      foreignCurrencies.map((currency) => ({
        date: day.date,
        currency,
        rate: crossRate(day.usd, day[eurRateOf[currency]]),
        source: used,
      })),
    );
  if (rows.length === 0) return { range, source: used, stored: 0 };
  const stored = await transaction(runtime, async (tx) => {
    const inserted = await tx.db
      .insert(exchangeRate)
      .values(rows.map((row) => ({ ...row, createdAt: tx.now })))
      .onConflictDoNothing({ target: [exchangeRate.date, exchangeRate.currency] })
      .returning({ id: exchangeRate.id });
    return inserted.length;
  });
  return { range, source: used, stored };
}

/**
 * 每日同步汇率（北京时间 06:00，同 P26 示例「汇率 09-11 06:00」：欧洲央行约在中欧时间 16:00 公布当天的参考汇率，
 * 即北京时间 22:00–23:00）。worker 启动时也排一次（首次部署不用等到次日）。两个来源都失败时任务失败，
 * 30 分钟后重试，最多 3 次；同时最多一个在排队、一个在跑。
 */
export const syncExchangeRatesJob = defineJob(
  'core.sync_exchange_rates',
  z.object({}),
  { policy: 'stately', retryLimit: 3, retryDelay: 1800 },
  { cron: '0 6 * * *', tz: 'Asia/Shanghai', runAtStartup: true },
);

/** core 的任务处理器；汇率来源由入口给出（integration 的 exchangeRateClient，测试里是 Fake） */
export function createCoreJobHandlers(deps: {
  exchangeRates: () => ExchangeRateSource;
}): AnyJobHandler[] {
  return [
    handleJob(syncExchangeRatesJob, async (_payload, context) => {
      const report = await syncExchangeRates(context.runtime, deps.exchangeRates(), context.logger);
      context.logger.info(report, '汇率已同步');
    }),
  ];
}
