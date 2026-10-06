import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_COPY as copy } from './notification-copy';

/*
 * 站内通知面板的界面文案与原型 G10 逐字一致（CLAUDE.md「文案逐字照原型」）：直接读状态板 GlobalStates 的生成物。
 * 原型改了文案而代码没跟上、或反过来，都会失败。原型由 design/spec 下的脚本生成（README「修改与重建」）。
 */

const GLOBAL_STATES = readFileSync(
  new URL('../../../../design/GlobalStates.dc.html', import.meta.url),
  'utf8',
);

function expectIn(text: string) {
  expect(text, '要核对的文案为空').toBeTruthy();
  expect(GLOBAL_STATES.includes(text), `原型里没有「${text}」`).toBe(true);
}

describe('G10 站内通知面板', () => {
  it('标题、「全部已读」、页签与底部说明', () => {
    expectIn(`>${copy.title}<`);
    expectIn(`>${copy.markAll}<`);
    expectIn(`>${copy.tabs.all}<`);
    expectIn(`>${copy.tabs.unread}<`);
    expectIn(`>${copy.footer}<`);
  });

  it('没有通知时的空状态（第一阶段的说明）与置灰「全部已读」的悬停说明（G10 ②）', () => {
    expectIn(`>${copy.empty.title}<`);
    expectIn(`>${copy.markAllDisabled}<`);
    expectIn(`>${copy.empty.description}<`);
  });
});
