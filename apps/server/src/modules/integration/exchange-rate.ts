import { addDays, isWeekday } from '@forcome/calendar';
import type { DemoFixture } from '@forcome/fixtures';
import Big from 'big.js';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import type { DateRange, EurReferenceRates, ExchangeRateSource } from '../core';
import { defineClient, type FakeClient } from './definition';
import { ExternalCallFailedError, FaultInjector } from './faults';
import { createHttpClient, type HttpClient } from './http';

/*
 * 汇率客户端（规格 core「汇率」、R-FL-06；全局客户端，按 CLIENT_MODE_EXCHANGE_RATE 选择）：
 * - 欧洲央行（主源）：公开的参考汇率文件 eurofxref-daily.xml（最近一天）、eurofxref-hist-90d.xml（近 90 天）、
 *   eurofxref-hist.xml（1999 年起的全量），按要取的区间挑最小的那个；
 * - Frankfurter（备用源）：api.frankfurter.dev 的 v2/rates，只取欧洲央行（providers=ECB）的数据。
 * 两者都给出 1 EUR 兑 USD、CAD、MXN；交叉计算与入库在 core（syncExchangeRates）。都不需要凭据，经出站代理访问。
 */

/** 汇率客户端的接口就是 core 要用的两个来源 */
export type ExchangeRateClient = ExchangeRateSource;

const ECB_BASE = 'https://www.ecb.europa.eu/stats/eurofxref/';
const FRANKFURTER_RATES = 'https://api.frankfurter.dev/v2/rates';
/** 区间起点在这么多天以内时先看最近一天与近 90 天的文件，更早直接取全量 */
const ECB_RECENT_DAYS = 85;
/** 全量历史文件约 8 MB */
const ECB_HISTORY_TIMEOUT_MS = 120_000;

const decimal = z.string().regex(/^\d+(\.\d+)?$/);

/** 欧洲央行文件的结构（去掉命名空间前缀后）：Envelope > Cube > Cube[time] > Cube[currency, rate] */
const ecbDocumentSchema = z.object({
  Envelope: z.object({
    Cube: z.tuple([
      z.object({
        Cube: z.array(
          z.object({
            time: z.iso.date(),
            Cube: z.array(z.object({ currency: z.string(), rate: decimal })),
          }),
        ),
      }),
    ]),
  }),
});

const frankfurterSchema = z.array(
  z.object({
    date: z.iso.date(),
    base: z.literal('EUR'),
    quote: z.string(),
    rate: z.number().positive(),
  }),
);

const ecbParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  removeNSPrefix: true,
  isArray: (name) => name === 'Cube',
});

function unrecognized(operation: string, detail: string): ExternalCallFailedError {
  return new ExternalCallFailedError('exchange_rate', operation, {
    message: `返回内容不认识：${detail}`,
    retryable: false,
  });
}

/** 一天的 USD、CAD、MXN 齐了才算数（欧洲央行一直公布这三种），缺了说明格式变了 */
function eurRatesOf(
  date: string,
  quotes: ReadonlyMap<string, string>,
  operation: string,
): EurReferenceRates {
  const usd = quotes.get('USD');
  const cad = quotes.get('CAD');
  const mxn = quotes.get('MXN');
  if (!usd || !cad || !mxn) throw unrecognized(operation, `${date} 缺 USD、CAD 或 MXN`);
  return { date, usd, cad, mxn };
}

/** 解析欧洲央行的参考汇率文件 */
export function parseEcbRates(xml: string, operation: string): EurReferenceRates[] {
  let parsed: unknown;
  try {
    parsed = ecbParser.parse(xml);
  } catch (error) {
    throw unrecognized(operation, String(error));
  }
  const document = ecbDocumentSchema.safeParse(parsed);
  if (!document.success) throw unrecognized(operation, '不是欧洲央行的参考汇率文件');
  return document.data.Envelope.Cube[0].Cube.map((day) =>
    eurRatesOf(day.time, new Map(day.Cube.map((c) => [c.currency, c.rate])), operation),
  );
}

/** 解析 Frankfurter v2/rates 的返回（每天每个币种一条，按日期合并） */
export function parseFrankfurterRates(json: unknown, operation: string): EurReferenceRates[] {
  const parsed = frankfurterSchema.safeParse(json);
  if (!parsed.success) throw unrecognized(operation, '不是 Frankfurter 的汇率列表');
  const byDate = new Map<string, Map<string, string>>();
  for (const row of parsed.data) {
    const quotes = byDate.get(row.date) ?? new Map<string, string>();
    quotes.set(row.quote, String(row.rate));
    byDate.set(row.date, quotes);
  }
  return [...byDate].map(([date, quotes]) => eurRatesOf(date, quotes, operation));
}

/** [from, until) 之间没有工作日：这段日子本来就没有参考汇率，不缺数据 */
function noWeekdayBetween(from: string, until: string): boolean {
  for (let date = from; date < until; date = addDays(date, 1)) {
    if (isWeekday(date)) return false;
  }
  return true;
}

