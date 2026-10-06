import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WORK_NOTIFICATION_COPY as copy } from './work-notification-copy';

/*
 * 钉钉工作通知的固定写法与 PRD 11.4「钉钉工作通知」（v2.23）逐字一致：原型没有画钉钉里的消息，直接读 PRD。
 * PRD 改了写法而代码没跟上、或反过来，都会失败。
 */

const PRD_D = readFileSync(new URL('../../../../../design/spec/prd_d.md', import.meta.url), 'utf8');

function expectInPrd(text: string) {
  expect(text, '要核对的文案为空').toBeTruthy();
  expect(PRD_D.includes(`「${text}」`), `PRD 里没有「${text}」`).toBe(true);
}

describe('钉钉工作通知（PRD 11.4）', () => {
  it('一条时的第一行、几条合成一条时的第一行、超出长度上限时的末行', () => {
    expectInPrd(`${copy.brand}标题`);
    expectInPrd(`${copy.brand}${copy.merged('N')}`);
    expectInPrd(copy.more('M'));
  });
});
