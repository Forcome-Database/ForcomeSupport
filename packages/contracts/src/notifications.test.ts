/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  notificationTimeWords,
  notificationTypeDefinitions,
  notificationTypes,
  type NotificationType,
} from './notifications';
import { roleNames } from './roles';

/*
 * 站内通知的类型与接收人（PRD 11.4「通知」，待办 31）：第一期的每种通知都对上 11.4 中阶段为「一起」的一行——
 * 接收人的角色、是否同时发钉钉工作通知。下面的对照表照 11.4 手写（独立的出处），另把 PRD 的表读出来核对没有漂移：
 * PRD 加了或改了「一起」的行而常量没跟上，这里会失败。
 */

const PRD_D = readFileSync(new URL('../../../design/spec/prd_d.md', import.meta.url), 'utf8');

/** PRD 11.4 的表：事件 · 接收人 · 渠道 · 阶段 */
function prdNotificationRows(): {
  event: string;
  recipients: string;
  channels: string;
  stage: string;
}[] {
  const start = PRD_D.indexOf('### 11.4');
  const section = PRD_D.slice(start, PRD_D.indexOf('\n## ', start));
  return section
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .slice(2)
    .map((line) => {
      const [event = '', recipients = '', channels = '', stage = ''] = line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim());
      return { event, recipients, channels, stage };
    });
}

/** 11.4 第一期（阶段「一起」）的每一行对应的通知类型、接收人与钉钉工作通知（照表手写） */
const PHASE1: Record<NotificationType, { row: string; recipients: string; dingtalk: boolean }> = {
  channel_disconnected: {
    row: '渠道连接异常（钉钉除外）',
    recipients: '客服主管、管理员',
    dingtalk: true,
  },
  channel_recovered: {
    row: '渠道连接恢复（钉钉除外）',
    recipients: '客服主管、管理员',
    dingtalk: false,
  },
  dingtalk_sync_failed: { row: '钉钉同步失败（E-32）', recipients: '管理员', dingtalk: false },
  // 「未归属店铺来信（E-13）；登记新店铺后来信自动归位」是一行两种通知：渠道写「站内 + 钉钉工作通知；自动归位只发站内」
  unassigned_mail: {
    row: '未归属店铺来信（E-13）；登记新店铺后来信自动归位',
    recipients: '客服主管',
    dingtalk: true,
  },
  unassigned_mail_placed: {
    row: '未归属店铺来信（E-13）；登记新店铺后来信自动归位',
    recipients: '客服主管',
    dingtalk: false,
  },
  reassign_queue: {
    row: '成员停用后其工单与售后单进入改派队列',
    recipients: '客服主管',
    dingtalk: false,
  },
};

describe('通知类型与接收人（PRD 11.4）', () => {
  it('第一期的通知类型正好覆盖 11.4 中阶段为「一起」的行', () => {
    const phase1Rows = prdNotificationRows().filter((row) => row.stage === '一起');
    expect(phase1Rows.map((row) => row.event)).toEqual([
      '渠道连接异常（钉钉除外）',
      '渠道连接恢复（钉钉除外）',
      '钉钉同步失败（E-32）',
      '未归属店铺来信（E-13）；登记新店铺后来信自动归位',
      '成员停用后其工单与售后单进入改派队列',
    ]);
    expect([...notificationTypes].sort()).toEqual(Object.keys(PHASE1).sort());
    expect(
      new Set(notificationTypes.map((type) => notificationTypeDefinitions[type].event)),
    ).toEqual(new Set(phase1Rows.map((row) => row.event)));
  });

  it.each(notificationTypes)('%s：接收人的角色与钉钉工作通知照 11.4', (type) => {
    const definition = notificationTypeDefinitions[type];
    expect(definition.event).toBe(PHASE1[type].row);
    expect(roleNames(definition.recipients)).toBe(PHASE1[type].recipients);
    expect(definition.dingtalk).toBe(PHASE1[type].dingtalk);
  });

  it('11.4 的表里接收人与渠道的写法与常量一致（PRD 改了这里会失败）', () => {
    const rows = new Map(prdNotificationRows().map((row) => [row.event, row]));
    for (const type of notificationTypes) {
      const row = rows.get(notificationTypeDefinitions[type].event);
      // 表里管理员写在客服主管前面，roleNames 按 10.1 的角色顺序写，两边按集合比
      expect(new Set(row?.recipients.split('、'))).toEqual(
        new Set(roleNames(notificationTypeDefinitions[type].recipients).split('、')),
      );
      expect(row?.channels.startsWith('站内')).toBe(true);
    }
    expect(rows.get('钉钉同步失败（E-32）')?.channels).toBe('站内');
    expect(rows.get('渠道连接异常（钉钉除外）')?.channels).toBe('站内 + 钉钉工作通知');
    expect(rows.get('未归属店铺来信（E-13）；登记新店铺后来信自动归位')?.channels).toBe(
      '站内 + 钉钉工作通知；自动归位只发站内',
    );
  });
});

describe('通知的时间写法（G10）', () => {
  // 演示时刻 2026-09-11 周五 10:20 北京时间
  const now = new Date('2026-09-11T02:20:00Z');

  it('当天只写时:分（原型「10:14」）', () => {
    expect(notificationTimeWords('2026-09-11T02:14:00Z', now)).toBe('10:14');
    // 北京时间当天 00:05，UTC 还是前一天
    expect(notificationTimeWords('2026-09-10T16:05:00Z', now)).toBe('00:05');
  });

  it('之前的日子写「月-日 时:分」，不在今年的写全年份（同 P27 时间列）', () => {
    expect(notificationTimeWords('2026-09-10T09:20:00Z', now)).toBe('09-10 17:20');
    expect(notificationTimeWords('2025-12-31T15:59:00Z', now)).toBe('2025-12-31 23:59');
  });
});
