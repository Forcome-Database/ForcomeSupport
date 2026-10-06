import { z } from 'zod';
import { createRealAmazonSqs } from './amazon-sqs-real';
import { defineClient, type FakeClient } from './definition';
import { FaultInjector } from './faults';

/*
 * 亚马逊订单变化通知（全局，规格 order「ORDER_CHANGE → SQS 长轮询」、ADR 0011，待办 12）：卖家在 SP-API 订阅 ORDER_CHANGE，
 * 亚马逊把通知投到我方 AWS us-east-1 的 SQS 标准队列（整个环境一个队列，所有卖家共用；生产、开发测试各一个），我们经代理长轮询拉取，
 * 不开任何入站端口（ADR 0003）。标准队列至少投递一次、可能重复与乱序：处理是幂等的（按订单号取最新的一笔写镜像）。
 * 真实现（amazon-sqs-real.ts）用 SQS 的 JSON 协议（ReceiveMessage / DeleteMessageBatch / GetQueueAttributes），请求用 AWS 签名 V4
 * （@smithy/signature-v4）后经出站 HTTP 客户端工厂发出。Fake 由测试放通知（orderChanged）、注入故障（操作名 ReceiveMessage /
 * DeleteMessageBatch / GetQueueAttributes），没有回放数据。
 */

/** 一条 ORDER_CHANGE 通知里我们要的：哪个卖家的哪笔订单变了 */
export interface OrderChangeNotification {
  readonly sellerId: string;
  readonly orderId: string;
  /** 通知编号（NotificationMetadata.NotificationId，排错用） */
  readonly notificationId: string | null;
}

/** 队列里拉到的一条消息 */
export interface QueueMessage {
  /** 删除（确认）用 */
  readonly receiptHandle: string;
  /** ORDER_CHANGE 通知；别的类型或解析不了为 null（照样删掉，不让它堵在队列里） */
  readonly notification: OrderChangeNotification | null;
}

export interface AmazonNotificationsClient {
  /** 拉取通知；waitSeconds 为 0 时立即返回，否则最多等这么久（长轮询，最多 20 秒） */
  receive(options: {
    readonly maxMessages: number;
    readonly waitSeconds: number;
  }): Promise<QueueMessage[]>;
  /** 删除已处理的消息；没删除的消息过了可见性超时会再次投递（至少一次） */
  delete(receiptHandles: readonly string[]): Promise<void>;
  /** 队列里等待拉取的消息数（ApproximateNumberOfMessages）：卡上的「积压 N 条」 */
  backlog(): Promise<number>;
}

const notificationSchema = z.object({
  NotificationType: z.literal('ORDER_CHANGE'),
  Payload: z.object({
    OrderChangeNotification: z.object({
      SellerId: z.string().min(1),
      AmazonOrderId: z.string().min(1),
    }),
  }),
  NotificationMetadata: z.object({ NotificationId: z.string().optional() }).optional(),
});

/** 解析一条消息的正文（SP-API 通知的 JSON）；不是 ORDER_CHANGE 或解析不了为 null */
export function parseOrderChange(body: string): OrderChangeNotification | null {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  const parsed = notificationSchema.safeParse(json);
  if (!parsed.success) return null;
  const change = parsed.data.Payload.OrderChangeNotification;
  return {
    sellerId: change.SellerId,
    orderId: change.AmazonOrderId,
    notificationId: parsed.data.NotificationMetadata?.NotificationId ?? null,
  };
}

/** SP-API 投到队列里的 ORDER_CHANGE 通知正文（Fake 与测试用；字段同官方的通知示例） */
export function orderChangeBody(
  sellerId: string,
  orderId: string,
  notificationId: string,
  at: Date,
): string {
  return JSON.stringify({
    NotificationVersion: '1.0',
    NotificationType: 'ORDER_CHANGE',
    PayloadVersion: '1.0',
    EventTime: at.toISOString(),
    Payload: {
      OrderChangeNotification: {
        NotificationLevel: 'OrderLevel',
        SellerId: sellerId,
        AmazonOrderId: orderId,
        OrderChangeType: 'OrderStatusChange',
      },
    },
    NotificationMetadata: {
      ApplicationId: 'amzn1.sellerapps.app.fake',
      SubscriptionId: 'fake-subscription',
      PublishTime: at.toISOString(),
      NotificationId: notificationId,
    },
  });
}

// ---------------------------------------------------------------- Fake

/**
 * Fake SQS：orderChanged 放一条 ORDER_CHANGE 通知（sendRaw 放任意正文）；拉到的消息在删除前不可见、不再投递
 * （真实的会在可见性超时后重投，处理是幂等的，Fake 不模拟）。backlog 为还没被拉走的条数
 */
export class FakeAmazonSqs implements FakeClient<AmazonNotificationsClient> {
  readonly faults = new FaultInjector('amazon_sqs');
  #visible: { readonly id: number; readonly body: string }[] = [];
  readonly #inFlight = new Map<string, string>();
  #nextId = 1;

  /** 放一条 ORDER_CHANGE 通知 */
  orderChanged(sellerId: string, orderId: string, at = new Date()): void {
    const id = this.#nextId;
    this.sendRaw(orderChangeBody(sellerId, orderId, `fake-notification-${id}`, at));
  }

  /** 放一条任意正文的消息（别的通知类型、坏的 JSON） */
  sendRaw(body: string): void {
    this.#visible.push({ id: this.#nextId, body });
    this.#nextId += 1;
  }

  /** 还没被拉走的条数 */
  get waiting(): number {
    return this.#visible.length;
  }

  /** 拉走了、还没删除的条数 */
  get inFlight(): number {
    return this.#inFlight.size;
  }

  client(): AmazonNotificationsClient {
    return {
      receive: async ({ maxMessages }) => {
        await this.faults.check('ReceiveMessage');
        const taken = this.#visible.splice(0, Math.min(maxMessages, 10));
        return taken.map((message) => {
          const receiptHandle = `fake-receipt-${message.id}`;
          this.#inFlight.set(receiptHandle, message.body);
          return { receiptHandle, notification: parseOrderChange(message.body) };
        });
      },
      delete: async (receiptHandles) => {
        await this.faults.check('DeleteMessageBatch');
        for (const handle of receiptHandles) this.#inFlight.delete(handle);
      },
      backlog: async () => {
        await this.faults.check('GetQueueAttributes');
        return this.#visible.length;
      },
    };
  }

  reset(): void {
    this.#visible = [];
    this.#inFlight.clear();
    this.#nextId = 1;
    this.faults.reset();
  }
}

export const amazonSqsClient = defineClient<AmazonNotificationsClient, FakeAmazonSqs>({
  system: 'amazon_sqs',
  scope: 'global',
  createReal: createRealAmazonSqs,
  createFake: () => new FakeAmazonSqs(),
});
