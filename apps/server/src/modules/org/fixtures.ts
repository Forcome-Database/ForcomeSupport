import { roleByLabel } from '@forcome/contracts';
import type { FixtureMember } from '@forcome/fixtures';
import { defineFixtureStep } from '../core';
import { createMember, type NewMember } from './members';

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
    name: fixture.name,
    dept: fixture.dept,
    roles: [role],
    allStores: fixture.stores === ALL_STORES,
    factoryCode: fixture.factory,
  };
}

/**
 * 示例成员（原型 data.py 的 STAFF）：沿用夹具里确定的 id（待办 02 的开发登录也用这组 id）；已存在则跳过。
 * 钉钉通讯录同步（05）上线后，开发测试环境的成员仍来自这里（钉钉用 Fake）。
 */
export const orgMembersFixtureStep = defineFixtureStep({
  name: 'org.members',
  async load(tx, fixture) {
    for (const fixtureMember of fixture.members) {
      await createMember(tx, newMemberOf(fixtureMember));
    }
  },
});
