import {
  roleLabels,
  roleNames,
  teamRoles,
  type Role,
  type StoreScopeValue,
  type TeamCandidate,
  type TeamMember,
  type TeamStore,
} from '@forcome/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { FormField, useFocusField } from '@/components/form-field';
import { LoadError } from '@/components/load-error';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { controlClass } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { UnsavedChangesDialog } from '@/components/unsaved-changes-dialog';
import { api, ApiRequestError } from '@/lib/api';
import { formatClock } from '@/lib/channel';
import { dismissToast, showError, showSuccess } from '@/lib/notify';
import { endSessionIfUnauthenticated } from '@/lib/session';
import { TEAM_QUERY_KEY, teamCandidatesQuery } from '@/lib/team';
import { cn } from '@/lib/utils';
import { ADD_RESULT, DRAWER, LEAVE } from './p20-copy';
import { StoreScopeChoice } from './team-cells';

/*
 * 「从钉钉添加」右侧抽屉（PRD P20「操作」：从钉钉通讯录选人，再分配角色（可多选）与店铺范围，必填；原型没画，
 * 用 K8 同款抽屉拼，2026-10-06 用户确认）：宽 440，成员（可搜索的下拉，列钉钉通讯录里在职、还没分配角色的人）、
 * 角色（勾选，P20 能分配的五个角色，没有生产厂对接人）、数据范围（全部店铺 / 指定店铺，默认都不选）。
 * 在抽屉里直接保存（同 P24「保存后留在本页」），不进吸底保存栏；表单写法同 P18 店铺抽屉（ADR 0007 修订）：
 * 保存一律交给接口、一次报全字段错误并定位到第一个（useFocusField），改了哪个字段就撤掉它的错误，有输入时关闭先确认（G8）。
 */

interface AddForm {
  memberId: string | null;
  roles: Role[];
  stores: StoreScopeValue | null;
}

const EMPTY_FORM: AddForm = { memberId: null, roles: [], stores: null };
/** 接口错误的键，按抽屉自上而下（定位到第一个） */
const FIELD_ORDER = ['memberId', 'roles', 'stores'] as const;
const SAVE_TOAST = 'team-member-add';

/** 搜索只看姓名与邮箱（PRD P20 v2.24「搜姓名或邮箱」）；cmdk 的 value 是成员 ID（同名的人也分得开），不参与搜索 */
const searchByKeywords = (_value: string, search: string, keywords?: string[]) =>
  (keywords ?? []).some((k) => k.toLowerCase().includes(search.trim().toLowerCase())) ? 1 : 0;

