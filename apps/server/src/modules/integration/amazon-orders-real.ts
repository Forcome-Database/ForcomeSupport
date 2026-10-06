import { currencySchema } from '@forcome/contracts';
import { z } from 'zod';
import type { Clock, SpApiCredentials } from '../core';
import type { AmazonOrder, AmazonOrdersClient } from './amazon-orders';
import type { CredentialVault } from './credential-vault';
import type { RealClientContext } from './definition';
import { ClientNotConfiguredError, ExternalCallFailedError } from './faults';
import { createHttpClient, type HttpClient } from './http';
import { SpApiQuota, type SpApiOperation, type SpApiPriority } from './sp-api-quota';

/*
 * SP-API 订单的真实现（规格 order「亚马逊」、ADR 0011、0013，待办 12）：
 * - 卖家授权：私有应用自授权得到的刷新令牌按店铺用主密钥加密存在 integration.credential（系统名 sp_api），由部署子命令录入
 *   （storeSpApiRefreshToken）；没录入的店铺以「未配置」失败（ClientNotConfiguredError，不算连接失败，店铺为未连接）；
 * - 访问令牌：POST https://api.amazon.com/auth/o2/token（grant_type=refresh_token + LWA 应用的 client_id / client_secret），
 *   1 小时过期，本进程按店铺缓存、到期前 1 分钟换新；被拒（401 / 403）时换新再试一次；
 * - 订单：北美端点 https://sellingpartnerapi-na.amazon.com，Orders v2026-01-01 的 searchOrders（lastUpdatedAfter，每页 100）与
 *   getOrder，includedData=FULFILLMENT,PROCEEDS,RECIPIENT,PACKAGES（非受限角色能读的部分），请求头 x-amz-access-token；
 *   「测试连接」读 Sellers API 的 getMarketplaceParticipations；
 * - 配额：调用前从「卖家 × 接口」的令牌桶取令牌（sp-api-quota.ts），响应头 x-amzn-RateLimit-Limit 更新 rate，429 清空桶；
 * - 都经出站 HTTP 客户端工厂（代理分流、时限、调用记录；换令牌的响应体不记，分页令牌在调用记录里写成 ***）。
 * 没有配置 LWA 应用凭据或主密钥时以「未配置」失败（用户 2026-10-04 口径）。真实环境的验收（非受限角色能读到的字段、MFN 单号 O-2、
 * 实际配额、通知延迟）随待办 29 的验收矩阵；测试用 undici MockAgent 回放。
 */

const SYSTEM = 'sp_api';
/** 刷新令牌在动态凭据保管里的系统名（integration.credential.system） */
export const SP_API_REFRESH_TOKEN = 'sp_api';
/** 刷新令牌没有平台给的过期时间：按录入后一年记，只作提醒，不据此拒用（被撤销时换令牌失败，记连接失败） */
const REFRESH_TOKEN_RECORD_MS = 365 * 24 * 60 * 60_000;
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
/** 北美区域端点（US / CA / MX 三站） */
export const SP_API_ENDPOINT = 'https://sellingpartnerapi-na.amazon.com';
const ORDERS_PATH = '/orders/2026-01-01/orders';
/** 镜像要的数据集（都不需要受限角色） */
const INCLUDED_DATA = 'FULFILLMENT,PROCEEDS,RECIPIENT,PACKAGES';
const PAGE_SIZE = 100;
/** 访问令牌到期前多久换新 */
const ACCESS_TOKEN_MARGIN_MS = 60_000;
/** 卖家 ID（P18 的平台标识）：大写字母与数字 */
const SELLER_ID = /^[A-Z0-9]{8,20}$/;

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

const optionalString = z
  .string()
  .nullish()
  .transform((v) => v ?? null);
const instant = z.iso.datetime({ offset: true });
const windowSchema = z.object({ latestDateTime: instant.nullish() }).nullish();
const moneySchema = z.object({ amount: z.string(), currencyCode: z.string() });

