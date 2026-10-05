import { describe, expect, it } from 'vitest';
import {
  recognizeInbound,
  type InboundMailFacts,
  type SenderRule,
  type StoreFacts,
} from './recognition';

/*
 * 来源、渠道与站点识别（规格 channel「渠道识别」「来源识别」「店铺与站点识别」，PRD R-TK-08、R-ST-02、1.4「来源」，
 * 待办 10）：纯函数，输入一封来信的头字段与正文、收到它的店铺、来源规则表，输出渠道、站点、来源与客户渠道身份。
 * 规则表在这里照迁移 0009 写入的种子清单（所有环境相同，协调者 10-05 决定）抄一份，再加生产厂邮箱与一家其他供应商；
 * 系统实际灌入的种子由集成测试 source-recognition.int.test.ts 经主接缝验证。
 */

const AMAZON_STORE: StoreFacts = { platform: 'amazon', defaultSite: 'US' };
const SHOPIFY_STORE: StoreFacts = { platform: 'shopify', defaultSite: 'US' };
const SHOPIFY_MX_STORE: StoreFacts = { platform: 'shopify', defaultSite: 'MX' };

/** 迁移 0009 的种子：平台通知（发件域精确等于）与营销（头） */
const SEED_RULES: readonly SenderRule[] = [
  { kind: 'domain', pattern: 'amazon.com', headerValue: null, source: 'platform_notification' },
  { kind: 'domain', pattern: 'amazon.ca', headerValue: null, source: 'platform_notification' },
  { kind: 'domain', pattern: 'amazon.com.mx', headerValue: null, source: 'platform_notification' },
  { kind: 'domain', pattern: 'shopify.com', headerValue: null, source: 'platform_notification' },
  { kind: 'header', pattern: 'list-unsubscribe', headerValue: null, source: 'marketing' },
  { kind: 'header', pattern: 'precedence', headerValue: 'bulk', source: 'marketing' },
  { kind: 'header', pattern: 'precedence', headerValue: 'list', source: 'marketing' },
  { kind: 'header', pattern: 'precedence', headerValue: 'junk', source: 'marketing' },
];

/** 种子 + 已登记生产厂邮箱（示例数据的 FQD、FZJ）+ 一家其他供应商（按发件域登记） */
const RULES: readonly SenderRule[] = [
  ...SEED_RULES,
  { kind: 'address', pattern: 'qc@fqd-forcome.com', headerValue: null, source: 'producer' },
  {
    kind: 'address',
    pattern: 'service@fzj-forcome.com',
    headerValue: null,
    source: 'producer',
  },
  { kind: 'domain', pattern: 'eccang.example', headerValue: null, source: 'other_supplier' },
];

function mail(overrides: Partial<InboundMailFacts> = {}): InboundMailFacts {
  return {
    from: { address: 'james.walker@example.com', name: 'James Walker' },
    replyTo: [],
    text: 'The box arrived crushed and the vacuum body is cracked.',
    headers: [],
    ...overrides,
  };
}

/** Shopify 联系表单的通知（mailer@shopify.com 代发，Reply-To 是填表客户的邮箱） */
function contactForm(overrides: Partial<InboundMailFacts> = {}): InboundMailFacts {
  return mail({
    from: { address: 'mailer@shopify.com', name: 'forcome.com' },
    replyTo: [{ address: 'emily.chen@example.com', name: '' }],
    text: [
      "You received a new message from your online store's contact form.",
      'Country Code: US',
      'Name: Emily Chen',
      'Email: emily.chen@example.com',
      'Phone Number:',
      'Body:',
      'Does the V2 fit a Tesla Model Y 12V socket?',
    ].join('\n'),
    ...overrides,
  });
}

