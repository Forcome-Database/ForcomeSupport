import {
  roleLabels,
  storeScopeWords,
  teamMessages,
  teamRoles,
  type Role,
  type StoreScopeValue,
  type TeamStore,
} from '@forcome/contracts';
import { Pencil } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { DisabledReason } from '@/components/disabled-reason';
import { FieldError } from '@/components/form-field';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { A11Y, CELL_EDIT, EDITED } from './p20-copy';

/*
 * 成员表里可以直接改的两格（P20「第一阶段」，照 K6「在格子里改、改过的格标已修改」；2026-10-06 用户确认）：
 * 「角色」点开为勾选列表（P20 能分配的五个角色，没有生产厂对接人），只剩一个角色时它不能取消（悬停写原因）；
 * 「数据范围」点开为「全部店铺（含以后新增的）/ 指定店铺」单选，选指定店铺时下方勾选店铺（列全部店铺）。
 * 改了立即记为待保存的修改（吸底保存栏统一保存），格旁标黄色「已修改」；保存时的报错写在格子下方。
 * 已停用的成员不能改：格子照常显示，悬停写原因。格子外观与原型静态的成员表相同，悬停与键盘聚焦时浅灰底并露出笔形图标。
 */

/** 格子共用的外框：可改时是按钮（DOM id 供保存后定位），改过的旁边标「已修改」，报错写在下方 */
function CellFrame({
  id,
  changed,
  error,
  children,
}: {
  id: string;
  changed: boolean;
  error: string | undefined;
  children: ReactNode;
}) {
  return (
    <div data-form-field className="flex min-w-0 flex-col items-start gap-1">
      <div className="flex max-w-full min-w-0 flex-wrap items-center gap-1.5">
        {children}
        {changed && (
          <Badge tone="warning" dot>
            {EDITED}
          </Badge>
        )}
      </div>
      {error && <FieldError id={`${id}-error`} messages={[error]} />}
    </div>
  );
}

const triggerClass =
  'group/cell -mx-1.5 -my-1 flex max-w-[calc(100%+0.75rem)] min-w-0 items-center gap-1.5 rounded-sm px-1.5 py-1 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-invalid:ring-1 aria-invalid:ring-destructive data-[state=open]:bg-accent';

function EditHint() {
  return (
    <Pencil
      aria-hidden
      className="size-3 shrink-0 text-subtle-foreground opacity-0 group-hover/cell:opacity-100 group-focus-visible/cell:opacity-100 group-data-[state=open]/cell:opacity-100"
    />
  );
}

function RoleChips({ roles }: { roles: readonly Role[] }) {
  return (
    <span className="flex min-w-0 flex-wrap gap-1">
      {roles.map((role) => (
        <Badge key={role} tone="neutral">
          {roleLabels[role]}
        </Badge>
      ))}
    </span>
  );
}

