import {
  capabilities,
  capabilityGroups,
  isLive,
  roleLabels,
  roles,
  type CapabilityDefinition,
  type Grant,
} from '@forcome/contracts';
import { Fragment } from 'react';
import { SectionLabel } from '@/components/section-label';
import { cn } from '@/lib/utils';
import { A11Y, PERMISSIONS } from './p20-copy';

/*
 * 「角色权限」页签（K17 第一阶段小图；PRD 10.1，原型 build_settings.perm_matrix(phase1=True)）：只读，直接由 contracts 的
 * 能力矩阵渲染（同一个数据源，前端据此显示入口、后端据此强制），只列当前阶段已上线的能力行（一起、仅一）。
 * 一张表全部展开：左侧分组小标题（每组第一行写组名，组与组之间实线、组内浅线），6 个角色列（含生产厂对接人）；
 * ● 有权限、○ 只能看自己发起或负责的（带范围的写在圆圈右边）、文字为部分能力、「—」无权限。表头上方写说明与图例。
 */

/** 列宽照原型 grid-template-columns「72px minmax(0, 1fr) repeat(6, 120px)」，列间距 12、左右 16 */
const GRID = 'grid grid-cols-[72px_minmax(0,1fr)_repeat(6,120px)] items-center gap-x-3 px-4';

/** 当前阶段已上线的能力，按 K17 的分组；没有能力的组不出现 */
function liveGroups() {
  return capabilityGroups
    .map((group) => ({
      ...group,
      rows: capabilities.filter((c) => c.group === group.key && isLive(c.key)),
    }))
    .filter((group) => group.rows.length > 0);
}

const dot = 'size-2.25 shrink-0 rounded-full';

/** 一格的写法（原型 mark()） */
function Mark({ grant }: { grant: Grant | undefined }) {
  if (!grant) {
    return <div className="text-center text-12 text-subtle-foreground">{PERMISSIONS.none}</div>;
  }
  if (grant.kind === 'full') return <div className={cn(dot, 'mx-auto bg-primary')} />;
  if (grant.kind === 'own') {
    return (
      <div className="flex items-center justify-center gap-1">
        <div className={cn(dot, 'border-[1.5px] border-primary')} />
        {grant.scope && (
          <div className="text-11 whitespace-nowrap text-muted-foreground">{grant.scope}</div>
        )}
      </div>
    );
  }
  return (
    <div className="text-center text-12 whitespace-nowrap text-muted-foreground">{grant.label}</div>
  );
}

function Legend() {
  const item = 'flex items-center gap-1.25 text-12 whitespace-nowrap text-muted-foreground';
  return (
    <div className="flex items-center gap-4">
      <div className={item}>
        <div className={cn(dot, 'bg-primary')} />
        {PERMISSIONS.legend.full}
      </div>
      <div className={item}>
        <div className={cn(dot, 'border-[1.5px] border-primary')} />
        {PERMISSIONS.legend.own}
      </div>
      <div className={item}>
        <span className="text-subtle-foreground">{PERMISSIONS.none}</span>
        {PERMISSIONS.legend.none}
      </div>
      <div className={item}>{PERMISSIONS.legend.partial}</div>
    </div>
  );
}

function CapabilityRow({
  capability,
  groupLabel,
  separator,
}: {
  capability: CapabilityDefinition;
  /** 组的第一行写组名 */
  groupLabel: string | null;
  /** 与上一行之间：组与组之间实线，组内浅线；第一行没有 */
  separator: 'group' | 'row' | null;
}) {
  return (
    <div
      role="row"
      className={cn(
        GRID,
        'py-1.75',
        separator === 'group' && 'border-t border-border',
        separator === 'row' && 'border-t border-border-soft',
      )}
    >
      <div role="cell" className="text-12 font-bold text-muted-foreground">
        {groupLabel}
      </div>
      {/* 能力文案较长：放不下时换行（原型画布更宽、写在一行） */}
      <div role="rowheader" className="min-w-0 text-13 text-ink-2">
        {capability.label}
      </div>
      {roles.map((role) => (
        <div role="cell" key={role}>
          <Mark grant={capability.grants[role]} />
        </div>
      ))}
    </div>
  );
}

export function PermissionMatrix() {
  const groups = liveGroups();
  return (
    <section aria-label={A11Y.permissionsRegion} className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <SectionLabel>{PERMISSIONS.label}</SectionLabel>
          <span className="text-12 whitespace-nowrap text-muted-foreground">
            {PERMISSIONS.note}
          </span>
        </div>
        <Legend />
      </div>
      <div
        role="table"
        aria-label={PERMISSIONS.label}
        data-testid="permission-matrix"
        className="overflow-hidden rounded-lg border bg-card shadow-xs"
      >
        <div
          role="row"
          className={cn(
            GRID,
            'border-b bg-muted py-2.25 text-11 font-semibold whitespace-nowrap text-subtle-foreground',
          )}
        >
          <div role="columnheader">{PERMISSIONS.columns.group}</div>
          <div role="columnheader">{PERMISSIONS.columns.capability}</div>
          {roles.map((role) => (
            <div role="columnheader" key={role} className="text-center">
              {roleLabels[role]}
            </div>
          ))}
        </div>
        {groups.map((group, groupIndex) => (
          <Fragment key={group.key}>
            {group.rows.map((capability, index) => (
              <CapabilityRow
                key={capability.key}
                capability={capability}
                groupLabel={index === 0 ? group.label : null}
                separator={index > 0 ? 'row' : groupIndex > 0 ? 'group' : null}
              />
            ))}
          </Fragment>
        ))}
      </div>
    </section>
  );
}
