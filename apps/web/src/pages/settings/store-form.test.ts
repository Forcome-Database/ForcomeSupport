import type { Store } from '@forcome/contracts';
import { describe, expect, it } from 'vitest';
import {
  authCodeSaved,
  changedFields,
  defaultSiteAfter,
  emptyMailboxRow,
  emptyStoreForm,
  firstErrorField,
  formErrorsOf,
  mailboxTestInputOf,
  parseRowPath,
  refillErrors,
  sameMailboxRow,
  storeFormOf,
  storeInputOf,
  unsavedFieldCount,
  type MailboxRow,
} from './store-form';

const store: Store = {
  id: '0199a0c0-0000-7000-8000-000000000001',
  name: 'forcome.mx',
  platform: 'shopify',
  sites: ['MX'],
  defaultSite: 'MX',
  mailboxes: [
    {
      address: 'support@forcome.mx',
      provider: 'gmail',
      imapHost: null,
      imapPort: null,
      authCodeSaved: false,
    },
  ],
  platformId: 'forcome-mx.myshopify.com',
  adapterMode: 'fake',
  connections: [],
  version: 3,
  updatedAt: '2026-09-11T02:18:00.000Z',
  updatedBy: '刘洋',
};

const auto: Store = {
  ...store,
  id: '0199a0c0-0000-7000-8000-000000000002',
  name: 'Forcome Auto',
  platform: 'amazon',
  mailboxes: [
    {
      address: 'amz-auto@forcome.com',
      provider: 'qiye163',
      imapHost: 'imap.qiye.163.com',
      imapPort: 993,
      authCodeSaved: true,
    },
  ],
};

const row = (overrides: Partial<MailboxRow>): MailboxRow => ({
  ...emptyMailboxRow(),
  ...overrides,
});

describe('进线邮箱逐行登记（K8，D-28）', () => {
  it('新增店铺先给一个空的 Gmail 行，服务器与端口预填 163 企业邮箱的默认值', () => {
    expect(emptyStoreForm().mailboxes).toEqual([
      {
        address: '',
        provider: 'gmail',
        imapHost: 'imap.qiye.163.com',
        imapPort: '993',
        authCode: '',
        refill: false,
      },
    ]);
  });

  it('编辑时每个邮箱一行：163 企业邮箱带服务器与端口，授权码不回显', () => {
    expect(storeFormOf(auto).mailboxes).toEqual([
      row({ address: 'amz-auto@forcome.com', provider: 'qiye163' }),
    ]);
    expect(storeFormOf(store).mailboxes).toEqual([row({ address: 'support@forcome.mx' })]);
  });

  it('已保存的授权码：同一地址、服务器、端口没改且没点「重新填写」才写「已保存」；改了任何一项回到要填授权码（待办 35 ⑦）', () => {
    const saved = storeFormOf(auto).mailboxes[0]!;
    expect(authCodeSaved(saved, auto)).toBe(true);
    // 大小写与首尾空白不算改
    expect(
      authCodeSaved(
        { ...saved, address: ' AMZ-auto@forcome.com', imapHost: 'IMAP.qiye.163.com ' },
        auto,
      ),
    ).toBe(true);
    expect(authCodeSaved({ ...saved, refill: true }, auto)).toBe(false);
    expect(authCodeSaved({ ...saved, imapHost: 'imaphz.qiye.163.com' }, auto)).toBe(false);
    expect(authCodeSaved({ ...saved, imapPort: '143' }, auto)).toBe(false);
    expect(authCodeSaved({ ...saved, address: 'amz-auto2@forcome.com' }, auto)).toBe(false);
    // 新店铺、从 Gmail 改来、没保存过授权码的
    expect(authCodeSaved(saved, null)).toBe(false);
    expect(authCodeSaved({ ...saved, provider: 'gmail' }, auto)).toBe(false);
    expect(authCodeSaved(row({ address: 'support@forcome.mx', provider: 'qiye163' }), store)).toBe(
      false,
    );
    expect(
      authCodeSaved(saved, {
        ...auto,
        mailboxes: [{ ...auto.mailboxes[0]!, authCodeSaved: false }],
      }),
    ).toBe(false);
  });
});

