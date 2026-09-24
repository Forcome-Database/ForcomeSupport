# 问题跟踪：本地 Markdown

本仓库的待办与规格以 Markdown 文件存放在 `.scratch/` 下。

## 约定

- 一个功能一个目录：`.scratch/<功能名>/`
- 规格文件为 `.scratch/<功能名>/spec.md`
- 实现待办一张一个文件：`.scratch/<功能名>/issues/<NN>-<名称>.md`，从 `01` 开始编号，不要把多张待办合进一个文件
- 分诊状态写在文件开头附近的 `Status:` 行（取值见 `triage-labels.md`）
- 讨论与记录追加在文件末尾的 `## Comments` 标题下

## 技能要求「发布到问题跟踪」时

在 `.scratch/<功能名>/` 下新建文件（目录不存在就先创建）。

## 技能要求「读取相关待办」时

读取所引用路径的文件。用户通常会直接给出路径或待办编号。

## 探路（Wayfinding）操作

供 `/wayfinder` 使用。**总览**是一个文件，每张待办对应一个**子文件**。

- **总览**：`.scratch/<工作名>/map.md`（包含 Notes / Decisions-so-far / Fog 三部分）。
- **子待办**：`.scratch/<工作名>/issues/NN-<名称>.md`，从 `01` 开始编号，正文写问题本身。`Type:` 行记录类型（`research` / `prototype` / `grilling` / `task`）；`Status:` 行记录 `claimed` / `resolved`。
- **阻塞**：文件开头附近写 `Blocked by: NN, NN`。所列文件全部为 `resolved` 时，该待办解除阻塞。
- **可做的待办**：扫描 `.scratch/<工作名>/issues/`，找出未关闭、未阻塞、未认领的文件，编号最小的优先。
- **认领**：开始工作前先把 `Status:` 改为 `claimed` 并保存。
- **完成**：在 `## Answer` 标题下写出结论，把 `Status:` 改为 `resolved`，再在 `map.md` 的 Decisions-so-far 里追加一条指引（要点 + 链接）。