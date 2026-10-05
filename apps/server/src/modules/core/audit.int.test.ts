import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  createTestRuntime,
  type TestDatabase,
  type TestRuntime,
} from '../../../test/database';
import { findAuditRecords } from './audit';
import { recordAudit, systemActor, transaction, type Actor } from './index';

let database: TestDatabase;
let t: TestRuntime;

beforeAll(async () => {
  database = await createTestDatabase();
  t = await createTestRuntime(database.url);
});

afterAll(async () => {
  await t.close();
  await database.drop();
});

const admin: Actor = {
  kind: 'member',
  memberId: '01920000-0000-7000-8000-000000000001',
  name: '刘洋',
  roles: ['admin'],
  ip: '10.0.8.21',
};

describe('审计写入', () => {
  it('成员操作记录操作人、角色、来源 IP、对象与完整前后值，时间取注入的时钟', async () => {
    t.clock.set('2026-09-11T01:52:00Z');
    const before = {
      name: 'forcome.mx',
      platform: 'shopify' as const,
      sites: ['MX' as const],
      defaultSite: 'MX' as const,
      mailboxes: ['support@forcome.mx'],
      platformId: 'forcome-mx.myshopify.com',
      adapterMode: 'fake' as const,
    };
    const after = { ...before, mailboxes: ['support@forcome.mx', 'hola@forcome.mx'] };

    await transaction(t.runtime, (tx) =>
      recordAudit(tx, admin, {
        action: 'store.update',
        objectType: 'store',
        objectId: 'store-forcome-mx',
        objectLabel: 'forcome.mx',
        before,
        after,
      }),
    );

    const [record] = await findAuditRecords(t.runtime.db, { objectId: 'store-forcome-mx' });
    expect(record).toMatchObject({
      occurredAt: new Date('2026-09-11T01:52:00Z'),
      actorType: 'member',
      actorId: admin.kind === 'member' ? admin.memberId : null,
      actorName: '刘洋',
      actorRoles: ['admin'],
      ip: '10.0.8.21',
      action: 'store.update',
      objectType: 'store',
      objectLabel: 'forcome.mx',
      storeId: null,
      before,
      after,
    });
  });

  it('系统操作记为「系统」，没有角色与 IP；可带对象所属店铺', async () => {
    t.clock.set('2026-09-11T02:14:00Z');
    const storeId = '01920000-0000-7000-8000-0000000000aa';
    await transaction(t.runtime, (tx) =>
      recordAudit(tx, systemActor, {
        action: 'aftersales.complete',
        objectType: 'aftersales',
        objectId: 'aftersales-by-system',
        storeId,
      }),
    );

    const [record] = await findAuditRecords(t.runtime.db, { objectId: 'aftersales-by-system' });
    expect(record).toMatchObject({
      occurredAt: new Date('2026-09-11T02:14:00Z'),
      actorType: 'system',
      actorId: null,
      actorName: '系统',
      actorRoles: [],
      ip: null,
      storeId,
      before: null,
      after: null,
    });
  });

  it('与业务写入同一事务：事务回滚则审计也不留下', async () => {
    await expect(
      transaction(t.runtime, async (tx) => {
        await recordAudit(tx, admin, {
          action: 'store.create',
          objectType: 'store',
          objectId: 'store-rolled-back',
        });
        throw new Error('保存店铺失败');
      }),
    ).rejects.toThrow('保存店铺失败');

    expect(await findAuditRecords(t.runtime.db, { objectId: 'store-rolled-back' })).toEqual([]);
  });

  it('同一事务内的多条审计共用事务开始时的时间', async () => {
    t.clock.set('2026-09-11T03:00:00Z');
    await transaction(t.runtime, async (tx) => {
      await recordAudit(tx, admin, {
        action: 'store.create',
        objectType: 'store',
        objectId: 'store-a',
      });
      t.clock.advance({ minutes: 5 });
      await recordAudit(tx, admin, {
        action: 'store.update',
        objectType: 'store',
        objectId: 'store-a',
      });
    });
    const records = await findAuditRecords(t.runtime.db, { objectId: 'store-a' });
    expect(records.map((r) => [r.action, r.occurredAt.toISOString()])).toEqual([
      ['store.create', '2026-09-11T03:00:00.000Z'],
      ['store.update', '2026-09-11T03:00:00.000Z'],
    ]);
  });
});
