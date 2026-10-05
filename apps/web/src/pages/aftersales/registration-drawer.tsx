import { businessDate } from '@forcome/calendar';
import {
  aftersalesActions,
  applicableFields,
  can,
  canViewFinance,
  claimStatuses,
  claimStatusLabels,
  claimTargets,
  claimTargetLabels,
  defaultOwnerId,
  feeItemLabels,
  feeItems,
  formatMoney,
  formatRate,
  formatRateDate,
  handlingMethodLabels,
  handlingMethods,
  ownerNote,
  ownersForStore,
  registrationMessages,
  responsibilities,
  responsibilityLabels,
  ratioGroups,
  RESPONSIBILITY_REASON_MAX,
  shipperLabels,
  shippers,
  SYSTEM_ACTOR_NAME,
  type AftersalesDetail,
  type Currency,
  type CurrentMember,
  type FeeItem,
  type FieldErrors as ApiFieldErrors,
  type RatioGroup,
  type RegistrationOptions,
  type SourceTicket,
  type StoreOption,
} from '@forcome/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import {
  Controller,
  get,
  useForm,
  useWatch,
  type Control,
  type FieldErrors,
} from 'react-hook-form';
import { AffixInput } from '@/components/affix-input';
import { AftersalesStatusBadge } from '@/components/aftersales-badges';
import { DateField } from '@/components/date-field';
import {
  EditConflictAlert,
  OverwriteDialog,
  type EditConflictInfo,
} from '@/components/edit-conflict';
import { FieldError, FormField, useFocusField } from '@/components/form-field';
import { LoadError } from '@/components/load-error';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { UnsavedChangesDialog } from '@/components/unsaved-changes-dialog';
import {
  AFTERSALES_QUERY_KEY,
  aftersalesQuery,
  exchangeRatesQuery,
  registrationOptionsQuery,
} from '@/lib/aftersales';
import { api, ApiRequestError } from '@/lib/api';
import { formatClock, storeOptionsQuery } from '@/lib/channel';
import { dismissToast, showError, showSuccess } from '@/lib/notify';
import { endSessionIfUnauthenticated } from '@/lib/session';
import { formatUsdCents } from '@/lib/cents';
import { cn } from '@/lib/utils';
import {
  BACKFILL_RESULT,
  DRAWER,
  EDIT,
  EMPTY_VALUE,
  LEAVE,
  LOOKUP,
  SAVE_RESULT,
  storeSite,
} from './p13-copy';
import { FormSection, MoneyInput, RateInput, RateLine, RatioTable } from './registration-parts';
import {
  changedFieldLabels,
  conversionOf,
  emptyRegistrationForm,
  factoryPercents,
  feeTotalCents,
  fieldLabel,
  FORM_ORDER,
  formErrorsOf,
  formValuesOf,
  groupCents,
  lockedFields,
  quantityText,
  ratioFormOf,
  registrationInputOf,
  withRatioSide,
  type Conversion,
  type DrawerAccess,
  type FeeOverrides,
  type FormError,
  type FormItem,
  type RegistrationFormPath,
  type RegistrationFormValues,
} from './registration-form';

/*
 * 新建登记与编辑登记的右侧抽屉（PRD P13「第一阶段」、S14 及补充小样；原型 build_ledger.reg_drawer()、edit_drawer()，宽 640）：
 * 1 处理方式（三张卡片）→ 2 基本信息（店铺、站点、订单号、客户、来源工单、费用发生日、负责人）→ 3 责任与承担比例
 * （责任类型、生产厂、物流问题的索赔对象与状态、「其他」的理由、三组比例）→ 4 寄件（只有寄配件）→ 费用（原币）。
 * 按 R-AS-08 只列适用字段（contracts 的 applicableFields），不适用的不显示，保存时也不交（接口同样清空）。
 * 预填：选店铺带出默认站点与默认负责人；填来源工单（离开输入框时查）带入店铺、站点、订单号、客户；选责任类型按种子数据
 * 预填三组比例；寄配件选配件预填生产厂；改一侧比例另一侧自动补足 100。
 * 非美元金额按费用发生日的汇率即时折算（R-FL-06）：金额框下写「≈ 美元 · 汇率 日期（1 USD = 汇率 币种）」，比例表与
 * 费用合计按折算后的美元算；汇率取当天、缺失时取此前最近一个有汇率的日期，与保存时冻结的值一致（以接口为准）。
 * 编辑登记（点售后单号，标题「编辑登记 · S-…」，顶部状态行）按状态与权限三种形态（S14 补充小样之三，aftersalesActions）：
 * 进行中由登记人或负责人改全部字段；已完成由售后负责人补登空着的字段（已填的锁定）；其余只读，底部只有「关闭」，坐席不显示
 * 比例表与费用。原币金额、币种与费用发生日都没改的项沿用原来冻结的汇率与美元值。售后负责人可「修改汇率」：每个非美元金额框下
 * 变成「1 USD = [输入框] 币种」，随「保存修改」只交改动过的汇率。有人先保存了（409）时顶部给 G7 横幅（查看最新 / 覆盖保存）。
 * 点保存一律交给接口校验（同 P18 的约定，ADR 0007 修订）：接口一次返回全部字段错误，放到对应字段下方，
 * 抽屉顶部给危险横幅「有 N 项需要修改 · 已滚动到第一个错误「…」」并定位到最靠上的错误；改了哪个字段就先撤掉它的错误。
 * 有未保存的输入时关闭抽屉先确认（G8）。成功后浮层提示并刷新台账。
 */

/** 抽屉打开的是新建登记，还是某张单的编辑登记 */
export type DrawerTarget =
  { readonly mode: 'create' } | { readonly mode: 'edit'; readonly number: string };

/** 编辑登记：打开时的这张单，与查看者能否看到财务字段（坐席看不到比例表与费用） */
interface Editing {
  readonly detail: AftersalesDetail;
  readonly finance: boolean;
}

