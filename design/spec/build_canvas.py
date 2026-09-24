# -*- coding: utf-8 -*-
"""量出各画板实际高度，生成 canvas.json，并用 design 技能的脚本生成画布文件。
用法：python build_canvas.py            只写 canvas.json
      python build_canvas.py --seed     同时生成 forcome-support-blueprint.html 并校验
"""
import io, os, sys, json, subprocess
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
DESIGN = os.path.dirname(HERE)
SKILL = r"C:\Users\leo\AppData\Local\Temp\claude\bundled-skills\2.1.272\c25a204f042305e59a06048af0627cb0\design"

PAGES = [
    {'id': 'page-0', 'name': '设计规范'},
    {'id': 'page-2', 'name': '高保真页面'},
    {'id': 'page-6', 'name': '状态与异常'},
    {'id': 'page-1', 'name': '流程与架构'},
    {'id': 'page-4', 'name': '邮件流转全链路'},
    {'id': 'page-3', 'name': '早期视觉方向（已由 v3 取代）'},
]
GAP_X, GAP_Y = 120, 160
ROWS_HIFI = [
    ('收件箱与工单', [('Main', 'P01 收件箱 · 亚马逊工单'), ('TicketEmail', 'P02 收件箱 · 邮件工单'), ('TicketEscalated', 'P03 收件箱 · 转人工工单'),
                   ('Tickets', 'P04 工单列表'), ('TicketDetail', 'P05 工单详情 · 全程记录'), ('Customer', 'P06 客户档案')]),
    ('售后', [('AfterSalesList', 'P07 售后单列表'), ('AfterSalesConfirm', 'P08 确认责任与处理方式'), ('AfterSalesTicket', 'P09 售后单详情 · 易仓无货'),
            ('AfterSalesInStock', 'P10 售后单详情 · 易仓有货'), ('AfterSalesRefund', 'P11 售后单详情 · 部分补偿'), ('AfterSalesNegotiation', 'P12 承担比例协商'),
            ('AfterSalesLog', 'P13 登记台账'), ('AfterSalesSettlement', 'P14 内部结算')]),
    ('审批、知识库、报表、设置、工厂工作台', [('Actions', 'P15 审批'), ('KnowledgeBase', 'P16 知识库'), ('Reports', 'P17 报表'), ('Settings', 'P18 设置 · 渠道与店铺'),
                                ('SettingsActions', 'P22 设置 · 动作映射'), ('SettingsRules', 'P19 设置 · 处理规则'), ('SettingsAfterSales', 'P23 设置 · 售后规则'),
                                ('SettingsTeam', 'P20 设置 · 团队与权限'), ('SettingsFactory', 'P24 设置 · 工厂账号'), ('FactoryPortal', 'P21 工厂工作台')]),
]
STATES = [('StatesInbox', '状态板 · 收件箱与工单'), ('StatesApproval', '状态板 · 审批'), ('StatesAfterSales', '状态板 · 售后'),
          ('StatesFactory', '状态板 · 工厂工作台'), ('StatesAdmin', '状态板 · 知识库、报表、设置')]
SPEC = [('DesignSystem', '设计规范'), ('GlobalStates', '全局状态与反馈'), ('PageMap', '页面地图')]
FLOWS = [('Architecture', '系统架构'), ('LifeCycle', '产品全生命周期'), ('AfterSales', '售后流程'), ('DecisionTree', 'AI Agent 决策逻辑')]
DIRS = [('DirectionA', '方向 A · 精密工作台（v2，已由 v3 取代）'), ('DirectionB', '方向 B · 暖色编辑'), ('DirectionC', '方向 C · 深色控制台')]

JS = "() => { const r = (document.querySelector('x-dc > div') || document.body.firstElementChild).getBoundingClientRect(); return [Math.ceil(r.width), Math.ceil(r.height)]; }"


def measure(names):
    out = {}
    with sync_playwright() as p:
        b = p.chromium.launch(channel='chrome')
        pg = b.new_page(viewport={'width': 1960, 'height': 1200})
        for n in names:
            html = io.open(os.path.join(DESIGN, n + '.dc.html'), encoding='utf-8').read().replace('<script src="./support.js"></script>', '')
            html = html.replace('<x-dc>', '<x-dc style="display:block">').replace('<helmet>', '<helmet style="display:none">', 1)
            pg.set_content(html, wait_until='networkidle', timeout=30000)
            pg.wait_for_timeout(200)
            out[n] = pg.evaluate(JS)
        b.close()
    return out


