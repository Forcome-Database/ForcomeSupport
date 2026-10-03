import { healthResponseSchema, type HealthResponse } from '@forcome/contracts';
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { OptimisticLockError, type Logger, type Runtime } from './modules/core';

export interface AppDeps {
  runtime: Runtime;
  logger: Logger;
}

const DATABASE_CHECK_TIMEOUT_MS = 3_000;

const healthRoute = createRoute({
  method: 'get',
  path: '/api/health',
  summary: '健康检查',
  responses: {
    200: {
      description: '正常',
      content: { 'application/json': { schema: healthResponseSchema } },
    },
    503: {
      description: '数据库不可用',
      content: { 'application/json': { schema: healthResponseSchema } },
    },
  },
});

async function databaseIsUp(runtime: Runtime, logger: Logger): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      logger.warn({ timeoutMs: DATABASE_CHECK_TIMEOUT_MS }, '健康检查：数据库超时未响应');
      resolve(false);
    }, DATABASE_CHECK_TIMEOUT_MS);
  });
  const check = runtime.db.execute(sql`SELECT 1`).then(
    () => true,
    (error: unknown) => {
      logger.warn({ err: error }, '健康检查：数据库不可用');
      return false;
    },
  );
  try {
    return await Promise.race([check, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * HTTP 应用（ADR 0006）：接口用 contracts 的 zod 模式声明并生成 OpenAPI 文档。
 * 入口 api.ts 用它起服务；测试在进程内直接调用 app.request（规格「测试接缝」主接缝）。
 */
export function createApp({ runtime, logger }: AppDeps) {
  const app = new OpenAPIHono();

  app.openapi(healthRoute, async (c) => {
    const up = await databaseIsUp(runtime, logger);
    const body: HealthResponse = {
      status: up ? 'ok' : 'unavailable',
      checks: { database: up ? 'ok' : 'unavailable' },
      time: runtime.clock.now().toISOString(),
    };
    return up ? c.json(body, 200) : c.json(body, 503);
  });

  app.doc31('/api/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Forcome Support API', version: '0.0.0' },
  });

  app.onError((error, c) => {
    if (error instanceof OptimisticLockError) {
      return c.json({ error: 'optimistic_lock', message: error.message }, 409);
    }
    if (error instanceof HTTPException) {
      return error.getResponse();
    }
    logger.error({ err: error, path: c.req.path }, '未处理的接口错误');
    return c.json({ error: 'internal', message: '服务器内部错误' }, 500);
  });

  return app;
}
