import { currencySchema } from '@forcome/contracts';
import { z } from 'zod';
import { toMilliseconds, type Clock, type ShopifyCredentials } from '../core';
import type { CallPriority } from './call-priority';
import type { CredentialVault } from './credential-vault';
import type { RealClientContext } from './definition';
import { ClientNotConfiguredError, ExternalCallFailedError, HistoryLimitedError } from './faults';
import { createHttpClient, type HttpClient, type RateLimit } from './http';
import { SHOPIFY_RECENT_ORDER_DAYS, type ShopifyClient, type ShopifyOrder } from './shopify';
import { ShopifyQuota, type ShopifyOperation } from './shopify-quota';

/*
 * Shopify Admin GraphQL 的真实现（规格 order「Shopify」、ADR 0011、0013，待办 11）：
 * - 访问令牌：Shopify 自建应用（Dev Dashboard，应用与店铺同一组织）的客户端凭据，按店铺以 client credentials 换令牌
 *   （POST https://<店铺>/admin/oauth/access_token，expires_in 恒为 86399 秒）；令牌用主密钥加密存进 integration.credential，
 *   换到后满 20 小时就提前换新（24 小时过期），被拒（401）时立即换新再试一次；
 * - 订单：POST https://<店铺>/admin/api/<版本>/graphql.json，请求头 X-Shopify-Access-Token；orders 查询按 updated_at 过滤、
 *   sortKey UPDATED_AT（回补按 created_at、sortKey CREATED_AT，待办 13），每页 100 笔；GraphQL 的 errors（含限流 THROTTLED）
 *   翻译成 faults.ts 的错误；
 * - 查询成本：发出前从本进程的店铺桶里扣点（shopify-quota.ts，增量优先、回补与对账让路），按响应的 extensions.cost 校准；
 * - 历史订单：没开通 read_all_orders 的应用只能读近 60 天的订单（平台对更早的不报错、只是不返回）。按下单时间从 60 天以前取时，
 *   第一页先查一次应用被授予的权限（currentAppInstallation.accessScopes，不缓存），没有 read_all_orders 就以
 *   HistoryLimitedError 失败，回补据此改为 60 天并记下回补窗口（待办 13）；
 * - 都经出站 HTTP 客户端工厂（代理分流、时限、限流、调用记录；换令牌的响应体不记）。
 * 没有配置客户端凭据或主密钥时以「未配置」失败（ClientNotConfiguredError，不算连接失败，店铺为未连接，用户 2026-10-04 口径）。
 * 真实环境的验收（令牌、61–90 天历史订单、断线恢复）随待办 29 的验收矩阵；单元与集成测试用 undici MockAgent 回放。
 */

const SYSTEM = 'shopify';
/** Admin API 版本（季度发布，每个版本至少支持 12 个月；升级时改这里并对照 Shopify 的变更说明） */
export const SHOPIFY_API_VERSION = '2026-07';
/** 每页几笔（Admin GraphQL 单页最多 250；100 笔、每笔 50 个商品行的查询成本在单次上限 1000 点之内） */
const PAGE_SIZE = 100;
/** 换到令牌后多久提前换新（令牌 24 小时过期，规格「每 20 小时提前刷新」） */
export const SHOPIFY_TOKEN_RENEW_MS = 20 * 60 * 60_000;
/** 每个接口每秒最多几次（整个进程、所有店铺合计；Admin GraphQL 按查询成本限流，这里只防突发） */
const RATE_LIMITS: Readonly<Record<string, RateLimit>> = { '*': { perSecond: 4 } };
/** 店铺域名（P18 的平台标识）：<名字>.myshopify.com */
const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

