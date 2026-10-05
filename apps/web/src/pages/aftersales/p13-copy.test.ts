import { readFileSync } from 'node:fs';
import {
  aftersalesStatusLabels,
  feeItemLabels,
  formatMoney,
  handlingMethodLabels,
  ratioGroupLabels,
  registrationMessages,
  responsibilityLabels,
} from '@forcome/contracts';
import { describe, expect, it } from 'vitest';
import { pages } from '@/lib/pages';
import {
  COLUMNS,
  DRAWER,
  EMPTY_TITLE,
  EMPTY_VALUE,
  FINANCE_COLUMNS,
  NEW_REGISTRATION,
  PAGE_DESCRIPTION,
  PAGE_TITLE,
  storeSite,
} from './p13-copy';

/*
 * P13 与新建登记抽屉的界面文案与原型逐字一致（CLAUDE.md「文案逐字照原型」，ADR 0007 修订）：直接读原型生成物——第一期参照页
 * P13_AfterSalesLog（售后负责人）与 P13_AfterSalesLog_agent（坐席），状态板 StatesAfterSales（S10、S14）。原型改了文案而代码没跟上、
 * 或反过来，都会失败。原型由 design/spec 下的脚本生成（README「修改与重建」），改原型后要重新生成再跑这里。
 * 示例数据：S14 的新建登记是 forcome.com · Olivia Turner · 寄配件（HEPA 滤芯组件 FC-V2-HF01 × 1，产品成本 $3.20、运费 $6.80）。
 */

const read = (path: string) =>
  readFileSync(new URL(`../../../../../${path}`, import.meta.url), 'utf8');
const P13 = read('design/spec/phase1/P13_AfterSalesLog.dc.html');
const P13_AGENT = read('design/spec/phase1/P13_AfterSalesLog_agent.dc.html');
const STATES = read('design/StatesAfterSales.dc.html');

/** 原型里有这段文字；先确认要核对的文字不是空的（空串处处都「包含」，会让核对空过） */
function expectIn(html: string, text: string | null | undefined) {
  expect(text, '要核对的文案为空').toBeTruthy();
  expect(html.includes(text ?? ''), `原型里没有「${text}」`).toBe(true);
}

/** 原型里有这段界面文字，且是一个元素的完整文本 */
function expectText(html: string, text: string) {
  expectIn(html, `>${text}<`);
}

describe('expectIn 本身', () => {
  it('要核对的文案为空时失败，不会空过', () => {
    expect(() => expectIn(P13, '')).toThrow(/要核对的文案为空/);
    expect(() => expectIn(P13, '原型里不会有这句话')).toThrow(/原型里没有/);
  });
});

describe('P13 第一期参照页', () => {
  it('页头：标题、两种角色的说明、「新建登记」只在售后负责人的画面里', () => {
    expectText(P13, PAGE_TITLE);
    expectText(P13, pages.aftersalesLedger.label);
    expectIn(P13, PAGE_DESCRIPTION.finance);
    expectIn(P13_AGENT, PAGE_DESCRIPTION.readOnly);
    expectText(P13, NEW_REGISTRATION);
    expect(P13_AGENT.includes(`>${NEW_REGISTRATION}<`)).toBe(false);
  });

  it('列名：售后单号到快递单号七列两个画面都有，金额列只在售后负责人的画面里', () => {
    for (const title of Object.values(COLUMNS)) {
      expectText(P13, title);
      expectText(P13_AGENT, title);
    }
    for (const title of Object.values(FINANCE_COLUMNS)) {
      expectText(P13, title);
      expect(P13_AGENT.includes(`>${title}<`), title).toBe(false);
    }
  });

  it('单元格的写法：店铺与站点、处理方式与责任、状态、原币金额、没有值的「—」', () => {
    expectText(P13, storeSite('Forcome Direct', 'US'));
    expectText(P13, storeSite('forcome.com', 'US'));
    for (const label of Object.values(handlingMethodLabels)) expectText(P13, label);
    for (const label of ['客户使用问题', '产品质量问题', '物流问题', '其他'] as const) {
      expectText(P13, label);
    }
    expect(Object.values(responsibilityLabels)).toEqual([
      '客户使用问题',
      '产品质量问题',
      '物流问题',
      '其他',
    ]);
    expectIn(P13, aftersalesStatusLabels.completed);
    expectIn(P13, aftersalesStatusLabels.in_progress);
    expectText(P13, formatMoney('3.20', 'USD'));
    expectIn(P13, formatMoney('889.00', 'MXN'));
    expectIn(P13_AGENT, '>1Z4R28830358229041<');
    expectText(P13, EMPTY_VALUE);
  });
});

