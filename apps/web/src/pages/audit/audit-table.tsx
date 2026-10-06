import {
  auditObjectTypeLabels,
  auditTimeWords,
  type AuditLogEntry,
  type AuditLogField,
  type CurrentMember,
} from '@forcome/contracts';
import {
  createColumnHelper,
  metaHelper,
  rowExpandingFeature,
  tableFeatures,
  useTable,
  type ExpandedState,
} from '@tanstack/react-table';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Banknote, ChevronDown, ChevronRight, Lock, Search } from 'lucide-react';
import { Fragment, type MouseEvent, type ReactNode } from 'react';
import { EmptyState } from '@/components/empty-state';
import { SectionLabel } from '@/components/section-label';
import { Avatar, AvatarFallback, type AvatarTone } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
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
import { canOpenPage, pages } from '@/lib/pages';
import { cn } from '@/lib/utils';
import { A11Y, COLUMNS, EMPTY, EXPAND, MORE, NONE, SYSTEM } from './p27-copy';

/*
 * P27 的表格（原型 build_audit.audit_table() / audit_expand()，参照图 P27_AuditLog、K18 与补充小样）：
 * 时间 · 操作人 · 对象 · 动作 · 变更摘要 · 来源 IP · 展开。列定义交给 TanStack Table（ADR 0007「后续表格照 ledger-table.tsx 写」），
 * 列宽照原型的 grid-template-columns（64 / 150 / 250 / 130 / 余下 / 100 / 16，含单元格内边距；「近 7 天」「自定义」带日期时
 * 时间列 76）写在列的 meta；行展开用 rowExpandingFeature，展开状态由页面受控（同一时间只展开一行）。
 * 越权访问被拒的行浅红底、左侧红条；展开的行浅主色底、左侧主色条，下方浅灰底的两栏对照（左缩进 92），变化的后值主色浅底高亮，
 * 财务字段名旁标钱的图标，没有财务权限时值为「已隐藏」（K18）。点行任意处展开或收起；对象编号在查看者能打开目标页时是链接
 * （售后单进 P13 并打开该单，店铺进 P18 并打开店铺抽屉，成员进 P20 并选中该行，渠道进 P18），工单、来信随各自页面上线后在 objectLink 里接上
 * （PRD P27 v2.20）。
 */

/** 操作人头像的色调（原型 AV_TONE，同 P20 成员表）；系统灰 */
function toneOf(entry: AuditLogEntry): AvatarTone {
  return entry.actor.system ? 'grey' : roleAvatarTone(entry.actor.roles);
}

const linkClass =
  'truncate text-13 font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring';
/** 链接在可点的行里：点链接不展开这一行 */
const stopRowToggle = (event: MouseEvent) => event.stopPropagation();

/** 对象能不能点进详情（PRD P27 v2.20）：查看者能打开目标页时给链接，否则只显示编号 */
function objectLink(entry: AuditLogEntry, member: CurrentMember): ReactNode {
  if (entry.objectType === 'aftersales' && canOpenPage(member, pages.aftersalesLedger)) {
    return (
      <Link
        to={pages.aftersalesLedger.path}
        search={{ open: entry.objectLabel }}
        className={linkClass}
        onClick={stopRowToggle}
      >
        {entry.objectLabel}
      </Link>
    );
  }
  if (entry.objectType === 'member' && canOpenPage(member, pages.settingsTeam)) {
    return (
      <Link
        to={pages.settingsTeam.path}
        search={{ member: entry.objectId }}
        className={linkClass}
        onClick={stopRowToggle}
      >
        {entry.objectLabel}
      </Link>
    );
  }
  if (entry.objectType === 'store' && canOpenPage(member, pages.settingsChannels)) {
    return (
      <Link
        to={pages.settingsChannels.path}
        search={{ store: entry.objectId }}
        className={linkClass}
        onClick={stopRowToggle}
      >
        {entry.objectLabel}
      </Link>
    );
  }
  // 渠道（Gmail 邮箱的连接异常与恢复，待办 09）进 P18；P18 只对管理员开放（PRD P27「第一阶段」v2.25）
  if (entry.objectType === 'channel' && canOpenPage(member, pages.settingsChannels)) {
    return (
      <Link to={pages.settingsChannels.path} className={linkClass} onClick={stopRowToggle}>
        {entry.objectLabel}
      </Link>
    );
  }
  return <span className="truncate text-13 text-ink-2">{entry.objectLabel}</span>;
}

