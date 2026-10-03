import { describe, expect, it } from 'vitest';
import { createEnvFile, readDeployEnv } from './env-file.mjs';
import { ENVIRONMENTS } from './environments.mjs';

const staging = ENVIRONMENTS.staging;

const VALID = `
APP_ENV=staging
SITE_HOST=support-dev.forcome.internal
HTTPS_BIND=127.0.0.1
HTTPS_PORT=4510
PG_PORT=4511
TLS_MODE=internal
POSTGRES_USER=forcome
POSTGRES_PASSWORD=3f9a0c4e1b2d7a8c9e0f1a2b3c4d5e6f
POSTGRES_DB=forcome
DEV_LOGIN_ENABLED=true
`;

describe('读取并校验部署环境文件', () => {
  it('合格的文件取出部署脚本要用的值', () => {
    expect(readDeployEnv(VALID, staging)).toEqual({
      vars: expect.objectContaining({ SITE_HOST: 'support-dev.forcome.internal' }),
      siteHost: 'support-dev.forcome.internal',
      httpsBind: '127.0.0.1',
      httpsPort: 4510,
      pgPort: 4511,
      problems: [],
    });
  });

  it('环境文件写的 APP_ENV 与要部署的环境不符时报错，防止拿生产的文件部署开发测试环境', () => {
    const { problems } = readDeployEnv(
      VALID.replace('APP_ENV=staging', 'APP_ENV=production'),
      staging,
    );
    expect(problems).toContain('APP_ENV：部署 staging 时必须是 staging');
  });

  it('口令缺失、仍是模板占位或含 URL 里需要转义的字符时报错（连接串直接拼口令）', () => {
    const missing = readDeployEnv(
      VALID.replace(/POSTGRES_PASSWORD=.*/, 'POSTGRES_PASSWORD='),
      staging,
    );
    expect(missing.problems).toContain('POSTGRES_PASSWORD：必填');
    const placeholder = readDeployEnv(
      VALID.replace(/POSTGRES_PASSWORD=.*/, 'POSTGRES_PASSWORD=change-me'),
      staging,
    );
    expect(placeholder.problems).toContain('POSTGRES_PASSWORD：还是模板里的占位值，请换成随机口令');
    const special = readDeployEnv(
      VALID.replace(/POSTGRES_PASSWORD=.*/, 'POSTGRES_PASSWORD=abc@def/ghi1234567'),
      staging,
    );
    expect(special.problems).toContain(
      'POSTGRES_PASSWORD：只能用字母、数字与 . _ ~ -，至少 16 位（会直接拼进数据库连接串）',
    );
  });

  it('域名、端口、证书方式写错时一次列全', () => {
    const { problems } = readDeployEnv(
      VALID.replace('SITE_HOST=support-dev.forcome.internal', 'SITE_HOST=https://support-dev')
        .replace('HTTPS_PORT=4510', 'HTTPS_PORT=70000')
        .replace('TLS_MODE=internal', 'TLS_MODE=letsencrypt'),
      staging,
    );
    expect(problems).toEqual([
      'SITE_HOST：只填域名（如 support-dev.forcome.internal），不带协议与端口',
      'HTTPS_PORT：必须是 1–65535 的整数',
      'TLS_MODE：目前只支持 internal（caddy 内部 CA）；切换 DNS-01 的做法见 docs/部署说明.md',
    ]);
  });
});

describe('第一次部署时从模板生成环境文件', () => {
  it('只把口令换成随机值，其余行（含注释与空行）原样保留', () => {
    const example = '# 说明\nAPP_ENV=staging\n\nPOSTGRES_PASSWORD=change-me\nPOSTGRES_DB=forcome\n';
    expect(createEnvFile(example, 'a1b2c3d4e5f6a7b8c9d0')).toBe(
      '# 说明\nAPP_ENV=staging\n\nPOSTGRES_PASSWORD=a1b2c3d4e5f6a7b8c9d0\nPOSTGRES_DB=forcome\n',
    );
  });

  it('模板里没有口令这一行时报错，而不是生成一份不能用的文件', () => {
    expect(() => createEnvFile('APP_ENV=staging\n', 'a1b2c3d4e5f6a7b8c9d0')).toThrow(
      /POSTGRES_PASSWORD/,
    );
  });
});
