import { describe, expect, it } from 'vitest';
import { loginDenial } from './login';

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
});
