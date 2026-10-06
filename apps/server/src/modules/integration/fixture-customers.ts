/*
 * 示例数据里客户的邮箱（只是 Fake 数据）：夹具里没有客户邮箱，Fake 来信与 Fake Shopify 订单都由客户名推出，
 * 两边一致——同一位客户的联系表单回复邮箱就是她订单上的邮箱（待办 08、11）。
 */

/** 客户名 → 邮箱地址的本地部分：去掉重音、转小写、非字母数字换成点（Sofía Márquez → sofia.marquez） */
function localPart(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

/** 示例客户在某个域名下的邮箱（亚马逊来信是按站点的中转域，其余是 example.com） */
export function fixtureCustomerAddress(name: string, domain = 'example.com'): string {
  return `${localPart(name)}@${domain}`;
}
