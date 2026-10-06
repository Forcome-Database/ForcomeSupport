import { AMAZON_ORDER_NUMBER_PATTERN, type Platform } from '@forcome/contracts';

/*
 * 订单号抽取（规格 channel「订单号抽取」，PRD 6.0 ①、规格故事 30，待办 14）：纯函数，按收到来信的店铺平台从主题与正文里
 * 抽出候选订单号，先主题后正文、按出现先后、去重。候选只是「像订单号」，归并时由 ticket 逐个交 order 在该店铺内校验
 * （镜像没有时按需补拉），查不到的不算（协调者 2026-10-07 决定，PRD R-TK-01）。
 * - 亚马逊：3-7-7（`\d{3}-\d{7}-\d{7}`），前后不能再连着数字；
 * - Shopify：订单名的规范写法 #数字（Shopify 默认的订单名，从 #1001 起），来信里常写成「#1063」「order 1063」「Order No. 1063」，
 *   墨西哥站的客户写西班牙语「pedido 1063」「orden 1063」「número de pedido: 1063」；不到 4 位的数字不算（「Apt #305」「#1 fan」
 *   「order 12 times」）。带「order / pedido / orden」字样的候选排在只写 # 的前面（「Ticket #4521 … order 1063」先试 #1063）。
 * 没有文本正文的来信从 HTML 里抽：去掉 head、style、script 的内容与全部标签（样式里的 #333333 之类不当订单名），
 * 数字字符实体（&#35;、&#x23;、&#8217; 等）一律解码成字符，免得「&#8217;」被当成订单名 #8217。
 * 候选最多取前 MAX_ORDER_NUMBER_CANDIDATES 个：每个候选在镜像里没有时都可能要去平台补拉一次。
 */

export const MAX_ORDER_NUMBER_CANDIDATES = 5;

const AMAZON_ORDER_NUMBER = new RegExp(
  String.raw`(?<!\d)${AMAZON_ORDER_NUMBER_PATTERN}(?!\d)`,
  'g',
);

/** #1063、# 1063；紧跟在 & 后面的不算（没解码的字符实体：双重转义的 &amp;#8217;、不带分号的 &#8217） */
const SHOPIFY_HASH_NAME = /(?<!&)#\s?(\d{4,})(?!\d)/g;
/**
 * 「订单」后面跟数字：order 1063、Order No. 1063、order number: 1063、Order #: 1066、Order ID 1067、pedido 1068、orden 1068、
 * número de pedido: 1069（「pedido / orden」前的「número de」可有可无，所以只要认出 pedido、orden）
 */
const SHOPIFY_KEYWORD_NAME =
  /\b(?:order|pedido|orden)\b\s*(?:number|num\.?|no\.?|nr\.?|id|n[úu]mero)?\s*[:#]?\s*:?\s*#?\s*(\d{4,})(?!\d)/gi;

/** 数字字符实体对应的字符；码位不合法的换成空格 */
function codePointText(code: number): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
}

/** HTML 去掉标签后的文字（只为抽订单号，不追求排版） */
function htmlText(html: string): string {
  return (
    html
      .replace(/<(head|style|script)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePointText(Number.parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec: string) => codePointText(Number(dec)))
      .replace(/&nbsp;/gi, ' ')
      .replace(/&num;/gi, '#')
      // 最后才还原 &amp;：双重转义的 &amp;#8217; 只还原一层成 &#8217;，由订单名的写法排除（# 紧跟在 & 后面的不算）
      .replace(/&amp;/gi, '&')
  );
}

/** 主题与正文里按某个写法抽到的候选（先主题后正文、按出现先后）；Shopify 的写法取第 1 组数字、补成 #数字 */
function matchesIn(texts: readonly string[], pattern: RegExp): string[] {
  return texts.flatMap((text) =>
    [...text.matchAll(pattern)].map((m) => (m[1] === undefined ? m[0] : `#${m[1]}`)),
  );
}

export function extractOrderNumbers(
  platform: Platform,
  mail: { readonly subject: string; readonly text: string | null; readonly html: string | null },
): string[] {
  const texts = [mail.subject, mail.text ?? (mail.html ? htmlText(mail.html) : '')];
  const all =
    platform === 'amazon'
      ? matchesIn(texts, AMAZON_ORDER_NUMBER)
      : [...matchesIn(texts, SHOPIFY_KEYWORD_NAME), ...matchesIn(texts, SHOPIFY_HASH_NAME)];
  return [...new Set(all)].slice(0, MAX_ORDER_NUMBER_CANDIDATES);
}
