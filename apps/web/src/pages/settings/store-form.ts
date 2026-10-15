import {
  normalizeMailbox,
  qiyeMailboxMessages,
  normalizeStoreInput,
  QIYE_IMAP_DEFAULTS,
  reusesSavedAuthCode,
  sites as allSites,
  type AdapterMode,
  type FieldErrors,
  type MailboxTestInput,
  type MailProvider,
  type Platform,
  type Site,
  type Store,
  type StoreInput,
  type StoreMailboxInput,
} from '@forcome/contracts';

/*
 * 店铺抽屉（K8）的表单值与提交内容之间的换算，纯函数，便于单元测试。
 * 进线邮箱逐行登记（D-28，待办 34 原型、待办 36）：每行地址 + 服务商；163 企业邮箱的行另有客户端授权码、IMAP 服务器与端口。
 * 每行都留着服务器与端口（Gmail 的行也预填默认值），在两种服务商之间切换时不丢；只有 163 企业邮箱的行提交它们。
 * 客户端授权码只写不读：表单里只有这次新填的，没填就不带，由接口沿用已保存的（contracts 的 reusesSavedAuthCode 同一条规则）。
 */

/** 进线邮箱的一行 */
export interface MailboxRow {
  address: string;
  provider: MailProvider;
  imapHost: string;
  /** 端口按输入框里的文字留着，提交时由接口判断是不是 1–65535 的整数 */
  imapPort: string;
  /** 这次新填的客户端授权码；没填为空 */
  authCode: string;
  /** 已保存授权码的行点了「重新填写」 */
  refill: boolean;
}

export interface StoreFormValues {
  platform: Platform | '';
  name: string;
  sites: Site[];
  defaultSite: Site | '';
  mailboxes: MailboxRow[];
  platformId: string;
  adapterMode: AdapterMode;
}

/** 表单的字段名，也是「保存后定位到第一个错误」的先后（照抽屉里自上而下的顺序） */
export const FORM_FIELDS = [
  'platform',
  'name',
  'sites',
  'defaultSite',
  'mailboxes',
  'platformId',
  'adapterMode',
] as const;
export type FormField = (typeof FORM_FIELDS)[number];

/** 163 企业邮箱的行里报错的字段（地址的错误在 address） */
export const MAILBOX_ROW_FIELDS = ['address', 'authCode', 'imapHost', 'imapPort'] as const;
export type MailboxRowField = (typeof MAILBOX_ROW_FIELDS)[number];

/** 新加的一行：默认 Gmail（K8「新加的行默认 Gmail」），服务器与端口预填 163 企业邮箱的默认值，改成 163 企业邮箱时直接可用 */
export function emptyMailboxRow(): MailboxRow {
  return {
    address: '',
    provider: 'gmail',
    imapHost: QIYE_IMAP_DEFAULTS.host,
    imapPort: String(QIYE_IMAP_DEFAULTS.port),
    authCode: '',
    refill: false,
  };
}

/** 新增店铺时的初值：进线邮箱先给一个空行；非生产环境数据来源默认模拟数据（开发测试环境外部客户端默认 Fake） */
export function emptyStoreForm(): StoreFormValues {
  return {
    platform: '',
    name: '',
    sites: [],
    defaultSite: '',
    mailboxes: [emptyMailboxRow()],
    platformId: '',
    adapterMode: 'fake',
  };
}

/** 编辑店铺时的初值 */
export function storeFormOf(store: Store): StoreFormValues {
  return {
    platform: store.platform,
    name: store.name,
    sites: [...store.sites],
    defaultSite: store.defaultSite,
    mailboxes: store.mailboxes.map((mailbox) => ({
      ...emptyMailboxRow(),
      address: mailbox.address,
      provider: mailbox.provider,
      ...(mailbox.imapHost ? { imapHost: mailbox.imapHost } : {}),
      ...(mailbox.imapPort ? { imapPort: String(mailbox.imapPort) } : {}),
    })),
    platformId: store.platformId,
    adapterMode: store.adapterMode,
  };
}

/**
 * 这一行在抽屉里写「已保存」+「重新填写」（K8 补充小样），而不是要填授权码：163 企业邮箱的行，店铺里同一地址原来就是 163 企业邮箱、
 * 保存过授权码，服务器与端口也没改，且没点「重新填写」。地址、服务器或端口改了就回到要填授权码的样子（待办 35 ⑦，PRD P18「校验」）
 */
