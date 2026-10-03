import { describe, expect, it } from 'vitest';
import { contactAdmins, loginDenialMessage, loginDenialTitles } from './auth';

describe('登录被拒的画面文案（G12，原型 deny()）', () => {
  it('标题照原型', () => {
    expect(loginDenialTitles).toEqual({
      no_role: '还没有分配角色',
      disabled: '账号已停用',
      factory_phase1: '暂时无法进入',
    });
  });

  it('说明照原型，未分配角色时写出在职管理员', () => {
    expect(loginDenialMessage('no_role', ['刘洋'])).toBe(
      '你的钉钉账号还没有在本系统分配角色，请联系管理员刘洋。',
    );
    expect(loginDenialMessage('disabled', ['刘洋'])).toBe(
      '你的账号已停用（钉钉离职或管理员停用）。',
    );
    expect(loginDenialMessage('factory_phase1', ['刘洋'])).toBe(
      '工厂工作台第二阶段上线，目前无法进入。',
    );
  });

  it('联系管理员：多位用「、」连接，没有在职管理员时只写「联系管理员」', () => {
    expect(contactAdmins(['刘洋', '孙杰'])).toBe('联系管理员刘洋、孙杰');
    expect(contactAdmins([])).toBe('联系管理员');
    expect(loginDenialMessage('no_role', [])).toBe(
      '你的钉钉账号还没有在本系统分配角色，请联系管理员。',
    );
  });
});
