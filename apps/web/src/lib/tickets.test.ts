import { describe, expect, it } from 'vitest';
import { formatLastInbound } from './tickets';

/* P04「最近来信」：当天只写时分，其余写「月-日 时:分」，都按北京时间（原型 short_time()） */

describe('最近来信的写法', () => {
  const now = new Date('2026-09-11T02:20:00Z'); // 北京时间 09-11 10:20

  it('当天只写时分', () => {
    expect(formatLastInbound('2026-09-11T01:12:00.000Z', now)).toBe('09:12');
    // 北京时间 09-11 00:05 仍是当天（UTC 还是 09-10）
    expect(formatLastInbound('2026-09-10T16:05:00.000Z', now)).toBe('00:05');
  });

  it('不是当天写「月-日 时:分」', () => {
    expect(formatLastInbound('2026-09-10T00:15:00.000Z', now)).toBe('09-10 08:15');
    expect(formatLastInbound('2026-09-10T15:59:00.000Z', now)).toBe('09-10 23:59');
  });
});
