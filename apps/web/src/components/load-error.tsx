import { RefreshCw, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from './empty-state';

/**
 * 加载失败（原型 load_error() 的默认文案，设计规范第 9 节）：图标、标题、说明与「重试」。
 * 路由加载出错时的兜底；各页面的加载、空、错误状态随各自的待办按状态板实现。
 */
export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      icon={WifiOff}
      title="加载失败"
      description="网络或服务暂时不可用，已保留你在页面上的输入。"
      action={
        <Button variant="outline" onClick={onRetry}>
          <RefreshCw />
          重试
        </Button>
      }
    />
  );
}
