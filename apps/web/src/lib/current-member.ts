import type { CurrentMember } from '@forcome/contracts';
import { createContext, useContext } from 'react';

/** 外壳里的页面取当前成员（外壳只在已登录时渲染，由路由的 app 布局提供） */
export const CurrentMemberContext = createContext<CurrentMember | null>(null);

export function useCurrentMember(): CurrentMember {
  const member = useContext(CurrentMemberContext);
  if (!member) throw new Error('只能在登录后的外壳里使用当前成员');
  return member;
}
