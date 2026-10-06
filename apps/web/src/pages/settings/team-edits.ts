import {
  roleNames,
  roles as allRoles,
  storeScopeWords,
  type FieldErrors,
  type Role,
  type StoreScopeValue,
  type TeamChange,
  type TeamMember,
} from '@forcome/contracts';
import { CHANGE_LINE, FIELD_NAMES } from './p20-copy';

/*
 * P20 吸底保存栏的待保存修改（K6）：在格子里改的角色与数据范围先留在页面上，「保存」时一起提交（PUT /api/org/team）。
 * 每位改过的成员记下改后的值与开始改时依据的那一版（版本号与原值）：保存带那一版的版本号，期间被别人改过的由服务端报冲突（G7），
 * 不会悄悄覆盖；摘要的「前」也写那一版。改回原值就不再算修改。
 */

/** 格子所在的列 */
export type TeamCell = 'roles' | 'stores';

export interface TeamEdit {
  readonly roles: readonly Role[];
  readonly stores: StoreScopeValue;
  /** 开始改时依据的那一版 */
  readonly base: TeamMember;
}

/** 成员 ID → 待保存的修改（按改的先后） */
export type TeamEdits = ReadonlyMap<string, TeamEdit>;

const ordered = (memberRoles: readonly Role[]) =>
  allRoles.filter((role) => memberRoles.includes(role));

const sameRoles = (a: readonly Role[], b: readonly Role[]) =>
  ordered(a).join(',') === ordered(b).join(',');

const sameScope = (a: StoreScopeValue, b: StoreScopeValue) =>
  a.all || b.all
    ? a.all === b.all
    : [...a.storeIds].sort().join(',') === [...b.storeIds].sort().join(',');

/** 这位成员哪几格改了 */
export function changedCells(edit: TeamEdit): Record<TeamCell, boolean> {
  return {
    roles: !sameRoles(edit.roles, edit.base.roles),
    stores: !sameScope(edit.stores, edit.base.stores),
  };
}

/**
 * 改一位成员的角色或数据范围：member 是成员表现在的这一行；这个人已经在改时沿用最初依据的那一版。
 * 改后与依据的那一版相同就不再算修改
 */
export function applyEdit(
  edits: TeamEdits,
  member: TeamMember,
  change: { readonly roles?: readonly Role[]; readonly stores?: StoreScopeValue },
): TeamEdits {
  const current = edits.get(member.id);
  const base = current?.base ?? member;
  const next: TeamEdit = {
    roles: ordered(change.roles ?? current?.roles ?? base.roles),
    stores: change.stores ?? current?.stores ?? base.stores,
    base,
  };
  const result = new Map(edits);
  const cells = changedCells(next);
  if (cells.roles || cells.stores) result.set(member.id, next);
  else result.delete(member.id);
  return result;
}

/** 改了几格（保存栏「有 N 项未保存修改」） */
export function changedCellCount(edits: TeamEdits): number {
  let count = 0;
  for (const edit of edits.values()) {
    const cells = changedCells(edit);
    count += Number(cells.roles) + Number(cells.stores);
  }
  return count;
}

/** 每一格修改的写法（保存栏与成功浮层的摘要）：「赵倩 店铺范围：Forcome Direct → 全部店铺」 */
export function changeLines(edits: TeamEdits, storeNames: ReadonlyMap<string, string>): string[] {
  const lines: string[] = [];
  for (const edit of edits.values()) {
    const cells = changedCells(edit);
    const { name } = edit.base;
    if (cells.roles) {
      lines.push(
        CHANGE_LINE(name, FIELD_NAMES.roles, roleNames(edit.base.roles), roleNames(edit.roles)),
      );
    }
    if (cells.stores) {
      lines.push(
        CHANGE_LINE(
          name,
          FIELD_NAMES.stores,
          storeScopeWords(edit.base.stores, storeNames),
          storeScopeWords(edit.stores, storeNames),
        ),
      );
    }
  }
  return lines;
}

/** 提交的内容：带依据的那一版的版本号（保存失败后「覆盖保存」时换成最新的版本号） */
export function teamChangesOf(
  edits: TeamEdits,
  versions?: ReadonlyMap<string, number>,
): TeamChange[] {
  return [...edits].map(([id, edit]) => ({
    id,
    version: versions?.get(id) ?? edit.base.version,
    roles: [...edit.roles],
    stores: edit.stores,
  }));
}

/** 接口的字段错误（键「成员 ID.roles / .stores」）按成员分开 */
export function cellErrorsOf(fields: FieldErrors): Map<string, Partial<Record<TeamCell, string>>> {
  const errors = new Map<string, Partial<Record<TeamCell, string>>>();
  for (const [path, message] of Object.entries(fields)) {
    const match = /^(.+)\.(roles|stores)$/.exec(path);
    if (!match) continue;
    const [, id = '', cell] = match;
    errors.set(id, { ...errors.get(id), [cell as TeamCell]: message });
  }
  return errors;
}

/** 第一个出错的格（按成员表的先后、同一行先角色后数据范围），保存后定位到它 */
export function firstErrorCell(
  errors: ReadonlyMap<string, Partial<Record<TeamCell, string>>>,
  order: readonly string[],
): { memberId: string; column: TeamCell } | null {
  for (const memberId of order) {
    const cell = errors.get(memberId);
    if (cell?.roles) return { memberId, column: 'roles' };
    if (cell?.stores) return { memberId, column: 'stores' };
  }
  return null;
}

/** 一位冲突的成员：最新的一行（已不在成员表里为空）、谁几点改的、改了哪些列 */
export interface TeamConflict {
  readonly id: string;
  readonly name: string;
  readonly latest: TeamMember | null;
  readonly who: string | null;
  readonly at: string | null;
  readonly fields: string[];
}

/** 保存冲突（409）后，对照最新的成员表：依据的那一版已经不是最新的成员 */
export function conflictsOf(edits: TeamEdits, latest: readonly TeamMember[]): TeamConflict[] {
  const byId = new Map(latest.map((m) => [m.id, m]));
  const conflicts: TeamConflict[] = [];
  for (const [id, edit] of edits) {
    const now = byId.get(id) ?? null;
    if (now && now.version === edit.base.version) continue;
    const fields: string[] = [];
    if (now && !sameRoles(now.roles, edit.base.roles)) fields.push(FIELD_NAMES.roles);
    if (now && !sameScope(now.stores, edit.base.stores)) fields.push(FIELD_NAMES.stores);
    if (now && now.status !== edit.base.status) fields.push(FIELD_NAMES.status);
    conflicts.push({
      id,
      name: edit.base.name,
      latest: now,
      who: now?.changedBy ?? null,
      at: now?.changedAt ?? null,
      fields,
    });
  }
  return conflicts;
}

/**
 * 「查看最新」：冲突的人放弃修改、换成最新的；其他人的修改留着（依据换成最新的一行，改得和最新一样的不再算修改）
 */
export function editsAfterReload(edits: TeamEdits, latest: readonly TeamMember[]): TeamEdits {
  const byId = new Map(latest.map((m) => [m.id, m]));
  let next: TeamEdits = new Map();
  for (const [id, edit] of edits) {
    const now = byId.get(id);
    if (!now || now.version !== edit.base.version || now.status !== 'active') continue;
    next = applyEdit(next, now, { roles: edit.roles, stores: edit.stores });
  }
  return next;
}
