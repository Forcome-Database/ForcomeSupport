import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mailboxAuditObject, mailboxConnectionNotices } from './mailbox-copy';

/*
 * 进线邮箱连接异常与恢复的站内通知、审计对象与原型逐字一致（CLAUDE.md「文案逐字照原型」）：Gmail 读状态板 GlobalStates（G10 的示例通知）
 * 与 P27 第一期参照页；163 企业邮箱读状态板 StatesAdmin（K20 补充小样的通知与 P27 写法，待办 34）。原型改了写法而代码没跟上、
 * 或反过来，都会失败。
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const GLOBAL_STATES = read('../../../../../design/GlobalStates.dc.html');
const STATES_ADMIN = read('../../../../../design/StatesAdmin.dc.html');
const AUDIT_LOG = read('../../../../../design/spec/phase1/P27_AuditLog.dc.html');

function expectText(html: string, text: string) {
  expect(text, '要核对的文案为空').toBeTruthy();
  expect(html.includes(`>${text}<`), `原型里没有「${text}」`).toBe(true);
}

describe('Gmail 连接异常与恢复（G10、11.4）', () => {
  const notices = mailboxConnectionNotices('gmail');

  it('连接异常：标题与说明（原型的示例邮箱 support@forcome.mx）', () => {
    expectText(GLOBAL_STATES, notices.disconnected.title);
    expectText(GLOBAL_STATES, notices.disconnected.body('support@forcome.mx'));
  });

  it('恢复：标题与说明（补拉 3 封来信）', () => {
    expectText(GLOBAL_STATES, notices.recovered.title);
    expectText(GLOBAL_STATES, notices.recovered.body('support@forcome.mx', 3));
  });

  it('对象：P18 · Gmail', () => {
    expectText(GLOBAL_STATES, notices.object.label);
  });

  it('审计对象：Gmail · 邮箱（P27 的渠道记录）', () => {
    expectText(AUDIT_LOG, mailboxAuditObject('gmail', 'support@forcome.mx').objectLabel);
  });
});

describe('163 企业邮箱连接异常与恢复（K20 补充小样、11.4，D-28）', () => {
  const notices = mailboxConnectionNotices('qiye163');

  it('连接异常与恢复的标题、说明（原型的示例邮箱 amz-auto@forcome.com，补拉 2 封来信）', () => {
    expectText(STATES_ADMIN, notices.disconnected.title);
    expectText(STATES_ADMIN, notices.disconnected.body('amz-auto@forcome.com'));
    expectText(STATES_ADMIN, notices.recovered.title);
    expectText(STATES_ADMIN, notices.recovered.body('amz-auto@forcome.com', 2));
  });

  it('对象：P18 · 163 企业邮箱', () => {
    expectText(STATES_ADMIN, notices.object.label);
  });

  it('审计对象：163 企业邮箱 · 邮箱（P27 写法，原型写在「对象 · 动作」一行里）', () => {
    const label = mailboxAuditObject('qiye163', 'amz-auto@forcome.com').objectLabel;
    expect(STATES_ADMIN.includes(`>${label} · 恢复连接<`), `原型里没有「${label}」`).toBe(true);
  });
});
