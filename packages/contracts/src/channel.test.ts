import { describe, expect, it } from 'vitest';
import {
  mailboxError,
  normalizeStoreInput,
  orderBackfillSummary,
  orderQueueStatus,
  storeInputErrors,
  SYNC_DELAY_MS,
  syncConnectionStatus,
  worstConnectionStatus,
  type StoreInput,
} from './channel';

// 店铺抽屉（PRD P18「校验」、K8、AC-ST-01）：逐项校验，错误写在字段下方；店铺名重复、进线邮箱与其他店铺重复
// 要查库，由 channel 模块在保存时补上，这里只管表单本身能判断的部分
const valid: StoreInput = {
  name: 'forcome.ca',
  platform: 'shopify',
  sites: ['CA'],
  defaultSite: 'CA',
  mailboxes: ['support@forcome.ca'],
  platformId: 'forcome-ca.myshopify.com',
};

describe('店铺输入的字段级校验（K8）', () => {
  it('填写完整时没有错误', () => {
    expect(storeInputErrors(valid)).toEqual({});
  });

  it('平台标识为空：按平台写出该填什么（AC-ST-01）', () => {
    expect(storeInputErrors({ ...valid, platformId: '  ' })).toEqual({
      platformId: '请填写店铺域名',
    });
    expect(storeInputErrors({ ...valid, platform: 'amazon', platformId: '' })).toEqual({
      platformId: '请填写卖家 ID',
    });
    expect(storeInputErrors({ ...valid, platform: null, platformId: '' })).toEqual({
      platform: '请选择平台',
      platformId: '请填写平台标识',
    });
  });

  it('进线邮箱逐个校验格式，错误落在对应的那一个上', () => {
    expect(
      storeInputErrors({ ...valid, mailboxes: ['support@forcome.ca', 'info@forcome'] }),
    ).toEqual({ 'mailboxes.1': '邮箱格式不正确，例如 info@forcome.mx' });
  });

  it('同一个店铺里重复填写的邮箱（不分大小写）指出是哪一个', () => {
    expect(
      storeInputErrors({ ...valid, mailboxes: ['support@forcome.ca', ' Support@Forcome.CA '] }),
    ).toEqual({ 'mailboxes.1': 'support@forcome.ca 已经填过' });
  });

  it('其余必填项为空时各自报错，一次列全', () => {
    expect(
      storeInputErrors({
        name: ' ',
        platform: null,
        sites: [],
        defaultSite: null,
        mailboxes: [],
        platformId: '',
      }),
    ).toEqual({
      name: '请填写店铺名',
      platform: '请选择平台',
      sites: '请选择站点',
      defaultSite: '请选择默认站点',
      mailboxes: '至少填写一个进线邮箱',
      platformId: '请填写平台标识',
    });
  });

  it('默认站点必须是所选站点之一', () => {
    expect(storeInputErrors({ ...valid, sites: ['US'], defaultSite: 'MX' })).toEqual({
      defaultSite: '请选择默认站点',
    });
  });
});

describe('单个进线邮箱的就地检查（抽屉按回车加入前）', () => {
  it('格式不对、或与前面已填的重复（不分大小写）时给出错误，没问题为 null', () => {
    expect(mailboxError('info@forcome', [])).toBe('邮箱格式不正确，例如 info@forcome.mx');
    expect(mailboxError(' Ventas@Forcome.MX ', ['ventas@forcome.mx'])).toBe(
      'ventas@forcome.mx 已经填过',
    );
    expect(mailboxError('help+mx@forcome.mx', ['ventas@forcome.mx'])).toBeNull();
  });
});

describe('店铺输入的规范化', () => {
  it('去掉首尾空白，进线邮箱转小写，站点按 US · CA · MX 排序去重', () => {
    expect(
      normalizeStoreInput({
        ...valid,
        name: '  forcome.ca ',
        sites: ['MX', 'US', 'MX'],
        defaultSite: 'US',
        mailboxes: [' Support@Forcome.CA ', 'Ventas@forcome.ca'],
        platformId: ' forcome-ca.myshopify.com ',
      }),
    ).toEqual({
      ...valid,
      name: 'forcome.ca',
      sites: ['US', 'MX'],
      defaultSite: 'US',
      mailboxes: ['support@forcome.ca', 'ventas@forcome.ca'],
      platformId: 'forcome-ca.myshopify.com',
    });
  });
});

describe('渠道卡显示最差的连接状态（PRD 6.9）', () => {
  it('连接异常 > 未连接 > 同步延迟 > 已连接；没有连接时为未连接', () => {
    expect(worstConnectionStatus(['connected', 'delayed'])).toBe('delayed');
    expect(worstConnectionStatus(['delayed', 'not_connected', 'connected'])).toBe('not_connected');
    expect(worstConnectionStatus(['not_connected', 'error'])).toBe('error');
    expect(worstConnectionStatus(['connected', 'connected'])).toBe('connected');
    expect(worstConnectionStatus([])).toBe('not_connected');
  });
});

