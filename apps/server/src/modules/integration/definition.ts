import type { DemoFixture } from '@forcome/fixtures';
import type { Clock, DingtalkCredentials, GoogleCredentials, ShopifyCredentials } from '../core';
import type { CallRecorder } from './call-records';
import type { CredentialVault } from './credential-vault';
import type { MailRecipientGuard } from './mail-recipient-guard';

/*
 * 外部客户端的定义（ADR 0009 修订）：接口 C、真实现与 Fake 的约定。单独成文件，客户端定义（如 gmail.ts）只依赖它，
 * 不依赖 clients.ts——clients.ts 要引用登记清单 registry.ts，而清单又引用各客户端定义，放在一起会循环引用。
 */

export type ClientScope = 'store' | 'global';

/** 真实现的构造参数；店铺级客户端带店铺 ID。凭据随各集成的待办加入 */
export interface RealClientContext {
  readonly storeId?: string;
  /** 店铺级客户端的平台标识（亚马逊卖家 ID / Shopify 店铺域名，channel 的店铺配置）；调用方没给为 undefined */
  readonly storePlatformId?: string;
  /** 发信白名单（ADR 0013 修订）：会发信的真实现在发出前对全部收件人调用 assertAllowed */
  readonly mailRecipientGuard: MailRecipientGuard;
  /** 钉钉企业内部应用的凭据（core 的 loadConfig 读环境变量）；钉钉用 Fake 时为 null */
  readonly dingtalk: DingtalkCredentials | null;
  /** Google 服务账号与 Pub/Sub（Gmail 的真实现，待办 09）；没配置为 null，真实现调用时以「未配置」失败 */
  readonly google: GoogleCredentials | null;
  /** 调用记录写到哪里（经出站 HTTP 客户端工厂，待办 09） */
  readonly callRecorder: CallRecorder;
  /** Shopify 自建应用的客户端凭据（待办 11）；没配置为 null，真实现调用时以「未配置」失败 */
  readonly shopify: ShopifyCredentials | null;
  /** 动态凭据保管（主密钥加密存库，待办 11）；没有主密钥为 null */
  readonly credentialVault: CredentialVault | null;
  /** 当前时间（凭据何时换新；测试里是手动时钟） */
  readonly clock: Clock;
}

/** Fake 的最小约定：给出（某店铺视角的）客户端，能重置到初始状态 */
export interface FakeClient<C> {
  /** 店铺级客户端按店铺 ID 返回该店铺视角的客户端；全局客户端忽略参数 */
  client(storeId?: string): C;
  /** 清空数据、故障与调用记录 */
  reset(): void;
  /** 从示例数据夹具装入数据（ADR 0009 修订）；没有可回放的数据就不实现 */
  replay?(fixture: DemoFixture): void;
}

export interface ClientDefinition<C, F extends FakeClient<C> = FakeClient<C>> {
  /** 外部系统名，小写 snake_case，如 gmail、dingtalk、exchange_rate；也是 CLIENT_MODE_<系统> 的后缀 */
  readonly system: string;
  readonly scope: ClientScope;
  readonly createReal: (context: RealClientContext) => C;
  /**
   * 一个进程只建一次，服务全部店铺（店铺级的 Fake 自己按店铺分开数据）。几个外部系统在真实世界里联动时
   * （Gmail 邮箱被 watch 后把通知发到 Pub/Sub 推送），Fake 经 context.fake 取到同一进程里的另一个 Fake
   */
  readonly createFake: (context: FakeContext) => F;
}

/** 建 Fake 时可用的上下文：取同一个 IntegrationClients 里别的 Fake（按需创建） */
export interface FakeContext {
  readonly fake: <C2, F2 extends FakeClient<C2>>(definition: ClientDefinition<C2, F2>) => F2;
}

export type AnyClientDefinition = ClientDefinition<unknown, FakeClient<unknown>>;

const SYSTEM_NAME = /^[a-z][a-z0-9_]*$/;

export function defineClient<C, F extends FakeClient<C>>(
  definition: ClientDefinition<C, F>,
): ClientDefinition<C, F> {
  if (!SYSTEM_NAME.test(definition.system)) {
    throw new Error(`外部系统名必须是小写 snake_case：${definition.system}`);
  }
  return definition;
}
