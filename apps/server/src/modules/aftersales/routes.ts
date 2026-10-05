import {
  apiErrorSchema,
  ledgerItemSchema,
  ledgerSchema,
  registrationInputSchema,
  registrationMessages,
  registrationOptionsSchema,
  sourceTicketSchema,
  stripFinanceFields,
} from '@forcome/contracts';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { storeNamesById } from '../channel';
import type { AppEnv, Runtime } from '../core';
import { requireCapability, requireSession, type AccessVariables } from '../org';
import { listLedger, toLedgerItem } from './ledger';
import { createRegistration, findSourceTicket, registrationOptions } from './registration';

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

const unauthenticated = json(apiErrorSchema, '未登录或会话已失效');
const forbidden = json(apiErrorSchema, '没有这项权限，或数据不在店铺范围内（E-24，记审计）');
const cannotRegister = json(
  apiErrorSchema,
  '不能新建登记（PRD 10.1：新建登记只有客服主管与售后负责人），或选了范围外的店铺、工单（E-24，记审计）',
);

const ledgerRoute = createRoute({
  method: 'get',
  path: '/api/aftersales/ledger',
  summary: 'P13 登记台账（店铺范围内；坐席只读、不含财务字段）',
  responses: {
    200: json(ledgerSchema, '台账，按售后单号先后'),
    401: unauthenticated,
    403: forbidden,
  },
});

const registerRoute = createRoute({
  method: 'post',
  path: '/api/aftersales/registrations',
  summary: '新建登记（S14：状态「进行中」、创建路径「手工登记」，记审计）',
  request: {
    body: { content: { 'application/json': { schema: registrationInputSchema } }, required: true },
  },
  responses: {
    201: json(ledgerItemSchema, '已登记'),
    400: json(
      apiErrorSchema,
      '字段填错（S14）：fields 列出每个字段的错误——必填项、比例、额外赔偿、理由、生产厂、负责人、来源工单等',
    ),
    401: unauthenticated,
    403: cannotRegister,
  },
});

const optionsRoute = createRoute({
  method: 'get',
  path: '/api/aftersales/registration-options',
  summary:
    '新建登记抽屉的选项：可选负责人（只露出查看者店铺范围内的部分）、责任类型的默认比例、生产厂、配件与所属生产厂',
  responses: {
    200: json(registrationOptionsSchema, '选项'),
    401: unauthenticated,
    403: cannotRegister,
  },
});

const sourceTicketRoute = createRoute({
  method: 'get',
  path: '/api/aftersales/source-tickets/{number}',
  summary: '按工单号取来源工单（新建登记带入店铺、站点、订单号、客户）',
  request: { params: z.object({ number: z.string().min(1).max(40) }) },
  responses: {
    200: json(sourceTicketSchema, '来源工单'),
    401: unauthenticated,
    403: cannotRegister,
    404: json(apiErrorSchema, '没有这张工单'),
  },
});

/** aftersales 的接口：P13 登记台账与新建登记（第一期） */
export function createAftersalesRoutes(deps: { runtime: Runtime; appEnv: AppEnv }) {
  const { runtime, appEnv } = deps;
  const routes = new OpenAPIHono<{ Variables: AccessVariables }>();
  routes.use('/api/aftersales/*', requireSession(runtime, appEnv));
  routes.use('/api/aftersales/ledger', requireCapability('aftersales.view'));
  for (const path of [
    '/api/aftersales/registrations',
    '/api/aftersales/registration-options',
    '/api/aftersales/source-tickets/*',
  ]) {
    routes.use(path, requireCapability('aftersales.register'));
  }

  routes.openapi(ledgerRoute, async (c) => {
    const access = c.get('access');
    const ledger = { items: await listLedger(runtime.db, access.stores) };
    return c.json(stripFinanceFields(ledgerSchema, ledger, access.financeVisible), 200);
  });

  routes.openapi(registerRoute, async (c) => {
    const access = c.get('access');
    const { row, storeName } = await createRegistration(runtime, access, c.req.valid('json'));
    const item = toLedgerItem(row, new Map([[row.storeId, storeName]]));
    return c.json(stripFinanceFields(ledgerItemSchema, item, access.financeVisible), 201);
  });

  routes.openapi(optionsRoute, async (c) =>
    c.json(await registrationOptions(runtime.db, c.get('access').stores), 200),
  );

  routes.openapi(sourceTicketRoute, async (c) => {
    const found = await findSourceTicket(runtime, c.get('access'), c.req.valid('param').number);
    if (!found) {
      return c.json(
        { error: 'not_found', message: registrationMessages.sourceTicketNotFound },
        404,
      );
    }
    const names = await storeNamesById(runtime.db, [found.storeId]);
    return c.json(
      {
        number: found.number,
        store: { id: found.storeId, name: names.get(found.storeId) ?? '' },
        site: found.site,
        orderNumber: found.orderNumber,
        customerName: found.customerName,
      },
      200,
    );
  });

  return routes;
}
