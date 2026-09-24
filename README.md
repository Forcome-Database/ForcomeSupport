# Forcome Support 智能客服 · 产品设计

亚马逊 + Shopify（北美三站）智能客服系统的 PRD、高保真原型与设计画布。原型是静态页面，全部由 `design/spec` 下的 Python 脚本从同一份示例数据和组件库生成。

## 目录

```
design/
├── *.dc.html                        画板（生成物，不要手改；5 张流程图例外，见下）
├── canvas.json                      画布布局（build_canvas.py 生成）
├── forcome-support-blueprint.html   设计画布（全部画板打包，已发布）
├── forcome-blueprint-guide.html     PRD（build_prd.py 生成，已发布）
├── forcome-agent-decision-scheme.html  决策记录（手工维护，已发布）
└── spec/
    ├── prd_a.md … prd_d.md          PRD 源文（0–3 节 / 4–7 节 / 8、8A 节 / 9–16 节）
    ├── data.py                      示例数据，原型的唯一数据来源
    ├── ui.py                        组件库与设计令牌（对应 shadcn/ui + Tailwind v4）
    ├── pages/                       页面与状态板生成脚本（build_*.py）
    ├── build_ds.py                  设计规范 + 全局状态
    ├── build_map.py                 页面地图
    ├── build_prd.py                 PRD 合成
    ├── build_canvas.py              画布打包
    ├── check.py                     渲染检查（溢出、裁切）与截图
    ├── shot_doc.py                  截取文档局部（临时排查用）
    ├── shots/                       各画板截图（check.py --shots 输出）
    ├── WORKPLAN.md                  工作记录与发布版本
    └── archive/                     已完成的任务书
```

### 画板清单

| 分组 | 画板 |
|---|---|
| 高保真页面 P01–P24 | Main、TicketEmail、TicketEscalated、Tickets、TicketDetail、Customer、AfterSalesList、AfterSalesConfirm、AfterSalesTicket、AfterSalesInStock、AfterSalesRefund、AfterSalesNegotiation、AfterSalesLog、AfterSalesSettlement、Actions、KnowledgeBase、Reports、Settings、SettingsRules、SettingsTeam、FactoryPortal、SettingsActions、SettingsAfterSales、SettingsFactory |
| 状态板 | StatesInbox、StatesApproval、StatesAfterSales、StatesFactory、StatesAdmin |
| 规范 | DesignSystem、GlobalStates、PageMap |
| 流程图（手工维护） | Architecture、LifeCycle、AfterSales、DecisionTree、EmailFlow |
| 早期视觉方向（存档） | DirectionA、DirectionB、DirectionC |

页面编号、状态编号（G/I/A/S/F/K）、规则编号（R-xx）、验收编号（AC-xx）在 PRD、画板与画布中一致。

## 修改与重建

改内容时改源（`prd_*.md`、`data.py`、`ui.py`、`pages/*.py`），再重新生成；不要直接改生成的 `.dc.html`。流程图与决策记录没有生成脚本，直接改 HTML。

在 `design/spec` 目录下：

```powershell
# 1 重新生成画板（按需运行对应脚本，或全部运行）
Get-ChildItem pages/build_*.py -Name | % { python "pages/$_" }
python build_ds.py
python build_map.py

# 2 检查溢出与裁切，并更新截图
$f = Get-ChildItem ../*.dc.html -Name | ? { $_ -notmatch '^Direction' }
python check.py --shots @f

# 3 合成 PRD
python build_prd.py

# 4 打包画布（量高度、写 canvas.json、生成 forcome-support-blueprint.html）
python build_canvas.py --seed
```

依赖：Python 3.11、`playwright`（使用本机 Chrome）。`build_canvas.py --seed` 还依赖 Claude Code 的 design 技能脚本 `seed-canvas.mjs`，路径写在脚本的 `SKILL` 常量里，技能版本更新后需要同步改这个路径。

## 约定

- 文件编码 UTF-8 无 BOM，换行 CRLF。
- 所有原型数据从 `data.py` 取，页面脚本里不写死业务数字。
- 固定尺寸页面为 1440 × 900，`check.py` 报溢出或裁切必须修到 OK。
- 已发布页面（画布、PRD、决策记录）的链接与当前版本记在 `spec/WORKPLAN.md`。
