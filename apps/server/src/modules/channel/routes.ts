import {
  apiErrorSchema,
  channelAlertsSchema,
  channelSettingsSchema,
  connectionTestKindSchema,
  connectionTestMessages,
  connectionTestResultSchema,
  storeInputSchema,
  storeOptionsSchema,
  storeSchema,
  storeUpdateSchema,
} from '@forcome/contracts';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv, Logger, Runtime } from '../core';
import { dingtalkClient, type IntegrationClients } from '../integration';
import {
  checkDingtalkDirectory,
  dingtalkConnection,
  requireCapability,
  requireSession,
  type AccessVariables,
} from '../org';
import { channelAlerts, channelCards, loadConnections } from './connections';
import { testGmailConnection } from './gmail-sync';
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

const alertsRoute = createRoute({
  method: 'get',
  path: '/api/channel/alerts',
  summary: '全站横幅（G4）：连接异常的渠道（钉钉除外，6.9）；所有登录成员都要看到，恢复后列表为空',
  responses: {
    200: json(channelAlertsSchema, '连接异常的渠道；没有时为空列表'),
    401: unauthenticated,
  },
});

const connectionTestRoute = createRoute({
  method: 'post',
  path: '/api/channel/connection-tests/{kind}',
  summary:
    '测试连接（K20）：Gmail 逐个进线邮箱试访问、测完立即排一次同步；钉钉取根部门。不改连接状态',
  request: { params: z.object({ kind: connectionTestKindSchema }) },
  responses: {
    200: json(connectionTestResultSchema, '全部可访问'),
    401: unauthenticated,
    403: forbidden,
    502: json(
      apiErrorSchema,
      '有访问不了的：message 写哪些（失败浮层「测试连接失败：<message>」）',
    ),
  },
});

/** channel 的接口：P18 渠道与店铺（管理员）与店铺选项、全站横幅（所有登录成员） */
export function createChannelRoutes(deps: {
  runtime: Runtime;
  appEnv: AppEnv;
  clients: IntegrationClients;
  logger: Logger;
}) {
  const { runtime, appEnv, clients, logger } = deps;
  const routes = new OpenAPIHono<{ Variables: AccessVariables }>();
  const session = requireSession(runtime, appEnv);
  const admin = requireCapability('settings.channels_team');
  routes.use('/api/channel/*', session);
  for (const path of [
    '/api/channel/settings',
    '/api/channel/stores',
    '/api/channel/stores/*',
    '/api/channel/connection-tests/*',
  ]) {
    routes.use(path, admin);
  }

  routes.openapi(settingsRoute, async (c) => {
    const now = runtime.clock.now();
    const stores = await listAllStores(runtime.db);
    const connections = await loadConnections(runtime.db, now);
    // 钉钉卡按通讯录的同步记录（org，待办 05）
    const dingtalk = await dingtalkConnection(runtime.db, now);
    return c.json(
      {
        channels: channelCards(stores, connections, {
          mode: clients.globalMode('dingtalk'),
          ...dingtalk,
        }),
        stores: stores.map((record) => toStore(record, connections)),
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
    return c.json(toStore(created, await loadConnections(runtime.db, runtime.clock.now())), 201);
  });

  routes.openapi(updateStoreRoute, async (c) => {
    const updated = await updateStore(
      { runtime, appEnv, actor: c.get('access').actor },
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    if (!updated) return c.json({ error: 'not_found', message: '没有这个店铺' }, 404);
    return c.json(toStore(updated, await loadConnections(runtime.db, runtime.clock.now())), 200);
  });

  routes.openapi(storeOptionsRoute, async (c) =>
    c.json({ stores: await listStoreOptions(runtime.db, c.get('access').stores) }, 200),
  );

  routes.openapi(alertsRoute, async (c) => {
    const connections = await loadConnections(runtime.db, runtime.clock.now());
    return c.json({ alerts: channelAlerts(connections) }, 200);
  });

  routes.openapi(connectionTestRoute, async (c) => {
    const { kind } = c.req.valid('param');
    if (kind === 'dingtalk') {
      const ok = await checkDingtalkDirectory(clients.global(dingtalkClient), logger);
      return ok
        ? c.json({ kind, targets: ['通讯录'] }, 200)
        : c.json(
            {
              error: 'connection_test_failed',
              message: connectionTestMessages.dingtalkUnreachable,
            },
            502,
          );
    }
    const result = await testGmailConnection(runtime, clients, logger);
    return result.unreachable.length === 0
      ? c.json({ kind, targets: result.reachable }, 200)
      : c.json(
          {
            error: 'connection_test_failed',
            message: connectionTestMessages.unreachable(result.unreachable),
          },
          502,
        );
  });

  return routes;
}
