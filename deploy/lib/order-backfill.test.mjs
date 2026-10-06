import { describe, expect, it } from 'vitest';
import { orderBackfillRun } from './order-backfill.mjs';

describe('订单回补子命令的参数', () => {
  it('不给店铺为全部；店铺名（可多个，含空格）与 --again 原样交给容器里的命令', () => {
    expect(orderBackfillRun([])).toEqual({ command: ['node', 'dist/order-backfill.mjs'] });
    expect(
      orderBackfillRun(['--store', 'Forcome Direct', '--store', 'forcome.mx', '--again']),
    ).toEqual({
      command: [
        'node',
        'dist/order-backfill.mjs',
        '--store',
        'Forcome Direct',
        '--store',
        'forcome.mx',
        '--again',
      ],
    });
  });

  it('不认识的参数、多出的位置参数、空店铺名报用法', () => {
    expect(orderBackfillRun(['--days', '60'])).toHaveProperty('error');
    expect(orderBackfillRun(['Forcome Direct'])).toHaveProperty('error');
    expect(orderBackfillRun(['--store', ' '])).toHaveProperty('error');
  });
});
