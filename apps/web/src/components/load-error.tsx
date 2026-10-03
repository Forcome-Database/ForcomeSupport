import { RefreshCw, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * 加载失败（原型 empty() + load_error() 的默认文案，设计规范第 9 节）：浅色图标块、标题、说明与「重试」。
 * 路由加载出错时的兜底；各页面的加载、空、错误状态随各自的待办按状态板实现。
 */
export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.75 px-6 py-9">
      <div className="mb-1 flex size-11 items-center justify-center rounded-lg bg-primary-soft">
        <WifiOff className="size-5 text-primary-text" strokeWidth={1.75} />
      </div>
      <div className="text-14 font-semibold text-foreground">加载失败</div>
      <div className="max-w-85 text-center text-13 leading-[1.6] text-muted-foreground">
        网络或服务暂时不可用，已保留你在页面上的输入。
      </div>
      <div className="mt-1.5">
        <Button variant="outline" onClick={onRetry}>
          <RefreshCw />
          重试
        </Button>
      </div>
    </div>
  );
}
