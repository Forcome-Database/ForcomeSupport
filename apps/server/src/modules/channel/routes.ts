import {
  apiErrorSchema,
  channelSettingsSchema,
  storeInputSchema,
  storeOptionsSchema,
  storeSchema,
  storeUpdateSchema,
} from '@forcome/contracts';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv, Runtime } from '../core';
import type { IntegrationClients } from '../integration';
import { requireCapability, requireSession, type AccessVariables } from '../org';
import { channelCards } from './connections';
import { createStore, listAllStores, listStoreOptions, toStore, updateStore } from './stores';

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

const unauthenticated = json(apiErrorSchema, '未登录或会话已失效');
const forbidden = json(apiErrorSchema, '不是管理员（PRD 10.1：渠道与店铺只归管理员）');
const invalid = json(
  apiErrorSchema,
  '字段填错（K8）：fields 列出每个字段的错误——店铺名重复、平台标识为空、邮箱格式不对或已登记在其他店铺等',
);

const settingsRoute = createRoute({
  method: 'get',
  path: '/api/channel/settings',
  summary: 'P18 渠道与店铺：渠道卡、店铺表，以及是否显示「数据来源」',
  responses: {
    200: json(channelSettingsSchema, '渠道卡与全部店铺'),
    401: unauthenticated,
    403: forbidden,
  },
});

const createStoreRoute = createRoute({
  method: 'post',
  path: '/api/channel/stores',
  summary: '新增店铺（K8，记审计，发出「店铺已变更」）',
  request: {
    body: { content: { 'application/json': { schema: storeInputSchema } }, required: true },
  },
  responses: {
    201: json(storeSchema, '已新增'),
    400: invalid,
    401: unauthenticated,
    403: forbidden,
  },
});

const updateStoreRoute = createRoute({
  method: 'put',
  path: '/api/channel/stores/{id}',
  summary: '编辑店铺（K8，带打开时的版本号；记审计，发出「店铺已变更」）',
  request: {
    params: z.object({ id: z.uuid() }),
    body: { content: { 'application/json': { schema: storeUpdateSchema } }, required: true },
  },
  responses: {
    200: json(storeSchema, '已保存'),
    400: invalid,
    401: unauthenticated,
    403: forbidden,
    404: json(apiErrorSchema, '没有这个店铺'),
    409: json(apiErrorSchema, '别人先保存了（乐观锁冲突，G7）'),
  },
});

const storeOptionsRoute = createRoute({
  method: 'get',
  path: '/api/channel/store-options',
  summary: '当前成员店铺范围内的店铺（店铺筛选、指定店铺用）',
  responses: {
    200: json(storeOptionsSchema, '店铺范围内的店铺，按建立先后'),
    401: unauthenticated,
  },
});

/** channel 的接口：P18 渠道与店铺（管理员）与店铺选项（所有登录成员） */
export function createChannelRoutes(deps: {
  runtime: Runtime;
  appEnv: AppEnv;
  clients: IntegrationClients;
}) {
  const { runtime, appEnv, clients } = deps;
  const routes = new OpenAPIHono<{ Variables: AccessVariables }>();
  const session = requireSession(runtime, appEnv);
  const admin = requireCapability('settings.channels_team');
  routes.use('/api/channel/*', session);
  for (const path of ['/api/channel/settings', '/api/channel/stores', '/api/channel/stores/*']) {
    routes.use(path, admin);
  }

  routes.openapi(settingsRoute, async (c) => {
    const stores = await listAllStores(runtime.db);
    return c.json(
      {
        channels: channelCards(stores, clients.globalMode('dingtalk')),
        stores: stores.map(toStore),
        dataSourceEditable: appEnv !== 'production',
      },
      200,
    );
  });

  routes.openapi(createStoreRoute, async (c) => {
    const created = await createStore(
      { runtime, appEnv, actor: c.get('access').actor },
      c.req.valid('json'),
    );
    return c.json(toStore(created), 201);
  });

  routes.openapi(updateStoreRoute, async (c) => {
    const updated = await updateStore(
      { runtime, appEnv, actor: c.get('access').actor },
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    if (!updated) return c.json({ error: 'not_found', message: '没有这个店铺' }, 404);
    return c.json(toStore(updated), 200);
  });

  routes.openapi(storeOptionsRoute, async (c) =>
    c.json({ stores: await listStoreOptions(runtime.db, c.get('access').stores) }, 200),
  );

  return routes;
}
