import { describe, expect, it } from 'vitest';
import { ENVIRONMENTS } from './environments.mjs';
import { formatReport, summarizePlaywright } from './report.mjs';

const base = {
  environment: ENVIRONMENTS.staging,
  release: '0a1b2c3d4e5f',
  url: 'https://support-dev.forcome.internal:4510/',
  rootCertFingerprint: '3A:7F:00:11',
};

describe('部署报告（脚本输出，上 GitHub 后写入作业摘要）', () => {
  it('全部步骤通过时写明成功、版本、地址、根证书指纹与冒烟结果', () => {
    const report = formatReport({
      ...base,
      steps: [
        { name: '构建镜像', status: 'passed', seconds: 42.31 },
        { name: '冒烟（Playwright）', status: 'passed', seconds: 18 },
      ],
      smoke: { passed: 2, failed: 0, flaky: 0, skipped: 0 },
    });
    expect(report).toContain('## 部署到开发测试环境（staging）：成功');
    expect(report).toContain('- 版本：`0a1b2c3d4e5f`');
    expect(report).toContain('- 地址：https://support-dev.forcome.internal:4510/');
    expect(report).toContain('- Compose 项目：forcome-staging');
    expect(report).toContain('- 根证书 SHA-256：3A:7F:00:11');
    expect(report).toContain('| 构建镜像 | ✅ 通过 | 42.3 秒 |');
    expect(report).toContain('冒烟：2 项通过，0 项失败，0 项不稳定，0 项跳过');
  });

  it('某步失败时整体为失败，写出原因，之后的步骤标为未执行', () => {
    const report = formatReport({
      ...base,
      rootCertFingerprint: null,
      steps: [
        { name: '构建镜像', status: 'passed', seconds: 40 },
        { name: '执行迁移', status: 'failed', seconds: 1.2, detail: '退出码 1' },
        { name: '启动服务', status: 'skipped' },
      ],
      smoke: null,
    });
    expect(report).toContain('## 部署到开发测试环境（staging）：失败');
    expect(report).toContain('| 执行迁移 | ❌ 失败：退出码 1 | 1.2 秒 |');
    expect(report).toContain('| 启动服务 | ⏭ 未执行 | — |');
    expect(report).toContain('- 根证书 SHA-256：（未取到）');
    expect(report).not.toContain('冒烟：');
  });
});

describe('Playwright 结果汇总', () => {
  it('从 JSON 报告的统计里取通过、失败、不稳定与跳过的数量', () => {
    expect(
      summarizePlaywright({ stats: { expected: 2, unexpected: 1, flaky: 1, skipped: 3 } }),
    ).toEqual({ passed: 2, failed: 1, flaky: 1, skipped: 3 });
  });
});