describe('店铺抽屉的提交内容（K8）', () => {
  it('空着的 Gmail 行不提交；没选的平台与默认站点为空', () => {
    expect(
      storeInputOf(
        {
          ...emptyStoreForm(),
          mailboxes: [
            row({ address: 'support@forcome.mx' }),
            row({}),
            row({ address: ' info@forcome ' }),
          ],
        },
        true,
      ),
    ).toEqual({
      name: '',
      platform: null,
      sites: [],
      defaultSite: null,
      mailboxes: [
        { address: 'support@forcome.mx', provider: 'gmail' },
        { address: ' info@forcome ', provider: 'gmail' },
      ],
      platformId: '',
      adapterMode: 'fake',
    });
  });

  it('163 企业邮箱的行带服务器与端口，新填了授权码才带（没填由接口沿用已保存的）；地址空着也提交、由接口报错', () => {
    expect(
      storeInputOf(
        {
          ...storeFormOf(auto),
          mailboxes: [
            row({ address: 'amz-auto@forcome.com', provider: 'qiye163' }),
            row({
              address: 'help@forcome.com',
              provider: 'qiye163',
              imapPort: ' 994',
              authCode: ' code-1 ',
            }),
            row({ provider: 'qiye163' }),
          ],
        },
        true,
      ).mailboxes,
    ).toEqual([
      {
        address: 'amz-auto@forcome.com',
        provider: 'qiye163',
        imapHost: 'imap.qiye.163.com',
        imapPort: '993',
      },
      {
        address: 'help@forcome.com',
        provider: 'qiye163',
        imapHost: 'imap.qiye.163.com',
        imapPort: ' 994',
        authCode: 'code-1',
      },
      { address: '', provider: 'qiye163', imapHost: 'imap.qiye.163.com', imapPort: '993' },
    ]);
  });

  it('163 企业邮箱改回 Gmail：只提交地址与服务商（保存后授权码由接口删除）', () => {
    expect(
      storeInputOf(
        {
          ...storeFormOf(auto),
          mailboxes: [row({ address: 'amz-auto@forcome.com', authCode: 'x' })],
        },
        true,
      ).mailboxes,
    ).toEqual([{ address: 'amz-auto@forcome.com', provider: 'gmail' }]);
  });

  it('生产环境（不显示数据来源）不提交数据来源', () => {
    expect(storeInputOf(storeFormOf(store), false)).not.toHaveProperty('adapterMode');
  });

  it('按行测试连接：这一行当前填的内容，新填了授权码才带；编辑时带店铺，数据来源按抽屉当前的选择', () => {
    expect(
      mailboxTestInputOf(
        row({ address: 'amz-auto@forcome.com', provider: 'qiye163' }),
        auto.id,
        'fake',
      ),
    ).toEqual({
      address: 'amz-auto@forcome.com',
      imapHost: 'imap.qiye.163.com',
      imapPort: '993',
      storeId: auto.id,
      adapterMode: 'fake',
    });
    expect(
      mailboxTestInputOf(
        row({ address: 'new@forcome.com', provider: 'qiye163', authCode: ' c ' }),
        null,
        null,
      ),
    ).toEqual({
      address: 'new@forcome.com',
      imapHost: 'imap.qiye.163.com',
      imapPort: '993',
      authCode: 'c',
    });
  });
});