/** 「角色」格 */
export function RoleCell({
  id,
  name,
  roles,
  disabledReason,
  changed,
  error,
  onChange,
}: {
  /** 格子的 DOM id（保存后定位到出错的格） */
  id: string;
  /** 成员姓名（读屏器的说明） */
  name: string;
  /** 现在的角色（含待保存的修改） */
  roles: readonly Role[];
  /** 不能改的原因（已停用）；可改为 null */
  disabledReason: string | null;
  changed: boolean;
  error: string | undefined;
  onChange: (roles: Role[]) => void;
}) {
  if (disabledReason !== null) {
    return (
      <CellFrame id={id} changed={changed} error={error}>
        <DisabledReason reason={disabledReason}>
          <RoleChips roles={roles} />
        </DisabledReason>
      </CellFrame>
    );
  }
  const chosen = roles.filter((role) => (teamRoles as readonly Role[]).includes(role));
  return (
    <CellFrame id={id} changed={changed} error={error}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            id={id}
            type="button"
            aria-label={A11Y.editRoles(name)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className={triggerClass}
          >
            <RoleChips roles={roles} />
            <EditHint />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          {teamRoles.map((role) => {
            const checked = chosen.includes(role);
            const toggle = () =>
              onChange(checked ? chosen.filter((r) => r !== role) : [...chosen, role]);
            // 只剩这一个角色：不能取消（不再需要的成员请停用，待办 23）
            if (checked && chosen.length === 1) {
              return (
                <Tooltip key={role}>
                  <TooltipTrigger asChild>
                    <DropdownMenuCheckboxItem
                      checked
                      aria-disabled
                      onSelect={(event) => event.preventDefault()}
                      className="text-placeholder focus:bg-transparent"
                    >
                      {roleLabels[role]}
                    </DropdownMenuCheckboxItem>
                  </TooltipTrigger>
                  <TooltipContent side="right">{CELL_EDIT.lastRole}</TooltipContent>
                </Tooltip>
              );
            }
            return (
              <DropdownMenuCheckboxItem key={role} checked={checked} onCheckedChange={toggle}>
                {roleLabels[role]}
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </CellFrame>
  );
}

/** 数据范围的选择：全部店铺 / 指定店铺（下方勾选店铺）；「从钉钉添加」抽屉同样用它 */
export function StoreScopeChoice({
  id,
  value,
  stores,
  onChange,
  label,
  invalid = false,
}: {
  /** 单选组的 DOM id（保存后定位到它的第一个选项） */
  id?: string;
  /** 没选为 null（添加成员时默认都不选） */
  value: StoreScopeValue | null;
  stores: readonly TeamStore[];
  onChange: (value: StoreScopeValue) => void;
  /** 读屏器的名字 */
  label: string;
  invalid?: boolean;
}) {
  const ids = useId();
  const mode = value === null ? '' : value.all ? 'all' : 'some';
  const chosen = value && !value.all ? value.storeIds : [];
  return (
    <div className="flex flex-col gap-2">
      <RadioGroup
        id={id}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid && id ? `${id}-error` : undefined}
        value={mode}
        onValueChange={(next) => {
          if (next === 'all') onChange({ all: true });
          else if (next === 'some') onChange({ all: false, storeIds: chosen });
        }}
        className="flex-col items-start gap-2"
      >
        {(['all', 'some'] as const).map((option) => (
          <label key={option} className="flex items-center gap-2 text-13 text-foreground">
            <RadioGroupItem value={option} />
            {CELL_EDIT.scopeOptions[option]}
          </label>
        ))}
      </RadioGroup>
      {mode === 'some' && (
        <div
          role="group"
          aria-label={A11Y.stores}
          className="ml-6 flex flex-col gap-1.75 border-l border-border pl-3"
        >
          {stores.map((store) => {
            const checked = chosen.includes(store.id);
            return (
              <label
                key={store.id}
                htmlFor={`${ids}-${store.id}`}
                className="flex items-center gap-2 text-13 text-foreground"
              >
                <Checkbox
                  id={`${ids}-${store.id}`}
                  checked={checked}
                  onCheckedChange={(next) =>
                    onChange({
                      all: false,
                      storeIds:
                        next === true
                          ? stores
                              .map((s) => s.id)
                              .filter((s) => s === store.id || chosen.includes(s))
                          : chosen.filter((s) => s !== store.id),
                    })
                  }
                />
                {store.name}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 「数据范围」格 */
export function ScopeCell({
  id,
  name,
  scope,
  stores,
  storeNames,
  disabledReason,
  changed,
  error,
  onChange,
}: {
  id: string;
  name: string;
  scope: StoreScopeValue;
  stores: readonly TeamStore[];
  storeNames: ReadonlyMap<string, string>;
  disabledReason: string | null;
  changed: boolean;
  error: string | undefined;
  onChange: (scope: StoreScopeValue) => void;
}) {
  const words = storeScopeWords(scope, storeNames);
  const text = (
    <span title={words} className="min-w-0 truncate text-13 text-ink-2">
      {words}
    </span>
  );
  if (disabledReason !== null) {
    return (
      <CellFrame id={id} changed={changed} error={error}>
        <DisabledReason reason={disabledReason}>{text}</DisabledReason>
      </CellFrame>
    );
  }
  return (
    <CellFrame id={id} changed={changed} error={error}>
      <Popover>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            aria-label={A11Y.editStores(name)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className={triggerClass}
          >
            {text}
            <EditHint />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-60 p-3">
          <StoreScopeChoice
            value={scope}
            stores={stores}
            onChange={onChange}
            label={A11Y.editStores(name)}
          />
        </PopoverContent>
      </Popover>
    </CellFrame>
  );
}

/** 已停用的成员的格子不能改（悬停写原因，contracts 的 teamMessages） */
export const DISABLED_MEMBER_REASON = teamMessages.disabledMember;
