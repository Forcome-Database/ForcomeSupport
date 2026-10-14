import { readFileSync } from 'node:fs';
import {
  capabilities,
  disableMessages,
  isLive,
  memberStatusLabels,
  roleLabels,
  roles,
  syncedAtWords,
  teamMessages,
  teamRoles,
  type TeamMember,
} from '@forcome/contracts';
import { getDemoFixture } from '@forcome/fixtures';
import { describe, expect, it } from 'vitest';
import {
  ADD_RESULT,
  CELL_EDIT,
  CONFLICT,
  DISABLE,
  DRAWER,
  EDITED,
  LEAVE,
  MEMBER_MENU,
  MEMBER_SECTION,
  MEMBER_TABLE,
  PAGE_DESCRIPTION,
  PAGE_TITLE,
  PERMISSIONS,
  SAVE_BAR,
  SAVE_RESULT,
  TABS,
} from './p20-copy';
import { applyEdit, changeLines } from './team-edits';

/*
 * P20 的界面文案与原型逐字一致（CLAUDE.md「文案逐字照原型」，ADR 0007 修订）：直接读原型生成物——第一期参照页
 * P20_SettingsTeam、状态板 StatesAdmin（K17 第一阶段小图与 P20 补充小样，待办 06、10-06 用户确认）、全局状态 GlobalStates（G8）。
 * 原型改了文案而代码没跟上、或反过来，都会失败。原型由 design/spec 下的脚本生成（README「修改与重建」），改原型后要重新生成再跑这里。
 * 示例数据：6 位已分配角色的成员、刘洋（我）、钉钉 10:00 同步；待添加的新同事吴桐（DINGTALK_NEWCOMERS）。
 */

const read = (path: string) =>
  readFileSync(new URL(`../../../../../${path}`, import.meta.url), 'utf8');
const P20 = read('design/spec/phase1/P20_SettingsTeam.dc.html');
const STATES_ADMIN = read('design/StatesAdmin.dc.html');
const GLOBAL_STATES = read('design/GlobalStates.dc.html');

/** 原型里有这段文字；先确认要核对的文字不是空的（空串处处都「包含」，会让核对空过） */
function expectIn(html: string, text: string | null | undefined) {
  expect(text, '要核对的文案为空').toBeTruthy();
  expect(html.includes(text ?? ''), `原型里没有「${text}」`).toBe(true);
}

/** 原型里有这段界面文字，且是一个元素的完整文本（不是更长一句话的一部分） */
function expectText(html: string, text: string) {
  expectIn(html, `>${text}<`);
}

const fixture = getDemoFixture();
const store = (name: string) => fixture.stores.find((s) => s.name === name)!;
const storeNames = new Map(fixture.stores.map((s) => [s.id, s.name]));
const NOW = new Date(fixture.meta.now);
const newcomer = fixture.directoryNewcomers[0]!;

/** 示例的赵倩（知识库负责人、全部店铺） */
const zhaoqian: TeamMember = {
  id: fixture.members.find((m) => m.key === 'zhaoqian')!.id,
  name: '赵倩',
  email: 'zhaoqian@forcome.com',
  dept: 'FSH / 客服部',
  roles: ['knowledge_owner'],
  stores: { all: true },
  status: 'active',
  lastLoginAt: null,
  version: 1,
  changedBy: null,
  changedAt: null,
};

describe('P20 第一期参照页', () => {
  it('页头、页签、「成员」区块的小标题与人数同步、「从钉钉添加」逐字一致', () => {
    expectText(P20, PAGE_TITLE);
    expectText(P20, PAGE_DESCRIPTION);
    expectText(P20, TABS.members);
    expectText(P20, TABS.permissions);
    expectText(P20, MEMBER_SECTION.label);
    expectText(P20, MEMBER_SECTION.count(6, syncedAtWords('2026-09-11T10:00:00+08:00', NOW)));
    expectText(P20, MEMBER_SECTION.add);
  });

  it('成员表：表头（第一阶段没有「语言」）、（我）、角色与状态的叫法', () => {
    for (const column of Object.values(MEMBER_TABLE.columns)) expectText(P20, column);
    expect(P20.includes('>语言<')).toBe(false);
    expectText(P20, MEMBER_TABLE.self('刘洋'));
    for (const role of teamRoles) expectText(P20, roleLabels[role]);
    expectText(P20, memberStatusLabels.active);
  });

  it('吸底保存栏：没有修改时的写法与两个置灰按钮的悬停原因', () => {
    expectText(P20, SAVE_BAR.clean);
    expectText(P20, SAVE_BAR.note);
    expectText(P20, SAVE_BAR.discard);
    expectText(P20, SAVE_BAR.save);
    expectIn(P20, SAVE_BAR.noDiscard);
    expectIn(P20, SAVE_BAR.noSave);
  });
});

