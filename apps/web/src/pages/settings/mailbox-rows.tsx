import { mailProviders, type AdapterMode, type Store } from '@forcome/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Lock, Plus, TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Controller, useFieldArray, useWatch, type UseFormReturn } from 'react-hook-form';
import { FieldError, FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, ApiRequestError } from '@/lib/api';
import { showError } from '@/lib/notify';
import { endSessionIfUnauthenticated } from '@/lib/session';
import { cn } from '@/lib/utils';
import { A11Y, DRAWER, MAILBOX_ROWS } from './p18-copy';
import {
  authCodeSaved,
  emptyMailboxRow,
  mailboxTestInputOf,
  MAILBOX_ROW_FIELDS,
  type MailboxRowField,
  type StoreFormValues,
} from './store-form';

/*
 * 店铺抽屉的「进线邮箱」（K8 与补充小样，D-28；原型 mb_field()、mb_row()）：逐行登记地址 + 服务商（Gmail / 163 企业邮箱，新加的行默认 Gmail）
 * + 移除，末尾「添加进线邮箱」。服务商为 163 企业邮箱的行下方展开一块浅底面板：客户端授权码（只写不显——新填时为密码框并写提示；
 * 已保存时写「🔒 已保存」+「重新填写」，地址、服务器或端口改了回到要填的样子，待办 35 ⑦）、IMAP 服务器与端口（第一阶段没有 SMTP），
 * 以及按行「测试连接」：不保存也能测，测试中按钮转圈并写「正在登录并检查收件箱与「已发送」」，结果写在按钮右边（成功绿勾、失败红色，
 * 写法由接口按原因给出）；改了这一行就撤掉上次的结果。
 * 地址的错误写在这一行下方，授权码、服务器、端口的错误写在各自的输入框下方；「至少填写一个进线邮箱」写在整个字段下方
 * （记在表单的 root.mailboxes：各行的错误按行号记在 mailboxes 下，整个字段的错误另放一处）。
 * 没有错误时字段下方写提示（原型有错误的小样不写提示）。
 */

/** 一行里各控件的 id（label 的 htmlFor、保存后定位到第一个错误） */
export function mailboxControlId(fieldId: string, index: number, field: MailboxRowField): string {
  return `${fieldId}-${index}-${field}`;
}

/** 「添加进线邮箱」的 id：一行都没有时「至少填写一个进线邮箱」定位到它 */
export const addMailboxId = (fieldId: string) => `${fieldId}-add`;

type RowErrors = Partial<Record<MailboxRowField, { message?: string }>>;

/** 按行测试连接的结果（行内一行字） */
interface TestResult {
  readonly ok: boolean;
  readonly message: string;
}

function TestResultLine({ result }: { result: TestResult }) {
  const Icon = result.ok ? CircleCheck : TriangleAlert;
  return (
    <p
      role="status"
      data-testid="mailbox-test-result"
      className={cn(
        'flex items-start gap-1 text-12',
        result.ok ? 'text-success-text' : 'text-destructive-text',
      )}
    >
      <Icon className="mt-0.5 size-3.25 shrink-0" strokeWidth={2} />
      {result.message}
    </p>
  );
}

