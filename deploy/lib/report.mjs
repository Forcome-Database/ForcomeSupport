// 部署报告：部署脚本在终端输出、写进 deploy/.state/<环境>/report.md，
// 仓库上 GitHub 后同一份内容写入 Actions 的作业摘要（GITHUB_STEP_SUMMARY）。

/**
 * @typedef {object} StepResult
 * @property {string} name
 * @property {'passed' | 'failed' | 'skipped'} status skipped 表示前面有步骤失败，本步没有执行
 * @property {number} [seconds]
 * @property {string} [detail] 失败原因
 */

/** @typedef {{ passed: number, failed: number, flaky: number, skipped: number }} SmokeSummary */

function cell(step) {
  if (step.status === 'passed') return '✅ 通过';
  if (step.status === 'skipped') return '⏭ 未执行';
  return step.detail ? `❌ 失败：${step.detail}` : '❌ 失败';
}

function duration(step) {
  return step.seconds === undefined ? '—' : `${step.seconds.toFixed(1)} 秒`;
}

/**
 * @param {{
 *   environment: string, title: string, project: string, release: string, url: string,
 *   rootCertFingerprint: string | null, steps: StepResult[], smoke: SmokeSummary | null,
 * }} result
 */
export function formatReport(result) {
  const succeeded = result.steps.every((step) => step.status === 'passed');
  const lines = [
    `## 部署到${result.title}（${result.environment}）：${succeeded ? '成功' : '失败'}`,
    '',
    `- 版本：\`${result.release}\``,
    `- 地址：${result.url}`,
    `- Compose 项目：${result.project}`,
    `- 根证书 SHA-256：${result.rootCertFingerprint ?? '（未取到）'}`,
    '',
    '| 步骤 | 结果 | 用时 |',
    '|---|---|---|',
    ...result.steps.map((step) => `| ${step.name} | ${cell(step)} | ${duration(step)} |`),
  ];
  if (result.smoke) {
    const { passed, failed, flaky, skipped } = result.smoke;
    lines.push(
      '',
      `冒烟：${passed} 项通过，${failed} 项失败，${flaky} 项不稳定，${skipped} 项跳过`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Playwright JSON 报告（--reporter=json）的统计：expected 通过、unexpected 失败、flaky 重试后通过。
 * @returns {SmokeSummary}
 */
export function summarizePlaywright(report) {
  const { expected, unexpected, flaky, skipped } = report.stats;
  return { passed: expected, failed: unexpected, flaky, skipped };
}
