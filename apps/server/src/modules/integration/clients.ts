import type { AdapterMode } from '@forcome/contracts';
import { getDemoFixture, type DemoFixture } from '@forcome/fixtures';
import {
  clientModeVariable,
  defaultClientMode,
  defaultMailSendPolicy,
  systemClock,
  type AppConfig,
  type AppEnv,
  type Clock,
  type DingtalkCredentials,
  type GoogleCredentials,
  type MailSendPolicy,
  type ShopifyCredentials,
} from '../core';
import { noCallRecords, type CallRecorder } from './call-records';
import type { CredentialVault } from './credential-vault';
import type {
  AnyClientDefinition,
  ClientDefinition,
  FakeClient,
  RealClientContext,
} from './definition';
import { MailRecipientGuard } from './mail-recipient-guard';
import { clientDefinitions } from './registry';

/*
 * 外部客户端与 Fake（ADR 0009 修订，规格 integration 一节）：
 * - 每个外部系统定义一次（defineClient）：同一个接口 C，一个真实现、一个 Fake，登记在 registry.ts；
 * - 店铺级客户端（Gmail、订单）按店铺配置选择真实现或 Fake，全局客户端（钉钉、汇率）按环境变量
 *   CLIENT_MODE_<系统> 选择，不设时非生产用 Fake、生产用真实现；生产环境任何时候都不给 Fake；
 * - 一个进程一个 IntegrationClients，Fake 实例在其中共享：测试往 Fake 里放数据、注入故障，
 *   被测代码经同一个 IntegrationClients 取到的就是这个 Fake（apps/server/test/harness.ts）；
 *   全局客户端的真实现同样一个进程只建一次（缓存访问凭证、钉钉 Stream 的长连接），店铺级的真实现按店铺每次新建；
 * - 非生产环境的进程（本机开发、开发测试环境、Playwright 的 api）启动时，Fake 从示例数据夹具回放数据；
 *   api 与 worker 各有一份 Fake，靠同一份夹具保持一致。测试不自动回放，需要时自己调 replayFixtures。
 */

/** 生产环境要用 Fake（店铺配置写成了 Fake、或要取 Fake 实例） */
export class FakeNotAllowedError extends Error {
  override name = 'FakeNotAllowedError';
}

/** 店铺的客户端选择，来自 channel 的店铺配置（「真实 / Fake」只在非生产环境可设） */
export interface StoreClientSelection {
  readonly id: string;
  readonly adapterMode: AdapterMode;
  /** 平台标识（亚马逊卖家 ID / Shopify 店铺域名）：订单的真实现按它连店铺；Gmail 用不到，可不给 */
  readonly platformId?: string;
}

export interface IntegrationClientsOptions {
  readonly appEnv: AppEnv;
  /** 显式配置的全局客户端模式（AppConfig.clientModes） */
  readonly clientModes?: Readonly<Record<string, AdapterMode>>;
  /** 登记的客户端；默认 registry.ts 的清单，测试可以换成自己的 */
  readonly definitions?: readonly AnyClientDefinition[];
  /** 发信白名单（AppConfig.mailSend）；不传时取 core 的 defaultMailSendPolicy（与没配置环境变量时一致） */
  readonly mailSend?: MailSendPolicy;
  /** 钉钉企业内部应用的凭据（AppConfig.dingtalk），交给钉钉的真实现；不传为 null */
  readonly dingtalk?: DingtalkCredentials | null;
  /** Google 服务账号与 Pub/Sub（AppConfig.google），交给 Gmail 的真实现；不传为 null */
  readonly google?: GoogleCredentials | null;
  /** 真实现的调用记录写到哪里；不传不记（api、worker 传 databaseCallRecorder） */
  readonly callRecorder?: CallRecorder;
  /** Shopify 的客户端凭据（AppConfig.shopify），交给 Shopify 的真实现；不传为 null */
  readonly shopify?: ShopifyCredentials | null;
  /** 动态凭据保管（api、worker 传 databaseCredentialVault）；不传为 null */
  readonly credentialVault?: CredentialVault | null;
  /** 真实现的当前时间（凭据何时换新）；不传为系统时钟 */
  readonly clock?: Clock;
}

