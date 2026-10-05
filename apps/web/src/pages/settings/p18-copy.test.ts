import { readFileSync } from 'node:fs';
import {
  mailboxError,
  platformTerms,
  storeInputErrors,
  storeSaveMessages,
  type Platform,
} from '@forcome/contracts';
import { describe, expect, it } from 'vitest';
import {
  CARD_LINES,
  DRAWER,
  EMPTY_STORES,
  LEAVE,
  MENU_NOTE,
  NOT_AUTHORIZED,
  PAGE_DESCRIPTION,
  PHASE2_CARDS,
  RULE_CARD_STATE,
  RULE_ROUTE,
  SAVE_RESULT,
} from './p18-copy';
import { emptyStoreForm } from './store-form';

/*
 * P18 的界面文案与原型逐字一致（CLAUDE.md「文案逐字照原型」）：直接读原型生成物——第一期参照页 P18_Settings、
 * 状态板 StatesAdmin（K8 及其补充小样、K20）、全局状态 GlobalStates（G8）。原型改了文案而代码没跟上、或反过来，都会失败。
 * 原型由 design/spec 下的脚本生成（README「修改与重建」），改原型后要重新生成再跑这里。
 */

const read = (path: string) =>
  readFileSync(new URL(`../../../../../${path}`, import.meta.url), 'utf8');
const P18 = read('design/spec/phase1/P18_Settings.dc.html');
const STATES_ADMIN = read('design/StatesAdmin.dc.html');
const GLOBAL_STATES = read('design/GlobalStates.dc.html');

function expectIn(html: string, text: string) {
  expect(html.includes(text), `原型里没有「${text}」`).toBe(true);
}

describe('P18 第一期参照页', () => {
  it('页头说明、设置菜单底注、渠道卡与店铺表的说明逐字一致', () => {
    expectIn(P18, PAGE_DESCRIPTION);
    expectIn(P18, MENU_NOTE);
    expectIn(P18, CARD_LINES.gmailSent);
    for (const text of [
      PHASE2_CARDS.badge,
      PHASE2_CARDS.subtitle,
      PHASE2_CARDS.jijia.name,
      PHASE2_CARDS.jijia.description,
      PHASE2_CARDS.yicang.name,
      PHASE2_CARDS.yicang.description,
    ]) {
      expectIn(P18, text);
    }
    for (const platform of ['amazon', 'shopify'] satisfies Platform[]) {
      expectIn(P18, platformTerms[platform].mailbox);
      expectIn(P18, platformTerms[platform].platformId);
    }
  });

  it('ⓘ 的全文：「卡片状态按店铺计算」与第一阶段的「进线识别」（10-05 确认，与 D-26 一致）', () => {
    expectIn(P18, `title="${RULE_CARD_STATE}"`);
    expectIn(P18, `title="${RULE_ROUTE}"`);
  });
});

describe('K8 新增店铺抽屉与补充小样', () => {
  it('抽屉的标题、说明、字段名、提示与数据来源逐字一致', () => {
    for (const text of [
      DRAWER.createTitle,
      DRAWER.editTitle,
      DRAWER.description,
      DRAWER.defaultSiteHint,
      DRAWER.mailboxHint,
      DRAWER.dataSourceBadge,
      DRAWER.dataSourceOptions.real,
      DRAWER.dataSourceOptions.fake,
      DRAWER.dataSourceNote,
      ...Object.values(DRAWER.labels),
    ]) {
      expectIn(STATES_ADMIN, text);
    }
  });

  it('非生产环境新建店铺的数据来源默认「模拟数据」（原型 K8 选中模拟数据）', () => {
    expectIn(
      STATES_ADMIN,
      `border: 5px solid #4f46e5; flex-shrink: 0;"></div>${DRAWER.dataSourceOptions.fake}`,
    );
    expect(emptyStoreForm().adapterMode).toBe('fake');
  });

  it('两种平台的平台标识字段名、占位与为空时的报错逐字一致', () => {
    for (const platform of ['amazon', 'shopify'] satisfies Platform[]) {
      const terms = platformTerms[platform];
      expectIn(STATES_ADMIN, terms.platformIdField);
      expectIn(STATES_ADMIN, terms.platformIdPlaceholder);
      expectIn(STATES_ADMIN, terms.platformIdMissing);
    }
  });

  it('表单校验与接口的报错逐字一致：必填项、邮箱格式与重复、店铺名重复', () => {
    const empty = storeInputErrors({
      name: '',
      platform: null,
      sites: [],
      defaultSite: null,
      mailboxes: [],
      platformId: '',
    });
    for (const message of Object.values(empty)) expectIn(STATES_ADMIN, message);
    expectIn(STATES_ADMIN, mailboxError('info@forcome', []) ?? '');
    expectIn(STATES_ADMIN, mailboxError('ventas@forcome.mx', ['ventas@forcome.mx']) ?? '');
    expectIn(STATES_ADMIN, storeSaveMessages.duplicateName);
    expectIn(STATES_ADMIN, storeSaveMessages.mailboxTaken('support@forcome.mx', 'forcome.mx'));
  });

  it('保存结果浮层、店铺表为空与新增时的未保存离开逐字一致', () => {
    expectIn(STATES_ADMIN, SAVE_RESULT.savedTitle);
    expectIn(STATES_ADMIN, SAVE_RESULT.savedDescription('forcome.mx', '刘洋', '10:24'));
    expectIn(STATES_ADMIN, SAVE_RESULT.failedDescription);
    expectIn(STATES_ADMIN, EMPTY_STORES.title);
    expectIn(STATES_ADMIN, EMPTY_STORES.description);
    expectIn(STATES_ADMIN, LEAVE.create);
  });
});

describe('K20 第一阶段渠道卡与 G8', () => {
  it('钉钉卡第一阶段已连接的说明行、未连接的副标题逐字一致', () => {
    for (const line of CARD_LINES.dingtalk) expectIn(STATES_ADMIN, line);
    expectIn(STATES_ADMIN, NOT_AUTHORIZED);
  });

  it('编辑时的未保存离开照 G8 的写法（「有 N 项未保存的修改。放弃后恢复为上次保存的值。」）', () => {
    expectIn(GLOBAL_STATES, LEAVE.edit(3).replace('「编辑店铺」', '「规则与阈值」'));
  });
});
