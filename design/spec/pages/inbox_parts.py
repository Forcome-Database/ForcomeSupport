# -*- coding: utf-8 -*-
"""收件箱三栏共用部件（P01–P03 与 StatesInbox 共用）。
只用 ui.py 组件与 T 色板组合；本文件新增的组合部件在报告里列出，便于并入组件库。
"""
import sys, os
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
    """队列分段：数字在上、名称在下的五等分分段控件（320px 栏宽放得下五段）。"""
    counts = QUEUE_COUNTS if counts is None else counts
    cells = ''
    for name in SEGMENTS:
        on = name == active
        n = counts.get(name, 0)
        nc = T['bad'] if (name == '转人工' and n) else (T['accent_ink'] if on else T['ink'])
        cells += ('<div style="display: flex; flex-direction: column; align-items: center; padding: 4px 0px; border-radius: 4px; background: %s;%s">'
                  '<div style="font-size: 13px; font-weight: 700; color: %s; line-height: 18px; font-variant-numeric: tabular-nums;">%s</div>'
                  '<div style="font-size: 11px; font-weight: %d; color: %s; line-height: 16px; white-space: nowrap;">%s</div></div>') % (
            '#ffffff' if on else 'transparent', ' box-shadow: %s;' % SHADOW_XS if on else '', nc, n, 700 if on else 500,
            T['accent_ink'] if on else T['ink3'], name)
    return '<div style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 2px; background: %s; border: 1px solid %s; border-radius: 6px; padding: 2px;">%s</div>' % (
        T['line2'], T['line'], cells)


def queue_row(t, selected=False, sla_html=None, highlight=None):
    """队列行：客户名 + 渠道 + SLA / 主题 / 情绪点 · 意图 · 状态。选中行靛蓝条，转人工行红条。"""
    bar = ''
    if selected:
        bar = ' box-shadow: inset 3px 0 0 %s;' % T['accent']
    elif t['status'] == '转人工' or highlight == 'danger':
        bar = ' box-shadow: inset 3px 0 0 %s;' % T['bad_solid']
    bg = T['accent_bg'] if selected else '#ffffff'
    s = sla_html if sla_html is not None else sla(t['sla_left'], t['sla_level'])
    line1 = between('<div style="display: flex; align-items: center; gap: 6px; min-width: 0px;">%s%s</div>' % (
        ellipsis(t['customer'], 13, T['ink'], 700 if selected else 600), channel(t['channel'], t['site'])), s)
    line2 = ellipsis(t['subject'], 12, T['ink2'])
    right = nowrap('内部目标', 11, T['ink4']) if t.get('sla_kind') else ''
    line3 = between(row(sentiment(t['sentiment'], False) + nowrap(t['intent'], 12, T['ink3']) + state(t['status']), 6), right)
    return '<div style="padding: 11px 16px 11px 16px; border-bottom: 1px solid %s; background: %s; display: flex; flex-direction: column; gap: 4px;%s">%s%s%s</div>' % (
        T['line2'], bg, bar, line1, line2, line3)


def queue_head(active_seg='全部', counts=None, mine=False):
    sort = row(icon('sort', 13, T['ink4']) + nowrap('按 SLA 剩余', 11, T['ink3']), 4)
    return col(between(row(text('待处理', 16, T['ink'], 700) + sort, 10), toggle(mine, '只看我的')) + queue_seg(active_seg, counts), 10)


def queue_column(selected_no=None, active_seg='全部', rows_html=None, counts=None, w=320, mine=False):
    rows = rows_html if rows_html is not None else ''.join(queue_row(TK[n], n == selected_no) for n in QUEUE_ORDER)
    return ('<div style="width: %dpx; flex-shrink: 0; box-sizing: border-box; background: #ffffff; border-right: 1px solid %s; display: flex; flex-direction: column; min-height: 0px;">'
            '<div style="padding: 14px 16px 12px 16px; border-bottom: 1px solid %s; flex-shrink: 0;">%s</div>'
            '<div style="flex: 1; min-height: 0px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: %s transparent;">%s</div></div>') % (
        w, T['line'], T['line'], queue_head(active_seg, counts, mine), T['line_strong'], rows)


