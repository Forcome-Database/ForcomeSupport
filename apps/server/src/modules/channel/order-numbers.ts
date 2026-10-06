import type { Platform } from '@forcome/contracts';

/*
 * 订单号抽取（规格 channel「订单号抽取」，PRD 6.0 ①、规格故事 30，待办 14）：纯函数，按收到来信的店铺平台从主题与正文里
 * 抽出候选订单号，先主题后正文、按出现先后、去重。候选只是「像订单号」，归并时由 ticket 逐个交 order 在该店铺内校验
 * （镜像没有时按需补拉），查不到的不算（协调者 2026-10-07 决定，PRD R-TK-01）。
 * - 亚马逊：3-7-7（`\d{3}-\d{7}-\d{7}`），前后不能再连着数字；
 * - Shopify：订单名的规范写法 #数字（Shopify 默认的订单名），来信里常写成「#1063」「order 1063」「Order No. 1063」，
 *   墨西哥站的客户写西班牙语「pedido 1063」「número de pedido: 1063」；不到 3 位的数字不算（「#1 fan」「order 12 times」）。
 * 没有文本正文的来信从 HTML 里抽：去掉 head、style、script 的内容与全部标签（样式里的 #333333 之类不当订单名）。
 * 候选最多取前 MAX_ORDER_NUMBER_CANDIDATES 个：每个候选在镜像里没有时都可能要去平台补拉一次。
 */

export const MAX_ORDER_NUMBER_CANDIDATES = 5;

const AMAZON_ORDER_NUMBER = /(?<!\d)\d{3}-\d{7}-\d{7}(?!\d)/g;

/** #1063、# 1063 */
const SHOPIFY_HASH_NAME = /#\s?(\d{3,})(?!\d)/g;
/**
 * 「订单」后面跟数字：order 1063、Order No. 1063、order number: 1063、Order #: 1066、Order ID 1067、pedido 1068、
 * número de pedido: 1069（「pedido」前的「número de」可有可无，所以只要认出 pedido）
 */
const SHOPIFY_KEYWORD_NAME =
  /\b(?:order|pedido)\b\s*(?:number|num\.?|no\.?|nr\.?|id|n[úu]mero)?\s*[:#]?\s*:?\s*#?\s*(\d{3,})(?!\d)/gi;

/** HTML 去掉标签后的文字（只为抽订单号，不追求排版） */
function htmlText(html: string): string {
  return html
    .replace(/<(head|style|script)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#35;|&num;/gi, '#');
}

/** 一段文字里的候选（按出现先后） */
function candidatesIn(platform: Platform, text: string): string[] {
  if (platform === 'amazon') return [...text.matchAll(AMAZON_ORDER_NUMBER)].map((m) => m[0]);
  const found = [...text.matchAll(SHOPIFY_HASH_NAME), ...text.matchAll(SHOPIFY_KEYWORD_NAME)]
    .sort((a, b) => a.index - b.index)
    .map((m) => `#${m[1]!}`);
  return found;
}

export function extractOrderNumbers(
  platform: Platform,
  mail: { readonly subject: string; readonly text: string | null; readonly html: string | null },
): string[] {
  const body = mail.text ?? (mail.html ? htmlText(mail.html) : '');
  const all = [...candidatesIn(platform, mail.subject), ...candidatesIn(platform, body)];
  return [...new Set(all)].slice(0, MAX_ORDER_NUMBER_CANDIDATES);
}
