import type { Currency } from '@forcome/contracts';
import type { DemoFixture } from '@forcome/fixtures';
import { toMilliseconds, type Clock } from '../core';
import type { CallPriority } from './call-priority';
import { defineClient, type FakeClient } from './definition';
import { FakeQuota } from './fake-quota';
import { FaultInjector, HistoryLimitedError } from './faults';
import { fixtureCustomerAddress } from './fixture-customers';
import { sameShopifyOrder } from './shopify-order-name';
import { createRealShopify } from './shopify-real';

/*
 * Shopify 订单（店铺级，规格 order「Shopify：Admin GraphQL」、ADR 0011，待办 11）：只读——按平台更新时间（updated_at）分页取订单
 * （每 1–2 分钟增量与夜间对账）或按下单时间（created_at）分页取订单（回补，待办 13）、按订单名取一笔（镜像没有时补拉）、
 * 读店铺信息（「测试连接」）。没开通 read_all_orders 的应用只能读近 60 天的订单：按下单时间取更早的以 HistoryLimitedError 失败。
 * 真实现（shopify-real.ts）用 Shopify 自建应用的客户端凭据按店铺换访问令牌（24 小时过期、每 20 小时提前换新，密文存库），
 * 经出站 HTTP 客户端工厂调 Admin GraphQL；Fake 按店铺存订单，测试用 put 放入、faults（全部店铺）或 faultsOf(店铺)（只这个店铺）
 * 注入故障（操作名 orders / order_by_name / shop），
 * 开发测试环境从示例数据夹具回放第一阶段的 Shopify 订单。写动作（退款、改地址、取消）随第二期。
 */

/** 订单上的一个商品行 */
export interface ShopifyLineItem {
  readonly title: string;
  readonly sku: string | null;
  readonly quantity: number;
}

/** 收件地址（Admin API 的 MailingAddress，受保护客户数据） */
export interface ShopifyAddress {
  readonly name: string | null;
  readonly address1: string | null;
  readonly address2: string | null;
  readonly city: string | null;
  /** 州或省的代码，如 CA、ON */
  readonly province: string | null;
  readonly zip: string | null;
  /** 国家代码（ISO 3166-1 alpha-2），如 US、CA、MX；Shopify 工单按它定站点（14） */
  readonly country: string | null;
  readonly phone: string | null;
}

/** 履约单号（Fulfillment.trackingInfo） */
export interface ShopifyTracking {
  readonly company: string | null;
  readonly number: string | null;
}

/** 一笔 Shopify 订单（Admin GraphQL Order 里镜像要的字段） */
export interface ShopifyOrder {
  /** 平台订单号：Admin API 的全局 ID（gid://shopify/Order/<数字>） */
  readonly id: string;
  /** 订单名（如 #1063，店铺内唯一）：来信里写的是它 */
  readonly name: string;
  /** 客户邮箱（受保护客户数据）；没有为 null */
  readonly email: string | null;
  readonly createdAt: Date;
  /** 平台更新时间（增量同步的水位） */
  readonly updatedAt: Date;
  readonly cancelledAt: Date | null;
  /** 付款状态（displayFinancialStatus，如 PAID、REFUNDED） */
  readonly financialStatus: string | null;
  /** 履约状态（displayFulfillmentStatus，如 FULFILLED、UNFULFILLED） */
  readonly fulfillmentStatus: string;
  /** 订单总额（店铺币种） */
  readonly total: { readonly amount: string; readonly currency: Currency };
  readonly lineItems: readonly ShopifyLineItem[];
  readonly shippingAddress: ShopifyAddress | null;
  readonly tracking: readonly ShopifyTracking[];
}

/** 一页订单：按平台更新时间先后；还有下一页时给出游标 */
export interface ShopifyOrderPage {
  readonly orders: readonly ShopifyOrder[];
  readonly nextCursor: string | null;
}

/** 没开通 read_all_orders 时平台只让读近几天的订单（Shopify：近 60 天） */
export const SHOPIFY_RECENT_ORDER_DAYS = 60;

/**
 * 按什么时间取订单：平台更新时间不早于 updatedSince（增量与夜间对账，按更新时间先后）或下单时间不早于 createdSince
 * （回补，按下单时间先后，待办 13）
 */
export type ShopifyOrderWindow =
  | { readonly updatedSince: Date; readonly createdSince?: never }
  | { readonly createdSince: Date; readonly updatedSince?: never };

