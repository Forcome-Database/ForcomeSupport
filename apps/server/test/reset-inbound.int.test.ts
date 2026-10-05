import { storeOptionsSchema, ticketListSchema, type TicketListItem } from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gmailClient, type FakeGmail, type FakeMailInput } from '../src/modules/integration';
import { resetInboundData } from '../src/reset-inbound-data';
import type { ApiClient } from './api-client';
import { startTestHarness, type TestHarness } from './harness';

/*
 * 「重放来信」（待办 10，协调者 10-05 要求做成可重复、只在非生产环境执行的步骤；docs/部署说明.md）：
 * 清空收取的邮件、邮箱游标、工单与客户，worker 重新 watch 后按当前口径重新收信、归并；成员、店铺与来源规则不动。
 * 它和 pnpm db:seed 一样是运维命令，不是业务接口，所以测试直接调用组合函数，再经主接缝核对效果。
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

describe('重放来信', () => {
  let t: TestHarness;
  let gmail: FakeGmail;
  let supervisor: ApiClient;

  async function tickets(): Promise<TicketListItem[]> {
    const res = await supervisor.get('/api/tickets');
    expect(res.status).toBe(200);
    return ticketListSchema.parse(await res.json()).tickets;
  }

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

  it('生产环境拒绝，数据不动', async () => {
    await expect(resetInboundData(t.runtime, 'production')).rejects.toThrow(
      '生产环境不能清空收信与工单',
    );
    expect(await tickets()).toHaveLength(1);
  });

  it('清空收信与工单后，邮箱重新开始监听，新到的信按当前口径归并，工单编号从 0001 重新发号；店铺与来源规则不动', async () => {
    expect((await tickets()).map((ticket) => ticket.number)).toEqual(['T-20260910-0001']);

    await expect(resetInboundData(t.runtime, 'test')).resolves.toEqual({
      messages: 1,
      mailboxes: stores.length,
      tickets: 1,
      customers: 1,
    });
    expect(await tickets()).toEqual([]);

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

    const after = await tickets();
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
