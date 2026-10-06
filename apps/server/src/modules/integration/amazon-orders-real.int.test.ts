import { and, eq } from 'drizzle-orm';
import { MockAgent } from 'undici';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestDatabase,
  createTestRuntime,
  type TestDatabase,
  type TestRuntime,
} from '../../../test/database';
import {
  createRealAmazonOrders,
  createRealAmazonOrdersClient,
  createSpApiTokens,
  SP_API_ENDPOINT,
  SP_API_REFRESH_TOKEN,
  storeSpApiRefreshToken,
} from './amazon-orders-real';
import { noCallRecords } from './call-records';
import { databaseCredentialVault, openSecret } from './credential-vault';
import { ClientNotConfiguredError, ExternalCallFailedError } from './faults';
import { createHttpClient } from './http';
import { MailRecipientGuard } from './mail-recipient-guard';
import { credential } from './schema';
import { SpApiQuota } from './sp-api-quota';

/*
 * SP-API 订单的真实现（待办 12；规格 order「SP-API Orders v2026-01-01，只用非受限角色；每个『卖家 × 接口』共享令牌桶，增量优先，
 * 配额以响应头 x-amzn-RateLimit-Limit 为准；刷新令牌加密存库」、ADR 0011、0013）：真实现 + 本测试的库（integration.credential）+
 * 手动时钟，LWA 与 SP-API 用 undici MockAgent 按 URL 回放照官方模型文件写的返回，没登记的请求直接失败（不连外网）。
 * 令牌桶的等待交给测试控制：每次要等时登记一个待放行的等待，测试放行时把手动时钟推进这么久。
 */

const SELLER = 'A3KA8V1T6RW2NB';
const STORE_ID = '0190a5c4-0000-7000-8000-000000000021';
const CREDENTIALS = { clientId: 'amzn1.application-oa2-client.test', clientSecret: 'lwa-secret' };
const MASTER_KEY = Buffer.alloc(32, 0x5a);
const ORDERS = '/orders/2026-01-01/orders';

let database: TestDatabase;
let t: TestRuntime;
let agent: MockAgent;
/** 换令牌时提交的表单（按先后） */
let grants: URLSearchParams[];
/** SP-API 请求（按到达先后）：路径与带的访问令牌 */
let requests: { path: string; token: string }[];
/** 令牌桶要等的时长（毫秒），测试逐个放行 */
let pendingWaits: { ms: number; release: () => void }[];
let quota: SpApiQuota;

beforeAll(async () => {
  database = await createTestDatabase();
  t = await createTestRuntime(database.url);
});

afterAll(async () => {
  await t.close();
  await database.drop();
});

beforeEach(async () => {
  agent = new MockAgent();
  agent.disableNetConnect();
  grants = [];
  requests = [];
  pendingWaits = [];
  quota = new SpApiQuota(
    t.clock,
    (ms) =>
      new Promise<void>((resolve) => {
        pendingWaits.push({
          ms,
          release: () => {
            t.clock.advance({ milliseconds: ms });
            resolve();
          },
        });
      }),
  );
  await storeSpApiRefreshToken(vault(), STORE_ID, 'Atzr|refresh-token-1', t.clock.now());
});

afterEach(async () => {
  await agent.close();
});

const vault = () => databaseCredentialVault(t.runtime, MASTER_KEY)!;
const lwa = () => agent.get('https://api.amazon.com');
const spApi = () => agent.get(SP_API_ENDPOINT);

/** 请求头的值（MockAgent 给的请求头可能是对象、数组或 Headers，名字大小写不定） */
function headerOf(headers: unknown, name: string): string {
  if (headers instanceof Headers) return headers.get(name) ?? '';
  const entries: [string, unknown][] = Array.isArray(headers)
    ? Array.from({ length: headers.length / 2 }, (_, i) => [
        String(headers[i * 2]),
        headers[i * 2 + 1],
      ])
    : Object.entries((headers ?? {}) as Record<string, unknown>);
  const found = entries.find(([key]) => key.toLowerCase() === name);
  return found ? String(found[1]) : '';
}

