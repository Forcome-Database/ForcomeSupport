import { MockAgent } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CallRecordEntry } from './call-records';
import { ExternalCallFailedError } from './faults';
import { createHttpClient } from './http';

/*
 * 出站 HTTP 客户端工厂的两件事（待办 09，规格 integration 一节）：按「系统 × 接口」限流、每次调用写一条调用记录。
 * 代理、超时与错误翻译由各客户端的测试覆盖（汇率、钉钉、Gmail）。
 */

let agent: MockAgent;
let records: CallRecordEntry[];
const recorder = {
  record: (entry: CallRecordEntry) => {
    records.push(entry);
    return Promise.resolve();
  },
};

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  records = [];
});

afterEach(async () => {
  await agent.close();
});

describe('出站 HTTP 客户端工厂', () => {
  it('每次调用一条调用记录：成功、失败都记，地址不带查询串（可能有凭证），凭证类的响应体不留', async () => {
    const origin = agent.get('https://api.example.com');
    origin.intercept({ path: '/a?access_token=secret-1' }).reply(200, { ok: true });
    origin.intercept({ path: '/b' }).reply(503, 'busy');
    origin.intercept({ path: '/token', method: 'POST' }).reply(200, { access_token: 'secret-2' });
    const http = createHttpClient('example', { dispatcher: agent, recorder, storeId: 's-1' });

    await http.getJson('https://api.example.com/a?access_token=secret-1', { operation: 'a' });
    await expect(http.getText('https://api.example.com/b', { operation: 'b' })).rejects.toThrow(
      ExternalCallFailedError,
    );
    await http.postForm(
      'https://api.example.com/token',
      { grant_type: 'x' },
      { operation: 'token', secretResponse: true },
    );

    expect(
      records.map((r) => [r.system, r.operation, r.storeId, r.outcome, r.status, r.request]),
    ).toEqual([
      ['example', 'a', 's-1', 'ok', 200, 'GET https://api.example.com/a'],
      ['example', 'b', 's-1', 'failed', 503, 'GET https://api.example.com/b'],
      ['example', 'token', 's-1', 'ok', 200, 'POST https://api.example.com/token'],
    ]);
    expect(records[0]?.response).toBe('{"ok":true}');
    expect(records[1]?.response).toBe('busy');
    expect(JSON.stringify(records)).not.toContain('secret');
  });

  it('网络不通记为 network、没有状态码', async () => {
    const http = createHttpClient('example', { dispatcher: agent, recorder });
    await expect(
      http.getText('https://down.example.com/x', { operation: 'x' }),
    ).rejects.toMatchObject({ status: null, retryable: true });
    expect(records).toMatchObject([{ outcome: 'network', status: null }]);
  });

  it('按「系统 × 接口」限流：每秒 2 次的接口第 3 次排到 1 秒之后，别的接口不受影响', async () => {
    const origin = agent.get('https://limited.example.com');
    origin.intercept({ path: '/slow' }).reply(200, 'ok').times(3);
    origin.intercept({ path: '/other' }).reply(200, 'ok');
    const http = createHttpClient('limited', {
      dispatcher: agent,
      rateLimits: { slow: { perSecond: 2 } },
    });
    const started = performance.now();
    const finished: Record<string, number> = {};
    const timed = (key: string, url: string, operation: string) =>
      http.getText(url, { operation }).then(() => {
        finished[key] = performance.now() - started;
      });
    await Promise.all([
      timed('slow1', 'https://limited.example.com/slow', 'slow'),
      timed('slow2', 'https://limited.example.com/slow', 'slow'),
      timed('slow3', 'https://limited.example.com/slow', 'slow'),
      timed('other', 'https://limited.example.com/other', 'other'),
    ]);
    expect(finished.slow3).toBeGreaterThanOrEqual(950);
    expect(finished.other).toBeLessThan(500);
  });
});
