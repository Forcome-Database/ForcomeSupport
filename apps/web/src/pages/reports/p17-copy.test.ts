import { readFileSync } from 'node:fs';
import { reportPeriodLabels, reportPeriods, ticketDrillOf } from '@forcome/contracts';
import { describe, expect, it } from 'vitest';
import { pages } from '@/lib/pages';
import { drillChipWords } from '@/pages/tickets/p04-words';
import {
  COMPARE,
  DAILY,
  EMPTY,
  FILTERS,
  KPI,
  NOTES,
  PAGE_TITLE,
  SOURCES,
  UPDATED,
} from './p17-copy';
import { firstResponseDelta, slaDelta, volumeDelta } from './p17-words';

/*
 * P17 的界面文案与原型逐字一致（CLAUDE.md「文案逐字照原型」）：直接读原型生成物——第一期参照页 P17_Reports 与状态板
 * StatesAdmin（K19 管理员小图与补充小样①–⑤）；原型没画的写法核对 PRD P17「第一阶段」v2.34。原型改了而代码没跟上、或反过来，都会失败。
 */

const read = (path: string) =>
  readFileSync(new URL(`../../../../../${path}`, import.meta.url), 'utf8');
const P17 = read('design/spec/phase1/P17_Reports.dc.html');
const STATES_ADMIN = read('design/StatesAdmin.dc.html');
const PRD_C = read('design/spec/prd_c.md');

/** 原型里有这段界面文字，且是一个元素的完整文本 */
function expectText(html: string, text: string) {
  expect(text, '要核对的文案为空').toBeTruthy();
  expect(html.includes(`>${text}<`), `原型里没有「${text}」`).toBe(true);
}

const TODAY = '2026-09-11';
const week = { period: '7d' as const, from: '2026-09-05', to: TODAY };
const month = { period: 'month' as const, from: '2026-09-01', to: TODAY };
const H = 3_600_000;
const M = 60_000;

describe('P17 第一期参照页', () => {
  it('页头、顶栏导航、数据来源与两条注逐字一致；不显示「指标为示例数据」（Q1）', () => {
    expectText(P17, PAGE_TITLE);
    expectText(P17, pages.reports.label);
    expectText(P17, `${SOURCES} · ${UPDATED.at('10:12')}`);
    expectText(P17, NOTES.replies);
    expectText(P17, NOTES.backfill(60));
    expect(P17.includes('指标为示例数据')).toBe(false);
  });

  it('筛选行：近 7 天 · 本月 · 自定义、起止、店铺与站点', () => {
    for (const period of reportPeriods) expectText(P17, reportPeriodLabels[period]);
    expectText(P17, '09-05 至 09-11');
    expectText(P17, `${FILTERS.store}：`);
    expectText(P17, `${FILTERS.site}：`);
  });

  it('三张指标：名称、对比与副标题（对比按原型的数字算出来的写法）', () => {
    for (const label of [KPI.volume, KPI.firstResponse, KPI.sla]) expectText(P17, label);
    expectText(P17, volumeDelta(357, 331, week)!.text);
    expectText(P17, firstResponseDelta(2 * H + 14 * M, 2 * H + 49 * M, week)!.text);
    expectText(P17, slaDelta({ met: 964, counted: 1000 }, { met: 952, counted: 1000 }, week)!.text);
    expectText(P17, KPI.volumeSub('近 7 天'));
    expectText(P17, KPI.firstResponseSub);
    expectText(P17, KPI.slaSub(11));
  });

  it('每日工单量：标题、副标题、查看明细、图例与悬停浮层', () => {
    expectText(P17, DAILY.title);
    expectText(P17, DAILY.sub('近 7 天', true));
    expectText(P17, DAILY.detail);
    expectText(P17, DAILY.amazon);
    expectText(P17, DAILY.shopifyEmail);
    expectText(P17, DAILY.tipTitle('09-10', 73));
    expectText(P17, DAILY.tipSplit(52, 21));
    const drill = ticketDrillOf({ drill: 'triggered', drillFrom: '2026-09-10' })!;
    expectText(P17, DAILY.tipDrill(drillChipWords(drill, TODAY)));
  });
});

describe('K19 管理员小图与补充小样', () => {
  it('管理员：每日工单量没有「点柱下钻」，卡头「没有工单页权限 · 不可下钻」', () => {
    expectText(STATES_ADMIN, DAILY.sub('近 7 天', false));
    expectText(STATES_ADMIN, DAILY.noDrill);
  });

  it('① 本月对比上月同期；首响变长、达标率降低', () => {
    expectText(STATES_ADMIN, volumeDelta(298, 307, month)!.text);
    expectText(STATES_ADMIN, firstResponseDelta(3 * H + 19 * M, 2 * H + 14 * M, month)!.text);
    expectText(
      STATES_ADMIN,
      slaDelta({ met: 941, counted: 1000 }, { met: 949, counted: 1000 }, month)!.text,
    );
    expectText(STATES_ADMIN, KPI.volumeSub('本月'));
  });

  it('② 自定义的副标题；③ 未归属店铺的未达标来信', () => {
    expectText(STATES_ADMIN, KPI.volumeSub('09-01 至 09-03'));
    expectText(STATES_ADMIN, `${KPI.slaSub(11)} · ${KPI.slaUnassigned(2)}`);
  });

  it('④ 无数据（K4 第一阶段）与 ⑤ 加载中（K3 第一阶段）', () => {
    expectText(STATES_ADMIN, KPI.none);
    expectText(STATES_ADMIN, KPI.noData);
    expectText(STATES_ADMIN, EMPTY.title);
    expectText(STATES_ADMIN, EMPTY.description('近 7 天', 'Forcome Direct'));
    expectText(STATES_ADMIN, EMPTY.adjust);
    expectText(STATES_ADMIN, EMPTY.clear);
    expectText(STATES_ADMIN, FILTERS.clear);
    expectText(STATES_ADMIN, `${FILTERS.loading} · ${UPDATED.at('10:12')}`);
  });
});

describe('原型没画的写法（PRD P17「第一阶段」v2.34）', () => {
  it('对比的前缀、持平、「更新于 —」、全部店铺', () => {
    for (const text of [
      COMPARE.week,
      COMPARE.month,
      COMPARE.days(3).replace('3', 'N'),
      COMPARE.flat,
      UPDATED.at(UPDATED.never),
      EMPTY.allStores,
    ]) {
      expect(PRD_C.includes(text), `PRD 里没有「${text}」`).toBe(true);
    }
  });
});