describe('S10 列表为空、S14 新建登记抽屉', () => {
  it('S10 的标题', () => {
    expectText(STATES, EMPTY_TITLE);
  });

  it('抽屉标题、说明、各节标题与右侧灰字、处理方式三张卡片', () => {
    expectText(STATES, DRAWER.createTitle);
    expectIn(STATES, DRAWER.description);
    expectIn(STATES, `>${DRAWER.sections.method}<`);
    expectText(STATES, DRAWER.sections.methodNote);
    expectText(STATES, DRAWER.sections.basic);
    expectText(STATES, DRAWER.sections.responsibility);
    expectText(STATES, DRAWER.sections.shipping);
    expectText(STATES, DRAWER.sections.shippingNote);
    expectIn(STATES, DRAWER.sections.fees);
    expectText(STATES, DRAWER.sections.feeTotal('$10.00'));
    for (const [method, note] of Object.entries(DRAWER.methods)) {
      expectText(STATES, handlingMethodLabels[method as keyof typeof DRAWER.methods]);
      expectText(STATES, note);
    }
  });

  it('字段名、灰字与占位（原型画出来的部分）', () => {
    const { labels } = DRAWER;
    for (const label of [
      labels.storeId,
      labels.site,
      labels.orderNumber,
      labels.customerName,
      labels.feeDate,
      labels.responsibility,
      labels.responsibilityReason,
      labels.partSku,
      labels.partQuantity,
      labels.shipper,
      labels.carrier,
      labels.shipDate,
      labels.trackingNumber,
    ]) {
      expectIn(STATES, `>${label}<`);
    }
    for (const fee of Object.values(feeItemLabels)) expectIn(STATES, `>${fee}<`);
    expectIn(STATES, `${labels.sourceTicket}<`);
    expectIn(STATES, `>${DRAWER.sourceTicketNote}<`);
    expectIn(STATES, `${labels.ownerId}<`);
    expectIn(STATES, `>${DRAWER.ownerNotes.only}<`);
    expectText(STATES, DRAWER.ownerOption('王磊'));
    expectIn(STATES, `${labels.factory}<`);
    expectIn(STATES, `>${DRAWER.factoryFromPart('FC-V2-HF01')}<`);
    expectIn(STATES, `>${DRAWER.factoryRequired}<`);
    expectText(STATES, DRAWER.reasonPlaceholder);
    expectIn(STATES, `>${DRAWER.reasonCounter(0, 200)}<`);
    expectText(STATES, DRAWER.partOption('HEPA 滤芯组件', 'FC-V2-HF01'));
    expectText(STATES, DRAWER.quantitySuffix);
    expectText(STATES, DRAWER.afterShipping);
    expectIn(STATES, `${labels.ratios}<`);
    expectIn(STATES, `>${DRAWER.ratioNote}<`);
    expectText(STATES, DRAWER.feesHint);
  });

  it('比例表：表头、三组的叫法、合计与比例有误时的写法', () => {
    for (const header of Object.values(DRAWER.ratioHeaders)) expectText(STATES, header);
    for (const group of Object.values(ratioGroupLabels)) expectText(STATES, group);
    expectText(STATES, DRAWER.ratioTotal('$0.00', '$10.00'));
    expectText(STATES, DRAWER.ratioTotalError);
  });

  it('底部与保存时校验：说明、按钮、错误横幅、字段下方的三条报错', () => {
    expectText(STATES, DRAWER.footerNote);
    expectText(STATES, DRAWER.footerNoteWithErrors);
    expectText(STATES, DRAWER.cancel);
    expectText(STATES, DRAWER.save);
    expectText(STATES, DRAWER.errorsTitle(3));
    expectText(STATES, DRAWER.errorsDescription(DRAWER.labels.responsibilityReason));
    expectIn(STATES, registrationMessages.ratio);
    expectIn(STATES, registrationMessages.refundCompensation);
    expectIn(STATES, registrationMessages.reasonMissing);
  });
});
