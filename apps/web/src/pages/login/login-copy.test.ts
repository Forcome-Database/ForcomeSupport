import { readFileSync } from 'node:fs';
import { loginDenialMessage, loginDenialTitles } from '@forcome/contracts';
import { describe, expect, it } from 'vitest';
import { BACK_TO_LOGIN, LOGIN, QR_EXPIRED, SESSION_EXPIRED } from './login-copy';

/*
 * 登录页（G11）与登录被拒（G12）的界面文案与原型逐字一致（CLAUDE.md「文案逐字照原型」）：直接读原型生成物 GlobalStates。
 * 原型改了文案而代码没跟上、或反过来，都会失败。被拒三种原因的标题与说明在 contracts（后端给出），一并核对。
 */

const GLOBAL_STATES = readFileSync(
  new URL('../../../../../design/GlobalStates.dc.html', import.meta.url),
  'utf8',
);

/** 原型里有这段界面文字，且是一个元素的完整文本（不是更长一句话的一部分） */
function expectText(text: string) {
  expect(text, '要核对的文案为空').toBeTruthy();
  expect(GLOBAL_STATES.includes(`>${text}<`), `原型里没有「${text}」`).toBe(true);
}

describe('G11 登录', () => {
  it('卡片标题、副标题、二维码有效期与底部说明', () => {
    expectText(LOGIN.title);
    expectText(LOGIN.subtitle);
    expectText(LOGIN.validity);
    expectText(LOGIN.note);
  });

  it('二维码过期后的蒙层：「二维码已过期」与「刷新」', () => {
    expectText(QR_EXPIRED.title);
    expectText(QR_EXPIRED.refresh);
  });
});

describe('G12 登录被拒', () => {
  it('会话过期：标题、说明与「重新扫码登录」', () => {
    expectText(SESSION_EXPIRED.title);
    expectText(SESSION_EXPIRED.description);
    expectText(SESSION_EXPIRED.action);
  });

  it('未分配角色、账号已停用：标题、说明（管理员按在职管理员写）与「返回登录页」；生产厂对接人那一种', () => {
    for (const reason of ['no_role', 'disabled', 'factory_phase1'] as const) {
      expectText(loginDenialTitles[reason]);
      expectText(loginDenialMessage(reason, ['刘洋']));
    }
    expectText(BACK_TO_LOGIN);
  });
});
