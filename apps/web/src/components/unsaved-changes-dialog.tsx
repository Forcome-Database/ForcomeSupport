import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

/**
 * 未保存离开（全局状态 G8，原型 build_ds.unsaved_frame）：表单类有未保存修改时离开，弹窗三按钮
 * 「继续编辑 · 放弃修改 · 保存并离开」，默认焦点在「继续编辑」，Esc 等同继续编辑。
 */
export function UnsavedChangesDialog({
  open,
  onOpenChange,
  description,
  onDiscard,
  onSaveAndLeave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 例「「编辑店铺」有 2 项未保存的修改。放弃后恢复为上次保存的值。」 */
  description: string;
  onDiscard: () => void;
  onSaveAndLeave: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-115">
        <AlertDialogHeader title="离开前保存修改？" tone="warning" />
        <AlertDialogBody className="text-13 leading-normal">{description}</AlertDialogBody>
        <AlertDialogFooter>
          <AlertDialogCancel>
            <Button type="button" variant="outline" autoFocus>
              继续编辑
            </Button>
          </AlertDialogCancel>
          <Button type="button" variant="destructive-outline" onClick={onDiscard}>
            放弃修改
          </Button>
          <Button type="button" onClick={onSaveAndLeave}>
            保存并离开
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
