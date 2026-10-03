# 领域文档

工程类技能在探索本仓库时，如何读取领域文档。

## 本仓库

业务术语以 `design/spec/prd_a.md` 第 1.4 节「术语表」为准，`CONTEXT.md` 只收项目级术语（技术与组织）。页面、规则、状态、验收沿用 PRD 编号（Pxx、R-xx、G/I/A/S/F/K、AC-xx）。

## 探索前先读

- 仓库根目录的 **`CONTEXT.md`**；或
- 根目录存在 **`CONTEXT-MAP.md`** 时读它：它指向每个上下文各自的 `CONTEXT.md`，读与当前主题相关的那些。
- **`docs/adr/`**：读与即将改动的区域相关的决策记录。多上下文仓库还要看 `src/<上下文>/docs/adr/` 下的局部决策。

以上文件不存在时**直接继续，不必提示**：不要指出缺失，也不要建议预先创建。`/domain-modeling` 技能（经 `/grill-with-docs` 与 `/improve-codebase-architecture` 进入）会在术语或决策真正定下来时再创建它们。

## 目录结构

单一上下文（本仓库）：

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-xxx.md
│   └── 0002-xxx.md
└── design/
```

多上下文（根目录存在 `CONTEXT-MAP.md`）：

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← 全局决策
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← 该上下文的决策
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## 使用术语表中的词

输出中出现领域概念时（待办标题、重构方案、假设、测试名），使用 `CONTEXT.md`（或上文所述 PRD 术语表）里定义的叫法，不要换用术语表明确避免的同义词。

需要的概念不在术语表里，说明两种情况之一：要么是在发明项目不用的说法（应重新考虑），要么是真实的缺口（记下来交给 `/domain-modeling`）。

## 与决策记录冲突时要指出

输出与已有 ADR 相矛盾时，要明确指出，不要悄悄覆盖：

> _与 ADR-00XX（示例：订单事件溯源）相矛盾，但值得重新讨论，因为……_