const SAVE_TOAST = 'aftersales-register';
const LOOKUP_TOAST = 'aftersales-source-ticket';
const RATES_TOAST = 'aftersales-exchange-rates';

/** 金额框下的折算说明（S14 编辑登记小图）；不用显示时为 undefined */
function conversionHint(conversion: Conversion | null, currency: Currency): string | undefined {
  if (!conversion) return undefined;
  if (conversion.kind === 'no_rate') return DRAWER.feeNoRate;
  return DRAWER.feeConversion(
    formatMoney(conversion.usd, 'USD'),
    formatRateDate(conversion.rate.date),
    formatRate(conversion.rate.rate),
    currency,
  );
}

/** 已经报出的字段错误（按表单顺序） */
function presentErrors(errors: FieldErrors<RegistrationFormValues>): FormError[] {
  return FORM_ORDER.flatMap((field) => {
    const message = (get(errors, field) as { message?: string } | undefined)?.message;
    return message ? [{ field, message }] : [];
  });
}

/** 判断权限要看的：状态、登记人与负责人（aftersalesActions） */
function actionsOn(member: CurrentMember, detail: AftersalesDetail) {
  return aftersalesActions(member, {
    status: detail.status,
    registeredById: detail.registeredBy?.id ?? null,
    ownerId: detail.owner?.id ?? null,
  });
}

/** 编辑登记的形态：进行中能编辑 → 编辑；已完成能补登 → 补登；其余只读 */
function accessOf(member: CurrentMember, detail: AftersalesDetail): DrawerAccess {
  const actions = actionsOn(member, detail);
  if (actions.edit) return 'edit';
  if (actions.backfill) return 'backfill';
  return 'readonly';
}

/**
 * 抽屉的选项：有新建、编辑或补登能力的人取接口的选项（负责人只露出查看者店铺范围内的部分）；这张单的负责人、配件、
 * 生产厂不在里面时补上（例如负责人后来离职），只读时下拉才写得出名字。坐席没有选项接口，只用这张单自己的。
 */
function optionsFor(
  options: RegistrationOptions | undefined,
  detail: AftersalesDetail | undefined,
): RegistrationOptions {
  const base: RegistrationOptions = options ?? {
    owners: [],
    defaultRatios: [],
    factories: [],
    parts: [],
  };
  if (!detail) return base;
  const owner = detail.owner;
  const part = detail.part;
  return {
    ...base,
    owners:
      owner && !base.owners.some((o) => o.id === owner.id)
        ? [...base.owners, { id: owner.id, name: owner.name, stores: { all: true } }]
        : base.owners,
    factories:
      detail.factory && !base.factories.some((f) => f.code === detail.factory)
        ? [...base.factories, { code: detail.factory }]
        : base.factories,
    parts:
      part && !base.parts.some((p) => p.sku === part.sku)
        ? [
            ...base.parts,
            { sku: part.sku, name: part.name ?? part.sku, factory: detail.factory ?? '' },
          ]
        : base.parts,
  };
}