/** 换一次访问令牌（LWA refresh_token，1 小时过期） */
function tokenGrant(accessToken: string) {
  lwa()
    .intercept({ path: '/auth/o2/token', method: 'POST' })
    .reply(200, (options) => {
      grants.push(new URLSearchParams(typeof options.body === 'string' ? options.body : ''));
      return {
        access_token: accessToken,
        refresh_token: 'Atzr|refresh-token-1',
        token_type: 'bearer',
        expires_in: 3600,
      };
    });
}

/** 一笔订单（v2026-01-01 的 Order，带 FULFILLMENT、PROCEEDS、RECIPIENT、PACKAGES） */
const ORDER = {
  orderId: '113-5566112-7788990',
  createdTime: '2026-09-06T12:15:00Z',
  lastUpdatedTime: '2026-09-08T05:40:00Z',
  salesChannel: {
    channelName: 'AMAZON',
    marketplaceId: 'ATVPDKIKX0DER',
    marketplaceName: 'Amazon.com',
  },
  fulfillment: {
    fulfillmentStatus: 'SHIPPED',
    fulfilledBy: 'MERCHANT',
    fulfillmentServiceLevel: 'STANDARD',
    shipByWindow: {
      earliestDateTime: '2026-09-06T12:15:00Z',
      latestDateTime: '2026-09-07T15:59:00Z',
    },
    deliverByWindow: {
      earliestDateTime: '2026-09-09T07:00:00Z',
      latestDateTime: '2026-09-12T15:59:00Z',
    },
  },
  proceeds: { grandTotal: { amount: '59.99', currencyCode: 'USD' } },
  recipient: {
    deliveryAddress: {
      city: 'Phoenix',
      stateOrRegion: 'AZ',
      countryCode: 'US',
      addressType: 'RESIDENTIAL',
    },
  },
  orderItems: [
    {
      orderItemId: '68828574383266',
      quantityOrdered: 1,
      product: { asin: 'B0C1V2GY01', title: 'V2 车载吸尘器 灰色', sellerSku: 'FC-V2-GY' },
    },
  ],
  packages: [
    {
      packageReferenceId: '1',
      carrier: 'UPS',
      trackingNumber: '1Z4R28830366677120',
      packageStatus: { status: 'IN_TRANSIT' },
    },
  ],
};

/** 一次 searchOrders 的返回；rate 给出时带 x-amzn-RateLimit-Limit 响应头 */
function searchReply(
  body: unknown = { orders: [] },
  options: { status?: number; rate?: string; times?: number } = {},
) {
  const scope = spApi()
    .intercept({ path: (path) => path.startsWith(`${ORDERS}?`), method: 'GET' })
    .reply(
      options.status ?? 200,
      (opts) => {
        requests.push({
          path: String(opts.path),
          token: headerOf(opts.headers, 'x-amz-access-token'),
        });
        return body;
      },
      options.rate ? { headers: { 'x-amzn-RateLimit-Limit': options.rate } } : {},
    );
  if (options.times) scope.times(options.times);
}

function client(sellerId = SELLER) {
  const http = createHttpClient('sp_api', { dispatcher: agent, storeId: STORE_ID });
  const tokens = createSpApiTokens(http, {
    storeId: STORE_ID,
    credentials: CREDENTIALS,
    vault: vault(),
    clock: t.clock,
    cache: new Map(),
  });
  return createRealAmazonOrdersClient(http, tokens, { sellerId, quota });
}

/** 库里这个店铺的刷新令牌行 */
async function storedRow() {
  const [row] = await t.runtime.db
    .select()
    .from(credential)
    .where(and(eq(credential.system, SP_API_REFRESH_TOKEN), eq(credential.storeId, STORE_ID)));
  return row;
}

