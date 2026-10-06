import { healthResponseSchema, type HealthResponse } from '@forcome/contracts';
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { ServerDeps } from './deps';
import { createAftersalesRoutes } from './modules/aftersales';
import { createChannelRoutes, listStoreChoices, storeNamesById } from './modules/channel';
import {
  AccessDeniedError,
  FieldValidationError,
  OptimisticLockError,
  type Logger,
  type Runtime,
} from './modules/core';
import {
  createAuditLogRoutes,
  createDevDingtalkRoutes,
  createDevLoginRoutes,
  createDevNotificationRoutes,
  createDingtalkLoginRoutes,
  createNotificationRoutes,
  createOrgRoutes,
  createTeamRoutes,
  devDingtalkScanAvailable,
  devLoginAvailable,
} from './modules/org';
import { createTicketRoutes } from './modules/ticket';

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
 * HTTP 应用（ADR 0006）：接口用 contracts 的 zod 模式声明并生成 OpenAPI 文档；各模块的接口从模块的
 * index.ts 取来挂上。入口 api.ts 用它起服务；测试在进程内直接调用 app.request（规格「测试接缝」主接缝）。
 */
export function createApp(deps: ServerDeps) {
  const { runtime, logger, config, clients } = deps;
  const app = new OpenAPIHono({
    // 请求参数不符合 contracts 的模式：400，写明哪里不对
    defaultHook: (result, c) => {
      if (!result.success) {
        const detail = result.error.issues
          .map((issue) => `${issue.path.join('.') || '请求'}：${issue.message}`)
          .join('；');
        return c.json({ error: 'invalid_request', message: `请求参数不对：${detail}` }, 400);
      }
    },
  });

  app.openapi(healthRoute, async (c) => {
    const up = await databaseIsUp(runtime, logger);
    const body: HealthResponse = {
      status: up ? 'ok' : 'unavailable',
      checks: { database: up ? 'ok' : 'unavailable' },
      time: runtime.clock.now().toISOString(),
    };
    return up ? c.json(body, 200) : c.json(body, 503);
  });

  app.route('/', createOrgRoutes({ runtime, appEnv: config.appEnv }));
  // P20 团队与权限在 org；授权可选的全部店铺由这里注入 channel 的查询（org 不依赖 channel）
  app.route(
    '/',
    createTeamRoutes({ runtime, appEnv: config.appEnv, storeChoices: listStoreChoices }),
  );
  // 钉钉扫码登录（G11、G12）：换出与开发登录同一种会话
  app.route('/', createDingtalkLoginRoutes({ runtime, appEnv: config.appEnv, clients, logger }));
  // 站内通知（G10）的铃铛面板：只看自己的通知，在 org（会话与店铺范围）；写入与查询在 core
  app.route('/', createNotificationRoutes({ runtime, appEnv: config.appEnv }));
  app.route('/', createChannelRoutes({ runtime, appEnv: config.appEnv, clients }));
  app.route('/', createTicketRoutes({ runtime, appEnv: config.appEnv }));
  app.route('/', createAftersalesRoutes({ runtime, appEnv: config.appEnv }));
  // P27 审计日志在 org（查看范围看角色、店铺范围与财务权限）；店铺名由这里注入 channel 的查询（org 不依赖 channel）
  app.route('/', createAuditLogRoutes({ runtime, appEnv: config.appEnv, storeNamesById }));
  if (devLoginAvailable(config)) {
    app.route('/', createDevLoginRoutes({ runtime, appEnv: config.appEnv }));
    // 示例通知与开发登录同一个开关（产生通知的业务上线前，演示与 Playwright 用）
    app.route('/', createDevNotificationRoutes({ runtime, appEnv: config.appEnv }));
  }
  if (devDingtalkScanAvailable(config, clients)) {
    // 模拟扫码：钉钉用 Fake 时，演示与 Playwright 走扫码登录的回调页
    app.route('/', createDevDingtalkRoutes({ clients, appEnv: config.appEnv }));
  }

  app.doc31('/api/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Forcome Support API', version: '0.0.0' },
  });

  app.notFound((c) => c.json({ error: 'not_found', message: '接口不存在' }, 404));

  app.onError((error, c) => {
    if (error instanceof AccessDeniedError) {
      return c.json({ error: 'forbidden', message: error.message }, 403);
    }
    if (error instanceof FieldValidationError) {
      return c.json(
        { error: 'invalid_request', message: error.message, fields: error.fields },
        400,
      );
    }
    if (error instanceof OptimisticLockError) {
      logger.info({ table: error.table, rowId: error.rowId }, '乐观锁冲突');
      return c.json({ error: 'optimistic_lock', message: '数据已被他人修改' }, 409);
    }
    if (error instanceof HTTPException) {
      // 自带响应的照原样返回；Hono 自己抛的按 contracts 的错误形状返回。接口只收 JSON，
      // 框架抛 400 只在请求体不是合法 JSON 时（Content-Type 不对时校验器跳过，由 zod 模式报 400）
      if (error.res) return error.getResponse();
      return error.status === 400
        ? c.json(
            { error: 'invalid_request', message: '请求参数不对：请求体必须是合法的 JSON' },
            400,
          )
        : c.json({ error: 'http_error', message: '请求失败' }, error.status);
    }
    logger.error({ err: error, path: c.req.path }, '未处理的接口错误');
    return c.json({ error: 'internal', message: '服务器内部错误' }, 500);
  });

  return app;
}
