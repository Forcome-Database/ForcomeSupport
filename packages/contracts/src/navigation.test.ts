/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { homeFor, navFor, navSections, type NavSection } from './navigation';
import { roleByLabel, type Role } from './roles';

/*
 * 导航与默认首页对照 PRD 4.1「第一阶段」表（design/spec/prd_b.md）逐行核对。
 * 多角色：导航取并集，默认首页按「坐席 / 客服主管 → 售后负责人 → 知识库负责人 / 管理员」取第一个。
 */

const PRD_B = readFileSync(new URL('../../../design/spec/prd_b.md', import.meta.url), 'utf8');

const PAGE_TO_SECTION: Record<string, NavSection> = {
  P04: 'tickets',
  P13: 'aftersales',
  P17: 'reports',
};

function phase1Table(): { role: Role; nav: string[]; home: NavSection | null }[] {
  const start = PRD_B.indexOf('| 角色 | 第一阶段导航 | 默认首页 |');
  const lines = PRD_B.slice(start).split('\n');
  const end = lines.findIndex((line) => !line.startsWith('|'));
  return lines.slice(2, end).map((line) => {
    const [roleLabel = '', nav = '', home = ''] = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    const role = roleByLabel(roleLabel);
    if (!role) throw new Error(`PRD 4.1 第一阶段表里有未知角色：${roleLabel}`);
    return {
      role,
      // 「工单 · 售后（台账只读，不含财务字段）」→ ['工单', '售后']；生产厂对接人一行写的是说明，没有导航
      nav: home === '—' ? [] : nav.split('·').map((item) => item.replace(/（.*$/, '').trim()),
      home: PAGE_TO_SECTION[home] ?? null,
    };
  });
}

const labelOf = (key: NavSection) => navSections.find((s) => s.key === key)?.label;

describe('导航与默认首页（PRD 4.1 第一阶段表）', () => {
  const table = phase1Table();

  it('表里列出全部 6 个角色', () => {
    expect(table.map((row) => row.role)).toEqual([
      'agent',
      'supervisor',
      'aftersales_owner',
      'knowledge_owner',
      'admin',
      'factory_contact',
    ]);
  });

  it.each(table.map((row) => [row.role, row] as const))(
    '%s 的导航与默认首页同 PRD',
    (role, row) => {
      expect(navFor([role]).map(labelOf)).toEqual(row.nav);
      expect(homeFor([role])).toBe(row.home);
    },
  );

  it('多角色导航取并集，按顶栏顺序排列', () => {
    expect(navFor(['agent', 'admin'])).toEqual(['tickets', 'aftersales', 'reports', 'settings']);
    expect(navFor(['knowledge_owner', 'aftersales_owner'])).toEqual([
      'tickets',
      'aftersales',
      'reports',
    ]);
    expect(navFor(['factory_contact', 'agent'])).toEqual(['tickets', 'aftersales']);
  });

  it('多角色默认首页按 坐席 / 客服主管 → 售后负责人 → 知识库负责人 / 管理员 取第一个', () => {
    expect(homeFor(['admin', 'agent'])).toBe('tickets');
    expect(homeFor(['admin', 'aftersales_owner'])).toBe('aftersales');
    expect(homeFor(['aftersales_owner', 'supervisor'])).toBe('tickets');
    expect(homeFor(['knowledge_owner', 'admin'])).toBe('reports');
    expect(homeFor(['factory_contact'])).toBeNull();
    expect(homeFor([])).toBeNull();
  });
});