export function authCodeSaved(row: MailboxRow, before: Store | null): boolean {
  if (row.provider !== 'qiye163' || row.refill) return false;
  const saved = before?.mailboxes.find((m) => m.address === normalizeMailbox(row.address));
  return reusesSavedAuthCode(saved, row, saved?.authCodeSaved ?? false);
}

/** 空着的 Gmail 行（新增时给的空行、点了「添加进线邮箱」没填的）不提交；163 企业邮箱的行即使地址空着也提交，由接口报错 */
function submitted(row: MailboxRow): boolean {
  return row.provider === 'qiye163' || row.address.trim() !== '';
}

/** 这次新填的授权码（去首尾空白）：没填就不带，由接口沿用已保存的或报错 */
function newAuthCode(row: MailboxRow): { authCode?: string } {
  const authCode = row.authCode.trim();
  return authCode ? { authCode } : {};
}

function mailboxInputOf(row: MailboxRow): StoreMailboxInput {
  if (row.provider === 'gmail') return { address: row.address, provider: 'gmail' };
  return {
    address: row.address,
    provider: 'qiye163',
    imapHost: row.imapHost,
    imapPort: row.imapPort,
    ...newAuthCode(row),
  };
}

/** 要提交的内容；dataSourceEditable 为 false（生产环境）时不带数据来源 */
export function storeInputOf(values: StoreFormValues, dataSourceEditable: boolean): StoreInput {
  return {
    name: values.name,
    platform: values.platform || null,
    sites: values.sites,
    defaultSite: values.defaultSite || null,
    mailboxes: values.mailboxes.filter(submitted).map(mailboxInputOf),
    platformId: values.platformId,
    ...(dataSourceEditable ? { adapterMode: values.adapterMode } : {}),
  };
}

/** 按行「测试连接」提交的内容：这一行当前填的地址、服务器、端口，新填了授权码就带上；编辑时带店铺（没重填时用已保存的） */
export function mailboxTestInputOf(
  row: MailboxRow,
  storeId: string | null,
  adapterMode: AdapterMode | null,
): MailboxTestInput {
  return {
    address: row.address,
    imapHost: row.imapHost,
    imapPort: row.imapPort,
    ...newAuthCode(row),
    ...(storeId ? { storeId } : {}),
    ...(adapterMode ? { adapterMode } : {}),
  };
}

/** 两份行内容测试连接时是不是同一份（地址、服务商、服务器、端口、授权码与是否重新填写都一样） */
export function sameMailboxRow(a: MailboxRow, b: MailboxRow): boolean {
  return (
    a.address === b.address &&
    a.provider === b.provider &&
    a.imapHost === b.imapHost &&
    a.imapPort === b.imapPort &&
    a.authCode === b.authCode &&
    a.refill === b.refill
  );
}

/** 表单上的一个错误：落在哪个字段（进线邮箱按行与行内的字段，如 mailboxes.0.address、mailboxes.0.authCode），写什么 */
export interface FormError {
  readonly field: FormField | `mailboxes.${number}.${MailboxRowField}`;
  readonly message: string;
}

function isFormField(key: string): key is FormField {
  return (FORM_FIELDS as readonly string[]).includes(key);
}

/** 进线邮箱一行里某个控件的路径（mailboxes.<行>.<字段>）拆成行号与字段；不是这种路径返回 null */
export function parseRowPath(
  path: string,
): { readonly row: number; readonly field: MailboxRowField } | null {
  const match = /^mailboxes\.(\d+)\.(\w+)$/.exec(path);
  const field = match?.[2];
  if (!match || !field || !(MAILBOX_ROW_FIELDS as readonly string[]).includes(field)) return null;
  return { row: Number(match[1]), field: field as MailboxRowField };
}

/**
 * 点了「重新填写」又没填授权码的 163 企业邮箱行（K8：点「重新填写」清空后重填，界面上是带 * 的空密码框）：保存前就报
 * 「请填写客户端授权码」、不提交——否则接口会沿用已保存的，与界面上的必填不一致。不想换授权码就关闭抽屉放弃修改
 */
export function refillErrors(rows: readonly MailboxRow[]): FormError[] {
  return rows.flatMap((row, index): FormError[] =>
    row.provider === 'qiye163' && row.refill && !row.authCode.trim()
      ? [{ field: `mailboxes.${index}.authCode`, message: qiyeMailboxMessages.authCodeMissing }]
      : [],
  );
}

