import { Hash } from '@smithy/hash-node';
import { SignatureV4 } from '@smithy/signature-v4';
import { z } from 'zod';
import type { AmazonSqsConfig, Clock } from '../core';
import { parseOrderChange, type AmazonNotificationsClient } from './amazon-sqs';
import type { RealClientContext } from './definition';
import { ClientNotConfiguredError, ExternalCallFailedError } from './faults';
import { createHttpClient, type HttpClient } from './http';

/*
 * SQS 的真实现（规格 order「ORDER_CHANGE → SQS 长轮询」、ADR 0011、0003，待办 12）：
 * - SQS 的 JSON 协议：POST https://sqs.<区域>.amazonaws.com/，请求头 X-Amz-Target 写操作名（AmazonSQS.ReceiveMessage 等），
 *   Content-Type application/x-amz-json-1.0，正文带 QueueUrl；
 * - 签名：AWS 签名 V4（官方的 @smithy/signature-v4，服务名 sqs），签好的请求头交给出站 HTTP 客户端工厂发出（代理分流、时限、调用记录），
 *   Host 由 HTTP 客户端按地址自己写；
 * - ReceiveMessage 长轮询最多 20 秒（WaitTimeSeconds），一次最多 10 条；DeleteMessageBatch 每批最多 10 条，个别删不掉的
 *   不报错（过了可见性超时会重投，处理是幂等的）；GetQueueAttributes 取 ApproximateNumberOfMessages（等待拉取的条数）。
 * 没有配置队列地址与访问密钥时以「未配置」失败（ClientNotConfiguredError：卡上 SQS 行为未连接，用户 2026-10-04 口径）。
 */

const SYSTEM = 'amazon_sqs';
/** SQS 单次长轮询最多等 20 秒、取 10 条 */
const MAX_WAIT_SECONDS = 20;
const MAX_MESSAGES = 10;

const receiveSchema = z.object({
  Messages: z
    .array(z.object({ ReceiptHandle: z.string(), Body: z.string() }))
    .optional()
    .default([]),
});
const attributesSchema = z.object({
  Attributes: z.object({ ApproximateNumberOfMessages: z.string().regex(/^\d+$/) }),
});

function contractError(operation: string): ExternalCallFailedError {
  return new ExternalCallFailedError(SYSTEM, operation, {
    message: '返回的内容与接口约定不符',
    retryable: false,
  });
}

/** 一个队列的 SQS 客户端 */
export function createRealAmazonSqsClient(
  http: HttpClient,
  config: AmazonSqsConfig,
  clock: Clock,
): AmazonNotificationsClient {
  const endpoint = new URL(`https://sqs.${config.region}.amazonaws.com/`);
  const signer = new SignatureV4({
    service: 'sqs',
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    sha256: Hash.bind(null, 'sha256'),
  });

  async function call(
    operation: 'ReceiveMessage' | 'DeleteMessageBatch' | 'GetQueueAttributes',
    body: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<unknown> {
    const payload = { QueueUrl: config.queueUrl, ...body };
    const signed = await signer.sign(
      {
        method: 'POST',
        protocol: endpoint.protocol,
        hostname: endpoint.hostname,
        path: endpoint.pathname,
        query: {},
        headers: {
          host: endpoint.hostname,
          'content-type': 'application/x-amz-json-1.0',
          'x-amz-target': `AmazonSQS.${operation}`,
        },
        // 与 HTTP 客户端发出的正文一致（postJson 同样用 JSON.stringify）
        body: JSON.stringify(payload),
      },
      { signingDate: clock.now() },
    );
    const { host: _host, ...headers } = signed.headers;
    return http.postJson(endpoint.toString(), payload, { operation, headers, timeoutMs });
  }

  return {
    async receive({ maxMessages, waitSeconds }) {
      const wait = Math.min(Math.max(0, waitSeconds), MAX_WAIT_SECONDS);
      const parsed = receiveSchema.safeParse(
        await call(
          'ReceiveMessage',
          {
            MaxNumberOfMessages: Math.min(Math.max(1, maxMessages), MAX_MESSAGES),
            WaitTimeSeconds: wait,
          },
          // 长轮询要等满 wait 秒，再给 10 秒余量
          (wait + 10) * 1000,
        ),
      );
      if (!parsed.success) throw contractError('ReceiveMessage');
      return parsed.data.Messages.map((message) => ({
        receiptHandle: message.ReceiptHandle,
        notification: parseOrderChange(message.Body),
      }));
    },
    async delete(receiptHandles) {
      for (let start = 0; start < receiptHandles.length; start += MAX_MESSAGES) {
        const batch = receiptHandles.slice(start, start + MAX_MESSAGES);
        await call('DeleteMessageBatch', {
          Entries: batch.map((handle, index) => ({ Id: String(index), ReceiptHandle: handle })),
        });
      }
    },
    async backlog() {
      const parsed = attributesSchema.safeParse(
        await call('GetQueueAttributes', { AttributeNames: ['ApproximateNumberOfMessages'] }),
      );
      if (!parsed.success) throw contractError('GetQueueAttributes');
      return Number(parsed.data.Attributes.ApproximateNumberOfMessages);
    },
  };
}

/** 按运行配置建 SQS 的真实现（IntegrationClients.global 调用，一个进程一个） */
export function createRealAmazonSqs(context: RealClientContext): AmazonNotificationsClient {
  const config = context.amazonSqs;
  if (!config) {
    const fail = (operation: string) =>
      Promise.reject(
        new ClientNotConfiguredError(
          SYSTEM,
          operation,
          '没有配置订单通知队列（AMAZON_SQS_QUEUE_URL 等）',
        ),
      );
    return {
      receive: () => fail('ReceiveMessage'),
      delete: () => fail('DeleteMessageBatch'),
      backlog: () => fail('GetQueueAttributes'),
    };
  }
  const http = createHttpClient(SYSTEM, { recorder: context.callRecorder });
  return createRealAmazonSqsClient(http, config, context.clock);
}
