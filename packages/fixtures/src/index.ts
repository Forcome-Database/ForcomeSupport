// 示例数据夹具（待办 02、ADR 0009 修订）：原型 design/spec/data.py 转成的 JSON，
// 供种子数据（apps/server 的加载器）、Fake 回放与 Playwright 共用。
import demoJson from '../data/demo.json' with { type: 'json' };
import { demoFixtureSchema, type DemoFixture } from './schema';

export {
  demoFixtureSchema,
  fixtureCurrencySchema,
  fixtureFeeSchema,
  type DemoFixture,
  type FixtureFee,
  type FixtureLedgerRow,
  type FixtureMember,
  type FixtureNotification,
  type FixtureStore,
  type FixtureTicket,
} from './schema';

let parsed: DemoFixture | undefined;

/**
 * 第一期示例数据。第一次取用时按模式校验（生成脚本改了结构而这里没跟上，会在这时报错），
 * 之后复用同一份；只是导入本包不会解析，生产环境的 api 不受夹具影响。
 */
export function getDemoFixture(): DemoFixture {
  parsed ??= demoFixtureSchema.parse(demoJson);
  return parsed;
}

/** 按分累加美元金额（未填的费用项为 null，跳过），返回两位小数字符串 */
export function sumUsd(fees: readonly ({ usd: string } | null)[]): string {
  let cents = 0;
  for (const fee of fees) {
    if (!fee) continue;
    const [whole = '0', fraction = '00'] = fee.usd.split('.');
    cents += Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
