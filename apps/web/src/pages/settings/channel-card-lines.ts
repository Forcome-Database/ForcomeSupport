import type { ChannelCard, Store } from '@forcome/contracts';
import type { BadgeTone } from '@/components/ui/badge';
import { formatClock } from '@/lib/channel';
import {
  AMAZON_ISSUE_LINES,
  CARD_LINES,
  CHANNEL_CARDS,
  DINGTALK_ISSUE_LINES,
  GMAIL_ISSUE_LINES,
  ORDER_BACKFILL_LINE,
  SHOPIFY_ISSUE_LINES,
} from './p18-copy';

/*
 * 渠道卡的说明行（K20 与补充小样，待办 09）：
 * - 亚马逊（待办 12）与 Shopify（待办 11）：写法同 Gmail，按店铺——有连接异常的店铺时，每个异常的店铺一行原因与恢复指引，
 *   再写一次订单暂停同步，同步延迟的店铺排在后面；只有同步延迟时，每个延迟的店铺一行，其余说明行照常；
 *   订单回补行（待办 13）带状态标签，文字与标签由本文件的 orderBackfillLine 给出，画在 channel-cards.tsx 的 OrderBackfillRow；
 *   亚马逊卡的「订单通知队列（SQS）」一行带状态标签，不在这里（channel-cards.tsx 的 OrderQueueLine），各状态下都照写；
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

const ORDER_ISSUE_LINES = { amazon: AMAZON_ISSUE_LINES, shopify: SHOPIFY_ISSUE_LINES } as const;

/** 订单渠道卡（亚马逊、Shopify）的说明行：按店铺列出异常与延迟 */
function ordersLines(
  kind: 'amazon' | 'shopify',
  card: ChannelCard,
  stores: readonly Store[],
): string[] {
  const words = ORDER_ISSUE_LINES[kind];
  const failed = card.issues.filter((issue) => issue.status === 'error');
  const delayed = card.issues
    .filter((issue) => issue.status === 'delayed')
    .map((issue) => words.delayed(issue.target, clockOf(issue.lastSuccessAt)));
  if (failed.length > 0) {
    return [
      ...failed.map((issue) =>
        words.failed(issue.target, clockOf(issue.failingSince), issue.failures),
      ),
      words.held,
      ...delayed,
    ];
  }
  return [...delayed, ...storeLines(kind, stores)];
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
    case 'shopify':
      return ordersLines(card.kind, card, stores);
    case 'gmail':
      return gmailLines(card, stores);
    case 'dingtalk':
      return dingtalkLines(card);
  }
}

/** 订单回补行：左边「订单回补 N 天」，右边的标签（文字、色调、要不要勾） */
export interface OrderBackfillLine {
  readonly label: string;
  readonly badge: { readonly text: string; readonly tone: BadgeTone; readonly check: boolean };
}

/**
 * 亚马逊、Shopify 卡的订单回补行（K20 补充小样，待办 13，协调者 2026-10-06 决定 Q2）：只在两种情况不显示——该平台没有连接上的店铺
 * （后端只汇总连接上的店铺，这时给 null）；卡片连接异常（原型连接异常的卡没有这一行）。同步延迟照写；部分店铺未连接、卡片最差状态为
 * 未连接时也照写（上线前逐个店铺录凭据、边录边回补，正是要看进度的时候）。Shopify 只回补了 60 天（没开通 read_all_orders）
 * 的，回补完成后写「未开通 read_all_orders」
 */
export function orderBackfillLine(card: ChannelCard): OrderBackfillLine | null {
  const backfill = card.backfill;
  if (!backfill || card.status === 'error') return null;
  const label = ORDER_BACKFILL_LINE.label(backfill.days);
  switch (backfill.state) {
    case 'not_started':
      return {
        label,
        badge: { text: ORDER_BACKFILL_LINE.notStarted, tone: 'muted', check: false },
      };
    case 'running':
      return {
        label,
        badge: { text: ORDER_BACKFILL_LINE.running(backfill.orders), tone: 'info', check: false },
      };
    case 'completed':
      return backfill.historyLimited
        ? {
            label,
            badge: { text: ORDER_BACKFILL_LINE.historyLimited, tone: 'warning', check: false },
          }
        : { label, badge: { text: ORDER_BACKFILL_LINE.completed, tone: 'success', check: true } };
  }
}

/**
 * Gmail 卡有连接异常的邮箱、Shopify 与亚马逊卡有连接异常的店铺时，卡底给「重新检测」（K7、K20 补充小样；立即重测并补拉）。
 * 只是订单通知队列拉取失败不算（Q7：只影响 SQS 那一行）
 */
export function needsRecheck(card: ChannelCard): boolean {
  return card.kind !== 'dingtalk' && card.issues.some((issue) => issue.status === 'error');
}
