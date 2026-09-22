# -*- coding: utf-8 -*-
"""收件箱三栏共用部件（P01–P03 与 StatesInbox 共用）。
只用 ui.py 组件与 T 色板组合；本文件新增的组合部件在报告里列出，便于并入组件库。
"""
import sys, os, re
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ui import *
from data import *

TK = {t['no']: t for t in TICKETS}

# 左栏「全部」分段的行顺序（prd_c P01：按 SLA 剩余升序，无 SLA 的按到达时间）
QUEUE_ORDER = ['T-20260902-0071', 'T-20260910-0176', 'T-20260910-0192', 'T-20260910-0195', 'T-20260911-0031',
               'T-20260910-0170', 'T-20260911-0035', 'T-20260910-0201', 'T-20260910-0188', 'T-20260909-0142',
               'T-20260909-0128']
SEGMENTS = ['待审草稿', '转人工', '待审批', '等待中', '全部']
SEG_OF = {'待审草稿': '待审草稿', '转人工': '转人工', '待审批': '待审批', '等客户': '等待中', '等内部': '等待中', '等外部': '等待中'}

# 客户来信正文（data.py 未收录，按 prd_c 补充）
MSG_IN = {
    'sarah_en': ("Hi, I ordered the car vacuum on Sep 3 and tracking hasn't updated since Sep 5. It was due yesterday. "
                 "Is the package lost? I need it before my road trip next Tuesday. Order 113-4567890-1234567."),
    'sarah_zh': '你好，我 9 月 3 日买了车载吸尘器，物流从 9 月 5 日起就没更新，本应昨天送到。包裹丢了吗？下周二自驾出行前我一定要用上。订单 113-4567890-1234567。',
    'olivia_en': ("Hi, my V2 worked great at first, but after a few weeks the suction got really weak. I empty the dust cup after "
                  "every use. Is something broken? Order #1063."),
}


# ---------------------------------------------------------------- 左栏 · 工单队列
def queue_seg(active='全部', counts=None):
    """队列分段：数字在上、名称在下的五等分胶囊分段（浅灰轨道，选中白底）。"""
    counts = QUEUE_COUNTS if counts is None else counts
    cells = ''
    for name in SEGMENTS:
        on = name == active
        n = counts.get(name, 0)
        nc = T['bad'] if (name == '转人工' and n) else (T['accent_ink'] if on else T['ink'])
        cells += ('<div style="display: flex; flex-direction: column; align-items: center; padding: 3px 0px; border-radius: 8px; background: %s; border: 1px solid %s;%s">'
                  '<div style="font-size: 13px; font-weight: 650; color: %s; line-height: 18px; font-variant-numeric: tabular-nums;">%s</div>'
                  '<div style="font-size: 11px; font-weight: %d; color: %s; line-height: 15px; white-space: nowrap;">%s</div></div>') % (
            '#ffffff' if on else 'transparent', T['line'] if on else 'transparent', ' box-shadow: %s;' % SHADOW_XS if on else '', nc, n, 650 if on else 500,
            T['accent_ink'] if on else T['ink3'], name)
    return '<div style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 2px; background: %s; border-radius: 10px; padding: 3px;">%s</div>' % (T['track'], cells)


