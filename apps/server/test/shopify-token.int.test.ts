import { and, eq } from 'drizzle-orm';
import { MockAgent } from 'undici';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openSecret } from '../src/modules/integration/credential-vault';
import { databaseCredentialVault } from '../src/modules/integration';
import { ExternalCallFailedError } from '../src/modules/integration/faults';
import { createHttpClient } from '../src/modules/integration/http';
import { credential } from '../src/modules/integration/schema';
import {
  createRealShopifyClient,
  createShopifyTokens,
  SHOPIFY_API_VERSION,
} from '../src/modules/integration/shopify-real';
import { startTestHarness, TEST_CREDENTIAL_MASTER_KEY, type TestHarness } from './harness';

/*
 * Shopify 的访问令牌与 Admin GraphQL 真实现（待办 11；规格 order「令牌 24 小时过期、每 20 小时提前刷新（动态凭据用主密钥 AES-GCM 加密存库）」、
 * ADR 0013）：真实现 + 本测试的库（integration.credential）+ 手动时钟，Shopify 用 undici MockAgent 按 URL 回放照官方文档写的返回，
 * 没登记的请求直接失败（不连外网）。
 */

const SHOP = 'forcome-mx.myshopify.com';
const STORE_ID = '0190a5c4-0000-7000-8000-000000000011';
const GRAPHQL = `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
const CREDENTIALS = { clientId: 'client-id-123', clientSecret: 'client-secret-456' };

let t: TestHarness;
let agent: MockAgent;
/** 换令牌时提交的表单（按先后） */
let grants: URLSearchParams[];
/** GraphQL 请求带的令牌（按先后） */
let usedTokens: string[];

beforeAll(async () => {
  t = await startTestHarness();
});

afterAll(async () => {
  await t.close();
});

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  grants = [];
  usedTokens = [];
});

afterEach(async () => {
  await agent.close();
});

const shop = () => agent.get(`https://${SHOP}`);

/** 换一次令牌（client credentials，expires_in 恒为 86399） */
function tokenGrant(accessToken: string) {
  shop()
    .intercept({ path: '/admin/oauth/access_token', method: 'POST' })
    .reply(200, (options) => {
      grants.push(new URLSearchParams(typeof options.body === 'string' ? options.body : ''));
      return { access_token: accessToken, scope: 'read_orders,read_customers', expires_in: 86399 };
    });
}

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

/** 一次 orders 查询的返回（没有订单） */
function emptyOrders(status = 200) {
  shop()
    .intercept({ path: GRAPHQL, method: 'POST' })
    .reply(status, (options) => {
      usedTokens.push(headerOf(options.headers, 'x-shopify-access-token'));
      return status === 200
        ? { data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } }
        : {
            errors: '[API] Invalid API key or access token (unrecognized login or wrong password)',
          };
    });
}

function client() {
  const http = createHttpClient('shopify', { dispatcher: agent, storeId: STORE_ID });
  const tokens = createShopifyTokens(http, {
    shop: SHOP,
    storeId: STORE_ID,
    credentials: CREDENTIALS,
    vault: databaseCredentialVault(t.runtime, TEST_CREDENTIAL_MASTER_KEY)!,
    clock: t.clock,
  });
  return createRealShopifyClient(http, tokens, SHOP);
}

/** 库里这个店铺的 Shopify 凭据行（密文、IV、认证标签与时间） */
async function storedRow() {
  const [row] = await t.runtime.db
    .select()
    .from(credential)
    .where(and(eq(credential.system, 'shopify'), eq(credential.storeId, STORE_ID)));
  return row;
}

const listOrders = () => client().listOrders({ updatedSince: t.clock.now() });

describe('Shopify 访问令牌', () => {
  it('第一次调用以客户端凭据换令牌（client credentials），令牌在库中为密文、用主密钥能解开，过期时间为 24 小时后', async () => {
    tokenGrant('shpat_first_token');
    emptyOrders();
    await expect(listOrders()).resolves.toEqual({ orders: [], nextCursor: null });

    expect(grants.map((g) => Object.fromEntries(g))).toEqual([
      {
        grant_type: 'client_credentials',
        client_id: 'client-id-123',
        client_secret: 'client-secret-456',
      },
    ]);
    expect(usedTokens).toEqual(['shpat_first_token']);
    const row = await storedRow();
    expect(row).toBeDefined();
    // 库里没有明文
    expect(row!.ciphertext.toString('utf8')).not.toContain('shpat_first_token');
    expect(row!.ciphertext.toString('hex')).not.toContain(
      Buffer.from('shpat_first_token').toString('hex'),
    );
    expect(openSecret(TEST_CREDENTIAL_MASTER_KEY, `shopify:${STORE_ID}`, row!)).toBe(
      'shpat_first_token',
    );
    // 附加数据把密文绑在这一行上：换个店铺就解不开
    expect(() => openSecret(TEST_CREDENTIAL_MASTER_KEY, 'shopify:other', row!)).toThrow();
    expect(row!.issuedAt).toEqual(t.clock.now());
    expect(row!.expiresAt.getTime() - row!.issuedAt.getTime()).toBe(86399 * 1000);
  });

  it('不满 20 小时沿用库里的令牌；满 20 小时（临近 24 小时过期）提前换新，库里换成新令牌的密文', async () => {
    t.clock.advance({ hours: 19, minutes: 59 });
    emptyOrders();
    await listOrders();
    expect(grants).toHaveLength(0);
    expect(usedTokens).toEqual(['shpat_first_token']);

    const before = await storedRow();
    t.clock.advance({ minutes: 1 });
    tokenGrant('shpat_second_token');
    emptyOrders();
    await listOrders();
    expect(grants).toHaveLength(1);
    expect(usedTokens).toEqual(['shpat_first_token', 'shpat_second_token']);
    const after = await storedRow();
    expect(after!.issuedAt).toEqual(t.clock.now());
    expect(after!.iv.equals(before!.iv)).toBe(false);
    expect(openSecret(TEST_CREDENTIAL_MASTER_KEY, `shopify:${STORE_ID}`, after!)).toBe(
      'shpat_second_token',
    );
  });

  it('令牌被拒（401）时立即换新再试一次；新令牌也被拒则以 401 失败', async () => {
    t.clock.advance({ hours: 1 });
    emptyOrders(401);
    tokenGrant('shpat_third_token');
    emptyOrders();
    await listOrders();
    expect(usedTokens).toEqual(['shpat_second_token', 'shpat_third_token']);

    emptyOrders(401);
    tokenGrant('shpat_fourth_token');
    emptyOrders(401);
    const error = await listOrders().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExternalCallFailedError);
    expect((error as ExternalCallFailedError).status).toBe(401);
  });

  it('主密钥换了（库里的密文解不开）：当作没有令牌，重新换一个', async () => {
    const other = databaseCredentialVault(t.runtime, Buffer.alloc(32, 1))!;
    expect(await other.read('shopify', STORE_ID)).toBeNull();
  });
});