function ActorCell({ entry }: { entry: AuditLogEntry }) {
  if (entry.actor.system) {
    return (
      <div className="flex items-center gap-2">
        <Avatar size="xs" tone="grey">
          <AvatarFallback>{SYSTEM.avatar}</AvatarFallback>
        </Avatar>
        <span className="text-13 font-semibold whitespace-nowrap text-foreground">
          {SYSTEM.name}
        </span>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Avatar size="xs" tone={toneOf(entry)}>
        <AvatarFallback>{avatarText(entry.actor.name)}</AvatarFallback>
      </Avatar>
      <span className="text-13 font-semibold whitespace-nowrap text-foreground">
        {entry.actor.name}
      </span>
      <span className="truncate text-12 text-subtle-foreground">{entry.actor.roleText}</span>
    </div>
  );
}

/** 「已隐藏」（原型 chip('已隐藏', 'muted', 11, 'lock')） */
function HiddenValue() {
  return (
    <Badge tone="muted">
      <Lock className="size-3" strokeWidth={2} />
      {EXPAND.hidden}
    </Badge>
  );
}

/** 两栏里的一个值：已隐藏；变更后的变化值高亮；「—」用最浅的次要色 */
function FieldValue({ field, side }: { field: AuditLogField; side: 'before' | 'after' }) {
  const value = field[side];
  if (field.hidden || value === null) return <HiddenValue />;
  if (side === 'after' && field.changed) {
    return (
      <span className="rounded-xs bg-primary-soft px-1.25 py-px font-semibold break-words text-primary-text">
        {value}
      </span>
    );
  }
  return (
    <span className={cn('break-words', value === NONE ? 'text-subtle-foreground' : 'text-ink-2')}>
      {value}
    </span>
  );
}

function FieldPane({
  title,
  fields,
  side,
}: {
  title: string;
  fields: readonly AuditLogField[];
  side: 'before' | 'after';
}) {
  return (
    <div
      data-testid={`audit-${side}`}
      className="flex min-w-0 flex-1 flex-col gap-1 rounded-md border bg-card px-3 py-2.5"
    >
      <div className="pb-1">
        <SectionLabel as="div">{title}</SectionLabel>
      </div>
      {fields.map((field) => (
        <div
          key={field.label}
          data-field={field.label}
          className="grid min-h-5.5 grid-cols-[76px_minmax(0,1fr)] items-center gap-2.5 text-12"
        >
          <div className="flex items-center gap-1 whitespace-nowrap text-muted-foreground">
            {field.label}
            {field.finance && <Banknote aria-hidden className="size-2.75 text-subtle-foreground" />}
          </div>
          <div className="min-w-0">
            <FieldValue field={field} side={side} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 行展开：两栏对照完整前后值与说明行（原型 audit_expand()；说明行的时刻总带日期，不在今年的写年份） */
function Expanded({ entry, year }: { entry: AuditLogEntry; year: string }) {
  const meta = EXPAND.meta(
    auditTimeWords(entry.at, { withDate: true, year }),
    entry.actor.system ? SYSTEM.name : entry.actor.name,
    entry.actor.system ? SYSTEM.name : entry.actor.roleText,
    entry.ip ?? NONE,
  );
  return (
    <div data-testid="audit-expanded" className="flex flex-col">
      {entry.fields.length > 0 && (
        <div className="flex items-stretch gap-2.5">
          <FieldPane title={EXPAND.before} fields={entry.fields} side="before" />
          <div className="flex items-center">
            <ArrowRight className="size-4 text-subtle-foreground" />
          </div>
          <FieldPane title={EXPAND.after} fields={entry.fields} side="after" />
        </div>
      )}
      <div className="pt-2 text-12 text-subtle-foreground">{meta}</div>
    </div>
  );
}

/** 列的附加信息：列宽（含单元格内边距；null 为占剩余宽度；时间列带日期时另一个宽度）与单元格的字号颜色 */
interface ColumnMeta {
  readonly width: number | null;
  readonly datedWidth?: number;
  readonly className?: string;
}

/** 单元格要用的上下文（交给表格的 meta） */
interface TableMeta {
  readonly member: CurrentMember;
  /** 时间列带不带日期（「今天」只写时分） */
  readonly withDate: boolean;
  /** 今年：不在今年的时刻写年份 */
  readonly year: string;
}

const features = tableFeatures({
  rowExpandingFeature,
  columnMeta: metaHelper<ColumnMeta>(),
  tableMeta: metaHelper<TableMeta>(),
});
const helper = createColumnHelper<typeof features, AuditLogEntry>();
const minor = 'text-12 whitespace-nowrap text-muted-foreground';

const COLUMN_DEFS = helper.columns([
  helper.display({
    id: 'time',
    header: COLUMNS.time,
    cell: ({ row, table }) => {
      const { withDate, year } = table.options.meta!;
      return auditTimeWords(row.original.at, { withDate, year });
    },
    meta: { width: 86, datedWidth: 98, className: minor },
  }),
  helper.display({
    id: 'actor',
    header: COLUMNS.actor,
    cell: ({ row }) => <ActorCell entry={row.original} />,
    meta: { width: 162 },
  }),
  helper.display({
    id: 'object',
    header: COLUMNS.object,
    cell: ({ row, table }) => (
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-12 text-subtle-foreground">
          {auditObjectTypeLabels[row.original.objectType]}
        </span>
        {objectLink(row.original, table.options.meta!.member)}
      </div>
    ),
    meta: { width: 262 },
  }),
  helper.display({
    id: 'action',
    header: COLUMNS.action,
    cell: ({ row }) =>
      row.original.denied ? (
        <Badge tone="danger">
          <Lock className="size-3" strokeWidth={2} />
          {row.original.actionLabel}
        </Badge>
      ) : (
        <span className="text-13 font-semibold whitespace-nowrap text-foreground">
          {row.original.actionLabel}
        </span>
      ),
    meta: { width: 142 },
  }),
  helper.display({
    id: 'summary',
    header: COLUMNS.summary,
    cell: ({ row }) => (
      <div className="truncate text-12 text-ink-2" title={row.original.summary}>
        {row.original.summary}
        {row.original.more > 0 && (
          <span className="text-subtle-foreground">{MORE(row.original.more)}</span>
        )}
      </div>
    ),
    meta: { width: null },
  }),
  helper.display({
    id: 'ip',
    header: COLUMNS.ip,
    cell: ({ row }) => row.original.ip ?? NONE,
    meta: { width: 112, className: minor },
  }),
  helper.display({
    id: 'toggle',
    header: '',
    cell: ({ row }) => {
      const open = row.getIsExpanded();
      const entry = row.original;
      const label = `${auditObjectTypeLabels[entry.objectType]} ${entry.objectLabel} ${entry.actionLabel}`;
      return (
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? A11Y.collapse(label) : A11Y.expand(label)}
          onClick={(event) => {
            event.stopPropagation();
            row.toggleExpanded();
          }}
          className="inline-flex rounded-xs text-subtle-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? (
            <ChevronDown className="size-3.5" strokeWidth={2} />
          ) : (
            <ChevronRight className="size-3.5" strokeWidth={2} />
          )}
        </button>
      );
    },
    meta: { width: 38, className: 'text-right' },
  }),
]);

const SKELETON_ROWS = 5;
/** 加载中交给表格的空数据（引用不变） */
const NO_ROWS: AuditLogEntry[] = [];

export function AuditTable({
  entries,
  member,
  withDate,
  today,
  expandedId,
  onExpandedChange,
  empty,
}: {
  /** 这一页的记录；加载中为 null（骨架） */
  entries: AuditLogEntry[] | null;
  member: CurrentMember;
  /** 时间列带日期（「近 7 天」「自定义」） */
  withDate: boolean;
  today: string;
  /** 展开的那一行（同一时间只展开一行） */
  expandedId: string | null;
  onExpandedChange: (id: string | null) => void;
  empty: { description: string; action?: ReactNode };
}) {
  const expanded: ExpandedState = expandedId ? { [expandedId]: true } : {};
  const year = today.slice(0, 4);
  const table = useTable({
    features,
    columns: COLUMN_DEFS,
    data: entries ?? NO_ROWS,
    getRowId: (entry) => entry.id,
    getRowCanExpand: () => true,
    state: { expanded },
    onExpandedChange: (updater) => {
      const next = typeof updater === 'function' ? updater(expanded) : updater;
      const ids = next === true ? [] : Object.keys(next).filter((id) => next[id]);
      // 新点开的那一行（不是原来展开的）；都收起为 null
      onExpandedChange(ids.find((id) => id !== expandedId) ?? null);
    },
    meta: { member, withDate, year },
  });
  const columns = table.getAllLeafColumns();

  return (
    <Table data-testid="audit-table">
      <colgroup>
        {columns.map((column) => {
          const meta = column.columnDef.meta;
          const width = withDate ? (meta?.datedWidth ?? meta?.width) : meta?.width;
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
        {entries === null ? (
          Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <TableRow key={i} aria-busy>
              {columns.map((column) => (
                <TableCell key={column.id} className="py-2.5">
                  <Skeleton className="h-3.5 rounded-sm" />
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : entries.length === 0 ? (
          <TableRow>
            <TableCell colSpan={columns.length} className="p-0">
              <EmptyState
                icon={Search}
                title={EMPTY.title}
                description={empty.description}
                action={empty.action}
              />
            </TableCell>
          </TableRow>
        ) : (
          table.getRowModel().rows.map((row) => {
            const open = row.getIsExpanded();
            const denied = row.original.denied;
            return (
              <Fragment key={row.id}>
                <TableRow
                  data-testid="audit-row"
                  data-denied={denied || undefined}
                  data-expanded={open || undefined}
                  onClick={() => row.toggleExpanded()}
                  className={cn(
                    'cursor-pointer tabular-nums',
                    denied
                      ? 'bg-destructive-soft shadow-[inset_3px_0_0_var(--destructive)]'
                      : open
                        ? 'bg-primary-soft shadow-[inset_3px_0_0_var(--primary)]'
                        : 'bg-card hover:bg-muted',
                  )}
                >
                  {row.getAllCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn('py-1.75', cell.column.columnDef.meta?.className)}
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
                {open && (
                  <TableRow className="bg-muted shadow-[inset_3px_0_0_var(--primary)]">
                    <TableCell colSpan={columns.length} className="pt-3 pb-3.5 first:pl-23">
                      <Expanded entry={row.original} year={year} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
