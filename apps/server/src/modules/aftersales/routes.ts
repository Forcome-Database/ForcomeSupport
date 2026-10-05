import {
  apiErrorSchema,
  exchangeRatesOnSchema,
  ledgerItemSchema,
  ledgerSchema,
  rateChangeInputSchema,
  registrationInputSchema,
  registrationMessages,
  registrationOptionsSchema,
  sourceTicketSchema,
  stripFinanceFields,
} from '@forcome/contracts';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { storeNamesById } from '../channel';
import { exchangeRatesOn, type AppEnv, type Runtime } from '../core';
import { requireCapability, requireSession, type AccessVariables } from '../org';
import { listLedger, toLedgerItem } from './ledger';
import { changeFeeRates } from './rates';
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

const exchangeRatesRoute = createRoute({
  method: 'get',
  path: '/api/aftersales/exchange-rates',
  summary:
    '某个费用发生日可用的汇率（新建登记抽屉即时折算；每个币种取当天，缺失时取此前最近一个有汇率的日期，E-20）',
  request: { query: z.object({ date: z.iso.date() }) },
  responses: {
    200: json(
      exchangeRatesOnSchema,
      '各币种的汇率（1 USD = rate 原币，带实际日期与来源；一个都没有为 null）',
    ),
    400: json(apiErrorSchema, '日期格式不对'),
    401: unauthenticated,
    403: cannotRegister,
  },
});

const rateChangeRoute = createRoute({
  method: 'put',
  path: '/api/aftersales/{number}/rates',
  summary:
    '修改汇率（只有售后负责人，PRD 10.1；冻结美元值按新汇率重算，汇率日期为费用发生日、来源「手工修改」，记审计）',
  request: {
    params: z.object({ number: z.string().min(1).max(40) }),
    body: { content: { 'application/json': { schema: rateChangeInputSchema } }, required: true },
  },
  responses: {
    200: json(ledgerItemSchema, '已修改'),
    400: json(
      apiErrorSchema,
      '填错（fields 的键为 rates.<费用项>：汇率格式、美元金额、没登记的费用、这张单没有费用发生日；rates：已取消的单、没有要改的）',
    ),
    401: unauthenticated,
    403: json(apiErrorSchema, '不是售后负责人，或这张单不在店铺范围内（E-24，记审计）'),
    404: json(apiErrorSchema, '没有这张售后单'),
    409: json(apiErrorSchema, '数据已被他人修改（G7）'),
  },
});

/** aftersales 的接口：P13 登记台账、新建登记与汇率（第一期） */
export function createAftersalesRoutes(deps: { runtime: Runtime; appEnv: AppEnv }) {
  const { runtime, appEnv } = deps;
  const routes = new OpenAPIHono<{ Variables: AccessVariables }>();
  routes.use('/api/aftersales/*', requireSession(runtime, appEnv));
  routes.use('/api/aftersales/ledger', requireCapability('aftersales.view'));
  for (const path of [
    '/api/aftersales/registrations',
    '/api/aftersales/registration-options',
    '/api/aftersales/source-tickets/*',
    '/api/aftersales/exchange-rates',
  ]) {
    routes.use(path, requireCapability('aftersales.register'));
  }
  // 修改汇率与补登同一项能力（10.1「登记台账补登（已完成的单）、修改汇率」，只有售后负责人）
  routes.use('/api/aftersales/:number/rates', requireCapability('aftersales.backfill'));

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

  routes.openapi(exchangeRatesRoute, async (c) =>
    c.json(await exchangeRatesOn(runtime.db, c.req.valid('query').date), 200),
  );

  routes.openapi(rateChangeRoute, async (c) => {
    const access = c.get('access');
    const row = await changeFeeRates(
      runtime,
      access,
      c.req.valid('param').number,
      c.req.valid('json'),
    );
    if (!row) return c.json({ error: 'not_found', message: '没有这张售后单' }, 404);
    const names = await storeNamesById(runtime.db, [row.storeId]);
    const item = toLedgerItem(row, names);
    return c.json(stripFinanceFields(ledgerItemSchema, item, access.financeVisible), 200);
  });

  return routes;
}
