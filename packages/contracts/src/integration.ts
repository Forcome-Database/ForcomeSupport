import { z } from 'zod';

/**
 * 外部客户端的实现选择（ADR 0009 修订）：真实接口或 Fake（界面上写「模拟数据」，P18 K20）。
 * 店铺级客户端（Gmail、订单）按店铺配置选择，全局客户端（钉钉、汇率）按环境变量选择；生产环境不允许 Fake。
 */
export const adapterModes = ['real', 'fake'] as const;
export const adapterModeSchema = z.enum(adapterModes);
export type AdapterMode = z.infer<typeof adapterModeSchema>;
/** 数据来源的叫法（P18 店铺抽屉「数据来源」、P27 店铺记录的前后值） */
export const adapterModeLabels: Record<AdapterMode, string> = {
  real: '真实接口',
  fake: '模拟数据',
};
