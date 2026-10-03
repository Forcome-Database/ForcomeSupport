import { healthResponseSchema } from '@forcome/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestHarness, type TestHarness } from './harness';

let t: TestHarness;

beforeAll(async () => {
  t = await startTestHarness();
});

afterAll(async () => {
  await t.close();
});

describe('api 健康检查', () => {
  it('连得上数据库时返回 ok，时间来自注入的时钟', async () => {
    t.clock.set('2026-09-11T02:20:00Z');

    const res = await t.api.get('/api/health');

    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(await res.json());
    expect(body).toEqual({
      status: 'ok',
      checks: { database: 'ok' },
      time: '2026-09-11T02:20:00.000Z',
    });
  });
});
