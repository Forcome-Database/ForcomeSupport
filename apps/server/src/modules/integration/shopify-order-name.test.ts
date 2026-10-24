import { describe, expect, it } from 'vitest';
import { sameShopifyOrder, shopifyOrderNumber } from './shopify-order-name';

/*
 * Shopify 订单名与订单号：订单名是店铺设的前缀 + 订单号 + 后缀，按订单名找订单时认订单号（来信里常少写前缀）。
 */

describe('订单名里的订单号', () => {
  it('去掉前缀与后缀', () => {
    expect(shopifyOrderNumber('#1063')).toBe('1063');
    expect(shopifyOrderNumber('#Y22283')).toBe('22283');
    expect(shopifyOrderNumber('1063')).toBe('1063');
    expect(shopifyOrderNumber(' #1001-US ')).toBe('1001');
  });

  it('前后缀里也有数字、或没有数字时认不出', () => {
    expect(shopifyOrderNumber('#2024-1001')).toBeNull();
    expect(shopifyOrderNumber('#Y')).toBeNull();
  });
});

describe('两个订单名是不是同一笔', () => {
  it('订单号相同就是同一笔（#22283、22283、Y22283 与 #Y22283）', () => {
    for (const written of ['#22283', '22283', 'Y22283', '#Y22283']) {
      expect(sameShopifyOrder('#Y22283', written), written).toBe(true);
    }
  });

  it('订单号不同、或认不出订单号又不完全一致的不是同一笔', () => {
    expect(sameShopifyOrder('#Y22283', '#22284')).toBe(false);
    expect(sameShopifyOrder('#Y22283', '#222830')).toBe(false);
    expect(sameShopifyOrder('#2024-1001', '#1001')).toBe(false);
    expect(sameShopifyOrder('#2024-1001', '#2024-1001')).toBe(true);
  });
});
