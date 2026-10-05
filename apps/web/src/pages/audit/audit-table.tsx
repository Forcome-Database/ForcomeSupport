import { businessDateTime } from '@forcome/calendar';
import {
  auditObjectTypeLabels,
  can,
  roles,
  type AuditLogEntry,
  type AuditLogField,
  type CurrentMember,
} from '@forcome/contracts';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Banknote, ChevronDown, ChevronRight, Lock, Search } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { EmptyState } from '@/components/empty-state';
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
import { avatarText } from '@/lib/avatar';
import { pages } from '@/lib/pages';
import { cn } from '@/lib/utils';
import { A11Y, COLUMNS, EMPTY, EXPAND, MORE, NONE, SYSTEM } from './p27-copy';

/*
 * P27 的表格（原型 build_audit.audit_table() / audit_expand()，参照图 P27_AuditLog、K18 与补充小样）：
 * 时间 · 操作人 · 对象 · 动作 · 变更摘要 · 来源 IP · 展开；列宽照原型的 grid-template-columns（64 / 150 / 250 / 130 / 余下 / 100 / 16，
 * 跨天时时间列 76），行上下 7。越权访问被拒的行浅红底、左侧红条；展开的行浅主色底、左侧主色条，下方浅灰底的两栏对照
 * （左缩进 92），变化的后值主色浅底高亮，财务字段名旁标钱的图标，没有财务权限时值为「已隐藏」（K18）。
 * 点行任意处展开或收起；对象编号在查看者能打开目标页时是链接（售后单进 P13 并打开该单，店铺进 P18 并打开店铺抽屉），
 * 工单、来信、成员、渠道随各自页面上线后在 objectLink 里接上（PRD P27 v2.20）。
 */

/** 操作人头像的色调（原型 AV_TONE：坐席绿、客服主管渐变、售后负责人黄、知识库负责人紫、管理员灰；系统灰） */
const ROLE_TONES: Record<(typeof roles)[number], AvatarTone> = {
  agent: 'green',
  supervisor: 'member',
  aftersales_owner: 'amber',
  knowledge_owner: 'violet',
  admin: 'grey',
  factory_contact: 'amber',
};

function toneOf(entry: AuditLogEntry): AvatarTone {
  if (entry.actor.system) return 'grey';
  const role = roles.find((r) => entry.actor.roles.includes(r));
  return role ? ROLE_TONES[role] : 'grey';
}

/** 一条记录的时刻（北京时间）：只看一天时写「时:分」，跨天写「月-日 时:分」，不在今年的写全年份 */
export function timeLabel(at: string, oneDay: boolean, today: string): string {
  const full = businessDateTime(new Date(at)).slice(0, 16);
  if (oneDay) return full.slice(11);
  return full.startsWith(today.slice(0, 4)) ? full.slice(5) : full;
}

