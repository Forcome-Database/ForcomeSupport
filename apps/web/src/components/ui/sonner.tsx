import { Toaster as Sonner } from 'sonner';
import { UNDO_TOASTER } from '@/lib/notify';

/*
 * 浮层提示的容器（shadcn Sonner，按原型 toast() 与全局状态 G5 改过）：右上角堆叠、最多 3 条、间距 10，
 * 放在顶栏下方（上 68、右 16），不挡顶栏。成功与信息 3 秒消失（默认时长）；失败与警示不自动消失，
 * 由 src/lib/notify.tsx 的 showError 设定。浮层本身由 notify 渲染成原型的卡片样式。
 * 只做浅色，不接 shadcn 默认带的 next-themes；关掉 Sonner 自带的 Alt+T 快捷键（PRD D-20：快捷键只保留顶部搜索），
 * 读屏器播报区用中文名。
 */
export function Toaster() {
  return (
    <Sonner
      position="top-right"
      visibleToasts={3}
      expand
      gap={10}
      duration={3000}
      offset={{ top: 68, right: 16 }}
      hotkey={[]}
      containerAriaLabel="浮层提示"
    />
  );
}

/**
 * 撤销浮层的容器（G5「可逆操作的 5 秒撤销浮层固定在内容区右下，带倒计时」）：右下角，与内容区留出同样的边距（右 24、下 16），
 * 最多 3 条；只放 notify 的 showUndo
 */
export function UndoToaster() {
  return (
    <Sonner
      id={UNDO_TOASTER}
      position="bottom-right"
      visibleToasts={3}
      expand
      gap={10}
      offset={{ bottom: 16, right: 24 }}
      hotkey={[]}
      containerAriaLabel="撤销浮层"
    />
  );
}