def queue_row(t, selected=False, sla_html=None, highlight=None, dense=False):
    """队列卡片：渠道徽标 + 客户名 + SLA / 主题 / 情绪点 · 意图 · 状态。选中为浅靛蓝渐变底 + 左侧靛蓝条；转人工为红条。"""
    bar_c = T['accent'] if selected else (T['bad_solid'] if (t['status'] == '转人工' or highlight == 'danger') else None)
    bar = '<div style="position: absolute; left: 0px; top: 10px; bottom: 10px; width: 3px; border-radius: 0px 3px 3px 0px; background: %s;"></div>' % bar_c if bar_c else ''
    bg = 'linear-gradient(96deg, %s, rgba(6,182,212,0.05))' % T['accent_bg'] if selected else '#ffffff'
    bd = T['accent_line'] if selected else 'transparent'
    k = 0.5 if dense else 0  # 紧凑密度：字号小 0.5，行内边距 9 → 6，行距 4 → 2
    s_ = sla_html if sla_html is not None else sla(t['sla_left'], t['sla_level'], 11 - k)
    line1 = between('<div style="display: flex; align-items: center; gap: 7px; min-width: 0px;">%s%s</div>' % (
        channel(t['channel'], t['site'], None, 11 - k), ellipsis(t['customer'], 12.9 - k, T['ink'], 650 if selected else 600)), s_)
    line2 = ellipsis(t['subject'], 12.5 - k, T['ink'] if selected else T['ink2'], 550 if selected else 400)
    right = nowrap('内部目标', 10.5 - k, T['ink4']) if t.get('sla_kind') else ''
    line3 = between(row(sentiment(t['sentiment'], False) + nowrap(t['intent'], 11.5 - k, T['ink3']) + state(t['status'], 10.5 - k), 6), right)
    return '<div style="position: relative; padding: %s; border-radius: %dpx; border: 1px solid %s; background: %s; display: flex; flex-direction: column; gap: %dpx;">%s%s%s%s</div>' % (
        '6px 10px 6px 11px' if dense else '9px 11px 9px 12px', 11 if dense else 13, bd, bg, 2 if dense else 4, bar, line1, line2, line3)


def queue_head(active_seg='全部', counts=None, mine=False):
    sort = row(icon('sort', 13, T['ink4']) + nowrap('按 SLA 剩余', 11, T['ink4']), 4)
    return col(between(row(text('待处理', 14.6, T['ink'], 650) + sort, 10), toggle(mine, '只看我的')) + queue_seg(active_seg, counts), 10)


def queue_column(selected_no=None, active_seg='全部', rows_html=None, counts=None, w=308, mine=False):
    rows = rows_html if rows_html is not None else ''.join(queue_row(TK[n], n == selected_no) for n in QUEUE_ORDER)
    return ('<div style="width: %dpx; flex-shrink: 0; box-sizing: border-box; background: #ffffff; border: 1px solid %s; border-radius: 16px; box-shadow: %s; display: flex; flex-direction: column; min-height: 0px; overflow: hidden;">'
            '<div style="padding: 13px 14px 11px 14px; border-bottom: 1px solid %s; flex-shrink: 0;">%s</div>'
            '<div style="flex: 1; min-height: 0px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: %s transparent; padding: 6px 8px 10px 8px; display: flex; flex-direction: column; gap: 3px;">%s</div></div>') % (
        w, T['line'], SHADOW_XS, T['line2'], queue_head(active_seg, counts, mine), T['line_strong'], rows)


# ---------------------------------------------------------------- 中栏
def _sla_pct(t):
    m = re.match(r'(\d+)h (\d+)m', t.get('sla_left', ''))
    return int((int(m.group(1)) * 60 + int(m.group(2))) * 100 / (24 * 60)) if m else 0


