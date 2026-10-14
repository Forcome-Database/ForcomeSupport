import { readFileSync } from 'node:fs';
import {
  aftersalesStatusLabels,
  completionLabel,
  feeItemLabels,
  formatMoney,
  formatRate,
  formatRateDate,
  handlingMethodLabels,
  ledgerActionMessages,
  ledgerColumns,
  ledgerDefaultHidden,
  ledgerFinanceColumns,
  missingItemLabels,
  rateChangeMessages,
  ratioGroupLabels,
  ratioGroupWords,
  ratioPairsOf,
  ratioWords,
  reassignMessages,
  reassignQueueNotificationCopy,
  registrationMessages,
  responsibilityLabels,
} from '@forcome/contracts';
import { describe, expect, it } from 'vitest';
import { pages } from '@/lib/pages';
import {
  BACKFILL_RESULT,
  CANCEL,
  COLUMN_SETTINGS,
  COLUMNS,
  COMPLETE_RESULT,
  COMPLETION,
  DRAWER,
  EDIT,
  EMPTY,
  EMPTY_TITLE,
  EMPTY_VALUE,
  EXPORT,
  FILTERS,
  FOREIGN_AMOUNT,
  LEAVE,
  MISSING,
  MISSING_FILTER,
  MORE,
  NEW_REGISTRATION,
  NOT_KEPT,
  NOTE,
  OWNER_CELL,
  PAGE_DESCRIPTION,
  PAGE_TITLE,
  rangeLabel,
  REASSIGN,
  SAVE_RESULT,
  SHARE,
  LOOKUP,
  STALE,
  TOTALS,
  storeSite,
} from './p13-copy';

