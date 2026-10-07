import {
  amazonDomains,
  roleByLabel,
  SHOPIFY_CONTACT_FORM_SENDER,
  type Role,
} from '@forcome/contracts';
import type { DemoFixture, FixtureTicket } from '@forcome/fixtures';
import { fixtureCustomerAddress } from './fixture-customers';
import type { FakeMailInput } from './gmail-mime';

/*
 * 示例数据夹具 → Fake Gmail 的邮件（开发测试环境、本机开发与 Playwright 的 worker 启动时回放，ADR 0009 修订）。
 * 来信（待办 08）：每张示例工单一封（到达时间取「最近来信」，留言是主题，直邮的两张取夹具的正文）；P05 时间线那张工单（P1_OLIVER）按时间线里的各封来信回放。
 * 有订单号的照平台的写法带上（14 按订单归并要用；P05 只显示留言，待办 17）：亚马逊买家消息把留言夹在「Begin message」「End message」
 * 两行之间、后面写「Order ID」，Shopify 联系表单多一栏「Order number」，直邮在留言后另起一行写订单号。
 * 我方回复（「已发送」，待办 16）：店铺邮箱发出，In-Reply-To 指向它回复的来信、References 列出之前的来信、同一个 Gmail 线程——
 * - P05 时间线那张按时间线里的我方回复；
 * - 等客户、因「客户未回复」关闭的示例工单，在最后一封来信 10 分钟后回复它（原型没画回复时刻；演示时刻 09-11 10:20 之前都已回复，
 *   P04 显示「已回复」，客户未回复的那张 7 天后按时关闭）；
 * - 那张生产厂工单的来信 1 分钟后有一封自动回复（I18 的 P1_AUTO_REPLY，带 Auto-Submitted，不算回复）。
 * 标记无需回复（已解决的两张，待办 17）：不是邮件，由 ticket 在这封来信归并后以标记人的身份标记（fixtureNoReplyMarks 给出是哪封信、谁、
 *   到达后多久，jobs.ts 注入 ticket）。
 * 未归属店铺来信（I17，待办 15）：data.py 的 UNASSIGNED_MAIL 两封，落在同步的店铺邮箱里，收件地址是没登记的别名或转发地址
 * （Tom Harris 的 Delivered-To 与 To 都是 amz-ca2@forcome.com；Lucía Herrera 只有 To: info@forcome.mx），进未归属店铺队列。
 * 夹具里没有客户邮箱：亚马逊来信用按站点的买家消息中转域名、其余用 example.com，地址由客户名推出（fixture-customers.ts，
 * 与 Fake Shopify 订单上的邮箱一致）；夹具写明发件地址的（如生产厂来信）照用。渠道为 Shopify 的来信做成 Shopify 联系表单通知的
 * 样子（R-TK-08，待办 10）：mailer@shopify.com 代发、Reply-To 是客户邮箱、正文是表单各栏；主题沿用原型的主题。
 * Message-ID 与 Gmail 消息 ID 由工单号推出，重启后回放的是同样的信（按「邮箱 + Gmail 消息 ID」去重，不会重复入库）。
 * 时间按夹具写（9 月的演示时刻）；回放时由 Fake Gmail 整天平移到当前日期（见 gmail.ts 的 replay）。
 */

/** 回放的一封邮件：寄到店铺邮箱的来信，或店铺邮箱「已发送」里的我方邮件（mail.from 是店铺邮箱，mail.to 是客户） */
export interface ReplayMail {
  readonly mailbox: string;
  readonly sent: boolean;
  readonly mail: FakeMailInput;
}

/** 等客户与客户未回复的示例工单，我方在最后一封来信之后多久回复 */
const REPLY_AFTER_MS = 10 * 60_000;

