import { readFileSync } from 'node:fs';
import { contactAdmins, messageSourceLabels } from '@forcome/contracts';
import { describe, expect, it } from 'vitest';
import {
  ACTOR_TAG,
  AUTO_CLOSE,
  EMPTY_VALUE,
  EVENT,
  FLOW,
  INBOUND_VIA,
  INFO,
  LETTER,
  MARK_RESULT,
  META,
  MISSING,
  ORDER,
  OUTBOUND,
  SLA,
  TIMELINE,
} from './p05-copy';

/*
 * P05 的界面文案与原型逐字一致（CLAUDE.md「文案逐字照原型」）：直接读原型生成物——第一期参照页 P05_TicketDetail（已解决）、
 * _awaiting（待回复）、_customer（等客户）、_closed（已关闭）与状态板 StatesInbox（I18 与补充小样③–⑧）。
 * 原型改了而代码没跟上、或反过来，都会失败。
 */

const read = (path: string) =>
  readFileSync(new URL(`../../../../../${path}`, import.meta.url), 'utf8');
const RESOLVED = read('design/spec/phase1/P05_TicketDetail.dc.html');
const AWAITING = read('design/spec/phase1/P05_TicketDetail_awaiting.dc.html');
const CUSTOMER = read('design/spec/phase1/P05_TicketDetail_customer.dc.html');
const CLOSED = read('design/spec/phase1/P05_TicketDetail_closed.dc.html');
const STATES_INBOX = read('design/StatesInbox.dc.html');

/** 原型里有这段界面文字，且是一个元素的完整文本 */
function expectText(html: string, text: string) {
  expect(text, '要核对的文案为空').toBeTruthy();
  expect(html.includes(`>${text}<`), `原型里没有「${text}」`).toBe(true);
}

describe('P05 第一期参照页（已解决 · Oliver Grant）', () => {
  it('元信息与全程记录的标题、分段筛选', () => {
    expectText(RESOLVED, META.customer('Oliver Grant'));
    expectText(RESOLVED, META.order('204-5566778-9900112'));
    expectText(
      RESOLVED,
      AUTO_CLOSE.plannedWithStatus('已解决', '7 天无来信', '09-17 09:00', '已解决后无来信'),
    );
    expectText(RESOLVED, TIMELINE.title);
    for (const filter of Object.values(TIMELINE.filters)) expectText(RESOLVED, filter);
  });

  it('来信卡、我方回复卡、标记后的写法与事件行', () => {
    expectText(RESOLVED, `${INBOUND_VIA.amazon} · 10:12`);
    expectText(RESOLVED, OUTBOUND.sender);
    expectText(RESOLVED, `amz-direct@forcome.com · ${OUTBOUND.viaAmazon} · 10:40`);
    expect(RESOLVED).toContain(`</svg>${LETTER.marked('李婷', '09:05')}</div>`);
    expectText(RESOLVED, ACTOR_TAG.system);
    expectText(RESOLVED, ACTOR_TAG.member);
    expectText(RESOLVED, EVENT.created('待回复'));
    expectText(RESOLVED, EVENT.replyDetected('等客户'));
    expectText(RESOLVED, EVENT.inbound('待回复'));
    expectText(RESOLVED, EVENT.markedTo('李婷', '已解决'));
    expectText(RESOLVED, '09-04 周五');
    expectText(RESOLVED, MARK_RESULT.doneResolved);
  });

  it('右栏：工单信息、订单卡、SLA 结果、状态流转', () => {
    for (const label of Object.values(INFO)) expectText(RESOLVED, label);
    for (const label of [
      ORDER.title,
      ORDER.items,
      ORDER.amount,
      ORDER.fulfillment,
      ORDER.promise,
      ORDER.shipTo,
      ORDER.carrier,
    ]) {
      expectText(RESOLVED, label);
    }
    expectText(RESOLVED, ORDER.synced('09:02'));
    expectText(RESOLVED, ORDER.updated('08-26'));
    expectText(RESOLVED, 'CA$67.99（≈ $49.99）');
    expectText(RESOLVED, 'MFN（自发货）');
    expectText(RESOLVED, SLA.title);
    expectText(RESOLVED, SLA.target.platform);
    expectText(RESOLVED, SLA.arrival('09-04 10:12'));
    expectText(RESOLVED, SLA.firstReply('28m'));
    expectText(RESOLVED, SLA.firstReply('6h 32m'));
    expectText(RESOLVED, SLA.noReply('李婷'));
    expectText(RESOLVED, SLA.results.met);
    expectText(RESOLVED, SLA.notCounted);
    expectText(RESOLVED, FLOW.title);
    expectText(RESOLVED, FLOW.rule('已解决', '7 天无来信'));
    expectText(RESOLVED, FLOW.step('系统', FLOW.events.created));
    expectText(RESOLVED, FLOW.step('系统', FLOW.events.replyDetected));
    expectText(RESOLVED, FLOW.step('系统', FLOW.events.inbound));
    expectText(RESOLVED, FLOW.step('李婷', FLOW.events.marked));
    expectText(RESOLVED, '已解决后无来信');
    expectText(RESOLVED, FLOW.planned('09-17 09:00'));
  });
});