export function RegistrationDrawer({
  registrar,
  target,
  onClose,
}: {
  registrar: CurrentMember;
  target: DrawerTarget;
  onClose: () => void;
}) {
  const editingNumber = target.mode === 'edit' ? target.number : null;
  const usesOptions =
    can(registrar.roles, 'aftersales.register') ||
    can(registrar.roles, 'aftersales.edit_open') ||
    can(registrar.roles, 'aftersales.backfill');
  const stores = useQuery(storeOptionsQuery);
  const options = useQuery({ ...registrationOptionsQuery, enabled: usesOptions });
  const detail = useQuery({ ...aftersalesQuery(editingNumber ?? ''), enabled: !!editingNumber });
  const failed = stores.isError || options.isError || detail.isError;
  const ready = stores.data && (!usesOptions || options.data) && (!editingNumber || detail.data);
  if (ready && !failed) {
    const editing: Editing | undefined = detail.data
      ? { detail: detail.data, finance: canViewFinance(registrar.roles) }
      : undefined;
    return (
      <RegistrationForm
        // 换一张单时整个表单重来；同一张单保存或「查看最新」后的新版本由表单自己接上
        key={editing?.detail.id ?? 'create'}
        registrar={registrar}
        stores={stores.data}
        options={optionsFor(options.data, detail.data)}
        editing={editing}
        onClose={onClose}
      />
    );
  }
  // 还没加载好：抽屉先打开，加载失败时给「重试」；这时没有输入，关闭不用确认
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-160">
        <SheetHeader
          title={editingNumber ? EDIT.title(editingNumber) : DRAWER.createTitle}
          description={editingNumber ? EDIT.description : DRAWER.description}
        />
        <SheetBody aria-busy={!failed}>
          {failed ? (
            <LoadError
              onRetry={() => {
                void stores.refetch();
                if (usesOptions) void options.refetch();
                if (editingNumber) void detail.refetch();
              }}
            />
          ) : (
            <DrawerSkeleton />
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/** 选项加载中的抽屉正文：处理方式三张卡片与两节字段的骨架 */
function DrawerSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-5 w-32 rounded-sm" />
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-15 flex-1 rounded-lg" />
        ))}
      </div>
      {[0, 1].map((section) => (
        <div key={section} className="flex flex-col gap-2.5 border-t border-border-soft pt-3">
          <Skeleton className="h-5 w-28 rounded-sm" />
          <div className="grid grid-cols-4 gap-2.5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8 rounded-md" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 抽屉里的下拉字段 */
type SelectField =
  | 'storeId'
  | 'site'
  | 'ownerId'
  | 'responsibility'
  | 'factory'
  | 'claimTarget'
  | 'claimStatus'
  | 'partSku'
  | 'shipper';

/** 下拉选择（Radix Select；选项还没渲染时会回调空串，忽略）。onPick 给了就由它写值（带出其他字段） */
function FormSelect<T extends string>({
  control,
  name,
  id,
  values,
  labelOf,
  invalid,
  disabled = false,
  onPick,
  onChanged,
}: {
  control: Control<RegistrationFormValues>;
  name: SelectField;
  id: string;
  values: readonly T[];
  labelOf: (value: T) => string;
  invalid: boolean;
  disabled?: boolean;
  onPick?: (value: T) => void;
  onChanged: () => void;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Select
          value={field.value}
          disabled={disabled}
          onValueChange={(value) => {
            if (!value) return;
            if (onPick) onPick(value as T);
            else field.onChange(value);
            onChanged();
          }}
        >
          <SelectTrigger
            ref={field.ref}
            id={id}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${id}-error` : undefined}
          >
            <SelectValue placeholder={DRAWER.placeholder} />
          </SelectTrigger>
          <SelectContent>
            {values.map((value) => (
              <SelectItem key={value} value={value}>
                {labelOf(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    />
  );
}

/** 编辑冲突（G7）：对方保存的最新一版 */
interface Conflict extends EditConflictInfo {
  readonly latest: AftersalesDetail;
}

/** 修改汇率的输入（按费用项）：初值与正在填的 */
type RateDrafts = Partial<Record<FeeItem, string>>;

function RegistrationForm({
  registrar,
  stores,
  options,
  editing,
  onClose,
}: {
  registrar: CurrentMember;
  stores: readonly StoreOption[];
  options: RegistrationOptions;
  editing?: Editing;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const ids = useId();
  const fieldId = (name: string) => `${ids}-${name.replaceAll('.', '-')}`;
  /** G8：要确认离开时弹窗（编辑时记下当时有几项未保存的修改） */
  const [leaving, setLeaving] = useState<{ readonly count: number } | null>(null);
  const [lookedUpTicket, setLookedUpTicket] = useState(editing?.detail.sourceTicket ?? '');
  /** 编辑登记依据的那一版（「查看最新」后换成最新的） */
  const [base, setBase] = useState<AftersalesDetail | null>(editing?.detail ?? null);
  const baseValues = base ? formValuesOf(base) : null;
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  /** 修改汇率：没点开为 null；点开后每个非美元费用项一个输入（初值是点开时的汇率） */
  const [rateDrafts, setRateDrafts] = useState<RateDrafts | null>(null);
  const [rateStart, setRateStart] = useState<RateDrafts>({});
  const [rateErrors, setRateErrors] = useState<ApiFieldErrors>({});
  // 形态按依据的那一版算（「查看最新」后这张单可能已被别人设为已完成）
  const access: DrawerAccess | 'create' = base ? accessOf(registrar, base) : 'create';
  const changeRate = base ? actionsOn(registrar, base).changeRate : false;
  const finance = editing?.finance ?? true;
  const locked =
    base && baseValues && access !== 'create'
      ? lockedFields(access, baseValues, base.missing)
      : () => false;
  const isLocked = (item: FormItem) => locked(item);

  const form = useForm<RegistrationFormValues>({
    defaultValues: baseValues ?? emptyRegistrationForm(businessDate(new Date())),
    shouldFocusError: false,
  });
  const {
    control,
    register,
    handleSubmit,
    formState,
    setError,
    clearErrors,
    setValue,
    getValues,
    reset,
  } = form;
  // formState 是按读取订阅的代理：要在渲染时读
  const { isDirty, errors, submitCount } = formState;
  const [method, storeId, responsibility, ratios, fees, partSku, factory, site, reason, feeDate] =
    useWatch({
      control,
      name: [
        'method',
        'storeId',
        'responsibility',
        'ratios',
        'fees',
        'partSku',
        'factory',
        'site',
        'responsibilityReason',
        'feeDate',
      ],
    });
  const percents = factoryPercents(ratios);
  const applicable = new Set(
    applicableFields({
      method: method || null,
      responsibility: responsibility || null,
      factoryRatios: percents,
    }),
  );
  const shipping = applicable.has('part');
  // 生产厂按工厂比例判断是否适用；坐席看不到比例，有登记的生产厂就照样列出
  const showFactory = applicable.has('factory') || (!finance && Boolean(factory));
  const store = stores.find((s) => s.id === storeId);
  const owners = options.owners;
  const ownerCandidates = ownersForStore(owners, storeId || null);
  const note = ownerNote(owners, storeId || null, registrar.id);
  const part = options.parts.find((p) => p.sku === partSku);
  const shown = presentErrors(errors);
  // 费用发生日的汇率：有非美元的费用项才取；还在取或不用取时为 undefined（比例表与合计里非美元的写「—」）
  const needsRates = feeItems.some((item) => fees[item].currency !== 'USD');
  const rates = useQuery({
    ...exchangeRatesQuery(feeDate),
    enabled: Boolean(feeDate) && needsRates && finance,
  });
  const ratesOn = needsRates ? rates.data?.rates : undefined;
  // 编辑登记：费用发生日没改时，原币金额与币种都没改的项沿用原来冻结的汇率与美元值；正在修改的汇率填对了就按它算
  const overrides: FeeOverrides = {
    frozen: base && baseValues?.feeDate === feeDate ? (base.fees ?? undefined) : undefined,
    manual: rateDrafts ?? undefined,
    feeDate,
  };
  const overrideFor = (item: FeeItem) => ({
    frozen: overrides.frozen?.[item],
    manual: overrides.manual?.[item],
    feeDate,
  });
  const total = feeTotalCents(fees, ratesOn, overrides);
  // 有非美元费用项的单才有「修改汇率」这一行（S14 补充小样之三）
  const foreignItems = feeItems.filter(
    (item) => fees[item].currency !== 'USD' && fees[item].amount.trim() !== '',
  );

  // 汇率查询失败：G5 失败浮层「查询失败：原因」+「立即重试」（会话失效由全局处理，不弹）；恢复或关闭抽屉时撤掉
  const { isError: ratesFailed, error: ratesError, refetch: refetchRates } = rates;
  useEffect(() => {
    if (!ratesFailed) return;
    if (ratesError instanceof ApiRequestError && ratesError.status === 401) return;
    showError({
      id: RATES_TOAST,
      action: LOOKUP.failedAction,
      error: ratesError,
      retry: async () => {
        const result = await refetchRates();
        if (result.isError) throw result.error;
      },
    });
    return () => dismissToast(RATES_TOAST);
  }, [ratesFailed, ratesError, refetchRates]);

  /** 修改汇率里改动过的（随「保存修改」只交这些） */
  const changedRates = Object.fromEntries(
    feeItems.flatMap((item) => {
      const typed = rateDrafts?.[item]?.trim();
      return typed && typed !== rateStart[item]?.trim() ? [[item, typed]] : [];
    }),
  ) as RateDrafts;
  const rateChangeCount = Object.keys(changedRates).length;

  const save = useMutation({
    mutationFn: ({
      values,
      version,
    }: {
      values: RegistrationFormValues;
      version?: number;
    }): Promise<{ number: string; customerName: string | null }> => {
      if (!base) return api.register(registrationInputOf(values));
      return api.updateAftersales(base.number, {
        version: version ?? base.version,
        changes: access === 'readonly' ? undefined : registrationInputOf(values),
        rates: rateChangeCount > 0 ? changedRates : undefined,
      });
    },
  });

  async function saved(result: { number: string; customerName: string | null }) {
    dismissToast(SAVE_TOAST);
    await queryClient.invalidateQueries({ queryKey: AFTERSALES_QUERY_KEY });
    if (!base) {
      showSuccess({
        title: SAVE_RESULT.savedTitle,
        description: SAVE_RESULT.savedDescription(result.number, result.customerName ?? ''),
      });
    } else if (access === 'backfill' && baseValues) {
      const filled = changedFieldLabels(baseValues, getValues());
      showSuccess({
        title: BACKFILL_RESULT.title,
        description:
          filled.length > 0
            ? BACKFILL_RESULT.drawer(result.number, filled)
            : EDIT.savedDescription(result.number, result.customerName ?? ''),
      });
    } else {
      showSuccess({
        title: EDIT.savedTitle,
        description: EDIT.savedDescription(result.number, result.customerName ?? ''),
      });
    }
    onClose();
  }

  /** 编辑冲突：取最新的一版，比较对方改了哪些项（G7） */
  async function showConflict() {
    if (!base || !baseValues) return;
    const latest = await queryClient.fetchQuery({ ...aftersalesQuery(base.number), staleTime: 0 });
    setConflict({
      latest,
      who: latest.updatedBy ?? SYSTEM_ACTOR_NAME,
      at: formatClock(latest.updatedAt),
      fields: changedFieldLabels(baseValues, formValuesOf(latest)),
    });
  }

  /** 定位到字段（字段都有 id）：等错误横幅与字段下方的报错渲染出来再滚动，处理方式落到第一张卡片 */
  const focusAfterRender = useFocusField();
  const focusField = (field: string) => focusAfterRender(fieldId(field));

  /** 保存失败的处理；字段错误、汇率错误与冲突留在抽屉里显示，返回 true 表示已处理 */
  function handledInDrawer(error: unknown): boolean {
    if (endSessionIfUnauthenticated(queryClient, error)) return true;
    if (!(error instanceof ApiRequestError)) return false;
    if (error.status === 409 && base) {
      void showConflict();
      return true;
    }
    if (error.status !== 400 || !error.fields) return false;
    const fieldErrors = formErrorsOf(error.fields);
    for (const { field, message } of fieldErrors) setError(field, { type: 'server', message });
    const rateFieldErrors = Object.fromEntries(
      Object.entries(error.fields).filter(([key]) => key.startsWith('rates.')),
    );
    setRateErrors(rateFieldErrors);
    const first = fieldErrors[0]?.field ?? Object.keys(rateFieldErrors)[0];
    if (first) focusField(first);
    return true;
  }

  async function submit(values: RegistrationFormValues, version?: number) {
    clearErrors();
    setRateErrors({});
    try {
      await saved(await save.mutateAsync({ values, version }));
    } catch (error) {
      if (handledInDrawer(error)) return;
      showError({
        id: SAVE_TOAST,
        action: SAVE_RESULT.failedAction,
        error,
        description: SAVE_RESULT.failedDescription,
        retry: async () => {
          try {
            await saved(await save.mutateAsync({ values, version }));
          } catch (retryError) {
            if (handledInDrawer(retryError)) return;
            throw retryError;
          }
        },
      });
    }
  }

  const onSave = handleSubmit((values) => submit(values));

  /** Esc、点遮罩、×、「取消」：有未保存的输入先确认（G8；编辑时数一数有几项改了，新建看有没有输入） */
  function requestClose() {
    const count = baseValues
      ? changedFieldLabels(baseValues, getValues()).length + rateChangeCount
      : 0;
    if (baseValues ? count > 0 : isDirty) setLeaving({ count });
    else onClose();
  }

  /** 点开「修改汇率」：每个非美元费用项预填现在用的汇率（两位小数） */
  function startRates() {
    const drafts = Object.fromEntries(
      foreignItems.flatMap((item) => {
        const conversion = conversionOf(fees[item], ratesOn, overrideFor(item));
        return [[item, conversion?.kind === 'converted' ? formatRate(conversion.rate.rate) : '']];
      }),
    ) as RateDrafts;
    setRateStart(drafts);
    setRateDrafts(drafts);
  }

  /** 换店铺：站点取店铺的默认站点；负责人不在新店铺的候选里时换成默认负责人（AC-P1-18） */
  function chooseStore(next: StoreOption, siteFromTicket?: StoreOption['defaultSite']) {
    setValue('storeId', next.id, { shouldDirty: true });
    setValue('site', siteFromTicket ?? next.defaultSite, { shouldDirty: true });
    const currentOwner = getValues('ownerId');
    if (!ownersForStore(owners, next.id).some((o) => o.id === currentOwner)) {
      setValue('ownerId', defaultOwnerId(owners, next.id, registrar.id) ?? '', {
        shouldDirty: true,
      });
    }
    clearErrors(['storeId', 'site', 'ownerId', 'sourceTicket']);
  }

  /** 把查到的来源工单带入店铺、站点、订单号（工单有时）、客户；补登时只带入原来空着的 */
  function applyTicket(ticket: SourceTicket) {
    const ticketStore = stores.find((s) => s.id === ticket.store.id);
    if (ticketStore && !isLocked('storeId')) chooseStore(ticketStore, ticket.site);
    setValue('sourceTicket', ticket.number, { shouldDirty: true });
    if (ticket.orderNumber && !isLocked('orderNumber')) {
      setValue('orderNumber', ticket.orderNumber, { shouldDirty: true });
    }
    if (!isLocked('customerName')) {
      setValue('customerName', ticket.customerName, { shouldDirty: true });
    }
    clearErrors(['orderNumber', 'customerName']);
  }

  /**
   * 按工单号查来源工单并带入；没有这张工单（或在别的店铺）写在字段下方。接口出错时抛出，由调用方给失败浮层（G5，重试也走这里）
   */
  async function fetchTicket(number: string): Promise<void> {
    try {
      applyTicket(await api.sourceTicket(number));
      dismissToast(LOOKUP_TOAST);
    } catch (error) {
      if (endSessionIfUnauthenticated(queryClient, error)) return;
      if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) {
        dismissToast(LOOKUP_TOAST);
        setError('sourceTicket', {
          type: 'server',
          message: registrationMessages.sourceTicketNotFound,
        });
        return;
      }
      throw error;
    }
  }

  /** 来源工单：离开输入框时查（同一个号只查一次） */
  async function lookUpTicket() {
    const number = getValues('sourceTicket').trim();
    if (!number || number === lookedUpTicket) return;
    setLookedUpTicket(number);
    try {
      await fetchTicket(number);
    } catch (error) {
      setLookedUpTicket('');
      showError({
        id: LOOKUP_TOAST,
        action: LOOKUP.failedAction,
        error,
        // 重试前用户改了工单号就不再带入旧号（失败浮层随之撤掉）；查成功后记下这个号，离开输入框不再重复查
        retry: async () => {
          if (getValues('sourceTicket').trim() !== number) {
            dismissToast(LOOKUP_TOAST);
            return;
          }
          await fetchTicket(number);
          setLookedUpTicket(number);
        },
      });
    }
  }

  function chooseResponsibility(next: (typeof responsibilities)[number]) {
    setValue('responsibility', next, { shouldDirty: true });
    const defaults = options.defaultRatios.find((d) => d.responsibility === next);
    if (defaults) setValue('ratios', ratioFormOf(defaults.ratios), { shouldDirty: true });
    // 有工厂比例时生产厂按配件预填（还没选生产厂时）
    if (!getValues('factory') && part) setValue('factory', part.factory, { shouldDirty: true });
    clearErrors(['responsibility', 'ratios', 'factory', 'responsibilityReason']);
  }

  function changeRatio(group: RatioGroup, side: 'fsh' | 'factory', raw: string) {
    setValue(`ratios.${group}`, withRatioSide(getValues(`ratios.${group}`), side, raw), {
      shouldDirty: true,
    });
    clearErrors([`ratios.${group}.fsh`, `ratios.${group}.factory`]);
  }

  const errorOf = (field: RegistrationFormPath) =>
    (get(errors, field) as { message?: string } | undefined)?.message;
  const describedBy = (field: RegistrationFormPath) =>
    errorOf(field) ? `${fieldId(field)}-error` : undefined;

  /** 抽屉里的下拉（同一套写法：错误写在下方，改了就撤掉这个字段的错误；锁定的项禁用） */
  const select = <T extends string>(
    name: SelectField,
    values: readonly T[],
    labelOf: (value: T) => string,
    extra: { disabled?: boolean; onPick?: (value: T) => void } = {},
  ) => (
    <FormSelect
      control={control}
      name={name}
      id={fieldId(name)}
      values={values}
      labelOf={labelOf}
      invalid={Boolean(errorOf(name))}
      disabled={extra.disabled || isLocked(name)}
      onPick={extra.onPick}
      onChanged={() => clearErrors(name)}
    />
  );

  const textInput = (
    field: 'orderNumber' | 'customerName' | 'carrier' | 'trackingNumber',
    extra: { placeholder?: string; mono?: boolean } = {},
  ) => (
    <Input
      id={fieldId(field)}
      autoComplete="off"
      placeholder={extra.placeholder}
      disabled={isLocked(field)}
      className={extra.mono ? 'tabular-nums' : undefined}
      aria-invalid={errorOf(field) ? true : undefined}
      aria-describedby={describedBy(field)}
      {...register(field, { onChange: () => clearErrors(field) })}
    />
  );

  const siteOptions = store
    ? [...new Set([...store.sites, ...(site ? [site] : [])])]
    : site
      ? [site]
      : [];
  const ownerSelect = select(
    'ownerId',
    ownerCandidates.map((o) => o.id),
    (id) => DRAWER.ownerOption(owners.find((o) => o.id === id)?.name ?? ''),
    { disabled: !storeId },
  );
  // 负责人旁的灰字：新建时写怎么默认的；编辑登记不再默认，只在有几位可选时说明范围
  const ownerHint = base
    ? note === 'choose' || note === 'none'
      ? DRAWER.ownerNotes[note]
      : undefined
    : DRAWER.ownerNotes[note] || undefined;
  const factoryNote =
    method === 'send_parts' && part && factory === part.factory
      ? DRAWER.factoryFromPart(part.sku)
      : DRAWER.factoryRequired;
  // 寄件一节只有寄配件才有，费用一节的序号随之是 5 或 4（原型 S14 的两种画面）
  const feesSection = shipping ? 5 : 4;
  // 只读且没在改汇率：底部只有「关闭」（S14 补充小样之三）
  const savable = access !== 'readonly' || rateDrafts !== null;
  const errorCount = shown.length + Object.keys(rateErrors).length;
  const firstRateError = Object.keys(rateErrors)[0]?.slice('rates.'.length) as FeeItem | undefined;
  const firstError = shown[0]
    ? fieldLabel(shown[0].field)
    : firstRateError
      ? feeItemLabels[firstRateError]
      : '';
  const rateLineState = rateDrafts ? 'editing' : changeRate ? 'idle' : 'denied';

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <SheetContent className="w-160">
        <SheetHeader
          title={base ? EDIT.title(base.number) : DRAWER.createTitle}
          description={base ? EDIT.description : DRAWER.description}
        />
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => void onSave(event)}
        >
          {errorCount > 0 && submitCount > 0 && (
            <div className="shrink-0 px-5 pt-3.5">
              <Alert
                tone="danger"
                title={DRAWER.errorsTitle(errorCount)}
                description={
                  base ? EDIT.errorsDescription(firstError) : DRAWER.errorsDescription(firstError)
                }
              />
            </div>
          )}
          <SheetBody className="gap-3">
            {conflict && (
              <EditConflictAlert
                conflict={conflict}
                onReload={() => {
                  setBase(conflict.latest);
                  reset(formValuesOf(conflict.latest));
                  setRateDrafts(null);
                  setRateErrors({});
                  setConflict(null);
                }}
                onOverwrite={() => setConfirmOverwrite(true)}
              />
            )}
            {base && (
              // 顶部状态行（原型 edit_drawer）：状态徽标 · 客户 · 店铺与站点 · 处理方式 · 负责人
              <div className="flex items-center gap-2">
                <AftersalesStatusBadge status={base.status} />
                <span className="text-12 text-ink-2">
                  {EDIT.summary(
                    base.customerName ?? EMPTY_VALUE,
                    storeSite(base.store.name, base.site),
                    base.method ? handlingMethodLabels[base.method] : EMPTY_VALUE,
                  )}
                </span>
                {base.owner && (
                  <span className="text-12 text-subtle-foreground">
                    {EDIT.owner(base.owner.name)}
                  </span>
                )}
              </div>
            )}
            <FormSection
              n={1}
              title={DRAWER.sections.method}
              required
              note={DRAWER.sections.methodNote}
              first={!base}
            >
              <Controller
                control={control}
                name="method"
                render={({ field, fieldState }) => (
                  <RadioGroup
                    id={fieldId('method')}
                    ref={(el) =>
                      field.ref({ focus: () => el?.querySelector<HTMLElement>('button')?.focus() })
                    }
                    aria-label={DRAWER.sections.method}
                    aria-invalid={fieldState.invalid || undefined}
                    aria-describedby={describedBy('method')}
                    disabled={isLocked('method')}
                    value={field.value}
                    onValueChange={(value) => {
                      field.onChange(value);
                      clearErrors('method');
                    }}
                    className="items-stretch gap-2"
                  >
                    {handlingMethods.map((value) => (
                      <RadioCard
                        key={value}
                        value={value}
                        title={handlingMethodLabels[value]}
                        description={DRAWER.methods[value]}
                      />
                    ))}
                  </RadioGroup>
                )}
              />
              {errorOf('method') && (
                <FieldError id={`${fieldId('method')}-error`} messages={[errorOf('method')!]} />
              )}
            </FormSection>

            <FormSection n={2} title={DRAWER.sections.basic}>
              <div className="grid grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.88fr)] items-start gap-2.5">
                <FormField
                  label={DRAWER.labels.storeId}
                  htmlFor={fieldId('storeId')}
                  required
                  error={errorOf('storeId')}
                >
                  {select(
                    'storeId',
                    stores.map((s) => s.id),
                    (id) => stores.find((s) => s.id === id)?.name ?? '',
                    {
                      onPick: (id) => {
                        const next = stores.find((s) => s.id === id);
                        if (next) chooseStore(next);
                      },
                    },
                  )}
                </FormField>
                <FormField
                  label={DRAWER.labels.site}
                  htmlFor={fieldId('site')}
                  required
                  error={errorOf('site')}
                >
                  {select('site', siteOptions, (s) => s)}
                </FormField>
                <FormField
                  label={DRAWER.labels.orderNumber}
                  htmlFor={fieldId('orderNumber')}
                  required
                  error={errorOf('orderNumber')}
                >
                  {textInput('orderNumber', { mono: true })}
                </FormField>
                <FormField
                  label={DRAWER.labels.customerName}
                  htmlFor={fieldId('customerName')}
                  required
                  error={errorOf('customerName')}
                >
                  {textInput('customerName')}
                </FormField>
                <FormField
                  label={DRAWER.labels.sourceTicket}
                  htmlFor={fieldId('sourceTicket')}
                  note={DRAWER.sourceTicketNote}
                  error={errorOf('sourceTicket')}
                >
                  <Input
                    id={fieldId('sourceTicket')}
                    autoComplete="off"
                    className="tabular-nums"
                    disabled={isLocked('sourceTicket')}
                    aria-invalid={errorOf('sourceTicket') ? true : undefined}
                    aria-describedby={describedBy('sourceTicket')}
                    {...register('sourceTicket', {
                      onChange: () => clearErrors('sourceTicket'),
                      onBlur: () => void lookUpTicket(),
                    })}
                  />
                </FormField>
                <FormField
                  label={DRAWER.labels.feeDate}
                  htmlFor={fieldId('feeDate')}
                  required
                  error={errorOf('feeDate')}
                >
                  <Controller
                    control={control}
                    name="feeDate"
                    render={({ field, fieldState }) => (
                      <DateField
                        id={fieldId('feeDate')}
                        ref={field.ref}
                        value={field.value}
                        invalid={fieldState.invalid}
                        disabled={isLocked('feeDate')}
                        onChange={(value) => {
                          field.onChange(value);
                          clearErrors('feeDate');
                        }}
                      />
                    )}
                  />
                </FormField>
                <div className="col-span-2">
                  <FormField
                    label={DRAWER.labels.ownerId}
                    htmlFor={fieldId('ownerId')}
                    required
                    note={ownerHint}
                    error={errorOf('ownerId')}
                  >
                    {storeId ? (
                      ownerSelect
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            tabIndex={0}
                            className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {ownerSelect}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{DRAWER.ownerNeedsStore}</TooltipContent>
                      </Tooltip>
                    )}
                  </FormField>
                </div>
              </div>
            </FormSection>

            <FormSection n={3} title={DRAWER.sections.responsibility}>
              <div className="grid grid-cols-4 items-start gap-2.5">
                <div className="col-span-2">
                  <FormField
                    label={DRAWER.labels.responsibility}
                    htmlFor={fieldId('responsibility')}
                    required
                    error={errorOf('responsibility')}
                  >
                    {select('responsibility', responsibilities, (r) => responsibilityLabels[r], {
                      onPick: chooseResponsibility,
                    })}
                  </FormField>
                </div>
                {showFactory && (
                  <div className="col-span-2">
                    <FormField
                      label={DRAWER.labels.factory}
                      htmlFor={fieldId('factory')}
                      required
                      note={factoryNote}
                      error={errorOf('factory')}
                    >
                      {select(
                        'factory',
                        options.factories.map((f) => f.code),
                        (code) => code,
                      )}
                    </FormField>
                  </div>
                )}
                {applicable.has('claimTarget') && (
                  <>
                    {/* 两个索赔下拉另起一行并排（原型 S14 补充小样 s14_more）：责任类型那一行右侧是生产厂，
                        生产厂不显示时留空，索赔对象不挤到责任类型旁边 */}
                    <div className="col-span-2 col-start-1">
                      <FormField
                        label={DRAWER.labels.claimTarget}
                        htmlFor={fieldId('claimTarget')}
                        required
                        error={errorOf('claimTarget')}
                      >
                        {select('claimTarget', claimTargets, (t) => claimTargetLabels[t])}
                      </FormField>
                    </div>
                    <div className="col-span-2">
                      <FormField
                        label={DRAWER.labels.claimStatus}
                        htmlFor={fieldId('claimStatus')}
                        required
                        error={errorOf('claimStatus')}
                      >
                        {select('claimStatus', claimStatuses, (s) => claimStatusLabels[s])}
                      </FormField>
                    </div>
                  </>
                )}
              </div>
              {applicable.has('responsibilityReason') && (
                <FormField
                  label={DRAWER.labels.responsibilityReason}
                  htmlFor={fieldId('responsibilityReason')}
                  required
                  error={errorOf('responsibilityReason')}
                >
                  <Textarea
                    id={fieldId('responsibilityReason')}
                    rows={2}
                    maxLength={RESPONSIBILITY_REASON_MAX}
                    placeholder={DRAWER.reasonPlaceholder}
                    counter={DRAWER.reasonCounter(reason.length, RESPONSIBILITY_REASON_MAX)}
                    disabled={isLocked('responsibilityReason')}
                    aria-invalid={errorOf('responsibilityReason') ? true : undefined}
                    aria-describedby={describedBy('responsibilityReason')}
                    {...register('responsibilityReason', {
                      onChange: () => clearErrors('responsibilityReason'),
                    })}
                  />
                </FormField>
              )}
              {finance && (
                <div className="flex flex-col gap-1.5">
                  <Label required note={DRAWER.ratioNote}>
                    {DRAWER.labels.ratios}
                  </Label>
                  <RatioTable
                    idOf={(group, side) => fieldId(`ratios.${group}.${side}`)}
                    ratios={ratios}
                    groupAmounts={groupCents(fees, ratesOn, overrides)}
                    disabled={isLocked('ratios')}
                    errors={Object.fromEntries(
                      ratioGroups.map((group) => [
                        group,
                        {
                          fsh: errorOf(`ratios.${group}.fsh`),
                          factory: errorOf(`ratios.${group}.factory`),
                        },
                      ]),
                    )}
                    onChange={changeRatio}
                  />
                </div>
              )}
            </FormSection>

            {shipping && (
              <FormSection
                n={4}
                title={DRAWER.sections.shipping}
                note={DRAWER.sections.shippingNote}
              >
                <div className="grid grid-cols-4 items-start gap-2.5">
                  <div className="col-span-2">
                    <FormField
                      label={DRAWER.labels.partSku}
                      htmlFor={fieldId('partSku')}
                      required
                      error={errorOf('partSku')}
                    >
                      {select(
                        'partSku',
                        options.parts.map((p) => p.sku),
                        (sku) => {
                          const p = options.parts.find((x) => x.sku === sku);
                          return p ? DRAWER.partOption(p.name, p.sku) : sku;
                        },
                        {
                          // 寄配件按配件 SKU 预填生产厂（R-AS-08）
                          onPick: (sku) => {
                            setValue('partSku', sku, { shouldDirty: true });
                            const picked = options.parts.find((p) => p.sku === sku);
                            if (picked && !isLocked('factory')) {
                              setValue('factory', picked.factory, { shouldDirty: true });
                            }
                            clearErrors('factory');
                          },
                        },
                      )}
                    </FormField>
                  </div>
                  <FormField
                    label={DRAWER.labels.partQuantity}
                    htmlFor={fieldId('partQuantity')}
                    required
                    error={errorOf('partQuantity')}
                  >
                    <AffixInput
                      id={fieldId('partQuantity')}
                      inputMode="numeric"
                      autoComplete="off"
                      suffix={DRAWER.quantitySuffix}
                      disabled={isLocked('partQuantity')}
                      aria-invalid={errorOf('partQuantity') ? true : undefined}
                      aria-describedby={describedBy('partQuantity')}
                      {...register('partQuantity', {
                        onChange: (event: { target: { value: string } }) => {
                          setValue('partQuantity', quantityText(event.target.value));
                          clearErrors('partQuantity');
                        },
                      })}
                    />
                  </FormField>
                  <FormField
                    label={DRAWER.labels.shipper}
                    htmlFor={fieldId('shipper')}
                    required
                    error={errorOf('shipper')}
                  >
                    {select('shipper', shippers, (s) => shipperLabels[s])}
                  </FormField>
                  <FormField
                    label={DRAWER.labels.carrier}
                    htmlFor={fieldId('carrier')}
                    required
                    error={errorOf('carrier')}
                  >
                    {textInput('carrier')}
                  </FormField>
                  <FormField
                    label={DRAWER.labels.shipDate}
                    htmlFor={fieldId('shipDate')}
                    required
                    error={errorOf('shipDate')}
                  >
                    <Controller
                      control={control}
                      name="shipDate"
                      render={({ field, fieldState }) => (
                        <DateField
                          id={fieldId('shipDate')}
                          ref={field.ref}
                          value={field.value}
                          placeholder={DRAWER.afterShipping}
                          invalid={fieldState.invalid}
                          disabled={isLocked('shipDate')}
                          onChange={(value) => {
                            field.onChange(value);
                            clearErrors('shipDate');
                          }}
                        />
                      )}
                    />
                  </FormField>
                  <div className="col-span-2">
                    <FormField
                      label={DRAWER.labels.trackingNumber}
                      htmlFor={fieldId('trackingNumber')}
                      required
                      error={errorOf('trackingNumber')}
                    >
                      {textInput('trackingNumber', {
                        placeholder: DRAWER.afterShipping,
                        mono: true,
                      })}
                    </FormField>
                  </div>
                </div>
              </FormSection>
            )}

            {finance && (
              <FormSection
                n={feesSection}
                title={DRAWER.sections.fees}
                note={DRAWER.sections.feeTotal(
                  total === null ? EMPTY_VALUE : formatUsdCents(total),
                )}
              >
                <div
                  className={cn(
                    'grid items-start gap-2.5',
                    shipping ? 'grid-cols-4' : 'grid-cols-2',
                  )}
                >
                  {feeItems.map((item) => {
                    const path = `fees.${item}.amount` as const;
                    const editingRate = rateDrafts !== null && foreignItems.includes(item);
                    return (
                      <FormField
                        key={item}
                        label={feeItemLabels[item]}
                        htmlFor={fieldId(path)}
                        required
                        hint={
                          editingRate
                            ? undefined
                            : conversionHint(
                                conversionOf(fees[item], ratesOn, overrideFor(item)),
                                fees[item].currency,
                              )
                        }
                        error={errorOf(path)}
                      >
                        <Controller
                          control={control}
                          name={`fees.${item}`}
                          render={({ field }) => (
                            <MoneyInput
                              id={fieldId(path)}
                              label={feeItemLabels[item]}
                              value={field.value}
                              invalid={Boolean(errorOf(path))}
                              disabled={isLocked(`fees.${item}`)}
                              onChange={(value) => {
                                field.onChange(value);
                                clearErrors(path);
                              }}
                            />
                          )}
                        />
                        {editingRate && (
                          <RateInput
                            id={fieldId(`rates.${item}`)}
                            label={feeItemLabels[item]}
                            currency={fees[item].currency}
                            value={rateDrafts[item] ?? ''}
                            error={rateErrors[`rates.${item}`]}
                            onChange={(value) => {
                              setRateDrafts({ ...rateDrafts, [item]: value });
                              // 改了哪一项就只撤掉这一项的错误（ADR 0007）
                              setRateErrors((current) =>
                                Object.fromEntries(
                                  Object.entries(current).filter(
                                    ([key]) => key !== `rates.${item}`,
                                  ),
                                ),
                              );
                            }}
                          />
                        )}
                      </FormField>
                    );
                  })}
                </div>
                {base ? (
                  foreignItems.length > 0 && <RateLine state={rateLineState} onStart={startRates} />
                ) : (
                  <p className="text-12 leading-normal text-muted-foreground">{DRAWER.feesHint}</p>
                )}
              </FormSection>
            )}
          </SheetBody>
          {savable ? (
            <SheetFooter className="items-center">
              <span className="mr-auto text-12 text-subtle-foreground">
                {errorCount > 0
                  ? DRAWER.footerNoteWithErrors
                  : base
                    ? EDIT.footerNote
                    : DRAWER.footerNote}
              </span>
              <Button type="button" variant="outline" onClick={requestClose}>
                {DRAWER.cancel}
              </Button>
              <Button type="submit" loading={save.isPending}>
                <Check />
                {base ? EDIT.save : DRAWER.save}
              </Button>
            </SheetFooter>
          ) : (
            <SheetFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {EDIT.close}
              </Button>
            </SheetFooter>
          )}
        </form>
      </SheetContent>

      <UnsavedChangesDialog
        open={leaving !== null}
        onOpenChange={(open) => {
          if (!open) setLeaving(null);
        }}
        description={base ? EDIT.leave(leaving?.count ?? 0) : LEAVE}
        onDiscard={() => {
          setLeaving(null);
          onClose();
        }}
        onSaveAndLeave={() => {
          setLeaving(null);
          void onSave();
        }}
      />
      <OverwriteDialog
        conflict={conflict}
        open={confirmOverwrite}
        onOpenChange={setConfirmOverwrite}
        pending={save.isPending}
        onConfirm={() => {
          const latest = conflict?.latest;
          if (!latest) return;
          setConfirmOverwrite(false);
          setConflict(null);
          setBase(latest);
          void submit(getValues(), latest.version);
        }}
      />
    </Sheet>
  );
}