/** Shopify 联系表单通知的正文（默认模板的各栏；店铺在表单里加了订单号一栏，有订单号的写上） */
function contactFormText(
  customer: { name: string; address: string },
  site: string,
  body: string,
  order: string | null,
) {
  return [
    "You received a new message from your online store's contact form.",
    `Country Code: ${site}`,
    `Name: ${customer.name}`,
    `Email: ${customer.address}`,
    'Phone Number:',
    ...(order ? [`Order number: ${order}`] : []),
    'Body:',
    body,
  ].join('\n');
}

/** 亚马逊买家消息的正文：留言夹在「Begin message」「End message」两行之间，后面是订单号（真实写法待办 29 核对） */
function amazonRelayText(body: string, order: string | null) {
  return [
    '------------- Begin message -------------',
    '',
    body,
    '',
    '------------- End message -------------',
    ...(order ? ['', `Order ID: ${order}`] : []),
  ].join('\n');
}

const messageIdOf = (ticket: string, part: string) => `<${ticket}.${part}@demo.forcome.invalid>`;

/** 示例工单里我方回复了客户（P04 写「已回复」）：等客户，与因「客户未回复」关闭的 */
function repliedOf(ticket: FixtureTicket): boolean {
  return ticket.status === '等客户' || ticket.closeReason === '客户未回复';
}

/** 未归属店铺来信：落在 mailbox 里，收件地址 to 没登记；识别依据是 Delivered-To 时这个头写 to，是 To 时信里没有 Delivered-To */
function unassignedMails(fixture: DemoFixture): ReplayMail[] {
  return fixture.unassignedMail.map((m, index) => ({
    mailbox: m.mailbox,
    sent: false,
    mail: {
      to: m.to,
      mailbox: m.mailbox,
      deliveredTo: m.toHeader === 'Delivered-To' ? m.to : null,
      from: { name: m.customer, address: fixtureCustomerAddress(m.customer, m.fromDomain) },
      subject: m.subject,
      text: m.subject,
      at: m.at,
      messageId: `<unassigned-${index + 1}@demo.forcome.invalid>`,
      gmailId: `demo-unassigned-${index + 1}`,
    },
  }));
}

/** 示例数据里被「标记无需回复」的一封来信（待办 17）：回放时它的 Message-ID、标记人与标记在来信到达之后多久（整天平移时跟着平移） */
export interface ReplayNoReplyMark {
  readonly messageId: string;
  readonly member: { readonly id: string; readonly name: string; readonly roles: readonly Role[] };
  readonly afterMs: number;
}

/** 被标记的示例来信：P05 时间线那张按时间线里的第几封来信，其余示例工单只回放一封来信（同 ticketMails 的编号） */
export function fixtureNoReplyMarks(fixture: DemoFixture): ReplayNoReplyMark[] {
  const timeline = fixture.ticketTimeline;
  return fixture.noReplyMarks.map((mark) => {
    const letters =
      mark.ticket === timeline.ticket
        ? timeline.entries.filter((e) => e.direction === 'inbound').map((e) => e.at)
        : fixture.tickets.filter((t) => t.no === mark.ticket).map((t) => t.lastInboundAt);
    const index = letters.findIndex((at) => Date.parse(at) === Date.parse(mark.inboundAt));
    const member = fixture.members.find((m) => m.key === mark.byKey);
    const role = member && roleByLabel(member.role);
    if (index < 0 || !member || !role) {
      throw new Error(`示例数据的标记无需回复找不到来信或标记人：${mark.ticket} ${mark.inboundAt}`);
    }
    return {
      messageId: messageIdOf(mark.ticket, String(index + 1)),
      member: { id: member.id, name: member.name, roles: [role] },
      afterMs: Date.parse(mark.at) - Date.parse(mark.inboundAt),
    };
  });
}

export function fixtureMails(fixture: DemoFixture): ReplayMail[] {
  return [...ticketMails(fixture), ...unassignedMails(fixture)];
}

