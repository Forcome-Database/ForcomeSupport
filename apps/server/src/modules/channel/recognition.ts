import {
  amazonDomains,
  domainOf,
  isAmazonDomain,
  isTicketSource,
  recipientHeaders,
  SHOPIFY_CONTACT_FORM_SENDER,
  sites,
  type MessageSource,
  type Platform,
  type Recipient,
  type Site,
  type TicketChannel,
} from '@forcome/contracts';
import { addressParser, decodeWords, type Address } from 'postal-mime';

/*
 * 来信的渠道、站点、来源识别（规格 channel「渠道识别」「来源识别」「店铺与站点识别」，PRD R-TK-08、R-ST-02、
 * 1.4「来源」，待办 10）。纯函数：输入一封来信的发件人、Reply-To、正文与头字段，收到它的店铺，来源规则表；
 * 输出渠道、站点、来源与客户渠道身份。店铺按收件邮箱识别（gmail-sync.ts），不在这里。
 *
 * 0. 店铺（R-ST-02、E-13，待办 15）：按收件地址——Delivered-To、To、Cc 依次（recipientsOf），第一个登记为进线邮箱的地址所属的店铺
 *    （storeOfRecipients）；都没登记即未归属店铺，进队列，平台暂按发件域定（provisionalStore，E-13），指定店铺或自动归位后按所归店铺重新识别。
 * 1. 渠道与客户渠道身份（R-TK-08）：
 *    - 亚马逊店铺邮箱收到亚马逊买家消息中转来信（发件域 marketplace.amazon.com / .ca / .com.mx）→ 亚马逊，身份是中转地址；
 *    - Shopify 店铺邮箱收到 Shopify 联系表单通知（mailer@shopify.com 代发，能找到填表客户的邮箱）→ Shopify，
 *      身份取表单的回复邮箱：先看 Reply-To（只留电话的客户 Reply-To 是 no-reply@shopify.com，不算），再看正文的 Email 栏；
 *      找不到客户邮箱的按 Shopify 系统邮件处理（归档，协调者 10-05 决定）；
 *    - 其余 → 邮件（直邮），身份是发件地址。
 * 2. 站点（R-ST-02）：亚马逊店铺按发件域（From）定站点，发件域不是亚马逊的域时取店铺默认站点；
 *    Shopify 店铺取店铺默认站点（按订单收件国家随 14）。
 * 3. 来源：按来源规则表匹配（见 sourceOf），没有命中为客户。
 */

/** 来源规则的匹配方式：精确地址 · 发件域（精确等于，不含子域）· 头字段 */
export const senderRuleKinds = ['address', 'domain', 'header'] as const;
export type SenderRuleKind = (typeof senderRuleKinds)[number];

/** 规则能判出的来源：除客户以外的四种（没有命中任何规则即客户），按同一层级命中几条时的优先顺序排列 */
export const ruleSources = [
  'producer',
  'other_supplier',
  'platform_notification',
  'marketing',
] as const satisfies readonly Exclude<MessageSource, 'customer'>[];
export type RuleSource = (typeof ruleSources)[number];

/** 来源规则表的一行（channel.sender_rule；种子见迁移 0009，生产厂邮箱另由示例数据或后续迁移登记） */
export interface SenderRule {
  readonly kind: SenderRuleKind;
  /** address：完整地址；domain：发件域；header：头字段名。一律小写 */
  readonly pattern: string;
  /** 只用于 header：头的值（去首尾空白、不分大小写后相等才算命中）；为空时有这个头就算命中 */
  readonly headerValue: string | null;
  readonly source: RuleSource;
}

export interface MailAddress {
  readonly address: string;
  readonly name: string;
}

/** 识别要用的来信内容（解析后的邮件） */
export interface InboundMailFacts {
  readonly from: MailAddress;
  readonly replyTo: readonly MailAddress[];
  /** 纯文本正文 */
  readonly text: string | null;
  /** 全部头字段，按出现顺序 */
  readonly headers: readonly { readonly key: string; readonly value: string }[];
}

/** 收到这封信的店铺 */
export interface StoreFacts {
  readonly platform: Platform;
  readonly defaultSite: Site;
}

export interface Recognition {
  readonly channel: TicketChannel;
  readonly site: Site;
  readonly source: MessageSource;
  /**
   * 实际发信人，即客户渠道身份（地址小写）：亚马逊中转地址、Shopify 联系表单的回复邮箱，其余为发件地址（From）。
   * ticket 按它建客户与归并
   */
  readonly sender: MailAddress;
}

