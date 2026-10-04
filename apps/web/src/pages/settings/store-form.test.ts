import type { Store } from '@forcome/contracts';
import { describe, expect, it } from 'vitest';
import {
  changedFields,
  defaultSiteAfter,
  emptyStoreForm,
  firstErrorField,
  formErrorsOf,
  storeFormOf,
  storeInputOf,
} from './store-form';

const store: Store = {
  id: '0199a0c0-0000-7000-8000-000000000001',
  name: 'forcome.mx',
  platform: 'shopify',
  sites: ['MX'],
  defaultSite: 'MX',
  mailboxes: ['support@forcome.mx'],
  platformId: 'forcome-mx.myshopify.com',
  adapterMode: 'fake',
  connections: [],
  version: 3,
  updatedAt: '2026-09-11T02:18:00.000Z',
  updatedBy: '刘洋',
};

describe('店铺抽屉的提交内容（K8）', () => {
  it('输入框里还没加入的邮箱也算一个，排在最后；没选的平台与默认站点为空', () => {
    expect(
      storeInputOf(
        {
          ...emptyStoreForm(),
          mailboxes: ['support@forcome.mx'],
          mailboxDraft: ' info@forcome ',
        },
        true,
      ),
    ).toEqual({
      name: '',
      platform: null,
      sites: [],
      defaultSite: null,
      mailboxes: ['support@forcome.mx', 'info@forcome'],
      platformId: '',
      adapterMode: 'fake',
    });
  });

  it('生产环境（不显示数据来源）不提交数据来源', () => {
    expect(storeInputOf(storeFormOf(store), false)).not.toHaveProperty('adapterMode');
  });
});

describe('字段错误落到表单上', () => {
  it('输入框那一个邮箱与「至少填写一个」落在输入框，已加入的邮箱按序号落在小标签上', () => {
    expect(
      formErrorsOf(
        {
          name: '店铺名已存在，请换一个',
          'mailboxes.0': 'support@forcome.mx 已是 forcome.mx 的进线邮箱',
          'mailboxes.2': '邮箱格式不正确，例如 info@forcome.mx',
          platformId: '请填写店铺域名',
        },
        2,
      ),
    ).toEqual({
      name: '店铺名已存在，请换一个',
      'mailboxes.0': 'support@forcome.mx 已是 forcome.mx 的进线邮箱',
      mailboxDraft: '邮箱格式不正确，例如 info@forcome.mx',
      platformId: '请填写店铺域名',
    });
    expect(formErrorsOf({ mailboxes: '至少填写一个进线邮箱' }, 0)).toEqual({
      mailboxDraft: '至少填写一个进线邮箱',
    });
  });

  it('保存后定位到最靠上的错误：平台 → 店铺名 → 站点 → 默认站点 → 进线邮箱 → 平台标识 → 数据来源', () => {
    expect(firstErrorField({ platformId: 'x', name: 'y' })).toBe('name');
    expect(firstErrorField({ platformId: 'x', 'mailboxes.1': 'y' })).toBe('mailboxes');
    expect(firstErrorField({ adapterMode: 'x', mailboxDraft: 'y' })).toBe('mailboxDraft');
    expect(firstErrorField({})).toBeNull();
  });
});

describe('默认站点跟着站点变', () => {
  it('只选一个站点时自动带入，原来的默认站点不在所选站点里时清空', () => {
    expect(defaultSiteAfter(['CA'], '')).toBe('CA');
    expect(defaultSiteAfter(['US', 'CA'], 'CA')).toBe('CA');
    expect(defaultSiteAfter(['US', 'CA'], 'MX')).toBe('');
    expect(defaultSiteAfter([], 'MX')).toBe('');
  });
});

describe('乐观锁冲突时对方改了哪些项（G7）', () => {
  it('逐项比较，大小写与顺序不同的邮箱、站点视为相同', () => {
    expect(changedFields(store, { ...store, version: 4 })).toEqual([]);
    expect(
      changedFields(store, {
        ...store,
        name: 'forcome México',
        mailboxes: ['support@forcome.mx', 'ventas@forcome.mx'],
        version: 4,
      }),
    ).toEqual(['店铺名', '进线邮箱']);
    expect(changedFields(store, { ...store, mailboxes: ['Support@Forcome.MX'] })).toEqual([]);
  });
});