describe('SP-API 卖家授权与访问令牌', () => {
  it('刷新令牌在库中为密文（主密钥能解开、换个附加数据解不开）；第一次调用以刷新令牌换访问令牌，之后沿用，到期前 1 分钟换新', async () => {
    const row = await storedRow();
    expect(row).toBeDefined();
    expect(row!.ciphertext.toString('utf8')).not.toContain('refresh-token-1');
    expect(row!.ciphertext.toString('hex')).not.toContain(
      Buffer.from('refresh-token-1').toString('hex'),
    );
    expect(openSecret(MASTER_KEY, `${SP_API_REFRESH_TOKEN}:${STORE_ID}`, row!)).toBe(
      'Atzr|refresh-token-1',
    );
    expect(() => openSecret(MASTER_KEY, `shopify:${STORE_ID}`, row!)).toThrow();

    const c = client();
    tokenGrant('Atza|access-1');
    searchReply(undefined, { times: 2 });
    await c.searchOrders({ lastUpdatedAfter: t.clock.now() });
    t.clock.advance({ minutes: 58 });
    await c.searchOrders({ lastUpdatedAfter: t.clock.now() });
    expect(grants.map((g) => Object.fromEntries(g))).toEqual([
      {
        grant_type: 'refresh_token',
        refresh_token: 'Atzr|refresh-token-1',
        client_id: CREDENTIALS.clientId,
        client_secret: CREDENTIALS.clientSecret,
      },
    ]);
    expect(requests.map((r) => r.token)).toEqual(['Atza|access-1', 'Atza|access-1']);

    // 59 分钟后：离过期不到 1 分钟，换新
    t.clock.advance({ minutes: 1 });
    tokenGrant('Atza|access-2');
    searchReply();
    await c.searchOrders({ lastUpdatedAfter: t.clock.now() });
    expect(grants).toHaveLength(2);
    expect(requests.at(-1)?.token).toBe('Atza|access-2');
  });

  it('访问令牌被拒（403 Unauthorized）时换新再试一次；新令牌也被拒以 403 失败', async () => {
    const c = client();
    tokenGrant('Atza|stale');
    searchReply(
      { errors: [{ code: 'Unauthorized', message: 'The access token you provided has expired.' }] },
      { status: 403 },
    );
    tokenGrant('Atza|fresh');
    searchReply();
    await expect(c.searchOrders({ lastUpdatedAfter: t.clock.now() })).resolves.toEqual({
      orders: [],
      nextToken: null,
    });
    expect(requests.map((r) => r.token)).toEqual(['Atza|stale', 'Atza|fresh']);

    tokenGrant('Atza|denied');
    searchReply(
      { errors: [{ code: 'Unauthorized', message: 'Access to requested resource is denied.' }] },
      { status: 403, times: 2 },
    );
    tokenGrant('Atza|denied-again');
    const c2 = client();
    await expect(c2.searchOrders({ lastUpdatedAfter: t.clock.now() })).rejects.toMatchObject({
      name: 'ExternalCallFailedError',
      status: 403,
    });
  });

  it('没录入卖家授权的店铺以「未配置」失败（不算连接失败）；没有 LWA 应用凭据、平台标识不是卖家 ID 的情形', async () => {
    await t.runtime.db.delete(credential).where(eq(credential.storeId, STORE_ID));
    await expect(client().searchOrders({ lastUpdatedAfter: t.clock.now() })).rejects.toBeInstanceOf(
      ClientNotConfiguredError,
    );

    const context = {
      storeId: STORE_ID,
      storePlatformId: SELLER,
      mailRecipientGuard: new MailRecipientGuard({ allowlistOnly: true, allowlist: [] }),
      dingtalk: null,
      google: null,
      shopify: null,
      amazonSqs: null,
      callRecorder: noCallRecords,
      credentialVault: vault(),
      clock: t.clock,
    };
    await expect(
      createRealAmazonOrders({ ...context, spApi: null }).getOrder('113-5566112-7788990'),
    ).rejects.toBeInstanceOf(ClientNotConfiguredError);
    await expect(
      createRealAmazonOrders({
        ...context,
        spApi: CREDENTIALS,
        storePlatformId: 'forcome-mx.myshopify.com',
      }).searchOrders({ lastUpdatedAfter: t.clock.now() }),
    ).rejects.toBeInstanceOf(ExternalCallFailedError);
  });
});