def conv_head(t, owner_av, tags=None, actions=None, sla_label=None):
    """会话标题区（三行）：主题 + 操作 / 编号 · 渠道与店铺 · 负责人 | SLA 胶囊 / 状态 · 优先级 · 意图 · 标签。"""
    acts = actions if actions is not None else (btn('合并', 'secondary', 'sm', 'merge') + btn('内部备注', 'secondary', 'sm', 'message') + icon_btn('more', 'secondary', 28))
    r1 = between('<div style="flex: 1; min-width: 0px;">%s</div>' % ellipsis(t['subject'], 17, T['ink'], 650), row(acts, 6))
    lbl = sla_label or ('内部目标' if t.get('sla_kind') else '亚马逊 24h SLA' if t['channel'] == '亚马逊' else 'SLA')
    tg_ = ''.join(pill(x) for x in (t['tags'] if tags is None else tags))
    add = '<div style="font-size: 11px; color: %s; border: 1px dashed %s; border-radius: 6px; padding: 0px 7px; line-height: 18px; white-space: nowrap;">＋ 标签</div>' % (T['ink4'], T['line_strong'])
    if t['sla_level'] == 'none':
        s_ = row(nowrap(lbl, 11, T['ink4']) + sla(t['sla_left'], 'none', 12), 6)
    else:
        s_ = sla_meter(lbl, ('剩 ' + t['sla_left']) if t['sla_left'][0].isdigit() else t['sla_left'], {'danger': 'danger', 'warning': 'warning'}.get(t['sla_level'], 'normal'), _sla_pct(t))
    meta = row(nowrap(t['no'], 11.5, T['ink4']) + channel(t['channel'], t['site'], t['store']) + divider(True, 12) +
               nowrap('负责人', 11.5, T['ink4']) + row(avatar(owner_av, 'grad', 18) + nowrap(t['owner'], 12, T['ink2']), 5), 8)
    r2 = between(meta, s_)
    r3 = row(state(t['status']) + priority(t['priority']) + cat(t['intent']) + (divider(True, 12) if tg_ else '') + tg_ + add, 6)
    return '<div style="padding: 12px 18px 11px 18px; border-bottom: 1px solid %s; display: flex; flex-direction: column; gap: 7px; flex-shrink: 0; background: #ffffff;">%s%s%s</div>' % (
        T['line2'], r1, r2, r3)


def middle(head, inner, pad='14px 18px', gap=12):
    """中栏处理台：白色圆角面板，标题区白底，内容区浅灰底。"""
    return ('<div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; min-height: 0px; background: #ffffff; border: 1px solid %s; border-radius: 16px; box-shadow: %s; overflow: hidden;">%s'
            '<div style="flex: 1; min-height: 0px; overflow: hidden; padding: %s; display: flex; flex-direction: column; gap: %dpx; background: %s;">%s</div></div>') % (
        T['line'], SHADOW_XS, head, pad, gap, T['subtle'], inner)


def three_col(left, mid, right):
    return '<div style="flex: 1; display: flex; flex-direction: row; gap: 12px; padding: 10px 14px 12px 14px; min-height: 0px;">%s%s%s</div>' % (left, mid, right)


def tg(on, t):
    """toggle 的不换行包装（ui.toggle 的文字在窄处会折行）。"""
    return '<div style="white-space: nowrap; flex-shrink: 0;">%s</div>' % toggle(on, t)


def ai_summary(t, title='对话摘要'):
    """对话摘要：一行显示，超出省略，右侧「展开」。"""
    return '<div style="display: flex; align-items: center; gap: 10px; background: #ffffff; border: 1px solid %s; border-radius: 12px; padding: 8px 12px; box-shadow: %s; flex-shrink: 0;">%s<div style="flex: 1; min-width: 0px; font-size: 12.8px; color: %s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">%s</div>%s</div>' % (
        T['line'], SHADOW_XS, ai_badge(title), T['ink2'], t, link('展开', 12, 'chev_d'))


def paras(s, repl=None):
    out = ''
    for p in s.split('\n\n'):
        p = p.replace('\n', '<br>')
        for a, b in (repl or []):
            p = p.replace(a, b)
        out += '<div>%s</div>' % p
    return out


def promise(t):
    """草稿正文里的承诺内容：浅黄底 + 虚线下划线，与「需要审批的内容」卡同色。"""
    return '<span style="background: %s; border-bottom: 1px dashed %s; padding: 0px 1px;">%s</span>' % (T['warn_bg'], T['warn_solid'], t)


def body_box(inner, st='default', gap=6, pad='10px 14px'):
    bd = {'default': T['line'], 'focus': T['accent'], 'readonly': T['line'], 'stale': T['line']}[st]
    bg = T['subtle'] if st in ('readonly', 'stale') else '#ffffff'
    ring = ' box-shadow: 0 0 0 3px rgba(79,70,229,0.14);' if st == 'focus' else ''
    color = T['ink3'] if st == 'stale' else T['ink']
    return '<div style="border: 1px solid %s; border-radius: 10px; background: %s; padding: %s; font-size: 13px; line-height: 1.6; color: %s; display: flex; flex-direction: column; gap: %dpx;%s">%s</div>' % (
        bd, bg, pad, color, gap, ring, inner)


