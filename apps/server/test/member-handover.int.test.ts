import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  apiErrorSchema,
  emptyRegistrationInput,
  ledgerItemSchema,
  ledgerSchema,
  notificationListSchema,
  teamHandoverSchema,
  teamSchema,
  type HandoverAssignment,
  type Ledger,
  type LedgerItem,
  type RegistrationInput,
  type TeamHandover,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dingtalkClient } from '../src/modules/integration';
import { dingtalkReconcileJob } from '../src/modules/org';
import type { ApiClient } from './api-client';
import { startTestHarness, type TestHarness } from './harness';

/*
 * 成员停用与改派（待办 23；PRD P20「第一阶段」、K10 第一阶段补充小样、P13「第一阶段」、S15 补充小样、11.4、AC-ST-02、AC-ST-05）：
 * - 管理员在 P20 停用：弹窗列出他负责的进行中售后单，选接手人后改派与停用同一事务完成，记审计；没人可接手时被拒绝并给原因；
 * - 钉钉离职自动停用：org 发「成员已停用」事件，aftersales 把他负责的进行中售后单标为「待分配」进入改派队列（不改状态），
 *   按店铺通知客服主管，会话立即失效；
 * - P13「改派负责人」与「负责人：待分配」筛选。
 * 示例数据：王磊是唯一的售后负责人（全部店铺），负责 4 张进行中售后单（Forcome Auto 0018、0021，Forcome Direct 0019、0020）。
 */

const fixture = getDemoFixture();
const storeNamed = (name: string) => fixture.stores.find((s) => s.name === name)!;
const AUTO = storeNamed('Forcome Auto');
const DIRECT = storeNamed('Forcome Direct');
const COM = storeNamed('forcome.com');
const memberId = (key: string) => fixture.members.find((m) => m.key === key)!.id;
const WANG = memberId('wanglei');
const WANG_CASES = ['S-20260911-0018', 'S-20260911-0019', 'S-20260911-0020', 'S-20260911-0021'];
/** 台账不按费用发生日筛掉任何单 */
const ALL_DATES = '?from=2026-01-01&to=2026-09-11';

