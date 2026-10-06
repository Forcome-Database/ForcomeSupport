import { devNotificationResponseSchema, type NotificationContent } from '@forcome/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createJobHandlers } from '../src/jobs';
import { defineJob, handleJob, sendWorkNotificationsJob, transaction } from '../src/modules/core';
import { dingtalkClient } from '../src/modules/integration';
import { notifyMembers } from '../src/modules/org';
import { startTestHarness, type TestHarness } from './harness';

/*
 * 钉钉工作通知（待办 05；规格 core「钉钉工作通知发送（内容带对象编号与时间，同一人 5 分钟内合并）」、PRD 11.4「渠道」、ADR 0010）：
 * 11.4 里要同时发钉钉的通知类型（渠道连接异常、未归属店铺来信），按 11.4 发站内通知时（org 的 notifyMembers）一并排入；
 * 每分钟的发送任务把同一人最早一条已等满 5 分钟的全部待发合成一条发出。第一期产生这两类通知的业务随 09、15，
 * 这里经开发登录环境的示例通知接口（与业务调用方同一个 notifyMembers）产生；发送任务在测试里用 t.enqueue 显式排。
 */

const GMAIL_DOWN: NotificationContent = {
  type: 'channel_disconnected',
  title: 'Gmail 连接异常',
  body: 'support@forcome.mx 连续 3 次失败，来信暂存',
  object: { type: 'channel', id: 'gmail', label: 'P18 · Gmail' },
};
const SHOPIFY_DOWN: NotificationContent = {
  type: 'channel_disconnected',
  title: 'Shopify Admin API 连接异常',
  body: 'forcome.com 连续 3 次失败',
  object: { type: 'channel', id: 'shopify', label: 'P18 · Shopify Admin API' },
};

/** 示范的流水线任务（同 notifications.int.test.ts）：历史回放（26）在回放的运行时里跑它 */
const demoJob = defineJob('channel.demo_disconnected', z.object({}));
const demoHandler = handleJob(demoJob, async (_payload, { runtime }) => {
  await transaction(runtime, (tx) => notifyMembers(tx, GMAIL_DOWN));
});

let t: TestHarness;
const dingtalk = () => t.clients.fake(dingtalkClient);

/** 按 11.4 发一条通知（示例通知接口），返回发给了谁 */
async function notify(content: NotificationContent, at: string): Promise<string[]> {
  const res = await t.api.post('/api/dev/notifications', { ...content, at });
  expect(res.status).toBe(200);
  return devNotificationResponseSchema.parse(await res.json()).recipients;
}

/** 到某个时刻跑一次每分钟的发送任务 */
async function sendAt(at: string) {
  t.clock.set(at);
  await t.enqueue(sendWorkNotificationsJob, {});
  await t.runJobs();
}

beforeAll(async () => {
  t = await startTestHarness({ jobHandlers: (deps) => [...createJobHandlers(deps), demoHandler] });
});

afterAll(async () => {
  await t.close();
});