describe('K17 角色权限页签（第一阶段小图）', () => {
  it('小标题、说明、图例、表头与第一期已上线的每一项能力逐字一致', () => {
    expectText(STATES_ADMIN, PERMISSIONS.label);
    expectText(STATES_ADMIN, PERMISSIONS.note);
    for (const text of Object.values(PERMISSIONS.legend)) expectText(STATES_ADMIN, text);
    expectText(STATES_ADMIN, PERMISSIONS.columns.group);
    expectText(STATES_ADMIN, PERMISSIONS.columns.capability);
    for (const role of roles) expectText(STATES_ADMIN, roleLabels[role]);
    for (const capability of capabilities.filter((c) => isLive(c.key))) {
      expectText(STATES_ADMIN, capability.label);
    }
  });
});

describe('P20 补充小样（K17 下方，待办 06）', () => {
  it('格内修改：数据范围的两个选项、只剩一个角色时的悬停原因、「已修改」、已停用的成员', () => {
    expectText(STATES_ADMIN, CELL_EDIT.scopeOptions.all);
    expectText(STATES_ADMIN, CELL_EDIT.scopeOptions.some);
    expectText(STATES_ADMIN, CELL_EDIT.lastRole);
    expectIn(STATES_ADMIN, EDITED);
    expectText(STATES_ADMIN, teamMessages.disabledMember);
    expectIn(STATES_ADMIN, memberStatusLabels.disabled);
  });

  it('吸底保存栏的计数与摘要（按示例数据算出），保存结果与断网的浮层', () => {
    let edits = applyEdit(new Map(), zhaoqian, { roles: ['agent', 'knowledge_owner'] });
    edits = applyEdit(edits, zhaoqian, {
      stores: { all: false, storeIds: [store('Forcome Direct').id] },
    });
    const summary = changeLines(edits, storeNames).join(SAVE_BAR.separator);
    expectText(STATES_ADMIN, SAVE_BAR.dirty(2));
    expectText(STATES_ADMIN, summary);

    const back = changeLines(
      applyEdit(
        new Map(),
        { ...zhaoqian, stores: { all: false, storeIds: [store('Forcome Direct').id] } },
        {
          stores: { all: true },
        },
      ),
      storeNames,
    ).join(SAVE_BAR.separator);
    expectText(STATES_ADMIN, SAVE_RESULT.savedTitle);
    expectText(STATES_ADMIN, SAVE_RESULT.savedDescription(back, '刘洋', '10:24'));
    expectText(STATES_ADMIN, SAVE_RESULT.offlineTitle);
    expectText(STATES_ADMIN, SAVE_RESULT.offlineDescription);
    expectText(STATES_ADMIN, SAVE_RESULT.waiting);
    expectText(STATES_ADMIN, SAVE_RESULT.retriedTitle);
    expectText(STATES_ADMIN, SAVE_RESULT.retriedDescription('10:26', back));
    expectText(STATES_ADMIN, `${SAVE_RESULT.failedAction}失败：网络不可用`);
    expectText(STATES_ADMIN, SAVE_RESULT.failedDescription);
  });

  it('保存时格子下方的报错（接口的说明）逐字一致', () => {
    expectText(STATES_ADMIN, teamMessages.storesRequired);
    expectText(STATES_ADMIN, teamMessages.lastAdmin);
  });

  it('并发（G7）横幅：一个人、几个人、对不出是谁改的写法', () => {
    expectText(STATES_ADMIN, CONFLICT.title(['赵倩'], '周敏', '10:24'));
    expectText(STATES_ADMIN, CONFLICT.description('周敏', ['角色']));
    expectText(STATES_ADMIN, CONFLICT.title(['赵倩', '李婷'], null, null));
    expectText(STATES_ADMIN, CONFLICT.title(['赵倩'], null, null));
    expectText(STATES_ADMIN, CONFLICT.description(null, []));
  });

  it('离开本页与关闭抽屉（G8）', () => {
    expectText(STATES_ADMIN, LEAVE.page(2));
    expectText(STATES_ADMIN, LEAVE.drawer);
    // G8 的写法本身（「有 N 项未保存的修改。放弃后恢复为上次保存的值。」）
    expectIn(GLOBAL_STATES, LEAVE.page(3).replace('「团队与权限」', '「规则与阈值」'));
  });

  it('「从钉钉添加」抽屉：标题、说明、字段、占位、搜索、空的下拉、角色说明、按钮与报错', () => {
    expectText(STATES_ADMIN, DRAWER.title);
    expectIn(STATES_ADMIN, DRAWER.description);
    for (const label of Object.values(DRAWER.labels)) expectIn(STATES_ADMIN, `${label}<span`);
    expectText(STATES_ADMIN, DRAWER.memberPlaceholder);
    expectText(STATES_ADMIN, DRAWER.memberSearch);
    expectText(STATES_ADMIN, DRAWER.noCandidates);
    expectText(STATES_ADMIN, DRAWER.noMatch);
    expectText(STATES_ADMIN, DRAWER.rolesHint);
    expectText(STATES_ADMIN, DRAWER.cancel);
    expectText(STATES_ADMIN, DRAWER.save);
    for (const message of [
      teamMessages.memberRequired,
      teamMessages.rolesRequired,
      teamMessages.scopeRequired,
      teamMessages.alreadyAdded(newcomer.name),
    ]) {
      expectText(STATES_ADMIN, message);
    }
  });

  it('成员下拉列出示例数据里待添加的人；添加结果的浮层', () => {
    expectText(STATES_ADMIN, newcomer.name);
    expectText(STATES_ADMIN, [newcomer.dept, newcomer.email].join(' · '));
    expectText(STATES_ADMIN, ADD_RESULT.addedTitle);
    expectText(
      STATES_ADMIN,
      ADD_RESULT.addedDescription(newcomer.name, roleLabels.agent, '刘洋', '10:24'),
    );
    expectText(STATES_ADMIN, ADD_RESULT.failedDescription);
  });
});

