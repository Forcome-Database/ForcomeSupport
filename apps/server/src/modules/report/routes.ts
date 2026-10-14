import { apiErrorSchema, reportQuerySchema, ticketReportSchema } from '@forcome/contracts';
import { createRoute, OpenAPIHono, type z } from '@hono/zod-openapi';
import { storeAccessTarget } from '../channel';
import type { AppEnv, Runtime } from '../core';
import { requireCapability, requireSession, type AccessVariables } from '../org';
import { ticketReport } from './tickets';

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

const ticketsRoute = createRoute({
  method: 'get',
  path: '/api/reports/tickets',
  summary:
    'P17 报表的工单部分（PRD P17「指标口径」「第一阶段」v2.34、K19）：店铺范围内按期间（近 7 天默认 / 本月 / 自定义）、店铺、站点算出工单量、首响中位数、SLA 达标率（亚马逊）与上一周期、每日工单量，另带「更新于」与 Shopify 回补的注',
  request: { query: reportQuerySchema },
  responses: {
    200: json(
      ticketReportSchema,
      '三个指标与上一周期、每日工单量、「更新于」、回补的注与服务端当前时刻',
    ),
    400: json(apiErrorSchema, '查询条件不对'),
    401: json(apiErrorSchema, '未登录或会话已失效'),
    403: json(
      apiErrorSchema,
      '没有「查看报表」能力（PRD 10.1：客服主管、售后负责人、知识库负责人、管理员），或店铺筛选选了范围外的店铺（E-24，记审计）',
    ),
  },
});

/** report 的接口：P17 的工单部分（有「查看报表」能力的成员）；售后成本卡与导出随待办 25 */
export function createReportRoutes(deps: { runtime: Runtime; appEnv: AppEnv }) {
  const { runtime, appEnv } = deps;
  const routes = new OpenAPIHono<{ Variables: AccessVariables }>();
  routes.use('/api/reports/*', requireSession(runtime, appEnv), requireCapability('report.view'));

  routes.openapi(ticketsRoute, async (c) => {
    const access = c.get('access');
    const query = c.req.valid('query');
    // 店铺筛选：范围外的店铺记越权审计并 403（E-24）
    if (query.store) await access.requireStores(storeAccessTarget(runtime.db, query.store));
    return c.json(await ticketReport(runtime.db, access.stores, query, runtime.clock.now()), 200);
  });

  return routes;
}
