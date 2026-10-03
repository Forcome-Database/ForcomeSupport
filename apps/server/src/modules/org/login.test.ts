import { describe, expect, it } from 'vitest';
import { loginDenial, loginDenialMessage } from './login';

describe('能不能进入客服系统（G12、AC-P1-21）', () => {
  it('在职且有客服系统角色的成员可以进入', () => {
    expect(loginDenial({ status: 'active', roles: ['agent'] })).toBeNull();
    expect(
      loginDenial({ status: 'active', roles: ['factory_contact', 'aftersales_owner'] }),
    ).toBeNull();
  });

  it('三种被拒：已停用、未分配角色、只有生产厂对接人角色（第一期）', () => {
    expect(loginDenial({ status: 'disabled', roles: ['admin'] })).toBe('disabled');
    expect(loginDenial({ status: 'active', roles: [] })).toBe('no_role');
    expect(loginDenial({ status: 'active', roles: ['factory_contact'] })).toBe('factory_phase1');
  });

  it('被拒说明照原型 G12 的文案，未分配角色时写出管理员', () => {
    expect(loginDenialMessage('no_role', ['刘洋'])).toBe(
      '你的钉钉账号还没有在本系统分配角色，请联系管理员刘洋。',
    );
    expect(loginDenialMessage('no_role', [])).toBe(
      '你的钉钉账号还没有在本系统分配角色，请联系管理员。',
    );
    expect(loginDenialMessage('disabled', ['刘洋'])).toBe(
      '你的账号已停用（钉钉离职或管理员停用）。',
    );
    expect(loginDenialMessage('factory_phase1', ['刘洋'])).toBe(
      '工厂工作台第二阶段上线，目前无法进入。',
    );
  });
});
