import {
  apiErrorSchema,
  costReportSchema,
  EXPORT_ROWS_HEADER,
  reportQuerySchema,
  stripFinanceFields,
  ticketReportSchema,
  XLSX_CONTENT_TYPE,
} from '@forcome/contracts';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { storeAccessTarget } from '../channel';
import { xlsxDownloadHeaders, type AppEnv, type Runtime } from '../core';
import { requireCapability, requireSession, type Access, type AccessVariables } from '../org';
import { costReport } from './cost';
import { exportReport } from './export';
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

const forbidden = json(
  apiErrorSchema,
  '没有「查看报表」能力，或店铺筛选选了范围外的店铺（E-24，记审计）',
);

const costRoute = createRoute({
  method: 'get',
  path: '/api/reports/cost',
  summary:
    'P17「售后成本按责任类型」（PRD P17「第一阶段」v2.35、R-AS-08）：本月（费用发生日本月 1 日至今天）、店铺范围与店铺筛选内的售后成本，与 P13 合计行同一个视图（AC-RP-01）；不随时间与站点。成本是财务字段，没有财务权限的角色不返回 cost（AC-P1-09）',
  request: { query: reportQuerySchema.pick({ store: true }) },
  responses: {
    200: json(costReportSchema, '本月的售后成本（有财务权限时）与服务端当前时刻'),
    400: json(apiErrorSchema, '查询条件不对'),
    401: json(apiErrorSchema, '未登录或会话已失效'),
    403: forbidden,
  },
});

const exportRoute = createRoute({
  method: 'get',
  path: '/api/reports/export',
  summary:
    '导出报表（K5，PRD P17「第一阶段」v2.35）：按当前筛选与字段权限同步生成 xlsx 后直接下载，不留存文件；「售后成本按责任类型」只在有财务权限时有；记审计',
  request: { query: reportQuerySchema },
  responses: {
    200: {
      description: `Excel 文件（文件名在 Content-Disposition 的 filename*，各表数据行数之和在 ${EXPORT_ROWS_HEADER}）`,
      content: { [XLSX_CONTENT_TYPE]: { schema: z.string().openapi({ format: 'binary' }) } },
    },
    400: json(apiErrorSchema, '查询条件不对'),
    401: json(apiErrorSchema, '未登录或会话已失效'),
    403: forbidden,
  },
});

/** report 的接口：P17 的工单部分、售后成本与导出（有「查看报表」能力的成员；成本只给有财务权限的） */
export function createReportRoutes(deps: { runtime: Runtime; appEnv: AppEnv }) {
  const { runtime, appEnv } = deps;
  const routes = new OpenAPIHono<{ Variables: AccessVariables }>();
  routes.use('/api/reports/*', requireSession(runtime, appEnv), requireCapability('report.view'));

  /** 店铺筛选：范围外的店铺记越权审计并 403（E-24） */
  async function requireStoreFilter(access: Access, store: string | undefined) {
    if (store) await access.requireStores(storeAccessTarget(runtime.db, store));
  }

  routes.openapi(ticketsRoute, async (c) => {
    const access = c.get('access');
    const query = c.req.valid('query');
    await requireStoreFilter(access, query.store);
    return c.json(await ticketReport(runtime.db, access.stores, query, runtime.clock.now()), 200);
  });

  routes.openapi(costRoute, async (c) => {
    const access = c.get('access');
    const query = c.req.valid('query');
    await requireStoreFilter(access, query.store);
    const now = runtime.clock.now();
    // 没有财务权限的不查成本，输出里也不带（financeField，stripFinanceFields 照 ADR 0010 再过一遍）
    const cost = access.financeVisible
      ? await costReport(runtime.db, access.stores, query, now)
      : undefined;
    const body = { cost, now: now.toISOString() };
    return c.json(stripFinanceFields(costReportSchema, body, access.financeVisible), 200);
  });

  routes.openapi(exportRoute, async (c) => {
    const access = c.get('access');
    const query = c.req.valid('query');
    await requireStoreFilter(access, query.store);
    const file = await exportReport(runtime, access, query);
    return c.body(
      file.body,
      200,
      xlsxDownloadHeaders({ fileName: file.fileName, rows: file.rows }, 'report.xlsx'),
    );
  });

  return routes;
}