/** 亚马逊的域 → 站点（R-ST-02「按发件域 amazon.com / .ca / .com.mx」）：平台通知的站点域与买家消息中转域，都精确等于 */
const AMAZON_SITE_BY_DOMAIN: ReadonlyMap<string, Site> = new Map(
  sites.flatMap((site) => [
    [amazonDomains[site].site, site],
    [amazonDomains[site].relay, site],
  ]),
);

/** 亚马逊买家消息的中转域（买家来信经它转到店铺绑定的邮箱，PRD 1.4「买家消息邮件中转」） */
const AMAZON_RELAY_DOMAINS: ReadonlySet<string> = new Set(
  sites.map((site) => amazonDomains[site].relay),
);

/** Shopify 自己的地址（不是填表客户）：只留电话的客户，通知的 Reply-To 是 no-reply@shopify.com */
const SHOPIFY_OWN_ADDRESSES: ReadonlySet<string> = new Set([
  'no-reply@shopify.com',
  SHOPIFY_CONTACT_FORM_SENDER,
]);

function normalized(mailbox: MailAddress): MailAddress {
  return { address: mailbox.address.trim().toLowerCase(), name: mailbox.name.trim() };
}

/** 联系表单正文里的一栏（「Name: Emily Chen」「Email: emily@…」），没有为 null */
function formField(text: string | null, label: string): string | null {
  const match = text?.match(new RegExp(`^[ \\t]*${label}[ \\t]*:[ \\t]*(\\S.*?)[ \\t]*$`, 'im'));
  return match?.[1] ?? null;
}

/** 联系表单通知里的填表客户：Reply-To（Shopify 自己的地址除外）优先，其次正文的 Email 栏；都没有就不是联系表单 */
function contactFormCustomer(mail: InboundMailFacts): MailAddress | null {
  const replyTo = mail.replyTo
    .map(normalized)
    .find((r) => r.address.includes('@') && !SHOPIFY_OWN_ADDRESSES.has(r.address));
  const formEmail = formField(mail.text, 'Email')?.toLowerCase();
  const address = replyTo?.address ?? (formEmail?.includes('@') ? formEmail : null);
  if (!address) return null;
  return { address, name: replyTo?.name || formField(mail.text, 'Name') || '' };
}

/** 渠道与客户渠道身份（R-TK-08）；relayed 表示经平台中转（亚马逊买家消息、Shopify 联系表单） */
function channelOf(
  from: MailAddress,
  mail: InboundMailFacts,
  store: StoreFacts,
): { channel: TicketChannel; sender: MailAddress; relayed: boolean } {
  if (store.platform === 'amazon' && AMAZON_RELAY_DOMAINS.has(domainOf(from.address))) {
    return { channel: 'amazon', sender: from, relayed: true };
  }
  if (store.platform === 'shopify' && from.address === SHOPIFY_CONTACT_FORM_SENDER) {
    const customer = contactFormCustomer(mail);
    if (customer) return { channel: 'shopify', sender: customer, relayed: true };
  }
  return { channel: 'email', sender: from, relayed: false };
}

/** 站点（R-ST-02）：亚马逊店铺按发件域，其余取店铺默认站点 */
function siteOf(from: MailAddress, store: StoreFacts): Site {
  if (store.platform !== 'amazon') return store.defaultSite;
  return AMAZON_SITE_BY_DOMAIN.get(domainOf(from.address)) ?? store.defaultSite;
}

const KIND_RANK: Record<SenderRuleKind, number> = { address: 0, domain: 1, header: 2 };
const sourceRank = (source: RuleSource) => ruleSources.indexOf(source);

function matches(rule: SenderRule, sender: string, headers: InboundMailFacts['headers']): boolean {
  switch (rule.kind) {
    case 'address':
      return sender !== '' && rule.pattern === sender;
    case 'domain':
      // 精确等于：amazon.com 不命中 marketplace.amazon.com（买家消息中转），也不命中其他子域（协调者 10-05）
      return sender !== '' && rule.pattern === domainOf(sender);
    case 'header':
      return headers.some(
        (h) =>
          h.key.toLowerCase() === rule.pattern &&
          (rule.headerValue === null || h.value.trim().toLowerCase() === rule.headerValue),
      );
  }
}

/**
 * 来源：按规则表匹配，没有命中为客户。
 * - 直邮：全部规则都适用，地址与发件域规则看发件地址；
 * - 经平台中转的来信（亚马逊买家消息、Shopify 联系表单）是客户经平台写来的：只适用按客户渠道身份登记的
 *   「生产厂」「其他供应商」地址与发件域规则，不套用「平台通知」「营销」规则，头字段规则也不看（头是平台加的）——
 *   例如客户用 @amazon.com 邮箱填联系表单照常建工单（协调者 10-05 决定）；
 * - 优先级：精确地址 > 发件域 > 头（协调者 10-05）；同一层级命中几条时按 ruleSources 的顺序：
 *   生产厂 > 其他供应商 > 平台通知 > 营销（规则冲突时宁可多一张工单，不悄悄归档）。
 */