# ---------------------------------------------------------------- 中栏
def conv_head(t, owner_av, tags=None, actions=None, sla_label=None):
    """会话标题区：主题 + 操作；编号 · 渠道 · 负责人 · SLA；状态 · 优先级 · 意图 · 标签。"""
    acts = actions if actions is not None else (btn('合并', 'secondary', 'sm', 'merge') + btn('内部备注', 'secondary', 'sm', 'message') + icon_btn('more', 'secondary', 28))
    r1 = between('<div style="flex: 1; min-width: 0px;">%s</div>' % ellipsis(t['subject'], 16, T['ink'], 700), row(acts, 6))
    lbl = sla_label or ('内部目标剩余' if t.get('sla_kind') else 'SLA 剩余')
    r2 = row(nowrap(t['no'], 12, T['ink3']) + channel(t['channel'], t['site'], t['store']) + divider(True, 12) +
             row(avatar(owner_av, 'green', 18) + nowrap('负责人 ' + t['owner'], 12, T['ink2']), 6) + divider(True, 12) +
             row(nowrap(lbl, 12, T['ink3']) + sla(t['sla_left'], t['sla_level']), 6), 10)
    tg = ''.join(pill(x) for x in (t['tags'] if tags is None else tags))
    r3 = row(state(t['status']) + priority(t['priority']) + cat(t['intent']) + divider(True, 12) + tg + btn('添加标签', 'link', 'sm', 'plus'), 6)
    return '<div style="background: #ffffff; border-bottom: 1px solid %s; padding: 11px 20px 10px 20px; display: flex; flex-direction: column; gap: 7px; flex-shrink: 0;">%s%s%s</div>' % (
        T['line'], r1, r2, r3)


def middle(head, inner, pad='14px 20px', gap=12):
    return ('<div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; min-height: 0px;">%s'
            '<div style="flex: 1; min-height: 0px; overflow: hidden; padding: %s; display: flex; flex-direction: column; gap: %dpx;">%s</div></div>') % (head, pad, gap, inner)


def three_col(left, mid, right):
    return '<div style="flex: 1; display: flex; flex-direction: row; min-height: 0px;">%s%s%s</div>' % (left, mid, right)


def tg(on, t):
    """toggle 的不换行包装（ui.toggle 的文字在窄处会折行）。"""
    return '<div style="white-space: nowrap; flex-shrink: 0;">%s</div>' % toggle(on, t)


def ai_summary(t, title='对话摘要'):
    return card('<div style="display: flex; gap: 8px; align-items: flex-start;"><div style="padding-top: 3px;">%s</div><div style="font-size: 13px; color: %s; line-height: 1.55;"><span style="font-weight: 700; color: %s;">%s（AI）</span>　%s</div></div>' % (
        icon('spark', 14, T['accent'], 2), T['ink2'], T['ink'], title, t), pad='9px 14px', gap=4)


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
    ring = ' box-shadow: 0 0 0 3px #e0e7ff;' if st == 'focus' else ''
    color = T['ink3'] if st == 'stale' else T['ink']
    return '<div style="border: 1px solid %s; border-radius: 6px; background: %s; padding: %s; font-size: 13px; line-height: 1.6; color: %s; display: flex; flex-direction: column; gap: %dpx;%s">%s</div>' % (
        bd, bg, pad, color, gap, ring, inner)


def ver_tabs(items, active, right=''):
    """草稿版本页签（tabs 的变体：右端可放「换一版」）。items: [(键, 文字, 附加html)]"""
    out = ''
    for key, name, extra in items:
        on = key == active
        out += '<div style="display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: %d; color: %s; padding: 7px 2px 8px 2px; border-bottom: 2px solid %s; margin-bottom: -1px; white-space: nowrap;">%s%s</div>' % (
            700 if on else 500, T['ink'] if on else T['ink3'], T['accent'] if on else 'transparent', name, extra)
    return '<div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid %s;"><div style="display: flex; align-items: center; gap: 20px;">%s</div>%s</div>' % (
        T['line'], out, right)


def draft_toolbar(lang, cn_on=False, media=True, hint=None, lib=False, cn_label='用中文修改'):
    p = nowrap('回复语言', 12, T['ink3']) + select_box(lang, width='104px', h=28) + tg(cn_on, cn_label) + divider(True, 16)
    p += btn('插入图片', 'secondary', 'sm', 'image', disabled=not media) + btn('插入链接', 'secondary', 'sm', 'link', disabled=not media)
    if lib:
        p += btn('素材库', 'ghost', 'sm', 'book')
    if hint:
        p += row(icon('info', 13, T['ink4']) + nowrap(hint, 11, T['ink3']), 4)
    return row(p, 8)