def main(seed=False):
    names = [n for _, row in ROWS_HIFI for n, _ in row] + [n for n, _ in STATES + SPEC + FLOWS + DIRS] + ['EmailFlow']
    missing = [n for n in names if not os.path.exists(os.path.join(DESIGN, n + '.dc.html'))]
    if missing:
        print('缺少画板：', missing)
        sys.exit(1)
    size = measure(names)
    arts, notes = [], []

    def add(n, x, y, title, page):
        w, h = size[n]
        arts.append({'file': n + '.dc.html', 'x': x, 'y': y, 'w': w, 'h': h + 8, 'title': title, 'page': page})
        return w, h

    # 设计规范
    x = 0
    for n, t in SPEC:
        w, _ = add(n, x, 0, t, 'page-0')
        x += w + GAP_X
    notes.append({'id': 'note-ds', 'x': x, 'y': 0, 'w': 360, 'page': 'page-0', 'text': '怎么用这一页\n\n设计规范：色彩、字体、间距、组件、状态标识、文案规则。全部高保真页面只用这里的组件，研发实现以组件库 spec/ui.py 为准；与 shadcn/ui + Tailwind CSS v4 的令牌和组件对照见第 12 节。\n\n全局状态：加载、无权限、找不到、断网、集成中断、浮层提示、二次确认、并发、未保存离开、密度切换（G1–G9）。每个页面都适用。\n\n页面地图：24 个页面的跳转关系与 7 条关键用户路径，编号与 PRD 第 4、8 节一致。'})

    # 高保真页面
    y = 0
    for label, row in ROWS_HIFI:
        notes.append({'id': 'note-row-%d' % len(notes), 'x': -420, 'y': y, 'w': 340, 'page': 'page-2', 'text': label + '\n\n' + '\n'.join(t for _, t in row) + '\n\n演示时刻 2026-09-11 周五 10:20，数据来自 spec/data.py；每页的布局、操作、校验、状态见 PRD 第 8 节同编号小节。'})
        x, hmax = 0, 0
        for n, t in row:
            w, h = add(n, x, y, t, 'page-2')
            x += w + GAP_X
            hmax = max(hmax, h)
        y += hmax + GAP_Y

    # 状态板
    x = 0
    for n, t in STATES:
        w, _ = add(n, x, 0, t, 'page-6')
        x += w + GAP_X
    notes.append({'id': 'note-states', 'x': 0, 'y': -260, 'w': 720, 'page': 'page-6', 'text': '状态与异常\n\n每个变体都有编号（I、A、S、F、K），与 PRD 第 8A 节表格一一对应，并写明触发条件与规格。全局状态（G1–G9）在「设计规范」页。测试用例按编号覆盖。'})

    # 流程与架构（纵向）
    y = 0
    for n, t in FLOWS:
        w, h = add(n, 0, y, t, 'page-1')
        y += h + GAP_Y
    notes.append({'id': 'note-flows', 'x': 1560, 'y': 0, 'w': 340, 'page': 'page-1', 'text': '流程与架构\n\n这些是给业务与技术评审看的全景图，规则的唯一定义在 PRD 第 5 至 7 节：\n\n· 系统架构：官方接入（买家消息经亚马逊邮件中转与 Gmail；订单、物流、库存与易仓出库单经积加；退款、改地址、取消经 SP-API 与 Shopify Admin API）、五步处理、统一动作接口、数据、工作台。\n· 产品全生命周期：七个阶段的客户触点、系统动作、人工介入、数据沉淀，下方是工单状态机。\n· 售后流程：两条创建路径、三种处理方式、报备、并行的比例协商。\n· AI Agent 决策逻辑：五步处理、风险信号、12 条处理规则、发送方式与动作分级。'})

    # 邮件流转
    w, h = add('EmailFlow', 0, 0, '一封来信的完整流转', 'page-4')
    notes.append({'id': 'note-emailflow', 'x': w + GAP_X, 'y': 0, 'w': 340, 'page': 'page-4', 'text': '读法\n\n从左上角两个来源开始，沿箭头向右、向下读；每个判断的「是」分支在上。\n\n上部：所有来信共同经过的第 1、2 步，含店铺识别与按「店铺 + 订单」归并。中部：第 3 步按意图分泳道。下部：第 4、5 步（提交审批、批准后自动发出）、发出之后的状态流转、售后子流程。\n\n「回复发出」是事件不是状态；规则定义以 PRD 第 5 至 7 节为准。'})

    # 视觉方向
    x = 0
    for n, t in DIRS:
        w, h = add(n, x, 0, t, 'page-3')
        x += w + GAP_X
    notes.append({'id': 'note-directions', 'x': 0, 'y': 1020, 'w': 1440, 'page': 'page-3', 'text': '当前视觉为 v3（决策 22、PRD D-10）：按客户提供的参考稿 forcome-support-console.html 升级——56px 顶栏 + 分段导航、浅灰底浮动面板、靛蓝主色、AI 用靛蓝→青色渐变标识；研发用 shadcn/ui + Tailwind CSS v4，对照表见设计规范第 12 节。\n\n本页 A、B、C 为 09-21 的早期探索，仅作历史对比，不再作为实现依据。'})

    canvas = {'pages': PAGES, 'artboards': arts, 'annotations': notes, 'launch': {'view': 'canvas', 'page': 'page-2'}}
    io.open(os.path.join(DESIGN, 'canvas.json'), 'w', encoding='utf-8').write(json.dumps(canvas, ensure_ascii=False, indent=2))
    print('canvas.json: %d artboards, %d notes' % (len(arts), len(notes)))

    if seed:
        cmd = ['node', os.path.join(SKILL, 'seed-canvas.mjs'), '--template', os.path.join(SKILL, 'payload.template.html'),
               '--out', 'forcome-support-blueprint.html', '--title', 'Forcome Support 智能客服蓝图']
        for a in arts:
            cmd += ['--artboard', a['file']]
        cmd += ['--canvas', 'canvas.json']
        r = subprocess.run(cmd, cwd=DESIGN, capture_output=True, text=True, encoding='utf-8')
        print((r.stdout or '')[:200], (r.stderr or '')[:600])
        r = subprocess.run(['node', os.path.join(SKILL, 'seed-canvas.mjs'), '--check', 'forcome-support-blueprint.html'], cwd=DESIGN, capture_output=True, text=True, encoding='utf-8')
        print((r.stdout or '')[:160], (r.stderr or '')[:400])


if __name__ == '__main__':
    main('--seed' in sys.argv)
