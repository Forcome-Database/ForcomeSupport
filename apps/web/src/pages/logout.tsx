import { useEffect, useRef } from 'react';
import { useLogout } from '@/lib/session';

/**
 * 退出登录（待办 06 验收返工）：头像菜单先导航到这里，再结束会话。离开当前页面要先过 G8——有未保存修改的页面用
 * `useBlocker` 拦下，「继续编辑」就留在原页、会话照旧；「放弃修改」或「保存并离开」成功后才放行到这里。到这里时原页面
 * 已卸载，才调 /api/logout、清掉缓存、回到登录入口。只是一闪而过的空白页（背景色），不另画画面。
 */
export function LogoutPage() {
  const { mutate: logout } = useLogout();
  // 只退一次（StrictMode 下开发环境会把副作用执行两遍）
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    logout();
  }, [logout]);
  return <div className="min-h-screen bg-background" />;
}
