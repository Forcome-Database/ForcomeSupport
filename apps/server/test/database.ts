import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import {
  ManualClock,
  silentLogger,
  startRuntime,
  type JobQueueRole,
  type Runtime,
} from '../src/modules/core';
import { databaseUrl, TEST_ADMIN_URL } from './database-url';

export interface TestDatabase {
  readonly name: string;
  readonly url: string;
  drop(): Promise<void>;
}

/** 从本次运行的模板库复制出一个已迁移的独立库（见 global-setup.ts） */
export async function createTestDatabase(): Promise<TestDatabase> {
  const template = inject('testTemplateDatabase');
  const name = `${template}_${randomBytes(4).toString('hex')}`;
  await withAdmin((admin) => admin.query(`CREATE DATABASE "${name}" TEMPLATE "${template}"`));
  return {
    name,
    url: databaseUrl(name),
    async drop() {
      await withAdmin((admin) => admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
    },
  };
}

async function withAdmin<T>(fn: (admin: pg.Client) => Promise<T>): Promise<T> {
  const admin = new pg.Client({ connectionString: TEST_ADMIN_URL });
  await admin.connect();
  try {
    return await fn(admin);
  } finally {
    await admin.end();
  }
}

export interface TestRuntime {
  readonly runtime: Runtime;
  readonly clock: ManualClock;
  close(): Promise<void>;
}

/** 连到测试库的运行时：手动时钟（默认停在原型演示时刻 2026-09-11 10:20 北京时间） */
export async function createTestRuntime(
  url: string,
  options: { role?: JobQueueRole; clock?: ManualClock } = {},
): Promise<TestRuntime> {
  const clock = options.clock ?? new ManualClock('2026-09-11T02:20:00Z');
  const { runtime, stop } = await startRuntime(url, {
    role: options.role ?? 'api',
    logger: silentLogger,
    clock,
    poolMax: 5,
  });
  return { runtime, clock, close: () => stop({ graceful: false }) };
}