describe('渠道识别（R-TK-08）', () => {
  it('亚马逊店铺邮箱收到亚马逊买家消息中转来信 → 亚马逊，客户渠道身份是中转地址', () => {
    const result = recognizeInbound(
      mail({ from: { address: 's.mitchell.4h2k@marketplace.amazon.com', name: 'Sarah Mitchell' } }),
      AMAZON_STORE,
      RULES,
    );
    expect(result).toEqual({
      channel: 'amazon',
      site: 'US',
      source: 'customer',
      sender: { address: 's.mitchell.4h2k@marketplace.amazon.com', name: 'Sarah Mitchell' },
    });
  });

  it('Shopify 店铺邮箱收到 Shopify 联系表单通知 → Shopify，客户渠道身份取表单的回复邮箱（Reply-To），姓名取表单里的 Name', () => {
    expect(recognizeInbound(contactForm(), SHOPIFY_STORE, RULES)).toEqual({
      channel: 'shopify',
      site: 'US',
      source: 'customer',
      sender: { address: 'emily.chen@example.com', name: 'Emily Chen' },
    });
  });

  it('联系表单通知没有 Reply-To（或只是 no-reply@shopify.com）时，客户渠道身份取表单正文里的 Email', () => {
    const noReplyTo = contactForm({ replyTo: [] });
    const shopifyNoReply = contactForm({
      replyTo: [{ address: 'no-reply@shopify.com', name: '' }],
    });
    for (const form of [noReplyTo, shopifyNoReply]) {
      expect(recognizeInbound(form, SHOPIFY_STORE, RULES)).toMatchObject({
        channel: 'shopify',
        source: 'customer',
        sender: { address: 'emily.chen@example.com', name: 'Emily Chen' },
      });
    }
  });

  it('Reply-To 写了显示名时以它为姓名，地址转小写', () => {
    const form = contactForm({
      replyTo: [{ address: 'Emily.Chen@Example.com', name: 'Emily C.' }],
      text: 'Body:\nHello',
    });
    expect(recognizeInbound(form, SHOPIFY_STORE, RULES).sender).toEqual({
      address: 'emily.chen@example.com',
      name: 'Emily C.',
    });
  });

  it('其余直接写到店铺客服邮箱的来信 → 邮件（直邮），客户渠道身份是发件地址', () => {
    expect(recognizeInbound(mail(), SHOPIFY_STORE, RULES)).toEqual({
      channel: 'email',
      site: 'US',
      source: 'customer',
      sender: { address: 'james.walker@example.com', name: 'James Walker' },
    });
    // 客户直接写到亚马逊店铺的邮箱，也是邮件
    expect(recognizeInbound(mail(), AMAZON_STORE, RULES).channel).toBe('email');
  });

  it('不是店铺所在平台的中转：亚马逊中转来信落到 Shopify 店铺邮箱、联系表单通知落到亚马逊店铺邮箱，都按邮件', () => {
    const relayed = mail({
      from: { address: 'buyer.x@marketplace.amazon.com', name: 'Buyer' },
    });
    expect(recognizeInbound(relayed, SHOPIFY_STORE, RULES).channel).toBe('email');
    expect(recognizeInbound(contactForm(), AMAZON_STORE, RULES)).toMatchObject({
      channel: 'email',
      // 不是联系表单，就是 Shopify 的系统邮件
      source: 'platform_notification',
      sender: { address: 'mailer@shopify.com' },
    });
  });

  it('mailer@shopify.com 发来、却找不到客户邮箱（不是联系表单通知）→ 邮件，按 Shopify 系统邮件归档', () => {
    const system = contactForm({ replyTo: [], text: 'Your store has a new payout.' });
    expect(recognizeInbound(system, SHOPIFY_STORE, RULES)).toMatchObject({
      channel: 'email',
      source: 'platform_notification',
    });
  });
});

