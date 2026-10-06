import {
  worstConnectionStatus,
  type AdapterMode,
  type ChannelCard,
  type ConnectionStatus,
  type Platform,
  type StoreConnection,
} from '@forcome/contracts';

/*
 * 渠道连接状态（PRD 6.9、K20）：按店铺计算，渠道卡显示该渠道下最差的状态，店铺表「状态」列显示该店铺各连接的状态。
 * 钉钉卡按通讯录的同步记录（org 的 dingtalkConnection，待办 05：超过 2 小时没成功为同步延迟、连续 3 次失败为连接异常）。
 * Gmail 与订单还没有同步记录，状态只由数据来源决定：模拟数据（Fake）视为已连接、卡头另标「模拟数据」；
 * 真实接口在对应客户端与同步接上之前是未连接。同步延迟、连接异常与最近同步时间随 09（Gmail）、
 * 11（Shopify）、12（SP-API）按同步记录补上，替换这里的 statusOf（规则在 contracts 的 syncConnectionStatus）。
 */

function statusOf(mode: AdapterMode): ConnectionStatus {
  return mode === 'fake' ? 'connected' : 'not_connected';
}

/** 计算连接状态用到的店铺字段 */
export interface StoreConnectionSource {
  readonly platform: Platform;
  readonly adapterMode: AdapterMode;
}

/** 店铺的两个连接：Gmail（收件与「已发送」）与订单（亚马逊 SP-API / Shopify Admin API） */
export function storeConnections(store: StoreConnectionSource): StoreConnection[] {
  return [
    { kind: 'gmail', status: statusOf(store.adapterMode) },
    { kind: 'orders', status: statusOf(store.adapterMode) },
  ];
}

function storesCard(
  kind: ChannelCard['kind'],
  stores: readonly StoreConnectionSource[],
  connection: StoreConnection['kind'],
): ChannelCard {
  const statuses = stores.map(
    (store) =>
      storeConnections(store).find((c) => c.kind === connection)?.status ?? 'not_connected',
  );
  return {
    kind,
    status: worstConnectionStatus(statuses),
    simulated: stores.some((store) => store.adapterMode === 'fake'),
    lastSyncAt: null,
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
  dingtalk: DingtalkCardSource,
): ChannelCard[] {
  return [
    storesCard(
      'amazon',
      stores.filter((s) => s.platform === 'amazon'),
      'orders',
    ),
    storesCard(
      'shopify',
      stores.filter((s) => s.platform === 'shopify'),
      'orders',
    ),
    storesCard('gmail', stores, 'gmail'),
    {
      kind: 'dingtalk',
      status: dingtalk.status,
      simulated: dingtalk.mode === 'fake',
      lastSyncAt: dingtalk.lastSyncAt?.toISOString() ?? null,
    },
  ];
}