const orderSchema = z.object({
  orderId: z.string(),
  createdTime: instant,
  lastUpdatedTime: instant,
  salesChannel: z.object({ marketplaceId: optionalString }),
  fulfillment: z
    .object({
      fulfillmentStatus: z.string(),
      fulfilledBy: optionalString,
      shipByWindow: windowSchema,
      deliverByWindow: windowSchema,
    })
    .nullish(),
  proceeds: z.object({ grandTotal: moneySchema.nullish() }).nullish(),
  recipient: z
    .object({
      deliveryAddress: z
        .object({
          city: optionalString,
          stateOrRegion: optionalString,
          postalCode: optionalString,
          countryCode: optionalString,
        })
        .nullish(),
    })
    .nullish(),
  orderItems: z.array(
    z.object({
      quantityOrdered: z.int(),
      product: z.object({ asin: optionalString, title: optionalString, sellerSku: optionalString }),
    }),
  ),
  packages: z
    .array(z.object({ carrier: optionalString, trackingNumber: optionalString }))
    .nullish(),
});
const searchSchema = z.object({
  orders: z.array(orderSchema),
  pagination: z.object({ nextToken: optionalString }).nullish(),
});
const getOrderSchema = z.object({ order: orderSchema });
const participationsSchema = z.object({
  payload: z.array(z.object({ marketplace: z.object({ id: z.string() }) })),
});

function contractError(operation: string): ExternalCallFailedError {
  return new ExternalCallFailedError(SYSTEM, operation, {
    message: '返回的内容与接口约定不符',
    retryable: false,
  });
}

const dateOrNull = (value: string | null | undefined) => (value ? new Date(value) : null);

function toOrder(node: z.infer<typeof orderSchema>): AmazonOrder {
  const fulfillment = node.fulfillment;
  const grandTotal = node.proceeds?.grandTotal;
  // 北美三站只有美元、加元、比索；别的币种不认（不写金额，不让一笔订单卡住整页）
  const currency = grandTotal ? currencySchema.safeParse(grandTotal.currencyCode) : null;
  const address = node.recipient?.deliveryAddress;
  const fulfilledBy = fulfillment?.fulfilledBy;
  return {
    orderId: node.orderId,
    createdAt: new Date(node.createdTime),
    updatedAt: new Date(node.lastUpdatedTime),
    marketplaceId: node.salesChannel.marketplaceId,
    status: fulfillment?.fulfillmentStatus ?? 'PENDING',
    fulfilledBy: fulfilledBy === 'MERCHANT' || fulfilledBy === 'AMAZON' ? fulfilledBy : null,
    shipBy: dateOrNull(fulfillment?.shipByWindow?.latestDateTime),
    deliverBy: dateOrNull(fulfillment?.deliverByWindow?.latestDateTime),
    total:
      grandTotal && currency?.success
        ? { amount: grandTotal.amount, currency: currency.data }
        : null,
    items: node.orderItems.map((item) => ({
      title: item.product.title ?? item.product.asin ?? '',
      sku: item.product.sellerSku,
      asin: item.product.asin,
      quantity: item.quantityOrdered,
    })),
    shipTo: address
      ? {
          city: address.city,
          stateOrRegion: address.stateOrRegion,
          postalCode: address.postalCode,
          countryCode: address.countryCode,
        }
      : null,
    packages: (node.packages ?? []).map((p) => ({
      carrier: p.carrier,
      trackingNumber: p.trackingNumber,
    })),
  };
}

/** 一个店铺的 LWA 访问令牌：到期前换新，被拒后立即换新 */
export interface SpApiTokens {
  get(): Promise<string>;
  renew(): Promise<string>;
}

/** 本进程缓存的访问令牌（按店铺；api 与 worker 各一份） */
const accessTokens = new Map<string, { readonly token: string; readonly expiresAt: number }>();
/** 正在换的访问令牌（按店铺）：几个同步任务同时发现令牌到期时只向 LWA 换一次 */
const issuing = new Map<string, Promise<string>>();

