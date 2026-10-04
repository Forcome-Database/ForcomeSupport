import {
  isValidMailbox,
  platformLabels,
  platforms,
  platformTerms,
  sites as allSites,
  type Site,
  type Store,
} from '@forcome/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, RefreshCw, TriangleAlert, X } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader } from '@/components/ui/sheet';
import { api, ApiRequestError } from '@/lib/api';
import { CHANNEL_QUERY_KEY, channelSettingsQuery, formatClock } from '@/lib/channel';
import { dismissToast, showError, showSuccess } from '@/lib/notify';
import { endSessionIfUnauthenticated } from '@/lib/session';
import { cn } from '@/lib/utils';
import {
  changedFields,
  defaultSiteAfter,
  emptyStoreForm,
  firstErrorField,
  formErrorsOf,
  sortSites,
  storeFormOf,
  storeInputOf,
  type FormField,
  type StoreFormValues,
} from './store-form';

/*
 * 新增 / 编辑店铺的右侧抽屉（PRD P18「第一阶段」、K8；原型 build_states_admin.k8()）：
 * 平台 | 店铺名、站点（多选）| 默认站点、进线邮箱（可填多个，含别名）、平台标识；第一期不显示签名与覆盖项；
 * 非生产环境另有「数据来源：真实接口 / 模拟数据」。错误写在字段下方，保存按钮保持可点，点击后定位到第一个错误（AC-ST-01）。
 * 编辑时别人先保存了（409）在顶部给 G7 横幅（查看最新 / 覆盖保存，覆盖需二次确认）；有未保存的输入时关闭抽屉先确认（G8）。
 * 表单状态用 react-hook-form。点「保存」一律交给接口校验（contracts 的 storeInputErrors 加上查库的店铺名、邮箱重复），
 * 一次拿到全部字段的错误——K8 画的就是店铺名重复、邮箱格式、平台标识为空同时报出；改了哪个字段就先撤掉它的错误。
 * 进线邮箱按回车加入时先用同一份规则（isValidMailbox）就地检查格式与重复。
 */

export type StoreDrawerTarget = { mode: 'create' } | { mode: 'edit'; store: Store };

const SAVE_TOAST = 'store-save';
const DESCRIPTION = '保存记入审计日志；未归属队列中收件地址与新店铺进线邮箱匹配的来信自动归位。';

