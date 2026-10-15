import {
  mailProviders,
  orderBackfillSummary,
  worstConnectionStatus,
  type AdapterMode,
  type MailProvider,
  type ChannelAlert,
  type ChannelCard,
  type ChannelIssue,
  type ConnectionStatus,
  type OrderQueue,
  type Platform,
  type StoreConnection,
} from '@forcome/contracts';
import type { DbExecutor } from '../core';
import {
  orderBackfills,
  orderQueueState,
  orderSyncHealths,
  orderSyncStatus,
  type OrderBackfill,
  type OrderSyncHealth,
} from '../order';
import { mailboxHealths, mailboxStatus, type MailboxHealth } from './mailbox-health';

/*
 * 渠道连接状态（PRD 6.9、K20、K7、G4）：按店铺计算，渠道卡显示该渠道下最差的状态并列出异常的邮箱，店铺表「状态」列显示该店铺各连接的状态。
 * - Gmail（待办 09）与 163 企业邮箱（待办 35，D-28）：按每个进线邮箱的同步记录（mailbox-health.ts）——连续 3 次失败为连接异常、
 *   从没成功过为未连接、超过 10 分钟没同步成功为同步延迟；店铺按服务商各一个连接、取其该服务商邮箱中最差的，Gmail 卡与 163 企业邮箱卡
 *   各取该服务商全部邮箱中最差的，最近同步时间取各邮箱中最旧的一次；
 * - Shopify（待办 11）与亚马逊（待办 12）：按每个店铺的订单同步记录（order 的 orderSyncHealths，按数据源）——口径同 Gmail
 *   （订单 10 分钟为同步延迟），卡片取该平台各店铺中最差的并列出延迟与异常的店铺（按店铺名），最近同步时间取各店铺中最旧的一次；
 *   亚马逊卡另有订单通知队列（SQS）一行（order 的 orderQueueState），只影响这一行，不进卡片与店铺的状态（待办 12 Q7）；
 *   两张卡另有订单回补一行（order 的 orderBackfills，按连接上的店铺汇总：contracts 的 orderBackfillSummary，待办 13）；
 * - 钉钉卡按通讯录的同步记录（org 的 dingtalkConnection，待办 05）。
 * 接模拟数据（Fake）时卡头另标「模拟数据」。连接异常的渠道（钉钉除外）出全站横幅（channelAlerts），几个渠道同时异常时各一条。
 */

/** 计算连接状态用到的店铺字段 */
export interface StoreConnectionSource {
  readonly id: string;
  readonly name: string;
  readonly platform: Platform;
  readonly adapterMode: AdapterMode;
  readonly mailboxes: readonly { readonly address: string; readonly provider: MailProvider }[];
}

/**
 * 计算连接状态的时刻与同步记录：全部进线邮箱（按地址）、各平台店铺的订单同步（按平台、再按店铺 ID）、订单通知队列（亚马逊卡的 SQS 行）
 */
export interface ConnectionSnapshot {
  readonly now: Date;
  readonly mailboxes: ReadonlyMap<string, MailboxHealth>;
  readonly orders: Readonly<Record<Platform, ReadonlyMap<string, OrderSyncHealth>>>;
  readonly orderQueue: OrderQueue;
  /** 各店铺的订单回补（还没开始过的店铺没有） */
  readonly backfills: ReadonlyMap<string, OrderBackfill>;
}

export async function loadConnections(db: DbExecutor, now: Date): Promise<ConnectionSnapshot> {
  const healths = await mailboxHealths(db);
  return {
    now,
    mailboxes: new Map(healths.map((health) => [health.address, health])),
    orders: {
      shopify: await orderSyncHealths(db, 'shopify_orders'),
      amazon: await orderSyncHealths(db, 'amazon_orders'),
    },
    orderQueue: await orderQueueState(db),
    backfills: await orderBackfills(db),
  };
}

const NO_HEALTH = { lastSuccessAt: null, consecutiveFailures: 0, failingSince: null };

function healthOf(snapshot: ConnectionSnapshot, address: string) {
  return snapshot.mailboxes.get(address) ?? { address, ...NO_HEALTH };
}

/** 一个店铺的订单同步记录（按店铺的平台；还没同步过为空记录） */
function orderHealthOf(
  snapshot: ConnectionSnapshot,
  store: Pick<StoreConnectionSource, 'id' | 'platform'>,
) {
  return snapshot.orders[store.platform].get(store.id) ?? { storeId: store.id, ...NO_HEALTH };
}

