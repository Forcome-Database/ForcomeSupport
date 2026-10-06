import { RefreshCw } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
} from '@/components/ui/alert-dialog';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/*
 * 乐观锁冲突（全局状态 G7，原型 build_ds.g7_occ()）：保存时发现记录已被他人修改。
 * 表单顶部的警示横幅写明谁、几点改了哪些项，你的输入保留不丢；「查看最新」换成最新内容重新编辑，
 * 「覆盖保存」先二次确认（默认焦点在「取消」），覆盖记入审计日志。带版本号的表单都用这一组（ADR 0007 修订）。
 */

export interface EditConflictInfo {
  /** 先保存的人（姓名；系统写入为「系统」） */
  readonly who: string;
  /** 对方保存的时刻（hh:mm）；不知道时为空串（P20 几个人同时冲突时写「他人」） */
  readonly at: string;
  /** 对方改了哪些项（字段名）；内容相同时为空 */
  readonly fields: readonly string[];
}

export function EditConflictAlert({
  conflict,
  copy,
  onReload,
  onOverwrite,
}: {
  conflict: EditConflictInfo;
  /** 标题与说明另写时给出（P20 成员表：「赵倩刚被周敏修改（10:24）」「……已保留在表格中……」） */
  copy?: { readonly title: string; readonly description: string };
  onReload: () => void;
  onOverwrite: () => void;
}) {
  const { who, at, fields } = conflict;
  return (
    <Alert
      tone="warning"
      title={copy?.title ?? `这条记录刚被${who}修改（${at}）`}
      description={
        copy?.description ??
        `${fields.length > 0 ? `${who}改了：${fields.join('、')}。` : ''}你的修改还没保存，已保留在下方；可先查看最新内容再改，或用你的内容覆盖。`
      }
      action={
        <>
          <Button type="button" variant="outline" size="sm" onClick={onReload}>
            <RefreshCw />
            查看最新
          </Button>
          <Button type="button" variant="destructive-outline" size="sm" onClick={onOverwrite}>
            覆盖保存
          </Button>
        </>
      }
    />
  );
}

function overwriteText({ who, at, fields }: EditConflictInfo): string {
  const [first] = fields;
  const what =
    fields.length > 1 ? `「${first}」等 ${fields.length} 项` : first ? `「${first}」` : '内容';
  return `${who}${at ? ` ${at}` : ''} 保存的${what}会被你的内容替换，覆盖后记入审计日志。`;
}

/** 「覆盖保存」的二次确认 */
export function OverwriteDialog({
  conflict,
  open,
  onOpenChange,
  pending,
  onConfirm,
}: {
  conflict: EditConflictInfo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-105">
        <AlertDialogHeader title={`覆盖${conflict?.who ?? ''}的修改？`} tone="warning" />
        <AlertDialogBody className="text-12 leading-normal">
          {conflict ? overwriteText(conflict) : ''}
        </AlertDialogBody>
        <AlertDialogFooter>
          <AlertDialogCancel>
            <Button type="button" variant="outline" size="sm" autoFocus>
              取消
            </Button>
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            loading={pending}
            onClick={onConfirm}
          >
            覆盖保存
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