/** 对象能不能点进详情（PRD P27 v2.20）：查看者能打开目标页时给链接，否则只显示编号 */
function objectLink(entry: AuditLogEntry, member: CurrentMember): ReactNode {
  const linkClass =
    'truncate text-13 font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring';
  const stop = (event: React.MouseEvent) => event.stopPropagation();
  if (entry.objectType === 'aftersales' && can(member.roles, pages.aftersalesLedger.capability)) {
    return (
      <Link
        to={pages.aftersalesLedger.path}
        search={{ open: entry.objectLabel }}
        className={linkClass}
        onClick={stop}
      >
        {entry.objectLabel}
      </Link>
    );
  }
  if (entry.objectType === 'store' && can(member.roles, pages.settingsChannels.capability)) {
    return (
      <Link
        to={pages.settingsChannels.path}
        search={{ store: entry.objectId }}
        className={linkClass}
        onClick={stop}
      >
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
      <div className="pb-1 text-12 font-semibold tracking-[0.03em] text-muted-foreground">
        {title}
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

/** 行展开：两栏对照完整前后值与说明行（原型 audit_expand()） */
function Expanded({ entry }: { entry: AuditLogEntry }) {
  const meta = EXPAND.meta(
    businessDateTime(new Date(entry.at)).slice(5, 16),
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

const SKELETON_ROWS = 5;

export function AuditTable({
  entries,
  member,
  oneDay,
  today,
  expandedId,
  onToggle,
  empty,
}: {
  /** 这一页的记录；加载中为 null（骨架） */
  entries: readonly AuditLogEntry[] | null;
  member: CurrentMember;
  /** 只看一天（时间列只写时分） */
  oneDay: boolean;
  today: string;
  expandedId: string | null;
  onToggle: (id: string) => void;
  empty: { description: string; action?: ReactNode };
}) {
  const columns = [
    { key: 'time', label: COLUMNS.time, width: oneDay ? 86 : 98 },
    { key: 'actor', label: COLUMNS.actor, width: 162 },
    { key: 'object', label: COLUMNS.object, width: 262 },
    { key: 'action', label: COLUMNS.action, width: 142 },
    { key: 'summary', label: COLUMNS.summary, width: undefined },
    { key: 'ip', label: COLUMNS.ip, width: 112 },
    { key: 'toggle', label: '', width: 38 },
  ];
  return (
    <Table data-testid="audit-table">
      <colgroup>
        {columns.map((column) => (
          <col key={column.key} style={column.width ? { width: column.width } : undefined} />
        ))}
      </colgroup>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.key}>{column.label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries === null ? (
          Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <TableRow key={i} aria-busy>
              {columns.map((column) => (
                <TableCell key={column.key} className="py-2.5">
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
          entries.map((entry) => {
            const open = entry.id === expandedId;
            const label = `${auditObjectTypeLabels[entry.objectType]} ${entry.objectLabel} ${entry.actionLabel}`;
            return (
              <Fragment key={entry.id}>
                <TableRow
                  data-testid="audit-row"
                  data-denied={entry.denied || undefined}
                  data-expanded={open || undefined}
                  onClick={() => onToggle(entry.id)}
                  className={cn(
                    'cursor-pointer tabular-nums',
                    entry.denied
                      ? 'bg-destructive-soft shadow-[inset_3px_0_0_var(--destructive)]'
                      : open
                        ? 'bg-primary-soft shadow-[inset_3px_0_0_var(--primary)]'
                        : 'bg-card hover:bg-muted',
                  )}
                >
                  <TableCell className="py-1.75 text-12 whitespace-nowrap text-muted-foreground">
                    {timeLabel(entry.at, oneDay, today)}
                  </TableCell>
                  <TableCell className="py-1.75">
                    <ActorCell entry={entry} />
                  </TableCell>
                  <TableCell className="py-1.75">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="shrink-0 text-12 text-subtle-foreground">
                        {auditObjectTypeLabels[entry.objectType]}
                      </span>
                      {objectLink(entry, member)}
                    </div>
                  </TableCell>
                  <TableCell className="py-1.75">
                    {entry.denied ? (
                      <Badge tone="danger">
                        <Lock className="size-3" strokeWidth={2} />
                        {entry.actionLabel}
                      </Badge>
                    ) : (
                      <span className="text-13 font-semibold whitespace-nowrap text-foreground">
                        {entry.actionLabel}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="py-1.75">
                    <div className="truncate text-12 text-ink-2" title={entry.summary}>
                      {entry.summary}
                      {entry.more > 0 && (
                        <span className="text-subtle-foreground">{MORE(entry.more)}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="py-1.75 text-12 whitespace-nowrap text-muted-foreground">
                    {entry.ip ?? NONE}
                  </TableCell>
                  <TableCell className="py-1.75 text-right">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-label={open ? A11Y.collapse(label) : A11Y.expand(label)}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggle(entry.id);
                      }}
                      className="inline-flex rounded-xs text-subtle-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {open ? (
                        <ChevronDown className="size-3.5" strokeWidth={2} />
                      ) : (
                        <ChevronRight className="size-3.5" strokeWidth={2} />
                      )}
                    </button>
                  </TableCell>
                </TableRow>
                {open && (
                  <TableRow className="bg-muted shadow-[inset_3px_0_0_var(--primary)]">
                    <TableCell colSpan={columns.length} className="pt-3 pb-3.5 first:pl-23">
                      <Expanded entry={entry} />
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
