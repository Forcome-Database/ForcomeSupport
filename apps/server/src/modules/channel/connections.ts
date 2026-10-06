import {
  worstConnectionStatus,
  type AdapterMode,
  type ChannelAlert,
  type ChannelCard,
  type ChannelIssue,
  type ConnectionStatus,
  type Platform,
  type StoreConnection,
} from '@forcome/contracts';
import type { DbExecutor } from '../core';
import { orderSyncHealths, orderSyncStatus, type OrderSyncHealth } from '../order';
import { mailboxHealths, mailboxStatus, type MailboxHealth } from './mailbox-health';

/*
 * 渠道连接状态（PRD 6.9、K20、K7、G4）：按店铺计算，渠道卡显示该渠道下最差的状态并列出异常的邮箱，店铺表「状态」列显示该店铺各连接的状态。
 * - Gmail（待办 09）：按每个进线邮箱的同步记录（mailbox-health.ts）——连续 3 次失败为连接异常、从没成功过为未连接、
 *   超过 10 分钟没同步成功为同步延迟；店铺取其邮箱中最差的，卡片取全部邮箱中最差的，最近同步时间取各邮箱中最旧的一次；
 * - Shopify（待办 11）：按每个 Shopify 店铺的订单同步记录（order 的 orderSyncHealths）——口径同 Gmail（订单 10 分钟为同步延迟），
 *   卡片取各店铺中最差的并列出延迟与异常的店铺（按店铺名），最近同步时间取各店铺中最旧的一次；
 * - 钉钉卡按通讯录的同步记录（org 的 dingtalkConnection，待办 05）；
 * - 亚马逊订单还没有同步记录，只由数据来源决定：模拟数据视为已连接、真实接口为未连接（12 按同步记录替换 statusOf）。
 * 接模拟数据（Fake）时卡头另标「模拟数据」。连接异常的渠道（钉钉除外）出全站横幅（channelAlerts），几个渠道同时异常时各一条。
 */

function statusOf(mode: AdapterMode): ConnectionStatus {
  return mode === 'fake' ? 'connected' : 'not_connected';
}

/** 计算连接状态用到的店铺字段 */
export interface StoreConnectionSource {
  readonly id: string;
  readonly name: string;
  readonly platform: Platform;
  readonly adapterMode: AdapterMode;
  readonly mailboxes: readonly string[];
}

/** 计算连接状态的时刻与同步记录：全部进线邮箱（按地址）、全部 Shopify 店铺的订单同步（按店铺 ID） */
export interface ConnectionSnapshot {
  readonly now: Date;
  readonly mailboxes: ReadonlyMap<string, MailboxHealth>;
  readonly shopifyOrders: ReadonlyMap<string, OrderSyncHealth>;
}

export async function loadConnections(db: DbExecutor, now: Date): Promise<ConnectionSnapshot> {
  const healths = await mailboxHealths(db);
  return {
    now,
    mailboxes: new Map(healths.map((health) => [health.address, health])),
    shopifyOrders: await orderSyncHealths(db, 'shopify_orders'),
  };
}

const NO_HEALTH = { lastSuccessAt: null, consecutiveFailures: 0, failingSince: null };

function healthOf(snapshot: ConnectionSnapshot, address: string) {
  return snapshot.mailboxes.get(address) ?? { address, ...NO_HEALTH };
}

/** 一个 Shopify 店铺的订单同步记录（还没同步过为空记录） */
function shopifyHealthOf(snapshot: ConnectionSnapshot, storeId: string) {
  return snapshot.shopifyOrders.get(storeId) ?? { storeId, ...NO_HEALTH };
}

/** 店铺订单连接的状态：Shopify 按订单同步记录，亚马逊在 12 之前只看数据来源 */
function ordersStatus(store: StoreConnectionSource, snapshot: ConnectionSnapshot) {
  return store.platform === 'shopify'
    ? orderSyncStatus(shopifyHealthOf(snapshot, store.id), snapshot.now)
    : statusOf(store.adapterMode);
}

/** 一组邮箱里最差的状态（没有邮箱为未连接） */
function mailboxesStatus(addresses: readonly string[], snapshot: ConnectionSnapshot) {
  return worstConnectionStatus(
    addresses.map((address) => mailboxStatus(healthOf(snapshot, address), snapshot.now)),
  );
}

/** 店铺的两个连接：Gmail（收件与「已发送」）与订单（亚马逊 SP-API / Shopify Admin API） */
export function storeConnections(
  store: StoreConnectionSource,
  snapshot: ConnectionSnapshot,
): StoreConnection[] {
  return [
    { kind: 'gmail', status: mailboxesStatus(store.mailboxes, snapshot) },
    { kind: 'orders', status: ordersStatus(store, snapshot) },
  ];
}