function ticketMails(fixture: DemoFixture): ReplayMail[] {
  const storeOf = new Map(fixture.stores.map((s) => [s.key, s]));
  const timeline = fixture.ticketTimeline;
  return fixture.tickets.flatMap((ticket) => {
    const store = storeOf.get(ticket.storeKey);
    if (!store) throw new Error(`示例工单 ${ticket.no} 的店铺 ${ticket.storeKey} 不在夹具里`);
    const domain = ticket.channel === '亚马逊' ? amazonDomains[ticket.site].relay : 'example.com';
    const from = {
      name: ticket.customer,
      address: ticket.from ?? fixtureCustomerAddress(ticket.customer, domain),
    };
    // 来信的正文按渠道照平台的写法带上订单号（见文件头）；P05 时间线那张的每封来信都带，按订单归并到同一张（14）
    const letterText = (body: string) =>
      ticket.channel === '亚马逊'
        ? amazonRelayText(body, ticket.order)
        : ticket.order
          ? `${body}\n\nOrder: ${ticket.order}`
          : body;
    const entries =
      ticket.no === timeline.ticket
        ? timeline.entries.map((e) => ({ at: e.at, direction: e.direction, body: e.body }))
        : [
            {
              at: ticket.lastInboundAt,
              direction: 'inbound' as const,
              body: ticket.body ?? ticket.subject,
            },
            ...(repliedOf(ticket)
              ? [
                  {
                    at: new Date(new Date(ticket.lastInboundAt).getTime() + REPLY_AFTER_MS),
                    direction: 'outbound' as const,
                    body: `Hi ${ticket.customer.split(' ')[0]}, thanks for reaching out. We have looked into this — please see the steps below and let us know if anything is still not right.`,
                  },
                ]
              : []),
          ];
    const contactForm = ticket.channel === 'Shopify';
    // 一张工单的邮件在店铺邮箱里是同一个 Gmail 线程
    const threadId = `demo-${ticket.no}`;
    const letters: string[] = [];
    const mails: ReplayMail[] = [];
    /** 店铺邮箱「已发送」里的一封：回复到此为止的最后一封来信，References 列出之前的来信，同一线程 */
    const reply = (
      mailbox: string,
      part: string,
      at: string | Date,
      text: string,
      headers: Readonly<Record<string, string>> = {},
    ): ReplayMail => ({
      mailbox,
      sent: true,
      mail: {
        to: from.address,
        from: { address: mailbox },
        subject: `Re: ${ticket.subject}`,
        text,
        at,
        messageId: messageIdOf(ticket.no, part),
        headers: { ...headers, 'In-Reply-To': letters.at(-1)!, References: letters.join(' ') },
        gmailId: `demo-${ticket.no}-${part}`,
        threadId,
      },
    });
    for (const entry of entries) {
      if (entry.direction === 'inbound') {
        const index = letters.length + 1;
        const messageId = messageIdOf(ticket.no, String(index));
        mails.push({
          mailbox: store.mailbox,
          sent: false,
          mail: {
            to: store.mailbox,
            ...(contactForm
              ? {
                  from: { name: store.name, address: SHOPIFY_CONTACT_FORM_SENDER },
                  headers: { 'Reply-To': from.address },
                  text: contactFormText(from, ticket.site, entry.body, ticket.order),
                }
              : { from, text: letterText(entry.body) }),
            subject: index === 1 ? ticket.subject : `Re: ${ticket.subject}`,
            at: entry.at,
            messageId,
            gmailId: `demo-${ticket.no}-${index}`,
            threadId,
          },
        });
        letters.push(messageId);
      } else {
        const index = mails.filter((m) => m.sent).length + 1;
        mails.push(reply(store.mailbox, `r${index}`, entry.at, entry.body));
      }
    }
    // I18 的自动回复：我方邮箱对这张工单的来信自动回复，带 Auto-Submitted
    const auto = fixture.autoReply;
    if (auto.ticket === ticket.no) {
      mails.push(reply(auto.from, 'auto', auto.at, auto.body, auto.headers));
    }
    return mails;
  });
}
