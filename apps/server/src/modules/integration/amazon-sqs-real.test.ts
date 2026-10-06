import { MockAgent } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ManualClock } from '../core';
import { orderChangeBody } from './amazon-sqs';
import { createRealAmazonSqs, createRealAmazonSqsClient } from './amazon-sqs-real';
import { noCallRecords } from './call-records';
import { ClientNotConfiguredError } from './faults';
import { createHttpClient } from './http';
import { MailRecipientGuard } from './mail-recipient-guard';

/*
 * SQS 的真实现（待办 12；规格 order「ORDER_CHANGE → SQS 长轮询」、ADR 0011、0003）：JSON 协议 + AWS 签名 V4，经出站 HTTP 客户端工厂发出；
 * undici MockAgent 按地址回放照官方文档写的返回，没登记的请求直接失败（不连外网）。
 */

const CONFIG = {
  queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/forcome-orders-staging',
  region: 'us-east-1',
  accessKeyId: 'AKIAEXAMPLE1234',
  secretAccessKey: 'secret-example',
};

let agent: MockAgent;
let calls: { target: string; headers: Record<string, string>; body: Record<string, unknown> }[];
const clock = new ManualClock('2026-09-11T02:20:00Z');

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  calls = [];
});

afterEach(async () => {
  await agent.close();
});

/** 请求头（名字小写） */
function headersOf(headers: unknown): Record<string, string> {
  const entries: [string, unknown][] = Array.isArray(headers)
    ? Array.from({ length: headers.length / 2 }, (_, i) => [
        String(headers[i * 2]),
        headers[i * 2 + 1],
      ])
    : Object.entries((headers ?? {}) as Record<string, unknown>);
  return Object.fromEntries(entries.map(([key, value]) => [key.toLowerCase(), String(value)]));
}

/** 登记一次 SQS 调用的返回 */
function sqsReply(body: unknown, status = 200) {
  agent
    .get('https://sqs.us-east-1.amazonaws.com')
    .intercept({ path: '/', method: 'POST' })
    .reply(status, (options) => {
      const headers = headersOf(options.headers);
      calls.push({
        target: headers['x-amz-target'] ?? '',
        headers,
        body: JSON.parse(typeof options.body === 'string' ? options.body : '{}') as Record<
          string,
          unknown
        >,
      });
      return body;
    });
}

const client = () =>
  createRealAmazonSqsClient(createHttpClient('amazon_sqs', { dispatcher: agent }), CONFIG, clock);

describe('SQS 真实现', () => {
  it('ReceiveMessage：长轮询最多 20 秒、一次最多 10 条；请求按 AWS 签名 V4 签名，正文带队列地址；ORDER_CHANGE 解析出卖家与订单号，别的为 null', async () => {
    sqsReply({
      Messages: [
        {
          MessageId: 'm-1',
          ReceiptHandle: 'rh-1',
          MD5OfBody: 'x',
          Body: orderChangeBody('A3KA8V1T6RW2NB', '113-5566112-7788990', 'n-1', clock.now()),
        },
        {
          MessageId: 'm-2',
          ReceiptHandle: 'rh-2',
          MD5OfBody: 'y',
          Body: '{"NotificationType":"ANY_OFFER_CHANGED"}',
        },
      ],
    });
    const messages = await client().receive({ maxMessages: 50, waitSeconds: 60 });
    expect(messages).toEqual([
      {
        receiptHandle: 'rh-1',
        notification: {
          sellerId: 'A3KA8V1T6RW2NB',
          orderId: '113-5566112-7788990',
          notificationId: 'n-1',
        },
      },
      { receiptHandle: 'rh-2', notification: null },
    ]);
    const [call] = calls;
    expect(call?.target).toBe('AmazonSQS.ReceiveMessage');
    expect(call?.body).toEqual({
      QueueUrl: CONFIG.queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,
    });
    expect(call?.headers['content-type']).toBe('application/x-amz-json-1.0');
    expect(call?.headers['x-amz-date']).toBe('20260911T022000Z');
    expect(call?.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE1234\/20260911\/us-east-1\/sqs\/aws4_request, SignedHeaders=[a-z0-9;-]*content-type;host;[a-z0-9;-]*x-amz-target[a-z0-9;-]*, Signature=[0-9a-f]{64}$/,
    );
    // 访问密钥本身不出现在请求里
    expect(JSON.stringify(call)).not.toContain(CONFIG.secretAccessKey);
  });

  it('队列空着：返回空列表（没有 Messages）', async () => {
    sqsReply({});
    expect(await client().receive({ maxMessages: 10, waitSeconds: 0 })).toEqual([]);
    expect(calls[0]?.body.WaitTimeSeconds).toBe(0);
  });

  it('DeleteMessageBatch 每批最多 10 条；GetQueueAttributes 取等待拉取的条数', async () => {
    sqsReply({ Successful: [], Failed: [] });
    sqsReply({ Successful: [], Failed: [] });
    const handles = Array.from({ length: 12 }, (_, i) => `rh-${i}`);
    await client().delete(handles);
    expect(calls.map((c) => [c.target, (c.body.Entries as unknown[]).length])).toEqual([
      ['AmazonSQS.DeleteMessageBatch', 10],
      ['AmazonSQS.DeleteMessageBatch', 2],
    ]);
    expect(calls[1]?.body.Entries).toEqual([
      { Id: '0', ReceiptHandle: 'rh-10' },
      { Id: '1', ReceiptHandle: 'rh-11' },
    ]);

    sqsReply({ Attributes: { ApproximateNumberOfMessages: '12' } });
    expect(await client().backlog()).toBe(12);
    expect(calls[2]?.body).toEqual({
      QueueUrl: CONFIG.queueUrl,
      AttributeNames: ['ApproximateNumberOfMessages'],
    });
  });

  it('SQS 报错（队列不存在、访问被拒）以外部调用失败抛出；没配置队列时以「未配置」失败', async () => {
    sqsReply(
      {
        __type: 'com.amazonaws.sqs#QueueDoesNotExist',
        message: 'The specified queue does not exist.',
      },
      400,
    );
    await expect(client().receive({ maxMessages: 10, waitSeconds: 0 })).rejects.toMatchObject({
      name: 'ExternalCallFailedError',
      status: 400,
      retryable: false,
    });
    const notConfigured = createRealAmazonSqs({
      mailRecipientGuard: new MailRecipientGuard({ allowlistOnly: true, allowlist: [] }),
      dingtalk: null,
      google: null,
      shopify: null,
      spApi: null,
      amazonSqs: null,
      callRecorder: noCallRecords,
      credentialVault: null,
      clock,
    });
    await expect(notConfigured.backlog()).rejects.toBeInstanceOf(ClientNotConfiguredError);
  });
});