describe('字段错误落到表单上', () => {
  it('接口按提交的行编号，换回抽屉里的行（空着的 Gmail 行不提交）；行内的授权码、服务器、端口各落各的', () => {
    const rows = [
      row({ address: 'support@forcome.mx' }),
      row({}),
      row({ address: 'info@forcome' }),
      row({ address: 'help@forcome.com', provider: 'qiye163' }),
    ];
    expect(
      formErrorsOf(
        {
          name: '店铺名已存在，请换一个',
          'mailboxes.0': 'support@forcome.mx 已是 forcome.mx 的进线邮箱',
          'mailboxes.1': '邮箱格式不正确，例如 info@forcome.mx',
          'mailboxes.2.authCode': '请填写客户端授权码',
          'mailboxes.2.imapPort': '端口为 1–65535 的整数',
          platformId: '请填写店铺域名',
        },
        rows,
      ),
    ).toEqual([
      { field: 'name', message: '店铺名已存在，请换一个' },
      { field: 'mailboxes.0.address', message: 'support@forcome.mx 已是 forcome.mx 的进线邮箱' },
      { field: 'mailboxes.2.address', message: '邮箱格式不正确，例如 info@forcome.mx' },
      { field: 'mailboxes.3.authCode', message: '请填写客户端授权码' },
      { field: 'mailboxes.3.imapPort', message: '端口为 1–65535 的整数' },
      { field: 'platformId', message: '请填写店铺域名' },
    ]);
    expect(formErrorsOf({ mailboxes: '至少填写一个进线邮箱' }, [row({})])).toEqual([
      { field: 'mailboxes', message: '至少填写一个进线邮箱' },
    ]);
  });

  it('保存后定位到最靠上的错误：平台 → 店铺名 → 站点 → 默认站点 → 进线邮箱（按行，行内地址 → 授权码 → 服务器 → 端口）→ 平台标识 → 数据来源', () => {
    const rows = [
      row({ address: 'a@forcome.com', provider: 'qiye163' }),
      row({ address: 'b@forcome.com', provider: 'qiye163' }),
    ];
    const at = (...fields: string[]) =>
      formErrorsOf(Object.fromEntries(fields.map((f) => [f, 'x'])), rows);
    expect(firstErrorField(at('platformId', 'name'))).toBe('name');
    expect(firstErrorField(at('platformId', 'mailboxes.1'))).toBe('mailboxes.1.address');
    expect(firstErrorField(at('mailboxes.1', 'mailboxes.0.imapPort', 'mailboxes.0.authCode'))).toBe(
      'mailboxes.0.authCode',
    );
    expect(firstErrorField(at('adapterMode', 'mailboxes'))).toBe('mailboxes');
    expect(firstErrorField([])).toBeNull();
  });

  it('G8 的未保存项数：进线邮箱的各行算一项；删掉行后留下的空数组、全是 false 的行不算', () => {
    expect(unsavedFieldCount({ name: true, mailboxes: [false, { address: true }] })).toBe(2);
    expect(unsavedFieldCount({ platformId: false })).toBe(0);
    expect(unsavedFieldCount({ mailboxes: [] })).toBe(0);
    expect(unsavedFieldCount({ mailboxes: [{ address: false, provider: false }] })).toBe(0);
  });

  it('测试结果只对测过的内容有效：测试中改了这一行的任何一项，回来的结果不写', () => {
    const tested = row({ address: 'a@forcome.com', provider: 'qiye163', authCode: 'x' });
    expect(sameMailboxRow(tested, { ...tested })).toBe(true);
    for (const change of [
      { address: 'b@forcome.com' },
      { imapHost: 'imaphz.qiye.163.com' },
      { imapPort: '994' },
      { authCode: 'y' },
      { provider: 'gmail' as const },
      { refill: true },
    ]) {
      expect(sameMailboxRow(tested, { ...tested, ...change })).toBe(false);
    }
  });

  it('控件路径拆成行号与字段：只认 mailboxes.<行>.<地址 / 授权码 / 服务器 / 端口>', () => {
    expect(parseRowPath('mailboxes.2.authCode')).toEqual({ row: 2, field: 'authCode' });
    expect(parseRowPath('mailboxes.0.address')).toEqual({ row: 0, field: 'address' });
    expect(parseRowPath('mailboxes.0.provider')).toBeNull();
    expect(parseRowPath('mailboxes')).toBeNull();
    expect(parseRowPath('name')).toBeNull();
  });

  it('点了「重新填写」又没填授权码的 163 企业邮箱行，保存前就报「请填写客户端授权码」', () => {
    expect(
      refillErrors([
        row({ address: 'a@forcome.com', provider: 'qiye163', refill: true }),
        row({ address: 'b@forcome.com', provider: 'qiye163', refill: true, authCode: 'x' }),
        row({ address: 'c@forcome.com', provider: 'qiye163' }),
        row({ address: 'd@forcome.com', refill: true }),
        row({ address: 'e@forcome.com', provider: 'qiye163', refill: true, authCode: '  ' }),
      ]),
    ).toEqual([
      { field: 'mailboxes.0.authCode', message: '请填写客户端授权码' },
      { field: 'mailboxes.4.authCode', message: '请填写客户端授权码' },
    ]);
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
        mailboxes: [...store.mailboxes, { ...store.mailboxes[0]!, address: 'ventas@forcome.mx' }],
        version: 4,
      }),
    ).toEqual(['店铺名', '进线邮箱']);
    expect(
      changedFields(store, {
        ...store,
        mailboxes: [{ ...store.mailboxes[0]!, address: 'Support@Forcome.MX' }],
      }),
    ).toEqual([]);
  });
});
