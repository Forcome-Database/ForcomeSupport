import { businessDate } from '@forcome/calendar';
import {
  applicableFields,
  claimStatuses,
  claimStatusLabels,
  claimTargets,
  claimTargetLabels,
  defaultOwnerId,
  feeItemLabels,
  feeItems,
  formatMoney,
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
  type CurrentMember,
  type LedgerItem,
  type RatioGroup,
  type RegistrationOptions,
  type StoreOption,
} from '@forcome/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useId, useState } from 'react';
import {
  Controller,
  get,
  useForm,
  useWatch,
  type Control,
  type FieldErrors,
} from 'react-hook-form';
import { AffixInput } from '@/components/affix-input';
import { DateField } from '@/components/date-field';
import { FieldError, FormField } from '@/components/form-field';
import { LoadError } from '@/components/load-error';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { UnsavedChangesDialog } from '@/components/unsaved-changes-dialog';
import { AFTERSALES_QUERY_KEY, registrationOptionsQuery } from '@/lib/aftersales';
import { api, ApiRequestError } from '@/lib/api';
import { storeOptionsQuery } from '@/lib/channel';
import { dismissToast, showError, showSuccess } from '@/lib/notify';
import { endSessionIfUnauthenticated } from '@/lib/session';
import { DRAWER, LEAVE, SAVE_RESULT } from './p13-copy';
import { FormSection, MoneyInput, NoteLabel, RatioTable } from './registration-parts';
import {
  amountOfCents,
  emptyRegistrationForm,
  factoryPercents,
  feeTotalCents,
  fieldLabel,
  FORM_ORDER,
  formErrorsOf,
  groupCents,
  quantityText,
  ratioFormOf,
  registrationInputOf,
  withRatioSide,
  type FormError,
  type RegistrationFormPath,
  type RegistrationFormValues,
} from './registration-form';

/*
 * 新建登记的右侧抽屉（PRD P13「第一阶段」、S14；原型 build_ledger.reg_drawer()，宽 640）：
 * 1 处理方式（三张卡片）→ 2 基本信息（店铺、站点、订单号、客户、来源工单、费用发生日、负责人）→ 3 责任与承担比例
 * （责任类型、生产厂、物流问题的索赔对象与状态、「其他」的理由、三组比例）→ 4 寄件（只有寄配件）→ 费用（原币）。
 * 按 R-AS-08 只列适用字段（contracts 的 applicableFields），不适用的不显示，保存时也不交（接口同样清空）。
 * 预填：选店铺带出默认站点与默认负责人；填来源工单（离开输入框时查）带入店铺、站点、订单号、客户；选责任类型按种子数据
 * 预填三组比例；寄配件选配件预填生产厂；改一侧比例另一侧自动补足 100。
 * 点「保存登记」一律交给接口校验（同 P18 的约定，ADR 0007 修订）：接口一次返回全部字段错误，放到对应字段下方，
 * 抽屉顶部给危险横幅「有 N 项需要修改 · 已滚动到第一个错误「…」」并定位到最靠上的错误；改了哪个字段就先撤掉它的错误。
 * 有未保存的输入时关闭抽屉先确认（G8）。成功后浮层提示并刷新台账。
 */

const SAVE_TOAST = 'aftersales-register';

/** 已经报出的字段错误（按表单顺序） */
function presentErrors(errors: FieldErrors<RegistrationFormValues>): FormError[] {
  return FORM_ORDER.flatMap((field) => {
    const message = (get(errors, field) as { message?: string } | undefined)?.message;
    return message ? [{ field, message }] : [];
  });
}