const within = (days: readonly EurReferenceRates[], range: DateRange) =>
  days.filter((day) => day.date >= range.from && day.date <= range.to);

/** 真实现：欧洲央行按区间挑文件，Frankfurter 一次取整个区间 */
export function createRealExchangeRateClient(http: HttpClient): ExchangeRateClient {
  const ecbFile = async (file: string, timeoutMs?: number) =>
    parseEcbRates(await http.getText(`${ECB_BASE}${file}`, { operation: file, timeoutMs }), file);

  return {
    async ecbRates(range) {
      if (range.from >= addDays(range.to, -ECB_RECENT_DAYS)) {
        // 最近一天的文件够用：它的日期之前、区间起点之后没有缺的工作日（或者根本没有新数据）
        const daily = await ecbFile('eurofxref-daily.xml');
        const latest = daily[0]?.date;
        if (!latest || noWeekdayBetween(range.from, latest)) return within(daily, range);
        const recent = await ecbFile('eurofxref-hist-90d.xml');
        const earliest = recent.reduce<string | null>(
          (min, day) => (min === null || day.date < min ? day.date : min),
          null,
        );
        if (earliest && noWeekdayBetween(range.from, earliest)) return within(recent, range);
      }
      return within(await ecbFile('eurofxref-hist.xml', ECB_HISTORY_TIMEOUT_MS), range);
    },
    async frankfurterRates(range) {
      const operation = 'v2/rates';
      const query = new URLSearchParams({
        from: range.from,
        to: range.to,
        base: 'EUR',
        quotes: 'USD,CAD,MXN',
        providers: 'ECB',
      });
      const json = await http.getJson(`${FRANKFURTER_RATES}?${query.toString()}`, {
        operation,
        timeoutMs: ECB_HISTORY_TIMEOUT_MS,
      });
      return within(parseFrankfurterRates(json, operation), range);
    },
  };
}

// ---------------------------------------------------------------- Fake

/** Fake 里 1 EUR = 1.10 USD；其余币种按「1 USD = x 原币」换成 EUR 基准，交叉计算后正好还原 */
const FAKE_EUR_USD = '1.10';
/** 回放示例数据时，从这天起每个工作日都有演示汇率 */
const DEMO_RATES_FROM = '2025-01-01';

/** 以美元表示的汇率（1 USD = x 原币） */
export interface UsdQuotes {
  readonly MXN: string;
  readonly CAD: string;
}

function eurRatesFromUsd(date: string, quotes: UsdQuotes): EurReferenceRates {
  const eur = new Big(FAKE_EUR_USD);
  return {
    date,
    usd: FAKE_EUR_USD,
    cad: eur.times(quotes.CAD).toString(),
    mxn: eur.times(quotes.MXN).toString(),
  };
}

/**
 * Fake 汇率：测试用 publish 公布某天的汇率（两个来源给的是同一份，同真实世界里 Frankfurter 转发欧洲央行），
 * 用 faults 让某个来源失败（操作名 ecb、frankfurter）。回放示例数据时从 DEMO_RATES_FROM 起每个工作日都是
 * 演示汇率（1 USD = 18.00 MXN、1.36 CAD），开发测试环境里新登记的比索、加元金额也能折算。
 */
export class FakeExchangeRates implements FakeClient<ExchangeRateClient> {
  readonly faults = new FaultInjector('exchange_rate');
  readonly #published = new Map<string, EurReferenceRates>();
  #demo: UsdQuotes | null = null;

  /** 公布某天的汇率 */
  publish(date: string, quotes: UsdQuotes): void {
    this.#published.set(date, eurRatesFromUsd(date, quotes));
  }

  #rates(range: DateRange): EurReferenceRates[] {
    const days = new Map(within([...this.#published.values()], range).map((d) => [d.date, d]));
    if (this.#demo) {
      const start = range.from > DEMO_RATES_FROM ? range.from : DEMO_RATES_FROM;
      for (let date = start; date <= range.to; date = addDays(date, 1)) {
        if (isWeekday(date) && !days.has(date)) days.set(date, eurRatesFromUsd(date, this.#demo));
      }
    }
    return [...days.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  client(): ExchangeRateClient {
    return {
      ecbRates: async (range) => {
        await this.faults.check('ecb');
        return this.#rates(range);
      },
      frankfurterRates: async (range) => {
        await this.faults.check('frankfurter');
        return this.#rates(range);
      },
    };
  }

  reset(): void {
    this.#published.clear();
    this.#demo = null;
    this.faults.reset();
  }

  replay(fixture: DemoFixture): void {
    this.#demo = fixture.exchangeRates.quotes;
  }
}

/** 汇率（全局，按 CLIENT_MODE_EXCHANGE_RATE 选择；不设时非生产为 Fake、生产为真实现） */
export const exchangeRateClient = defineClient({
  system: 'exchange_rate',
  scope: 'global',
  createReal: () => createRealExchangeRateClient(createHttpClient('exchange_rate')),
  createFake: () => new FakeExchangeRates(),
});