describe('Admin GraphQL 订单查询', () => {
  it('按 updated_at 过滤、sortKey UPDATED_AT 分页；返回的订单转成镜像要的字段', async () => {
    t.clock.advance({ hours: 21 });
    tokenGrant('shpat_orders_token');
    let body: { query: string; variables: Record<string, unknown> } | undefined;
    shop()
      .intercept({ path: GRAPHQL, method: 'POST' })
      .reply(200, (options) => {
        body = JSON.parse(typeof options.body === 'string' ? options.body : '{}') as typeof body;
        return {
          data: {
            orders: {
              pageInfo: { hasNextPage: true, endCursor: 'cursor-2' },
              nodes: [
                {
                  id: 'gid://shopify/Order/5550001',
                  name: '#1063',
                  email: 'olivia.turner@example.com',
                  createdAt: '2026-08-05T05:30:00Z',
                  updatedAt: '2026-08-09T08:45:00Z',
                  cancelledAt: null,
                  displayFinancialStatus: 'PAID',
                  displayFulfillmentStatus: 'FULFILLED',
                  totalPriceSet: { shopMoney: { amount: '54.99', currencyCode: 'USD' } },
                  lineItems: { nodes: [{ title: 'V2 车载吸尘器', sku: 'FC-V2', quantity: 1 }] },
                  shippingAddress: {
                    name: 'Olivia Turner',
                    address1: '1550 Larimer St',
                    address2: null,
                    city: 'Denver',
                    provinceCode: 'CO',
                    zip: '80202',
                    countryCodeV2: 'US',
                    phone: null,
                  },
                  fulfillments: [
                    { trackingInfo: [{ company: 'UPS', number: '1Z9X4E770377712345' }] },
                  ],
                },
              ],
            },
          },
          extensions: { cost: { requestedQueryCost: 152 } },
        };
      });
    const page = await client().listOrders({
      updatedSince: new Date('2026-09-11T02:18:00.000Z'),
      after: 'cursor-1',
    });
    expect(body?.variables).toEqual({
      first: 100,
      after: 'cursor-1',
      query: "updated_at:>='2026-09-11T02:18:00Z'",
    });
    expect(body?.query).toContain('sortKey: UPDATED_AT');
    expect(page.nextCursor).toBe('cursor-2');
    expect(page.orders).toEqual([
      {
        id: 'gid://shopify/Order/5550001',
        name: '#1063',
        email: 'olivia.turner@example.com',
        createdAt: new Date('2026-08-05T05:30:00Z'),
        updatedAt: new Date('2026-08-09T08:45:00Z'),
        cancelledAt: null,
        financialStatus: 'PAID',
        fulfillmentStatus: 'FULFILLED',
        total: { amount: '54.99', currency: 'USD' },
        lineItems: [{ title: 'V2 车载吸尘器', sku: 'FC-V2', quantity: 1 }],
        shippingAddress: {
          name: 'Olivia Turner',
          address1: '1550 Larimer St',
          address2: null,
          city: 'Denver',
          province: 'CO',
          zip: '80202',
          country: 'US',
          phone: null,
        },
        tracking: [{ company: 'UPS', number: '1Z9X4E770377712345' }],
      },
    ]);
  });

  it('按订单名只认名字完全一致的那笔；GraphQL 限流（THROTTLED）可重试，其余 errors 不可重试', async () => {
    shop()
      .intercept({ path: GRAPHQL, method: 'POST' })
      .reply(200, {
        data: {
          orders: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [],
          },
        },
      });
    await expect(client().findOrderByName('#1063')).resolves.toBeNull();

    shop()
      .intercept({ path: GRAPHQL, method: 'POST' })
      .reply(200, { errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] });
    const throttled = await client()
      .shop()
      .catch((e: unknown) => e);
    expect(throttled).toBeInstanceOf(ExternalCallFailedError);
    expect((throttled as ExternalCallFailedError).retryable).toBe(true);

    shop()
      .intercept({ path: GRAPHQL, method: 'POST' })
      .reply(200, {
        errors: [
          { message: 'Access denied for orders field.', extensions: { code: 'ACCESS_DENIED' } },
        ],
      });
    const denied = await client()
      .shop()
      .catch((e: unknown) => e);
    expect((denied as ExternalCallFailedError).retryable).toBe(false);
    expect((denied as Error).message).toContain('Access denied for orders field.');
  });
});