export function RegistrationDrawer({
  registrar,
  onClose,
}: {
  registrar: CurrentMember;
  onClose: () => void;
}) {
  const stores = useQuery(storeOptionsQuery);
  const options = useQuery(registrationOptionsQuery);
  if (stores.data && options.data) {
    return (
      <RegistrationForm
        registrar={registrar}
        stores={stores.data}
        options={options.data}
        onClose={onClose}
      />
    );
  }
  // 选项还没加载好：抽屉先打开，加载失败时给「重试」；这时没有输入，关闭不用确认
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-160">
        <SheetHeader title={DRAWER.createTitle} description={DRAWER.description} />
        <SheetBody>
          {(stores.isError || options.isError) && (
            <LoadError
              onRetry={() => {
                void stores.refetch();
                void options.refetch();
              }}
            />
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
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

function RegistrationForm({
  registrar,
  stores,
  options,
  onClose,
}: {
  registrar: CurrentMember;
  stores: readonly StoreOption[];
  options: RegistrationOptions;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const ids = useId();
  const fieldId = (name: string) => `${ids}-${name.replaceAll('.', '-')}`;
  const [leaving, setLeaving] = useState(false);
  const [lookedUpTicket, setLookedUpTicket] = useState('');

  const form = useForm<RegistrationFormValues>({
    defaultValues: emptyRegistrationForm(businessDate(new Date())),
    shouldFocusError: false,
  });
  const { control, register, handleSubmit, formState, setError, clearErrors, setValue, getValues } =
    form;
  // formState 是按读取订阅的代理：要在渲染时读
  const { isDirty, errors, submitCount } = formState;
  const [method, storeId, responsibility, ratios, fees, partSku, factory, site, reason] = useWatch({
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
  const store = stores.find((s) => s.id === storeId);
  const owners = options.owners;
  const ownerCandidates = ownersForStore(owners, storeId || null);
  const note = ownerNote(owners, storeId || null, registrar.id);
  const part = options.parts.find((p) => p.sku === partSku);
  const shown = presentErrors(errors);
  const total = feeTotalCents(fees);

  const save = useMutation({
    mutationFn: (values: RegistrationFormValues) => api.register(registrationInputOf(values)),
  });

  async function saved(item: LedgerItem) {
    dismissToast(SAVE_TOAST);
    await queryClient.invalidateQueries({ queryKey: AFTERSALES_QUERY_KEY });
    showSuccess({
      title: SAVE_RESULT.savedTitle,
      description: SAVE_RESULT.savedDescription(item.number, item.customerName ?? ''),
    });
    onClose();
  }

  /** 定位到字段：处理方式落到第一张卡片，其余落到控件本身（字段都有 id） */
  function focusField(field: RegistrationFormPath) {
    const element = document.getElementById(fieldId(field));
    const target =
      element?.getAttribute('role') === 'radiogroup'
        ? element.querySelector<HTMLElement>('button')
        : element;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'center' });
  }

  /** 保存失败的处理；字段错误留在抽屉里显示，返回 true 表示已处理 */
  function handledInDrawer(error: unknown): boolean {
    if (endSessionIfUnauthenticated(queryClient, error)) return true;
    if (!(error instanceof ApiRequestError) || error.status !== 400 || !error.fields) return false;
    const fieldErrors = formErrorsOf(error.fields);
    for (const { field, message } of fieldErrors) setError(field, { type: 'server', message });
    const first = fieldErrors[0];
    if (first) focusField(first.field);
    return true;
  }

  async function submit(values: RegistrationFormValues) {
    clearErrors();
    try {
      await saved(await save.mutateAsync(values));
    } catch (error) {
      if (handledInDrawer(error)) return;
      showError({
        id: SAVE_TOAST,
        action: SAVE_RESULT.failedAction,
        error,
        description: SAVE_RESULT.failedDescription,
        retry: async () => {
          try {
            await saved(await save.mutateAsync(values));
          } catch (retryError) {
            if (handledInDrawer(retryError)) return;
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

  /** 来源工单：离开输入框时按工单号查，带入店铺、站点、订单号（工单有时）、客户 */
  async function lookUpTicket() {
    const number = getValues('sourceTicket').trim();
    if (!number || number === lookedUpTicket) return;
    setLookedUpTicket(number);
    try {
      const ticket = await api.sourceTicket(number);
      const ticketStore = stores.find((s) => s.id === ticket.store.id);
      if (ticketStore) chooseStore(ticketStore, ticket.site);
      setValue('sourceTicket', ticket.number, { shouldDirty: true });
      if (ticket.orderNumber) setValue('orderNumber', ticket.orderNumber, { shouldDirty: true });
      setValue('customerName', ticket.customerName, { shouldDirty: true });
      clearErrors(['orderNumber', 'customerName']);
    } catch (error) {
      if (endSessionIfUnauthenticated(queryClient, error)) return;
      if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) {
        setError('sourceTicket', {
          type: 'server',
          message: registrationMessages.sourceTicketNotFound,
        });
        return;
      }
      setLookedUpTicket('');
      showError({ id: 'aftersales-source-ticket', action: '查询', error, retry: lookUpTicket });
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

  const selectError = (field: RegistrationFormPath) =>
    (get(errors, field) as { message?: string } | undefined)?.message;
  const describedBy = (field: RegistrationFormPath) =>
    selectError(field) ? `${fieldId(field)}-error` : undefined;

  /** 抽屉里的下拉（同一套写法：错误写在下方，改了就撤掉这个字段的错误） */
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
      invalid={Boolean(selectError(name))}
      disabled={extra.disabled}
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
      className={extra.mono ? 'tabular-nums' : undefined}
      aria-invalid={selectError(field) ? true : undefined}
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
  const factoryNote =
    method === 'send_parts' && part && factory === part.factory
      ? DRAWER.factoryFromPart(part.sku)
      : DRAWER.factoryRequired;
  // 寄件一节只有寄配件才有，费用一节的序号随之是 5 或 4（原型 S14 的两种画面）
  const feesSection = shipping ? 5 : 4;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <SheetContent className="w-160">
        <SheetHeader title={DRAWER.createTitle} description={DRAWER.description} />
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => void onSave(event)}
        >
          {shown.length > 0 && submitCount > 0 && (
            <div className="shrink-0 px-5 pt-3.5">
              <Alert
                tone="danger"
                title={DRAWER.errorsTitle(shown.length)}
                description={DRAWER.errorsDescription(fieldLabel(shown[0]!.field))}
              />
            </div>
          )}
          <SheetBody className="gap-3">
            <FormSection
              n={1}
              title={DRAWER.sections.method}
              required
              note={DRAWER.sections.methodNote}
              first
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
              {selectError('method') && (
                <FieldError id={`${fieldId('method')}-error`} messages={[selectError('method')!]} />
              )}
            </FormSection>

            <FormSection n={2} title={DRAWER.sections.basic}>
              <div className="grid grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.88fr)] items-start gap-2.5">
                <FormField
                  label={DRAWER.labels.storeId}
                  htmlFor={fieldId('storeId')}
                  required
                  error={selectError('storeId')}
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
                  error={selectError('site')}
                >
                  {select('site', siteOptions, (s) => s)}
                </FormField>
                <FormField
                  label={DRAWER.labels.orderNumber}
                  htmlFor={fieldId('orderNumber')}
                  required
                  error={selectError('orderNumber')}
                >
                  {textInput('orderNumber', { mono: true })}
                </FormField>
                <FormField
                  label={DRAWER.labels.customerName}
                  htmlFor={fieldId('customerName')}
                  required
                  error={selectError('customerName')}
                >
                  {textInput('customerName')}
                </FormField>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <NoteLabel
                    htmlFor={fieldId('sourceTicket')}
                    label={DRAWER.labels.sourceTicket}
                    note={DRAWER.sourceTicketNote}
                  />
                  <Input
                    id={fieldId('sourceTicket')}
                    autoComplete="off"
                    className="tabular-nums"
                    aria-invalid={selectError('sourceTicket') ? true : undefined}
                    aria-describedby={describedBy('sourceTicket')}
                    {...register('sourceTicket', {
                      onChange: () => clearErrors('sourceTicket'),
                      onBlur: () => void lookUpTicket(),
                    })}
                  />
                  {selectError('sourceTicket') && (
                    <FieldError
                      id={`${fieldId('sourceTicket')}-error`}
                      messages={[selectError('sourceTicket')!]}
                    />
                  )}
                </div>
                <FormField
                  label={DRAWER.labels.feeDate}
                  htmlFor={fieldId('feeDate')}
                  required
                  error={selectError('feeDate')}
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
                        onChange={(value) => {
                          field.onChange(value);
                          clearErrors('feeDate');
                        }}
                      />
                    )}
                  />
                </FormField>
                <div className="col-span-2 flex min-w-0 flex-col gap-1.5">
                  <NoteLabel
                    htmlFor={fieldId('ownerId')}
                    label={DRAWER.labels.ownerId}
                    required
                    note={DRAWER.ownerNotes[note] || undefined}
                  />
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
                  {selectError('ownerId') && (
                    <FieldError
                      id={`${fieldId('ownerId')}-error`}
                      messages={[selectError('ownerId')!]}
                    />
                  )}
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
                    error={selectError('responsibility')}
                  >
                    {select('responsibility', responsibilities, (r) => responsibilityLabels[r], {
                      onPick: chooseResponsibility,
                    })}
                  </FormField>
                </div>
                {applicable.has('factory') && (
                  <div className="col-span-2 flex min-w-0 flex-col gap-1.5">
                    <NoteLabel
                      htmlFor={fieldId('factory')}
                      label={DRAWER.labels.factory}
                      required
                      note={factoryNote}
                    />
                    {select(
                      'factory',
                      options.factories.map((f) => f.code),
                      (code) => code,
                    )}
                    {selectError('factory') && (
                      <FieldError
                        id={`${fieldId('factory')}-error`}
                        messages={[selectError('factory')!]}
                      />
                    )}
                  </div>
                )}
                {applicable.has('claimTarget') && (
                  <>
                    <div className="col-span-2">
                      <FormField
                        label={DRAWER.labels.claimTarget}
                        htmlFor={fieldId('claimTarget')}
                        required
                        error={selectError('claimTarget')}
                      >
                        {select('claimTarget', claimTargets, (t) => claimTargetLabels[t])}
                      </FormField>
                    </div>
                    <div className="col-span-2">
                      <FormField
                        label={DRAWER.labels.claimStatus}
                        htmlFor={fieldId('claimStatus')}
                        required
                        error={selectError('claimStatus')}
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
                  error={selectError('responsibilityReason')}
                >
                  <Textarea
                    id={fieldId('responsibilityReason')}
                    rows={2}
                    maxLength={RESPONSIBILITY_REASON_MAX}
                    placeholder={DRAWER.reasonPlaceholder}
                    counter={DRAWER.reasonCounter(reason.length, RESPONSIBILITY_REASON_MAX)}
                    aria-invalid={selectError('responsibilityReason') ? true : undefined}
                    aria-describedby={describedBy('responsibilityReason')}
                    {...register('responsibilityReason', {
                      onChange: () => clearErrors('responsibilityReason'),
                    })}
                  />
                </FormField>
              )}
              <div className="flex flex-col gap-1.5">
                <NoteLabel label={DRAWER.labels.ratios} required note={DRAWER.ratioNote} />
                <RatioTable
                  idOf={(group, side) => fieldId(`ratios.${group}.${side}`)}
                  ratios={ratios}
                  groupAmounts={groupCents(fees)}
                  errors={Object.fromEntries(
                    ratioGroups.map((group) => [
                      group,
                      {
                        fsh: selectError(`ratios.${group}.fsh`),
                        factory: selectError(`ratios.${group}.factory`),
                      },
                    ]),
                  )}
                  onChange={changeRatio}
                />
              </div>
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
                      error={selectError('partSku')}
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
                            if (picked) setValue('factory', picked.factory, { shouldDirty: true });
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
                    error={selectError('partQuantity')}
                  >
                    <AffixInput
                      id={fieldId('partQuantity')}
                      inputMode="numeric"
                      autoComplete="off"
                      suffix={DRAWER.quantitySuffix}
                      aria-invalid={selectError('partQuantity') ? true : undefined}
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
                    error={selectError('shipper')}
                  >
                    {select('shipper', shippers, (s) => shipperLabels[s])}
                  </FormField>
                  <FormField
                    label={DRAWER.labels.carrier}
                    htmlFor={fieldId('carrier')}
                    required
                    error={selectError('carrier')}
                  >
                    {textInput('carrier')}
                  </FormField>
                  <FormField
                    label={DRAWER.labels.shipDate}
                    htmlFor={fieldId('shipDate')}
                    required
                    error={selectError('shipDate')}
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
                      error={selectError('trackingNumber')}
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

            <FormSection
              n={feesSection}
              title={DRAWER.sections.fees}
              note={DRAWER.sections.feeTotal(
                total === null ? '—' : formatMoney(amountOfCents(total), 'USD'),
              )}
            >
              <div className="grid grid-cols-4 items-start gap-2.5">
                {feeItems.map((item) => {
                  const path = `fees.${item}.amount` as const;
                  return (
                    <FormField
                      key={item}
                      label={feeItemLabels[item]}
                      htmlFor={fieldId(path)}
                      required
                      error={selectError(path)}
                    >
                      <Controller
                        control={control}
                        name={`fees.${item}`}
                        render={({ field }) => (
                          <MoneyInput
                            id={fieldId(path)}
                            label={feeItemLabels[item]}
                            value={field.value}
                            invalid={Boolean(selectError(path))}
                            onChange={(value) => {
                              field.onChange(value);
                              clearErrors(path);
                            }}
                          />
                        )}
                      />
                    </FormField>
                  );
                })}
              </div>
              <p className="text-12 leading-normal text-muted-foreground">{DRAWER.feesHint}</p>
            </FormSection>
          </SheetBody>
          <SheetFooter className="items-center">
            <span className="mr-auto text-12 text-subtle-foreground">
              {shown.length > 0 ? DRAWER.footerNoteWithErrors : DRAWER.footerNote}
            </span>
            <Button type="button" variant="outline" onClick={requestClose}>
              {DRAWER.cancel}
            </Button>
            <Button type="submit" loading={save.isPending}>
              <Check />
              {DRAWER.save}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>

      <UnsavedChangesDialog
        open={leaving}
        onOpenChange={setLeaving}
        description={LEAVE}
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
