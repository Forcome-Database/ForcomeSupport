import { MockAgent } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRealExchangeRateClient, FakeExchangeRates } from './exchange-rate';
import { ExternalCallFailedError, ExternalTimeoutError } from './faults';
import { createHttpClient } from './http';

/*
 * 汇率客户端的真实现（欧洲央行与 Frankfurter 的返回解析、按区间挑文件）与出站 HTTP 的错误翻译。
 * 不连外网：undici 的 MockAgent 按 URL 回放录好的返回，没登记的请求直接失败。
 */

const ECB = 'https://www.ecb.europa.eu';
const ECB_PATH = '/stats/eurofxref/';

/** 欧洲央行参考汇率文件的写法（节选，一天只列几个币种） */
function ecbXml(days: readonly { date: string; usd: string; cad: string; mxn?: string }[]): string {
  const cubes = days
    .map(
      (d) => `\t\t<Cube time='${d.date}'>
\t\t\t<Cube currency='USD' rate='${d.usd}'/>
\t\t\t<Cube currency='JPY' rate='158.12'/>
\t\t\t<Cube currency='CAD' rate='${d.cad}'/>
${d.mxn ? `\t\t\t<Cube currency='MXN' rate='${d.mxn}'/>\n` : ''}\t\t</Cube>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
\t<gesmes:subject>Reference rates</gesmes:subject>
\t<gesmes:Sender>
\t\t<gesmes:name>European Central Bank</gesmes:name>
\t</gesmes:Sender>
\t<Cube>
${cubes}
\t</Cube>
</gesmes:Envelope>`;
}

const SEP_11 = { date: '2026-09-11', usd: '1.0844', cad: '1.4750', mxn: '19.6532' };
const SEP_10 = { date: '2026-09-10', usd: '1.0851', cad: '1.4761', mxn: '19.7010' };
const SEP_09 = { date: '2026-09-09', usd: '1.0839', cad: '1.4744', mxn: '19.6402' };

let agent: MockAgent;
const client = () =>
  createRealExchangeRateClient(createHttpClient('exchange_rate', { dispatcher: agent }));
const ecb = () => agent.get(ECB);

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
});

afterEach(async () => {
  await agent.close();
});

