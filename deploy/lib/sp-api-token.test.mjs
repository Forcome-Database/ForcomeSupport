import { describe, expect, it } from 'vitest';
import { spApiTokenRun } from './sp-api-token.mjs';

describe('录入卖家授权子命令的参数', () => {
  it('卖家 ID 原样交给容器里的命令；刷新令牌不在参数里（从标准输入读）', () => {
    expect(spApiTokenRun(['--seller', 'A1FD7Q2M9XK3LC'])).toEqual({
      command: ['node', 'dist/sp-api-token.mjs', '--seller', 'A1FD7Q2M9XK3LC'],
    });
  });

  it('没给卖家 ID、卖家 ID 不像、多给了参数时报用法', () => {
    expect(spApiTokenRun([])).toHaveProperty('error');
    expect(spApiTokenRun(['--seller', 'forcome-mx.myshopify.com'])).toHaveProperty('error');
    expect(spApiTokenRun(['--seller', 'A1FD7Q2M9XK3LC', '--token', 'Atzr|x'])).toHaveProperty(
      'error',
    );
    expect(spApiTokenRun(['--seller', 'A1FD7Q2M9XK3LC', 'Atzr|x'])).toHaveProperty('error');
  });
});
