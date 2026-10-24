# 第二期（第二、三阶段合并交付）探路地图

Type: map

## Destination

第二期规格写到实现契约层并定稿：以 `.scratch/phase2-delivery/spec.md`（原第二期，已到契约层）与 `.scratch/phase3-ai-reply/spec.md`（原第三期概要）为基础合成一份；PRD、原型、规格三方一致；之后可以直接 `/to-spec` 收口、`/to-tickets` 拆待办。

## Notes

- **背景**：PRD v2.39 / D-30（用户 2026-10-24）把第二、三期合并为一次交付，交付形态即原型画的完整版。术语见 `CONTEXT.md`「分期」：「期」= 交付批次，「阶段」= PRD 的能力标记；第二期交付第二、三阶段的全部能力。
- **定下的范围口径（开图时，用户 2026-10-24）**：同一版本一起开发、一起验收、一起上线；上线后 AI 按意图与门槛逐步放开（仍属同一期），售后与审批上线即全量；**不做与海帆的并行运行**（PRD 第 14 节相应改写，归「切换与上线放量」）。
- **依据的优先级**（`CLAUDE.md`「实现依据」）：业务以 PRD 为准（`design/spec/prd_a.md`–`prd_d.md`），界面严格按原型（`design/*.dc.html`，源在 `design/spec/`），技术以 ADR 与规格为准；业务类冲突问用户，技术类自己定并写回文档或 ADR。
- **每张票要调用的技能**：grilling 票调用 `grilling` 与 `domain-modeling`（逐条给建议，用户回「按建议」或改口；术语变化写进 `CONTEXT.md`）；research 票由子代理调用 `research`；task 票能自己做的自己做，要用户提供的给出清单。
- **输入材料**：`assets/` 下三份四方对照报告（2026-10-24，按第二阶段形态做的，合并后其中「第二阶段参照页」部分作废，漂移与缺口仍有效）；第二期规格 Comments 与三期概要。
- **原型与 PRD 的改法**：改源（`design/spec/prd_*.md`、`data.py`、`ui.py`、`pages/*.py`），再在 `design/spec` 下重新生成画板、`python check.py --shots …`、`python build_prd.py`；本机 Python 为 uv 管理的 3.12（已装 markdown、playwright、pillow）。PRD 文件索引里是 CRLF，暂存用 `git -c core.autocrlf=false add`；新建文档用 CRLF（README「约定」）。
- **提交**：`git -c user.name=leo.xia -c user.email=leo.xia@forcome.com`，中文提交信息，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`；未经用户同意不 push（research 分支除外，见 wayfinder）。

## Decisions so far

<!-- 每张关闭的票一行：[票名](issues/NN-….md)：一句话结论 -->

## Not yet specified

- **AI 回信的设计决策**（原第三期，等「AI 部分四方对照」出缺口清单、「历史工单样本（Q-08）」到位后再拆票）：意图清单与各意图流程（结构化部分与处理说明）；风险信号与关键词；知识库四层的结构、初始内容与维护人；自动发送的白名单意图、置信度与放开条件；评测与 `judge` 对齐（谁来人工评分）；上下文 7 段与检索；疑似提示注入等硬规则。
- **原第三期「第二期运行数据」的替代**：三期概要原本用第二期跑出来的坐席回复、审批与售后记录作意图流程与草稿的对照样本，合并后没有这批数据，从哪来、缺了怎么办。
- **AI 部分的原型与 PRD 补齐**：等 AI 的决策定完再开 task 票。
- **两份规格合成一份的结构**：终点交给 `/to-spec`，届时再定目录与章节；是否要单独的切换演练票，等「切换与上线放量」定完再看。

## Out of scope

- 写代码：地图只做决策，实现交给之后的 `/to-tickets` 与 `/implement-spec`。
- 外部资质的办理（积加、SP-API、Shopify 权限、17TRACK、Gmail 发信、钉钉内免登等）：由第一期待办 32 跟踪，地图只记它们对设计的影响。
- 易仓直连适配器（F-MC-01，PRD 未排期）。
- 第一期遗留：待办 29 真实环境验收、待办 28 生产部署审批，各自照旧推进。
- 与海帆的并行运行（用户 2026-10-24 决定不做）。