describe('SP-API 订单', () => {
  it('searchOrders：带 lastUpdatedAfter、非受限的四个数据集与每页 100；下一页只带分页令牌；返回映射成镜像要的字段', async () => {
    const c = client();
    tokenGrant('Atza|access');
    searchReply({ orders: [ORDER], pagination: { nextToken: 'page-2' } });
    const page = await c.searchOrders({ lastUpdatedAfter: new Date('2026-09-11T02:15:00Z') });
    const first = new URL(`${SP_API_ENDPOINT}${requests[0]!.path}`);
    expect(Object.fromEntries(first.searchParams)).toEqual({
      lastUpdatedAfter: '2026-09-11T02:15:00.000Z',
      includedData: 'FULFILLMENT,PROCEEDS,RECIPIENT,PACKAGES',
      maxResultsPerPage: '100',
    });
    expect(page).toEqual({
      nextToken: 'page-2',
      orders: [
        {
          orderId: '113-5566112-7788990',
          createdAt: new Date('2026-09-06T12:15:00Z'),
          updatedAt: new Date('2026-09-08T05:40:00Z'),
          marketplaceId: 'ATVPDKIKX0DER',
          status: 'SHIPPED',
          fulfilledBy: 'MERCHANT',
          shipBy: new Date('2026-09-07T15:59:00Z'),
          deliverBy: new Date('2026-09-12T15:59:00Z'),
          total: { amount: '59.99', currency: 'USD' },
          items: [
            { title: 'V2 车载吸尘器 灰色', sku: 'FC-V2-GY', asin: 'B0C1V2GY01', quantity: 1 },
          ],
          shipTo: { city: 'Phoenix', stateOrRegion: 'AZ', postalCode: null, countryCode: 'US' },
          packages: [{ carrier: 'UPS', trackingNumber: '1Z4R28830366677120' }],
        },
      ],
    });

    searchReply({ orders: [] });
    await c.searchOrders({ lastUpdatedAfter: new Date(), paginationToken: 'page-2' });
    const second = new URL(`${SP_API_ENDPOINT}${requests[1]!.path}`);
    expect(Object.fromEntries(second.searchParams)).toEqual({
      paginationToken: 'page-2',
      includedData: 'FULFILLMENT,PROCEEDS,RECIPIENT,PACKAGES',
    });
  });

  it('待付款订单没有金额、别的币种不认：金额为 null；没有履约信息时状态记 PENDING', async () => {
    const c = client();
    tokenGrant('Atza|access');
    const pending = {
      ...ORDER,
      fulfillment: undefined,
      proceeds: undefined,
      packages: undefined,
      recipient: undefined,
    };
    const euro = {
      ...ORDER,
      orderId: '113-0000000-0000002',
      proceeds: { grandTotal: { amount: '50.00', currencyCode: 'EUR' } },
    };
    searchReply({ orders: [pending, euro] });
    const { orders } = await c.searchOrders({ lastUpdatedAfter: t.clock.now() });
    expect(orders[0]).toMatchObject({
      status: 'PENDING',
      fulfilledBy: null,
      total: null,
      shipTo: null,
      packages: [],
    });
    expect(orders[1]?.total).toBeNull();
  });

  it('getOrder：按订单号取一笔；没有（404）为 null；读卖家参与的站点（测试连接）', async () => {
    const c = client();
    tokenGrant('Atza|access');
    spApi()
      .intercept({
        path: `${ORDERS}/113-5566112-7788990?includedData=FULFILLMENT%2CPROCEEDS%2CRECIPIENT%2CPACKAGES`,
        method: 'GET',
      })
      .reply(200, { order: ORDER });
    expect((await c.getOrder('113-5566112-7788990'))?.orderId).toBe('113-5566112-7788990');

    spApi()
      .intercept({
        path: (path) => path.startsWith(`${ORDERS}/113-0000000-0000000`),
        method: 'GET',
      })
      .reply(404, { errors: [{ code: 'NotFound', message: 'Order not found' }] });
    expect(await c.getOrder('113-0000000-0000000')).toBeNull();

    spApi()
      .intercept({ path: '/sellers/v1/marketplaceParticipations', method: 'GET' })
      .reply(200, {
        payload: [
          {
            marketplace: { id: 'ATVPDKIKX0DER', countryCode: 'US' },
            participation: { isParticipating: true },
          },
          {
            marketplace: { id: 'A2EUQ1WTGCTBG2', countryCode: 'CA' },
            participation: { isParticipating: true },
          },
        ],
      });
    expect(await c.marketplaceParticipations()).toEqual({
      marketplaceIds: ['ATVPDKIKX0DER', 'A2EUQ1WTGCTBG2'],
    });
  });

  it('返回与接口约定不符时以不可重试的错误失败', async () => {
    const c = client();
    tokenGrant('Atza|access');
    searchReply({ orders: [{ orderId: 1 }] });
    await expect(c.searchOrders({ lastUpdatedAfter: t.clock.now() })).rejects.toMatchObject({
      retryable: false,
    });
  });
});