const ORDER_FIELDS = `
  id name email createdAt updatedAt cancelledAt
  displayFinancialStatus displayFulfillmentStatus
  totalPriceSet { shopMoney { amount currencyCode } }
  lineItems(first: 50) { nodes { title sku quantity } }
  shippingAddress { name address1 address2 city provinceCode zip countryCodeV2 phone }
  fulfillments(first: 10) { trackingInfo(first: 10) { company number } }
`;
const ordersQuery = (sortKey: 'UPDATED_AT' | 'CREATED_AT') =>
  `query Orders($first: Int!, $after: String, $query: String!) {
  orders(first: $first, after: $after, query: $query, sortKey: ${sortKey}) {
    pageInfo { hasNextPage endCursor }
    nodes { ${ORDER_FIELDS} }
  }
}`;
const ORDERS_QUERY = ordersQuery('UPDATED_AT');
const CREATED_ORDERS_QUERY = ordersQuery('CREATED_AT');
const SHOP_QUERY = 'query Shop { shop { name } }';
const SCOPES_QUERY = 'query Scopes { currentAppInstallation { accessScopes { handle } } }';
/** 读得到 60 天以前的订单要的权限 */
const READ_ALL_ORDERS = 'read_all_orders';

const nullableString = z
  .string()
  .nullable()
  .optional()
  .transform((v) => v ?? null);
const orderSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: nullableString,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  cancelledAt: z.iso.datetime({ offset: true }).nullable(),
  displayFinancialStatus: nullableString,
  displayFulfillmentStatus: z.string(),
  totalPriceSet: z.object({
    shopMoney: z.object({ amount: z.string(), currencyCode: currencySchema }),
  }),
  lineItems: z.object({
    nodes: z.array(z.object({ title: z.string(), sku: nullableString, quantity: z.int() })),
  }),
  shippingAddress: z
    .object({
      name: nullableString,
      address1: nullableString,
      address2: nullableString,
      city: nullableString,
      provinceCode: nullableString,
      zip: nullableString,
      countryCodeV2: nullableString,
      phone: nullableString,
    })
    .nullable(),
  fulfillments: z.array(
    z.object({
      trackingInfo: z.array(z.object({ company: nullableString, number: nullableString })),
    }),
  ),
});
const graphqlSchema = z.object({
  data: z.unknown().optional(),
  extensions: z
    .object({
      cost: z
        .object({
          requestedQueryCost: z.number(),
          throttleStatus: z
            .object({
              maximumAvailable: z.number(),
              currentlyAvailable: z.number(),
              restoreRate: z.number(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
  errors: z
    .array(
      z.object({
        message: z.string(),
        extensions: z.object({ code: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});
const ordersDataSchema = z.object({
  orders: z.object({
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
    nodes: z.array(orderSchema),
  }),
});
const shopDataSchema = z.object({ shop: z.object({ name: z.string() }) });
const scopesDataSchema = z.object({
  currentAppInstallation: z.object({
    accessScopes: z.array(z.object({ handle: z.string() })),
  }),
});

function contractError(operation: string): ExternalCallFailedError {
  return new ExternalCallFailedError(SYSTEM, operation, {
    message: '返回的内容与接口约定不符',
    retryable: false,
  });
}

function toOrder(node: z.infer<typeof orderSchema>): ShopifyOrder {
  const address = node.shippingAddress;
  return {
    id: node.id,
    name: node.name,
    email: node.email,
    createdAt: new Date(node.createdAt),
    updatedAt: new Date(node.updatedAt),
    cancelledAt: node.cancelledAt ? new Date(node.cancelledAt) : null,
    financialStatus: node.displayFinancialStatus,
    fulfillmentStatus: node.displayFulfillmentStatus,
    total: {
      amount: node.totalPriceSet.shopMoney.amount,
      currency: node.totalPriceSet.shopMoney.currencyCode,
    },
    lineItems: node.lineItems.nodes,
    shippingAddress: address
      ? {
          name: address.name,
          address1: address.address1,
          address2: address.address2,
          city: address.city,
          province: address.provinceCode,
          zip: address.zip,
          country: address.countryCodeV2,
          phone: address.phone,
        }
      : null,
    tracking: node.fulfillments.flatMap((f) => f.trackingInfo),
  };
}

/** Shopify 的 search syntax 里的时刻（带引号的 ISO 8601，秒精度） */
const searchTime = (at: Date) => `'${at.toISOString().replace(/\.\d{3}Z$/, 'Z')}'`;

/** 一个店铺的访问令牌：从保管处取，满 20 小时或被拒后换新 */
export interface ShopifyTokens {
  get(): Promise<string>;
  /** 令牌被拒（401）：立即换一个新的 */
  renew(): Promise<string>;
}

export function createShopifyTokens(
  http: HttpClient,
  options: {
    readonly shop: string;
    readonly storeId: string;
    readonly credentials: ShopifyCredentials;
    readonly vault: CredentialVault;
    readonly clock: Clock;
  },
): ShopifyTokens {
  const { shop, storeId, credentials, vault, clock } = options;
  async function issue(): Promise<string> {
    const body = await http.postForm(
      `https://${shop}/admin/oauth/access_token`,
      {
        grant_type: 'client_credentials',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      },
      // 返回的是访问令牌：调用记录里不留响应体
      { operation: 'oauth.access_token', secretResponse: true },
    );
    const parsed = tokenSchema.safeParse(body);
    if (!parsed.success) throw contractError('oauth.access_token');
    const issuedAt = clock.now();
    await vault.write(SYSTEM, storeId, {
      secret: parsed.data.access_token,
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + parsed.data.expires_in * 1000),
    });
    return parsed.data.access_token;
  }
  return {
    async get() {
      const stored = await vault.read(SYSTEM, storeId);
      const now = clock.now().getTime();
      if (
        stored &&
        now - stored.issuedAt.getTime() < SHOPIFY_TOKEN_RENEW_MS &&
        now < stored.expiresAt.getTime()
      ) {
        return stored.secret;
      }
      return issue();
    },
    renew: issue,
  };
}

/** 一个店铺的 Admin GraphQL 客户端 */
export function createRealShopifyClient(
  http: HttpClient,
  tokens: ShopifyTokens,
  shop: string,
  options: { readonly clock: Clock; readonly quota: Pick<ShopifyQuota, 'acquire' | 'observe'> },
): ShopifyClient {
  const { clock, quota } = options;
  const endpoint = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  async function post(
    operation: ShopifyOperation,
    token: string,
    body: unknown,
    priority: CallPriority,
  ): Promise<unknown> {
    await quota.acquire(shop, operation, priority);
    return http.postJson(endpoint, body, {
      operation,
      headers: { 'X-Shopify-Access-Token': token },
    });
  }

  /** 发一次 GraphQL 请求（先扣查询成本）；令牌被拒（401）换新再试一次；errors 翻译成 faults.ts 的错误 */
  async function graphql(
    operation: ShopifyOperation,
    query: string,
    variables: Record<string, unknown>,
    priority: CallPriority = 'high',
  ): Promise<unknown> {
    const body = { query, variables };
    let response: unknown;
    try {
      response = await post(operation, await tokens.get(), body, priority);
    } catch (error) {
      if (!(error instanceof ExternalCallFailedError) || error.status !== 401) throw error;
      response = await post(operation, await tokens.renew(), body, priority);
    }
    const parsed = graphqlSchema.safeParse(response);
    if (!parsed.success) throw contractError(operation);
    quota.observe(shop, operation, parsed.data.extensions?.cost);
    const errors = parsed.data.errors ?? [];
    if (errors.length > 0) {
      // 超出查询成本（THROTTLED）稍后再试即可；其余（权限不够、查询写错）原样重试没用
      const throttled = errors.some((e) => e.extensions?.code === 'THROTTLED');
      throw new ExternalCallFailedError(SYSTEM, operation, {
        message: errors.map((e) => e.message).join('；'),
        retryable: throttled,
      });
    }
    return parsed.data.data;
  }

  async function orders(
    operation: ShopifyOperation,
    variables: { readonly query: string; readonly first: number; readonly after: string | null },
    options: { readonly byCreated?: boolean; readonly priority?: CallPriority } = {},
  ) {
    const data = ordersDataSchema.safeParse(
      await graphql(
        operation,
        options.byCreated ? CREATED_ORDERS_QUERY : ORDERS_QUERY,
        { ...variables },
        options.priority,
      ),
    );
    if (!data.success) throw contractError(operation);
    return data.data.orders;
  }

  /**
   * 应用有没有 read_all_orders：每次都问（只在按下单时间从 60 天以前取的第一页问，一次回补问一次）——不缓存，申请下来后
   * 立即用 --again 重新回补就能按 90 天取
   */
  async function readsAllOrders(priority: CallPriority): Promise<boolean> {
    const data = scopesDataSchema.safeParse(
      await graphql('access_scopes', SCOPES_QUERY, {}, priority),
    );
    if (!data.success) throw contractError('access_scopes');
    const handles = new Set(data.data.currentAppInstallation.accessScopes.map((s) => s.handle));
    return handles.has(READ_ALL_ORDERS);
  }

  return {
    async listOrders(options) {
      const { after, first, priority } = options;
      const byCreated = options.createdSince !== undefined;
      if (options.createdSince !== undefined && !after) {
        // 第一页从 60 天以前取：要有 read_all_orders（平台对更早的订单不报错、只是不返回，所以先问清楚）
        const floor = clock.now().getTime() - toMilliseconds({ days: SHOPIFY_RECENT_ORDER_DAYS });
        if (options.createdSince.getTime() < floor && !(await readsAllOrders(priority ?? 'high'))) {
          throw new HistoryLimitedError(
            SYSTEM,
            'orders',
            SHOPIFY_RECENT_ORDER_DAYS,
            `应用没有 ${READ_ALL_ORDERS}，只能读近 ${SHOPIFY_RECENT_ORDER_DAYS} 天的订单`,
          );
        }
      }
      const filter =
        options.createdSince !== undefined
          ? `created_at:>=${searchTime(options.createdSince)}`
          : `updated_at:>=${searchTime(options.updatedSince)}`;
      const page = await orders(
        'orders',
        { query: filter, first: first ?? PAGE_SIZE, after: after ?? null },
        { byCreated, priority },
      );
      return {
        orders: page.nodes.map(toOrder),
        nextCursor: page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null,
      };
    },
    async findOrderByName(name) {
      // 搜索按词匹配，可能带出相近的，只认名字完全一致的那笔
      const page = await orders('order_by_name', {
        query: `name:${JSON.stringify(name)}`,
        first: 5,
        after: null,
      });
      const node = page.nodes.find((o) => o.name === name);
      return node ? toOrder(node) : null;
    },
    async shop() {
      const data = shopDataSchema.safeParse(await graphql('shop', SHOP_QUERY, {}));
      if (!data.success) throw contractError('shop');
      return data.data.shop;
    },
  };
}

/** 每个调用都以这个错误失败（不在构造时抛：取客户端的代码照常运行，调用时才知道） */
function failing(error: (operation: string) => Error): ShopifyClient {
  const fail = (operation: string) => Promise.reject(error(operation));
  return {
    listOrders: () => fail('orders'),
    findOrderByName: () => fail('order_by_name'),
    shop: () => fail('shop'),
  };
}

/** 本进程共用的查询成本配额（所有店铺，按店铺分桶） */
let sharedQuota: ShopifyQuota | undefined;

/** 按运行配置建一个店铺的真实现（IntegrationClients.forStore 调用） */
export function createRealShopify(context: RealClientContext): ShopifyClient {
  const { storeId, storePlatformId: shop, shopify, credentialVault, clock } = context;
  if (!shopify || !credentialVault) {
    // 资质还没到位（用户 2026-10-04 口径）：不算连接失败，店铺为未连接
    return failing(
      (operation) =>
        new ClientNotConfiguredError(
          SYSTEM,
          operation,
          '没有配置 Shopify 客户端凭据与主密钥（SHOPIFY_CLIENT_ID 等）',
        ),
    );
  }
  if (!storeId || !shop || !SHOP_DOMAIN.test(shop)) {
    // 店铺登记错了：照常算连接失败（连续 3 次为连接异常），管理员在 P18 看得到
    return failing(
      (operation) =>
        new ExternalCallFailedError(SYSTEM, operation, {
          message: `平台标识不是 Shopify 店铺域名（<名字>.myshopify.com）：${shop ?? ''}`,
          retryable: false,
        }),
    );
  }
  const http = createHttpClient(SYSTEM, {
    recorder: context.callRecorder,
    storeId,
    rateLimits: RATE_LIMITS,
  });
  const tokens = createShopifyTokens(http, {
    shop,
    storeId,
    credentials: shopify,
    vault: credentialVault,
    clock,
  });
  sharedQuota ??= new ShopifyQuota(clock);
  return createRealShopifyClient(http, tokens, shop, { clock, quota: sharedQuota });
}
