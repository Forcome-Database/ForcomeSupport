import { convert, type HtmlToTextOptions } from 'html-to-text';

/*
 * P05 全程记录显示的正文（PRD P05「第一阶段」，待办 17）：纯文本部分优先；没有纯文本部分（只发 HTML 的邮件）时用 html-to-text
 * 转成文字（段落、换行保留，链接只留文字、图片去掉）。经平台中转的来信（R-TK-08）只显示客户写的留言，平台套的格式与客户、订单信息
 * 已写在卡头与右栏：Shopify 联系表单通知取表单的 Body 栏之后的全部；亚马逊买家消息取「Begin message」与「End message」两行之间
 * （后面是平台的提示与订单号）。找不到这些标记时照原文。引用的往来邮件不剥离（宁可多显示，不误删客户写的内容）。
 * 亚马逊的写法要在真实环境核对（待办 29）。
 */

const HTML_OPTIONS: HtmlToTextOptions = {
  wordwrap: false,
  selectors: [
    { selector: 'a', options: { ignoreHref: true } },
    { selector: 'img', format: 'skip' },
  ],
};

/** 联系表单的 Body 栏（行首「Body:」，留言可以写在同一行或下面几行） */
const CONTACT_FORM_BODY = /^[ \t]*Body[ \t]*:[ \t]*/im;

/** 亚马逊买家消息里客户的留言：「------------- Begin message -------------」与「… End message …」两行之间 */
const AMAZON_MESSAGE =
  /^[ \t]*-+[ \t]*Begin message[ \t]*-+[ \t]*$([\s\S]*?)^[ \t]*-+[ \t]*End message[ \t]*-+[ \t]*$/im;

function contactFormMessage(text: string): string {
  const match = CONTACT_FORM_BODY.exec(text);
  return match ? text.slice(match.index + match[0].length) : text;
}

function amazonMessage(text: string): string {
  return AMAZON_MESSAGE.exec(text)?.[1] ?? text;
}

export function displayBody(input: {
  readonly text: string | null;
  readonly html: string | null;
  /** 经哪个平台中转的来信（亚马逊买家消息、Shopify 联系表单）；直邮与我方发出的不填 */
  readonly relay?: 'amazon' | 'shopify' | undefined;
}): string {
  const plain = (
    input.text?.trim() ? input.text : input.html ? convert(input.html, HTML_OPTIONS) : ''
  ).replace(/\r\n?/g, '\n');
  const body =
    input.relay === 'shopify'
      ? contactFormMessage(plain)
      : input.relay === 'amazon'
        ? amazonMessage(plain)
        : plain;
  return body.trim();
}
