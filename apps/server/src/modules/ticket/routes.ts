import {
  apiErrorSchema,
  ticketDetailSchema,
  ticketListSchema,
  ticketNumberSchema,
} from '@forcome/contracts';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { AppEnv, Runtime } from '../core';
import { requireCapability, requireSession, type Access, type AccessVariables } from '../org';
import { ticketDetail } from './detail';
import { markNoReply, NoReplyRefusedError, undoNoReply } from './no-reply';
import { findTicketByNumber, listTickets } from './queries';

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

const unauthenticated = json(apiErrorSchema, '未登录或会话已失效');
const forbidden = json(
  apiErrorSchema,
  '没有「查看工单」能力（PRD 10.1：坐席、客服主管、售后负责人、知识库负责人只读），或工单不在店铺范围内（E-24，记审计）',
);
const notFound = json(apiErrorSchema, '没有这张工单，或工单里没有这封来信');

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

const numberParam = { params: z.object({ number: ticketNumberSchema }) };

const detailRoute = createRoute({
  method: 'get',
  path: '/api/tickets/{number}',
  summary:
    'P05 工单详情（I18）：工单、消息（正文、首次回复、SLA、无需回复）、事件行、状态流转、自动关闭预计与订单卡',
  request: numberParam,
  responses: {
    200: json(ticketDetailSchema, '工单详情'),
    401: unauthenticated,
    403: forbidden,
    404: json(apiErrorSchema, '没有这张工单'),
  },
});

const letterParams = {
  params: z.object({ number: ticketNumberSchema, messageId: z.uuid() }),
};

const markRoute = createRoute({
  method: 'post',
  path: '/api/tickets/{number}/messages/{messageId}/no-reply',
  summary:
    '标记无需回复（P05「第一阶段」、AC-P1-01：坐席、客服主管，只对未关闭工单中的未回复来信；不计入 SLA，全部未回复来信都被标记后工单转已解决；记审计）',
  request: letterParams,
  responses: {
    200: json(ticketDetailSchema, '标记后的工单详情'),
    400: json(apiErrorSchema, '工单已关闭，或这封来信已被回复'),
    401: unauthenticated,
    403: json(
      apiErrorSchema,
      '没有「标记无需回复」能力（PRD 10.1：坐席、客服主管），或工单不在店铺范围内（E-24，记审计）',
    ),
    404: notFound,
    409: json(apiErrorSchema, '这封来信已被标记无需回复（message 写是谁标记的）'),
  },
});

const undoRoute = createRoute({
  method: 'post',
  path: '/api/tickets/{number}/messages/{messageId}/undo-no-reply',
  summary:
    '撤销标记无需回复（5 秒内、标记的人：恢复计时，工单已解决且又有未回复来信时回到待回复；记审计）',
  request: letterParams,
  responses: {
    200: json(ticketDetailSchema, '撤销后的工单详情'),
    400: json(apiErrorSchema, '已超过撤销时限，或这封来信没有标记'),
    401: unauthenticated,
    403: json(
      apiErrorSchema,
      '没有「标记无需回复」能力，不是标记的人，或工单不在店铺范围内（E-24，记审计）',
    ),
    404: notFound,
  },
});

/** ticket 的接口：P04 工单列表、P05 工单详情（有「查看工单」能力的成员）与标记无需回复（坐席、客服主管） */
export function createTicketRoutes(deps: { runtime: Runtime; appEnv: AppEnv }) {
  const { runtime, appEnv } = deps;
  const routes = new OpenAPIHono<{ Variables: AccessVariables }>();
  routes.use('/api/tickets', requireSession(runtime, appEnv), requireCapability('ticket.view'));
  routes.use('/api/tickets/*', requireSession(runtime, appEnv), requireCapability('ticket.view'));
  for (const path of [
    '/api/tickets/:number/messages/:messageId/no-reply',
    '/api/tickets/:number/messages/:messageId/undo-no-reply',
  ]) {
    routes.use(path, requireCapability('ticket.mark_no_reply'));
  }

  /** 按工单号取工单；范围外的记越权审计并 403（findOwned），没有为 null */
  function findOwnedTicket(access: Access, number: string) {
    return access.findOwned(
      (scope) => findTicketByNumber(runtime.db, scope, number),
      (row) => ({
        storeIds: [row.storeId],
        objectType: 'ticket',
        objectId: row.id,
        objectLabel: row.number,
      }),
    );
  }

  async function detailResponse(c: Context<{ Variables: AccessVariables }>, number: string) {
    const access = c.get('access');
    const found = await findOwnedTicket(access, number);
    if (!found) return c.json({ error: 'not_found', message: '没有这张工单' }, 404);
    return c.json(await ticketDetail(runtime.db, access.stores, found, runtime.clock.now()), 200);
  }

  routes.openapi(listRoute, async (c) =>
    c.json({ tickets: await listTickets(runtime.db, c.get('access').stores) }, 200),
  );

  routes.openapi(detailRoute, (c) => detailResponse(c, c.req.valid('param').number));

  const ERROR_CODES = { 400: 'invalid_request', 404: 'not_found', 409: 'conflict' } as const;

  /**
   * 标记或撤销：先按店铺范围取出工单，做完返回最新的详情；被拒的写明原因（只放行该接口声明过的状态码，其余照常抛出）
   */
  async function noReplyAction<S extends NoReplyRefusedError['status']>(
    c: Context<{ Variables: AccessVariables }>,
    params: { number: string; messageId: string },
    action: typeof markNoReply,
    refusals: readonly S[],
  ) {
    const access = c.get('access');
    const found = await findOwnedTicket(access, params.number);
    if (!found) return c.json({ error: 'not_found', message: '没有这张工单' }, 404);
    if (access.actor.kind !== 'member') throw new Error('标记无需回复要由成员操作');
    try {
      await action(runtime, access.actor, found, params.messageId);
    } catch (error) {
      const status = error instanceof NoReplyRefusedError ? error.status : null;
      if (!status || !(refusals as readonly number[]).includes(status)) throw error;
      const refusal = error as NoReplyRefusedError;
      return c.json({ error: ERROR_CODES[status], message: refusal.message }, status as S);
    }
    return detailResponse(c, params.number);
  }

  routes.openapi(markRoute, (c) =>
    noReplyAction(c, c.req.valid('param'), markNoReply, [400, 404, 409] as const),
  );
  routes.openapi(undoRoute, (c) =>
    noReplyAction(c, c.req.valid('param'), undoNoReply, [400, 404] as const),
  );

  return routes;
}
