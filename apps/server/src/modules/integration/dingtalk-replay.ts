import type { DemoFixture } from '@forcome/fixtures';
import type { DingtalkDepartment, DingtalkDirectory, DingtalkUser } from './dingtalk';

/*
 * 示例数据夹具 → Fake 钉钉的通讯录（开发测试环境、本机开发与 Playwright 的进程启动时回放，ADR 0009 修订）：
 * - 示例成员（原型 data.py 的 STAFF，8 位）：钉钉用户 ID 就是夹具里的 key（如 liting），与示例成员加载步骤
 *   （org.members）写进成员表的钉钉用户 ID 一致，全量对账时对得上、不会重复建或停用；部门按「FSH / 客服部」逐级建；
 * - 两家生产厂的负责人（刘厂长、周厂长）：是钉钉成员，但不分配系统角色（PRD 2.1），对账后作为没有角色的成员进来，
 *   扫码登录看到「未分配角色」（G12）。夹具里只有他们的姓名，用户 ID 取 factory-head-<厂代码>。
 * 部门 ID 按出现先后从 100 起编，同一份夹具每次回放结果相同（api 与 worker 各回放一份，靠这个保持一致）。
 */

/** 根部门（组织本身） */
const ROOT: DingtalkDepartment = { id: '1', name: '集团', parentId: null };
const FIRST_DEPARTMENT_ID = 100;

/** 示例数据里生产厂负责人的钉钉用户 ID（如 factory-head-fqd） */
export function factoryHeadUserId(factoryCode: string): string {
  return `factory-head-${factoryCode.toLowerCase()}`;
}

export function fixtureDirectory(fixture: DemoFixture): DingtalkDirectory {
  const departments = new Map<string, DingtalkDepartment>([['', ROOT]]);
  let nextId = FIRST_DEPARTMENT_ID;

  /** 「FSH / 客服部」→ 逐级建部门，返回最末一级的 ID */
  function departmentOf(path: string): string {
    let parent = ROOT;
    let key = '';
    for (const name of path.split('/').map((part) => part.trim())) {
      key = key === '' ? name : `${key} / ${name}`;
      let found = departments.get(key);
      if (!found) {
        found = { id: String(nextId++), name, parentId: parent.id };
        departments.set(key, found);
      }
      parent = found;
    }
    return parent.id;
  }

  const users: DingtalkUser[] = fixture.members.map((member) => ({
    userId: member.key,
    name: member.name,
    departmentIds: [departmentOf(member.dept)],
    email: member.email,
    unionId: `union-${member.key}`,
  }));
  for (const factory of fixture.factories) {
    users.push({
      userId: factoryHeadUserId(factory.code),
      name: factory.head,
      departmentIds: [departmentOf(factory.code)],
      email: null,
      unionId: `union-${factoryHeadUserId(factory.code)}`,
    });
  }
  return { departments: [...departments.values()], users };
}
