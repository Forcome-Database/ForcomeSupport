import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ExportedFile } from './api';
import { saveFile } from './download';
import { dismissToast, showError } from './notify';
import { endSessionIfUnauthenticated } from './session';

/**
 * 导出 Excel 的共用流程（S11、K5）：服务端同步生成，完成后浏览器直接下载并交给 done 提示；失败按 G5 弹「<动作>失败：原因」与
 * 「立即重试」（同一个 id 不叠浮层），会话已结束时回到登录入口。P13 台账与 P27 审计日志共用，各自给文件来源与完成的提示
 */
export function useFileExport(options: {
  /** 失败浮层的 id */
  readonly id: string;
  /** 失败浮层标题里的动作（「导出失败：…」） */
  readonly action: string;
  readonly download: () => Promise<ExportedFile>;
  readonly done: (file: ExportedFile) => void | Promise<void>;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({ mutationFn: options.download });

  /** 导出一次：成功下载并提示；失败时抛出（给「立即重试」用） */
  async function exportOnce(): Promise<void> {
    const file = await mutation.mutateAsync();
    dismissToast(options.id);
    saveFile(file.blob, file.fileName);
    await options.done(file);
  }

  return {
    exporting: mutation.isPending,
    run: async () => {
      try {
        await exportOnce();
      } catch (error) {
        if (endSessionIfUnauthenticated(queryClient, error)) return;
        showError({ id: options.id, action: options.action, error, retry: exportOnce });
      }
    },
  };
}