function sourceOf(
  sender: string,
  headers: InboundMailFacts['headers'],
  rules: readonly SenderRule[],
  relayed: boolean,
): MessageSource {
  const applicable = relayed
    ? rules.filter((rule) => rule.kind !== 'header' && isTicketSource(rule.source))
    : rules;
  const hit = applicable
    .filter((rule) => matches(rule, sender, headers))
    .sort(
      (a, b) =>
        KIND_RANK[a.kind] - KIND_RANK[b.kind] || sourceRank(a.source) - sourceRank(b.source),
    )[0];
  return hit?.source ?? 'customer';
}

// ---------------------------------------------------------------- 店铺（按收件地址）

type Headers = InboundMailFacts['headers'];

function flatten(list: readonly Address[]): MailAddress[] {
  return list
    .flatMap((a) => ('group' in a && a.group ? a.group : [a]))
    .map((m) => ({
      address: m.address.trim().toLowerCase(),
      name: decodeWords(m.name).trim(),
    }));
}

/** 某个头字段（可能出现几次，按出现顺序）里的全部地址，含地址组的成员；解析不出地址的跳过 */
export function addressesInHeader(headers: Headers, key: string): MailAddress[] {
  return headers
    .filter((h) => h.key.toLowerCase() === key)
    .flatMap((h) => flatten(addressParser(h.value)))
    .filter((m) => m.address.includes('@'));
}

/**
 * 一封来信的收件地址（店铺识别的依据）：Delivered-To（Gmail 写实际投递到的地址，在最上面；转进来的信可能没有）、To、Cc 依次，
 * 去重、小写，各记取自哪个头字段。landingMailbox 是信落到的同步邮箱：Delivered-To 里它自己不算——Gmail 可能把同步的邮箱本身写进去，
 * 寄到它的别名、群组或转发地址的信就会被当成写给它的（To、Cc 里写的仍然算：客户直接写给店铺邮箱）
 */
export function recipientsOf(headers: Headers, landingMailbox?: string): Recipient[] {
  const landing = landingMailbox?.trim().toLowerCase();
  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const header of recipientHeaders) {
    for (const { address } of addressesInHeader(headers, header)) {
      if (header === 'delivered-to' && address === landing) continue;
      if (seen.has(address)) continue;
      seen.add(address);
      out.push({ header, address });
    }
  }
  return out;
}

/**
 * 按收件地址识别店铺（R-ST-02「按收件邮箱识别店铺」）：第一个登记为进线邮箱（含别名）的收件地址所属的店铺；
 * 都没登记为 null（未归属店铺，E-13）。mailboxes 是全部进线邮箱（地址小写）→ 店铺
 */
export function storeOfRecipients<T>(
  recipients: readonly Recipient[],
  mailboxes: ReadonlyMap<string, T>,
): { readonly store: T; readonly address: string } | null {
  for (const { address } of recipients) {
    const store = mailboxes.get(address);
    if (store !== undefined) return { store, address };
  }
  return null;
}

/**
 * 未归属来信识别渠道与来源时暂用的店铺（E-13「平台按发件域判断」）：发件域是亚马逊的域按亚马逊店铺（买家消息中转为亚马逊渠道），
 * 其余按 Shopify 店铺（mailer@shopify.com 代发的联系表单认得出客户、找不到客户的按 Shopify 系统邮件归档；其余为邮件）。
 * 站点要等有了店铺再定，不用这里的默认站点
 */
export function provisionalStore(from: MailAddress): StoreFacts {
  return {
    platform: isAmazonDomain(domainOf(from.address)) ? 'amazon' : 'shopify',
    defaultSite: 'US',
  };
}

// ---------------------------------------------------------------- 渠道、站点、来源

/** 识别一封来信的渠道、站点、来源与客户渠道身份 */
export function recognizeInbound(
  mail: InboundMailFacts,
  store: StoreFacts,
  rules: readonly SenderRule[],
): Recognition {
  const from = normalized(mail.from);
  const { channel, sender, relayed } = channelOf(from, mail, store);
  return {
    channel,
    site: siteOf(from, store),
    source: sourceOf(sender.address, mail.headers, rules, relayed),
    sender,
  };
}
