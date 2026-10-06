import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GMAIL_CONNECTION_NOTICES, gmailAuditObject } from './gmail-copy';

/*
 * Gmail 连接异常与恢复的站内通知、审计对象与原型逐字一致（CLAUDE.md「文案逐字照原型」）：通知读状态板 GlobalStates（G10 的示例通知），
 * 审计对象读 P27 第一期参照页。原型改了写法而代码没跟上、或反过来，都会失败。
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const GLOBAL_STATES = read('../../../../../design/GlobalStates.dc.html');
const AUDIT_LOG = read('../../../../../design/spec/phase1/P27_AuditLog.dc.html');

function expectText(html: string, text: string) {
  expect(text, '要核对的文案为空').toBeTruthy();
  expect(html.includes(`>${text}<`), `原型里没有「${text}」`).toBe(true);
}

describe('Gmail 连接异常与恢复（G10、11.4）', () => {
  it('连接异常：标题与说明（原型的示例邮箱 support@forcome.mx）', () => {
    expectText(GLOBAL_STATES, GMAIL_CONNECTION_NOTICES.disconnected.title);
    expectText(GLOBAL_STATES, GMAIL_CONNECTION_NOTICES.disconnected.body('support@forcome.mx'));
  });

  it('恢复：标题与说明（补拉 3 封来信）', () => {
    expectText(GLOBAL_STATES, GMAIL_CONNECTION_NOTICES.recovered.title);
    expectText(GLOBAL_STATES, GMAIL_CONNECTION_NOTICES.recovered.body('support@forcome.mx', 3));
  });

  it('对象：P18 · Gmail', () => {
    expectText(GLOBAL_STATES, GMAIL_CONNECTION_NOTICES.object.label);
  });

  it('审计对象：Gmail · 邮箱（P27 的渠道记录）', () => {
    expectText(AUDIT_LOG, gmailAuditObject('support@forcome.mx').objectLabel);
  });
});
