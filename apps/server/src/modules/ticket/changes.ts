import { announceChange, type Tx } from '../core';

/**
 * 工单变了（P04 列表、P05 详情经 SSE 自动刷新，待办 18）：写工单、工单消息或「标记无需回复」经过的地方都在同一事务里调用
 * （新建、追加、重开、状态迁移、回复识别、SLA 改为未达标、标记与撤销、重放来信清空）。同一事务里调用几次只送一次
 */
export function ticketsChanged(tx: Tx): Promise<void> {
  return announceChange(tx, { topic: 'tickets' });
}
