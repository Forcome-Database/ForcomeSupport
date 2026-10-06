import type { ChannelCard, ChannelIssue, Store } from '@forcome/contracts';
import { describe, expect, it } from 'vitest';
import { channelCardLines, needsRecheck } from './channel-card-lines';

/*
 * 渠道卡的说明行（K20 补充小样，待办 09）：Gmail 卡已连接、同步延迟、连接异常、几个邮箱同时异常又有延迟；钉钉卡同步延迟、
 * 连接异常、从没同步成功过。时刻按北京时间写「时:分」。画面上的布局另由 e2e（channel-status.spec.ts）与截图覆盖。
 */

const store = (platform: Store['platform'], mailboxes: string[]): Store => ({
  id: crypto.randomUUID(),
  name: mailboxes[0] ?? '',
  platform,
  sites: ['US'],
  defaultSite: 'US',
  mailboxes,
  platformId: 'x',
  adapterMode: 'fake',
  connections: [],
  version: 1,
  updatedAt: '2026-09-11T02:00:00.000Z',
  updatedBy: null,
});
const STORES = [
  store('amazon', ['amz-direct@forcome.com']),
  store('amazon', ['amz-auto@forcome.com']),
  store('shopify', ['support@forcome.com']),
  store('shopify', ['support@forcome.mx']),
];

const card = (overrides: Partial<ChannelCard>): ChannelCard => ({
  kind: 'gmail',
  status: 'connected',
  simulated: false,
  lastSyncAt: '2026-09-11T02:18:00.000Z',
  issues: [],
  ...overrides,
});

const issue = (overrides: Partial<ChannelIssue>): ChannelIssue => ({
  target: 'support@forcome.mx',
  status: 'error',
  lastSuccessAt: '2026-09-11T02:04:00.000Z',
  failingSince: '2026-09-11T02:05:00.000Z',
  failures: 3,
  ...overrides,
});

describe('Gmail 卡', () => {
  it('已连接：邮箱数与「已发送」', () => {
    expect(channelCardLines(card({}), STORES)).toEqual([
      '4 个邮箱：2 个亚马逊买家消息、2 个 Shopify 客服',
      '收件与「已发送」：识别到我方回复即转等客户',
    ]);
    expect(needsRecheck(card({}))).toBe(false);
  });

  it('同步延迟：每个延迟的邮箱一行在前，其余说明行照常（Q3）', () => {
    const delayed = card({
      status: 'delayed',
      issues: [
        issue({
          status: 'delayed',
          failingSince: null,
          failures: 0,
          lastSuccessAt: '2026-09-11T02:05:00.000Z',
        }),
      ],
    });
    expect(channelCardLines(delayed, STORES)).toEqual([
      'support@forcome.mx 10:05 后未同步成功，超过 10 分钟',
      '4 个邮箱：2 个亚马逊买家消息、2 个 Shopify 客服',
      '收件与「已发送」：识别到我方回复即转等客户',
    ]);
    expect(needsRecheck(delayed)).toBe(false);
  });

  it('连接异常：原因与恢复指引、来信暂存，卡底「重新检测」（Q2）', () => {
    const failed = card({ status: 'error', issues: [issue({})] });
    expect(channelCardLines(failed, STORES)).toEqual([
      'support@forcome.mx 访问失败（10:05 起连续 3 次）：请检查全域委派范围与邮箱状态',
      '该邮箱来信暂存，恢复后自动补拉',
    ]);
    expect(needsRecheck(failed)).toBe(true);
  });

  it('几个邮箱同时异常又有延迟：每个一行、次数为实际的连续失败次数，暂存说明写一次，延迟在后（E2、E3）', () => {
    const mixed = card({
      status: 'error',
      issues: [
        issue({ target: 'amz-auto@forcome.com', failingSince: '2026-09-11T02:12:00.000Z' }),
        issue({
          target: 'support@forcome.com',
          status: 'delayed',
          failures: 0,
          failingSince: null,
          lastSuccessAt: '2026-09-11T02:06:00.000Z',
        }),
        issue({ failures: 5 }),
      ],
    });
    expect(channelCardLines(mixed, STORES)).toEqual([
      'amz-auto@forcome.com 访问失败（10:12 起连续 3 次）：请检查全域委派范围与邮箱状态',
      'support@forcome.mx 访问失败（10:05 起连续 5 次）：请检查全域委派范围与邮箱状态',
      '该邮箱来信暂存，恢复后自动补拉',
      'support@forcome.com 10:06 后未同步成功，超过 10 分钟',
    ]);
  });
});

describe('钉钉卡', () => {
  const dingtalk = (overrides: Partial<ChannelCard>) =>
    card({ kind: 'dingtalk', lastSyncAt: '2026-09-11T00:00:00.000Z', ...overrides });

  it('已连接：第一阶段的两行', () => {
    expect(channelCardLines(dingtalk({}), STORES)).toEqual([
      '通讯录：成员与部门每小时同步',
      '工作通知推送；扫码登录',
    ]);
  });

  it('同步延迟与连接异常：第一行换成未同步成功的说明（K20、Q6）', () => {
    const tail = [
      '只提醒管理员，不出全站横幅；成员与部门保持上次结果，登录与权限不受影响',
      '工作通知推送；扫码登录',
    ];
    expect(channelCardLines(dingtalk({ status: 'delayed' }), STORES)).toEqual([
      '通讯录 08:00 后未同步成功，超过 2 小时',
      ...tail,
    ]);
    expect(channelCardLines(dingtalk({ status: 'error' }), STORES)).toEqual([
      '通讯录 08:00 后未同步成功，连续 3 次失败',
      ...tail,
    ]);
    // 从没同步成功过（E4）
    expect(channelCardLines(dingtalk({ status: 'error', lastSyncAt: null }), STORES)).toEqual([
      '通讯录尚未同步成功，连续 3 次失败',
      ...tail,
    ]);
  });
});

describe('订单卡', () => {
  it('店铺数与同步方式', () => {
    expect(channelCardLines(card({ kind: 'amazon' }), STORES)).toEqual([
      '2 个店铺 · 订单经 SP-API 准实时同步',
    ]);
    expect(channelCardLines(card({ kind: 'shopify' }), STORES)).toEqual([
      '2 个店铺 · 订单经 Admin API 准实时同步',
    ]);
  });
});