async function ledger(client: ApiClient, query = ALL_DATES): Promise<Ledger> {
  const res = await client.get(`/api/aftersales/ledger${query}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return ledgerSchema.parse(await res.json());
}

async function caseOf(client: ApiClient, number: string): Promise<LedgerItem> {
  const item = (await ledger(client)).items.find((i) => i.number === number);
  if (!item) throw new Error(`台账里没有 ${number}`);
  return item;
}

async function handoverOf(admin: ApiClient, id: string): Promise<TeamHandover> {
  const res = await admin.get(`/api/org/team/members/${id}/handover`);
  expect(res.status, await res.clone().text()).toBe(200);
  return teamHandoverSchema.parse(await res.json());
}

async function memberStatus(admin: ApiClient, id: string) {
  const res = await admin.get('/api/org/team');
  return teamSchema.parse(await res.json()).members.find((m) => m.id === id)?.status;
}

function disable(admin: ApiClient, id: string, version: number, assignments: HandoverAssignment[]) {
  return admin.post(`/api/org/team/members/${id}/disable`, { version, assignments });
}

async function fieldsOf(res: Response) {
  expect(res.status, await res.clone().text()).toBe(400);
  return apiErrorSchema.parse(await res.json()).fields;
}

/** 一张调整安装方式的进行中登记（不寄东西）；负责人由调用方给 */
function adjusted(storeId: string, ownerId: string): RegistrationInput {
  return {
    ...emptyRegistrationInput(),
    method: 'adjust_installation',
    storeId,
    site: 'US',
    orderNumber: '#2301',
    customerName: 'Handover Case',
    feeDate: '2026-09-11',
    ownerId,
    responsibility: 'customer_use',
    ratios: {
      product: { fsh: 100, factory: 0 },
      freight: { fsh: 100, factory: 0 },
      other: { fsh: 100, factory: 0 },
    },
    fees: {
      productCost: { amount: '0.00', currency: 'USD' },
      freight: { amount: '0.00', currency: 'USD' },
      compensation: { amount: '5.00', currency: 'USD' },
      otherCost: { amount: '0.00', currency: 'USD' },
    },
  };
}

async function register(client: ApiClient, input: RegistrationInput): Promise<LedgerItem> {
  const res = await client.post('/api/aftersales/registrations', input);
  expect(res.status, await res.clone().text()).toBe(201);
  return ledgerItemSchema.parse(await res.json());
}

describe('P20 停用成员：弹窗里选接手人，改派与停用同一事务（AC-ST-02、K10 第一阶段）', () => {
  let t: TestHarness;
  let admin: ApiClient;
  let supervisor: ApiClient;

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    admin = await t.loginAs('管理员');
    supervisor = await t.loginAs('客服主管');
  });

  afterAll(async () => {
    await t.close();
  });

  it('没有其他售后负责人可接手：停用被拒绝并返回原因，王磊仍在职、售后单不变', async () => {
    const handover = await handoverOf(admin, WANG);
    expect(handover.member).toMatchObject({ name: '王磊', aftersalesOwner: true });
    expect(handover.cases.map((c) => c.number)).toEqual(WANG_CASES);
    expect(handover.cases.every((c) => c.status === 'in_progress')).toBe(true);
    expect(handover.owners).toEqual([]);

    const fields = await fieldsOf(await disable(admin, WANG, handover.member.version, []));
    expect(fields).toEqual({ handover: '王磊是唯一的售后负责人，没有其他人可接手' });
    expect(await memberStatus(admin, WANG)).toBe('active');
    expect((await caseOf(supervisor, 'S-20260911-0018')).ownerId).toBe(WANG);
    expect(await t.auditRecords({ action: 'member.disable' })).toEqual([]);
  });

  it('AC-ST-02：负责 2 张进行中售后单 → 弹窗要求选接手人；选好后停用、会话失效，负责人变更记审计、状态不变', async () => {
    const sunjie = await t.addMember({
      name: '孙杰',
      dept: 'FSH / 售后部',
      roles: ['aftersales_owner'],
      allStores: true,
    });
    const zhaoliu = await t.addMember({
      name: '赵六',
      dept: 'FSH / 售后部',
      roles: ['aftersales_owner'],
      allStores: true,
    });
    const first = await register(supervisor, adjusted(DIRECT.id, zhaoliu));
    const second = await register(supervisor, adjusted(COM.id, zhaoliu));
    const zhaoliuSession = await t.loginAs({ memberId: zhaoliu });

    const handover = await handoverOf(admin, zhaoliu);
    expect(handover.cases.map((c) => c.number)).toEqual([first.number, second.number]);
    // 候选：其他在职售后负责人（不含被停用的人）
    expect(handover.owners.map((o) => o.name).sort()).toEqual(['孙杰', '王磊']);

    const version = handover.member.version;
    // 没选接手人：被拒绝
    expect(await fieldsOf(await disable(admin, zhaoliu, version, []))).toEqual({
      handover: '请选择接手人',
    });
    // 选了不是售后负责人的人（坐席李婷）：被拒绝
    const agent = memberId('liting');
    expect(
      await fieldsOf(
        await disable(
          admin,
          zhaoliu,
          version,
          handover.cases.map((c) => ({ caseId: c.id, ownerId: agent })),
        ),
      ),
    ).toEqual({ handover: '只能选有该店铺数据范围的售后负责人' });
    expect(await memberStatus(admin, zhaoliu)).toBe('active');

    const res = await disable(
      admin,
      zhaoliu,
      version,
      handover.cases.map((c) => ({ caseId: c.id, ownerId: sunjie })),
    );
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await memberStatus(admin, zhaoliu)).toBe('disabled');
    // 会话立即失效
    expect((await zhaoliuSession.get('/api/me')).status).toBe(401);

    for (const number of [first.number, second.number]) {
      const item = await caseOf(supervisor, number);
      expect(item).toMatchObject({
        ownerId: sunjie,
        ownerName: '孙杰',
        ownerPending: false,
        status: 'in_progress',
      });
    }
    const [disabled] = await t.auditRecords({ action: 'member.disable', objectId: zhaoliu });
    expect(disabled).toMatchObject({
      actorName: '刘洋',
      objectLabel: '赵六',
      before: expect.objectContaining({ status: 'active' }),
      after: expect.objectContaining({ status: 'disabled' }),
    });
    const reassigned = await t.auditRecords({ action: 'aftersales.reassign' });
    expect(reassigned.map((r) => r.objectLabel).sort()).toEqual([first.number, second.number]);
    for (const record of reassigned) {
      expect(record).toMatchObject({
        actorName: '刘洋',
        before: expect.objectContaining({ ownerName: '赵六', status: 'in_progress' }),
        after: expect.objectContaining({ ownerName: '孙杰', status: 'in_progress' }),
      });
    }

    // 事件照常发出，但单都已改派：不进改派队列、不通知客服主管
    await t.runJobs();
    expect(await t.auditRecords({ action: 'aftersales.reassign_queue' })).toEqual([]);
    const notes = notificationListSchema.parse(
      await (await supervisor.get('/api/notifications')).json(),
    );
    expect(notes.items.filter((n) => n.type === 'reassign_queue')).toEqual([]);
  });

  it('不能停用：已停用的、自己、最后一位在职管理员（报在 member 上）；版本对不上 409', async () => {
    const team = teamSchema.parse(await (await admin.get('/api/org/team')).json());
    const disabled = team.members.find((m) => m.name === '赵六')!;
    expect(await fieldsOf(await disable(admin, disabled.id, disabled.version, []))).toEqual({
      member: '这位成员已停用',
    });
    const me = team.members.find((m) => m.roles.includes('admin'))!;
    expect(await fieldsOf(await disable(admin, me.id, me.version, []))).toEqual({
      member: '不能停用自己',
    });
    // 停用另一位管理员（停用后至少还有自己；「最后一位在职管理员」只会是自己，由「不能停用自己」先拦下，规则见单元测试）
    const other = await t.addMember({
      name: '钱七',
      dept: 'FSH / 信息部',
      roles: ['admin'],
      allStores: true,
    });
    const otherAdmin = await t.loginAs({ memberId: other });
    const otherVersion = (await handoverOf(admin, other)).member.version;
    expect((await disable(admin, other, otherVersion, [])).status).toBe(200);
    expect((await otherAdmin.get('/api/me')).status).toBe(401);

    const chenchen = team.members.find((m) => m.name === '陈晨')!;
    expect((await disable(admin, chenchen.id, chenchen.version + 1, [])).status).toBe(409);
    expect(await memberStatus(admin, chenchen.id)).toBe('active');
  });

  it('没有进行中售后单的成员：直接停用，不用选接手人', async () => {
    const chenchen = teamSchema
      .parse(await (await admin.get('/api/org/team')).json())
      .members.find((m) => m.name === '陈晨')!;
    expect((await handoverOf(admin, chenchen.id)).cases).toEqual([]);
    expect((await disable(admin, chenchen.id, chenchen.version, [])).status).toBe(200);
    expect(await memberStatus(admin, chenchen.id)).toBe('disabled');
  });

  it('只有管理员能停用成员', async () => {
    const res = await supervisor.post(`/api/org/team/members/${WANG}/disable`, {
      version: 0,
      assignments: [],
    });
    expect(res.status).toBe(403);
  });
});

describe('钉钉离职自动停用：售后单进入改派队列（AC-ST-05）与 P13 改派负责人', () => {
  let t: TestHarness;
  let supervisor: ApiClient;
  let directSupervisor: ApiClient;
  let wang: ApiClient;
  const dingtalk = () => t.clients.fake(dingtalkClient);

  beforeAll(async () => {
    t = await startTestHarness();
    await t.loadFixtures();
    dingtalk().replay(fixture);
    await t.enqueue(dingtalkReconcileJob, {});
    await t.runJobs();
    supervisor = await t.loginAs('客服主管');
    const limited = await t.addMember({
      name: '吴桂',
      dept: 'FSH / 客服部',
      roles: ['supervisor'],
      allStores: false,
      storeIds: [DIRECT.id],
    });
    directSupervisor = await t.loginAs({ memberId: limited });
    wang = await t.loginAs({ member: 'wanglei' });
  });

  afterAll(async () => {
    await t.close();
  });

  it('AC-ST-05：离职 → 自动停用、会话失效；进行中售后单进入改派队列（状态不变），客服主管按店铺收到站内通知', async () => {
    const before = await Promise.all(WANG_CASES.map((n) => caseOf(supervisor, n)));
    expect((await wang.get('/api/me')).status).toBe(200);

    dingtalk().removeUser('wanglei');
    const report = await t.runJobs();

    // 跨模块只经事件联动：org 停用后发「成员已停用」，aftersales 的处理器标待分配
    const names = report.completed.map((job) => job.name);
    expect(names).toContain('org.member_disabled');
    expect(names.indexOf('org.member_disabled')).toBeGreaterThan(
      names.indexOf('org.dingtalk_event'),
    );

    expect((await wang.get('/api/me')).status).toBe(401);
    for (const [index, number] of WANG_CASES.entries()) {
      const item = await caseOf(supervisor, number);
      expect(item).toMatchObject({
        status: 'in_progress',
        ownerId: WANG,
        ownerName: '王磊',
        ownerPending: true,
      });
      expect(item.version).toBe(before[index]!.version + 1);
    }
    const queued = await t.auditRecords({ action: 'aftersales.reassign_queue' });
    expect(queued.map((r) => r.objectLabel).sort()).toEqual(WANG_CASES);
    expect(queued[0]).toMatchObject({
      actorType: 'system',
      before: expect.objectContaining({ ownerName: '王磊' }),
      after: expect.objectContaining({ ownerName: '待分配' }),
    });

    const list = async (client: ApiClient) =>
      notificationListSchema
        .parse(await (await client.get('/api/notifications')).json())
        .items.filter((n) => n.type === 'reassign_queue');
    expect((await list(supervisor)).map((n) => n.body).sort()).toEqual([
      '王磊已停用（钉钉离职），Forcome Auto 有 2 张进行中的售后单待分配负责人',
      '王磊已停用（钉钉离职），Forcome Direct 有 2 张进行中的售后单待分配负责人',
    ]);
    expect(await list(directSupervisor)).toEqual([
      expect.objectContaining({
        title: '售后单待改派',
        body: '王磊已停用（钉钉离职），Forcome Direct 有 2 张进行中的售后单待分配负责人',
        object: { type: 'member', id: WANG, label: 'P13 · 待分配' },
      }),
    ]);

    // 任务重试或重复的事件：已标过的不再标、不重复通知
    await t.enqueue((await import('../src/modules/org')).memberDisabledJob, {
      memberId: WANG,
      reason: 'dingtalk_left',
    });
    await t.runJobs();
    expect(await t.auditRecords({ action: 'aftersales.reassign_queue' })).toHaveLength(4);
    expect(await list(supervisor)).toHaveLength(2);
  });

  it('「负责人：待分配」筛出这些单；没给日期时从最早的待分配单起', async () => {
    const pending = await ledger(supervisor, '?owner=pending');
    expect(pending.items.map((i) => i.number)).toEqual(WANG_CASES);
    expect(pending.range).toEqual({ from: '2026-09-10', to: '2026-09-11' });
    // 店铺范围内：只授权 Forcome Direct 的客服主管只看到 Direct 的两张
    expect((await ledger(directSupervisor, '?owner=pending')).items.map((i) => i.number)).toEqual([
      'S-20260911-0019',
      'S-20260911-0020',
    ]);
    // 给了日期就按日期
    expect(
      (await ledger(supervisor, '?owner=pending&from=2026-09-11&to=2026-09-11')).items.map(
        (i) => i.number,
      ),
    ).toEqual(['S-20260911-0018', 'S-20260911-0019', 'S-20260911-0021']);
    // 负责人为空的历史导入单不算待分配
    const imported = await t.importAftersales({
      rows: [
        {
          登记编号: 'H-23',
          登记日期: '2026-09-02',
          店铺: 'forcome.com',
          站点: 'US',
          订单号: '#2302',
          客户: 'No Owner',
          处理方式: '调整安装方式',
          责任: '客户原因',
          费用发生日: '2026-09-02',
          状态: '进行中',
        },
      ],
    });
    expect(imported.rows[0]?.outcome).toBe('imported');
    expect((await ledger(supervisor, '?owner=pending')).items.map((i) => i.number)).toEqual(
      WANG_CASES,
    );
  });

  it('P13 改派负责人：只能改给有该店铺范围的在职售后负责人；状态不变、清掉待分配、记审计；带版本号', async () => {
    const owner = await t.addMember({
      name: '孙杰',
      dept: 'FSH / 售后部',
      roles: ['aftersales_owner'],
      allStores: false,
      storeIds: [AUTO.id],
    });
    const agent = memberId('liting');
    const item = await caseOf(supervisor, 'S-20260911-0018');
    const reassign = (client: ApiClient, number: string, body: object) =>
      client.post(`/api/aftersales/${number}/reassign`, body);

    // 改派给坐席（不是售后负责人）：被拒绝
    expect(
      await fieldsOf(
        await reassign(supervisor, item.number, { version: item.version, ownerId: agent }),
      ),
    ).toEqual({ ownerId: '只能选有该店铺数据范围的售后负责人' });
    // 没选
    expect(
      await fieldsOf(
        await reassign(supervisor, item.number, { version: item.version, ownerId: null }),
      ),
    ).toEqual({ ownerId: '请选择接手人' });
    // Forcome Direct 的单：孙杰没有该店铺范围，也没有别人可接
    const direct = await caseOf(supervisor, 'S-20260911-0019');
    expect(
      await fieldsOf(
        await reassign(supervisor, direct.number, { version: direct.version, ownerId: owner }),
      ),
    ).toEqual({ ownerId: '没有其他有该店铺范围的售后负责人可接手' });
    // 版本对不上 409
    expect(
      (await reassign(supervisor, item.number, { version: item.version - 1, ownerId: owner }))
        .status,
    ).toBe(409);
    // 坐席不能改派
    const agentClient = await t.loginAs({ member: 'liting' });
    expect(
      (await reassign(agentClient, item.number, { version: item.version, ownerId: owner })).status,
    ).toBe(403);

    const res = await reassign(supervisor, item.number, { version: item.version, ownerId: owner });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(ledgerItemSchema.parse(await res.json())).toMatchObject({
      status: 'in_progress',
      ownerId: owner,
      ownerName: '孙杰',
      ownerPending: false,
      version: item.version + 1,
    });
    const [audit] = await t.auditRecords({
      action: 'aftersales.reassign',
      objectId: item.id,
    });
    expect(audit).toMatchObject({
      actorName: '周敏',
      before: expect.objectContaining({ ownerName: '待分配', status: 'in_progress' }),
      after: expect.objectContaining({ ownerName: '孙杰', status: 'in_progress' }),
    });
    // 出了改派队列
    expect((await ledger(supervisor, '?owner=pending')).items.map((i) => i.number)).not.toContain(
      item.number,
    );
  });

  it('已完成的单可改派、已取消的不行（S15 补充小样）', async () => {
    const zheng = await t.addMember({
      name: '郑八',
      dept: 'FSH / 售后部',
      roles: ['aftersales_owner'],
      allStores: false,
      storeIds: [DIRECT.id],
    });
    // 改派弹窗的候选来自 registration-options（客服主管也能取）
    const options = await supervisor.get('/api/aftersales/registration-options');
    expect(options.status).toBe(200);
    expect(
      ((await options.json()) as { owners: { name: string }[] }).owners.map((o) => o.name),
    ).toContain('郑八');

    const done = (await ledger(supervisor)).items.find(
      (i) => i.status === 'completed' && i.store.id === DIRECT.id,
    )!;
    const res = await supervisor.post(`/api/aftersales/${done.number}/reassign`, {
      version: done.version,
      ownerId: zheng,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(ledgerItemSchema.parse(await res.json())).toMatchObject({
      status: 'completed',
      ownerName: '郑八',
    });

    const open = await caseOf(supervisor, 'S-20260911-0019');
    const cancel = await supervisor.post(`/api/aftersales/${open.number}/cancel`, {
      version: open.version,
      reason: '客户撤回售后申请',
      keptFees: [],
    });
    expect(cancel.status, await cancel.clone().text()).toBe(200);
    const cancelled = await caseOf(supervisor, open.number);
    expect(
      await fieldsOf(
        await supervisor.post(`/api/aftersales/${cancelled.number}/reassign`, {
          version: cancelled.version,
          ownerId: zheng,
        }),
      ),
    ).toEqual({ status: '这张单已取消' });
  });
});

describe('跨模块只经事件联动：org 不直接读写售后单表（ADR 0005）', () => {
  it('org 模块的代码不引用 aftersales（不读它的表、不调它的接口）；停用时的改派经 app.ts 注入', () => {
    const dir = fileURLToPath(new URL('../src/modules/org/', import.meta.url));
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const code = readFileSync(`${dir}${file}`, 'utf8');
      expect(code, file).not.toMatch(/from '\.\.\/aftersales/);
      expect(code, file).not.toMatch(/aftersales\.aftersales|"aftersales"\./);
    }
  });
});
