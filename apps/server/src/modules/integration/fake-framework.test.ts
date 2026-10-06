import { getDemoFixture, type DemoFixture } from '@forcome/fixtures';
import { describe, expect, it } from 'vitest';
import {
  ConnectionLostError,
  createIntegrationClients,
  CursorExpiredError,
  defineClient,
  ExternalCallFailedError,
  ExternalTimeoutError,
  FakeNotAllowedError,
  FaultInjector,
  IntegrationClients,
  type FakeClient,
  type RealClientContext,
} from './index';

/*
 * Fake 框架的示范（ADR 0009 修订）：各外部客户端（Gmail、钉钉、SP-API、Shopify、汇率）在自己的待办里
 * 照这个样子定义「接口 + 真实现 + Fake」，并在 integration 的客户端清单里登记。
 *
 * 示范客户端是一个按游标增量拉取的外部数据源，形状类似 Gmail history.list 与订单增量同步。
 */
interface ExampleFeedClient {
  /** 取游标之后的新条目；cursor 为 null 表示全量拉取 */
  listChanges(cursor: string | null): Promise<{ items: string[]; cursor: string }>;
}

/** 示范 Fake：一个实例服务全部店铺，各店铺数据分开；测试往里放数据、注入故障 */
class FakeExampleFeed implements FakeClient<ExampleFeedClient> {
  readonly faults = new FaultInjector('example_feed');
  readonly #items = new Map<string, string[]>();

  add(storeId: string, ...items: string[]): void {
    this.#items.set(storeId, [...(this.#items.get(storeId) ?? []), ...items]);
  }

  client(storeId?: string): ExampleFeedClient {
    if (!storeId) throw new Error('店铺级客户端必须带店铺 ID');
    return {
      listChanges: async (cursor) => {
        // 每个操作开头都过一遍故障注入：记一次调用，有安排的故障就以对应错误结束
        await this.faults.check('listChanges');
        const all = this.#items.get(storeId) ?? [];
        const from = cursor === null ? 0 : Number(cursor);
        return { items: all.slice(from), cursor: String(all.length) };
      },
    };
  }

  reset(): void {
    this.#items.clear();
    this.faults.reset();
  }
}

const realCalls: string[] = [];
const exampleFeed = defineClient({
  system: 'example_feed',
  scope: 'store',
  createReal: ({ storeId }): ExampleFeedClient => ({
    listChanges: () => {
      realCalls.push(storeId ?? '');
      return Promise.resolve({ items: ['来自真实接口'], cursor: '1' });
    },
  }),
  createFake: () => new FakeExampleFeed(),
});

/** 示范全局客户端（钉钉、汇率这类按环境变量选择的） */
interface ExampleDirectoryClient {
  whoami(): Promise<string>;
}
const exampleDirectory = defineClient({
  system: 'example_directory',
  scope: 'global',
  createReal: (): ExampleDirectoryClient => ({ whoami: () => Promise.resolve('real') }),
  createFake: () => ({
    client: (): ExampleDirectoryClient => ({ whoami: () => Promise.resolve('fake') }),
    reset: () => undefined,
  }),
});

const definitions = [exampleFeed, exampleDirectory];
const fakeStore = { id: 'store-a', adapterMode: 'fake' } as const;
const realStore = { id: 'store-b', adapterMode: 'real' } as const;

describe('按店铺选择真实现或 Fake（店铺级客户端）', () => {
  it('店铺设为 Fake 时拿到 Fake，设为真实时拿到真实现', async () => {
    const clients = new IntegrationClients({ appEnv: 'test', definitions });
    clients.fake(exampleFeed).add('store-a', '来信 1');

    await expect(clients.forStore(exampleFeed, fakeStore).listChanges(null)).resolves.toEqual({
      items: ['来信 1'],
      cursor: '1',
    });
    await expect(clients.forStore(exampleFeed, realStore).listChanges(null)).resolves.toEqual({
      items: ['来自真实接口'],
      cursor: '1',
    });
    expect(realCalls).toContain('store-b');
  });

  it('同一个 Fake 按店铺分开数据，一个店铺看不到另一个店铺的数据', async () => {
    const clients = new IntegrationClients({ appEnv: 'test', definitions });
    clients.fake(exampleFeed).add('store-a', 'A 的来信');
    clients.fake(exampleFeed).add('store-c', 'C 的来信');

    const c = await clients
      .forStore(exampleFeed, { id: 'store-c', adapterMode: 'fake' })
      .listChanges(null);
    expect(c.items).toEqual(['C 的来信']);
  });

  it('全局客户端不能按店铺取，店铺级客户端不能当全局取', () => {
    const clients = new IntegrationClients({ appEnv: 'test', definitions });
    expect(() => clients.forStore(exampleDirectory, fakeStore)).toThrow(/全局客户端/);
    expect(() => clients.global(exampleFeed)).toThrow(/店铺级客户端/);
  });

  it('没有登记的客户端拿不到，避免漏登记后悄悄用了别的实现', () => {
    const clients = new IntegrationClients({ appEnv: 'test', definitions: [exampleDirectory] });
    expect(() => clients.forStore(exampleFeed, fakeStore)).toThrow(/未登记/);
    expect(() => clients.fake(exampleFeed)).toThrow(/未登记/);
  });
});