describe('停用成员（K10 第一阶段补充小样，待办 23，协调者 2026-10-14 决定 Q1–Q4）', () => {
  it('弹窗：标题、说明、进行中售后单、接手人（一个或按店铺）、提示与选项、按钮', () => {
    expectText(STATES_ADMIN, DISABLE.title('王磊'));
    expectText(STATES_ADMIN, DISABLE.note('王磊'));
    expectText(STATES_ADMIN, DISABLE.cases);
    expectText(STATES_ADMIN, DISABLE.count(4));
    expectIn(STATES_ADMIN, `>${DISABLE.owner}<span`);
    expectIn(STATES_ADMIN, `>${DISABLE.ownerForStore('Forcome Auto')}<span`);
    expectText(STATES_ADMIN, DISABLE.hint);
    expectText(STATES_ADMIN, DISABLE.option('赵倩'));
    expectText(STATES_ADMIN, DISABLE.none);
    expectText(STATES_ADMIN, DISABLE.noCases);
    expectText(STATES_ADMIN, DISABLE.dismiss);
    expectText(STATES_ADMIN, DISABLE.confirm);
  });

  it('不可用：没有其他售后负责人、都没有该店铺范围（字段下的原因与底部的怎么办）', () => {
    expectIn(STATES_ADMIN, disableMessages.onlyOwner('王磊'));
    expectIn(STATES_ADMIN, disableMessages.noOwner);
    expectText(STATES_ADMIN, disableMessages.noOwnerFix);
    expectIn(STATES_ADMIN, disableMessages.scopeMissing(['Forcome Auto']));
    expectText(STATES_ADMIN, disableMessages.scopeFix);
  });

  it('行尾「更多」：只有「停用」，三种不可用的悬停', () => {
    expectIn(STATES_ADMIN, `>${MEMBER_MENU.disable}</div>`);
    expectText(STATES_ADMIN, disableMessages.disabled);
    expectText(STATES_ADMIN, disableMessages.self);
    expectText(STATES_ADMIN, disableMessages.lastAdmin);
  });

  it('结果浮层：改派给了谁、没有单时、失败与刚被别人改过', () => {
    expectText(STATES_ADMIN, DISABLE.doneTitle('王磊'));
    expectText(STATES_ADMIN, DISABLE.doneReassigned(4, ['赵倩']));
    expectText(STATES_ADMIN, DISABLE.doneTitle('李婷'));
    expectText(STATES_ADMIN, DISABLE.doneNone);
    expectText(STATES_ADMIN, `${DISABLE.failedAction}失败：网络连接已断开`);
    expectText(STATES_ADMIN, `${DISABLE.failedAction}失败：数据已被他人修改`);
    expectText(STATES_ADMIN, DISABLE.stale);
  });
});
