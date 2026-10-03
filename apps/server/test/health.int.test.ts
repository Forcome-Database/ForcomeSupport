import { healthResponseSchema } from '@forcome/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { silentLogger } from '../src/modules/core';
import {
  createTestDatabase,
  createTestRuntime,
  type TestDatabase,
  type TestRuntime,
} from './database';

let database: TestDatabase;
let t: TestRuntime;

beforeAll(async () => {
  database = await createTestDatabase();
  t = await createTestRuntime(database.url);
});

afterAll(async () => {
  await t.close();
  await database.drop();
});

describe('api 健康检查', () => {
  it('连得上数据库时返回 ok，时间来自注入的时钟', async () => {
    t.clock.set('2026-09-11T02:20:00Z');
    const app = createApp({ runtime: t.runtime, logger: silentLogger });

    const res = await app.request('/api/health');

    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(await res.json());
    expect(body).toEqual({
      status: 'ok',
      checks: { database: 'ok' },
      time: '2026-09-11T02:20:00.000Z',
    });
  });
});
