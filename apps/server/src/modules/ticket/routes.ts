import {
  apiErrorSchema,
  ticketDetailSchema,
  ticketListSchema,
  ticketNumberSchema,
} from '@forcome/contracts';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv, Runtime } from '../core';
import { requireCapability, requireSession, type AccessVariables } from '../org';
import { findTicketByNumber, listTickets, ticketDetail } from './queries';

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

const unauthenticated = json(apiErrorSchema, '未登录或会话已失效');
const forbidden = json(
  apiErrorSchema,
  '没有「查看工单」能力（PRD 10.1：坐席、客服主管、售后负责人、知识库负责人只读），或工单不在店铺范围内（E-24，记审计）',
);

const listRoute = createRoute({
  method: 'get',
  path: '/api/tickets',
  summary: 'P04 工单列表（第一阶段最简版：店铺范围内的工单；筛选、SLA 与分页随待办 18）',
  responses: {
    200: json(ticketListSchema, '按 待回复 → 等客户 → 已解决 → 已关闭、组内最近来信倒序'),
    401: unauthenticated,
    403: forbidden,
  },
});

const detailRoute = createRoute({
  method: 'get',
  path: '/api/tickets/{number}',
  summary: '工单与它的消息（P05 的全程记录、SLA、状态流转与订单卡随待办 17）',
  request: { params: z.object({ number: ticketNumberSchema }) },
  responses: {
    200: json(ticketDetailSchema, '工单与按到达时间排列的消息'),
    401: unauthenticated,
    403: forbidden,
    404: json(apiErrorSchema, '没有这张工单'),
  },
});

/** ticket 的接口：P04 工单列表与工单详情（有「查看工单」能力的成员） */
export function createTicketRoutes(deps: { runtime: Runtime; appEnv: AppEnv }) {
  const { runtime, appEnv } = deps;
  const routes = new OpenAPIHono<{ Variables: AccessVariables }>();
  routes.use('/api/tickets', requireSession(runtime, appEnv), requireCapability('ticket.view'));
  routes.use('/api/tickets/*', requireSession(runtime, appEnv), requireCapability('ticket.view'));

  routes.openapi(listRoute, async (c) =>
    c.json({ tickets: await listTickets(runtime.db, c.get('access').stores) }, 200),
  );

  routes.openapi(detailRoute, async (c) => {
    const { number } = c.req.valid('param');
    const found = await c.get('access').findOwned(
      (scope) => findTicketByNumber(runtime.db, scope, number),
      (row) => ({
        storeIds: [row.storeId],
        objectType: 'ticket',
        objectId: row.id,
        objectLabel: row.number,
      }),
    );
    if (!found) return c.json({ error: 'not_found', message: '没有这张工单' }, 404);
    return c.json(await ticketDetail(runtime.db, c.get('access').stores, found), 200);
  });

  return routes;
}
