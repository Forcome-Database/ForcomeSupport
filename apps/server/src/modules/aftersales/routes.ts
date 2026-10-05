import {
  aftersalesDetailSchema,
  apiErrorSchema,
  cancelInputSchema,
  exchangeRatesOnSchema,
  ledgerItemSchema,
  ledgerQuerySchema,
  ledgerSchema,
  rateChangeInputSchema,
  registrationInputSchema,
  registrationMessages,
  registrationOptionsSchema,
  registrationUpdateSchema,
  sourceTicketSchema,
  stripFinanceFields,
  versionInputSchema,
} from '@forcome/contracts';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { storeNamesById } from '../channel';
import { exchangeRatesOn, type AppEnv, type Runtime } from '../core';
import { listParts } from '../factory';
import {
  memberNamesById,
  requireCapability,
  requireSession,
  type Access,
  type AccessVariables,
} from '../org';
import { updateRegistration } from './edit';
import {
  completionOf,
  findAftersales,
  listLedger,
  toDetail,
  toLedgerItem,
  type AftersalesRow,
} from './ledger';
import { changeFeeRates } from './rates';
import { createRegistration, findSourceTicket, registrationOptions } from './registration';
import { cancelAftersales, completeAftersales, undoComplete } from './status';

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true },
});

const unauthenticated = json(apiErrorSchema, '未登录或会话已失效');
const forbidden = json(apiErrorSchema, '没有这项权限，或数据不在店铺范围内（E-24，记审计）');
const cannotRegister = json(
  apiErrorSchema,
  '不能新建登记（PRD 10.1：新建登记只有客服主管与售后负责人），或选了范围外的店铺、工单（E-24，记审计）',
);
const notFound = json(apiErrorSchema, '没有这张售后单');
const conflict = json(apiErrorSchema, '数据已被他人修改（G7）');
const numberParam = { params: z.object({ number: z.string().min(1).max(40) }) };

const ledgerRoute = createRoute({
  method: 'get',
  path: '/api/aftersales/ledger',
  summary:
    'P13 登记台账与当月登记完整率（店铺范围内；坐席只读、不含财务字段；完整率只随店铺范围与店铺筛选变化）',
  request: { query: ledgerQuerySchema },
  responses: {
    200: json(ledgerSchema, '台账（按售后单号先后）与当月登记完整率'),
    400: json(apiErrorSchema, '查询条件格式不对'),
    401: unauthenticated,
    403: forbidden,
  },
});