/** 成员：可搜索的下拉；候选取不到时写加载失败并可重试（设计规范第 9 节） */
function MemberPicker({
  id,
  value,
  candidates,
  failed,
  onRetry,
  invalid,
  onChange,
}: {
  id: string;
  value: string | null;
  /** 加载中为 null */
  candidates: readonly TeamCandidate[] | null;
  failed: boolean;
  onRetry: () => void;
  invalid: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // 选中的人：候选刷新后（例如刚被别人添加）他已不在下拉里，触发框仍写他的姓名，报错写在下方（K17 补充小样 ⑧）
  const [picked, setPicked] = useState<TeamCandidate | null>(null);
  const chosen = candidates?.find((c) => c.id === value) ?? (picked?.id === value ? picked : null);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : undefined}
          className={cn(controlClass, 'flex items-center justify-between gap-2 px-2.5 text-left')}
        >
          {chosen ? (
            <span className="truncate text-13 text-foreground">{chosen.name}</span>
          ) : (
            <span className="text-placeholder">{DRAWER.memberPlaceholder}</span>
          )}
          <ChevronDown className="size-3.5 shrink-0 text-subtle-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0">
        {failed ? (
          <LoadError onRetry={onRetry} />
        ) : candidates === null ? (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-3.5 rounded-sm" />
            <Skeleton className="h-3.5 rounded-sm" />
          </div>
        ) : (
          <Command filter={searchByKeywords}>
            <CommandInput placeholder={DRAWER.memberSearch} />
            <CommandList>
              <CommandEmpty>
                {candidates.length === 0 ? DRAWER.noCandidates : DRAWER.noMatch}
              </CommandEmpty>
              {candidates.map((candidate) => {
                const current = candidate.id === value;
                return (
                  <CommandItem
                    key={candidate.id}
                    value={candidate.id}
                    keywords={[candidate.name, candidate.email ?? '']}
                    aria-current={current || undefined}
                    onSelect={() => {
                      setPicked(candidate);
                      onChange(candidate.id);
                      setOpen(false);
                    }}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="text-13 font-semibold">{candidate.name}</span>
                      <span className="truncate text-12 text-muted-foreground">
                        {[candidate.dept, candidate.email].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {current && <Check className="text-primary" />}
                  </CommandItem>
                );
              })}
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function TeamMemberDrawer({
  open,
  stores,
  onClose,
}: {
  open: boolean;
  stores: readonly TeamStore[];
  onClose: () => void;
}) {
  if (!open) return null;
  return <TeamMemberDrawerContent stores={stores} onClose={onClose} />;
}

function TeamMemberDrawerContent({
  stores,
  onClose,
}: {
  stores: readonly TeamStore[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const ids = useId();
  const fieldId = (name: string) => `${ids}-${name}`;
  const candidates = useQuery(teamCandidatesQuery);
  const [leaving, setLeaving] = useState(false);
  const form = useForm<AddForm>({ defaultValues: EMPTY_FORM, shouldFocusError: false });
  const { control, handleSubmit, formState, setError, clearErrors } = form;
  const { isDirty } = formState;
  // 断网时立即给失败浮层（G5「保存失败：网络不可用」），不暂停到恢复联网（TanStack Query 的默认）
  const add = useMutation({ mutationFn: api.addTeamMember, networkMode: 'always' });
  const focusField = useFocusField();

  async function added(member: TeamMember) {
    dismissToast(SAVE_TOAST);
    await queryClient.invalidateQueries({ queryKey: TEAM_QUERY_KEY });
    showSuccess({
      title: ADD_RESULT.addedTitle,
      description: ADD_RESULT.addedDescription(
        member.name,
        roleNames(member.roles),
        member.changedBy ?? '',
        member.changedAt ? formatClock(member.changedAt) : '',
      ),
    });
    onClose();
  }

  /** 字段错误留在抽屉里显示（定位到第一个）；返回 true 表示已处理 */
  function handledInDrawer(error: unknown): boolean {
    if (endSessionIfUnauthenticated(queryClient, error)) return true;
    if (!(error instanceof ApiRequestError && error.status === 400 && error.fields)) return false;
    const fields = error.fields;
    for (const name of FIELD_ORDER) {
      const message = fields[name];
      if (message) setError(name, { type: 'server', message });
    }
    const first = FIELD_ORDER.find((name) => fields[name]);
    if (first) focusField(fieldId(first));
    // 选的人刚被别人添加或停用了：候选要刷新
    if (fields.memberId) void queryClient.invalidateQueries({ queryKey: TEAM_QUERY_KEY });
    return true;
  }

  /** 保存一次（提交此刻抽屉里填的内容）：字段错误留在抽屉里；处理不了的失败抛出（给失败浮层的「立即重试」用） */
  async function addOnce() {
    try {
      await added(await add.mutateAsync(form.getValues()));
    } catch (error) {
      if (handledInDrawer(error)) return;
      throw error;
    }
  }

  async function submit() {
    try {
      await addOnce();
    } catch (error) {
      showError({
        id: SAVE_TOAST,
        action: ADD_RESULT.failedAction,
        error,
        description: ADD_RESULT.failedDescription,
        retry: addOnce,
      });
    }
  }

  const onSave = handleSubmit(() => submit());

  function requestClose() {
    if (isDirty) setLeaving(true);
    else onClose();
  }

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
    >
      <SheetContent className="w-110">
        <SheetHeader title={DRAWER.title} description={DRAWER.description} />
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => void onSave(event)}
        >
          <SheetBody>
            <FormField
              label={DRAWER.labels.member}
              htmlFor={fieldId('memberId')}
              required
              error={formState.errors.memberId?.message}
            >
              <Controller
                control={control}
                name="memberId"
                render={({ field, fieldState }) => (
                  <MemberPicker
                    id={fieldId('memberId')}
                    value={field.value}
                    candidates={candidates.data ?? null}
                    failed={candidates.isError}
                    onRetry={() => void candidates.refetch()}
                    invalid={fieldState.invalid}
                    onChange={(id) => {
                      field.onChange(id);
                      clearErrors('memberId');
                    }}
                  />
                )}
              />
            </FormField>
            <FormField
              label={DRAWER.labels.roles}
              htmlFor={fieldId('roles')}
              required
              hint={DRAWER.rolesHint}
              error={formState.errors.roles?.message}
            >
              <Controller
                control={control}
                name="roles"
                render={({ field, fieldState }) => (
                  <div
                    id={fieldId('roles')}
                    role="group"
                    tabIndex={-1}
                    aria-label={DRAWER.labels.roles}
                    aria-invalid={fieldState.invalid || undefined}
                    aria-describedby={fieldState.invalid ? `${fieldId('roles')}-error` : undefined}
                    className="grid grid-cols-3 gap-x-3 gap-y-2 outline-none"
                  >
                    {teamRoles.map((role) => (
                      <label
                        key={role}
                        htmlFor={fieldId(`role-${role}`)}
                        className="flex items-center gap-2 text-13 text-foreground"
                      >
                        <Checkbox
                          id={fieldId(`role-${role}`)}
                          checked={field.value.includes(role)}
                          onCheckedChange={(checked) => {
                            field.onChange(
                              teamRoles.filter((r) =>
                                r === role ? checked === true : field.value.includes(r),
                              ),
                            );
                            clearErrors('roles');
                          }}
                        />
                        {roleLabels[role]}
                      </label>
                    ))}
                  </div>
                )}
              />
            </FormField>
            <FormField
              label={DRAWER.labels.stores}
              htmlFor={fieldId('stores')}
              required
              error={formState.errors.stores?.message}
            >
              <Controller
                control={control}
                name="stores"
                render={({ field, fieldState }) => (
                  <StoreScopeChoice
                    id={fieldId('stores')}
                    value={field.value}
                    stores={stores}
                    invalid={fieldState.invalid}
                    label={DRAWER.labels.stores}
                    onChange={(next) => {
                      field.onChange(next);
                      clearErrors('stores');
                    }}
                  />
                )}
              />
            </FormField>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={requestClose}>
              {DRAWER.cancel}
            </Button>
            <Button type="submit" loading={add.isPending}>
              {DRAWER.save}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>

      <UnsavedChangesDialog
        open={leaving}
        onOpenChange={setLeaving}
        description={LEAVE.drawer}
        onDiscard={() => {
          setLeaving(false);
          onClose();
        }}
        onSaveAndLeave={() => {
          setLeaving(false);
          void onSave();
        }}
      />
    </Sheet>
  );
}
