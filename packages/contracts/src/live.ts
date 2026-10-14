import { z } from 'zod';

/*
 * 实时推送（ADR 0006「SSE」，待办 18）：数据变化时 api 经 SSE 推「某类对象变了」，不带数据，前端让对应的缓存失效后重新拉取
 * （带 BACKGROUND_REQUEST_HEADER，不续期会话）。
 */

/** 推送的地址（EventSource 连这里；会话照常校验，但连接本身不续期会话） */
export const LIVE_PATH = '/api/live';

/** SSE 的事件名：某类对象变了 */
export const LIVE_EVENT = 'change';

/** 开始监听后发的第一条（每次连上都有：浏览器据此全部重新拉取一次，补上取数与开始监听之间、断开期间的变化） */
export const LIVE_READY_EVENT = 'ready';

/** 断线、连接被拒后隔多久重连（SSE 的 retry，浏览器连接被拒时自己等同样久） */
export const LIVE_RETRY_MS = 5_000;

/**
 * 变了的是哪一类：
 * - tickets：工单（新建、追加来信、状态变化、回复识别、SLA 结果、标记无需回复；P04 列表与 P05 详情）
 * - unassigned_mail：未归属店铺来信队列（进队列、指定店铺、自动归位；P04 入口计数与队列）
 * - notifications：当前成员的站内通知（只推给接收人）
 * - resync：推送中断过（api 与数据库的监听重连），期间的变化可能漏了，全部重新拉取
 */
export const liveTopics = ['tickets', 'unassigned_mail', 'notifications', 'resync'] as const;
export const liveTopicSchema = z.enum(liveTopics);
export type LiveTopic = z.infer<typeof liveTopicSchema>;

/** 一条推送的内容（SSE data 的 JSON） */
export const liveEventSchema = z.object({ topic: liveTopicSchema });
export type LiveEvent = z.infer<typeof liveEventSchema>;
