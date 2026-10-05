import { storeOptionsSchema, ticketListSchema, type TicketListItem } from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gmailClient, type FakeGmail, type FakeMailInput } from '../src/modules/integration';
import type { ApiClient } from './api-client';
import { startTestHarness, type TestHarness } from './harness';

/*
 * 「重放来信」（待办 10，协调者 10-05 要求做成可重复、只在非生产环境执行的步骤；ADR 0013 修订、docs/部署说明.md）：
 * 清空收取的邮件、邮箱游标、工单与客户，worker 重新 watch 后按当前口径重新收信、归并；成员、店铺与来源规则不动。
 * 它是运维命令（与 pnpm db:seed 同类），测试经测试工具 t.resetInbound() 调用同一个函数，再经主接缝核对效果；
 * 生产环境的限制用 startTestHarness({ appEnv: 'production' }) 验证。
 */

const stores = getDemoFixture().stores;
const DIRECT = stores.find((s) => s.name === 'Forcome Direct')!;
const SHOP_COM = stores.find((s) => s.name === 'forcome.com')!;

const letter = (overrides: Partial<FakeMailInput> = {}): FakeMailInput => ({
  to: DIRECT.mailbox,
  from: { name: 'Sarah Mitchell', address: 's.mitchell.4h2k@marketplace.amazon.com' },
  subject: "Tracking hasn't updated since Sep 5",
  text: 'My tracking has not updated since Sep 5.',
  at: '2026-09-10T16:00:00+08:00',
  ...overrides,
});

async function ticketsSeenBy(client: ApiClient): Promise<TicketListItem[]> {
  const res = await client.get('/api/tickets');
  expect(res.status).toBe(200);
  return ticketListSchema.parse(await res.json()).tickets;
}

describe('重放来信', () => {
  let t: TestHarness;
  let gmail: FakeGmail;
  let supervisor: ApiClient;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    gmail = t.clients.fake(gmailClient);
    await t.runJobs();
    supervisor = await t.loginAs('客服主管');
    gmail.deliver(letter());
    await t.runJobs();
  });

  afterAll(async () => {
    await t.close();
  });

  it('清空收信与工单后，邮箱重新开始监听，新到的信按当前口径归并，工单编号从 0001 重新发号；店铺与来源规则不动', async () => {
    expect((await ticketsSeenBy(supervisor)).map((ticket) => ticket.number)).toEqual([
      'T-20260910-0001',
    ]);

    await expect(t.resetInbound()).resolves.toEqual({
      messages: 1,
      mailboxes: stores.length,
      tickets: 1,
      customers: 1,
    });
    expect(await ticketsSeenBy(supervisor)).toEqual([]);
    expect(await t.receivedMail()).toEqual([]);

    // worker 重新 watch 各邮箱（游标已清空），之后到的信照常同步；生产厂来信仍按示例数据登记的规则识别
    await t.runJobs();
    gmail.deliver(letter({ at: '2026-09-10T16:30:00+08:00' }));
    gmail.deliver({
      to: SHOP_COM.mailbox,
      from: { name: 'FQD 品质部', address: 'qc@fqd-forcome.com' },
      subject: '9 月电池批次抽检报告',
      text: '请查收。',
      at: '2026-09-10T17:00:00+08:00',
    });
    await t.runJobs();

    const after = await ticketsSeenBy(supervisor);
    expect(after.map((ticket) => [ticket.customer.name, ticket.source])).toEqual(
      expect.arrayContaining([
        ['Sarah Mitchell', 'customer'],
        ['FQD 品质部', 'producer'],
      ]),
    );
    expect(after.map((ticket) => ticket.number).sort()).toEqual([
      'T-20260910-0001',
      'T-20260910-0002',
    ]);
    const options = storeOptionsSchema.parse(
      await (await supervisor.get('/api/channel/store-options')).json(),
    );
    expect(options.stores).toHaveLength(stores.length);
  });
});

describe('重放来信在生产环境被拒绝', () => {
  let t: TestHarness;

  beforeAll(async () => {
    t = await startTestHarness({ appEnv: 'production' });
  });

  afterAll(async () => {
    await t.close();
  });

  it('生产环境拒绝（在动任何数据之前）', async () => {
    await expect(t.resetInbound()).rejects.toThrow('生产环境不能清空收信与工单');
  });
});
