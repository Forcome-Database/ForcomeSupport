import { describe, expect, it } from 'vitest';
import { composeEnvironment, playwrightVersion } from './docker.mjs';

const LOCK = "  '@playwright/test@1.63.0':\n    resolution: {integrity: sha512-x}\n";

describe('调用 Compose 的子进程环境', () => {
  it('环境文件里写了的变量从 shell 环境去掉（不分大小写），环境文件因此优先', () => {
    const env = composeEnvironment({
      processEnv: {
        PATH: '/usr/bin',
        HTTPS_PROXY: 'http://runner-proxy:3128',
        https_proxy: 'http://runner-proxy:3128',
        APP_ENV: 'production',
        DOCKER_HOST: 'unix:///run/user/1001/docker.sock',
      },
      envFileVars: {
        HTTPS_PROXY: '',
        APP_ENV: 'staging',
        SITE_HOST: 'support-dev.forcome.internal',
      },
      release: '0a1b2c3d4e5f',
      lockText: LOCK,
    });
    expect(env).toEqual({
      PATH: '/usr/bin',
      DOCKER_HOST: 'unix:///run/user/1001/docker.sock',
      RELEASE: '0a1b2c3d4e5f',
      PLAYWRIGHT_VERSION: '1.63.0',
    });
  });

  it('去掉 COMPOSE_PROJECT_NAME、COMPOSE_FILE、COMPOSE_PROFILES，项目名与文件只由部署脚本决定', () => {
    const env = composeEnvironment({
      processEnv: { COMPOSE_PROJECT_NAME: 'x', compose_file: 'y.yml', COMPOSE_PROFILES: 'smoke' },
      envFileVars: {},
      release: 'r',
      lockText: LOCK,
    });
    expect(env).toEqual({ RELEASE: 'r', PLAYWRIGHT_VERSION: '1.63.0' });
  });
});

describe('冒烟镜像的 Playwright 版本与锁文件一致', () => {
  it('从 pnpm-lock.yaml 取 @playwright/test 的版本', () => {
    expect(playwrightVersion(LOCK)).toBe('1.63.0');
  });

  it('锁文件里没有或有多个版本时报错（镜像与测试包版本不一致时浏览器起不来）', () => {
    expect(() => playwrightVersion('lockfileVersion: 9.0\n')).toThrow(/@playwright\/test/);
    expect(() =>
      playwrightVersion("  '@playwright/test@1.63.0':\n  '@playwright/test@1.62.1':\n"),
    ).toThrow(/多个版本/);
  });
});