def ver_tabs(items, active, right=''):
    """草稿版本切换：胶囊分段（右端放「换一版」）。items: [(键, 文字, 附加html)]"""
    out = ''
    for key, name, extra in items:
        on = key == active
        out += '<div style="display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: %d; color: %s; padding: %s; border-radius: 7px; background: %s; border: 1px solid %s;%s white-space: nowrap;">%s%s</div>' % (
            650 if on else 500, T['accent_ink'] if on else T['ink3'], '3px 10px' if on else '4px 10px', '#ffffff' if on else 'transparent',
            T['line'] if on else 'transparent', ' box-shadow: %s;' % SHADOW_XS if on else '', name, extra)
    return '<div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;"><div style="display: inline-flex; align-items: center; gap: 2px; background: %s; border-radius: 9px; padding: 3px;">%s</div>%s</div>' % (
        T['track'], out, right)


def draft_toolbar(lang, cn_on=False, media=True, hint=None, lib=False, cn_label='用中文修改'):
    p = nowrap('回复语言', 12, T['ink3']) + select_box(lang, width='104px', h=28) + tg(cn_on, cn_label) + divider(True, 16)
    p += btn('插入图片', 'secondary', 'sm', 'image', disabled=not media) + btn('插入链接', 'secondary', 'sm', 'link', disabled=not media)
    if lib:
        p += btn('素材库', 'ghost', 'sm', 'book')
    if hint:
        p += row(icon('info', 13, T['ink4']) + nowrap(hint, 11, T['ink3']), 4)
    return row(p, 8)


def evidence(items):
    return row(nowrap('依据', 11.5, T['ink4']) + ''.join(chip(t, 'muted', 11, ic) for t, ic in items), 6, wrap=True)


def check_row(passed=5, total=5):
    """回复检查（折叠）：图标 + 通过数 + 展开箭头。放在草稿卡头部右侧。"""
    ok = passed == total
    c = T['ok'] if ok else T['bad']
    return row(icon('check_c' if ok else 'x_c', 15, T['ok_solid'] if ok else T['bad_solid'], 2) +
               nowrap('回复检查 %d / %d 通过' % (passed, total), 12, c, 600) + icon('chev_d', 13, T['ink4']), 5)


def kvline(k, v, kw=36):
    return '<div style="display: flex; gap: 8px; align-items: baseline; min-width: 0px;"><div style="width: %dpx; flex-shrink: 0; font-size: 12px; color: %s; white-space: nowrap;">%s</div><div style="font-size: 13px; color: %s; line-height: 1.5; min-width: 0px;">%s</div></div>' % (
        kw, T['ink3'], k, T['ink'], v)


def approval_needed(rows, note, approver='客服主管', limit='4 小时'):
    """需要审批的内容（警示浅底卡）。rows: 每项为 (键, 值) 或 [(键, 值), (键, 值)]（同一行并排）。"""
    body = ''
    for r in rows:
        if isinstance(r, list):
            body += '<div style="display: flex; gap: 28px;">%s</div>' % ''.join(kvline(k, v) for k, v in r)
        else:
            body += kvline(*r)
    ico = '<div style="width: 22px; height: 22px; border-radius: 999px; background: #f6e3c6; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%s</div>' % icon('approve', 12, T['warn'], 2)
    flag = '<div style="font-size: 10.5px; font-weight: 650; color: %s; background: #f6e3c6; border-radius: 5px; padding: 1px 7px; white-space: nowrap;">审批人 %s · 时限 %s</div>' % (T['warn'], approver, limit)
    head = between(row(ico + text('需要审批的内容', 12.9, T['ink'], 650), 8), flag)
    return '<div style="background: #fcf5eb; border: 1px solid %s; border-radius: 13px; padding: 10px 13px; display: flex; flex-direction: column; gap: 6px;">%s%s%s</div>' % (
        T['warn_line'], head, col(body, 4), muted(note, 12))


def draft_foot(left, right=''):
    return '<div style="display: flex; align-items: center; gap: 8px; padding-top: 10px; border-top: 1px solid %s;">%s<div style="flex: 1;"></div>%s</div>' % (T['line2'], left, right)