describe('全局客户端按环境变量选择', () => {
  it('非生产默认用 Fake，可用 CLIENT_MODE_<系统> 改成真实', async () => {
    const byDefault = new IntegrationClients({ appEnv: 'staging', definitions });
    await expect(byDefault.global(exampleDirectory).whoami()).resolves.toBe('fake');

    const configured = new IntegrationClients({
      appEnv: 'staging',
      definitions,
      clientModes: { example_directory: 'real' },
    });
    await expect(configured.global(exampleDirectory).whoami()).resolves.toBe('real');
  });

  it('生产默认用真实现', async () => {
    const clients = new IntegrationClients({ appEnv: 'production', definitions });
    await expect(clients.global(exampleDirectory).whoami()).resolves.toBe('real');
  });

  it('全局客户端的真实现一个进程只建一次（缓存访问凭证与长连接），并拿到钉钉凭据', () => {
    const contexts: RealClientContext[] = [];
    const counted = defineClient({
      system: 'counted_directory',
      scope: 'global',
      createReal: (context): ExampleDirectoryClient => {
        contexts.push(context);
        return { whoami: () => Promise.resolve('real') };
      },
      createFake: () => ({
        client: (): ExampleDirectoryClient => ({ whoami: () => Promise.resolve('fake') }),
        reset: () => undefined,
      }),
    });
    const credentials = { clientId: 'id', clientSecret: 'secret', agentId: '1' };
    const clients = new IntegrationClients({
      appEnv: 'production',
      definitions: [counted],
      dingtalk: credentials,
    });
    expect(clients.global(counted)).toBe(clients.global(counted));
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.dingtalk).toEqual(credentials);
  });

  it('配置了没有登记的全局客户端（多半是写错了系统名）拒绝启动', () => {
    expect(
      () =>
        new IntegrationClients({
          appEnv: 'staging',
          definitions,
          clientModes: { example_directroy: 'real' },
        }),
    ).toThrow(/CLIENT_MODE_EXAMPLE_DIRECTROY/);
    // 店铺级客户端按店铺配置，不接受环境变量
    expect(
      () =>
        new IntegrationClients({
          appEnv: 'staging',
          definitions,
          clientModes: { example_feed: 'fake' },
        }),
    ).toThrow(/店铺级/);
  });
});

describe('生产环境不允许 Fake', () => {
  it('店铺配置为 Fake 时拒绝，不会退回到真实现', () => {
    const clients = new IntegrationClients({ appEnv: 'production', definitions });
    expect(() => clients.forStore(exampleFeed, fakeStore)).toThrow(FakeNotAllowedError);
  });

  it('拿不到 Fake 实例；全局客户端配置为 Fake 时构造即报错', () => {
    const clients = new IntegrationClients({ appEnv: 'production', definitions });
    expect(() => clients.fake(exampleFeed)).toThrow(FakeNotAllowedError);
    expect(
      () =>
        new IntegrationClients({
          appEnv: 'production',
          definitions,
          clientModes: { example_directory: 'fake' },
        }),
    ).toThrow(FakeNotAllowedError);
  });
});