export function createSpApiTokens(
  http: HttpClient,
  options: {
    readonly storeId: string;
    readonly credentials: SpApiCredentials;
    readonly vault: CredentialVault;
    readonly clock: Clock;
    /** 只给测试用：不和别的测试共用本进程的缓存 */
    readonly cache?: Map<string, { readonly token: string; readonly expiresAt: number }>;
  },
): SpApiTokens {
  const { storeId, credentials, vault, clock } = options;
  const cache = options.cache ?? accessTokens;
  /** 换一个新的；同一店铺已经在换时等那一次的结果 */
  function issue(): Promise<string> {
    let pending = issuing.get(storeId);
    if (!pending) {
      pending = exchange().finally(() => issuing.delete(storeId));
      issuing.set(storeId, pending);
    }
    return pending;
  }
  async function exchange(): Promise<string> {
    const refresh = await vault.read(SP_API_REFRESH_TOKEN, storeId);
    if (!refresh) {
      throw new ClientNotConfiguredError(
        SYSTEM,
        'lwa.token',
        '这个店铺还没有录入卖家授权的刷新令牌（部署子命令 sp-api-token）',
      );
    }
    const body = await http.postForm(
      LWA_TOKEN_URL,
      {
        grant_type: 'refresh_token',
        refresh_token: refresh.secret,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      },
      // 返回的是访问令牌：调用记录里不留响应体
      { operation: 'lwa.token', secretResponse: true },
    );
    const parsed = tokenSchema.safeParse(body);
    if (!parsed.success) throw contractError('lwa.token');
    cache.set(storeId, {
      token: parsed.data.access_token,
      expiresAt: clock.now().getTime() + parsed.data.expires_in * 1000,
    });
    return parsed.data.access_token;
  }
  return {
    async get() {
      const cached = cache.get(storeId);
      if (cached && clock.now().getTime() < cached.expiresAt - ACCESS_TOKEN_MARGIN_MS) {
        return cached.token;
      }
      return issue();
    },
    renew: issue,
  };
}

/** 一个卖家的 SP-API 客户端 */
export function createRealAmazonOrdersClient(
  http: HttpClient,
  tokens: SpApiTokens,
  options: { readonly sellerId: string; readonly quota: SpApiQuota },
): AmazonOrdersClient {
  const { sellerId, quota } = options;

  async function get(
    operation: SpApiOperation,
    path: string,
    query: Record<string, string>,
    priority: SpApiPriority,
  ): Promise<unknown> {
    const search = new URLSearchParams(query).toString();
    const url = `${SP_API_ENDPOINT}${path}${search ? `?${search}` : ''}`;
    const send = async (token: string) => {
      await quota.acquire(sellerId, operation, priority);
      return http.getJson(url, {
        operation,
        headers: { 'x-amz-access-token': token, accept: 'application/json' },
        onResponse: (status, headers) => {
          quota.observeRate(sellerId, operation, headers.get('x-amzn-ratelimit-limit'));
          if (status === 429) quota.throttled(sellerId, operation);
        },
      });
    };
    try {
      return await send(await tokens.get());
    } catch (error) {
      // 访问令牌过期或被撤销：换新再试一次（角色不够等原样再被拒，照常抛出）
      if (
        !(error instanceof ExternalCallFailedError) ||
        (error.status !== 401 && error.status !== 403)
      ) {
        throw error;
      }
      return send(await tokens.renew());
    }
  }

  return {
    async searchOrders({ lastUpdatedAfter, paginationToken, priority }) {
      const query: Record<string, string> = paginationToken
        ? { paginationToken, includedData: INCLUDED_DATA }
        : {
            lastUpdatedAfter: lastUpdatedAfter.toISOString(),
            includedData: INCLUDED_DATA,
            maxResultsPerPage: String(PAGE_SIZE),
          };
      const parsed = searchSchema.safeParse(
        await get('searchOrders', ORDERS_PATH, query, priority ?? 'high'),
      );
      if (!parsed.success) throw contractError('searchOrders');
      return {
        orders: parsed.data.orders.map(toOrder),
        nextToken: parsed.data.pagination?.nextToken ?? null,
      };
    },
    async getOrder(orderId, options) {
      let body: unknown;
      try {
        body = await get(
          'getOrder',
          `${ORDERS_PATH}/${encodeURIComponent(orderId)}`,
          { includedData: INCLUDED_DATA },
          options?.priority ?? 'high',
        );
      } catch (error) {
        if (error instanceof ExternalCallFailedError && error.status === 404) return null;
        throw error;
      }
      const parsed = getOrderSchema.safeParse(body);
      if (!parsed.success) throw contractError('getOrder');
      return toOrder(parsed.data.order);
    },
    async marketplaceParticipations() {
      const parsed = participationsSchema.safeParse(
        await get(
          'getMarketplaceParticipations',
          '/sellers/v1/marketplaceParticipations',
          {},
          'high',
        ),
      );
      if (!parsed.success) throw contractError('getMarketplaceParticipations');
      return { marketplaceIds: parsed.data.payload.map((p) => p.marketplace.id) };
    },
  };
}