const detailRoute = createRoute({
  method: 'get',
  path: '/api/aftersales/{number}',
  summary: '一张售后单的完整登记（编辑登记抽屉 S14；坐席只读、不含财务字段）',
  request: numberParam,
  responses: {
    200: json(aftersalesDetailSchema, '登记'),
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});

const registerRoute = createRoute({
  method: 'post',
  path: '/api/aftersales/registrations',
  summary: '新建登记（S14：状态「进行中」、创建路径「手工登记」，记审计）',
  request: body(registrationInputSchema),
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

const updateRoute = createRoute({
  method: 'patch',
  path: '/api/aftersales/{number}',
  summary:
    '编辑登记与补登（进行中：登记人或负责人改全部字段；已完成：售后负责人补登空着的字段），可同时修改汇率（售后负责人）；记审计',
  request: { ...numberParam, ...body(registrationUpdateSchema) },
  responses: {
    200: json(aftersalesDetailSchema, '已保存'),
    400: json(
      apiErrorSchema,
      '填错：fields 同新建登记；补登改了已填的字段；汇率的错误在 rates.<费用项>',
    ),
    401: unauthenticated,
    403: json(
      apiErrorSchema,
      '没有权限（不是登记人或负责人、补登与改汇率不是售后负责人、已取消只读），或不在店铺范围内（E-24，记审计）',
    ),
    404: notFound,
    409: conflict,
  },
});

const completeRoute = createRoute({
  method: 'post',
  path: '/api/aftersales/{number}/complete',
  summary: '设为已完成（S15 ①：登记人或负责人，不要求字段齐全，记完成时间，5 秒内可撤销；记审计）',
  request: { ...numberParam, ...body(versionInputSchema) },
  responses: {
    200: json(ledgerItemSchema, '已完成（missing 为缺失的适用字段，「缺 N 项」）'),
    400: json(apiErrorSchema, '不是进行中的单（fields.status）'),
    401: unauthenticated,
    403: forbidden,
    404: notFound,
    409: conflict,
  },
});

const undoCompleteRoute = createRoute({
  method: 'post',
  path: '/api/aftersales/{number}/undo-complete',
  summary: '撤销设为已完成（S15 ①「撤销」：刚设为已完成的时限内，回到进行中；记审计）',
  request: { ...numberParam, ...body(versionInputSchema) },
  responses: {
    200: json(ledgerItemSchema, '已回到进行中'),
    400: json(apiErrorSchema, '已超过撤销时限，或这张单不是已完成（fields.status）'),
    401: unauthenticated,
    403: forbidden,
    404: notFound,
    409: conflict,
  },
});

const cancelRoute = createRoute({
  method: 'post',
  path: '/api/aftersales/{number}/cancel',
  summary:
    '取消售后单（S15 ②、AC-AS-16：客服主管或售后负责人，原因必填，确认保留的已产生费用；不能恢复；记审计）',
  request: { ...numberParam, ...body(cancelInputSchema) },
  responses: {
    200: json(ledgerItemSchema, '已取消'),
    400: json(
      apiErrorSchema,
      '原因没填或太长（fields.reason）、保留了没登记的费用（fields.keptFees）、不是进行中的单（fields.status）',
    ),
    401: unauthenticated,
    403: forbidden,
    404: notFound,
    409: conflict,
  },
});

const optionsRoute = createRoute({
  method: 'get',
  path: '/api/aftersales/registration-options',
  summary:
    '新建登记与编辑登记抽屉的选项：可选负责人（只露出查看者店铺范围内的部分）、责任类型的默认比例、生产厂、配件与所属生产厂',
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
    '某个费用发生日可用的汇率（新建登记与编辑登记抽屉即时折算；每个币种取当天，缺失时取此前最近一个有汇率的日期，E-20）',
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
  request: { ...numberParam, ...body(rateChangeInputSchema) },
  responses: {
    200: json(ledgerItemSchema, '已修改'),
    400: json(
      apiErrorSchema,
      '填错（fields 的键为 rates.<费用项>：汇率格式、美元金额、没登记的费用、这张单没有费用发生日；rates：已取消的单、没有要改的）',
    ),
    401: unauthenticated,
    403: json(apiErrorSchema, '不是售后负责人，或这张单不在店铺范围内（E-24，记审计）'),
    404: notFound,
    409: conflict,
  },
});

/** aftersales 的接口：P13 登记台账、新建登记、编辑登记与补登、设为已完成、取消与汇率（第一期） */
export function createAftersalesRoutes(deps: { runtime: Runtime; appEnv: AppEnv }) {
  const { runtime, appEnv } = deps;
  const routes = new OpenAPIHono<{ Variables: AccessVariables }>();
  routes.use('/api/aftersales/*', requireSession(runtime, appEnv));
  routes.use('/api/aftersales/*', requireCapability('aftersales.view'));
  for (const path of ['/api/aftersales/registrations', '/api/aftersales/source-tickets/*']) {
    routes.use(path, requireCapability('aftersales.register'));
  }
  // 抽屉的选项与即时折算：新建登记、编辑进行中的单、补登与改汇率的人都要用
  for (const path of ['/api/aftersales/registration-options', '/api/aftersales/exchange-rates']) {
    routes.use(
      path,
      requireCapability('aftersales.register', 'aftersales.edit_open', 'aftersales.backfill'),
    );
  }
  // 修改汇率与补登同一项能力（10.1「登记台账补登（已完成的单）、修改汇率」，只有售后负责人）
  routes.use('/api/aftersales/:number/rates', requireCapability('aftersales.backfill'));
  // 设为已完成与撤销：10.1「编辑进行中的手工登记单、设为已完成」（○ 登记人或负责人，归属由 aftersalesActions 再判断）
  routes.use('/api/aftersales/:number/complete', requireCapability('aftersales.edit_open'));
  routes.use('/api/aftersales/:number/undo-complete', requireCapability('aftersales.edit_open'));
  routes.use('/api/aftersales/:number/cancel', requireCapability('aftersales.cancel'));

  /** 一行台账（财务字段按查看者的权限过滤） */
  async function itemOf(access: Access, row: AftersalesRow) {
    const names = await storeNamesById(runtime.db, [row.storeId]);
    return stripFinanceFields(ledgerItemSchema, toLedgerItem(row, names), access.financeVisible);
  }

  /** 一张单的完整登记（财务字段按查看者的权限过滤） */
  async function detailOf(access: Access, row: AftersalesRow) {
    const [stores, members, parts] = await Promise.all([
      storeNamesById(runtime.db, [row.storeId]),
      memberNamesById(
        runtime.db,
        [row.registeredById, row.ownerId].filter((id): id is string => id !== null),
      ),
      listParts(runtime.db),
    ]);
    const partNames = new Map(parts.map((part) => [part.sku, part.name]));
    const detail = toDetail(row, stores.get(row.storeId) ?? '', members, partNames);
    return stripFinanceFields(aftersalesDetailSchema, detail, access.financeVisible);
  }

  routes.openapi(ledgerRoute, async (c) => {
    const access = c.get('access');
    const query = c.req.valid('query');
    // 店铺筛选：范围外的店铺记越权审计并 403（E-24）
    if (query.store) {
      await access.requireStores({
        storeIds: [query.store],
        objectType: 'store',
        objectId: query.store,
      });
    }
    const now = runtime.clock.now();
    const [items, completion] = await Promise.all([
      listLedger(runtime.db, access.stores, query, now),
      completionOf(runtime.db, access.stores, query.store, now),
    ]);
    return c.json(
      stripFinanceFields(ledgerSchema, { items, completion }, access.financeVisible),
      200,
    );
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
    return c.json(await itemOf(access, row), 200);
  });

  routes.openapi(detailRoute, async (c) => {
    const access = c.get('access');
    const { number } = c.req.valid('param');
    const row = await access.findOwned(
      (scope) => findAftersales(runtime.db, scope, number),
      (found) => ({
        storeIds: [found.storeId],
        objectType: 'aftersales',
        objectId: found.id,
        objectLabel: found.number,
      }),
    );
    if (!row) return c.json({ error: 'not_found', message: '没有这张售后单' }, 404);
    return c.json(await detailOf(access, row), 200);
  });

  routes.openapi(updateRoute, async (c) => {
    const access = c.get('access');
    const row = await updateRegistration(
      runtime,
      access,
      c.req.valid('param').number,
      c.req.valid('json'),
    );
    if (!row) return c.json({ error: 'not_found', message: '没有这张售后单' }, 404);
    return c.json(await detailOf(access, row), 200);
  });

  for (const [route, action] of [
    [completeRoute, completeAftersales],
    [undoCompleteRoute, undoComplete],
  ] as const) {
    routes.openapi(route, async (c) => {
      const access = c.get('access');
      const row = await action(runtime, access, c.req.valid('param').number, c.req.valid('json'));
      if (!row) return c.json({ error: 'not_found', message: '没有这张售后单' }, 404);
      return c.json(await itemOf(access, row), 200);
    });
  }

  routes.openapi(cancelRoute, async (c) => {
    const access = c.get('access');
    const row = await cancelAftersales(
      runtime,
      access,
      c.req.valid('param').number,
      c.req.valid('json'),
    );
    if (!row) return c.json({ error: 'not_found', message: '没有这张售后单' }, 404);
    return c.json(await itemOf(access, row), 200);
  });

  return routes;
}
