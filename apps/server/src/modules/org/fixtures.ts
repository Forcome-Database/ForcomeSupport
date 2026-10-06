import type { FixtureMember } from '@forcome/fixtures';
import { SYSTEM_ACTOR_NAME, roleByLabel } from '@forcome/contracts';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { defineFixtureStep } from '../core';
import { createMember, type NewMember } from './members';
import { member } from './schema';

/** 示例数据里「全部店铺」的写法；生产厂对接人没有店铺范围（null） */
const ALL_STORES = '全部店铺';

function newMemberOf(fixture: FixtureMember): NewMember {
  const role = roleByLabel(fixture.role);
  if (!role)
    throw new Error(`示例成员 ${fixture.name} 的角色「${fixture.role}」不是 6 个固定角色之一`);
  if (fixture.stores !== null && fixture.stores !== ALL_STORES) {
    throw new Error(`示例成员 ${fixture.name} 的店铺范围「${fixture.stores}」还不支持转换`);
  }
  return {
    id: fixture.id,
    // 与 Fake 钉钉回放的通讯录一致（integration/dingtalk-replay.ts）：全量对账时对得上，不会重复建或停用
    dingtalkUserId: fixture.key,
    name: fixture.name,
    dept: fixture.dept,
    email: fixture.email,
    roles: [role],
    allStores: fixture.stores === ALL_STORES,
    factoryCode: fixture.factory,
  };
}

/**
 * 示例成员（原型 data.py 的 STAFF）：沿用夹具里确定的 id（待办 02 的开发登录也用这组 id）；已存在则跳过。
 * 角色与店铺范围来自这里；姓名、部门与在职状态之后随 Fake 钉钉的通讯录同步（待办 05）。
 * 加入时刻按示例数据的顺序排在灌入时刻之前、各差 1 毫秒（P20 同角色按加入先后排，与原型「李婷、陈晨」的顺序一致，
 * 也排在之后通讯录同步进来的人前面）。另做三件修补（都幂等）：
 * - 待办 05 之前灌进去的示例成员没有钉钉用户 ID，补上，否则对账会把他们当成通讯录之外的人、另建一份；
 * - 被钉钉离职停用、或回到通讯录后角色被清空的示例成员（开发测试环境联调过真实钉钉，docs/部署说明.md 第 11.2 节），
 *   恢复成示例数据里的角色与店铺范围；
 * - 还没有最近登录的，补上示例数据里的最近登录（P20 与原型对得上；登录过的保留真实的）。加载步骤只在非生产环境执行。
 */
export const orgMembersFixtureStep = defineFixtureStep({
  name: 'org.members',
  async load(tx, fixture) {
    for (const [index, fixtureMember] of fixture.members.entries()) {
      const input = {
        ...newMemberOf(fixtureMember),
        createdAt: new Date(tx.now.getTime() - (fixture.members.length - index)),
      };
      await createMember(tx, input);
      await tx.db
        .update(member)
        .set({ lastLoginAt: new Date(fixtureMember.lastLogin) })
        .where(and(eq(member.id, fixtureMember.id), isNull(member.lastLoginAt)));
      await tx.db
        .update(member)
        .set({ dingtalkUserId: fixtureMember.key, email: fixtureMember.email })
        .where(and(eq(member.id, fixtureMember.id), isNull(member.dingtalkUserId)));
      await tx.db
        .update(member)
        .set({
          status: 'active',
          disabledReason: null,
          disabledAt: null,
          roles: [...input.roles],
          allStores: input.allStores,
          storeIds: [...(input.storeIds ?? [])],
          updatedAt: tx.now,
          changedAt: tx.now,
          changedByName: SYSTEM_ACTOR_NAME,
          version: sql`${member.version} + 1`,
        })
        .where(
          and(
            eq(member.id, fixtureMember.id),
            or(eq(member.disabledReason, 'dingtalk_left'), sql`cardinality(${member.roles}) = 0`),
          ),
        );
    }
  },
});
