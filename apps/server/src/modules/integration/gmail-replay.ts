import { amazonDomains, SHOPIFY_CONTACT_FORM_SENDER } from '@forcome/contracts';
import type { DemoFixture } from '@forcome/fixtures';
import { fixtureCustomerAddress } from './fixture-customers';
import type { FakeMailInput } from './gmail-mime';

/*
 * 示例数据夹具 → Fake Gmail 的来信（开发测试环境、本机开发与 Playwright 的 worker 启动时回放，ADR 0009 修订）。
 * 待办 08 只回放来信：每张示例工单一封（到达时间取「最近来信」，正文是主题，有订单号的另起一行写订单号）；
 * P05 时间线那张工单（P1_OLIVER）按时间线里的各封来信回放，每封同样另起一行写订单号（14 按订单归并）。我方回复、标记无需回复与关闭随 09、16、17 补上。
 * 夹具里没有客户邮箱：亚马逊来信用按站点的买家消息中转域名、其余用 example.com，地址由客户名推出（fixture-customers.ts，
 * 与 Fake Shopify 订单上的邮箱一致）；
 * 夹具写明发件地址的（如生产厂来信）照用。渠道为 Shopify 的来信做成 Shopify 联系表单通知的样子（R-TK-08，待办 10）：
 * mailer@shopify.com 代发、Reply-To 是客户邮箱、正文是表单各栏；主题沿用原型的主题（真实通知的主题是 Shopify 的固定写法）。
 * Message-ID 与 Gmail 消息 ID 由工单号推出，重启后回放的是同样的信。
 */

/** Shopify 联系表单通知的正文（默认模板的各栏） */
function contactFormText(customer: { name: string; address: string }, site: string, body: string) {
  return [
    "You received a new message from your online store's contact form.",
    `Country Code: ${site}`,
    `Name: ${customer.name}`,
    `Email: ${customer.address}`,
    'Phone Number:',
    'Body:',
    body,
  ].join('\n');
}

export function fixtureMails(fixture: DemoFixture): FakeMailInput[] {
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
    // 有订单号的另起一行写订单号（亚马逊买家消息的真实正文同样带订单号）；P05 时间线那张的每封来信都写，按订单归并到同一张（14）
    const withOrder = (text: string) => (ticket.order ? `${text}\n\nOrder: ${ticket.order}` : text);
    const letters =
      ticket.no === timeline.ticket
        ? timeline.entries
            .filter((e) => e.direction === 'inbound')
            .map((e) => ({ at: e.at, text: withOrder(e.body) }))
        : [{ at: ticket.lastInboundAt, text: withOrder(ticket.subject) }];
    const contactForm = ticket.channel === 'Shopify';
    return letters.map((letter, index) => ({
      to: store.mailbox,
      ...(contactForm
        ? {
            from: { name: store.name, address: SHOPIFY_CONTACT_FORM_SENDER },
            headers: { 'Reply-To': from.address },
            text: contactFormText(from, ticket.site, letter.text),
          }
        : { from, text: letter.text }),
      subject: index === 0 ? ticket.subject : `Re: ${ticket.subject}`,
      at: letter.at,
      messageId: `<${ticket.no}.${index + 1}@demo.forcome.invalid>`,
      gmailId: `demo-${ticket.no}-${index + 1}`,
    }));
  });
}