/** 店铺订单连接的状态：按该平台的订单同步记录 */
function ordersStatus(store: StoreConnectionSource, snapshot: ConnectionSnapshot) {
  return orderSyncStatus(orderHealthOf(snapshot, store), snapshot.now);
}

/** 一组邮箱里最差的状态（没有邮箱为未连接） */
function mailboxesStatus(addresses: readonly string[], snapshot: ConnectionSnapshot) {
  return worstConnectionStatus(
    addresses.map((address) => mailboxStatus(healthOf(snapshot, address), snapshot.now)),
  );
}

/** 某种服务商的邮箱地址 */
function addressesOf(
  mailboxes: StoreConnectionSource['mailboxes'],
  provider: MailProvider,
): string[] {
  return mailboxes.filter((mailbox) => mailbox.provider === provider).map((m) => m.address);
}

/**
 * 店铺的连接：进线邮箱按服务商各一个（Gmail、163 企业邮箱，收件与「已发送」；店铺没有这种服务商的邮箱就没有这一个）与订单
 * （亚马逊 SP-API / Shopify Admin API）
 */
export function storeConnections(
  store: StoreConnectionSource,
  snapshot: ConnectionSnapshot,
): StoreConnection[] {
  const mailboxes = mailProviders.flatMap((provider): StoreConnection[] => {
    const addresses = addressesOf(store.mailboxes, provider);
    return addresses.length === 0
      ? []
      : [{ kind: provider, status: mailboxesStatus(addresses, snapshot) }];
  });
  return [...mailboxes, { kind: 'orders', status: ordersStatus(store, snapshot) }];
}

/**
 * 订单渠道卡（亚马逊、Shopify）：该平台各店铺的订单同步（按店铺名列出延迟与异常的店铺，最近同步取最旧的一次）；
 * 亚马逊卡另带订单通知队列（SQS）
 */
function ordersCard(
  kind: Platform,
  stores: readonly StoreConnectionSource[],
  snapshot: ConnectionSnapshot,
): ChannelCard {
  const issues: ChannelIssue[] = [];
  let oldest: Date | null = null;
  for (const store of [...stores].sort((a, b) => a.name.localeCompare(b.name))) {
    const health = orderHealthOf(snapshot, store);
    if (health.lastSuccessAt && (!oldest || health.lastSuccessAt < oldest)) {
      oldest = health.lastSuccessAt;
    }
    const status = orderSyncStatus(health, snapshot.now);
    if (status === 'delayed' || status === 'error') {
      issues.push({
        target: store.name,
        status,
        lastSuccessAt: health.lastSuccessAt?.toISOString() ?? null,
        failingSince: health.failingSince?.toISOString() ?? null,
        failures: health.consecutiveFailures,
      });
    }
  }
  return {
    kind,
    status: worstConnectionStatus(stores.map((store) => ordersStatus(store, snapshot))),
    simulated: stores.some((store) => store.adapterMode === 'fake'),
    lastSyncAt: oldest?.toISOString() ?? null,
    issues,
    queue: kind === 'amazon' ? snapshot.orderQueue : null,
    backfill: orderBackfillSummary(
      stores.map((store) => ({
        status: ordersStatus(store, snapshot),
        backfill: snapshot.backfills.get(store.id) ?? null,
      })),
    ),
  };
}

/** 邮箱卡（Gmail、163 企业邮箱）：全部店铺里该服务商的进线邮箱 */
function mailboxCard(
  provider: MailProvider,
  stores: readonly StoreConnectionSource[],
  snapshot: ConnectionSnapshot,
): ChannelCard {
  const addresses = [
    ...new Set(stores.flatMap((store) => addressesOf(store.mailboxes, provider))),
  ].sort();
  // 「模拟数据」看有这种邮箱的店铺；一个都还没有时看全部店铺（开发测试环境整体接的是 Fake）
  const owners = stores.filter((store) => addressesOf(store.mailboxes, provider).length > 0);
  const issues: ChannelIssue[] = [];
  let oldest: Date | null = null;
  for (const address of addresses) {
    const health = healthOf(snapshot, address);
    if (health.lastSuccessAt && (!oldest || health.lastSuccessAt < oldest)) {
      oldest = health.lastSuccessAt;
    }
    const status = mailboxStatus(health, snapshot.now);
    if (status === 'delayed' || status === 'error') {
      issues.push({
        target: address,
        status,
        lastSuccessAt: health.lastSuccessAt?.toISOString() ?? null,
        failingSince: health.failingSince?.toISOString() ?? null,
        failures: health.consecutiveFailures,
      });
    }
  }
  return {
    kind: provider,
    status: mailboxesStatus(addresses, snapshot),
    simulated: (owners.length > 0 ? owners : stores).some((store) => store.adapterMode === 'fake'),
    lastSyncAt: oldest?.toISOString() ?? null,
    issues,
    queue: null,
    backfill: null,
  };
}

