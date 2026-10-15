import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import {
  createEnvFile,
  envFilePermissionProblem,
  generatedSecret,
  readDeployEnv,
} from './env-file.mjs';
import { ENVIRONMENTS } from './environments.mjs';

const staging = ENVIRONMENTS.staging;
const production = ENVIRONMENTS.production;

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
WALG_LIBSODIUM_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
RESTIC_PASSWORD=5e1f0c2a9b8d7e6f5a4b3c2d1e0f9a8b
`;

/** 生产的环境文件：APP_ENV、端口与 NAS 的备份目录 */
const PRODUCTION = VALID.replace('APP_ENV=staging', 'APP_ENV=production')
  .replace('DEV_LOGIN_ENABLED=true', 'DEV_LOGIN_ENABLED=false')
  .replace('HTTPS_PORT=4510', 'HTTPS_PORT=4512')
  .replace('PG_PORT=4511', 'PG_PORT=4513')
  .concat('BACKUP_DIR=/mnt/nas/forcome-support\n');

describe('读取并校验部署环境文件', () => {
  it('合格的文件取出部署脚本要用的值', () => {
    expect(readDeployEnv(VALID, staging)).toEqual({
      vars: expect.objectContaining({ SITE_HOST: 'support-dev.forcome.internal' }),
      siteHost: 'support-dev.forcome.internal',
      httpsBind: '127.0.0.1',
      httpsPort: 4510,
      pgPort: 4511,
      siteUrl: 'https://support-dev.forcome.internal:4510/',
      connectHost: '127.0.0.1',
      backupDir: null,
      problems: [],
    });
  });

  it('访问地址在 443 端口时不带端口；监听 0.0.0.0 时本机从 127.0.0.1 连接核对', () => {
    const onServer = readDeployEnv(
      VALID.replace('HTTPS_PORT=4510', 'HTTPS_PORT=443').replace(
        'HTTPS_BIND=127.0.0.1',
        'HTTPS_BIND=0.0.0.0',
      ),
      staging,
    );
    expect(onServer).toMatchObject({
      siteUrl: 'https://support-dev.forcome.internal/',
      connectHost: '127.0.0.1',
    });
    const onInterface = readDeployEnv(
      VALID.replace('HTTPS_BIND=127.0.0.1', 'HTTPS_BIND=10.0.8.21'),
      staging,
    );
    expect(onInterface.connectHost).toBe('10.0.8.21');
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

  it('SITE_IP 可选：留空或一个 IP 地址都行，写成域名或带端口时报错', () => {
    expect(readDeployEnv(VALID.concat('SITE_IP=\n'), staging).problems).toEqual([]);
    expect(readDeployEnv(VALID.concat('SITE_IP=144.34.128.235\n'), staging).problems).toEqual([]);
    for (const wrong of ['support-dev.forcome.internal', '144.34.128.235:4510']) {
      expect(readDeployEnv(VALID.concat(`SITE_IP=${wrong}\n`), staging).problems).toEqual([
        'SITE_IP：只填一个 IP 地址（如 10.0.8.21），不带协议与端口；不按 IP 访问时留空',
      ]);
    }
  });
});

describe('备份密钥与生产环境（待办 28）', () => {
  it('两把备份密钥必填、不能是模板占位值，WAL-G 的密钥是 64 位十六进制', () => {
    const missing = readDeployEnv(
      VALID.replace(/WALG_LIBSODIUM_KEY=.*/, 'WALG_LIBSODIUM_KEY=change-me').replace(
        /RESTIC_PASSWORD=.*/,
        'RESTIC_PASSWORD=',
      ),
      staging,
    );
    expect(missing.problems).toEqual([
      'WALG_LIBSODIUM_KEY：必填，用 openssl rand -hex 32 生成（WAL-G 加密基础备份与 WAL）',
      'RESTIC_PASSWORD：必填，用 openssl rand -hex 24 生成（restic 加密逻辑备份与卷）',
    ]);
    const malformed = readDeployEnv(
      VALID.replace(/WALG_LIBSODIUM_KEY=.*/, 'WALG_LIBSODIUM_KEY=not-hex').replace(
        /RESTIC_PASSWORD=.*/,
        'RESTIC_PASSWORD=short',
      ),
      staging,
    );
    expect(malformed.problems).toEqual([
      'WALG_LIBSODIUM_KEY：必须是 64 位十六进制（openssl rand -hex 32 的输出）',
      'RESTIC_PASSWORD：至少 16 位',
    ]);
  });

  it('生产环境：备份目录必填且是绝对路径（NAS 的挂载目录）、不能开开发登录；开发测试环境不填用命名卷', () => {
    expect(readDeployEnv(PRODUCTION, production)).toMatchObject({
      backupDir: '/mnt/nas/forcome-support',
      siteUrl: 'https://support-dev.forcome.internal:4512/',
      problems: [],
    });
    const { problems } = readDeployEnv(
      PRODUCTION.replace('BACKUP_DIR=/mnt/nas/forcome-support', 'BACKUP_DIR=').replace(
        'DEV_LOGIN_ENABLED=false',
        'DEV_LOGIN_ENABLED=true',
      ),
      production,
    );
    expect(problems).toEqual([
      'BACKUP_DIR：生产环境必填，写 NAS 挂载到服务器上的目录（如 /mnt/nas/forcome-support）',
      'DEV_LOGIN_ENABLED：生产环境不能开启开发登录',
    ]);
    expect(
      readDeployEnv(PRODUCTION.replace('/mnt/nas/forcome-support', 'nas/forcome'), production)
        .problems,
    ).toEqual(['BACKUP_DIR：写服务器上的绝对路径（NAS 的挂载目录）']);
  });

  it('生产环境的环境文件在 Linux 上必须是 600；开发测试环境与 Windows 不看', () => {
    expect(envFilePermissionProblem(0o100600, 'linux', production)).toBeNull();
    expect(envFilePermissionProblem(0o100644, 'linux', production)).toBe(
      '环境文件的权限是 644，生产环境必须是 600（chmod 600 <环境文件>）',
    );
    expect(envFilePermissionProblem(0o100644, 'linux', staging)).toBeNull();
    expect(envFilePermissionProblem(0o100666, 'win32', production)).toBeNull();
  });

  it('两份模板的变量一一对应（生产模板按开发测试模板逐项填写，不漏项）', () => {
    const names = (file) => Object.keys(parseEnv(readFileSync(file, 'utf8'))).sort();
    expect(names('deploy/.env.production.example')).toEqual(names('deploy/.env.example'));
  });

  it('生产模板：APP_ENV 与端口按生产、开发登录关闭；填好口令与两把密钥后通过校验', () => {
    const text = readFileSync('deploy/.env.production.example', 'utf8')
      .replace(/^POSTGRES_PASSWORD=.*$/m, 'POSTGRES_PASSWORD=3f9a0c4e1b2d7a8c9e0f1a2b3c4d5e6f')
      .replace(/^WALG_LIBSODIUM_KEY=.*$/m, `WALG_LIBSODIUM_KEY=${'ab'.repeat(32)}`)
      .replace(/^RESTIC_PASSWORD=.*$/m, 'RESTIC_PASSWORD=5e1f0c2a9b8d7e6f5a4b3c2d1e0f9a8b');
    expect(readDeployEnv(text, production)).toMatchObject({
      vars: expect.objectContaining({ APP_ENV: 'production', DEV_LOGIN_ENABLED: 'false' }),
      httpsPort: 4512,
      pgPort: 4513,
      problems: [],
    });
  });
});

describe('第一次部署时从模板生成环境文件', () => {
  const secrets = {
    POSTGRES_PASSWORD: 'a1b2c3d4e5f6a7b8c9d0',
    WALG_LIBSODIUM_KEY: 'ab'.repeat(32),
    RESTIC_PASSWORD: 'c3d4e5f6a7b8c9d0e1f2',
    CREDENTIAL_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
  };

  it('只把口令、两把备份密钥与主密钥换成随机值，其余行（含注释与空行）原样保留', () => {
    const example =
      '# 说明\nAPP_ENV=staging\n\nPOSTGRES_PASSWORD=change-me\nPOSTGRES_DB=forcome\nWALG_LIBSODIUM_KEY=change-me\nRESTIC_PASSWORD=change-me\nCREDENTIAL_MASTER_KEY=\n';
    expect(createEnvFile(example, secrets)).toBe(
      `# 说明\nAPP_ENV=staging\n\nPOSTGRES_PASSWORD=a1b2c3d4e5f6a7b8c9d0\nPOSTGRES_DB=forcome\nWALG_LIBSODIUM_KEY=${'ab'.repeat(32)}\nRESTIC_PASSWORD=c3d4e5f6a7b8c9d0e1f2\nCREDENTIAL_MASTER_KEY=${secrets.CREDENTIAL_MASTER_KEY}\n`,
    );
  });

  it('生成的随机值：主密钥是 32 字节的 base64（应用的 CREDENTIAL_MASTER_KEY 要这个写法），WAL-G 密钥 32 字节十六进制', () => {
    const key = generatedSecret('CREDENTIAL_MASTER_KEY');
    expect(key).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(Buffer.from(key, 'base64')).toHaveLength(32);
    expect(generatedSecret('WALG_LIBSODIUM_KEY')).toMatch(/^[0-9a-f]{64}$/);
    expect(generatedSecret('POSTGRES_PASSWORD')).toMatch(/^[0-9a-f]{48}$/);
  });

  it('模板里缺了要生成的一行时报错，而不是生成一份不能用的文件', () => {
    expect(() => createEnvFile('APP_ENV=staging\nPOSTGRES_PASSWORD=change-me\n', secrets)).toThrow(
      /WALG_LIBSODIUM_KEY/,
    );
  });

  it('开发测试环境的模板能直接生成（各项都有占位行）', () => {
    const text = createEnvFile(readFileSync('deploy/.env.example', 'utf8'), secrets);
    expect(readDeployEnv(text, staging).problems).toEqual([]);
  });
});