describe('欧洲央行（主源）：按要取的区间挑最小的文件', () => {
  it('只差最近一天时只取 eurofxref-daily.xml，解析出 1 EUR 兑 USD、CAD、MXN', async () => {
    ecb()
      .intercept({ path: `${ECB_PATH}eurofxref-daily.xml` })
      .reply(200, ecbXml([SEP_11]));
    const days = await client().ecbRates({ from: '2026-09-11', to: '2026-09-11' });
    expect(days).toEqual([
      { date: '2026-09-11', usd: '1.0844', quotes: { CAD: '1.4750', MXN: '19.6532' } },
    ]);
    agent.assertNoPendingInterceptors();
  });

  it('上次之后只隔了周末：最近一天的文件就够（周六、周日本来没有参考汇率）', async () => {
    ecb()
      .intercept({ path: `${ECB_PATH}eurofxref-daily.xml` })
      .reply(200, ecbXml([{ ...SEP_11, date: '2026-09-14' }]));
    const days = await client().ecbRates({ from: '2026-09-12', to: '2026-09-14' });
    expect(days.map((d) => d.date)).toEqual(['2026-09-14']);
  });

  it('还没有新数据（最近一天早于区间起点）时返回空，不再取别的文件', async () => {
    ecb()
      .intercept({ path: `${ECB_PATH}eurofxref-daily.xml` })
      .reply(200, ecbXml([SEP_11]));
    expect(await client().ecbRates({ from: '2026-09-12', to: '2026-09-13' })).toEqual([]);
  });

  it('中间缺了工作日（之前的同步失败过）：改取近 90 天的文件，只留区间内的日子', async () => {
    ecb()
      .intercept({ path: `${ECB_PATH}eurofxref-daily.xml` })
      .reply(200, ecbXml([SEP_11]));
    ecb()
      .intercept({ path: `${ECB_PATH}eurofxref-hist-90d.xml` })
      .reply(200, ecbXml([SEP_11, SEP_10, SEP_09, { ...SEP_09, date: '2026-09-08' }]));
    const days = await client().ecbRates({ from: '2026-09-09', to: '2026-09-11' });
    expect(days.map((d) => d.date)).toEqual(['2026-09-11', '2026-09-10', '2026-09-09']);
    agent.assertNoPendingInterceptors();
  });

  it('区间起点在近 90 天以前（第一次同步、补历史）：直接取全量历史文件', async () => {
    ecb()
      .intercept({ path: `${ECB_PATH}eurofxref-hist.xml` })
      .reply(200, ecbXml([SEP_11, SEP_10, { ...SEP_09, date: '1999-01-04' }]));
    const days = await client().ecbRates({ from: '1999-01-04', to: '2026-09-11' });
    expect(days.map((d) => d.date)).toEqual(['2026-09-11', '2026-09-10', '1999-01-04']);
    agent.assertNoPendingInterceptors();
  });

  it('近 90 天的文件也不够早时再取全量', async () => {
    ecb()
      .intercept({ path: `${ECB_PATH}eurofxref-daily.xml` })
      .reply(200, ecbXml([SEP_11]));
    ecb()
      .intercept({ path: `${ECB_PATH}eurofxref-hist-90d.xml` })
      .reply(200, ecbXml([SEP_11, SEP_10]));
    ecb()
      .intercept({ path: `${ECB_PATH}eurofxref-hist.xml` })
      .reply(200, ecbXml([SEP_11, SEP_10, SEP_09]));
    const days = await client().ecbRates({ from: '2026-09-09', to: '2026-09-11' });
    expect(days.map((d) => d.date)).toEqual(['2026-09-11', '2026-09-10', '2026-09-09']);
    agent.assertNoPendingInterceptors();
  });

  it('服务端错误（503）是可重试的调用失败，带状态码', async () => {
    ecb()
      .intercept({ path: `${ECB_PATH}eurofxref-daily.xml` })
      .reply(503, 'busy');
    const error = await client()
      .ecbRates({ from: '2026-09-11', to: '2026-09-11' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExternalCallFailedError);
    expect(error).toMatchObject({ status: 503, retryable: true, system: 'exchange_rate' });
  });

  it('返回的不是参考汇率文件（例如代理的错误页）、一天都没有、或缺了 MXN：不可重试的「返回内容不认识」', async () => {
    ecb()
      .intercept({ path: `${ECB_PATH}eurofxref-daily.xml` })
      .reply(200, '<html><body>Access denied</body></html>');
    const page = await client()
      .ecbRates({ from: '2026-09-11', to: '2026-09-11' })
      .catch((e: unknown) => e);
    expect(page).toMatchObject({ retryable: false });
    expect(String(page)).toContain('返回内容不认识');
    ecb()
      .intercept({ path: `${ECB_PATH}eurofxref-daily.xml` })
      .reply(200, ecbXml([]));
    const empty = await client()
      .ecbRates({ from: '2026-09-11', to: '2026-09-11' })
      .catch((e: unknown) => e);
    expect(empty).toMatchObject({ retryable: false });
    expect(String(empty)).toContain('返回内容不认识');
    ecb()
      .intercept({ path: `${ECB_PATH}eurofxref-daily.xml` })
      .reply(200, ecbXml([{ date: '2026-09-11', usd: '1.0844', cad: '1.4750' }]));
    const noPeso = await client()
      .ecbRates({ from: '2026-09-11', to: '2026-09-11' })
      .catch((e: unknown) => e);
    expect(noPeso).toMatchObject({ retryable: false });
    expect(String(noPeso)).toContain('2026-09-11 缺 MXN');
  });
});

describe('Frankfurter（备用源）：v2/rates 只取欧洲央行的数据', () => {
  it('一次取整个区间，按日期合并成 1 EUR 兑 USD、CAD、MXN', async () => {
    agent
      .get('https://api.frankfurter.dev')
      .intercept({
        path: '/v2/rates',
        query: {
          from: '2026-09-10',
          to: '2026-09-11',
          base: 'EUR',
          quotes: 'USD,CAD,MXN',
          providers: 'ECB',
        },
      })
      .reply(200, [
        { date: '2026-09-10', base: 'EUR', quote: 'CAD', rate: 1.4761 },
        { date: '2026-09-10', base: 'EUR', quote: 'MXN', rate: 19.701 },
        { date: '2026-09-10', base: 'EUR', quote: 'USD', rate: 1.0851 },
        { date: '2026-09-11', base: 'EUR', quote: 'CAD', rate: 1.475 },
        { date: '2026-09-11', base: 'EUR', quote: 'MXN', rate: 19.6532 },
        { date: '2026-09-11', base: 'EUR', quote: 'USD', rate: 1.0844 },
      ]);
    const days = await client().frankfurterRates({ from: '2026-09-10', to: '2026-09-11' });
    expect(days).toEqual([
      { date: '2026-09-10', usd: '1.0851', quotes: { CAD: '1.4761', MXN: '19.701' } },
      { date: '2026-09-11', usd: '1.0844', quotes: { CAD: '1.475', MXN: '19.6532' } },
    ]);
  });

  it('返回格式不对是不可重试的失败', async () => {
    agent
      .get('https://api.frankfurter.dev')
      .intercept({ path: /^\/v2\/rates/ })
      .reply(200, { message: 'not found' });
    await expect(
      client().frankfurterRates({ from: '2026-09-11', to: '2026-09-11' }),
    ).rejects.toMatchObject({ retryable: false });
  });
});

describe('出站 HTTP 客户端的错误翻译', () => {
  it('网络不通是可重试、不带状态码的调用失败', async () => {
    ecb().intercept({ path: '/down' }).replyWithError(new Error('getaddrinfo ENOTFOUND'));
    const http = createHttpClient('exchange_rate', { dispatcher: agent });
    await expect(http.getText(`${ECB}/down`, { operation: 'down' })).rejects.toMatchObject({
      name: 'ExternalCallFailedError',
      status: null,
      retryable: true,
    });
  });

  it('超过时限以超时结束', async () => {
    ecb().intercept({ path: '/slow' }).reply(200, 'late').delay(200);
    const http = createHttpClient('exchange_rate', { dispatcher: agent });
    await expect(
      http.getText(`${ECB}/slow`, { operation: 'slow', timeoutMs: 20 }),
    ).rejects.toBeInstanceOf(ExternalTimeoutError);
  });
});

describe('Fake：两个来源给同一份数据，可分别注入故障', () => {
  it('按「1 USD = x 原币」公布的汇率换成 EUR 基准后交叉计算正好还原', async () => {
    const fake = new FakeExchangeRates();
    fake.publish('2026-09-10', { MXN: '18.00', CAD: '1.36' });
    expect(await fake.client().ecbRates({ from: '2026-09-01', to: '2026-09-30' })).toEqual([
      { date: '2026-09-10', usd: '1.10', quotes: { CAD: '1.496', MXN: '19.8' } },
    ]);
    fake.faults.failNext({ kind: 'error', status: 503 }, { operation: 'ecb' });
    await expect(
      fake.client().ecbRates({ from: '2026-09-10', to: '2026-09-10' }),
    ).rejects.toThrow();
    expect(
      await fake.client().frankfurterRates({ from: '2026-09-10', to: '2026-09-10' }),
    ).toHaveLength(1);
  });
});
