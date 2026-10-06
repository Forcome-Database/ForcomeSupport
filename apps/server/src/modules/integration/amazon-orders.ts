import type { Currency } from '@forcome/contracts';
import type { DemoFixture } from '@forcome/fixtures';
import { createRealAmazonOrders } from './amazon-orders-real';
import { defineClient, type FakeClient } from './definition';
import { FakeQuota } from './fake-quota';
import { FaultInjector } from './faults';
import type { CallPriority } from './call-priority';

/*
 * 亚马逊订单（店铺级，规格 order「亚马逊：SP-API Orders v2026-01-01，只用非受限角色」、ADR 0011，待办 12）：只读——
 * 按平台更新时间（lastUpdatedAfter）分页搜订单（每 4 分钟的增量兜底，回补与对账随 13 也用它）、按订单号取一笔
 * （ORDER_CHANGE 通知触发的拉取与镜像缺失时的补拉）、读卖家参与的站点（「测试连接」，不占订单接口的配额）。
 * 真实现（amazon-orders-real.ts）用 LWA 以卖家授权的刷新令牌（主密钥加密存库，部署子命令录入）换访问令牌，经出站 HTTP 客户端工厂调
 * SP-API 北美端点；每个「卖家 × 接口」一个令牌桶，排队按优先级取（sp-api-quota.ts）。
 * Fake 按店铺存订单，测试用 put 放入、faults（全部店铺）或 faultsOf(店铺)（只这个店铺）注入故障（操作名同 SP-API：searchOrders /
 * getOrder / getMarketplaceParticipations），开发测试环境从示例数据夹具回放第一阶段的亚马逊订单。非受限角色读不到买家姓名、邮箱与街道，
 * 美国站也读不到邮编。写动作（退款、取消的 Feeds）随第二期。
 */

/** 订单上的一个商品行 */
export interface AmazonOrderItem {
  /** 商品名（product.title；没有时取 ASIN） */
  readonly title: string;
  readonly sku: string | null;
  readonly asin: string | null;
  readonly quantity: number;
}

/** 收件地址里非受限角色能读到的部分 */
export interface AmazonShipTo {
  readonly city: string | null;
  /** 州或省（stateOrRegion），如 CA、ON、NL */
  readonly stateOrRegion: string | null;
  /** 邮编：美国站非受限角色读不到，为 null；加拿大、墨西哥有 */
  readonly postalCode: string | null;
  /** 国家代码（ISO 3166-1 alpha-2） */
  readonly countryCode: string | null;
}

/** MFN 包裹的承运商与单号（packages[]，只有自发货订单有；积加回传的单号能否读到待实测，O-2） */
export interface AmazonPackage {
  readonly carrier: string | null;
  readonly trackingNumber: string | null;
}

/** 一笔亚马逊订单（Orders v2026-01-01 的 Order 里镜像要的字段） */
export interface AmazonOrder {
  /** AmazonOrderId（3-7-7） */
  readonly orderId: string;
  readonly createdAt: Date;
  /** 平台更新时间（lastUpdatedTime，增量同步的水位） */
  readonly updatedAt: Date;
  /** 站点（salesChannel.marketplaceId） */
  readonly marketplaceId: string | null;
  /** 履约状态（fulfillment.fulfillmentStatus，如 UNSHIPPED、SHIPPED、CANCELLED） */
  readonly status: string;
  /** 履约方（fulfillment.fulfilledBy）：MERCHANT 为 MFN，AMAZON 为 AFN */
  readonly fulfilledBy: 'MERCHANT' | 'AMAZON' | null;
  /** 承诺发货时限（shipByWindow 的最晚时刻） */
  readonly shipBy: Date | null;
  /** 承诺送达时限（deliverByWindow 的最晚时刻） */
  readonly deliverBy: Date | null;
  /** 订单金额（proceeds.grandTotal）；待付款的还没有，为 null */
  readonly total: { readonly amount: string; readonly currency: Currency } | null;
  readonly items: readonly AmazonOrderItem[];
  readonly shipTo: AmazonShipTo | null;
  readonly packages: readonly AmazonPackage[];
}