export interface ShopifyClient {
  /**
   * 分页取订单（orders 查询，query updated_at:>=… / created_at:>=…，sortKey UPDATED_AT / CREATED_AT）；after 为上一页的 nextCursor。
   * 按下单时间从近 60 天以前取、而店铺没开通 read_all_orders 时，第一页以 HistoryLimitedError（days 60）失败。
   * priority 决定配额排队的先后（默认 high；回补与对账传 low）
   */
  listOrders(
    options: ShopifyOrderWindow & {
      readonly after?: string | null;
      readonly first?: number;
      readonly priority?: CallPriority;
    },
  ): Promise<ShopifyOrderPage>;
  /** 按订单名取一笔（订单名一致或订单号相同：#22283 取到 #Y22283，见 shopify-order-name.ts）；没有为 null */
  findOrderByName(name: string): Promise<ShopifyOrder | null>;
  /** 店铺能不能访问（shop 查询）：「测试连接」用，返回店铺名 */
  shop(): Promise<{ readonly name: string }>;
}

// ---------------------------------------------------------------- Fake

/** 测试放进 Fake 的订单：没给的字段取默认值，id 不给时按订单名推出 */
export type FakeShopifyOrderInput = Partial<ShopifyOrder> & {
  readonly name: string;
  readonly updatedAt: Date;
};

/** Fake 一页的默认条数（真实现每页 100） */
const FAKE_PAGE_SIZE = 50;

function fakeOrder(input: FakeShopifyOrderInput): ShopifyOrder {
  return {
    id: input.id ?? `gid://shopify/Order/${input.name.replace(/\D/g, '') || input.name}`,
    email: null,
    createdAt: input.updatedAt,
    cancelledAt: null,
    financialStatus: 'PAID',
    fulfillmentStatus: 'UNFULFILLED',
    total: { amount: '54.99', currency: 'USD' },
    lineItems: [{ title: 'V2 车载吸尘器', sku: null, quantity: 1 }],
    shippingAddress: null,
    tracking: [],
    ...input,
  };
}

/** 按更新时间、再按 ID 排序（同一时刻更新的几笔顺序固定，分页不重不漏） */
function byUpdatedAt(a: ShopifyOrder, b: ShopifyOrder): number {
  return a.updatedAt.getTime() - b.updatedAt.getTime() || a.id.localeCompare(b.id);
}

/** 按下单时间、再按 ID 排序（回补按下单时间分页：订单之后再变也不挪位置） */
function byCreatedAt(a: ShopifyOrder, b: ShopifyOrder): number {
  return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}

/**
 * Fake Shopify：按店铺存订单（键为平台订单号），put 放入或改写一笔（改写时更新时间由测试给出）。
 * 分页游标是「已取过几笔」，与真实的不透明游标同样只在同一次遍历里有效。
 * 默认开通了 read_all_orders；limitHistory() 模拟没开通（按下单时间取近 60 天以前的，第一页被拒，待办 13）。
 * 订单查询先过配额（quota，所有店铺共用一个；默认不限，测试用它模拟配额用完时按优先级排队，待办 13）
 */
export class FakeShopify implements FakeClient<ShopifyClient> {
  /** 对全部店铺生效的故障 */
  readonly faults = new FaultInjector('shopify');
  readonly quota = new FakeQuota();
  readonly #storeFaults = new Map<string, FaultInjector>();
  readonly #stores = new Map<string, Map<string, ShopifyOrder>>();
  readonly #clock: Clock;
  /** 没开通 read_all_orders 时只让读近几天；null 为开通了 */
  #historyDays: number | null = null;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  /** 模拟应用没开通 read_all_orders：按下单时间只让读近 days 天（全部店铺） */
  limitHistory(days = SHOPIFY_RECENT_ORDER_DAYS): void {
    this.#historyDays = days;
  }

  /** 模拟开通了 read_all_orders（默认） */
  allowAllOrders(): void {
    this.#historyDays = null;
  }

  /** 只对这个店铺生效的故障（一个店铺连接异常、另一个照常） */
  faultsOf(storeId: string): FaultInjector {
    let faults = this.#storeFaults.get(storeId);
    if (!faults) {
      faults = new FaultInjector('shopify');
      this.#storeFaults.set(storeId, faults);
    }
    return faults;
  }