/*
 * P13 与新建登记抽屉的界面文案与原型逐字一致（CLAUDE.md「文案逐字照原型」，ADR 0007 修订）：直接读原型生成物——第一期参照页
 * P13_AfterSalesLog（售后负责人）与 P13_AfterSalesLog_agent（坐席），状态板 StatesAfterSales（S10、S14）。原型改了文案而代码没跟上、
 * 或反过来，都会失败。原型由 design/spec 下的脚本生成（README「修改与重建」），改原型后要重新生成再跑这里。
 * 实现时补的文案（10-05 用户确认）先回写进 S14 下方的补充小样（build_states_as.s14_more），再在这里核对。
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

  it('列名：默认显示的列两个画面都有，七个金额列只在售后负责人的画面里；默认隐藏的四列写在「已隐藏 N 列」里', () => {
    const shown = ledgerColumns.filter((column) => !ledgerDefaultHidden.includes(column));
    for (const column of shown) {
      const title = COLUMNS[column];
      expectText(P13, title);
      if (ledgerFinanceColumns.has(column)) {
        expect(P13_AGENT.includes(`>${title}<`), title).toBe(false);
      } else {
        expectText(P13_AGENT, title);
      }
    }
    const hidden = ledgerDefaultHidden.map((column) => COLUMNS[column]);
    expectText(P13, COLUMN_SETTINGS.hidden(hidden, true));
    expectText(
      P13_AGENT,
      COLUMN_SETTINGS.hidden(
        ledgerDefaultHidden.filter((c) => !ledgerFinanceColumns.has(c)).map((c) => COLUMNS[c]),
        false,
      ),
    );
    expectText(P13, COLUMN_SETTINGS.show);
    expectText(P13_AGENT, COLUMN_SETTINGS.show);
  });

  it('右上：列设置、导出 Excel（两个画面都有）', () => {
    for (const page of [P13, P13_AGENT]) {
      expectIn(page, `>${COLUMN_SETTINGS.button}<`);
      expectIn(page, `>${EXPORT.button}<`);
    }
  });

  it('费用发生日的写法：同一年的结束日不写年份（原型「2026-09-01 至 09-11」），跨年写全', () => {
    expect(rangeLabel({ from: '2025-12-20', to: '2026-01-05' })).toBe('2025-12-20 至 2026-01-05');
    expectText(P13, rangeLabel({ from: '2026-09-01', to: '2026-09-11' }));
    expect(`${MISSING_FILTER.name}${FILTERS.colon}`).toBe(MISSING_FILTER.label);
  });

  it('筛选行：费用发生日（本月）、店铺（没选写「全部」）、处理方式、责任、状态、负责人', () => {
    for (const page of [P13, P13_AGENT]) {
      expectIn(page, `>${FILTERS.feeDate}${FILTERS.colon}<span`);
      expectText(page, rangeLabel({ from: '2026-09-01', to: '2026-09-11' }));
      expectIn(page, `>${FILTERS.store}${FILTERS.colon}<span`);
      expectText(page, FILTERS.all);
      for (const label of [FILTERS.method, FILTERS.responsibility, FILTERS.status, FILTERS.owner]) {
        expectIn(page, `>${label}<svg`);
      }
    }
  });

  it('合计行（12 单，费用合计 $188.79、FSH $58.85、工厂 $129.94；「其他」列隐藏时另写它的合计）与表下说明', () => {
    expectText(P13, TOTALS.label(12));
    expectText(P13, TOTALS.pinned);
    expectText(P13, TOTALS.hiddenOther(formatMoney('0.00', 'USD')));
    for (const amount of ['55.30', '72.10', '61.39', '188.79', '58.85', '129.94']) {
      expectText(P13, formatMoney(amount, 'USD'));
    }
    expect(P13_AGENT.includes(TOTALS.label(12))).toBe(false);
    expectText(P13, NOTE.finance);
    expectText(P13_AGENT, NOTE.readOnly);
  });

  it('FSH / 工厂承担的悬停：三组相同写「三组均 FSH 0 / 工厂 100」', () => {
    expectIn(
      P13,
      `title="${ratioWords(ratioPairsOf({ product: 100, freight: 100, other: 100 }))}"`,
    );
    expectIn(P13, `title="${ratioWords(ratioPairsOf({ product: 50, freight: 50, other: 50 }))}"`);
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
    expectIn(P13_AGENT, '>1Z4R28830358229041<');
    expectText(P13, EMPTY_VALUE);
  });

  it('非美元金额（S-20260911-0020）：美元值下方写原币与汇率日期，悬停说明汇率的来源（R-FL-06）', () => {
    expectText(P13, formatMoney('49.39', 'USD'));
    // 单元格里原币与汇率日期分成两段（窄列在「·」处换行），拼起来与原型逐字一致
    expectText(
      P13,
      formatMoney('889.00', 'MXN') +
        FOREIGN_AMOUNT.separator +
        FOREIGN_AMOUNT.rateDate(formatRateDate('2026-09-10')),
    );
    expectIn(P13, `title="${FOREIGN_AMOUNT.publishedTitle}"`);
  });
});

describe('S13 补充小样（用户确认 10-05）与 S11 导出', () => {
  it('S10 的 P13 写法：标题、说明写当前筛选与「清除筛选查看全部 N 张」、按钮「清除筛选」', () => {
    expectText(STATES, EMPTY_TITLE);
    expectText(
      STATES,
      EMPTY.description(
        [
          EMPTY.filter(FILTERS.feeDate, rangeLabel({ from: '2026-09-01', to: '2026-09-11' })),
          EMPTY.filter(FILTERS.store, 'forcome.mx'),
          EMPTY.filter(FILTERS.responsibility, '其他'),
        ],
        true,
        12,
      ),
    );
    expectIn(STATES, `>${FILTERS.clear}<`);
  });

  it('筛选芯片选中后写「名称：值」；下拉第一项「全部」', () => {
    expectIn(STATES, `>${FILTERS.store}${FILTERS.colon}<span`);
    expectText(STATES, 'forcome.com');
    expectIn(STATES, `>${FILTERS.responsibility}${FILTERS.colon}<span`);
    expectIn(STATES, `>${FILTERS.all}<`);
  });

  it('列设置：按表格顺序列出除售后单号外的列，底部「恢复默认」', () => {
    for (const column of ledgerColumns.filter((c) => c !== 'number')) {
      expectIn(STATES, `>${COLUMNS[column]}<`);
    }
    expectIn(STATES, `>${COLUMN_SETTINGS.reset}<`);
  });

  it('已取消的单没保留的费用项：悬停写原登记额', () => {
    expectText(STATES, NOT_KEPT(formatMoney('18.00', 'USD')));
    expectIn(STATES, `title="${NOT_KEPT(formatMoney('18.00', 'USD'))}"`);
  });

  it('三组比例不同时的承担悬停：「按费用项」与逐组的写法', () => {
    expectText(STATES, SHARE.byItem);
    for (const line of ratioGroupWords(ratioPairsOf({ product: 100, freight: 0, other: 50 }))) {
      expectText(STATES, line);
    }
  });

  it('导出：生成中「导出中」，完成浮层写文件名与单数，失败按 G5', () => {
    expectIn(STATES, `>${EXPORT.busy}<`);
    expectText(STATES, EXPORT.doneTitle);
    expectText(STATES, EXPORT.doneDescription('登记台账_20260901-20260911.xlsx', 12));
    expectText(STATES, `${EXPORT.failedAction}失败：网络不可用`);
  });
});

describe('S14 新建登记抽屉', () => {
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

  it('非美元金额框下的折算（S14 编辑登记小图：S-20260911-0020 的 MX$889.00）', () => {
    expectText(
      STATES,
      DRAWER.feeConversion(
        formatMoney('49.39', 'USD'),
        formatRateDate('2026-09-10'),
        formatRate('18.000000'),
        'MXN',
      ),
    );
  });

  it('汇率（S14 补充小样之二，PRD v2.17）：没有汇率时的说明与报错、P13 悬停说明按来源区分', () => {
    expectText(STATES, DRAWER.feeNoRate);
    expectText(STATES, FOREIGN_AMOUNT.publishedTitle);
    expectText(STATES, FOREIGN_AMOUNT.manualTitle(formatRate('17.5'), 'MXN'));
    expectText(STATES, formatMoney('50.80', 'USD'));
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

describe('S14 补充小样（第一阶段实现时确认，10-05 用户确认）', () => {
  it('物流问题的索赔对象与索赔状态、下拉占位', () => {
    expectIn(STATES, `>${DRAWER.labels.claimTarget}<`);
    expectIn(STATES, `>${DRAWER.labels.claimStatus}<`);
    expectText(STATES, DRAWER.placeholder);
  });

  it('负责人旁的灰字三种与未选店铺时的悬停说明', () => {
    expectIn(STATES, `>${DRAWER.ownerNotes.only}<`);
    expectIn(STATES, `>${DRAWER.ownerNotes.self}<`);
    expectIn(STATES, `>${DRAWER.ownerNotes.choose}<`);
    expect(DRAWER.ownerNotes.none).toBe(DRAWER.ownerNotes.choose);
    expectIn(STATES, `>${DRAWER.ownerNeedsStore}<`);
  });

  it('必填项为空与要查库的报错、数量与金额的格式', () => {
    const m = registrationMessages;
    for (const message of [
      m.methodMissing,
      m.storeMissing,
      m.siteMissing,
      m.orderNumberMissing,
      m.customerMissing,
      m.feeDateMissing,
      m.ownerMissing,
      m.responsibilityMissing,
      m.factoryMissing,
      m.ownerNotEligible,
      m.sourceTicketNotFound,
      m.sourceTicketStore('forcome.com'),
      m.quantity,
      m.amountFormat,
    ]) {
      expectIn(STATES, `${message}<`);
    }
  });

  it('保存与来源工单查询的结果浮层（G5）、新建时的未保存离开（G8）', () => {
    expectText(STATES, SAVE_RESULT.savedTitle);
    expectIn(STATES, SAVE_RESULT.savedDescription('S-20260911-0023', 'Olivia Turner'));
    // 失败浮层的标题由 notify 拼成「<动作>失败：原因」（ADR 0007）
    expectIn(STATES, `>${SAVE_RESULT.failedAction}失败：网络不可用<`);
    expectIn(STATES, SAVE_RESULT.failedDescription);
    expectIn(STATES, `>${LOOKUP.failedAction}失败：网络不可用<`);
    expectIn(STATES, LEAVE);
  });
});

describe('S13 页头完整率、「缺 N 项」与「待回填」（第一期参照页，待办 21）', () => {
  it('完整率：「9 月登记完整率 87.5% · 7 / 8 · 目标 ≥ 98% | 筛出缺字段的 1 单」，悬停说明口径；坐席照常显示', () => {
    const completion = { month: '2026-09', completed: 8, complete: 7 };
    for (const page of [P13, P13_AGENT]) {
      expectText(page, COMPLETION.label(9));
      expectText(page, completionLabel(completion) ?? '');
      expectText(page, COMPLETION.ratio(7, 8));
      expectText(page, COMPLETION.target);
      expectIn(page, `>${COMPLETION.filter(1)}<`);
      expectIn(page, `title="${COMPLETION.title}"`);
    }
  });

  it('S-20260909-0016 缺快递单号：「缺 1 项」悬停列出缺的字段，单元格「待回填」，售后负责人旁边「补登」、坐席没有', () => {
    for (const page of [P13, P13_AGENT]) {
      expectText(page, MISSING.badge(1));
      expectIn(page, `title="${MISSING.title(missingItemLabels(['trackingNumber']))}"`);
      expectText(page, MISSING.pending);
    }
    expectText(P13, MISSING.backfill);
    expect(P13_AGENT.includes(`>${MISSING.backfill}<`)).toBe(false);
  });
});

describe('S15 设为已完成、取消与补登（待办 21）', () => {
  it('行尾「更多」、设为已完成的撤销浮层（S-20260911-0018 缺寄出日期、快递单号）', () => {
    expectIn(STATES, `>${MORE.complete}</div>`);
    expectIn(STATES, `>${MORE.cancel}</div>`);
    expectText(STATES, COMPLETE_RESULT.title('S-20260911-0018'));
    expectText(
      STATES,
      COMPLETE_RESULT.missing(missingItemLabels(['shipDate', 'trackingNumber']).length),
    );
    expectText(STATES, COMPLETION.label(9));
    expectText(STATES, '77.8%');
  });

  it('取消售后单的二次确认（S-20260911-0021）', () => {
    expectText(STATES, CANCEL.title('S-20260911-0021'));
    expectIn(STATES, `>${CANCEL.description('Marcus Lee', '寄配件', '物流问题')}`);
    expectIn(STATES, `>${CANCEL.reason}<`);
    expectIn(STATES, CANCEL.reasonPlaceholder);
    expectText(STATES, CANCEL.fees);
    expectText(STATES, CANCEL.feesDefault);
    expectText(STATES, CANCEL.keptTotal('09-11'));
    for (const note of CANCEL.notes) expectIn(STATES, `>${note}<`);
    expectText(STATES, CANCEL.dismiss);
    expectText(STATES, CANCEL.confirm);
    for (const fee of ['productCost', 'freight', 'compensation', 'otherCost'] as const) {
      expectIn(STATES, `>${feeItemLabels[fee]}</div>`);
    }
  });

  it('行内补登（S-20260909-0016）：「保存」、补登浮层，补完后完整率「无缺字段的单」', () => {
    expectText(STATES, MISSING.save);
    expectText(STATES, BACKFILL_RESULT.title);
    expectIn(STATES, BACKFILL_RESULT.inline('S-20260909-0016', '1Z4R28830358229088'));
    expectText(STATES, COMPLETION.allComplete);
  });
});

describe('S15 补充小样（第一阶段实现时确认，10-05 用户确认）', () => {
  it('当月没有已完成的单：「—」与「0 / 0」，右侧不写筛出', () => {
    expectText(STATES, COMPLETION.label(10));
    expectText(STATES, COMPLETION.empty);
    expectText(STATES, COMPLETION.ratio(0, 0));
  });

  it('筛出缺字段后的筛选芯片与「清除筛选」', () => {
    expectIn(STATES, `${MISSING_FILTER.label}<span`);
    expectIn(STATES, `>${MISSING_FILTER.month(9)}</span>`);
    expectIn(STATES, `title="${MISSING_FILTER.remove}"`);
    expectText(STATES, MISSING_FILTER.clear);
  });

  it('「缺 N 项」悬停、「更多」不可用的原因、行内补登为空时「保存」禁用的原因', () => {
    expectIn(STATES, `>${MISSING.title(missingItemLabels(['shipDate', 'trackingNumber']))}<`);
    const { cancelled, ...drawn } = MORE.reasons;
    for (const reason of Object.values(drawn)) expectText(STATES, reason);
    // 已取消的单两项都写「这张单已取消」：小样没单独画，写在这一组的图注里
    expectIn(STATES, `「${cancelled}」`);
    expectText(STATES, MISSING.saveNeedsValue);
  });

  it('设为已完成不缺字段时只写标题；撤销失败、数据已被他人修改的失败浮层；取消成功与原因必填', () => {
    expectText(STATES, COMPLETE_RESULT.title('S-20260911-0020'));
    // 失败浮层的标题由 notify 拼成「<动作>失败：原因」，原因是接口的说明
    expectText(
      STATES,
      `${COMPLETE_RESULT.undoFailedAction}失败：${ledgerActionMessages.undoExpired}`,
    );
    expectText(STATES, `${COMPLETE_RESULT.failedAction}失败：数据已被他人修改`);
    expectText(STATES, STALE);
    expectText(STATES, CANCEL.doneTitle('S-20260911-0021'));
    expectText(STATES, CANCEL.doneDescription);
    expectIn(STATES, `${ledgerActionMessages.reasonMissing}<`);
  });
});

describe('S14 编辑登记与补充小样之三（待办 21，10-05 用户确认）', () => {
  it('编辑登记抽屉（S-20260911-0020）：标题、说明、顶部状态行、修改汇率、底部', () => {
    expectText(STATES, EDIT.title('S-20260911-0020'));
    expectText(STATES, EDIT.description);
    expectText(
      STATES,
      EDIT.summary('Mateo Rivas', storeSite('Forcome Direct', 'MX'), '退款或部分补偿'),
    );
    expectText(STATES, EDIT.owner('王磊'));
    expectIn(STATES, `>${EDIT.rateLink}<`);
    expectText(STATES, EDIT.rateNote);
    expectText(STATES, EDIT.footerNote);
    expectIn(STATES, `>${EDIT.save}</div>`);
  });

  it('三种形态、修改汇率点开后、汇率报错、不是售后负责人、G8 与保存结果', () => {
    expectIn(STATES, `>${EDIT.close}</div>`);
    expectText(STATES, EDIT.ratePrefix);
    expectText(STATES, rateChangeMessages.rateFormat);
    expectText(STATES, EDIT.rateDenied);
    expectIn(STATES, EDIT.leave(2));
    expectText(STATES, EDIT.savedTitle);
    expectIn(STATES, EDIT.savedDescription('S-20260911-0020', 'Mateo Rivas'));
    expectIn(STATES, BACKFILL_RESULT.drawer('S-20260911-0018', ['寄出日期', '快递单号']));
  });
});

describe('改派负责人与待分配（S15 补充小样，待办 23，协调者 2026-10-14 决定 Q5–Q9）', () => {
  it('行尾「更多」的「改派负责人」，已取消的单禁用', () => {
    expectIn(STATES, `>${MORE.reassign}</div>`);
    expectText(STATES, MORE.reasons.cancelled);
  });

  it('改派弹窗：标题、说明、现在的负责人（含待分配）、接手人、提示与选项、按钮、没人可接', () => {
    expectText(STATES, REASSIGN.title('S-20260911-0018'));
    expectText(STATES, CANCEL.description('Laura Bennett', '寄配件', '产品质量问题'));
    expectText(STATES, REASSIGN.current);
    expectText(STATES, REASSIGN.pendingOwner('李婷'));
    expectIn(STATES, `>${REASSIGN.owner}<span`);
    expectText(STATES, REASSIGN.hint);
    expectText(STATES, REASSIGN.option('赵倩'));
    expectText(STATES, REASSIGN.none);
    expectIn(STATES, reassignMessages.noCandidate);
    expectText(STATES, REASSIGN.dismiss);
    expectText(STATES, REASSIGN.confirm);
  });

  it('结果浮层与刚被别人改过', () => {
    expectText(STATES, REASSIGN.doneTitle('S-20260911-0018'));
    expectText(STATES, REASSIGN.doneDescription('王磊', '赵倩'));
    expectText(STATES, `${REASSIGN.failedAction}失败：数据已被他人修改`);
    expectText(STATES, STALE);
  });

  it('负责人筛选「待分配」与负责人列的写法', () => {
    expectIn(
      STATES,
      `${FILTERS.owner}：<span style="font-weight: 600; color: #4338ca;">${FILTERS.pendingOwner}</span>`,
    );
    expectText(STATES, OWNER_CELL.pending);
    expectText(STATES, OWNER_CELL.pendingTip('李婷'));
  });

  it('改派队列的站内通知（11.4）', () => {
    const copy = reassignQueueNotificationCopy;
    expectText(STATES, copy.title);
    expectText(STATES, copy.body('李婷', 'Forcome Auto', 1));
    expectText(STATES, copy.label);
  });
});