describe('同一人 5 分钟内的工作通知合并为一条', () => {
  it('10:20 与 10:22 两条渠道连接异常：10:24 还不发，10:25 每人合成一条（带对象与时间）', async () => {
    dingtalk().reset();
    const recipients = await notify(GMAIL_DOWN, '2026-09-11T10:20:00+08:00');
    // 11.4：管理员、客服主管（刘洋、周敏）
    expect(recipients).toHaveLength(2);
    await notify(SHOPIFY_DOWN, '2026-09-11T10:22:00+08:00');

    await sendAt('2026-09-11T10:24:59+08:00');
    expect(dingtalk().sent).toEqual([]);

    await sendAt('2026-09-11T10:25:00+08:00');
    const merged = [
      '【Forcome Support】2 条新通知',
      '· Gmail 连接异常：support@forcome.mx 连续 3 次失败，来信暂存（P18 · Gmail · 09-11 10:20）',
      '· Shopify Admin API 连接异常：forcome.com 连续 3 次失败（P18 · Shopify Admin API · 09-11 10:22）',
    ].join('\n');
    expect(dingtalk().sent.map((s) => [s.userIds, s.text])).toEqual(
      expect.arrayContaining([
        [['liuyang'], merged],
        [['zhoumin'], merged],
      ]),
    );
    expect(dingtalk().sent).toHaveLength(2);

    // 发过的不再发
    await sendAt('2026-09-11T10:40:00+08:00');
    expect(dingtalk().sent).toHaveLength(2);

    // 窗口发出之后再来的一条另开一个 5 分钟窗口：第一条进来时开始计时，到点合成发出（2026-10-06 用户确认）
    await notify(GMAIL_DOWN, '2026-09-11T10:41:00+08:00');
    await sendAt('2026-09-11T10:45:59+08:00');
    expect(dingtalk().sent).toHaveLength(2);
    await sendAt('2026-09-11T10:46:00+08:00');
    expect(dingtalk().sent).toHaveLength(4);
    // 只有这一条：单条的写法，不是「N 条新通知」
    expect(
      dingtalk()
        .sent.slice(2)
        .map((s) => s.text.split('\n')[0]),
    ).toEqual(['【Forcome Support】Gmail 连接异常', '【Forcome Support】Gmail 连接异常']);
  });

  it('只有一条时单独成一条：标题、说明、对象与时间', async () => {
    dingtalk().reset();
    await notify(
      {
        type: 'unassigned_mail',
        title: '未归属店铺来信',
        body: 'Tom Harris · amz-ca2@forcome.com 未登记',
        object: { type: 'message', id: 'tom', label: 'P04 · 未归属店铺' },
      },
      '2026-09-11T11:00:00+08:00',
    );
    await sendAt('2026-09-11T11:05:00+08:00');
    // 11.4：未归属店铺来信只发客服主管
    expect(dingtalk().sent.map((s) => [s.userIds, s.text])).toEqual([
      [
        ['zhoumin'],
        [
          '【Forcome Support】未归属店铺来信',
          'Tom Harris · amz-ca2@forcome.com 未登记',
          'P04 · 未归属店铺 · 09-11 11:00',
        ].join('\n'),
      ],
    ]);
  });

  it('11.4 渠道只有站内的类型不发钉钉（渠道连接恢复）', async () => {
    dingtalk().reset();
    await notify(
      {
        type: 'channel_recovered',
        title: 'Gmail 已恢复',
        body: 'support@forcome.mx 已重新连接，补拉 3 封来信',
        object: { type: 'channel', id: 'gmail', label: 'P18 · Gmail' },
      },
      '2026-09-11T12:00:00+08:00',
    );
    await sendAt('2026-09-11T12:10:00+08:00');
    expect(dingtalk().sent).toEqual([]);
  });

  it('发送失败的留着下一分钟再试；连续失败 5 次后不再重试', async () => {
    dingtalk().reset();
    await notify(GMAIL_DOWN, '2026-09-11T13:00:00+08:00');
    dingtalk().faults.failNext({ kind: 'error', status: 500 }, { operation: 'send', times: 2 });
    await sendAt('2026-09-11T13:05:00+08:00');
    expect(dingtalk().sent).toEqual([]);
    await sendAt('2026-09-11T13:06:00+08:00');
    expect(dingtalk().sent).toHaveLength(2);

    dingtalk().reset();
    await notify(GMAIL_DOWN, '2026-09-11T14:00:00+08:00');
    dingtalk().faults.failNext({ kind: 'timeout' }, { operation: 'send', times: 10 });
    for (let minute = 5; minute < 10; minute += 1) {
      await sendAt(`2026-09-11T14:0${minute}:00+08:00`);
    }
    const attempts = dingtalk().faults.calls.filter((call) => call === 'send').length;
    // 两个人，各试 5 次
    expect(attempts).toBe(10);
    await sendAt('2026-09-11T14:20:00+08:00');
    expect(dingtalk().faults.calls.filter((call) => call === 'send').length).toBe(attempts);
    expect(dingtalk().sent).toEqual([]);
  });

  it('历史回放里不排工作通知（同站内通知，规格「历史导入与切换」）', async () => {
    dingtalk().reset();
    t.clock.set('2026-09-11T15:00:00+08:00');
    await t.enqueue(demoJob, {});
    await t.runJobs({ replay: true });
    await sendAt('2026-09-11T15:10:00+08:00');
    expect(dingtalk().sent).toEqual([]);
  });
});