describe('站点识别（R-ST-02，AC-TK-14）', () => {
  it('亚马逊按发件域：marketplace.amazon.com → US、.ca → CA、.com.mx → MX', () => {
    const siteOf = (address: string) =>
      recognizeInbound(mail({ from: { address, name: 'Buyer' } }), AMAZON_STORE, RULES).site;
    expect(siteOf('buyer@marketplace.amazon.com')).toBe('US');
    expect(siteOf('buyer@marketplace.amazon.ca')).toBe('CA');
    expect(siteOf('mateo.r.8k3p@marketplace.amazon.com.mx')).toBe('MX');
  });

  it('发件域不是亚马逊的取店铺默认站点（Shopify 按订单收件国家随待办 14）', () => {
    expect(recognizeInbound(contactForm(), SHOPIFY_MX_STORE, RULES).site).toBe('MX');
    expect(recognizeInbound(mail(), SHOPIFY_MX_STORE, RULES).site).toBe('MX');
  });

  it('只认这几个域本身，形似的域不算（amazon.com.example、notamazon.ca）', () => {
    const siteOf = (address: string) =>
      recognizeInbound(mail({ from: { address, name: '' } }), SHOPIFY_MX_STORE, RULES).site;
    expect(siteOf('x@marketplace.amazon.com.example')).toBe('MX');
    expect(siteOf('x@notamazon.ca')).toBe('MX');
  });
});