describe('SP-API 令牌桶（每个「卖家 × 接口」一个，增量优先，配额以响应头为准）', () => {
  it('桶空了调用排队等令牌而不是失败；排队的高优先级（增量）先于低优先级（回补、对账）；等多久按响应头给的 rate', async () => {
    const c = client();
    tokenGrant('Atza|access');
    // 突发 20 次：立即发出，响应头说这个卖家的 searchOrders 每秒恢复 1 个
    searchReply(undefined, { rate: '1.0', times: 22 });
    for (let i = 0; i < 20; i += 1) {
      await c.searchOrders({ lastUpdatedAfter: new Date(Date.UTC(2026, 8, 1, 0, i)) });
    }
    expect(pendingWaits).toEqual([]);
    expect(quota.available(SELLER, 'searchOrders')).toBeLessThan(1);

    // 桶空了：先来一个低优先级（回补），再来一个高优先级（增量）——都排队，不报错
    const low = c.searchOrders({
      lastUpdatedAfter: new Date('2026-06-13T00:00:00Z'),
      priority: 'low',
    });
    const high = c.searchOrders({
      lastUpdatedAfter: new Date('2026-09-11T02:16:00Z'),
      priority: 'high',
    });
    await vi.waitFor(() => expect(quota.queued(SELLER, 'searchOrders')).toBe(2));
    expect(requests).toHaveLength(20);
    // 按响应头的 1 个 / 秒：等 1 秒来一个令牌（默认计划 0.0056 个 / 秒要等约 3 分钟）
    expect(pendingWaits.map((w) => w.ms)).toEqual([1000]);

    pendingWaits.shift()!.release();
    await vi.waitFor(() => expect(requests).toHaveLength(21));
    expect(requests[20]!.path).toContain('lastUpdatedAfter=2026-09-11T02%3A16%3A00.000Z');
    await expect(high).resolves.toEqual({ orders: [], nextToken: null });

    await vi.waitFor(() => expect(pendingWaits).toHaveLength(1));
    pendingWaits.shift()!.release();
    await expect(low).resolves.toEqual({ orders: [], nextToken: null });
    expect(requests[21]!.path).toContain('lastUpdatedAfter=2026-06-13');
  });

  it('不同的卖家、不同的接口各一个桶；收到 429 时清空桶，按 rate 重新攒', async () => {
    const other = client('A1FD7Q2M9XK3LC');
    tokenGrant('Atza|access');
    // 另一个卖家的桶是满的：立即发出
    searchReply();
    await other.searchOrders({ lastUpdatedAfter: t.clock.now() });
    expect(pendingWaits).toEqual([]);

    // 429：亚马逊那边的桶空了，我们的也清空（响应头给 0.5 个 / 秒），下一次要排队等 2 秒
    searchReply(
      { errors: [{ code: 'QuotaExceeded', message: 'You exceeded your quota' }] },
      { status: 429, rate: '0.5' },
    );
    await expect(other.searchOrders({ lastUpdatedAfter: t.clock.now() })).rejects.toMatchObject({
      status: 429,
      retryable: true,
    });
    searchReply();
    const next = other.searchOrders({ lastUpdatedAfter: t.clock.now() });
    await vi.waitFor(() => expect(pendingWaits.map((w) => w.ms)).toEqual([2000]));
    pendingWaits.shift()!.release();
    await next;
    // getOrder 是另一个桶：不受影响
    spApi()
      .intercept({ path: (path) => path.startsWith(`${ORDERS}/113-`), method: 'GET' })
      .reply(200, { order: ORDER });
    await other.getOrder('113-5566112-7788990');
    expect(pendingWaits).toEqual([]);
  });
});