  async #check(storeId: string, operation: string): Promise<void> {
    await this.faults.check(operation);
    await this.faultsOf(storeId).check(operation);
  }

  #orders(storeId: string): Map<string, ShopifyOrder> {
    let orders = this.#stores.get(storeId);
    if (!orders) {
      orders = new Map();
      this.#stores.set(storeId, orders);
    }
    return orders;
  }

  /** 放入或改写某店铺的一笔订单，返回放进去的样子 */
  put(storeId: string, input: FakeShopifyOrderInput): ShopifyOrder {
    const order = fakeOrder(input);
    this.#orders(storeId).set(order.id, order);
    return order;
  }

  /** 某店铺此刻的全部订单（按更新时间先后） */
  orders(storeId: string): ShopifyOrder[] {
    return [...this.#orders(storeId).values()].sort(byUpdatedAt);
  }

  client(storeId?: string): ShopifyClient {
    if (!storeId) throw new Error('Shopify 是店铺级客户端，要给出店铺');
    return {
      listOrders: async (options) => {
        const { after, first } = options;
        await this.quota.acquire(options.priority ?? 'high');
        await this.#check(storeId, 'orders');
        let all: ShopifyOrder[];
        if (options.createdSince !== undefined) {
          const days = this.#historyDays;
          // 同真实现：只在第一页检查（之后的页沿用第一页的查询）
          if (
            !after &&
            days !== null &&
            options.createdSince.getTime() < this.#clock.now().getTime() - toMilliseconds({ days })
          ) {
            throw new HistoryLimitedError(
              'shopify',
              'orders',
              days,
              `应用没有 read_all_orders，只能读近 ${days} 天的订单`,
            );
          }
          all = [...this.#orders(storeId).values()]
            .filter((o) => o.createdAt >= options.createdSince)
            .sort(byCreatedAt);
        } else {
          all = this.orders(storeId).filter((o) => o.updatedAt >= options.updatedSince);
        }
        const start = after ? Number(after) : 0;
        const end = start + (first ?? FAKE_PAGE_SIZE);
        return { orders: all.slice(start, end), nextCursor: end < all.length ? String(end) : null };
      },
      findOrderByName: async (name) => {
        await this.quota.acquire('high');
        await this.#check(storeId, 'order_by_name');
        return this.orders(storeId).find((o) => sameShopifyOrder(o.name, name)) ?? null;
      },
      shop: async () => {
        await this.#check(storeId, 'shop');
        return { name: storeId };
      },
    };
  }

  /** 示例数据夹具里第一阶段的 Shopify 订单（data.py 的 SHOPIFY_ORDERS_P1），客户邮箱同 Fake 来信（夹具写了的照用） */
  replay(fixture: DemoFixture): void {
    // 示例数据：应用没开通 read_all_orders，订单只能回补 60 天（K19、K20，待办 13）
    if (!fixture.shopifyReadAllOrders) this.limitHistory();
    const storeIds = new Map(fixture.stores.map((s) => [s.key, s.id]));
    for (const order of fixture.shopifyOrders) {
      const storeId = storeIds.get(order.storeKey);
      if (!storeId) throw new Error(`示例订单 ${order.name} 的店铺 ${order.storeKey} 不在夹具里`);
      this.put(storeId, {
        name: order.name,
        // 夹具写了下单邮箱的照用（#0991 是 Emily Chen 用另一个邮箱下的单，待办 14），否则同 Fake 来信按客户名推出
        email: order.email ?? fixtureCustomerAddress(order.customer),
        createdAt: new Date(order.placedAt),
        updatedAt: new Date(order.updatedAt),
        financialStatus: order.financialStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        total: order.total,
        lineItems: order.lineItems.map((item) => ({ ...item, sku: null })),
        shippingAddress: { ...order.shipTo, name: order.customer, phone: null },
        tracking: order.tracking ? [order.tracking] : [],
      });
    }
  }

  reset(): void {
    this.#stores.clear();
    this.#historyDays = null;
    this.quota.reset();
    this.faults.reset();
    this.#storeFaults.clear();
  }
}

export const shopifyClient = defineClient<ShopifyClient, FakeShopify>({
  system: 'shopify',
  scope: 'store',
  createReal: createRealShopify,
  createFake: ({ clock }) => new FakeShopify(clock),
});