function MailboxRowEditor({
  index,
  fieldId,
  form,
  base,
  adapterMode,
  onRemove,
}: {
  index: number;
  fieldId: string;
  form: UseFormReturn<StoreFormValues>;
  base: Store | null;
  adapterMode: AdapterMode | null;
  onRemove: () => void;
}) {
  const queryClient = useQueryClient();
  const { control, register, formState, clearErrors, setError, setValue, getValues, setFocus } =
    form;
  const row = useWatch({ control, name: `mailboxes.${index}` });
  const errors = (formState.errors.mailboxes?.[index] ?? {}) as RowErrors;
  const [result, setResult] = useState<TestResult | null>(null);
  const focusCode = useRef(false);
  const id = (field: MailboxRowField) => mailboxControlId(fieldId, index, field);
  const name = (field: MailboxRowField) => `mailboxes.${index}.${field}` as const;
  const saved = authCodeSaved(row, base);

  // 「重新填写」之后密码框才渲染出来：等它出现再把焦点放上去
  useEffect(() => {
    if (!focusCode.current) return;
    focusCode.current = false;
    setFocus(name('authCode'));
  });

  /** 改了这一行：撤掉该控件的错误与上次的测试结果（结果只对测过的内容有效） */
  function changed(field: MailboxRowField) {
    clearErrors(name(field));
    clearErrors('root.mailboxes');
    setResult(null);
  }

  const test = useMutation({
    mutationFn: () =>
      api.testMailbox(
        mailboxTestInputOf(getValues(`mailboxes.${index}`), base?.id ?? null, adapterMode),
      ),
    onMutate: () => {
      setResult(null);
      clearErrors(MAILBOX_ROW_FIELDS.map(name));
    },
    onSuccess: (tested) => setResult({ ok: true, message: tested.message }),
    onError: (error) => {
      if (endSessionIfUnauthenticated(queryClient, error)) return;
      if (error instanceof ApiRequestError && error.code === 'connection_test_failed') {
        setResult({ ok: false, message: error.message });
        return;
      }
      if (error instanceof ApiRequestError && error.status === 400 && error.fields) {
        for (const [key, message] of Object.entries(error.fields)) {
          if ((MAILBOX_ROW_FIELDS as readonly string[]).includes(key)) {
            setError(name(key as MailboxRowField), { type: 'server', message });
          }
        }
        return;
      }
      showError({
        id: `mailbox-test-${fieldId}-${index}`,
        action: MAILBOX_ROWS.test,
        error,
        retry: () => test.mutateAsync(),
      });
    },
  });

  const describedBy = (field: MailboxRowField) =>
    errors[field]?.message ? `${id(field)}-error` : undefined;

  return (
    <div
      data-testid="mailbox-row"
      data-address={row.address.trim().toLowerCase()}
      className="flex flex-col gap-1.5"
    >
      <div className="flex items-center gap-1.5">
        <Input
          id={id('address')}
          autoComplete="off"
          placeholder={MAILBOX_ROWS.placeholder}
          aria-label={A11Y.mailboxAddress(index)}
          aria-invalid={errors.address?.message ? true : undefined}
          aria-describedby={describedBy('address')}
          className="flex-1"
          {...register(name('address'), { onChange: () => changed('address') })}
        />
        <Controller
          control={control}
          name={`mailboxes.${index}.provider`}
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={(value) => {
                if (!value) return;
                field.onChange(value);
                clearErrors([...MAILBOX_ROW_FIELDS.filter((f) => f !== 'address').map(name)]);
                setResult(null);
              }}
            >
              <SelectTrigger
                ref={field.ref}
                aria-label={A11Y.mailboxProvider(index)}
                className="w-33 shrink-0"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {mailProviders.map((provider) => (
                  <SelectItem key={provider} value={provider}>
                    {MAILBOX_ROWS.providers[provider]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={A11Y.removeMailbox(row.address.trim())}
          title={A11Y.removeMailbox('')}
          className="text-subtle-foreground"
          onClick={onRemove}
        >
          <X />
        </Button>
      </div>
      <FieldError id={`${id('address')}-error`} messages={errorMessages(errors.address)} />
      {row.provider === 'qiye163' && (
        <div
          data-testid="qiye-panel"
          className="flex flex-col gap-2.5 rounded-md border border-border bg-muted px-3 py-2.5"
        >
          {saved ? (
            <FormField
              label={MAILBOX_ROWS.authCode}
              htmlFor={id('authCode')}
              required
              error={errors.authCode?.message}
            >
              <div className="flex items-center gap-2.5">
                <div
                  id={id('authCode')}
                  data-testid="auth-code-saved"
                  className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-muted px-2.5 text-body text-foreground"
                >
                  <Lock aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
                  {MAILBOX_ROWS.saved}
                </div>
                <Button
                  type="button"
                  variant="text-link"
                  size="text"
                  onClick={() => {
                    setValue(`mailboxes.${index}.refill`, true, { shouldDirty: true });
                    setValue(name('authCode'), '', { shouldDirty: true });
                    setResult(null);
                    focusCode.current = true;
                  }}
                >
                  {MAILBOX_ROWS.refill}
                </Button>
              </div>
            </FormField>
          ) : (
            <FormField
              label={MAILBOX_ROWS.authCode}
              htmlFor={id('authCode')}
              required
              hint={MAILBOX_ROWS.authCodeHint}
              error={errors.authCode?.message}
            >
              <Input
                id={id('authCode')}
                type="password"
                autoComplete="new-password"
                placeholder={MAILBOX_ROWS.authCodePlaceholder}
                aria-invalid={errors.authCode?.message ? true : undefined}
                aria-describedby={describedBy('authCode')}
                {...register(name('authCode'), { onChange: () => changed('authCode') })}
              />
            </FormField>
          )}
          <div className="grid grid-cols-[1fr_84px] items-start gap-2">
            <FormField
              label={MAILBOX_ROWS.imapHost}
              htmlFor={id('imapHost')}
              required
              error={errors.imapHost?.message}
            >
              <Input
                id={id('imapHost')}
                autoComplete="off"
                aria-invalid={errors.imapHost?.message ? true : undefined}
                aria-describedby={describedBy('imapHost')}
                {...register(name('imapHost'), { onChange: () => changed('imapHost') })}
              />
            </FormField>
            <FormField
              label={MAILBOX_ROWS.imapPort}
              htmlFor={id('imapPort')}
              required
              error={errors.imapPort?.message}
            >
              <Input
                id={id('imapPort')}
                autoComplete="off"
                inputMode="numeric"
                className="tabular-nums"
                aria-invalid={errors.imapPort?.message ? true : undefined}
                aria-describedby={describedBy('imapPort')}
                {...register(name('imapPort'), { onChange: () => changed('imapPort') })}
              />
            </FormField>
          </div>
          <div className="flex items-start gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={test.isPending}
              onClick={() => test.mutate()}
            >
              {test.isPending ? MAILBOX_ROWS.testing : MAILBOX_ROWS.test}
            </Button>
            <div className="flex min-h-7 min-w-0 items-center">
              {test.isPending ? (
                <span className="text-12 text-muted-foreground">{MAILBOX_ROWS.testingNote}</span>
              ) : result ? (
                <TestResultLine result={result} />
              ) : (
                <span className="text-12 text-subtle-foreground">{MAILBOX_ROWS.testIdle}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function errorMessages(error: { message?: string } | undefined): string[] {
  return error?.message ? [error.message] : [];
}

/** 「进线邮箱（可填多个，含别名）」：逐行登记，末尾「添加进线邮箱」 */
export function MailboxesField({
  id,
  form,
  base,
  adapterMode,
}: {
  id: string;
  form: UseFormReturn<StoreFormValues>;
  base: Store | null;
  /** 抽屉当前的「数据来源」（按行测试连接用它）；生产环境不显示时为 null，由接口按店铺定 */
  adapterMode: AdapterMode | null;
}) {
  const { control, formState, clearErrors } = form;
  const { fields, append, remove } = useFieldArray({ control, name: 'mailboxes' });
  const rootError = formState.errors.root?.mailboxes?.message;
  const rowErrors = (formState.errors.mailboxes ?? []) as readonly (RowErrors | undefined)[];
  const anyRowError = fields.some((_, index) =>
    MAILBOX_ROW_FIELDS.some((field) => rowErrors[index]?.[field]?.message),
  );

  return (
    <FormField
      label={DRAWER.labels.mailboxes}
      htmlFor={fields.length > 0 ? mailboxControlId(id, 0, 'address') : addMailboxId(id)}
      required
      hint={anyRowError ? undefined : DRAWER.mailboxHint}
      error={rootError}
    >
      <div className="flex flex-col gap-2">
        {fields.map((field, index) => (
          <MailboxRowEditor
            key={field.id}
            index={index}
            fieldId={id}
            form={form}
            base={base}
            adapterMode={adapterMode}
            onRemove={() => {
              remove(index);
              // 错误按行号记，删掉一行后行号变了：一并撤掉，保存时再报
              clearErrors('mailboxes');
            }}
          />
        ))}
        <div className="flex">
          <Button
            id={addMailboxId(id)}
            type="button"
            variant="text-link"
            size="text"
            onClick={() => {
              append(emptyMailboxRow());
              clearErrors('root.mailboxes');
            }}
          >
            {MAILBOX_ROWS.add}
            <Plus />
          </Button>
        </div>
      </div>
    </FormField>
  );
}