def draft_card(meta, tabs_html, toolbar, body, evid='', check='', approval='', foot='', top='', gap=8, head_right=''):
    """AI 草稿卡（动作壳）：顶部渐变细条 → 头部（AI 徽标 · 生成时间 · 置信度 | 回复检查）→ 版本 → 工具行 → 正文 → 依据 → 审批项 → 底栏按钮。"""
    head = '<div style="padding: 9px 14px 8px 14px; background: linear-gradient(180deg, %s, #ffffff); display: flex; align-items: center; justify-content: space-between; gap: 10px;">%s%s</div>' % (
        T['accent_bg'], row(ai_badge('AI 回复草稿') + nowrap(meta, 11.5, T['ink3']), 8), head_right or check)
    inner = '<div style="padding: 2px 14px 12px 14px; display: flex; flex-direction: column; gap: %dpx;">%s%s%s%s%s%s</div>' % (gap, top, tabs_html, toolbar, body, evid, approval)
    f = ''
    if foot:
        f = '<div style="padding: 8px 14px; background: %s; border-top: 1px solid %s;">%s</div>' % (
            T['subtle'], T['line2'], foot.replace('padding-top: 10px; border-top: 1px solid %s;' % T['line2'], '', 1))
    return '<div style="position: relative; background: #ffffff; border: 1px solid %s; border-radius: 16px; box-shadow: %s; overflow: hidden; display: flex; flex-direction: column; flex-shrink: 0;"><div style="height: 2.5px; background: %s; flex-shrink: 0;"></div>%s%s%s</div>' % (
        T['accent_line'], SHADOW_CARD, GRAD, head, inner, f)


def customer_msg(name, meta, body, av, toggle_html=None, kind='in', extra=''):
    ex = (spacer() + toggle_html) if toggle_html else ''
    return message(name, meta, body, kind, av, extra + ex)


# ---------------------------------------------------------------- 右栏
def rsec(title, body, extra='', last=False, gap=10, collapsed=False, ai=False):
    """右栏分区：圆角卡片，标题 + 右侧补充 + 折叠箭头；collapsed=True 只显示标题行。"""
    t = row((ai_badge('', 9.5).replace('✦ ', '✦') if ai else '') + text(title, 12.6, T['ink'], 650), 6)
    head = '<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px;">%s%s</div>' % (
        t, row(extra + icon('chev_r' if collapsed else 'chev_d', 14, T['ink4']), 8))
    b = '' if collapsed else '<div style="padding: 0px 12px 12px 12px; display: flex; flex-direction: column; gap: %dpx;">%s</div>' % (gap, body)
    return '<div style="border: 1px solid %s; border-radius: 13px; background: #ffffff; flex-shrink: 0;">%s%s</div>' % (T['line'], head, b)


def right_column(inner, w=332, title='工单上下文'):
    head = '<div style="padding: 12px 14px 10px 14px; border-bottom: 1px solid %s; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">%s%s</div>' % (
        T['line2'], text(title, 14.6, T['ink'], 650), icon_btn('panel', size=26))
    return '<div style="width: %dpx; flex-shrink: 0; box-sizing: border-box; background: #ffffff; border: 1px solid %s; border-radius: 16px; box-shadow: %s; display: flex; flex-direction: column; min-height: 0px; overflow: hidden;">%s<div style="flex: 1; min-height: 0px; overflow: hidden; padding: 12px; display: flex; flex-direction: column; gap: 10px;">%s</div></div>' % (
        w, T['line'], SHADOW_XS, head, inner)


def ai_note(t):
    return '<div style="background: %s; border-radius: 9px; padding: 8px 10px; font-size: 12px; color: %s; line-height: 1.6;">%s</div>' % (T['accent_bg'], T['ink2'], t)