/** 字段的标签、必填星号与下方的错误或说明（原型 field()） */
function Field({
  label,
  htmlFor,
  required = false,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  /** 写在字段下方的错误；进线邮箱可能同时有几条（每个邮箱一条） */
  error?: string | readonly string[];
  children: ReactNode;
}) {
  const errors = (typeof error === 'string' ? [error] : (error ?? [])).filter(Boolean);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      {children}
      {errors.length > 0 ? (
        <div id={htmlFor ? `${htmlFor}-error` : undefined} className="flex flex-col gap-1">
          {errors.map((message) => (
            <p key={message} className="flex items-center gap-1 text-12 text-destructive-text">
              <TriangleAlert className="size-3.25 shrink-0" strokeWidth={2} />
              {message}
            </p>
          ))}
        </div>
      ) : hint ? (
        <p className="text-12 leading-[1.45] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** 站点多选（原型 multi_select()）：已选的站点是框内可移除的小标签，点开为勾选列表 */
function SitesSelect({
  id,
  value,
  onChange,
  invalid,
  ref,
}: {
  id: string;
  value: Site[];
  onChange: (sites: Site[]) => void;
  invalid: boolean;
  ref: React.Ref<HTMLButtonElement>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          ref={ref}
          id={id}
          type="button"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : undefined}
          className="flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-card pr-2.5 pl-1.5 text-left text-body outline-none hover:border-input-hover focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/14 data-[state=open]:border-primary data-[state=open]:ring-3 data-[state=open]:ring-primary/14 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/12"
        >
          <span className="flex min-w-0 items-center gap-1">
            {value.length === 0 ? (
              <span className="pl-1 text-placeholder">请选择</span>
            ) : (
              value.map((site) => (
                <span
                  key={site}
                  className="flex items-center gap-1 rounded-sm bg-secondary px-1.5 py-px text-12 font-semibold text-foreground"
                >
                  {site}
                  <span
                    aria-hidden
                    className="text-subtle-foreground"
                    onPointerDown={(event) => {
                      // 点小标签上的 × 只移除这个站点，不打开列表
                      event.preventDefault();
                      event.stopPropagation();
                      onChange(value.filter((s) => s !== site));
                    }}
                  >
                    <X className="size-2.75" />
                  </span>
                </span>
              ))
            )}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-subtle-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
        {allSites.map((site) => (
          <DropdownMenuCheckboxItem
            key={site}
            checked={value.includes(site)}
            onCheckedChange={(checked) =>
              onChange(sortSites(checked ? [...value, site] : value.filter((s) => s !== site)))
            }
          >
            {site}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 进线邮箱：已加入的是可移除的小标签，下面的输入框按回车（或逗号、离开输入框）加入一个 */
function MailboxesField({ id, form }: { id: string; form: UseFormReturn<StoreFormValues> }) {
  const { control, formState, setError, clearErrors, getValues, setValue, register } = form;
  const draftError = formState.errors.mailboxDraft?.message;
  const chipErrors = formState.errors.mailboxes as
    Record<number, { message?: string } | undefined> | undefined;
  const messages = [draftError, ...Object.values(chipErrors ?? {}).map((e) => e?.message)].filter(
    (m): m is string => Boolean(m),
  );

  /** 把输入框里的邮箱加入；格式不对或重复时在输入框下方报错，留在输入框里 */
  function addDraft(strict: boolean): boolean {
    const draft = getValues('mailboxDraft').trim().toLowerCase();
    if (!draft) return false;
    const current = getValues('mailboxes');
    if (!isValidMailbox(draft)) {
      if (strict) setError('mailboxDraft', { message: '邮箱格式不正确，例如 info@forcome.mx' });
      return false;
    }
    if (current.includes(draft)) {
      if (strict) setError('mailboxDraft', { message: `${draft} 已经填过` });
      return false;
    }
    setValue('mailboxes', [...current, draft], { shouldDirty: true });
    setValue('mailboxDraft', '', { shouldDirty: true });
    clearErrors('mailboxDraft');
    return true;
  }

  const draft = register('mailboxDraft', {
    onChange: () => clearErrors('mailboxDraft'),
    onBlur: () => addDraft(false),
  });

  return (
    <Field
      label="进线邮箱（可填多个，含别名）"
      htmlFor={id}
      required
      hint="每个地址都用来识别店铺；寄到这些地址的未归属来信保存后自动归位"
      error={messages}
    >
      <div className="flex flex-col gap-1.5">
        <Controller
          control={control}
          name="mailboxes"
          render={({ field }) =>
            field.value.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {field.value.map((mailbox, index) => {
                  const error = chipErrors?.[index]?.message;
                  return (
                    <Badge
                      key={mailbox}
                      tone="outline"
                      data-testid="mailbox-chip"
                      className={cn(error && 'border-destructive text-destructive-text')}
                    >
                      {mailbox}
                      <button
                        type="button"
                        aria-label={`移除 ${mailbox}`}
                        onClick={() => {
                          field.onChange(field.value.filter((_, i) => i !== index));
                          clearErrors('mailboxes');
                        }}
                        className="rounded-sm text-subtle-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <X className="size-2.75" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            ) : (
              <></>
            )
          }
        />
        <Input
          id={id}
          placeholder="例如 support@forcome.mx"
          autoComplete="off"
          aria-invalid={draftError ? true : undefined}
          aria-describedby={messages.length > 0 ? `${id}-error` : undefined}
          {...draft}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
              event.preventDefault();
              addDraft(true);
            }
          }}
        />
      </div>
    </Field>
  );
}

/** 编辑冲突的横幅（G7；原型 banner('warning', …)） */
function ConflictBanner({
  who,
  at,
  fields,
  onReload,
  onOverwrite,
}: {
  who: string;
  at: string;
  fields: string[];
  onReload: () => void;
  onOverwrite: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-lg border border-warning-line bg-warning-banner px-3 py-2.5"
    >
      <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-warning-banner-icon">
        <TriangleAlert className="size-3.5 text-warning-text" strokeWidth={2} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
        <div className="text-13 font-semibold text-foreground">
          这条记录刚被{who}修改（{at}）
        </div>
        <div className="text-12 leading-[1.55] text-ink-2">
          {fields.length > 0 && `${who}改了：${fields.join('、')}。`}
          你的修改还没保存，已保留在下方；可先查看最新内容再改，或用你的内容覆盖。
        </div>
        <div className="flex gap-1.5 pt-1.5">
          <Button type="button" variant="outline" size="sm" onClick={onReload}>
            <RefreshCw />
            查看最新
          </Button>
          <Button type="button" variant="destructive-outline" size="sm" onClick={onOverwrite}>
            覆盖保存
          </Button>
        </div>
      </div>
    </div>
  );
}

interface Conflict {
  readonly latest: Store;
  readonly fields: string[];
}

function overwriteText(conflict: Conflict, who: string, at: string): string {
  const [first] = conflict.fields;
  const what =
    conflict.fields.length > 1
      ? `「${first}」等 ${conflict.fields.length} 项`
      : first
        ? `「${first}」`
        : '内容';
  return `${who} ${at} 保存的${what}会被你的内容替换，覆盖后记入审计日志。`;
}

export function StoreDrawer({
  target,
  dataSourceEditable,
  onClose,
}: {
  target: StoreDrawerTarget | null;
  dataSourceEditable: boolean;
  onClose: () => void;
}) {
  if (!target) return null;
  return (
    <StoreDrawerContent
      key={target.mode === 'edit' ? target.store.id : 'create'}
      target={target}
      dataSourceEditable={dataSourceEditable}
      onClose={onClose}
    />
  );
}

function StoreDrawerContent({
  target,
  dataSourceEditable,
  onClose,
}: {
  target: StoreDrawerTarget;
  dataSourceEditable: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const ids = useId();
  const fieldId = (name: string) => `${ids}-${name}`;
  const editing = target.mode === 'edit';
  /** 表单所依据的店铺（编辑时）：「查看最新」后换成最新的一版 */
  const [base, setBase] = useState<Store | null>(editing ? target.store : null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const form = useForm<StoreFormValues>({
    defaultValues: base ? storeFormOf(base) : emptyStoreForm(),
    shouldFocusError: false,
  });
  const { control, register, handleSubmit, formState, setError, clearErrors, setFocus, reset } =
    form;
  // 渲染时读取才会被 react-hook-form 订阅（formState 是按读取订阅的代理）
  const isDirty = formState.isDirty;
  const platform = useWatch({ control, name: 'platform' });
  const selectedSites = useWatch({ control, name: 'sites' });
  const terms = platform ? platformTerms[platform] : null;

  const save = useMutation({
    mutationFn: ({ values, version }: { values: StoreFormValues; version?: number }) => {
      const input = storeInputOf(values, dataSourceEditable);
      return base
        ? api.updateStore(base.id, { ...input, version: version ?? base.version })
        : api.createStore(input);
    },
  });

  function focusFirst(errors: Partial<Record<string, string>>) {
    const field = firstErrorField(errors);
    if (field) setFocus(field === 'mailboxes' ? 'mailboxDraft' : field, { shouldSelect: false });
  }

  async function saved(store: Store) {
    dismissToast(SAVE_TOAST);
    await queryClient.invalidateQueries({ queryKey: CHANNEL_QUERY_KEY });
    showSuccess({
      title: '店铺已保存',
      description: `${store.name}，已记入审计日志（${store.updatedBy ?? '系统'} ${formatClock(store.updatedAt)}）。`,
    });
    onClose();
  }

  /** 编辑冲突：取最新的一版，比较对方改了哪些项（G7） */
  async function showConflict() {
    if (!base) return;
    const latest = (
      await queryClient.fetchQuery({ ...channelSettingsQuery, staleTime: 0 })
    ).stores.find((s) => s.id === base.id);
    if (latest) setConflict({ latest, fields: changedFields(base, latest) });
  }

  /** 保存失败的处理；字段错误与冲突留在抽屉里显示，返回 true 表示已处理 */
  function handledInDrawer(error: unknown, values: StoreFormValues): boolean {
    if (endSessionIfUnauthenticated(queryClient, error)) return true;
    if (!(error instanceof ApiRequestError)) return false;
    if (error.status === 400 && error.fields) {
      const errors = formErrorsOf(error.fields, values.mailboxes.length);
      for (const [key, message] of Object.entries(errors)) {
        setError(key as FormField, { type: 'server', message });
      }
      focusFirst(errors);
      return true;
    }
    if (error.status === 409) {
      void showConflict();
      return true;
    }
    return false;
  }

  async function submit(values: StoreFormValues, version?: number) {
    try {
      await saved(await save.mutateAsync({ values, version }));
    } catch (error) {
      if (handledInDrawer(error, values)) return;
      showError({
        id: SAVE_TOAST,
        action: '保存',
        error,
        description: '填写的内容已保留在抽屉里。',
        retry: async () => {
          try {
            await saved(await save.mutateAsync({ values, version }));
          } catch (retryError) {
            if (handledInDrawer(retryError, values)) return;
            throw retryError;
          }
        },
      });
    }
  }

  const onSave = handleSubmit((values) => submit(values));

  /** Esc、点遮罩、×、「取消」：有未保存的输入先确认（G8） */
  function requestClose() {
    if (isDirty) setLeaving(true);
    else onClose();
  }

  const who = conflict?.latest.updatedBy ?? '系统';
  const at = conflict ? formatClock(conflict.latest.updatedAt) : '';

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <SheetContent className="w-110">
        <SheetHeader title={editing ? '编辑店铺' : '新增店铺'} description={DESCRIPTION} />
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => void onSave(event)}
        >
          <SheetBody>
            {conflict && (
              <ConflictBanner
                who={who}
                at={at}
                fields={conflict.fields}
                onReload={() => {
                  setBase(conflict.latest);
                  reset(storeFormOf(conflict.latest));
                  setConflict(null);
                }}
                onOverwrite={() => setConfirmOverwrite(true)}
              />
            )}
            <div className="grid grid-cols-2 items-start gap-3">
              <Field
                label="平台"
                htmlFor={fieldId('platform')}
                required
                error={formState.errors.platform?.message}
              >
                <Controller
                  control={control}
                  name="platform"
                  render={({ field, fieldState }) => (
                    <Select
                      value={field.value}
                      onValueChange={(value) => {
                        // Radix Select 在选项还没渲染出来时会回调空串，忽略它
                        if (!value) return;
                        field.onChange(value);
                        clearErrors(['platform', 'platformId']);
                      }}
                    >
                      <SelectTrigger
                        ref={field.ref}
                        id={fieldId('platform')}
                        aria-invalid={fieldState.invalid || undefined}
                        aria-describedby={
                          fieldState.invalid ? `${fieldId('platform')}-error` : undefined
                        }
                      >
                        <SelectValue placeholder="请选择" />
                      </SelectTrigger>
                      <SelectContent>
                        {platforms.map((p) => (
                          <SelectItem key={p} value={p}>
                            {platformLabels[p]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field
                label="店铺名"
                htmlFor={fieldId('name')}
                required
                error={formState.errors.name?.message}
              >
                <Input
                  id={fieldId('name')}
                  autoComplete="off"
                  aria-invalid={formState.errors.name ? true : undefined}
                  aria-describedby={formState.errors.name ? `${fieldId('name')}-error` : undefined}
                  {...register('name', { onChange: () => clearErrors('name') })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 items-start gap-3">
              <Field
                label="站点（多选）"
                htmlFor={fieldId('sites')}
                required
                error={formState.errors.sites?.message}
              >
                <Controller
                  control={control}
                  name="sites"
                  render={({ field, fieldState }) => (
                    <SitesSelect
                      id={fieldId('sites')}
                      ref={field.ref}
                      value={field.value}
                      invalid={fieldState.invalid}
                      onChange={(next) => {
                        field.onChange(next);
                        form.setValue(
                          'defaultSite',
                          defaultSiteAfter(next, form.getValues('defaultSite')),
                          { shouldDirty: true },
                        );
                        clearErrors(['sites', 'defaultSite']);
                      }}
                    />
                  )}
                />
              </Field>
              <Field
                label="默认站点"
                htmlFor={fieldId('defaultSite')}
                required
                hint="无订单的来信按它归站点"
                error={formState.errors.defaultSite?.message}
              >
                <Controller
                  control={control}
                  name="defaultSite"
                  render={({ field, fieldState }) => (
                    <Select
                      value={field.value}
                      onValueChange={(value) => {
                        if (!value) return;
                        field.onChange(value);
                        clearErrors('defaultSite');
                      }}
                    >
                      <SelectTrigger
                        ref={field.ref}
                        id={fieldId('defaultSite')}
                        aria-invalid={fieldState.invalid || undefined}
                        aria-describedby={
                          fieldState.invalid ? `${fieldId('defaultSite')}-error` : undefined
                        }
                      >
                        <SelectValue placeholder="请选择" />
                      </SelectTrigger>
                      <SelectContent>
                        {selectedSites.map((site) => (
                          <SelectItem key={site} value={site}>
                            {site}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            </div>
            <MailboxesField id={fieldId('mailboxes')} form={form} />
            <Field
              label={terms?.platformIdField ?? '平台标识'}
              htmlFor={fieldId('platformId')}
              required
              error={formState.errors.platformId?.message}
            >
              <Input
                id={fieldId('platformId')}
                autoComplete="off"
                placeholder={terms?.platformIdPlaceholder}
                aria-invalid={formState.errors.platformId ? true : undefined}
                aria-describedby={
                  formState.errors.platformId ? `${fieldId('platformId')}-error` : undefined
                }
                {...register('platformId', { onChange: () => clearErrors('platformId') })}
              />
            </Field>
            {dataSourceEditable && (
              <div className="flex flex-col gap-2 rounded-md border border-dashed border-input bg-muted px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span id={fieldId('adapterMode')} className="text-12 font-semibold text-ink-2">
                    数据来源
                  </span>
                  <Badge tone="info">仅开发测试环境</Badge>
                </div>
                <Controller
                  control={control}
                  name="adapterMode"
                  render={({ field }) => (
                    <RadioGroup
                      ref={field.ref}
                      aria-labelledby={fieldId('adapterMode')}
                      value={field.value}
                      onValueChange={(value) => {
                        field.onChange(value);
                        clearErrors('adapterMode');
                      }}
                    >
                      {(
                        [
                          ['real', '真实接口'],
                          ['fake', '模拟数据'],
                        ] as const
                      ).map(([value, label]) => (
                        <label
                          key={value}
                          className="flex items-center gap-2 text-13 text-foreground"
                        >
                          <RadioGroupItem value={value} />
                          {label}
                        </label>
                      ))}
                    </RadioGroup>
                  )}
                />
                {formState.errors.adapterMode?.message ? (
                  <p className="flex items-center gap-1 text-12 text-destructive-text">
                    <TriangleAlert className="size-3.25 shrink-0" strokeWidth={2} />
                    {formState.errors.adapterMode.message}
                  </p>
                ) : (
                  <p className="text-12 text-muted-foreground">
                    生产环境不显示此项；接模拟数据时渠道卡头标「模拟数据」。
                  </p>
                )}
              </div>
            )}
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={requestClose}>
              取消
            </Button>
            <Button type="submit" loading={save.isPending}>
              保存
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>

      {/* G7：覆盖他人的修改需二次确认，默认焦点在「取消」 */}
      <AlertDialog open={confirmOverwrite} onOpenChange={setConfirmOverwrite}>
        <AlertDialogContent className="w-105">
          <AlertDialogHeader title={`覆盖${who}的修改？`} tone="warning" />
          <AlertDialogBody className="text-12">
            {conflict ? overwriteText(conflict, who, at) : ''}
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Button type="button" variant="outline" size="sm" autoFocus>
                取消
              </Button>
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              loading={save.isPending}
              onClick={() => {
                const latest = conflict?.latest;
                setConfirmOverwrite(false);
                if (!latest) return;
                setConflict(null);
                void submit(form.getValues(), latest.version);
              }}
            >
              覆盖保存
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* G8：表单类有未保存修改时离开，默认焦点在「继续编辑」 */}
      <AlertDialog open={leaving} onOpenChange={setLeaving}>
        <AlertDialogContent className="w-115">
          <AlertDialogHeader title="离开前保存修改？" tone="warning" />
          <AlertDialogBody className="text-13 leading-[1.55]">
            {editing
              ? '「编辑店铺」有未保存的修改。放弃后恢复为上次保存的值。'
              : '「新增店铺」填写的内容还没保存，放弃后不保留。'}
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Button type="button" variant="outline" autoFocus>
                继续编辑
              </Button>
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive-outline"
              onClick={() => {
                setLeaving(false);
                onClose();
              }}
            >
              放弃修改
            </Button>
            <Button
              type="button"
              onClick={() => {
                setLeaving(false);
                void onSave();
              }}
            >
              保存并离开
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