def evidence(items):
    return row(nowrap('依据', 12, T['ink3']) + ''.join(chip(t, 'outline', 11, ic) for t, ic in items), 6, wrap=True)


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
    """rows: 每项为 (键, 值) 或 [(键, 值), (键, 值)]（同一行并排）。"""
    body = ''
    for r in rows:
        if isinstance(r, list):
            body += '<div style="display: flex; gap: 28px;">%s</div>' % ''.join(kvline(k, v) for k, v in r)
        else:
            body += kvline(*r)
    head = between(row(icon('approve', 15, T['warn'], 2) + text('需要审批的内容', 13, T['ink'], 700), 6),
                   nowrap('审批人 <span style="color: %s; font-weight: 600;">%s</span> · 时限 %s' % (T['ink'], approver, limit), 12, T['ink3']))
    return card(head + col(body, 4) + muted(note, 12), pad='9px 14px', gap=6, tone='warning')


def draft_foot(left, right=''):
    return '<div style="display: flex; align-items: center; gap: 8px; padding-top: 10px; border-top: 1px solid %s;">%s<div style="flex: 1;"></div>%s</div>' % (T['line2'], left, right)


def draft_card(meta, tabs_html, toolbar, body, evid='', check='', approval='', foot='', top='', gap=8, head_right=''):
    """AI 草稿卡：头部（标题 · 生成时间 · 置信度 · 依据数 | 回复检查）→ 版本页签 → 工具行 → 正文 → 依据 → 审批项 → 按钮。"""
    head = between(row(icon('spark', 16, T['accent'], 2) + text('AI 回复草稿', 13, T['ink'], 700) + nowrap(meta, 12, T['ink3']), 8), head_right or check)
    return card(head + top + tabs_html + toolbar + body + evid + approval + foot, pad='11px 16px', gap=gap, tone='accent')


def customer_msg(name, meta, body, av, toggle_html=None, kind='in', extra=''):
    ex = (spacer() + toggle_html) if toggle_html else ''
    return message(name, meta, body, kind, av, extra + ex)


# ---------------------------------------------------------------- 右栏
def rsec(title, body, extra='', last=False, gap=10):
    return '<div style="padding: 14px 20px; border-bottom: %s; display: flex; flex-direction: column; gap: %dpx; flex-shrink: 0;">%s%s</div>' % (
        '0px' if last else '1px solid %s' % T['line2'], gap, between(label(title), extra), body)


def right_column(inner, w=340):
    return '<div style="width: %dpx; flex-shrink: 0; box-sizing: border-box; background: #ffffff; border-left: 1px solid %s; display: flex; flex-direction: column; min-height: 0px; overflow: hidden;">%s</div>' % (
        w, T['line'], inner)


def ai_note(t):
    return '<div style="background: %s; border: 1px solid %s; border-radius: 6px; padding: 8px 10px; display: flex; gap: 8px; align-items: flex-start;">%s<div style="font-size: 12px; color: %s; line-height: 1.55;">%s</div></div>' % (
        T['subtle'], T['line'], icon('spark', 14, T['accent'], 2), T['ink2'], t)


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
SARAH_VERSIONS = [('A', 'A 先补发', chip('AI 推荐', 'accent', 10, 'spark')), ('B', 'B 先查件再定', ''), ('C', 'C 部分退款', '')]
SARAH_PROMISE = 'a replacement ships Friday, Sep 11 via UPS Next Day Air at no cost to you and arrives Monday, Sep 14'


def sarah_body():
    return body_box(paras(DRAFTS['sarah_A'], [(SARAH_PROMISE, promise(SARAH_PROMISE))]))


def sarah_approval():
    return approval_needed([
        ('动作', '积加创建售后发货单：良仓 US · V2 黑色 ×1 · UPS Next Day Air'),
        [('报备', '快递费用 <span style="font-weight: 700;">$12.40</span>'), ('责任', '物流问题（规则：轨迹停滞满 5 天且超预计送达）')],
    ], '提交后会同时创建售后单。批准后，发货单创建成功即自动发出这封回复。')


def sarah_msg(toggle_on='原文'):
    return customer_msg('Sarah Mitchell', '经积加同步 · 09-10 16:00', MSG_IN['sarah_en'] if toggle_on == '原文' else MSG_IN['sarah_zh'],
                        '', seg(['原文', '中文译文'], toggle_on, 'sm'))


def sarah_huan():
    return btn('换一版', 'ghost', 'sm', 'refresh')