def check_list(items):
    """回复检查逐项：通过绿勾 / 未通过红叉 + 名称 + 说明。items: [(名称, 说明, 是否通过)]"""
    out = ''
    for n, d, ok in items:
        out += '<div style="display: flex; gap: 8px; align-items: flex-start;">%s<div style="display: flex; flex-direction: column; gap: 1px; min-width: 0px;"><div style="font-size: 12px; font-weight: 600; color: %s;">%s</div><div style="font-size: 12px; color: %s; line-height: 1.45;">%s</div></div></div>' % (
            icon('check_c' if ok else 'x_c', 15, T['ok_solid'] if ok else T['bad_solid'], 2), T['ink'] if ok else T['bad'], n, T['ink3'], d)
    return col(out, 8)


def vsteps(steps):
    """纵向步骤（排查树路径等）。steps: [(文字, 'done'|'current'|'todo')]"""
    out = ''
    n = len(steps)
    for i, (t, st) in enumerate(steps):
        if st == 'done':
            dot = '<div style="width: 18px; height: 18px; border-radius: 999px; background: %s; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%s</div>' % (T['ok_solid'], icon('check', 11, '#ffffff', 3))
            c, w = T['ink2'], 500
        elif st == 'current':
            dot = '<div style="width: 18px; height: 18px; box-sizing: border-box; border-radius: 999px; background: %s; color: #ffffff; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%d</div>' % (T['accent'], i + 1)
            c, w = T['accent_ink'], 700
        else:
            dot = '<div style="width: 18px; height: 18px; box-sizing: border-box; border-radius: 999px; background: #ffffff; border: 1.5px solid %s; color: %s; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%d</div>' % (T['line_strong'], T['ink4'], i + 1)
            c, w = T['ink3'], 500
        ln = '<div style="position: absolute; left: 8px; top: 20px; bottom: -8px; width: 2px; background: %s;"></div>' % T['line'] if i < n - 1 else ''
        out += '<div style="position: relative; display: flex; gap: 10px; align-items: flex-start; padding-bottom: %dpx;">%s%s<div style="font-size: 12px; font-weight: %d; color: %s; line-height: 18px;">%s</div></div>' % (
            0 if i == n - 1 else 10, ln, dot, w, c, t)
    return '<div style="display: flex; flex-direction: column;">%s</div>' % out


def scaled(inner, w=1440, h=900, s=0.5):
    """整页缩小放进状态板（与 build_ds.py 相同）。"""
    return '<div style="width: %dpx; height: %dpx; overflow: hidden; position: relative;"><div style="position: absolute; left: 0px; top: 0px; width: %dpx; height: %dpx; transform: scale(%s); transform-origin: 0px 0px;">%s</div></div>' % (
        int(w * s), int(h * s), w, h, s, inner)


# ---------------------------------------------------------------- P01 Sarah 专用块（状态板复用）
SARAH_T = TK['T-20260910-0192']
SARAH_VERSIONS = [('A', 'A 先补发', ai_badge('推荐', 9.5)), ('B', 'B 先查件再定', ''), ('C', 'C 部分退款', '')]
SARAH_PROMISE = 'a replacement ships Friday, Sep 11 via UPS Next Day Air at no cost to you and arrives Monday, Sep 14'


def sarah_body():
    return body_box(paras(DRAFTS['sarah_A'], [(SARAH_PROMISE, promise(SARAH_PROMISE))]))


def sarah_approval():
    return approval_needed([
        ('动作', '良仓创建售后出库单：良仓 US · V2 黑色 ×1 · UPS Next Day Air'),
        [('报备', '快递费用 <span style="font-weight: 700;">$12.40</span>'), ('责任', '物流问题（规则：轨迹停滞满 5 天且超预计送达）')],
    ], '提交后会同时创建售后单。批准后经良仓接口创建出库单，成功即自动发出这封回复。')


def sarah_msg(toggle_on='原文'):
    return customer_msg('Sarah Mitchell', '亚马逊买家消息 · 09-10 16:00', MSG_IN['sarah_en'] if toggle_on == '原文' else MSG_IN['sarah_zh'],
                        '', seg(['原文', '中文译文'], toggle_on, 'sm'))


def sarah_huan():
    return btn('换一版', 'ghost', 'sm', 'refresh')
