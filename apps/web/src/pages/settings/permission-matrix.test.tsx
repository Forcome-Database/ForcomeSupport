import { capabilities, isLive, roles, type Grant } from '@forcome/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from './p20-copy';
import { PermissionMatrix } from './permission-matrix';

/*
 * 「角色权限」页签（K17 第一阶段）与能力矩阵是同一个数据源（待办 06 验收 3）：每一行是一项当前阶段已上线的能力，
 * 6 个角色的格子逐格对上 contracts 的权限种类（● 有权限、○ 只能看自己的并写范围、文字为部分能力、「—」无权限）。
 */

const html = renderToStaticMarkup(<PermissionMatrix />);
/** 去掉标签（含切开处剩下的半个下一格的开标签） */
const stripTags = (fragment: string) => fragment.replace(/<[^>]*>/g, '').replace(/<[^>]*$/, '');

/** 每一行（按出现顺序）：能力的键、能力文案、6 格的权限种类与文字 */
const rows = html
  .split('data-capability="')
  .slice(1)
  .map((part) => {
    const key = part.slice(0, part.indexOf('"'));
    const header = /role="rowheader"[^>]*>([^<]*)</.exec(part)?.[1] ?? null;
    const cells = part
      .split('data-grant="')
      .slice(1)
      .map((cell) => [
        cell.slice(0, cell.indexOf('"')),
        stripTags(cell.slice(cell.indexOf('>') + 1)),
      ]);
    return { key, header, cells };
  });

/** 一格应写的文字（● 与 ○ 没有文字，○ 带范围时写范围） */
function textOf(grant: Grant | undefined): string {
  if (!grant) return PERMISSIONS.none;
  if (grant.kind === 'partial') return grant.label;
  if (grant.kind === 'own') return grant.scope ?? '';
  return '';
}

describe('「角色权限」页签由能力矩阵渲染', () => {
  const live = capabilities.filter((c) => isLive(c.key));

  it('只列当前阶段已上线的能力，按 K17 的顺序', () => {
    expect(rows.map((row) => row.key)).toEqual(live.map((c) => c.key));
    expect(rows).toHaveLength(13);
  });

  it('每一行的能力文案与 6 个角色的格子逐格对上', () => {
    for (const capability of live) {
      const row = rows.find((r) => r.key === capability.key);
      expect(row?.header).toBe(capability.label);
      expect(row?.cells, capability.label).toEqual(
        roles.map((role) => [
          capability.grants[role]?.kind ?? 'none',
          textOf(capability.grants[role]),
        ]),
      );
    }
  });
});