/**
 * 把接口给出的字段错误换成表单上的错误。接口的序号按提交的行数（空着的 Gmail 行不提交），这里换回抽屉里的行：
 * mailboxes.<序号> 为这一行的地址，mailboxes.<序号>.<字段> 为 163 企业邮箱的授权码、服务器与端口；「至少填写一个进线邮箱」落在整个字段上。
 */
export function formErrorsOf(errors: FieldErrors, rows: readonly MailboxRow[]): FormError[] {
  const rowOf = rows.flatMap((row, index) => (submitted(row) ? [index] : []));
  const result: FormError[] = [];
  for (const [key, message] of Object.entries(errors)) {
    const match = /^mailboxes\.(\d+)(?:\.(\w+))?$/.exec(key);
    if (match) {
      const row = rowOf[Number(match[1])];
      const field = (match[2] ?? 'address') as MailboxRowField;
      if (row !== undefined && MAILBOX_ROW_FIELDS.includes(field)) {
        result.push({ field: `mailboxes.${row}.${field}`, message });
      }
    } else if (isFormField(key)) {
      result.push({ field: key, message });
    }
  }
  return result;
}

/**
 * 有错误的控件里最靠上的一个（保存后定位到它）：进线邮箱按行、行内按地址、授权码、服务器、端口的先后。
 * 返回字段名，进线邮箱的行内错误返回 mailboxes.<行>.<字段>
 */
export function firstErrorField(errors: readonly FormError[]): FormError['field'] | null {
  for (const field of FORM_FIELDS) {
    if (field !== 'mailboxes') {
      if (errors.some((e) => e.field === field)) return field;
      continue;
    }
    if (errors.some((e) => e.field === 'mailboxes')) return 'mailboxes';
    const inRows = errors
      .flatMap((e) => {
        const path = parseRowPath(e.field);
        return path
          ? [{ ...path, order: MAILBOX_ROW_FIELDS.indexOf(path.field), at: e.field }]
          : [];
      })
      .sort((a, b) => a.row - b.row || a.order - b.order);
    if (inRows[0]) return inRows[0].at;
  }
  return null;
}

/** react-hook-form 的 dirtyFields 里一项是否真的改了：进线邮箱是各行各字段的布尔值（删掉行后可能留下空数组，不算） */
function dirty(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(dirty);
  if (value && typeof value === 'object') return Object.values(value).some(dirty);
  return value === true;
}

/** G8 里写的「有 N 项未保存的修改」：进线邮箱的各行算一项 */
export function unsavedFieldCount(dirtyFields: Partial<Record<FormField, unknown>>): number {
  return Object.values(dirtyFields).filter(dirty).length;
}

/** 站点改了以后的默认站点：只选一个站点时自动带入；原来的默认站点不在所选站点里时清空 */
export function defaultSiteAfter(sites: readonly Site[], current: Site | ''): Site | '' {
  if (sites.length === 1) return sites[0] ?? '';
  return current && sites.includes(current) ? current : '';
}

/** 站点按 US · CA · MX 排序 */
export function sortSites(sites: readonly Site[]): Site[] {
  return allSites.filter((site) => sites.includes(site));
}

const FIELD_LABELS: Record<keyof ReturnType<typeof comparable>, string> = {
  name: '店铺名',
  platform: '平台',
  sites: '站点',
  defaultSite: '默认站点',
  mailboxes: '进线邮箱',
  platformId: '平台标识',
  adapterMode: '数据来源',
};

function comparable(store: Store) {
  const input = normalizeStoreInput({
    name: store.name,
    platform: store.platform,
    sites: store.sites,
    defaultSite: store.defaultSite,
    mailboxes: store.mailboxes,
    platformId: store.platformId,
  });
  return {
    name: input.name,
    platform: input.platform,
    sites: input.sites.join(','),
    defaultSite: input.defaultSite,
    // 服务商、服务器与端口改了也算进线邮箱改了（授权码只写不读，比不出来）
    mailboxes: input.mailboxes
      .map((m) => [m.address, m.provider, m.imapHost ?? '', m.imapPort ?? ''].join(' '))
      .join(','),
    platformId: input.platformId,
    adapterMode: store.adapterMode,
  };
}

/** 乐观锁冲突时（G7）对方改了哪些项：打开抽屉时读到的店铺与最新的店铺逐项比较 */
export function changedFields(before: Store, latest: Store): string[] {
  const a = comparable(before);
  const b = comparable(latest);
  return (Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[])
    .filter((key) => a[key] !== b[key])
    .map((key) => FIELD_LABELS[key]);
}
