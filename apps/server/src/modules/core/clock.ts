/**
 * 可注入时钟（规格「数据约定」、ADR 0008 修订）：归并、关闭、重开、SLA、扫描任务与历史回放
 * 都按显式的「当前时间」计算。生产用系统时钟；测试与回放用手动时钟。
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export interface Duration {
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  milliseconds?: number;
}

function toMilliseconds(d: Duration): number {
  return (
    (d.days ?? 0) * 86_400_000 +
    (d.hours ?? 0) * 3_600_000 +
    (d.minutes ?? 0) * 60_000 +
    (d.seconds ?? 0) * 1_000 +
    (d.milliseconds ?? 0)
  );
}

function toEpoch(at: Date | string): number {
  const epoch = new Date(at).getTime();
  if (Number.isNaN(epoch)) {
    throw new RangeError(`无效的时间：${String(at)}`);
  }
  return epoch;
}

/** 停在给定时刻的时钟，只在被设定或推进时变化；时间只能向前 */
export class ManualClock implements Clock {
  #epoch: number;

  constructor(start: Date | string) {
    this.#epoch = toEpoch(start);
  }

  now(): Date {
    return new Date(this.#epoch);
  }

  set(at: Date | string): void {
    this.#epoch = toEpoch(at);
  }

  advance(duration: Duration): void {
    const ms = toMilliseconds(duration);
    if (ms < 0) {
      throw new RangeError('时钟只能向前推进');
    }
    this.#epoch += ms;
  }
}