export class IntegrationClients {
  readonly #appEnv: AppEnv;
  readonly #production: boolean;
  readonly #definitions: ReadonlySet<AnyClientDefinition>;
  readonly #modes: Readonly<Record<string, AdapterMode>>;
  readonly #fakes = new Map<AnyClientDefinition, FakeClient<unknown>>();
  /** 全局客户端的真实现：一个进程只建一次 */
  readonly #globals = new Map<AnyClientDefinition, unknown>();
  readonly #dingtalk: DingtalkCredentials | null;
  readonly #google: GoogleCredentials | null;
  readonly #callRecorder: CallRecorder;
  readonly #shopify: ShopifyCredentials | null;
  readonly #credentialVault: CredentialVault | null;
  readonly #clock: Clock;
  /** 发信白名单守卫，经 RealClientContext 交给真实现 */
  readonly mailRecipientGuard: MailRecipientGuard;

  constructor(options: IntegrationClientsOptions) {
    this.#appEnv = options.appEnv;
    this.#production = options.appEnv === 'production';
    this.mailRecipientGuard = new MailRecipientGuard(
      options.mailSend ?? defaultMailSendPolicy(options.appEnv),
    );
    this.#definitions = new Set(options.definitions ?? clientDefinitions);
    this.#modes = options.clientModes ?? {};
    this.#dingtalk = options.dingtalk ?? null;
    this.#google = options.google ?? null;
    this.#callRecorder = options.callRecorder ?? noCallRecords;
    this.#shopify = options.shopify ?? null;
    this.#credentialVault = options.credentialVault ?? null;
    this.#clock = options.clock ?? systemClock;
    for (const [system, mode] of Object.entries(this.#modes)) {
      const definition = [...this.#definitions].find((d) => d.system === system);
      const variable = clientModeVariable(system);
      if (!definition) {
        throw new Error(`${variable}：没有登记这个外部客户端，检查系统名是否写错`);
      }
      if (definition.scope === 'store') {
        throw new Error(`${variable}：${system} 是店铺级客户端，按店铺配置选择，不用环境变量`);
      }
      // loadConfig 已在启动时拒绝；直接构造（测试、脚本）时这里再挡一次
      if (this.#production && mode === 'fake') {
        throw new FakeNotAllowedError(`${variable}：生产环境不允许使用 Fake`);
      }
    }
  }

  /** 取某店铺的店铺级客户端：按店铺配置给真实现或 Fake */
  forStore<C>(definition: ClientDefinition<C>, store: StoreClientSelection): C {
    this.#assertRegistered(definition);
    if (definition.scope !== 'store') {
      throw new Error(`${definition.system} 是全局客户端，用 global() 取`);
    }
    if (store.adapterMode === 'fake') {
      if (this.#production) {
        throw new FakeNotAllowedError(
          `生产环境不允许使用 Fake：${definition.system}（店铺 ${store.id}）`,
        );
      }
      return this.fake(definition).client(store.id);
    }
    return definition.createReal(this.#realContext(store));
  }

  #realContext(store?: StoreClientSelection): RealClientContext {
    return {
      ...(store === undefined ? {} : { storeId: store.id }),
      ...(store?.platformId === undefined ? {} : { storePlatformId: store.platformId }),
      mailRecipientGuard: this.mailRecipientGuard,
      dingtalk: this.#dingtalk,
      google: this.#google,
      callRecorder: this.#callRecorder,
      shopify: this.#shopify,
      credentialVault: this.#credentialVault,
      clock: this.#clock,
    };
  }

  /** 取全局客户端：按 CLIENT_MODE_<系统> 给真实现或 Fake；真实现一个进程只建一次 */
  global<C>(definition: ClientDefinition<C>): C {
    this.#assertRegistered(definition);
    if (definition.scope !== 'global') {
      throw new Error(`${definition.system} 是店铺级客户端，用 forStore() 按店铺取`);
    }
    if (this.globalMode(definition.system) === 'fake') return this.fake(definition).client();
    const key = definition as unknown as AnyClientDefinition;
    if (!this.#globals.has(key)) this.#globals.set(key, definition.createReal(this.#realContext()));
    return this.#globals.get(key) as C;
  }

  /**
   * 全局客户端按 CLIENT_MODE_<系统> 选择的实现（不设时非生产为 Fake、生产为真实现）。P18 的钉钉卡据此标「模拟数据」；
   * 只读配置、不建客户端，所以不要求已登记（钉钉客户端随 05 号待办登记）。
   */
  globalMode(system: string): AdapterMode {
    return this.#modes[system] ?? defaultClientMode(this.#appEnv);
  }

  /** 本进程里该客户端的 Fake 实例（测试与开发环境往里放数据、注入故障）；生产环境拒绝 */
  fake<C, F extends FakeClient<C>>(definition: ClientDefinition<C, F>): F {
    if (this.#production) {
      throw new FakeNotAllowedError(`生产环境不允许使用 Fake：${definition.system}`);
    }
    this.#assertRegistered(definition);
    const key = definition as unknown as AnyClientDefinition;
    let fake = this.#fakes.get(key);
    if (!fake) {
      fake = definition.createFake({ fake: (other) => this.fake(other) });
      this.#fakes.set(key, fake);
    }
    return fake as F;
  }

  /**
   * 让登记的 Fake 从示例数据夹具装入数据（有 replay 方法的才装），返回回放了哪些外部系统；生产环境拒绝。
   * 非生产环境的进程启动时由 createIntegrationClients 调用。
   */
  replayFixtures(fixture: DemoFixture): string[] {
    if (this.#production) {
      throw new FakeNotAllowedError('生产环境不允许使用 Fake，不能回放示例数据');
    }
    const replayed: string[] = [];
    for (const definition of this.#definitions) {
      const fake = this.fake(definition);
      if (fake.replay) {
        fake.replay(fixture);
        replayed.push(definition.system);
      }
    }
    return replayed;
  }

  /** 把已创建的 Fake 全部重置到初始状态 */
  resetFakes(): void {
    for (const fake of this.#fakes.values()) {
      fake.reset();
    }
  }

  #assertRegistered(definition: ClientDefinition<unknown, FakeClient<unknown>>): void {
    if (!this.#definitions.has(definition)) {
      throw new Error(`外部客户端未登记：${definition.system}（在 integration/registry.ts 登记）`);
    }
  }
}

/**
 * 按运行配置组装本进程的外部客户端（api、worker 入口用）。非生产环境同时让 Fake 从示例数据夹具回放；
 * 生产环境不回放，也不解析夹具。options 只给测试用：换登记清单与夹具。
 */
export function createIntegrationClients(
  config: Pick<
    AppConfig,
    'appEnv' | 'clientModes' | 'mailSend' | 'dingtalk' | 'google' | 'shopify'
  >,
  options: {
    definitions?: readonly AnyClientDefinition[];
    fixture?: () => DemoFixture;
    callRecorder?: CallRecorder;
    credentialVault?: CredentialVault | null;
    clock?: Clock;
  } = {},
): IntegrationClients {
  const clients = new IntegrationClients({
    appEnv: config.appEnv,
    clientModes: config.clientModes,
    mailSend: config.mailSend,
    dingtalk: config.dingtalk,
    google: config.google,
    shopify: config.shopify,
    definitions: options.definitions,
    callRecorder: options.callRecorder,
    credentialVault: options.credentialVault,
    clock: options.clock,
  });
  if (config.appEnv !== 'production') {
    clients.replayFixtures((options.fixture ?? getDemoFixture)());
  }
  return clients;
}