/** 一页订单：按平台更新时间先后；还有下一页时给出分页令牌 */
export interface AmazonOrderPage {
  readonly orders: readonly AmazonOrder[];
  readonly nextToken: string | null;
}

/**
 * 按什么时间搜订单：平台更新时间不早于 lastUpdatedAfter（增量与夜间对账）或下单时间不早于 createdAfter（回补，待办 13）；
 * v2026-01-01 的 searchOrders 两者只能给一个
 */
export type AmazonOrderWindow =
  | { readonly lastUpdatedAfter: Date; readonly createdAfter?: never }
  | { readonly createdAfter: Date; readonly lastUpdatedAfter?: never };

export interface AmazonOrdersClient {
  /**
   * 按平台更新时间或下单时间搜订单（searchOrders），分页；paginationToken 为上一页的 nextToken（亚马逊的分页令牌 24 小时内有效）。
   * priority 决定配额排队的先后（默认 high；回补与对账传 low）
   */
  searchOrders(
    options: AmazonOrderWindow & {
      readonly paginationToken?: string | null;
      readonly priority?: CallPriority;
    },
  ): Promise<AmazonOrderPage>;
  /** 按订单号取一笔（getOrder）；没有为 null */
  getOrder(
    orderId: string,
    options?: { readonly priority?: CallPriority },
  ): Promise<AmazonOrder | null>;
  /** 卖家参与的站点（Sellers API getMarketplaceParticipations）：「测试连接」用，不占订单接口的配额 */
  marketplaceParticipations(): Promise<{ readonly marketplaceIds: readonly string[] }>;
}

/** 北美三站的 marketplaceId（SP-API 文档「Marketplace IDs」） */
export const AMAZON_MARKETPLACES = {
  US: 'ATVPDKIKX0DER',
  CA: 'A2EUQ1WTGCTBG2',
  MX: 'A1AM78C64UM0Y8',
} as const;

// ---------------------------------------------------------------- Fake

/** 测试放进 Fake 的订单：没给的字段取默认值 */
export type FakeAmazonOrderInput = Partial<AmazonOrder> & {
  readonly orderId: string;
  readonly updatedAt: Date;
};

/** Fake 一页的默认条数（真实现每页 100） */
const FAKE_PAGE_SIZE = 50;

function fakeOrder(input: FakeAmazonOrderInput): AmazonOrder {
  return {
    createdAt: input.updatedAt,
    marketplaceId: AMAZON_MARKETPLACES.US,
    status: 'UNSHIPPED',
    fulfilledBy: 'MERCHANT',
    shipBy: null,
    deliverBy: null,
    total: { amount: '49.99', currency: 'USD' },
    items: [{ title: 'V2 车载吸尘器', sku: null, asin: null, quantity: 1 }],
    shipTo: null,
    packages: [],
    ...input,
  };
}

/** 按更新时间、再按订单号排序（同一时刻更新的几笔顺序固定，分页不重不漏） */
function byUpdatedAt(a: AmazonOrder, b: AmazonOrder): number {
  return a.updatedAt.getTime() - b.updatedAt.getTime() || a.orderId.localeCompare(b.orderId);
}

/** 按下单时间、再按订单号排序（回补按下单时间分页：订单之后再变也不挪位置） */
function byCreatedAt(a: AmazonOrder, b: AmazonOrder): number {
  return a.createdAt.getTime() - b.createdAt.getTime() || a.orderId.localeCompare(b.orderId);
}

/**
 * Fake SP-API 订单：按店铺存订单（键为订单号），put 放入或改写一笔（改写时更新时间由测试给出）。
 * 分页令牌是「已取过几笔」，与真实的不透明令牌同样只在同一次遍历里有效。
 * 订单接口（searchOrders、getOrder）先过配额（quota，所有店铺共用一个；默认不限，测试用它模拟配额用完时按优先级排队，待办 13）
 */
export class FakeAmazonOrders implements FakeClient<AmazonOrdersClient> {
  /** 对全部店铺生效的故障 */
  readonly faults = new FaultInjector('sp_api');
  readonly quota = new FakeQuota();
  readonly #storeFaults = new Map<string, FaultInjector>();
  readonly #stores = new Map<string, Map<string, AmazonOrder>>();

