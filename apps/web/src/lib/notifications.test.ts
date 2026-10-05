import type { CurrentMember, Notification, Role } from '@forcome/contracts';
import { describe, expect, it } from 'vitest';
import { notificationTarget, unreadBadge } from './notifications';
import { pages } from './pages';

/* 铃铛角标的写法与点一条的去向（G10；打不开目标页的只标为已读，同 P27 v2.20 的可点规则） */

function member(...memberRoles: Role[]): CurrentMember {
  return {
    id: 'm',
    name: '某人',
    dept: 'FSH',
    roles: memberRoles,
    stores: { all: true },
    density: 'comfortable',
    nav: [],
    home: 'tickets',
  };
}

function notification(type: Notification['type']): Notification {
  return {
    id: 'n',
    type,
    title: '标题',
    body: '说明',
    object: { type: 'channel', id: 'gmail', label: 'P18 · Gmail' },
    createdAt: '2026-09-11T02:14:00.000Z',
    read: false,
  };
}

describe('铃铛角标', () => {
  it('没有未读不显示，超过 99 写「99+」', () => {
    expect(unreadBadge(0)).toBeNull();
    expect(unreadBadge(3)).toBe('3');
    expect(unreadBadge(99)).toBe('99');
    expect(unreadBadge(100)).toBe('99+');
  });
});

describe('点一条跳到哪里', () => {
  it('渠道与钉钉的通知进 P18：管理员能打开，客服主管打不开（只标为已读）', () => {
    for (const type of [
      'channel_disconnected',
      'channel_recovered',
      'dingtalk_sync_failed',
    ] as const) {
      expect(notificationTarget(notification(type), member('admin'))).toBe(pages.settingsChannels);
      expect(notificationTarget(notification(type), member('supervisor'))).toBeNull();
    }
    // 兼管理员的客服主管能打开
    expect(
      notificationTarget(notification('channel_disconnected'), member('supervisor', 'admin')),
    ).toBe(pages.settingsChannels);
  });

  it('未归属店铺来信与自动归位进 P04，改派队列进 P13：接收人客服主管都能打开', () => {
    const supervisor = member('supervisor');
    expect(notificationTarget(notification('unassigned_mail'), supervisor)).toBe(pages.tickets);
    expect(notificationTarget(notification('unassigned_mail_placed'), supervisor)).toBe(
      pages.tickets,
    );
    expect(notificationTarget(notification('reassign_queue'), supervisor)).toBe(
      pages.aftersalesLedger,
    );
  });
});
