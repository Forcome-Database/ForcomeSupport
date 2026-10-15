import { readFileSync } from 'node:fs';
import {
  connectionStatuses,
  connectionStatusLabels,
  imapServerErrors,
  mailboxError,
  mailboxTestFailureMessage,
  mailboxTestFailureReasons,
  mailboxTestMessages,
  mailProviderLabels,
  qiyeMailboxMessages,
  QIYE_GUIDE,
  QIYE_IMAP_DEFAULTS,
  platformLabels,
  platformTerms,
  storeInputErrors,
  storeSaveMessages,
  type Platform,
} from '@forcome/contracts';
import { describe, expect, it } from 'vitest';
import { pages } from '@/lib/pages';
import {
  AMAZON_ISSUE_LINES,
  CARD_LINES,
  CHANNEL_CARDS,
  CHANNEL_SECTION,
  CONNECTION_TEST,
  DINGTALK_ISSUE_LINES,
  DRAWER,
  GMAIL_ISSUE_LINES,
  EMPTY_STORES,
  SHOPIFY_ISSUE_LINES,
  LAST_SYNC,
  LEAVE,
  MAILBOX_ROWS,
  MENU_NOTE,
  MENU_TITLE,
  NOT_AUTHORIZED,
  ORDER_BACKFILL_LINE,
  ORDER_QUEUE_LINE,
  PAGE_DESCRIPTION,
  PAGE_TITLE,
  PHASE2_CARD,
  QIYE_ISSUE_LINES,
  RULE_CARD_STATE,
  RULE_ROUTE,
  SAVE_RESULT,
  SIMULATED,
  STORE_SECTION,
  STORE_TABLE,
} from './p18-copy';
import { emptyStoreForm } from './store-form';

/*
 * P18 的界面文案与原型逐字一致（CLAUDE.md「文案逐字照原型」，ADR 0007 修订）：直接读原型生成物——第一期参照页
 * P18_Settings、状态板 StatesAdmin（K8 及其补充小样、K20）、全局状态 GlobalStates（G8）。原型改了文案而代码没跟上、
 * 或反过来，都会失败。原型由 design/spec 下的脚本生成（README「修改与重建」），改原型后要重新生成再跑这里。
 * 示例数据：4 个店铺（亚马逊、Shopify 各 2 个，各一个进线邮箱），渠道卡的「最近同步 10:12」。
 */

const read = (path: string) =>
  readFileSync(new URL(`../../../../../${path}`, import.meta.url), 'utf8');
const P18 = read('design/spec/phase1/P18_Settings.dc.html');
const STATES_ADMIN = read('design/StatesAdmin.dc.html');
const GLOBAL_STATES = read('design/GlobalStates.dc.html');

/** 原型里有这段文字；先确认要核对的文字不是空的（空串处处都「包含」，会让核对空过） */
function expectIn(html: string, text: string | null | undefined) {
  expect(text, '要核对的文案为空').toBeTruthy();
  expect(html.includes(text ?? ''), `原型里没有「${text}」`).toBe(true);
}

/** 原型里有这段界面文字，且是一个元素的完整文本（不是更长一句话的一部分） */
function expectText(html: string, text: string) {
  expectIn(html, `>${text}<`);
}

describe('expectIn 本身', () => {
  it('要核对的文案为空时失败，不会空过', () => {
    expect(() => expectIn(P18, '')).toThrow(/要核对的文案为空/);
    expect(() => expectIn(P18, null)).toThrow(/要核对的文案为空/);
    expect(() => expectIn(P18, '原型里不会有这句话')).toThrow(/原型里没有/);
  });
});

