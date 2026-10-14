import {
  disableBlockedReason,
  lastLoginWords,
  memberStatusLabels,
  type Role,
  type StoreScopeValue,
  type TeamMember,
  type TeamStore,
} from '@forcome/contracts';
import { createColumnHelper, metaHelper, tableFeatures, useTable } from '@tanstack/react-table';
import { CircleX } from 'lucide-react';
import { useLayoutEffect } from 'react';
import { BlockedItem, RowMenuTrigger } from '@/components/row-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { avatarText, roleAvatarTone } from '@/lib/avatar';
import { cn } from '@/lib/utils';
import { A11Y, MEMBER_MENU, MEMBER_TABLE } from './p20-copy';
import { DISABLED_MEMBER_REASON, RoleCell, ScopeCell } from './team-cells';
import { changedCells, type TeamCell, type TeamEdits } from './team-edits';

/*
 * P20 成员表（原型 build_settings.member_table(lang=False)，参照图 P20_SettingsTeam）：
 * 成员（头像 + 姓名 + 邮箱）· 钉钉部门 · 角色 · 数据范围 · 状态 · 最近登录 · 行尾「更多」（只有「停用」，K10 第一阶段补充小样，
 * 待办 23）；第一阶段没有「语言」列。
 * 列定义交给 TanStack Table（ADR 0007「后续表格照 ledger-table.tsx 写」），列宽照原型 grid-template-columns
 * 「minmax(0, 1fr) 150px 190px 110px 90px 110px」换算（含单元格内边距）写在列的 meta；行上下 11。
 * 角色与数据范围两格可以直接改（team-cells.tsx），改过的行首格左侧画警示色条（K6 row_tones），从 P27 点成员进来的行为选中态
 * （浅主色底、左侧主色条，同 P13 选中行）。
 */

interface ColumnMeta {
  /** 列宽（含单元格内边距）；null 占剩余宽度 */
  readonly width: number | null;
}

/** 单元格要用的上下文（交给表格的 meta） */
interface TableMeta {
  readonly selfId: string;
  readonly now: Date;
  readonly stores: readonly TeamStore[];
  readonly storeNames: ReadonlyMap<string, string>;
  readonly edits: TeamEdits;
  readonly errors: ReadonlyMap<string, Partial<Record<TeamCell, string>>>;
  readonly cellId: (memberId: string, cell: TeamCell) => string;
  readonly onRoles: (member: TeamMember, roles: Role[]) => void;
  readonly onStores: (member: TeamMember, stores: StoreScopeValue) => void;
  /** 在职管理员的人数（最后一位在职管理员不能停用） */
  readonly activeAdmins: number;
  /** 行尾「更多」点了「停用」 */
  readonly onDisable: (member: TeamMember) => void;
}

const features = tableFeatures({
  columnMeta: metaHelper<ColumnMeta>(),
  tableMeta: metaHelper<TableMeta>(),
});
const helper = createColumnHelper<typeof features, TeamMember>();

