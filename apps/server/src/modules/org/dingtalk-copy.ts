import { CONNECTION_FAILURE_LIMIT } from '@forcome/contracts';

/*
 * 钉钉同步失败给管理员的站内提醒（PRD 11.4「钉钉同步失败的提醒」v2.23，2026-10-06 用户确认；原型 G10 ④）。
 * dingtalk-copy.test.ts 读原型生成物 GlobalStates 逐字核对。连续失败的第 1 次用 first，第 3 次（转连接异常）用 disconnected。
 */
export const DINGTALK_SYNC_FAILED = {
  first: {
    title: '钉钉同步失败',
    body: '通讯录同步失败，成员与部门保持上次结果，登录与权限不受影响',
  },
  disconnected: {
    title: '钉钉连接异常',
    body: `通讯录连续 ${CONNECTION_FAILURE_LIMIT} 次同步失败，成员与部门保持上次结果，登录与权限不受影响`,
  },
  /** 对象是 P18 钉钉卡 */
  object: { type: 'channel', id: 'dingtalk', label: 'P18 · 钉钉' },
} as const;
