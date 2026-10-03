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

## 实现依据

- **冲突时**：
  - 业务规则与各期范围以 PRD 为准：10.1 能力矩阵的「阶段」列、各页「第一阶段」「第二阶段」小节、11.4 的「阶段」列决定本期做不做。本期规格（`.scratch/<功能名>/spec.md`）只定实现方式，与 PRD 不一致时以 PRD 为准，并回写规格。
  - 界面以原型为准；本期形态看 PRD 该页的阶段小节与对应状态板（对照见 `docs/agents/prototype.md`）。
  - 技术以 `docs/adr/` 与本期规格的实现契约为准；`docs/技术方案.md` 11.1 已被各期规格取代，只作追溯。
  - 业务类冲突问用户；技术类自己定，并写回文档。
- **每期开工前**（完整设计一套、分期交付，决策 31）：
  1. 对照上一期的实现结果与真实环境验收矩阵，补全本期规格（`/to-spec`；第二期已写到实现契约层，第三期只有概要）并拆待办；
  2. 做一次 PRD、原型、规格、待办四方对照，修掉漂移再开工；
  3. 刷新原型截图，把 `docs/agents/prototype.md` 里标「当期」的内容换成本期。
- **界面**：页面编号与原型截图的对照见 `docs/agents/prototype.md`。
  - 有原型的页面照着做。
  - 没有原型的部分，用设计规范板、全局状态板和已做好页面的组件来拼，不自创样式。
  - 原型是参考，不是像素规范。本期裁剪、真实数据或交互需要时可以偏离，在待办 Comments 里写一句为什么。
  - 做完截一张图存到 `.scratch/<功能名>/shots/`，路径写进待办 Comments。
- **先用现成的**（不重复造轮子）：写代码前先找能直接用的，依次看：
  1. 仓库已装的依赖（各 `package.json`）；
  2. 平台或服务的官方 SDK；
  3. 维护活跃的成熟第三方库。
  - 找到就用，自己写的只补它们覆盖不到的部分。决定自己写时，在待办 Comments 里写一句为什么不用现成的。
- **技术决策**：
  - `/code-review` 的规范一轴，要把与改动相关的 ADR 纳入比对。
  - 实现中新定的、以后要遵守的技术决策，以「修订」写回相关 ADR，或新开 ADR，不能只留在待办 Comments 里。
