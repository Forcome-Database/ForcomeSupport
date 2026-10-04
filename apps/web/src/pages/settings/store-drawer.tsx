import {
  mailboxError,
  normalizeMailbox,
  platformLabels,
  platforms,
  platformTerms,
  sites as allSites,
  type Site,
  type Store,
} from '@forcome/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, X } from 'lucide-react';
import { useId, useState } from 'react';
import { Controller, useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import {
  EditConflictAlert,
  OverwriteDialog,
  type EditConflictInfo,
} from '@/components/edit-conflict';
import { FieldError, FormField } from '@/components/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { controlClass, Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader } from '@/components/ui/sheet';
import { UnsavedChangesDialog } from '@/components/unsaved-changes-dialog';
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
  unsavedFieldCount,
  type FormError,
  type StoreFormValues,
} from './store-form';

/*
 * 新增 / 编辑店铺的右侧抽屉（PRD P18「第一阶段」、K8；原型 build_states_admin.k8()）：
 * 平台 | 店铺名、站点（多选）| 默认站点、进线邮箱（可填多个，含别名）、平台标识；第一期不显示签名与覆盖项；
 * 非生产环境另有「数据来源：真实接口 / 模拟数据」。错误写在字段下方，保存按钮保持可点，点击后定位到第一个错误（AC-ST-01）。
 * 编辑时别人先保存了（409）在顶部给 G7 横幅（查看最新 / 覆盖保存，覆盖需二次确认）；有未保存的输入时关闭抽屉先确认（G8）。
 * 表单状态用 react-hook-form。点「保存」一律交给接口校验（contracts 的 storeInputErrors 加上查库的店铺名、邮箱重复），
 * 一次拿到全部字段的错误——K8 画的就是店铺名重复、邮箱格式、平台标识为空同时报出；改了哪个字段就先撤掉它的错误。
 * 进线邮箱按回车加入时先用同一条规则（contracts 的 mailboxError）就地检查格式与重复。
 */

export type StoreDrawerTarget = { mode: 'create' } | { mode: 'edit'; store: Store };

const SAVE_TOAST = 'store-save';
const DESCRIPTION = '保存记入审计日志；未归属队列中收件地址与新店铺进线邮箱匹配的来信自动归位。';

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
          className={cn(
            controlClass,
            'flex items-center justify-between gap-2 pr-2.5 pl-1.5 text-left',
          )}
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
                      // 点小标签上的 × 只移除这个站点，不打开列表（键盘在列表里取消勾选）
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

  /** 把输入框里的邮箱加入；格式不对或重复时（strict）在输入框下方报错，留在输入框里 */
  function addDraft(strict: boolean) {
    const draft = getValues('mailboxDraft');
    if (!draft.trim()) return;
    const current = getValues('mailboxes');
    const error = mailboxError(draft, current);
    if (error) {
      if (strict) setError('mailboxDraft', { message: error });
      return;
    }
    setValue('mailboxes', [...current, normalizeMailbox(draft)], { shouldDirty: true });
    setValue('mailboxDraft', '', { shouldDirty: true });
    clearErrors('mailboxDraft');
  }

  const draft = register('mailboxDraft', {
    onChange: () => clearErrors('mailboxDraft'),
    onBlur: () => addDraft(false),
  });

  return (
    <FormField
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
          render={({ field }) => (
            <div className={cn('flex flex-wrap gap-1.5', field.value.length === 0 && 'hidden')}>
              {field.value.map((mailbox, index) => (
                <Badge
                  key={mailbox}
                  tone="outline"
                  data-testid="mailbox-chip"
                  className={cn(
                    chipErrors?.[index]?.message && 'border-destructive text-destructive-text',
                  )}
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
              ))}
            </div>
          )}
        />
        <Input
          id={id}
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
    </FormField>
  );
}

interface Conflict extends EditConflictInfo {
  readonly latest: Store;
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
  // formState 是按读取订阅的代理：要在渲染时读，G8 才拿得到最新的未保存状态
  const { isDirty, dirtyFields } = formState;
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
    if (!latest) return;
    setConflict({
      latest,
      who: latest.updatedBy ?? '系统',
      at: formatClock(latest.updatedAt),
      fields: changedFields(base, latest),
    });
  }

  function showFieldErrors(errors: readonly FormError[]) {
    for (const { field, message } of errors) setError(field, { type: 'server', message });
    const first = firstErrorField(errors);
    if (first) setFocus(first === 'mailboxes' ? 'mailboxDraft' : first, { shouldSelect: false });
  }

  /** 保存失败的处理；字段错误与冲突留在抽屉里显示，返回 true 表示已处理 */
  function handledInDrawer(error: unknown, values: StoreFormValues): boolean {
    if (endSessionIfUnauthenticated(queryClient, error)) return true;
    if (!(error instanceof ApiRequestError)) return false;
    if (error.status === 400 && error.fields) {
      showFieldErrors(formErrorsOf(error.fields, values.mailboxes.length));
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
              <EditConflictAlert
                conflict={conflict}
                onReload={() => {
                  setBase(conflict.latest);
                  reset(storeFormOf(conflict.latest));
                  setConflict(null);
                }}
                onOverwrite={() => setConfirmOverwrite(true)}
              />
            )}
            <div className="grid grid-cols-2 items-start gap-3">
              <FormField
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
              </FormField>
              <FormField
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
              </FormField>
            </div>
            <div className="grid grid-cols-2 items-start gap-3">
              <FormField
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
              </FormField>
              <FormField
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
              </FormField>
            </div>
            <MailboxesField id={fieldId('mailboxes')} form={form} />
            <FormField
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
            </FormField>
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
                  <FieldError messages={[formState.errors.adapterMode.message]} />
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

      <OverwriteDialog
        conflict={conflict}
        open={confirmOverwrite}
        onOpenChange={setConfirmOverwrite}
        pending={save.isPending}
        onConfirm={() => {
          const latest = conflict?.latest;
          setConfirmOverwrite(false);
          if (!latest) return;
          setConflict(null);
          void submit(form.getValues(), latest.version);
        }}
      />

      <UnsavedChangesDialog
        open={leaving}
        onOpenChange={setLeaving}
        description={
          editing
            ? `「编辑店铺」有 ${unsavedFieldCount(dirtyFields)} 项未保存的修改。放弃后恢复为上次保存的值。`
            : '「新增店铺」填写的内容还没保存，放弃后不保留。'
        }
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
