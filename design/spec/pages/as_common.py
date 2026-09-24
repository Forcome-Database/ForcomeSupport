# -*- coding: utf-8 -*-
"""售后、台账、结算、设置、工厂工作台页面共用部件（P07–P14、P18–P21 与 StatesAfterSales / StatesFactory / StatesAdmin 共用）。
只用 ui.py 组件与 T 色板组合；本文件新增的组合部件在报告里列出，便于并入组件库。
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ui import *
from data import *
from data import _parts

AS = {a['no']: a for a in AFTERSALES}
STORE = {s['name']: s for s in STORES}
FT = {(t['type'], t['aftersales']): t for t in FACTORY_TASKS}


def plat(store):
    return STORE[store]['platform']


def ch(a, size=11):
    """售后单的渠道标识：平台 + 站点 + 店铺。"""
    return channel(plat(a['store']), a['site'], a['store'], size)


def store_site(a):
    return '%s · %s' % (a['store'], a['site'])


# ---------------------------------------------------------------- 计数（页签、快捷筛选）
N_ALL = len(AFTERSALES)
N_NEGO = sum(1 for a in AFTERSALES if a['nego'] in ('待工厂答复', '工厂还价', '待升级'))
N_SETTLE = sum(1 for a in AFTERSALES if a['settle'] == '待结算')


def as_tabs(active):
    """售后模块页签条（P07、P13、P14 共用）。「待协商」「待结算」改为 P07 的快捷筛选，不再是页签。"""
    return tabs([('售后单', N_ALL), ('登记台账', None), ('内部结算', None)], active)


def as_head(active, actions=''):
    return page_head('售后', '售后单、登记台账、比例协商与内部结算 · 全部店铺', actions, as_tabs(active))


# ---------------------------------------------------------------- 小部件
def pending(t='待回填'):
    """缺失字段：黄色「待回填」。"""
    return chip(t, 'warning')


def na(t='—'):
    return '<span style="color: %s;">%s</span>' % (T['ink4'], t)


def num_badge(n):
    """表单分节序号圆标。"""
    return '<div style="width: 20px; height: 20px; border-radius: 999px; background: %s; color: %s; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%s</div>' % (
        T['accent_bg'], T['accent_ink'], n)


def sec_head(n, title, required=False, right=''):
    req = '<span style="color: %s; margin-left: 2px;">*</span>' % T['bad'] if required else ''
    return between(row(num_badge(n) + '<div style="font-size: 14px; font-weight: 700; color: %s;">%s%s</div>' % (T['ink'], title, req), 8), right)


RATIO_PARTS = RATIO_LABELS


def ratio_txt(a, show_state=True, words=False):
    """承担比例 FSH / 工厂。
    紧凑表格单元格（表头已写「FSH / 工厂 %」）：三组相同时写一个值，不同时写「按费用项」（prd_c P13）。
    words=True 用于详情与说明：三组相同写「三组均 FSH x / 工厂 y」，不同时逐组列出（data.ratio_words）。"""
    u = ratio_uniform(a['ratios'])
    s = ratio_words(a['ratios']) if words else (('%d / %d' % u) if u else '按费用项')
    if show_state and a['ratio_state'] == '建议':
        return '<span style="white-space: nowrap;">%s <span style="font-size: 11px; color: %s;">建议</span></span>' % (s, T['ink4'])
    return '<span style="white-space: nowrap;">%s</span>' % s


def share_words(a, fac=None, parts=None):
    """比例一律带金额（FSH 在前、工厂在后）：「FSH $0.00 · 工厂 $14.70（三组均 0 / 100）」。
    fac：工厂名（如 'FZJ'），默认「工厂」；parts：自定义比例 dict 时按它计算（如生产厂还价）。"""
    r = parts or a['ratios']
    p = _parts(a)
    f = round(sum(p[k] * r[k][0] / 100.0 for k in p), 2)
    c = round(sum(p[k] * r[k][1] / 100.0 for k in p), 2)
    u = ratio_uniform(r)
    return 'FSH %s · %s %s（%s）' % (money(f), fac or '工厂', money(c), ('三组均 %d / %d' % u) if u else '按费用项')


def cur_cell(a, st='confirmed', size=13, weight=400, amount=None):
    """表格金额单元格：比索、加元原币单独一行，下方小字「≈ $49.39」（窄列里的 money_cur 写法）。"""
    x = total(a) if amount is None else amount
    if a.get('comp_orig') and amount is None:
        pre = '≈ ' if st == 'estimate' else ''
        return '<div style="display: flex; flex-direction: column; align-items: flex-end; gap: 0px;">%s%s</div>' % (
            nowrap(pre + a['comp_orig'], size, T['ink3'] if st == 'estimate' else T['ink'], weight), nowrap('≈ %s' % money(x), 11, T['ink4']))
    return fee_amt(x if a['product'] is not None else None, st, size, weight)


def pager(total_text):
    """分页（单页时上一页 / 下一页置灰并给出原因）。"""
    return between(muted(total_text), row(btn('上一页', 'secondary', 'sm', disabled=True, reason='已是第一页') + nowrap('1 / 1', 12, T['ink2']) +
                                          btn('下一页', 'secondary', 'sm', disabled=True, reason='已是最后一页'), 8))


# ---------------------------------------------------------------- 执行记录：执行者 = 中性标签 + 头像（「自动」并入「系统」）
ACTORS = {'系统': ('系', 'grey'), '王磊': ('磊', 'grad'), '周敏': ('敏', 'grad'), '李婷': ('婷', 'grad'), '陈晨': ('晨', 'grad'),
          '陈工': ('陈', 'amber'), '刘厂长': ('刘', 'amber'), '良仓': ('良', 'grey')}


def actor_tag(name):
    name = '系统' if name == '自动' else name
    av, tone = ACTORS.get(name, (name[0], 'grey'))
    return '<div style="display: inline-flex; align-items: center; gap: 5px; background: %s; border-radius: 999px; padding: 1px 8px 1px 2px; flex-shrink: 0;">%s<div style="font-size: 11px; font-weight: 600; color: %s; white-space: nowrap;">%s</div></div>' % (
        T['track'], avatar(av, tone, 18), T['ink2'], name)


def log_row(time_, actor, body):
    return '<div style="display: flex; gap: 10px; align-items: flex-start;"><div style="width: 84px; flex-shrink: 0; font-size: 12px; color: %s; padding-top: 2px; font-variant-numeric: tabular-nums;">%s</div><div style="width: 68px; flex-shrink: 0;">%s</div><div style="flex: 1; min-width: 0px; font-size: 13px; color: %s; line-height: 1.55;">%s</div></div>' % (
        T['ink4'], time_, actor_tag(actor), T['ink'], body)


# ---------------------------------------------------------------- 登记信息：单列分组 + 进度只计应填未填
def reg_groups(groups, cols=4, folded=None, title='登记信息', extra=''):
    """groups: [(小标题, [(键, 值 html, st)])]；st：1 已填 / 0 应填未填（显示「待回填」）/ None 未到环节或不适用（不计入进度）。
    每组一列（标签左、值右），组并排；folded=(条数, 说明) 时底部显示「9 项不适用 ▾」折叠行。"""
    counted = [f for _, fs in groups for f in fs if f[2] is not None]
    n = sum(1 for f in counted if f[2])
    tot = len(counted)
    later = sum(1 for _, fs in groups for f in fs if f[2] is None)
    cols_html = ''
    for sub, fs in groups:
        rows_ = ''
        for k, v, st in fs:
            val = pending() if st == 0 else v
            rows_ += '<div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; min-height: 20px; font-size: 12px;"><div style="color: %s; white-space: nowrap;">%s</div><div style="font-weight: 600; color: %s; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; min-width: 0px;">%s</div></div>' % (
                T['ink3'], k, T['ink'], val)
        cols_html += '<div style="display: flex; flex-direction: column; gap: 4px; min-width: 0px;"><div style="font-size: 11px; font-weight: 700; color: %s; letter-spacing: 0.04em; padding-bottom: 3px; border-bottom: 1px solid %s;">%s</div>%s</div>' % (
            T['ink4'], T['line2'], sub, rows_)
    ok = n == tot
    tail = nowrap('· %d 项未到环节，不计入' % later, 12, T['ink4']) if later and not folded else ''
    head = between(label(title), row('<div style="width: 64px;">%s</div>' % progress(int(round(n * 100.0 / max(tot, 1))), 'success' if ok else 'warning', 4) +
                                     nowrap('已填 %d / %d' % (n, tot), 12, T['ok'] if ok else T['warn'], 600) + tail, 8))
    fold = ''
    if folded:
        fold = '<div style="display: flex; align-items: center; gap: 6px; border-top: 1px dashed %s; padding-top: 7px; font-size: 12px; color: %s;"><span style="font-weight: 600; color: %s;">%d 项不适用</span>%s<span>%s</span></div>' % (
            T['line'], T['ink4'], T['ink3'], folded[0], icon('chev_d', 13, T['ink4']), folded[1])
    return card(head + grid(cols_html, cols, 20) + fold + extra, pad='12px 16px', gap=10)


def flow_steps(items, tone='accent'):
    """「确认后将发生」横向流程：圆角块 + 箭头。"""
    out = []
    for i, t in enumerate(items):
        out.append('<div style="font-size: 12px; font-weight: 600; color: %s; background: #ffffff; border: 1px solid %s; border-radius: 6px; padding: 5px 9px; white-space: nowrap;">%s</div>' % (
            T['ink2'], T['line'], t))
        if i < len(items) - 1:
            out.append(icon('arrow_r', 14, T['ink4']))
    return row(''.join(out), 6, wrap=True)


def parallel_bar(items, right=''):
    """详情页步骤条下方的「并行」条：比例协商、内部结算等与主流程并行的维度。
    items: [(名称, 状态 html, 说明)]"""
    parts = []
    for i, (lb, st, desc) in enumerate(items):
        if i:
            parts.append(divider(True, 16))
        parts.append(row(nowrap(lb, 12, T['ink3'], 600) + st + (nowrap(desc, 12, T['ink2']) if desc else ''), 8))
    return '<div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; background: %s; border: 1px solid %s; border-radius: 8px; padding: 7px 12px;"><div style="display: flex; align-items: center; gap: 14px; min-width: 0px;">%s%s</div>%s</div>' % (
        T['subtle'], T['line'], chip('并行', 'flow', 10), ''.join(parts), right)


def reg_card(fields, extra='', title='登记信息'):
    """登记信息：两列键值。fields: [(键, 值 html, 是否已填)]，第四项为 True 时跨两列。"""
    n = sum(1 for f in fields if f[2])
    cells = ''
    for f in fields:
        k, v, ok = f[0], f[1], f[2]
        span = len(f) > 3 and f[3]
        cells += '<div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; min-width: 0px; min-height: 20px; font-size: 12px;%s"><div style="color: %s; white-space: nowrap;">%s</div><div style="font-weight: 600; color: %s; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums;">%s</div></div>' % (
            ' grid-column: span 2;' if span else '', T['ink3'], k, T['ink'], v)
    tone = 'success' if n == len(fields) else 'warning'
    head = between(label(title), row('<div style="width: 64px;">%s</div>' % progress(int(round(n * 100.0 / len(fields))), tone, 4) +
                                     nowrap('已填 %d / %d' % (n, len(fields)), 12, T['ok'] if n == len(fields) else T['warn'], 600), 8))
    return card(head + grid(cells, 2, 4, extra='column-gap: 20px;') + extra, pad='12px 14px', gap=8)


def comment(name, av, tone, time_, body, role=None):
    """留言（工厂协同、本单沟通）。"""
    r = chip(role, 'flow' if role == '生产厂' else 'neutral', 10) if role else ''
    return '<div style="display: flex; gap: 8px; align-items: flex-start;">%s<div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 2px;"><div style="display: flex; align-items: center; gap: 6px;"><div style="font-size: 12px; font-weight: 700; color: %s;">%s</div>%s<div style="font-size: 11px; color: %s; font-variant-numeric: tabular-nums;">%s</div></div><div style="font-size: 12px; color: %s; line-height: 1.55;">%s</div></div></div>' % (
        avatar(av, tone, 24), T['ink'], name, r, T['ink4'], time_, T['ink2'], body)


def sys_comment(time_, body):
    return comment('系统', '系', 'grey', time_, body)


def dashed_card(body, pad='14px 16px', gap=8):
    """虚线卡：规划中、未接入的能力（第三阶段）。"""
    return '<div style="border: 1px dashed %s; border-radius: 8px; background: %s; padding: %s; display: flex; flex-direction: column; gap: %dpx;">%s</div>' % (
        T['line_strong'], T['subtle'], pad, gap, body)


def toggle_off_disabled(t=None):
    """禁用的开关（条件不满足时不可切换）。"""
    lab = '<div style="font-size: 13px; color: %s;">%s</div>' % (T['ink4'], t) if t else ''
    return '<div style="display: inline-flex; align-items: center; gap: 8px;"><div style="width: 32px; height: 20px; box-sizing: border-box; border-radius: 999px; background: %s; border: 1px solid %s; display: flex; align-items: center;"><div style="width: 14px; height: 14px; border-radius: 999px; background: %s; margin-left: 2px;"></div></div>%s</div>' % (
        T['line2'], T['line'], T['line_strong'], lab)


def toggle_on_locked(t=None):
    """开启且不可关闭的开关（安全事故、平台风险）。"""
    lab = '<div style="font-size: 13px; color: %s;">%s</div>' % (T['ink3'], t) if t else ''
    return '<div style="display: inline-flex; align-items: center; gap: 6px;"><div style="width: 32px; height: 20px; box-sizing: border-box; border-radius: 999px; background: %s; display: flex; align-items: center;"><div style="width: 16px; height: 16px; border-radius: 999px; background: #ffffff; margin-left: 14px;"></div></div>%s%s</div>' % (
        T['accent_line'], icon('lock', 13, T['ink4']), lab)


def group_table(cols, groups, template, footer=None):
    """分组表格：表头 + 每组一条组标题行（状态 + 说明 + 小计）+ 组内行。
    groups: [(组标题 html, 右侧小计 html, rows)]"""
    head = ''.join('<div style="text-align: %s; min-width: 0px;">%s</div>' % (a, c) for c, a in cols)
    out = '<div style="display: grid; grid-template-columns: %s; gap: 12px; padding: 9px 16px; background: %s; border-bottom: 1px solid %s; font-size: 11px; font-weight: 700; color: %s; letter-spacing: 0.02em; white-space: nowrap;">%s</div>' % (
        template, T['subtle'], T['line'], T['ink3'], head)
    for gt, gr, rows in groups:
        out += '<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 16px; background: %s; border-bottom: 1px solid %s;"><div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: %s;">%s</div><div style="font-size: 12px; color: %s; font-variant-numeric: tabular-nums;">%s</div></div>' % (
            T['canvas'], T['line'], T['ink2'], gt, T['ink3'], gr)
        for r in rows:
            cells = ''.join('<div style="text-align: %s; min-width: 0px;">%s</div>' % (cols[j][1], c) for j, c in enumerate(r))
            out += '<div style="display: grid; grid-template-columns: %s; gap: 12px; padding: 9px 16px; background: #ffffff; border-bottom: 1px solid %s; font-size: 13px; color: %s; align-items: center; font-variant-numeric: tabular-nums;">%s</div>' % (
                template, T['line2'], T['ink'], cells)
    if footer:
        cells = ''.join('<div style="text-align: %s; min-width: 0px;">%s</div>' % (cols[j][1], c) for j, c in enumerate(footer))
        out += '<div style="display: grid; grid-template-columns: %s; gap: 12px; padding: 10px 16px; background: %s; font-size: 13px; font-weight: 700; color: %s; align-items: center; font-variant-numeric: tabular-nums;">%s</div>' % (
            template, T['subtle'], T['ink'], cells)
    return '<div style="background: #ffffff; border: 1px solid %s; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; box-shadow: %s;">%s</div>' % (T['line'], SHADOW_XS, out)


def table_span(cols, rows, template, footer, dense=True, row_tones=None, gap=12):
    """与 ui.table 同样式，合计行的格子可跨列。footer: [(html, 'left'|'right', 跨列数)]"""
    py = 8 if dense else 10
    head = ''.join('<div style="text-align: %s; min-width: 0px;">%s</div>' % (a, c) for c, a in cols)
    out = '<div style="display: grid; grid-template-columns: %s; gap: %dpx; padding: 9px 16px; background: %s; border-bottom: 1px solid %s; font-size: 11px; font-weight: 700; color: %s; letter-spacing: 0.02em; white-space: nowrap;">%s</div>' % (
        template, gap, T['subtle'], T['line'], T['ink3'], head)
    for i, r in enumerate(rows):
        tone = (row_tones or {}).get(i)
        bar = 'box-shadow: inset 3px 0 0 %s;' % {'warning': T['warn_solid'], 'danger': T['bad_solid'], 'accent': T['accent']}[tone] if tone else ''
        cells = ''.join('<div style="text-align: %s; min-width: 0px;">%s</div>' % (cols[j][1], c) for j, c in enumerate(r))
        out += '<div style="display: grid; grid-template-columns: %s; gap: %dpx; padding: %dpx 16px; background: #ffffff; border-bottom: 1px solid %s; font-size: 13px; color: %s; align-items: center; font-variant-numeric: tabular-nums; %s">%s</div>' % (
            template, gap, py, T['line2'], T['ink'], bar, cells)
    cells = ''.join('<div style="text-align: %s; min-width: 0px; grid-column: span %d;">%s</div>' % (a, n, c) for c, a, n in footer)
    out += '<div style="display: grid; grid-template-columns: %s; gap: %dpx; padding: 10px 16px; background: %s; font-size: 13px; font-weight: 700; color: %s; align-items: center; font-variant-numeric: tabular-nums;">%s</div>' % (
        template, gap, T['subtle'], T['ink'], cells)
    return '<div style="background: #ffffff; border: 1px solid %s; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; box-shadow: %s;">%s</div>' % (T['line'], SHADOW_XS, out)


def scaled(inner, w=1440, h=900, s=0.5):
    """整页缩小放进状态板（与 build_ds.py 同法）。"""
    return '<div style="width: %dpx; height: %dpx; overflow: hidden; position: relative;"><div style="position: absolute; left: 0px; top: 0px; width: %dpx; height: %dpx; transform: scale(%s); transform-origin: 0px 0px;">%s</div></div>' % (
        int(w * s), int(h * s), w, h, s, inner)


def frame(inner, w=864, bg=None, pad='16px', gap=12):
    """状态板局部画面（高度随内容）。"""
    return '<div style="width: %dpx; box-sizing: border-box; background: %s; padding: %s; display: flex; flex-direction: column; gap: %dpx;">%s</div>' % (
        w, bg or T['canvas'], pad, gap, inner)


def cap(t):
    """状态板画面内的小分图说明（例如「寄出前」「寄出后」）。"""
    return '<div style="display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; color: %s;"><div style="width: 6px; height: 6px; border-radius: 999px; background: %s;"></div>%s</div>' % (
        T['ink3'], T['ink4'], t)


def overlay(inner, dlg, w, h):
    """局部画面上盖遮罩并居中弹窗。"""
    return '<div style="width: %dpx; height: %dpx; position: relative; overflow: hidden;">%s<div style="position: absolute; inset: 0px; background: rgba(16,24,40,0.45); display: flex; align-items: center; justify-content: center;">%s</div></div>' % (
        w, h, inner, dlg)


def toast_at(inner, t, w, h, top=16, right=16):
    """局部画面右上角叠加浮层提示。"""
    return '<div style="width: %dpx; height: %dpx; position: relative; overflow: hidden;">%s<div style="position: absolute; top: %dpx; right: %dpx;">%s</div></div>' % (
        w, h, inner, top, right, t)


def img_thumb(t, w=72, h=54):
    """附件图片缩略图占位。"""
    return '<div style="width: %dpx; height: %dpx; box-sizing: border-box; border: 1px solid %s; border-radius: 6px; background: %s; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; flex-shrink: 0;">%s<div style="font-size: 11px; color: %s; white-space: nowrap;">%s</div></div>' % (
        w, h, T['line'], T['subtle'], icon('image', 16, T['ink4']), T['ink3'], t)


def bullet(t, color=None):
    return '<div style="display: flex; gap: 8px; align-items: flex-start; font-size: 12px; line-height: 1.55; color: %s;"><div style="width: 4px; height: 4px; border-radius: 999px; background: %s; margin-top: 8px; flex-shrink: 0;"></div><div style="min-width: 0px;">%s</div></div>' % (
        color or T['ink2'], T['ink4'], t)


# ---------------------------------------------------------------- 售后单详情版式（P09–P11 共用）
def as_detail(user, crumbs, title, chips, meta, actions, steps, par_items, left, right, par_right='', banner_html=None, right_w=400, blocker_html=None):
    """售后单详情：标题区（标题 + 状态徽标；分支、责任、渠道、店铺并入元信息行）+ 当前卡点 + 步骤条 + 并行条；下方左执行记录、右费用与承担。"""
    below = (blocker_html or '') + '<div style="padding: 2px 0px 0px 0px;">%s</div>' % stepper(steps) + parallel_bar(par_items, par_right)
    head = detail_head(title, chips, actions, meta, col(below, 10))
    bn = '<div style="padding: 12px 24px 0px 24px; flex-shrink: 0;">%s</div>' % banner_html if banner_html else ''
    body = head + bn + two_col(left, right, right_w, 16, '12px 24px 16px 24px')
    return app(user, '售后', crumbs, body)


def log_card(items, title='执行记录', extra=None):
    """执行记录卡。items: [(时间, 执行者姓名或「系统」, 内容)]；执行者为中性标签 + 头像。"""
    body = col(''.join(log_row(t, w, b) for t, w, b in items), 8)
    return card(body, title, extra, pad='12px 16px', gap=10)


def meta_line(parts):
    out = []
    for i, p in enumerate(parts):
        if i:
            out.append('<div style="width: 3px; height: 3px; border-radius: 999px; background: %s;"></div>' % T['ink4'])
        out.append('<div style="white-space: nowrap;">%s</div>' % p)
    return ''.join(out)


# ---------------------------------------------------------------- 设置左侧菜单（P18–P20 共用）
SETTINGS_MENU = [
    ('渠道与店铺', 'store', '管理员'),
    ('动作映射', 'link', '管理员'),
    ('处理规则', 'shield', '客服主管'),
    ('售后规则', 'box', '客服主管'),
    ('标签库', 'tag', '客服主管'),
    ('工厂账号', 'factory', '管理员'),
    ('团队与权限', 'users', '管理员'),
    ('模板', 'file', '客服主管'),
    ('SLA', 'clock', '客服主管'),
]


def settings_menu(active, role):
    """设置二级菜单。当前角色无权编辑的项显示锁形图标（点击进入无权限状态）。"""
    items = ''
    for name, ic, owner in SETTINGS_MENU:
        on = name == active
        allowed = owner == role
        c = T['accent_ink'] if on else (T['ink2'] if allowed else T['ink4'])
        items += '<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 34px; box-sizing: border-box; padding: 0px 10px; border-radius: 6px; background: %s;"><div style="display: flex; align-items: center; gap: 9px;">%s<div style="font-size: 13px; font-weight: %d; color: %s; white-space: nowrap;">%s</div></div>%s</div>' % (
            T['accent_bg'] if on else 'transparent', icon(ic, 16, T['accent'] if on else (T['ink3'] if allowed else T['ink4'])), 700 if on else 500, c, name,
            '' if allowed else icon('lock', 13, T['ink4']))
    foot = '<div style="margin-top: auto; padding: 10px; border-top: 1px solid %s; display: flex; flex-direction: column; gap: 4px;"><div style="font-size: 11px; color: %s; line-height: 1.5;">带锁的项由%s维护</div><div style="display: flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 500; color: %s;">%s查看审计日志</div></div>' % (
        T['line'], T['ink4'], '客服主管' if role == '管理员' else '管理员', T['accent'], icon('history', 14, T['accent']))
    return '<div style="width: 208px; flex-shrink: 0; box-sizing: border-box; background: #ffffff; border: 1px solid %s; border-radius: 16px; box-shadow: 0 1px 2px rgba(16,20,35,0.04); overflow: hidden; margin: 10px 0px 12px 14px; padding: 14px 10px; display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 16px; font-weight: 700; color: %s; padding: 0px 10px 10px 10px;">设置</div>%s%s</div>' % (
        T['line'], T['ink'], items, foot)


def settings_page(user, active, title, desc, actions, inner):
    role = STAFF[user]['role']
    head = between(col('<div style="font-size: 20px; font-weight: 700; color: %s; letter-spacing: -0.01em;">%s</div><div style="font-size: 13px; color: %s;">%s</div>' % (T['ink'], title, T['ink3'], desc), 4), row(actions, 8), 'flex-end')
    main = '<div style="flex: 1; min-width: 0px; padding: 16px 24px; display: flex; flex-direction: column; gap: 14px; overflow: hidden;">%s%s</div>' % (head, inner)
    body = '<div style="flex: 1; min-height: 0px; display: flex; flex-direction: row;">%s%s</div>' % (settings_menu(active, role), main)
    return app(user, '设置', ['设置', active], body)
