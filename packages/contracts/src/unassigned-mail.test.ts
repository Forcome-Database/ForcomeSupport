import { describe, expect, it } from 'vitest';
import { domainOf, isAmazonDomain, unassignedSlaTarget } from './unassigned-mail';

/* 未归属店铺来信（E-13，待办 15）：SLA 目标按发件域判断 */
describe('未归属来信的 SLA 目标（E-13：平台按发件域判断）', () => {
  it('发件域是亚马逊的域（站点域与买家消息中转域）按亚马逊 24 小时，其余按内部目标', () => {
    expect(unassignedSlaTarget('tom.x7@marketplace.amazon.ca')).toBe('platform');
    expect(unassignedSlaTarget('Buyer@Marketplace.Amazon.com.mx')).toBe('platform');
    expect(unassignedSlaTarget('notice@amazon.com')).toBe('platform');
    expect(unassignedSlaTarget('lucia@gmail.com')).toBe('internal');
    expect(unassignedSlaTarget('mailer@shopify.com')).toBe('internal');
  });

  it('只认这几个域本身，形似的域与子域不算', () => {
    expect(isAmazonDomain('amazon.com.example')).toBe(false);
    expect(isAmazonDomain('mail.amazon.com')).toBe(false);
    expect(domainOf('no-at-sign')).toBe('');
  });
});
