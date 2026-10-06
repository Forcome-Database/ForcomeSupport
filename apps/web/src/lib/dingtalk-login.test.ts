import { describe, expect, it } from 'vitest';
import { demoQrFinders, demoQrModules, dingtalkFrameParams } from './dingtalk-login';

describe('钉钉扫码登录框的授权参数（真实接口，G11）', () => {
  it('Client ID、编码后的回调地址、这次的 state；scope 只要 openid', () => {
    expect(
      dingtalkFrameParams({
        mode: 'real',
        clientId: 'dingclientid',
        redirectUri: 'https://support.forcome.example/login/dingtalk',
        state: 'abc',
      }),
    ).toEqual({
      redirect_uri: 'https%3A%2F%2Fsupport.forcome.example%2Flogin%2Fdingtalk',
      client_id: 'dingclientid',
      scope: 'openid',
      response_type: 'code',
      state: 'abc',
      prompt: 'consent',
    });
  });

  it('没有 Client ID（Fake）时不能画钉钉的登录框', () => {
    expect(() =>
      dingtalkFrameParams({ mode: 'fake', clientId: null, redirectUri: '/x', state: 's' }),
    ).toThrow(/Client ID/);
  });
});

describe('示意二维码（Fake，原型 qr_svg()）', () => {
  it('固定种子，每次画的一样；定位角周围留白', () => {
    const modules = demoQrModules();
    expect(demoQrModules()).toEqual(modules);
    const density = modules.length / (25 * 25 - 3 * 8 * 8 + 3);
    expect(density).toBeGreaterThan(0.35);
    expect(density).toBeLessThan(0.6);
    for (const finder of demoQrFinders()) {
      expect(
        modules.some(
          (m) =>
            m.x >= finder.x - 1 &&
            m.x <= finder.x + 7 &&
            m.y >= finder.y - 1 &&
            m.y <= finder.y + 7,
        ),
      ).toBe(false);
    }
  });
});