describe('P18 第一期参照页', () => {
  it('页头、设置菜单、两个区块的小标题与 ⓘ 短标题、「新增店铺」逐字一致', () => {
    expectText(P18, PAGE_TITLE);
    expectIn(P18, PAGE_DESCRIPTION);
    expectText(P18, MENU_TITLE);
    expectText(P18, pages.settingsChannels.label);
    expectText(P18, pages.settingsTeam.label);
    expectIn(P18, MENU_NOTE);
    expectText(P18, CHANNEL_SECTION.label);
    expectText(P18, CHANNEL_SECTION.ruleLabel);
    expectText(P18, STORE_SECTION.label);
    expectText(P18, STORE_SECTION.count(4));
    expectText(P18, STORE_SECTION.ruleLabel);
    expectIn(P18, STORE_SECTION.create);
  });

  it('ⓘ 的全文：「卡片状态按店铺计算」与第一阶段的「进线识别」（10-05 确认，与 D-26 一致）', () => {
    expectIn(P18, `title="${RULE_CARD_STATE}"`);
    expectIn(P18, `title="${RULE_ROUTE}"`);
  });

  it('渠道卡：卡名、按示例数据写的说明行（Gmail 3 个、163 企业邮箱 1 个邮箱，D-28）、最近同步、已连接', () => {
    for (const card of Object.values(CHANNEL_CARDS)) expectText(P18, card.name);
    expectIn(P18, CHANNEL_CARDS.amazon.stores(2));
    expectIn(P18, CHANNEL_CARDS.shopify.stores(2));
    expectText(P18, CHANNEL_CARDS.gmail.mailboxes(1, 2));
    expectText(P18, CHANNEL_CARDS.qiye163.mailboxes(1, 0));
    expectText(P18, CARD_LINES.mailSent);
    expectIn(P18, LAST_SYNC('10:12'));
    expectIn(P18, LAST_SYNC('10:17'));
    expectIn(P18, connectionStatusLabels.connected);
  });

  it('积加与易仓合成一张「第二阶段接入」卡（v2.37，仍是 3 × 2），说明为原来两句连写', () => {
    for (const text of [PHASE2_CARD.name, PHASE2_CARD.subtitle, PHASE2_CARD.badge]) {
      expectText(P18, text);
    }
    expectText(P18, PHASE2_CARD.description);
    expect(P18.split(`>${PHASE2_CARD.badge}<`)).toHaveLength(2);
  });

  it('店铺表：表头、渠道标识、默认站点悬停、站点分隔、邮箱与平台标识的小字、状态列连接名、行尾「编辑」', () => {
    for (const column of Object.values(STORE_TABLE.columns)) expectText(P18, column);
    for (const platform of ['amazon', 'shopify'] satisfies Platform[]) {
      expectText(P18, platformLabels[platform]);
      expectIn(P18, platformTerms[platform].platformId);
    }
    // 进线邮箱下一行写用途与服务商；状态列连接名按服务商（D-28）
    expectText(
      P18,
      STORE_TABLE.mailboxUsage(platformTerms.amazon.mailbox, mailProviderLabels.gmail),
    );
    expectText(
      P18,
      STORE_TABLE.mailboxUsage(platformTerms.amazon.mailbox, mailProviderLabels.qiye163),
    );
    expectText(
      P18,
      STORE_TABLE.mailboxUsage(platformTerms.shopify.mailbox, mailProviderLabels.gmail),
    );
    for (const [provider, platform] of [
      ['gmail', 'amazon'],
      ['qiye163', 'amazon'],
      ['gmail', 'shopify'],
    ] as const) {
      expectText(
        P18,
        [mailProviderLabels[provider], platformTerms[platform].ordersApi].join(
          STORE_TABLE.separator,
        ),
      );
    }
    expectIn(P18, `title="${STORE_TABLE.defaultSiteTitle('US')}"`);
    expectIn(P18, `</span>${STORE_TABLE.separator}<span`);
    expectText(P18, STORE_TABLE.edit);
  });
});