/** 亚马逊卡：12 之前只由数据来源决定，没有最近同步时间与异常店铺 */
function amazonCard(stores: readonly StoreConnectionSource[]): ChannelCard {
  return {
    kind: 'amazon',
    status: worstConnectionStatus(stores.map((store) => statusOf(store.adapterMode))),
    simulated: stores.some((store) => store.adapterMode === 'fake'),
    lastSyncAt: null,
    issues: [],
  };
}

/** Shopify 卡：各 Shopify 店铺的订单同步（按店铺名列出延迟与异常的店铺，最近同步取最旧的一次） */
function shopifyCard(
  stores: readonly StoreConnectionSource[],
  snapshot: ConnectionSnapshot,
): ChannelCard {
  const issues: ChannelIssue[] = [];
  let oldest: Date | null = null;
  for (const store of [...stores].sort((a, b) => a.name.localeCompare(b.name))) {
    const health = shopifyHealthOf(snapshot, store.id);
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
    kind: 'shopify',
    status: worstConnectionStatus(stores.map((store) => ordersStatus(store, snapshot))),
    simulated: stores.some((store) => store.adapterMode === 'fake'),
    lastSyncAt: oldest?.toISOString() ?? null,
    issues,
  };
}

/** Gmail 卡：全部店铺的进线邮箱 */
function gmailCard(
  stores: readonly StoreConnectionSource[],
  snapshot: ConnectionSnapshot,
): ChannelCard {
  const addresses = [...new Set(stores.flatMap((store) => store.mailboxes))].sort();
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
    kind: 'gmail',
    status: mailboxesStatus(addresses, snapshot),
    simulated: stores.some((store) => store.adapterMode === 'fake'),
    lastSyncAt: oldest?.toISOString() ?? null,
    issues,
  };
}

/** 钉钉卡：实现（CLIENT_MODE_DINGTALK）与通讯录同步的状态 */
export interface DingtalkCardSource {
  readonly mode: AdapterMode;
  readonly status: ConnectionStatus;
  readonly lastSyncAt: Date | null;
}

/**
 * 第一期四张渠道卡（K20 的顺序）：亚马逊 SP-API、Shopify Admin API（订单，按平台的店铺）、Gmail（全部店铺的邮箱）、
 * 钉钉（全局客户端，按通讯录的同步记录）。积加、易仓是前端的静态卡「第二阶段接入」。
 */
export function channelCards(
  stores: readonly StoreConnectionSource[],
  snapshot: ConnectionSnapshot,
  dingtalk: DingtalkCardSource,
): ChannelCard[] {
  return [
    amazonCard(stores.filter((s) => s.platform === 'amazon')),
    shopifyCard(
      stores.filter((s) => s.platform === 'shopify'),
      snapshot,
    ),
    gmailCard(stores, snapshot),
    {
      kind: 'dingtalk',
      status: dingtalk.status,
      simulated: dingtalk.mode === 'fake',
      lastSyncAt: dingtalk.lastSyncAt?.toISOString() ?? null,
      issues: [],
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
 * 全站横幅（G4）：连接异常的渠道，钉钉除外（6.9）。Gmail——任一进线邮箱连接异常就出，列出这些邮箱；Shopify（待办 11）——任一
 * Shopify 店铺的订单同步连接异常就出，列出这些店铺。时刻取其中最早的一串连续失败的开始；两个渠道都异常时各一条，Gmail 在前
 * （协调者 2026-10-06 决定）。亚马逊随 12
 */
export function channelAlerts(
  stores: readonly StoreConnectionSource[],
  snapshot: ConnectionSnapshot,
): ChannelAlert[] {
  const alerts: ChannelAlert[] = [];
  const failingMailboxes = [...snapshot.mailboxes.values()]
    .filter((health) => mailboxStatus(health, snapshot.now) === 'error')
    .sort((a, b) => a.address.localeCompare(b.address));
  if (failingMailboxes.length > 0) {
    alerts.push({
      kind: 'gmail',
      targets: failingMailboxes.map((health) => health.address),
      since: earliestFailure(failingMailboxes, snapshot.now),
    });
  }
  const failingStores = stores
    .filter((store) => store.platform === 'shopify')
    .map((store) => ({ store, health: shopifyHealthOf(snapshot, store.id) }))
    .filter(({ health }) => orderSyncStatus(health, snapshot.now) === 'error')
    .sort((a, b) => a.store.name.localeCompare(b.store.name));
  if (failingStores.length > 0) {
    alerts.push({
      kind: 'shopify',
      targets: failingStores.map(({ store }) => store.name),
      since: earliestFailure(
        failingStores.map(({ health }) => health),
        snapshot.now,
      ),
    });
  }
  return alerts;
}
