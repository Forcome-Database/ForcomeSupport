import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './index';

const DATABASE_URL = 'postgres://forcome:secret@127.0.0.1:4520/forcome';

describe('配置读取', () => {
  it('只给数据库地址时其余取默认值', () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({
      appEnv: 'development',
      databaseUrl: DATABASE_URL,
      port: 3000,
      logLevel: 'info',
    });
  });

  it('读取环境、端口与日志级别', () => {
    const config = loadConfig({
      DATABASE_URL,
      APP_ENV: 'production',
      PORT: '8080',
      LOG_LEVEL: 'warn',
    });
    expect(config).toMatchObject({ appEnv: 'production', port: 8080, logLevel: 'warn' });
  });

  it('缺少或写错的变量一次全部列出，且不回显变量值', () => {
    let error: unknown;
    try {
      loadConfig({ DATABASE_URL: 'mysql://root:top-secret@db/x', APP_ENV: 'prod', PORT: 'abc' });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as Error).message;
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('APP_ENV');
    expect(message).toContain('PORT');
    expect(message).not.toContain('top-secret');
  });

  it('缺少数据库地址时报错', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
});