describe('故障注入：失败、超时、游标过期、断线恢复', () => {
  function setup() {
    const clients = new IntegrationClients({ appEnv: 'test', definitions });
    const fake = clients.fake(exampleFeed);
    fake.add('store-a', '来信 1', '来信 2');
    return { fake, feed: clients.forStore(exampleFeed, fakeStore) };
  }

  it('安排一次失败：第一次调用失败，第二次成功（调用方的重试能被验证）', async () => {
    const { fake, feed } = setup();
    fake.faults.failNext({ kind: 'error', status: 503 });

    const failure = feed.listChanges(null);
    await expect(failure).rejects.toBeInstanceOf(ExternalCallFailedError);
    await expect(failure).rejects.toMatchObject({
      system: 'example_feed',
      operation: 'listChanges',
      status: 503,
      retryable: true,
    });
    await expect(feed.listChanges(null)).resolves.toMatchObject({ items: ['来信 1', '来信 2'] });
    expect(fake.faults.calls).toEqual(['listChanges', 'listChanges']);
  });

  it('连续失败 N 次，可限定只对某个操作生效', async () => {
    const { fake, feed } = setup();
    fake.faults.failNext({ kind: 'error' }, { times: 3, operation: 'listChanges' });
    for (let i = 0; i < 3; i += 1) {
      await expect(feed.listChanges(null)).rejects.toBeInstanceOf(ExternalCallFailedError);
    }
    await expect(feed.listChanges(null)).resolves.toBeDefined();
  });

  it('超时立即以超时错误结束，测试不需要等待', async () => {
    const { fake, feed } = setup();
    fake.faults.failNext({ kind: 'timeout' });
    await expect(feed.listChanges('1')).rejects.toBeInstanceOf(ExternalTimeoutError);
  });

  it('游标过期后调用方改为全量拉取', async () => {
    const { fake, feed } = setup();
    fake.faults.failNext({ kind: 'cursor_expired' });

    let result;
    try {
      result = await feed.listChanges('1');
    } catch (error) {
      expect(error).toBeInstanceOf(CursorExpiredError);
      result = await feed.listChanges(null);
    }
    expect(result).toEqual({ items: ['来信 1', '来信 2'], cursor: '2' });
  });

  it('断线期间每次调用都失败，恢复后正常', async () => {
    const { fake, feed } = setup();
    fake.faults.disconnect();
    await expect(feed.listChanges(null)).rejects.toBeInstanceOf(ConnectionLostError);
    await expect(feed.listChanges(null)).rejects.toBeInstanceOf(ConnectionLostError);

    fake.faults.reconnect();
    await expect(feed.listChanges(null)).resolves.toMatchObject({ cursor: '2' });
  });

  it('重置后数据、故障与调用记录都清空', async () => {
    const clients = new IntegrationClients({ appEnv: 'test', definitions });
    const fake = clients.fake(exampleFeed);
    fake.add('store-a', '来信 1');
    fake.faults.disconnect();

    clients.resetFakes();

    expect(fake.faults.calls).toEqual([]);
    await expect(clients.forStore(exampleFeed, fakeStore).listChanges(null)).resolves.toEqual({
      items: [],
      cursor: '0',
    });
  });
});

describe('Fake 从示例数据夹具回放（ADR 0009 修订）', () => {
  /** 示范：通讯录类的 Fake 按夹具里的成员装入数据（钉钉的 Fake 在 05 号待办照此实现） */
  class FakeDirectory implements FakeClient<ExampleDirectoryClient> {
    names: string[] = [];
    client(): ExampleDirectoryClient {
      return { whoami: () => Promise.resolve(this.names.join('、')) };
    }
    reset(): void {
      this.names = [];
    }
    replay(fixture: DemoFixture): void {
      this.names = fixture.members.map((m) => m.name);
    }
  }
  const replayableDirectory = defineClient({
    system: 'replayable_directory',
    scope: 'global',
    createReal: (): ExampleDirectoryClient => ({ whoami: () => Promise.resolve('real') }),
    createFake: () => new FakeDirectory(),
  });
  const withReplay = [exampleFeed, replayableDirectory];
  const demo = getDemoFixture();

  it('有回放方法的 Fake 装入夹具数据，没有的跳过；返回回放了哪些系统', async () => {
    const clients = new IntegrationClients({ appEnv: 'staging', definitions: withReplay });
    expect(clients.replayFixtures(demo)).toEqual(['replayable_directory']);
    await expect(clients.global(replayableDirectory).whoami()).resolves.toContain('王磊');
  });

  it('生产环境拒绝回放', () => {
    const clients = new IntegrationClients({ appEnv: 'production', definitions: withReplay });
    expect(() => clients.replayFixtures(demo)).toThrow(FakeNotAllowedError);
  });

  it('非生产环境的进程（开发、开发测试环境、Playwright 的 api）组装客户端时自动回放', async () => {
    for (const appEnv of ['development', 'staging', 'test'] as const) {
      const clients = createIntegrationClients(
        {
          appEnv,
          clientModes: {},
          mailSend: { allowlistOnly: true, allowlist: [] },
          dingtalk: null,
        },
        { definitions: withReplay, fixture: () => demo },
      );
      await expect(clients.global(replayableDirectory).whoami()).resolves.toContain('王磊');
    }
  });

  it('生产环境组装客户端时不回放，也不解析夹具', () => {
    let parsed = false;
    createIntegrationClients(
      {
        appEnv: 'production',
        clientModes: {},
        mailSend: { allowlistOnly: false, allowlist: [] },
        dingtalk: null,
      },
      {
        definitions: withReplay,
        fixture: () => {
          parsed = true;
          return demo;
        },
      },
    );
    expect(parsed).toBe(false);
  });
});
