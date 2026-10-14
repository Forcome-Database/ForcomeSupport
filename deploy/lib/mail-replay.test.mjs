import { describe, expect, it } from 'vitest';
import { mailReplayRun } from './mail-replay.mjs';

describe('历史邮件回放子命令的参数', () => {
  it('不加 --confirm 只看计划（不停 worker）；--t0 与 --confirm 原样交给容器里的命令', () => {
    expect(mailReplayRun([])).toEqual({
      command: ['node', 'dist/mail-replay.mjs'],
      confirm: false,
    });
    expect(mailReplayRun(['--t0', '2026-11-01T00:00:00+08:00', '--confirm'])).toEqual({
      command: ['node', 'dist/mail-replay.mjs', '--t0', '2026-11-01T00:00:00+08:00', '--confirm'],
      confirm: true,
    });
  });

  it('不认识的参数、多出的位置参数、空的 --t0 报用法', () => {
    expect(mailReplayRun(['--yes'])).toHaveProperty('error');
    expect(mailReplayRun(['2026-11-01'])).toHaveProperty('error');
    expect(mailReplayRun(['--t0', ' '])).toHaveProperty('error');
  });
});
