/*
 * Fake Gmail 里的邮件原文：把测试或示例数据给出的来信拼成 RFC 822（真实 Gmail 的 messages.get format=raw 返回的就是它），
 * 这样解析走的是生产同一条路（channel 用 postal-mime 解析）。只生成纯文本单段邮件：非 ASCII 的头字段按
 * RFC 2047 写成 UTF-8 encoded-word，正文 base64，每行 76 个字符。
 */

/** 放进 Fake Gmail 的一封信 */
export interface FakeMailInput {
  /** 收件地址（To 头）：通常是店铺邮箱，发给几个店铺邮箱时每个邮箱各收到一份（同一个 Message-ID） */
  readonly to: string | readonly string[];
  /**
   * 信落在哪个同步的邮箱（只有一份）：寄到别名、群组或转发地址的信落在它所属的店铺邮箱，To 写的是那个地址（未归属店铺，待办 15）。
   * 不给时落在 to 里的每个地址
   */
  readonly mailbox?: string;
  /**
   * Delivered-To 头（Gmail 在最上面写实际投递到的地址）：不给时为信落到的邮箱；null 为不写这个头（例如转进来的信只有 To）
   */
  readonly deliveredTo?: string | null;
  readonly from: { readonly name?: string; readonly address: string };
  readonly subject: string;
  readonly text: string;
  /** 到达时间（Gmail internalDate），带时区的 ISO 8601 或 Date */
  readonly at: string | Date;
  /** RFC Message-ID（带尖括号）；不给时 Fake 生成一个，null 为不写这个头（有的邮件确实没有） */
  readonly messageId?: string | null;
  /** Gmail 消息 ID；只发给一个邮箱时可以指定（回放示例数据用确定的 ID，重启后不变） */
  readonly gmailId?: string;
  /**
   * Gmail 线程 ID（只在那个邮箱里有意义）：同一邮箱里回信与它回复的来信在同一个线程。不给时自成一个线程（与 Gmail 消息 ID 相同）
   */
  readonly threadId?: string;
  /** 另加的头字段（如 In-Reply-To、Auto-Submitted、List-Unsubscribe），值为原文 */
  readonly headers?: Readonly<Record<string, string>>;
}

const ASCII_PRINTABLE = /^[\x20-\x7e]*$/;

function encodedWord(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function headerText(value: string): string {
  return ASCII_PRINTABLE.test(value) ? value : encodedWord(value);
}

function mailbox(address: { readonly name?: string; readonly address: string }): string {
  if (!address.name) return address.address;
  const name = ASCII_PRINTABLE.test(address.name)
    ? `"${address.name.replace(/(["\\])/g, '\\$1')}"`
    : encodedWord(address.name);
  return `${name} <${address.address}>`;
}

function wrap(base64: string): string {
  return base64.match(/.{1,76}/g)?.join('\r\n') ?? '';
}

export interface BuiltFakeMail {
  readonly internalDate: Date;
  readonly raw: Uint8Array;
}

/** 拼出一封信的原文；deliveredTo 为这一份的 Delivered-To 头（null 不写，「已发送」里我方发出的信没有它） */
export function buildFakeMail(
  mail: FakeMailInput,
  defaultMessageId: string,
  deliveredTo: string | null = null,
): BuiltFakeMail {
  const internalDate = new Date(mail.at);
  if (Number.isNaN(internalDate.getTime()))
    throw new RangeError(`到达时间无效：${String(mail.at)}`);
  const to: readonly string[] = typeof mail.to === 'string' ? [mail.to] : mail.to;
  const lines = [
    ...(deliveredTo ? [`Delivered-To: ${deliveredTo}`] : []),
    ...(mail.messageId === null ? [] : [`Message-ID: ${mail.messageId ?? defaultMessageId}`]),
    `Date: ${internalDate.toUTCString()}`,
    `From: ${mailbox(mail.from)}`,
    `To: ${to.join(', ')}`,
    `Subject: ${headerText(mail.subject)}`,
    ...Object.entries(mail.headers ?? {}).map(([key, value]) => `${key}: ${headerText(value)}`),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(Buffer.from(mail.text, 'utf8').toString('base64')),
    '',
  ];
  return { internalDate, raw: new TextEncoder().encode(lines.join('\r\n')) };
}