describe('P05 补充小样：待回复、等客户、已关闭（I18 ③–⑤）', () => {
  it('待回复（Shopify 联系表单、内部目标）：来信卡右上「标记无需回复」，SLA 未到期', () => {
    expectText(AWAITING, AUTO_CLOSE.planned('14 天无新来信', '09-25 09:12', '未识别到回复'));
    expectText(AWAITING, `${INBOUND_VIA.shopify} · 09:12`);
    expect(AWAITING).toContain(`</svg>${LETTER.mark}</div>`);
    expectText(AWAITING, SLA.target.internal);
    expectText(AWAITING, SLA.remaining('22h 52m · 内部'));
    expectText(AWAITING, SLA.results.pending);
    expectText(AWAITING, FLOW.rule('待回复', '14 天无新来信'));
    expectText(AWAITING, '未识别到回复');
    expectText(AWAITING, ORDER.updated('08-09'));
    expectText(AWAITING, '$54.99');
  });

  it('等客户（Shopify）：我方回复卡不写「经亚马逊买家消息」，订单没有单号写「—」', () => {
    expectText(
      CUSTOMER,
      AUTO_CLOSE.plannedWithStatus('等客户', '7 天无来信', '09-17 10:05', '客户未回复'),
    );
    expectText(CUSTOMER, 'support@forcome.com · 10:15');
    expectText(CUSTOMER, FLOW.rule('等客户', '7 天无来信'));
    expectText(CUSTOMER, EMPTY_VALUE);
    expect(CUSTOMER).not.toContain(ORDER.fulfillment);
  });

  it('已关闭：元信息写实际关闭时刻，状态流转最后一步写关闭原因，没有「标记无需回复」', () => {
    expectText(CLOSED, AUTO_CLOSE.closed('09-09 10:30', '客户未回复'));
    expectText(CLOSED, FLOW.closedStep('系统', FLOW.events.idle7, '客户未回复'));
    expectText(CLOSED, EVENT.idle7('客户未回复'));
    expectText(CLOSED, '09-02 周三');
    expect(CLOSED).not.toContain(`>${LETTER.mark}<`);
  });
});

describe('StatesInbox I18 ② 与补充小样⑥–⑧', () => {
  it('SLA 结果的写法、生产厂与其他供应商来信、自动回复', () => {
    expectText(STATES_INBOX, SLA.remaining('5h 40m'));
    expectText(STATES_INBOX, '已超时 2h 05m');
    expectText(STATES_INBOX, SLA.results.missed);
    expectText(STATES_INBOX, SLA.firstReply('1d 3h'));
    for (const source of ['producer', 'other_supplier'] as const) {
      expectText(STATES_INBOX, SLA.fromSource(messageSourceLabels[source]));
      expectText(STATES_INBOX, LETTER.notCounted(messageSourceLabels[source]));
    }
    expectText(STATES_INBOX, `${INBOUND_VIA.email} · 09:58`);
    expectText(STATES_INBOX, OUTBOUND.autoReply);
  });

  it('其余事件行与状态流转（撤销追加一行，没有状态变化的标记只写动作）', () => {
    expectText(STATES_INBOX, EVENT.reopened('待回复'));
    expectText(STATES_INBOX, EVENT.marked('陈晨'));
    expectText(STATES_INBOX, EVENT.undone('陈晨'));
    expectText(STATES_INBOX, EVENT.undoneTo('李婷', '待回复'));
    expectText(STATES_INBOX, EVENT.idle14('未识别到回复'));
    expectText(STATES_INBOX, FLOW.step('系统', FLOW.events.reopened));
    expectText(STATES_INBOX, FLOW.step('李婷', FLOW.events.undone));
    expectText(STATES_INBOX, FLOW.closedStep('系统', FLOW.events.idle14, '未识别到回复'));
  });

  it('标记与撤销的浮层', () => {
    expectText(STATES_INBOX, MARK_RESULT.done);
    expectText(STATES_INBOX, `${MARK_RESULT.failedAction}失败：网络不可用`);
    expectText(STATES_INBOX, MARK_RESULT.stillUnmarked);
    expectText(
      STATES_INBOX,
      `${MARK_RESULT.undoFailedAction}失败：已超过撤销时限，这封来信保持无需回复`,
    );
    expectText(STATES_INBOX, MARK_RESULT.refreshed);
  });

  it('G2（其他店铺的工单）与 G3', () => {
    expectText(
      STATES_INBOX,
      MISSING.forbidden('T-20260911-0031', 'Forcome Direct', contactAdmins(['刘洋'])),
    );
    expectText(STATES_INBOX, MISSING.notFoundTitle);
    expectText(STATES_INBOX, MISSING.notFound('T-20260801-9999'));
    expectText(STATES_INBOX, MISSING.backToList);
  });
});
