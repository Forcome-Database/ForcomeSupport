import { TriangleAlert } from 'lucide-react';
import { useLayoutEffect, useState, type ReactNode } from 'react';
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
    <div data-form-field className="flex min-w-0 flex-col gap-1.5">
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

/**
 * 保存后定位到第一个错误（K8「保存后定位到第一个错误」、S14）：返回的函数接收控件的 id，等这次的字段错误与错误横幅都渲染出来、
 * 布局定下之后，才把焦点放到控件上，并把整个字段（标签、控件、下方的错误）滚到可见区中间。如果先滚动，之后出现的横幅会把滚动区
 * 压短，下方的报错又把内容撑长，靠近底部的字段与它的报错就会落到可见区外（待办 20 验收返工）。
 * 和 setError 在同一个事件里调用（同一次渲染提交），在提交后的布局阶段执行；单选组落到第一个选项上。
 */
export function useFocusField(): (id: string) => void {
  const [request, setRequest] = useState<{ readonly id: string } | null>(null);
  useLayoutEffect(() => {
    if (!request) return;
    const element = document.getElementById(request.id);
    if (!element) return;
    const control =
      element.getAttribute('role') === 'radiogroup'
        ? element.querySelector<HTMLElement>('button')
        : element;
    control?.focus({ preventScroll: true });
    (element.closest<HTMLElement>('[data-form-field]') ?? element).scrollIntoView({
      block: 'center',
    });
  }, [request]);
  // 每次都是新对象：同一个字段连着两次出错也会再定位
  return (id) => setRequest({ id });
}
