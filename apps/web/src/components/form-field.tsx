import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';

/** 写在字段下方的错误（原型 field() 的 error：12 红字、前面 13 的警示图标）；可以同时有几条（如每个进线邮箱一条） */
export function FieldError({ id, messages }: { id?: string; messages: readonly string[] }) {
  if (messages.length === 0) return null;
  return (
    <div id={id} className="flex flex-col gap-1">
      {messages.map((message) => (
        <p key={message} className="flex items-center gap-1 text-12 text-destructive-text">
          <TriangleAlert className="size-3.25 shrink-0" strokeWidth={2} />
          {message}
        </p>
      ))}
    </div>
  );
}

/**
 * 表单字段（原型 field()，设计规范第 5 节「标签在上、控件在中、说明或错误在下」）：12 / 600 标签（必填带红色星号，
 * note 为标签后的灰色短注）、间距 6；
 * 有错误时下方写错误（id 为 `${htmlFor}-error`，供控件的 aria-describedby 指向），否则写说明（12 次要色、行高 1.45）。
 */
export function FormField({
  label,
  htmlFor,
  required = false,
  note,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  note?: string;
  hint?: string;
  error?: string | readonly string[];
  children: ReactNode;
}) {
  const messages = (typeof error === 'string' ? [error] : (error ?? [])).filter(Boolean);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={htmlFor} required={required} note={note}>
        {label}
      </Label>
      {children}
      {messages.length > 0 ? (
        <FieldError id={htmlFor ? `${htmlFor}-error` : undefined} messages={messages} />
      ) : hint ? (
        <p className="text-12 leading-[1.45] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