const COLUMN_DEFS = helper.columns([
  helper.display({
    id: 'member',
    header: MEMBER_TABLE.columns.member,
    cell: ({ row, table }) => {
      const member = row.original;
      const self = member.id === table.options.meta!.selfId;
      return (
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar size="md" tone={roleAvatarTone(member.roles)}>
            <AvatarFallback>{avatarText(member.name)}</AvatarFallback>
          </Avatar>
          {/* 姓名与邮箱的行高照原型（字体的 normal 行高、间距 1） */}
          <div className="flex min-w-0 flex-col gap-px">
            <span className="truncate text-13 leading-[normal] font-bold text-foreground">
              {self ? MEMBER_TABLE.self(member.name) : member.name}
            </span>
            {member.email && (
              <span
                title={member.email}
                className="truncate text-12 leading-[normal] text-subtle-foreground"
              >
                {member.email}
              </span>
            )}
          </div>
        </div>
      );
    },
    meta: { width: null },
  }),
  helper.display({
    id: 'dept',
    header: MEMBER_TABLE.columns.dept,
    cell: ({ row }) => (
      <span title={row.original.dept} className="block truncate text-13 text-ink-2">
        {row.original.dept}
      </span>
    ),
    meta: { width: 162 },
  }),
  helper.display({
    id: 'roles',
    header: MEMBER_TABLE.columns.roles,
    cell: ({ row, table }) => {
      const member = row.original;
      const meta = table.options.meta!;
      const edit = meta.edits.get(member.id);
      return (
        <RoleCell
          id={meta.cellId(member.id, 'roles')}
          name={member.name}
          roles={edit?.roles ?? member.roles}
          disabledReason={member.status === 'active' ? null : DISABLED_MEMBER_REASON}
          changed={edit ? changedCells(edit).roles : false}
          error={meta.errors.get(member.id)?.roles}
          onChange={(roles) => meta.onRoles(member, roles)}
        />
      );
    },
    meta: { width: 202 },
  }),
  helper.display({
    id: 'stores',
    header: MEMBER_TABLE.columns.stores,
    cell: ({ row, table }) => {
      const member = row.original;
      const meta = table.options.meta!;
      const edit = meta.edits.get(member.id);
      return (
        <ScopeCell
          id={meta.cellId(member.id, 'stores')}
          name={member.name}
          scope={edit?.stores ?? member.stores}
          stores={meta.stores}
          storeNames={meta.storeNames}
          disabledReason={member.status === 'active' ? null : DISABLED_MEMBER_REASON}
          changed={edit ? changedCells(edit).stores : false}
          error={meta.errors.get(member.id)?.stores}
          onChange={(stores) => meta.onStores(member, stores)}
        />
      );
    },
    meta: { width: 122 },
  }),
  helper.display({
    id: 'status',
    header: MEMBER_TABLE.columns.status,
    cell: ({ row }) => (
      <Badge tone={row.original.status === 'active' ? 'success' : 'muted'} dot>
        {memberStatusLabels[row.original.status]}
      </Badge>
    ),
    meta: { width: 102 },
  }),
  helper.display({
    id: 'lastLogin',
    header: MEMBER_TABLE.columns.lastLogin,
    cell: ({ row, table }) => (
      <span className="text-13 whitespace-nowrap text-ink-2 tabular-nums">
        {lastLoginWords(row.original.lastLoginAt, table.options.meta!.now)}
      </span>
    ),
    meta: { width: 132 },
  }),
  helper.display({
    id: 'more',
    header: '',
    cell: ({ row, table }) => {
      const meta = table.options.meta!;
      const member = row.original;
      const reason = disableBlockedReason(member, meta.selfId, meta.activeAdmins);
      return (
        <DropdownMenu>
          <RowMenuTrigger label={A11Y.more(member.name)} />
          <DropdownMenuContent align="end" className="w-35">
            {reason ? (
              <BlockedItem icon={<CircleX />} label={MEMBER_MENU.disable} reason={reason} />
            ) : (
              <DropdownMenuItem
                onSelect={() => meta.onDisable(member)}
                className="text-destructive-text focus:text-destructive-text"
              >
                <CircleX />
                {MEMBER_MENU.disable}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
    meta: { width: 50 },
  }),
]);

const SKELETON_ROWS = 6;
const NO_ROWS: TeamMember[] = [];

export function TeamTable({
  members,
  selectedId,
  ...meta
}: {
  /** 加载中为 null（骨架） */
  members: readonly TeamMember[] | null;
  /** 从 P27 点成员进来时选中的那一行 */
  selectedId: string | undefined;
} & TableMeta) {
  const table = useTable({
    features,
    columns: COLUMN_DEFS,
    data: (members as TeamMember[] | null) ?? NO_ROWS,
    getRowId: (member) => member.id,
    meta,
  });
  const columns = table.getAllLeafColumns();

  // 从 P27 点成员进来：把选中的行滚到可见区
  const ready = members !== null;
  useLayoutEffect(() => {
    if (!ready || !selectedId) return;
    document
      .querySelector(`[data-member-id="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView({ block: 'center' });
  }, [ready, selectedId]);

  return (
    <Table data-testid="team-table">
      <colgroup>
        {columns.map((column) => {
          const width = column.columnDef.meta?.width;
          return <col key={column.id} style={width ? { width } : undefined} />;
        })}
      </colgroup>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => (
              <TableHead key={header.id}>
                <table.FlexRender header={header} />
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {members === null
          ? Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <TableRow key={i} aria-busy>
                {columns.map((column) => (
                  <TableCell key={column.id} className="py-3">
                    <Skeleton className="h-3.5 rounded-sm" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          : table.getRowModel().rows.map((row) => {
              const selected = row.id === selectedId;
              const edited = meta.edits.has(row.id);
              return (
                <TableRow
                  key={row.id}
                  data-testid="team-row"
                  data-member-id={row.id}
                  data-edited={edited || undefined}
                  aria-selected={selected || undefined}
                  className={cn(selected && 'bg-primary-soft')}
                >
                  {row.getAllCells().map((cell, index) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        'py-2.75',
                        index === 0 && selected && 'shadow-[inset_3px_0_0_var(--primary)]',
                        index === 0 &&
                          !selected &&
                          edited &&
                          'shadow-[inset_3px_0_0_var(--warning)]',
                      )}
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
      </TableBody>
    </Table>
  );
}
