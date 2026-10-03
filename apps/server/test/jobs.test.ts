import { describe, expect, it } from 'vitest';
import { createJobHandlers, jobDefinitions } from '../src/jobs';
import { ManualClock, silentLogger, type Runtime } from '../src/modules/core';
import { IntegrationClients } from '../src/modules/integration';

describe('后台任务总表（jobs.ts）', () => {
  it('每个任务定义都有处理器，每个处理器的任务都已定义（migrate 建队列、worker 订阅用的是同一组）', () => {
    const handlers = createJobHandlers({
      runtime: { clock: new ManualClock('2026-09-11T02:20:00Z') } as unknown as Runtime,
      logger: silentLogger,
      config: { appEnv: 'test', devLoginEnabled: false },
      clients: new IntegrationClients({ appEnv: 'test' }),
    });
    expect(handlers.map((h) => h.job.name).sort()).toEqual(
      jobDefinitions.map((j) => j.name).sort(),
    );
    expect(new Set(jobDefinitions.map((j) => j.name)).size).toBe(jobDefinitions.length);
  });
});
