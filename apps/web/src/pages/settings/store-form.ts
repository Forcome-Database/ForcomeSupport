import {
  normalizeStoreInput,
  sites as allSites,
  type AdapterMode,
  type FieldErrors,
  type Platform,
  type Site,
  type Store,
  type StoreInput,
} from '@forcome/contracts';

/*
 * 店铺抽屉（K8）的表单值与提交内容之间的换算，纯函数，便于单元测试。
 * 进线邮箱分两部分：已加入的邮箱（小标签）与输入框里还没加入的那一个（mailboxDraft）；
 * 保存时输入框里的内容也算一个邮箱，排在最后——K8 画的就是输入框里「info@forcome」报格式错误。
 */

export interface StoreFormValues {
  platform: Platform | '';
  name: string;
  sites: Site[];
  defaultSite: Site | '';
  mailboxes: string[];
  mailboxDraft: string;
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
  'mailboxDraft',
  'platformId',
  'adapterMode',
] as const;
export type FormField = (typeof FORM_FIELDS)[number];

/** 新增店铺时的初值；非生产环境数据来源默认模拟数据（开发测试环境外部客户端默认 Fake） */
export function emptyStoreForm(): StoreFormValues {
  return {
    platform: '',
    name: '',
    sites: [],
    defaultSite: '',
    mailboxes: [],
    mailboxDraft: '',
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
    mailboxes: [...store.mailboxes],
    mailboxDraft: '',
    platformId: store.platformId,
    adapterMode: store.adapterMode,
  };
}

/** 要提交的内容；dataSourceEditable 为 false（生产环境）时不带数据来源 */
export function storeInputOf(values: StoreFormValues, dataSourceEditable: boolean): StoreInput {
  const draft = values.mailboxDraft.trim();
  return {
    name: values.name,
    platform: values.platform || null,
    sites: values.sites,
    defaultSite: values.defaultSite || null,
    mailboxes: draft ? [...values.mailboxes, draft] : values.mailboxes,
    platformId: values.platformId,
    ...(dataSourceEditable ? { adapterMode: values.adapterMode } : {}),
  };
}

/** 表单上的一个错误：落在哪个字段（已加入的进线邮箱按序号，如 mailboxes.0），写什么 */
export interface FormError {
  readonly field: FormField | `mailboxes.${number}`;
  readonly message: string;
}

function isFormField(key: string): key is FormField {
  return (FORM_FIELDS as readonly string[]).includes(key);
}

/**
 * 把接口给出的字段错误（键如 name、mailboxes.2）换成表单上的错误：
 * 「至少填写一个进线邮箱」与输入框里那一个邮箱的错误落在输入框（mailboxDraft）上，已加入的邮箱的错误按序号落在小标签上。
 */
export function formErrorsOf(errors: FieldErrors, mailboxCount: number): FormError[] {
  const result: FormError[] = [];
  for (const [key, message] of Object.entries(errors)) {
    const match = /^mailboxes\.(\d+)$/.exec(key);
    if (key === 'mailboxes' || (match && Number(match[1]) >= mailboxCount)) {
      if (!result.some((e) => e.field === 'mailboxDraft')) {
        result.push({ field: 'mailboxDraft', message });
      }
    } else if (match) {
      result.push({ field: `mailboxes.${Number(match[1])}`, message });
    } else if (isFormField(key)) {
      result.push({ field: key, message });
    }
  }
  return result;
}

/** 有错误的字段里最靠上的一个（保存后定位到它） */
export function firstErrorField(errors: readonly FormError[]): FormField | null {
  for (const field of FORM_FIELDS) {
    const hit =
      field === 'mailboxes'
        ? errors.some((e) => e.field.startsWith('mailboxes.'))
        : errors.some((e) => e.field === field);
    if (hit) return field;
  }
  return null;
}

/** G8 里写的「有 N 项未保存的修改」：进线邮箱的小标签与输入框算一项 */
export function unsavedFieldCount(dirtyFields: Partial<Record<FormField, unknown>>): number {
  const fields = Object.entries(dirtyFields)
    .filter(([, dirty]) => Boolean(dirty))
    .map(([field]) => (field === 'mailboxDraft' ? 'mailboxes' : field));
  return new Set(fields).size;
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
    mailboxes: input.mailboxes.join(','),
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