describe('按同步记录算连接状态（PRD 6.9：钉钉超过 2 小时未同步为同步延迟，连续 3 次失败为连接异常）', () => {
  const now = new Date('2026-09-11T10:20:00+08:00');
  const at = (time: string) => new Date(`2026-09-11T${time}:00+08:00`);

  it('最近一次成功在阈值以内为已连接，超过阈值为同步延迟', () => {
    const delay = SYNC_DELAY_MS.dingtalk;
    expect(
      syncConnectionStatus({ lastSuccessAt: at('08:20'), consecutiveFailures: 0 }, delay, now),
    ).toBe('connected');
    expect(
      syncConnectionStatus({ lastSuccessAt: at('08:19'), consecutiveFailures: 2 }, delay, now),
    ).toBe('delayed');
    expect(SYNC_DELAY_MS.gmail).toBe(10 * 60_000);
  });

  it('连续 3 次失败为连接异常（不论最近一次成功是什么时候）；从没成功过为未连接', () => {
    const delay = SYNC_DELAY_MS.dingtalk;
    expect(
      syncConnectionStatus({ lastSuccessAt: at('10:00'), consecutiveFailures: 3 }, delay, now),
    ).toBe('error');
    expect(syncConnectionStatus({ lastSuccessAt: null, consecutiveFailures: 1 }, delay, now)).toBe(
      'not_connected',
    );
    expect(syncConnectionStatus({ lastSuccessAt: null, consecutiveFailures: 3 }, delay, now)).toBe(
      'error',
    );
  });
});

describe('订单通知队列（SQS）的状态（待办 12，协调者 2026-10-06 决定 Q7）', () => {
  it('没配置为未连接；连续 3 次拉取失败为拉取失败；等待拉取的达到 10 条为积压；否则正常', () => {
    expect(orderQueueStatus({ configured: false, consecutiveFailures: 5, backlog: 40 })).toEqual({
      status: 'not_connected',
      backlog: null,
    });
    expect(orderQueueStatus({ configured: true, consecutiveFailures: 0, backlog: null })).toEqual({
      status: 'normal',
      backlog: null,
    });
    expect(orderQueueStatus({ configured: true, consecutiveFailures: 2, backlog: 9 })).toEqual({
      status: 'normal',
      backlog: 9,
    });
    expect(orderQueueStatus({ configured: true, consecutiveFailures: 0, backlog: 10 })).toEqual({
      status: 'backlog',
      backlog: 10,
    });
    expect(orderQueueStatus({ configured: true, consecutiveFailures: 3, backlog: 12 })).toEqual({
      status: 'failed',
      backlog: 12,
    });
  });
});

describe('渠道卡的订单回补行（待办 13，协调者 2026-10-06 决定 Q2）', () => {
  const done = { windowDays: 90, historyLimited: false, orders: 120, completed: true };
  const running = { windowDays: 90, historyLimited: false, orders: 35, completed: false };
  const shopify60 = { windowDays: 60, historyLimited: true, orders: 8, completed: true };

  it('只汇总连接上的店铺：都未连接（或没有店铺）时没有回补行', () => {
    expect(orderBackfillSummary([])).toBeNull();
    expect(orderBackfillSummary([{ status: 'not_connected', backfill: done }])).toBeNull();
  });

  it('有进行中的写进行中（已回补笔数为各店铺合计）；否则有未开始的写未开始；全部完成才写已完成', () => {
    expect(
      orderBackfillSummary([
        { status: 'connected', backfill: done },
        { status: 'delayed', backfill: running },
        { status: 'connected', backfill: null },
      ]),
    ).toEqual({ days: 90, state: 'running', orders: 155, historyLimited: false });
    // 上线后新加的店铺还没回补：回到未开始，提示管理员再执行一次
    expect(
      orderBackfillSummary([
        { status: 'connected', backfill: done },
        { status: 'connected', backfill: null },
      ]),
    ).toEqual({ days: 90, state: 'not_started', orders: 120, historyLimited: false });
    expect(orderBackfillSummary([{ status: 'connected', backfill: null }])).toEqual({
      days: 90,
      state: 'not_started',
      orders: 0,
      historyLimited: false,
    });
    expect(
      orderBackfillSummary([
        { status: 'connected', backfill: done },
        { status: 'error', backfill: done },
      ]),
    ).toEqual({ days: 90, state: 'completed', orders: 240, historyLimited: false });
  });

  it('未连接的店铺不计：它没回补也不影响已完成', () => {
    expect(
      orderBackfillSummary([
        { status: 'connected', backfill: done },
        { status: 'not_connected', backfill: null },
        { status: 'not_connected', backfill: running },
      ]),
    ).toEqual({ days: 90, state: 'completed', orders: 120, historyLimited: false });
  });

  it('天数取各店铺回补窗口中最短的；有店铺没开通 read_all_orders 时注明', () => {
    expect(
      orderBackfillSummary([
        { status: 'connected', backfill: done },
        { status: 'connected', backfill: shopify60 },
      ]),
    ).toEqual({ days: 60, state: 'completed', orders: 128, historyLimited: true });
    expect(
      orderBackfillSummary([
        { status: 'connected', backfill: { ...shopify60, completed: false } },
        { status: 'not_connected', backfill: null },
      ]),
    ).toEqual({ days: 60, state: 'running', orders: 8, historyLimited: true });
  });
});