describe('K8 新增店铺抽屉与补充小样', () => {
  it('抽屉的标题、说明、字段名、提示、占位、数据来源与底部按钮逐字一致', () => {
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
    expectText(STATES_ADMIN, DRAWER.placeholder);
    expectText(STATES_ADMIN, DRAWER.cancel);
    expectText(STATES_ADMIN, DRAWER.save);
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

  it('表单校验与接口的报错逐字一致：必填项、邮箱格式与重复、店铺名重复、邮箱被占用', () => {
    const empty = storeInputErrors({
      name: '',
      platform: null,
      sites: [],
      defaultSite: null,
      mailboxes: [],
      platformId: '',
    });
    expect(Object.keys(empty)).toHaveLength(6);
    for (const message of Object.values(empty)) expectIn(STATES_ADMIN, message);
    expectIn(STATES_ADMIN, mailboxError('info@forcome', []));
    expectIn(STATES_ADMIN, mailboxError('ventas@forcome.mx', ['ventas@forcome.mx']));
    expectIn(STATES_ADMIN, storeSaveMessages.duplicateName);
    expectIn(STATES_ADMIN, storeSaveMessages.mailboxTaken('support@forcome.mx', 'forcome.mx'));
  });

  it('保存结果浮层、店铺表为空与新增时的未保存离开逐字一致', () => {
    expectIn(STATES_ADMIN, SAVE_RESULT.savedTitle);
    expectIn(STATES_ADMIN, SAVE_RESULT.savedDescription('forcome.mx', '刘洋', '10:24'));
    expectIn(STATES_ADMIN, `${SAVE_RESULT.failedAction}失败：`);
    expectIn(STATES_ADMIN, SAVE_RESULT.failedDescription);
    expectIn(STATES_ADMIN, EMPTY_STORES.title);
    expectIn(STATES_ADMIN, EMPTY_STORES.description);
    expectIn(STATES_ADMIN, LEAVE.create);
  });
});

describe('K8 补充小样：进线邮箱逐行登记与 163 企业邮箱的行（D-28，待办 34）', () => {
  it('每行地址 + 服务商，末尾「添加进线邮箱」；163 企业邮箱的行：授权码、提示、已保存与重新填写、IMAP 服务器与端口的默认值', () => {
    expectText(STATES_ADMIN, MAILBOX_ROWS.providers.gmail);
    expectText(STATES_ADMIN, MAILBOX_ROWS.providers.qiye163);
    expectIn(STATES_ADMIN, `>${MAILBOX_ROWS.add}<`);
    for (const text of [
      MAILBOX_ROWS.authCode,
      MAILBOX_ROWS.authCodePlaceholder,
      MAILBOX_ROWS.authCodeHint,
      MAILBOX_ROWS.saved,
      MAILBOX_ROWS.refill,
      MAILBOX_ROWS.imapHost,
      QIYE_IMAP_DEFAULTS.host,
      String(QIYE_IMAP_DEFAULTS.port),
      MAILBOX_ROWS.testingNote,
      MAILBOX_ROWS.testIdle,
    ]) {
      expectIn(STATES_ADMIN, `>${text}<`);
    }
    expectIn(STATES_ADMIN, `>${MAILBOX_ROWS.imapPort}<span`);
    expectIn(STATES_ADMIN, `</svg>${MAILBOX_ROWS.testing}<`);
    expectIn(STATES_ADMIN, `>${MAILBOX_ROWS.test}<`);
  });

  it('授权码必填的报错照原型；服务器为空与端口不对原型没画，按 PRD P18「校验」写', () => {
    expectText(STATES_ADMIN, qiyeMailboxMessages.authCodeMissing);
    expect(imapServerErrors({ imapHost: '', imapPort: '0' })).toEqual({
      imapHost: qiyeMailboxMessages.imapHostMissing,
      imapPort: qiyeMailboxMessages.imapPortInvalid,
    });
  });

  it('按行测试连接的五种行内结果逐字一致（连不上与超时同一种写法）', () => {
    expectText(STATES_ADMIN, mailboxTestMessages.ok);
    for (const reason of mailboxTestFailureReasons) {
      expectText(STATES_ADMIN, mailboxTestFailureMessage(reason, 'imap.qiye.163.com', 993));
    }
  });
});

describe('K20 第一阶段渠道卡与 G8', () => {
  it('四种连接状态、模拟数据标签、未连接的副标题、钉钉卡第一阶段已连接的说明行逐字一致', () => {
    for (const status of connectionStatuses) {
      expectText(STATES_ADMIN, connectionStatusLabels[status]);
    }
    expectText(STATES_ADMIN, SIMULATED);
    expectIn(STATES_ADMIN, NOT_AUTHORIZED);
    for (const line of CARD_LINES.dingtalk) expectIn(STATES_ADMIN, line);
  });

  it('编辑时的未保存离开照 G8 的写法（「有 N 项未保存的修改。放弃后恢复为上次保存的值。」）', () => {
    expectIn(GLOBAL_STATES, LEAVE.edit(3).replace('「编辑店铺」', '「规则与阈值」'));
  });
});

describe('K20 补充小样：卡片的异常写法与「测试连接」（待办 09）', () => {
  it('Gmail 卡同步延迟与连接异常：每个邮箱一行、来信暂存、「重新检测」（Q2、Q3 用户确认）', () => {
    expectText(STATES_ADMIN, GMAIL_ISSUE_LINES.delayed('support@forcome.mx', '10:05'));
    expectText(STATES_ADMIN, GMAIL_ISSUE_LINES.failed('support@forcome.mx', '10:05', 3));
    expectText(STATES_ADMIN, GMAIL_ISSUE_LINES.held);
    expectText(STATES_ADMIN, GMAIL_ISSUE_LINES.recheck);
    // 几个邮箱同时异常、另有一个延迟（E2、E3 协调者决定）：次数为实际的连续失败次数
    expectText(STATES_ADMIN, GMAIL_ISSUE_LINES.failed('amz-direct@forcome.com', '10:12', 3));
    expectText(STATES_ADMIN, GMAIL_ISSUE_LINES.failed('support@forcome.mx', '10:05', 5));
    expectText(STATES_ADMIN, GMAIL_ISSUE_LINES.delayed('support@forcome.com', '10:06'));
  });

  it('钉钉卡同步延迟与连接异常（Q6 用户确认；从没同步成功过为 E4 协调者决定）', () => {
    expectText(STATES_ADMIN, DINGTALK_ISSUE_LINES.delayed('08:00'));
    expectText(STATES_ADMIN, DINGTALK_ISSUE_LINES.failed('08:00'));
    expectText(STATES_ADMIN, DINGTALK_ISSUE_LINES.failed(null));
    expectText(STATES_ADMIN, DINGTALK_ISSUE_LINES.note);
    expectText(STATES_ADMIN, DINGTALK_ISSUE_LINES.tail);
  });

  it('「测试连接」按钮与结果浮层（Q4 用户确认）', () => {
    expectText(P18, CONNECTION_TEST.button);
    expectText(STATES_ADMIN, CONNECTION_TEST.okTitle);
    expectText(STATES_ADMIN, CONNECTION_TEST.ok.gmail(3));
    expectText(STATES_ADMIN, CONNECTION_TEST.ok.dingtalk);
    expectText(STATES_ADMIN, `${CONNECTION_TEST.failedAction}失败：support@forcome.mx 无法访问`);
    expectText(STATES_ADMIN, `${CONNECTION_TEST.failedAction}失败：钉钉通讯录无法访问`);
    expectText(STATES_ADMIN, CONNECTION_TEST.failedDescription.gmail);
    expectText(STATES_ADMIN, CONNECTION_TEST.failedDescription.dingtalk);
  });
});

describe('K20 补充小样：163 企业邮箱卡（D-28，待办 34，写法同 Gmail 卡、恢复指引按服务商）', () => {
  it('同步延迟与连接异常：每个邮箱一行、来信暂存、「重新检测」', () => {
    expectText(STATES_ADMIN, QIYE_ISSUE_LINES.delayed('amz-auto@forcome.com', '10:05'));
    expectText(STATES_ADMIN, QIYE_ISSUE_LINES.failed('amz-auto@forcome.com', '10:05', 3));
    expectText(STATES_ADMIN, QIYE_ISSUE_LINES.held);
    expectText(STATES_ADMIN, CHANNEL_CARDS.qiye163.mailboxes(1, 0));
    expectText(STATES_ADMIN, CARD_LINES.mailSent);
  });

  it('「测试连接」的结果浮层', () => {
    expectText(STATES_ADMIN, CONNECTION_TEST.ok.qiye163(1));
    expectText(STATES_ADMIN, `${CONNECTION_TEST.failedAction}失败：amz-auto@forcome.com 无法访问`);
    expectText(STATES_ADMIN, CONNECTION_TEST.failedDescription.qiye163);
    expect(CONNECTION_TEST.failedDescription.qiye163).toBe(QIYE_GUIDE);
  });
});

describe('K20 补充小样：Shopify 卡（待办 11，协调者 2026-10-06 决定，套用 Gmail 的写法、按店铺）', () => {
  it('同步延迟与连接异常：每个店铺一行、订单暂停同步、「重新检测」', () => {
    expectText(STATES_ADMIN, SHOPIFY_ISSUE_LINES.delayed('forcome.mx', '10:05'));
    expectText(STATES_ADMIN, SHOPIFY_ISSUE_LINES.failed('forcome.mx', '10:05', 3));
    expectText(STATES_ADMIN, SHOPIFY_ISSUE_LINES.held);
    expectText(STATES_ADMIN, CHANNEL_CARDS.shopify.stores(2));
  });

  it('「测试连接」的结果浮层', () => {
    expectText(STATES_ADMIN, CONNECTION_TEST.ok.shopify(2));
    expectText(STATES_ADMIN, `${CONNECTION_TEST.failedAction}失败：forcome.mx 无法访问`);
    expectText(STATES_ADMIN, CONNECTION_TEST.failedDescription.shopify);
  });
});

describe('K20 补充小样：亚马逊卡（待办 12，协调者 2026-10-06 决定 Q1、Q2、Q6、Q7，套用 Shopify 的写法、按店铺）', () => {
  it('同步延迟与连接异常：每个店铺一行、订单暂停同步、「重新检测」', () => {
    expectText(STATES_ADMIN, AMAZON_ISSUE_LINES.delayed('Forcome Auto', '10:05'));
    expectText(STATES_ADMIN, AMAZON_ISSUE_LINES.failed('Forcome Auto', '10:05', 3));
    expectText(STATES_ADMIN, AMAZON_ISSUE_LINES.held);
    expectText(STATES_ADMIN, CHANNEL_CARDS.amazon.stores(2));
  });

  it('订单通知队列（SQS）一行的四种写法（第一期参照页为「正常 · 积压 0」）', () => {
    expectText(P18, ORDER_QUEUE_LINE.label);
    expectIn(P18, `>${ORDER_QUEUE_LINE.normal(0)}<`);
    expectIn(STATES_ADMIN, ORDER_QUEUE_LINE.backlog(12));
    expectIn(STATES_ADMIN, `>${ORDER_QUEUE_LINE.failed}<`);
    expectIn(STATES_ADMIN, `>${ORDER_QUEUE_LINE.notConnected}<`);
  });

  it('订单回补行的四种写法（第一期参照页为亚马逊「90 天 · 已完成」、Shopify「60 天 · 未开通 read_all_orders」，待办 13）', () => {
    expectText(P18, ORDER_BACKFILL_LINE.label(90));
    expectText(P18, ORDER_BACKFILL_LINE.label(60));
    expectIn(P18, `${ORDER_BACKFILL_LINE.completed}<`);
    expectIn(P18, `>${ORDER_BACKFILL_LINE.historyLimited}<`);
    expectIn(STATES_ADMIN, `>${ORDER_BACKFILL_LINE.notStarted}<`);
    expectIn(STATES_ADMIN, `>${ORDER_BACKFILL_LINE.running(1284)}<`);
  });

  it('「测试连接」的结果浮层（店铺与订单通知队列）', () => {
    expectText(STATES_ADMIN, CONNECTION_TEST.ok.amazon(2));
    expectText(STATES_ADMIN, `${CONNECTION_TEST.failedAction}失败：Forcome Auto 无法访问`);
    expectText(STATES_ADMIN, CONNECTION_TEST.failedDescription.amazon);
    expectText(STATES_ADMIN, `${CONNECTION_TEST.failedAction}失败：订单通知队列（SQS） 无法访问`);
    expectText(STATES_ADMIN, CONNECTION_TEST.failedDescription.amazonQueue);
  });
});