  /** 只对这个店铺生效的故障（一个店铺连接异常、另一个照常） */
  faultsOf(storeId: string): FaultInjector {
    let faults = this.#storeFaults.get(storeId);
    if (!faults) {
      faults = new FaultInjector('sp_api');
      this.#storeFaults.set(storeId, faults);
    }
    return faults;
  }

  async #check(storeId: string, operation: string): Promise<void> {
    await this.faults.check(operation);
    await this.faultsOf(storeId).check(operation);
  }

  #orders(storeId: string): Map<string, AmazonOrder> {
    let orders = this.#stores.get(storeId);
    if (!orders) {
      orders = new Map();
      this.#stores.set(storeId, orders);
    }
    return orders;
  }

  /** 放入或改写某店铺的一笔订单，返回放进去的样子 */
  put(storeId: string, input: FakeAmazonOrderInput): AmazonOrder {
    const order = fakeOrder(input);
    this.#orders(storeId).set(order.orderId, order);
    return order;
  }

  /** 某店铺此刻的全部订单（按更新时间先后） */
  orders(storeId: string): AmazonOrder[] {
    return [...this.#orders(storeId).values()].sort(byUpdatedAt);
  }

  client(storeId?: string): AmazonOrdersClient {
    if (!storeId) throw new Error('SP-API 订单是店铺级客户端，要给出店铺');
    return {
      searchOrders: async (options) => {
        await this.quota.acquire(options.priority ?? 'high');
        await this.#check(storeId, 'searchOrders');
        const all =
          options.createdAfter !== undefined
            ? [...this.#orders(storeId).values()]
                .filter((o) => o.createdAt >= options.createdAfter)
                .sort(byCreatedAt)
            : this.orders(storeId).filter((o) => o.updatedAt >= options.lastUpdatedAfter);
        const paginationToken = options.paginationToken;
        const start = paginationToken ? Number(paginationToken) : 0;
        const end = start + FAKE_PAGE_SIZE;
        return {
          orders: all.slice(start, end),
          nextToken: end < all.length ? String(end) : null,
        };
      },
      getOrder: async (orderId, options) => {
        await this.quota.acquire(options?.priority ?? 'high');
        await this.#check(storeId, 'getOrder');
        return this.#orders(storeId).get(orderId) ?? null;
      },
      marketplaceParticipations: async () => {
        await this.#check(storeId, 'getMarketplaceParticipations');
        return { marketplaceIds: [AMAZON_MARKETPLACES.US] };
      },
    };
  }

  /** 示例数据夹具里第一阶段的亚马逊订单（data.py 的 AMAZON_ORDERS_P1） */
  replay(fixture: DemoFixture): void {
    const storeIds = new Map(fixture.stores.map((s) => [s.key, s.id]));
    for (const order of fixture.amazonOrders) {
      const storeId = storeIds.get(order.storeKey);
      if (!storeId)
        throw new Error(`示例订单 ${order.orderId} 的店铺 ${order.storeKey} 不在夹具里`);
      this.put(storeId, {
        orderId: order.orderId,
        createdAt: new Date(order.placedAt),
        updatedAt: new Date(order.updatedAt),
        marketplaceId: AMAZON_MARKETPLACES[order.site],
        status: order.status,
        fulfilledBy: order.fulfillmentChannel === 'MFN' ? 'MERCHANT' : 'AMAZON',
        shipBy: order.shipBy ? new Date(order.shipBy) : null,
        deliverBy: order.deliverBy ? new Date(order.deliverBy) : null,
        total: order.total,
        items: order.lineItems.map((item) => ({ ...item, sku: null, asin: null })),
        shipTo: { ...order.shipTo },
        packages: order.tracking
          ? [{ carrier: order.tracking.carrier, trackingNumber: order.tracking.number }]
          : [],
      });
    }
  }

  reset(): void {
    this.#stores.clear();
    this.quota.reset();
    this.faults.reset();
    this.#storeFaults.clear();
  }
}

export const amazonOrdersClient = defineClient<AmazonOrdersClient, FakeAmazonOrders>({
  system: 'sp_api',
  scope: 'store',
  createReal: createRealAmazonOrders,
  createFake: () => new FakeAmazonOrders(),
});
