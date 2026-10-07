import { z } from 'zod';
import { platformSchema, type Platform } from './channel';
import { currencySchema } from './money';

/*
 * P05 的订单卡（PRD P05「第一阶段」，待办 17，协调者 2026-10-07 决定 Q1、Q2）：工单关联订单在本地订单镜像里的样子（平台镜像，
 * ADR 0011）。第一期镜像只有平台的履约状态，没有物流轨迹与签收：状态写平台状态的中文，右侧写「更新于」平台最近更新日期。
 * 亚马逊（SP-API 非受限角色）只有收件城市、州、国家，没有买家姓名与街道；Shopify 没有履约方式与承诺送达。
 */

/** 亚马逊的履约方（PRD 1.4）：MFN 自发货、AFN 亚马逊配送 */
export const fulfillmentChannels = ['MFN', 'AFN'] as const;
export const fulfillmentChannelSchema = z.enum(fulfillmentChannels);
export type FulfillmentChannel = z.infer<typeof fulfillmentChannelSchema>;
export const fulfillmentChannelLabels: Record<FulfillmentChannel, string> = {
  MFN: 'MFN（自发货）',
  AFN: 'AFN（亚马逊配送）',
};

export const orderCardSchema = z.object({
  /** 订单在工单上的写法：亚马逊为订单号，Shopify 为订单名（如 #1063） */
  number: z.string(),
  platform: platformSchema,
  /** 平台的履约状态原值（亚马逊 fulfillmentStatus，如 SHIPPED；Shopify displayFulfillmentStatus，如 FULFILLED） */
  status: z.string(),
  /** 订单已取消（Shopify 的 cancelledAt；亚马逊另由状态 CANCELLED 表示） */
  cancelled: z.boolean(),
  /** 平台最近更新时间（「更新于 08-26」） */
  updatedAt: z.iso.datetime({ offset: true }),
  /** 最近一次写入镜像的时间（「平台镜像 · 最近同步 09:02」） */
  syncedAt: z.iso.datetime({ offset: true }),
  items: z.array(z.object({ title: z.string(), quantity: z.int() })),
  /** 订单金额；亚马逊待付款的订单还没有 */
  total: z.object({ amount: z.string(), currency: currencySchema }).nullable(),
  /** 非美元金额按下单日的汇率折算的美元（「≈ $49.99」；当天没有取此前最近一天，E-20）；美元订单与没有汇率时为空 */
  usd: z.string().nullable(),
  /** 亚马逊的履约方；Shopify 为空 */
  fulfillmentChannel: fulfillmentChannelSchema.nullable(),
  /** 亚马逊的承诺送达（最晚时刻）；Shopify 为空 */
  promisedDeliveryBy: z.iso.datetime({ offset: true }).nullable(),
  /** 收件城市、州、国家（没有收件地址为空） */
  shipTo: z
    .object({
      city: z.string().nullable(),
      province: z.string().nullable(),
      country: z.string().nullable(),
    })
    .nullable(),
  /** 履约单号（承运商 + 单号） */
  tracking: z.array(z.object({ company: z.string().nullable(), number: z.string().nullable() })),
});
export type OrderCard = z.infer<typeof orderCardSchema>;

/**
 * 平台履约状态的中文（协调者 2026-10-07 决定 Q1）：亚马逊 fulfillmentStatus 与 Shopify displayFulfillmentStatus 的常见取值；
 * 认不出的照写平台原值
 */
const ORDER_STATUS_LABELS: Readonly<Record<Platform, Readonly<Record<string, string>>>> = {
  amazon: {
    PENDING: '待付款',
    UNSHIPPED: '未发货',
    PARTIALLY_SHIPPED: '部分发货',
    SHIPPED: '已发货',
    CANCELLED: '已取消',
    UNFULFILLABLE: '无法履约',
  },
  shopify: {
    UNFULFILLED: '未发货',
    PARTIALLY_FULFILLED: '部分发货',
    FULFILLED: '已发货',
  },
};

/** 订单卡的状态写法：已取消的写「已取消」，其余按平台状态的中文，认不出的照写原值 */
export function orderStatusLabel(order: Pick<OrderCard, 'platform' | 'status' | 'cancelled'>) {
  if (order.cancelled) return '已取消';
  return ORDER_STATUS_LABELS[order.platform][order.status.toUpperCase()] ?? order.status;
}