describe('来源规则匹配（规格 channel「来源识别」，PRD 1.4）', () => {
  const sourceOf = (facts: Partial<InboundMailFacts>, store: StoreFacts = SHOPIFY_STORE) =>
    recognizeInbound(mail(facts), store, RULES).source;

  it('没有命中任何规则 → 客户', () => {
    expect(sourceOf({})).toBe('customer');
  });

  it('平台通知：亚马逊通知的发件域（amazon.com / .ca / .com.mx）、Shopify 系统邮件（shopify.com）', () => {
    const from = (address: string) => ({ from: { address, name: '' } });
    expect(sourceOf(from('seller-notification@amazon.com'), AMAZON_STORE)).toBe(
      'platform_notification',
    );
    expect(sourceOf(from('donotreply@amazon.ca'), AMAZON_STORE)).toBe('platform_notification');
    expect(sourceOf(from('no-reply@amazon.com.mx'), AMAZON_STORE)).toBe('platform_notification');
    expect(sourceOf(from('no-reply@shopify.com'))).toBe('platform_notification');
  });

  it('发件域按「精确等于」匹配：买家消息中转域 marketplace.amazon.com / .ca / .com.mx 不会被平台通知规则归档（协调者 10-05）', () => {
    for (const domain of [
      'marketplace.amazon.com',
      'marketplace.amazon.ca',
      'marketplace.amazon.com.mx',
    ]) {
      const relayed = { from: { address: `buyer.9x2k@${domain}`, name: 'Buyer' } };
      expect(sourceOf(relayed, AMAZON_STORE)).toBe('customer');
      // 即使落到 Shopify 店铺的邮箱（按邮件），也不归档
      expect(sourceOf(relayed, SHOPIFY_STORE)).toBe('customer');
    }
    // 子域与形似的域都不命中
    expect(sourceOf({ from: { address: 'x@mail.shopify.com', name: '' } })).toBe('customer');
    expect(sourceOf({ from: { address: 'x@notshopify.com', name: '' } })).toBe('customer');
  });

  it('生产厂：已登记生产厂邮箱（精确地址，不分大小写）', () => {
    expect(sourceOf({ from: { address: 'QC@fqd-forcome.com', name: 'FQD 品质部' } })).toBe(
      'producer',
    );
    expect(sourceOf({ from: { address: 'service@fzj-forcome.com', name: '' } })).toBe('producer');
    // 同一个域的其他地址没有登记，不算生产厂
    expect(sourceOf({ from: { address: 'sales@fqd-forcome.com', name: '' } })).toBe('customer');
  });

  it('其他供应商：按发件域登记的供应商', () => {
    expect(sourceOf({ from: { address: 'ops@eccang.example', name: '' } })).toBe('other_supplier');
  });

  it('营销：带 List-Unsubscribe 头；或 Precedence 为 bulk / list / junk（值不分大小写）', () => {
    expect(
      sourceOf({ headers: [{ key: 'list-unsubscribe', value: '<mailto:unsub@news.example>' }] }),
    ).toBe('marketing');
    for (const value of ['bulk', 'List', ' JUNK ']) {
      expect(sourceOf({ headers: [{ key: 'precedence', value }] })).toBe('marketing');
    }
    // 别的 Precedence 值（如客户邮箱的自动回复）不算营销
    expect(sourceOf({ headers: [{ key: 'precedence', value: 'auto_reply' }] })).toBe('customer');
  });

  it('头字段名不分大小写', () => {
    expect(
      sourceOf({ headers: [{ key: 'List-Unsubscribe', value: '<https://x.example/u>' }] }),
    ).toBe('marketing');
  });

  it('头部规则只看直邮：亚马逊中转与 Shopify 联系表单的头是平台加的，不据此判营销', () => {
    const listHeader = [{ key: 'list-unsubscribe', value: '<mailto:u@amazon.com>' }];
    expect(
      recognizeInbound(
        mail({
          from: { address: 'buyer@marketplace.amazon.com', name: 'Buyer' },
          headers: listHeader,
        }),
        AMAZON_STORE,
        RULES,
      ).source,
    ).toBe('customer');
    expect(
      recognizeInbound(contactForm({ headers: listHeader }), SHOPIFY_STORE, RULES).source,
    ).toBe('customer');
  });

  it('联系表单按填表人判来源：生产厂用登记的邮箱填表，来源是生产厂', () => {
    const form = contactForm({ replyTo: [{ address: 'qc@fqd-forcome.com', name: '' }] });
    expect(recognizeInbound(form, SHOPIFY_STORE, RULES)).toMatchObject({
      channel: 'shopify',
      source: 'producer',
    });
  });

  it('优先级：精确地址 > 发件域 > 头（协调者 10-05）——登记的生产厂邮箱发来带 List-Unsubscribe 的信仍是生产厂', () => {
    const rules: SenderRule[] = [
      ...RULES,
      { kind: 'domain', pattern: 'fqd-forcome.com', headerValue: null, source: 'other_supplier' },
    ];
    const facts = mail({
      from: { address: 'qc@fqd-forcome.com', name: '' },
      headers: [{ key: 'list-unsubscribe', value: '<mailto:u@fqd-forcome.com>' }],
    });
    expect(recognizeInbound(facts, SHOPIFY_STORE, rules).source).toBe('producer');
    // 没有地址规则时发件域优先于头
    const domainOnly = mail({
      from: { address: 'sales@fqd-forcome.com', name: '' },
      headers: facts.headers,
    });
    expect(recognizeInbound(domainOnly, SHOPIFY_STORE, rules).source).toBe('other_supplier');
  });

  it('同一层级命中几条时，留下来建工单的优先：生产厂 > 其他供应商 > 平台通知 > 营销', () => {
    const rules: SenderRule[] = [
      { kind: 'header', pattern: 'x-mailer-kind', headerValue: null, source: 'marketing' },
      { kind: 'header', pattern: 'x-mailer-kind', headerValue: null, source: 'other_supplier' },
      {
        kind: 'header',
        pattern: 'x-mailer-kind',
        headerValue: null,
        source: 'platform_notification',
      },
    ];
    const facts = mail({ headers: [{ key: 'x-mailer-kind', value: 'notice' }] });
    expect(recognizeInbound(facts, SHOPIFY_STORE, rules).source).toBe('other_supplier');
  });

  it('没有发件地址的来信不命中地址与发件域规则，按客户（归并时再因没有客户身份跳过）', () => {
    const facts = mail({ from: { address: '', name: '' } });
    expect(recognizeInbound(facts, SHOPIFY_STORE, RULES)).toMatchObject({
      channel: 'email',
      source: 'customer',
      sender: { address: '', name: '' },
    });
  });
});