/** 钉钉卡：实现（CLIENT_MODE_DINGTALK）与通讯录同步的状态 */
export interface DingtalkCardSource {
  readonly mode: AdapterMode;
  readonly status: ConnectionStatus;
  readonly lastSyncAt: Date | null;
}

/**
 * 第一期五张渠道卡（K20 的顺序）：亚马逊 SP-API、Shopify Admin API（订单，按平台的店铺）、Gmail 与 163 企业邮箱（全部店铺里
 * 该服务商的邮箱，D-28）、钉钉（全局客户端，按通讯录的同步记录）。积加、易仓是前端的静态卡「第二阶段接入」。
 */
export function channelCards(
  stores: readonly StoreConnectionSource[],
  snapshot: ConnectionSnapshot,
  dingtalk: DingtalkCardSource,
): ChannelCard[] {
  return [
    ordersCard(
      'amazon',
      stores.filter((s) => s.platform === 'amazon'),
      snapshot,
    ),
    ordersCard(
      'shopify',
      stores.filter((s) => s.platform === 'shopify'),
      snapshot,
    ),
    mailboxCard('gmail', stores, snapshot),
    mailboxCard('qiye163', stores, snapshot),
    {
      kind: 'dingtalk',
      status: dingtalk.status,
      simulated: dingtalk.mode === 'fake',
      lastSyncAt: dingtalk.lastSyncAt?.toISOString() ?? null,
      issues: [],
      queue: null,
      backfill: null,
    },
  ];
}

/** 一串连续失败里最早的开始（没记下的取此刻） */
function earliestFailure(
  healths: readonly { readonly failingSince: Date | null }[],
  now: Date,
): string {
  return healths
    .map((health) => health.failingSince ?? now)
    .reduce((earliest, at) => (at < earliest ? at : earliest))
    .toISOString();
}

/**
 * 全站横幅（G4）：连接异常的渠道，钉钉除外（6.9）。Gmail 与 163 企业邮箱——该服务商任一进线邮箱连接异常就出，列出这些邮箱（各一条）；亚马逊（待办 12）与 Shopify
 * （待办 11）——该平台任一店铺的订单同步连接异常就出，列出这些店铺。时刻取其中最早的一串连续失败的开始；几个渠道都异常时各一条，
 * 顺序 Gmail → 163 企业邮箱 → 亚马逊 → Shopify（contracts 的 channelAlertKinds；协调者 2026-10-06 决定，PRD G4 v2.37）。
 * 订单通知队列（SQS）不出横幅
 */
export function channelAlerts(
  stores: readonly Pick<StoreConnectionSource, 'id' | 'name' | 'platform'>[],
  snapshot: ConnectionSnapshot,
): ChannelAlert[] {
  const alerts: ChannelAlert[] = [];
  for (const provider of mailProviders) {
    const failingMailboxes = [...snapshot.mailboxes.values()]
      .filter(
        (health) => health.provider === provider && mailboxStatus(health, snapshot.now) === 'error',
      )
      .sort((a, b) => a.address.localeCompare(b.address));
    if (failingMailboxes.length > 0) {
      alerts.push({
        kind: provider,
        targets: failingMailboxes.map((health) => health.address),
        since: earliestFailure(failingMailboxes, snapshot.now),
      });
    }
  }
  for (const platform of ['amazon', 'shopify'] as const) {
    const failingStores = stores
      .filter((store) => store.platform === platform)
      .map((store) => ({ store, health: orderHealthOf(snapshot, store) }))
      .filter(({ health }) => orderSyncStatus(health, snapshot.now) === 'error')
      .sort((a, b) => a.store.name.localeCompare(b.store.name));
    if (failingStores.length > 0) {
      alerts.push({
        kind: platform,
        targets: failingStores.map(({ store }) => store.name),
        since: earliestFailure(
          failingStores.map(({ health }) => health),
          snapshot.now,
        ),
      });
    }
  }
  return alerts;
}
