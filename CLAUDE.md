## 语言

- 与用户沟通、代码注释、提交信息、文档一律使用中文。
- 技术术语、代码标识符、文件路径保持原文。
- 技能按字面识别的关键字保持英文：分诊标签（如 `needs-triage`）、待办文件中的 `Status:` / `Type:` / `Blocked by:` 行、`## Comments` 与 `## Answer` 标题。

## Agent skills

### 问题跟踪（Issue tracker）

待办以本地 Markdown 文件存放在 `.scratch/<功能名>/`（仓库没有远程地址）。见 `docs/agents/issue-tracker.md`。

### 分诊标签（Triage labels）

使用默认的 5 个标签：needs-triage、needs-info、ready-for-agent、ready-for-human、wontfix。见 `docs/agents/triage-labels.md`。

### 领域文档（Domain docs）

单一上下文：仓库根目录一个 `CONTEXT.md`，决策记录放 `docs/adr/`。见 `docs/agents/domain.md`。