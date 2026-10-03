import { z } from 'zod';

/**
 * 审计对象类型与中文名（PRD 11.1 AuditLog、P27 筛选「对象类型」）。
 * 第一期只出现前九种；审批单随第二期（P27「第一阶段」）。
 */
export const auditObjectTypeLabels = {
  ticket: '工单',
  message: '来信',
  aftersales: '售后单',
  store: '店铺',
  channel: '渠道',
  member: '成员',
  setting: '设置',
  export: '导出',
  login: '登录',
  approval: '审批单',
} as const;

export type AuditObjectType = keyof typeof auditObjectTypeLabels;
export const auditObjectTypeSchema = z.enum(
  Object.keys(auditObjectTypeLabels) as [AuditObjectType, ...AuditObjectType[]],
);

/** 系统操作在审计里的操作人（PRD 10.2：系统操作写「系统」） */
export const SYSTEM_ACTOR_NAME = '系统';
