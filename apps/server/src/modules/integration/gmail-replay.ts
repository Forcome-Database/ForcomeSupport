import type { DemoFixture } from '@forcome/fixtures';
import type { FakeMailInput } from './gmail-mime';

/*
 * 示例数据夹具 → Fake Gmail 的来信（开发测试环境、本机开发与 Playwright 的 worker 启动时回放，ADR 0009 修订）。
 * 待办 08 只回放来信：每张示例工单一封（到达时间取「最近来信」，正文是主题，有订单号的另起一行写订单号）；
 * P05 时间线那张工单（P1_OLIVER）按时间线里的各封来信回放。我方回复、标记无需回复与关闭随 09、16、17 补上。
 * 夹具里没有客户邮箱：亚马逊来信用按站点的买家消息中转域名、其余用 example.com，地址由客户名推出（只是 Fake 数据）；
 * 夹具写明发件地址的（如生产厂来信）照用。Message-ID 与 Gmail 消息 ID 由工单号推出，重启后回放的是同样的信。
 */

const AMAZON_RELAY: Record<string, string> = {
  US: 'marketplace.amazon.com',
  CA: 'marketplace.amazon.ca',
  MX: 'marketplace.amazon.com.mx',
};

/** 客户名 → 邮箱地址的本地部分：去掉重音、转小写、非字母数字换成点（Sofía Márquez → sofia.marquez） */
function localPart(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

export function fixtureMails(fixture: DemoFixture): FakeMailInput[] {
  const mailboxOf = new Map(fixture.stores.map((s) => [s.key, s.mailbox]));
  const timeline = fixture.ticketTimeline;
  return fixture.tickets.flatMap((ticket) => {
    const mailbox = mailboxOf.get(ticket.storeKey);
    if (!mailbox) throw new Error(`示例工单 ${ticket.no} 的店铺 ${ticket.storeKey} 不在夹具里`);
    const domain = ticket.channel === '亚马逊' ? AMAZON_RELAY[ticket.site] : 'example.com';
    const from = {
      name: ticket.customer,
      address: ticket.from ?? `${localPart(ticket.customer)}@${domain}`,
    };
    const letters =
      ticket.no === timeline.ticket
        ? timeline.entries
            .filter((e) => e.direction === 'inbound')
            .map((e) => ({ at: e.at, text: e.body }))
        : [
            {
              at: ticket.lastInboundAt,
              text: ticket.order ? `${ticket.subject}\n\nOrder: ${ticket.order}` : ticket.subject,
            },
          ];
    return letters.map((letter, index) => ({
      to: mailbox,
      from,
      subject: index === 0 ? ticket.subject : `Re: ${ticket.subject}`,
      text: letter.text,
      at: letter.at,
      messageId: `<${ticket.no}.${index + 1}@demo.forcome.invalid>`,
      gmailId: `demo-${ticket.no}-${index + 1}`,
    }));
  });
}
