import type { AnyClientDefinition } from './definition';
import { dingtalkClient } from './dingtalk';
import { exchangeRateClient } from './exchange-rate';
import { gmailClient, gmailPushClient } from './gmail';
import { shopifyClient } from './shopify';

/**
 * 登记的外部客户端（ADR 0009 修订）。各集成在自己的待办里用 defineClient 定义后加到这里：
 * Gmail（08、09）、钉钉（05）、SP-API 订单与 SQS（12）、Shopify 订单（11）、汇率（20）。
 * 没登记的客户端取不到，CLIENT_MODE_<系统> 写了没登记的系统名会拒绝启动。
 */
export const clientDefinitions: readonly AnyClientDefinition[] = [
  gmailPushClient,
  gmailClient,
  exchangeRateClient,
  dingtalkClient,
  shopifyClient,
];
