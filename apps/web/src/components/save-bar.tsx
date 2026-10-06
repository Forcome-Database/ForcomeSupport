import { Check } from 'lucide-react';
import { DisabledReason } from '@/components/disabled-reason';
import { Button } from '@/components/ui/button';

/*
 * 设置页的吸底保存栏（原型 ui.save_bar()、状态 K6；P20 起用，P19、P22–P24 随第二期）：固定在内容区底部（设置外壳的 footer），
 * 白底、上边线与向上的阴影、内边距 10 / 24。没有修改时左侧灰字「没有未保存的修改」接说明，两个按钮置灰并悬停写原因；
 * 有修改时左侧为警示色圆点、「有 N 项未保存修改」（13 / 600）与修改摘要（12 次要色，放不下截断、悬停看全部），
 * 右侧「放弃」（ghost）与「保存」（主按钮，带对勾）。文案由使用处给出（各页的文案模块逐字照原型）。
 */
export interface SaveBarCopy {
  readonly clean: string;
  readonly note: string;
  readonly dirty: (count: number) => string;
  readonly discard: string;
  readonly save: string;
  readonly noDiscard: string;
  readonly noSave: string;
}

export function SaveBar({
  copy,
  label,
  dirtyCount,
  summary,
  saving,
  onDiscard,
  onSave,
}: {
  copy: SaveBarCopy;
  /** 读屏器的区域名 */
  label: string;
  dirtyCount: number;
  /** 修改摘要（有修改时写在计数后面） */
  summary: string;
  saving: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const dirty = dirtyCount > 0;
  return (
    <section
      aria-label={label}
      data-testid="save-bar"
      className="flex shrink-0 items-center justify-between gap-3 border-t bg-card px-6 py-2.5 shadow-bar"
    >
      <div className="flex min-w-0 items-center gap-2">
        {dirty ? (
          <>
            <span aria-hidden className="size-1.75 shrink-0 rounded-full bg-warning" />
            <span className="text-13 font-semibold whitespace-nowrap text-foreground">
              {copy.dirty(dirtyCount)}
            </span>
            <span title={summary} className="min-w-0 truncate text-12 text-muted-foreground">
              {summary}
            </span>
          </>
        ) : (
          <>
            <span className="text-13 whitespace-nowrap text-subtle-foreground">{copy.clean}</span>
            <span className="truncate text-12 text-muted-foreground">{copy.note}</span>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <DisabledReason reason={dirty ? null : copy.noDiscard}>
          <Button variant="ghost" disabled={!dirty || saving} onClick={onDiscard}>
            {copy.discard}
          </Button>
        </DisabledReason>
        <DisabledReason reason={dirty ? null : copy.noSave}>
          <Button disabled={!dirty} loading={saving} onClick={onSave}>
            {!saving && <Check />}
            {copy.save}
          </Button>
        </DisabledReason>
      </div>
    </section>
  );
}
