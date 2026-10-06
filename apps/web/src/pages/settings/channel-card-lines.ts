import type { ChannelCard, Store } from '@forcome/contracts';
import { formatClock } from '@/lib/channel';
import {
  CARD_LINES,
  CHANNEL_CARDS,
  DINGTALK_ISSUE_LINES,
  GMAIL_ISSUE_LINES,
  SHOPIFY_ISSUE_LINES,
} from './p18-copy';

/*
 * 渠道卡的说明行（K20 与补充小样，待办 09）：
 * - 亚马逊：店铺数与同步方式（SQS 与回补行随 12、13）；
 * - Shopify（待办 11）：写法同 Gmail，按店铺——有连接异常的店铺时，每个异常的店铺一行原因与恢复指引，再写一次订单暂停同步，
 *   同步延迟的店铺排在后面；只有同步延迟时，每个延迟的店铺一行，其余说明行照常（回补窗口行随 13）；
 * - Gmail：都正常时写邮箱数与「已发送」；有连接异常的邮箱时，每个异常的邮箱一行原因与恢复指引（次数为实际的连续失败次数），
 *   再写一次来信暂存，同步延迟的邮箱排在后面；只有同步延迟时，每个延迟的邮箱一行，其余说明行照常；
 * - 钉钉：同步延迟与连接异常时第一行换成未同步成功的说明（从没同步成功过写「尚未同步成功」），其后两行固定。
 */

const EMPTY = '—';
const clockOf = (iso: string | null) => (iso ? formatClock(iso) : EMPTY);

function storeLines(kind: 'amazon' | 'shopify', stores: readonly Store[]): string[] {
  const count = stores.filter((s) => s.platform === kind).length;
  return [CHANNEL_CARDS[kind].stores(count)];
}

function shopifyLines(card: ChannelCard, stores: readonly Store[]): string[] {
  const failed = card.issues.filter((issue) => issue.status === 'error');
  const delayed = card.issues
    .filter((issue) => issue.status === 'delayed')
    .map((issue) => SHOPIFY_ISSUE_LINES.delayed(issue.target, clockOf(issue.lastSuccessAt)));
  if (failed.length > 0) {
    return [
      ...failed.map((issue) =>
        SHOPIFY_ISSUE_LINES.failed(issue.target, clockOf(issue.failingSince), issue.failures),
      ),
      SHOPIFY_ISSUE_LINES.held,
      ...delayed,
    ];
  }
  return [...delayed, ...storeLines('shopify', stores)];
}

function gmailLines(card: ChannelCard, stores: readonly Store[]): string[] {
  const mailboxCount = (platform: Store['platform']) =>
    stores.filter((s) => s.platform === platform).reduce((n, s) => n + s.mailboxes.length, 0);
  const failed = card.issues.filter((issue) => issue.status === 'error');
  const delayed = card.issues
    .filter((issue) => issue.status === 'delayed')
    .map((issue) => GMAIL_ISSUE_LINES.delayed(issue.target, clockOf(issue.lastSuccessAt)));
  if (failed.length > 0) {
    return [
      ...failed.map((issue) =>
        GMAIL_ISSUE_LINES.failed(issue.target, clockOf(issue.failingSince), issue.failures),
      ),
      GMAIL_ISSUE_LINES.held,
      ...delayed,
    ];
  }
  return [
    ...delayed,
    CHANNEL_CARDS.gmail.mailboxes(mailboxCount('amazon'), mailboxCount('shopify')),
    CARD_LINES.gmailSent,
  ];
}

function dingtalkLines(card: ChannelCard): string[] {
  if (card.status === 'delayed') {
    return [
      DINGTALK_ISSUE_LINES.delayed(clockOf(card.lastSyncAt)),
      DINGTALK_ISSUE_LINES.note,
      DINGTALK_ISSUE_LINES.tail,
    ];
  }
  if (card.status === 'error') {
    return [
      DINGTALK_ISSUE_LINES.failed(card.lastSyncAt ? formatClock(card.lastSyncAt) : null),
      DINGTALK_ISSUE_LINES.note,
      DINGTALK_ISSUE_LINES.tail,
    ];
  }
  return [...CARD_LINES.dingtalk];
}

/** 一张渠道卡的说明行（按数据与连接状态写） */
export function channelCardLines(card: ChannelCard, stores: readonly Store[]): string[] {
  switch (card.kind) {
    case 'amazon':
      return storeLines(card.kind, stores);
    case 'shopify':
      return shopifyLines(card, stores);
    case 'gmail':
      return gmailLines(card, stores);
    case 'dingtalk':
      return dingtalkLines(card);
  }
}

/** Gmail 卡有连接异常的邮箱、Shopify 卡有连接异常的店铺时，卡底给「重新检测」（K7、K20 补充小样；立即重测并补拉） */
export function needsRecheck(card: ChannelCard): boolean {
  return (
    (card.kind === 'gmail' || card.kind === 'shopify') &&
    card.issues.some((issue) => issue.status === 'error')
  );
}
