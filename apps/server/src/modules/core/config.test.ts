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
      devLoginEnabled: false,
      clientModes: {},
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

describe('开发登录开关（只在非生产环境由环境变量开启）', () => {
  it('默认关闭；非生产环境可用 DEV_LOGIN_ENABLED=true 开启', () => {
    expect(loadConfig({ DATABASE_URL }).devLoginEnabled).toBe(false);
    expect(loadConfig({ DATABASE_URL, DEV_LOGIN_ENABLED: 'true' }).devLoginEnabled).toBe(true);
    expect(
      loadConfig({ DATABASE_URL, APP_ENV: 'staging', DEV_LOGIN_ENABLED: 'true' }).devLoginEnabled,
    ).toBe(true);
    expect(loadConfig({ DATABASE_URL, DEV_LOGIN_ENABLED: 'false' }).devLoginEnabled).toBe(false);
  });

  it('生产环境开启开发登录拒绝启动', () => {
    expect(() =>
      loadConfig({ DATABASE_URL, APP_ENV: 'production', DEV_LOGIN_ENABLED: 'true' }),
    ).toThrow(/DEV_LOGIN_ENABLED：生产环境不能开启开发登录/);
  });

  it('只接受 true 或 false，避免 yes、1 之类被误当成关闭', () => {
    expect(() => loadConfig({ DATABASE_URL, DEV_LOGIN_ENABLED: 'yes' })).toThrow(
      /DEV_LOGIN_ENABLED/,
    );
  });
});

describe('全局外部客户端的真实 / Fake 选择（CLIENT_MODE_<系统>）', () => {
  it('按系统名读取，系统名转成小写 snake_case', () => {
    expect(
      loadConfig({
        DATABASE_URL,
        CLIENT_MODE_DINGTALK: 'real',
        CLIENT_MODE_EXCHANGE_RATE: 'fake',
      }).clientModes,
    ).toEqual({ dingtalk: 'real', exchange_rate: 'fake' });
  });

  it('取值只能是 real 或 fake', () => {
    expect(() => loadConfig({ DATABASE_URL, CLIENT_MODE_DINGTALK: 'mock' })).toThrow(
      /CLIENT_MODE_DINGTALK/,
    );
  });

  it('生产环境不允许把任何客户端设为 fake', () => {
    expect(() =>
      loadConfig({ DATABASE_URL, APP_ENV: 'production', CLIENT_MODE_DINGTALK: 'fake' }),
    ).toThrow(/CLIENT_MODE_DINGTALK：生产环境不允许使用 Fake/);
    expect(
      loadConfig({ DATABASE_URL, APP_ENV: 'production', CLIENT_MODE_DINGTALK: 'real' }).clientModes,
    ).toEqual({ dingtalk: 'real' });
  });
});
