/*
 * Shopify 订单名与订单号：订单名是店铺设的前缀 + 订单号 + 后缀（Shopify 后台「订单 ID 格式」，默认前缀 #、没有后缀，如 #1063；
 * 也有店铺改成 #Y22283、#1001-US）。订单号在店铺内唯一、按序递增，改前缀后接着编号。来信里客户常只写数字或少写前缀，
 * 所以按订单名找订单时认订单号（店铺内唯一，不会认错）。Shopify 的订单搜索也认不带前缀的订单号：实测 name:"#22283" 找得到 #Y22283
 * （写成别的前缀 #A22283 找不到，镜像里按订单号比对则不看前缀）。
 */

const ORDER_NAME = /^\D*(\d+)\D*$/;

/** 订单名里的订单号（去掉前缀与后缀，如 #Y22283 → 22283）；前后缀里也有数字、认不出唯一一段数字时为 null */
export function shopifyOrderNumber(name: string): string | null {
  return ORDER_NAME.exec(name.trim())?.[1] ?? null;
}

/** 两个订单名是不是同一笔：完全一致，或订单号相同（#22283、Y22283 与 #Y22283 是同一笔） */
export function sameShopifyOrder(a: string, b: string): boolean {
  if (a.trim() === b.trim()) return true;
  const number = shopifyOrderNumber(a);
  return number !== null && number === shopifyOrderNumber(b);
}
