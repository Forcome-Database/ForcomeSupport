import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DINGTALK_SYNC_FAILED } from './dingtalk-copy';

/*
 * 钉钉同步失败的两条站内提醒与原型 G10 ④ 逐字一致（CLAUDE.md「文案逐字照原型」）：直接读状态板 GlobalStates 的生成物。
 * 原型改了写法而代码没跟上、或反过来，都会失败。
 */

const GLOBAL_STATES = readFileSync(
  new URL('../../../../../design/GlobalStates.dc.html', import.meta.url),
  'utf8',
);

/** 原型里有这段文字，且是一个元素的完整文本 */
function expectText(text: string) {
  expect(text, '要核对的文案为空').toBeTruthy();
  expect(GLOBAL_STATES.includes(`>${text}<`), `原型里没有「${text}」`).toBe(true);
}

describe('G10 ④ 钉钉同步失败只提醒管理员', () => {
  it('连续失败的第 1 次与第 3 次：标题与说明', () => {
    for (const notice of [DINGTALK_SYNC_FAILED.first, DINGTALK_SYNC_FAILED.disconnected]) {
      expectText(notice.title);
      expectText(notice.body);
    }
  });

  it('对象：P18 钉钉卡', () => {
    expectText(DINGTALK_SYNC_FAILED.object.label);
  });
});