/** 每个调用都以这个错误失败（不在构造时抛：取客户端的代码照常运行，调用时才知道） */
function failing(error: (operation: string) => Error): AmazonOrdersClient {
  const fail = (operation: string) => Promise.reject(error(operation));
  return {
    searchOrders: () => fail('searchOrders'),
    getOrder: () => fail('getOrder'),
    marketplaceParticipations: () => fail('getMarketplaceParticipations'),
  };
}

/** 本进程共用的配额（所有店铺，按卖家 × 接口分桶） */
let sharedQuota: SpApiQuota | undefined;

/** 按运行配置建一个店铺的真实现（IntegrationClients.forStore 调用） */
export function createRealAmazonOrders(context: RealClientContext): AmazonOrdersClient {
  const { storeId, storePlatformId: sellerId, spApi, credentialVault, clock } = context;
  if (!spApi || !credentialVault) {
    // 资质还没到位（用户 2026-10-04 口径）：不算连接失败，店铺为未连接
    return failing(
      (operation) =>
        new ClientNotConfiguredError(
          SYSTEM,
          operation,
          '没有配置 SP-API 应用凭据与主密钥（SP_API_CLIENT_ID 等）',
        ),
    );
  }
  if (!storeId || !sellerId || !SELLER_ID.test(sellerId)) {
    // 店铺登记错了：照常算连接失败（连续 3 次为连接异常），管理员在 P18 看得到
    return failing(
      (operation) =>
        new ExternalCallFailedError(SYSTEM, operation, {
          message: `平台标识不是亚马逊卖家 ID：${sellerId ?? ''}`,
          retryable: false,
        }),
    );
  }
  sharedQuota ??= new SpApiQuota(clock);
  const http = createHttpClient(SYSTEM, { recorder: context.callRecorder, storeId });
  const tokens = createSpApiTokens(http, {
    storeId,
    credentials: spApi,
    vault: credentialVault,
    clock,
  });
  return createRealAmazonOrdersClient(http, tokens, { sellerId, quota: sharedQuota });
}

/**
 * 录入某店铺的卖家授权刷新令牌（部署子命令 sp-api-token 经 integration 的入口调用）：主密钥加密存库，覆盖旧的；
 * 本进程缓存的访问令牌作废
 */
export async function storeSpApiRefreshToken(
  vault: CredentialVault,
  storeId: string,
  refreshToken: string,
  now: Date,
): Promise<void> {
  await vault.write(SP_API_REFRESH_TOKEN, storeId, {
    secret: refreshToken,
    issuedAt: now,
    expiresAt: new Date(now.getTime() + REFRESH_TOKEN_RECORD_MS),
  });
  accessTokens.delete(storeId);
}
