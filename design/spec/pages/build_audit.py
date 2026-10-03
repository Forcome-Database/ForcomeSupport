# -*- coding: utf-8 -*-
"""P27 审计日志（AuditLog）：顶层页面，从顶栏头像菜单进入（所有角色），管理员另可从 P18 页头进入；周敏 · 客服主管视角（看全部）。
表格、展开行与「已隐藏」写法由 StatesAdmin K18（可见范围）复用：audit_table / audit_expand / audit_page_head。
只用 ui.py 组件与 T 色板组合。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from data import *

NAME_KEY = {v['name']: k for k, v in STAFF.items()}
OBJ_TYPES = ['工单', '来信', '售后单', '审批单', '店铺', '渠道', '成员', '设置', '导出', '登录']  # 对象类型筛选项（prd_c P27）
LINKABLE = ('工单', '来信', '售后单', '审批单', '店铺', '成员', '渠道')  # 对象编号可点进详情的类型

COLS = [('时间', 'left'), ('操作人', 'left'), ('对象', 'left'), ('动作', 'left'), ('变更摘要', 'left'), ('来源 IP', 'left'), ('', 'right')]
TPL = '64px 150px 250px 130px minmax(0, 1fr) 100px 16px'


def actor_cell(name, role):
    """操作人：头像 + 姓名 + 角色；系统操作写「系统」。"""
    if name == '系统':
        return row(avatar('系', 'grey', 22) + nowrap('系统', 13, T['ink'], 600), 8)
    s = STAFF[NAME_KEY[name]]
    return row(avatar(s['avatar'], AV_TONE.get(role, 'grey'), 22) + nowrap(name, 13, T['ink'], 600) + nowrap(role, 12, T['ink4']), 6)


def obj_cell(kind, obj):
    """对象：类型（灰）+ 编号（可点进详情的为主色）。"""
    c, w = (T['accent'], 600) if kind in LINKABLE else (T['ink2'], 400)
    return row(nowrap(kind, 12, T['ink4']) + ellipsis(obj, 13, c, w), 6)


def action_cell(act, denied):
    """动作：越权访问被拒为红色标签（E-24）；AI 产出的动作用 ✦ 渐变徽标。"""
    if denied:
        return '<div style="display: flex;">%s</div>' % chip(act, 'danger', 11, 'lock')
    if act.startswith('✦'):
        return '<div style="display: flex;">%s</div>' % ai_badge(act.lstrip('✦ '), 11)
    return nowrap(act, 13, T['ink'], 600)


def summary_text(summary, n_fields=1):
    """变更摘要「字段：前 → 后」；展开项多于一个字段时写「等 N 项」。"""
    s = summary + ('<span style="color: %s;"> 等 %d 项</span>' % (T['ink4'], n_fields) if n_fields > 1 else '')
    return ellipsis(s, 12, T['ink2'])


def audit_row_cells(r, expanded=None, n_fields=1, cols=COLS):
    tm, name, role, kind, obj, act, summ, ip, denied = r
    chev = icon('chev_d' if expanded else 'chev_r', 14, T['ink4'], 2)
    cells = [nowrap(tm, 12, T['ink3']), actor_cell(name, role), obj_cell(kind, obj), action_cell(act, denied),
             summary_text(summ, n_fields), nowrap(ip, 12, T['ink3']), chev]
    keep = [c for c, _ in COLS]
    return [cells[keep.index(c)] for c, _ in cols]


def audit_table(rows, expand_at=None, expand_html='', n_fields=1, cols=COLS, tpl=TPL, py=7):
    """审计表：样式同 ui.table；越权访问行左侧红条；expand_at 行下方插入展开区（两栏前后值）。"""
    head = ''.join('<div style="text-align: %s; min-width: 0px;">%s</div>' % (a, c) for c, a in cols)
    out = '<div style="display: grid; grid-template-columns: %s; gap: 12px; padding: 9px 16px; background: %s; border-bottom: 1px solid %s; font-size: 11px; font-weight: 600; color: %s; letter-spacing: 0.02em; white-space: nowrap;">%s</div>' % (
        tpl, T['subtle'], T['line'], T['ink4'], head)
    for i, r in enumerate(rows):
        on = i == expand_at
        bar = 'box-shadow: inset 3px 0 0 %s;' % (T['bad_solid'] if r[8] else T['accent']) if (r[8] or on) else ''
        cells = ''.join('<div style="text-align: %s; min-width: 0px;">%s</div>' % (cols[j][1], c)
                        for j, c in enumerate(audit_row_cells(r, on, n_fields if on else 1, cols)))
        bg = T['bad_bg'] if r[8] else (T['accent_bg'] if on else '#ffffff')
        out += '<div style="display: grid; grid-template-columns: %s; gap: 12px; padding: %dpx 16px; background: %s; border-bottom: 1px solid %s; font-size: 13px; color: %s; align-items: center; font-variant-numeric: tabular-nums; %s">%s</div>' % (
            tpl, py, bg, T['line2'], T['ink'], bar, cells)
        if on and expand_html:
            out += '<div style="padding: 12px 16px 14px 92px; background: %s; border-bottom: 1px solid %s; box-shadow: inset 3px 0 0 %s;">%s</div>' % (T['subtle'], T['line'], T['accent'], expand_html)
    return '<div style="background: #ffffff; border: 1px solid %s; border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; box-shadow: %s;">%s</div>' % (T['line'], SHADOW_XS, out)


def hidden_val():
    return '<div style="display: flex;">%s</div>' % chip('已隐藏', 'muted', 11, 'lock')


def audit_expand(fields, hide_fin=False, meta=''):
    """展开区：两栏对照完整前后值。fields: [(字段, 前, 后[, 是否财务字段])]；hide_fin=True 时财务字段前后值显示灰色「已隐藏」（10.2、K18）。
    变更后的值高亮（主色浅底）；「同左」视为未变更。"""
    def pane(title, idx):
        rows_ = ''
        for f in fields:
            k, b, a = f[0], f[1], f[2]
            fin = len(f) > 3 and f[3]
            changed = a not in (b, '同左')
            v = (b, a)[idx]
            if fin and hide_fin:
                val = hidden_val()
            elif idx == 1 and changed:
                val = '<span style="background: %s; color: %s; font-weight: 600; border-radius: 4px; padding: 1px 5px; white-space: nowrap;">%s</span>' % (T['accent_bg'], T['accent_ink'], v)
            else:
                val = '<span style="color: %s; white-space: nowrap;">%s</span>' % (T['ink2'] if v not in ('—', '同左') else T['ink4'], v)
            rows_ += '<div style="display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 10px; align-items: center; min-height: 22px; font-size: 12px;"><div style="color: %s; white-space: nowrap;">%s%s</div><div style="min-width: 0px;">%s</div></div>' % (
                T['ink3'], k, ' ' + icon('money', 11, T['ink4']) if fin else '', val)
        return '<div style="flex: 1; min-width: 0px; background: #ffffff; border: 1px solid %s; border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px;">%s%s</div>' % (
            T['line'], label(title, 'padding-bottom: 4px;'), rows_)
    m = '<div style="font-size: 12px; color: %s; padding-top: 8px;">%s</div>' % (T['ink4'], meta) if meta else ''
    return '<div style="display: flex; align-items: stretch; gap: 10px;">%s<div style="display: flex; align-items: center;">%s</div>%s</div>%s' % (
        pane('变更前', 0), icon('arrow_r', 16, T['ink4']), pane('变更后', 1), m)


def audit_page_head(note='', actions=None, title_extra=''):
    """页头：标题 + 说明 + 右上「导出」（按当前筛选导出，导出本身也记审计）。"""
    act = actions if actions is not None else btn('导出', 'secondary', 'md', 'download')
    return between(col(row('<div style="font-size: 20px; font-weight: 700; color: %s; letter-spacing: -0.015em;">审计日志</div>' % T['ink'] + title_extra, 10) +
                       '<div style="font-size: 13px; color: %s;">全部操作记录 · 保留不少于 2 年%s</div>' % (T['ink3'], note), 4), act, 'flex-end')


def audit_filters(who=None, period='今天', obj_q=None, who_locked=False, compact=False):
    """筛选：时间 · 操作人 · 对象类型 · 动作 · 对象编号搜索；条件写在地址栏。who_locked=True 时操作人锁定为本人（K18）；compact 用于窄画面（去掉动作筛选与地址栏说明）。"""
    if who_locked:
        who_html = '<div title="你只能看到自己的操作记录" style="height: 28px; box-sizing: border-box; display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: %s; background: %s; border: 1px solid %s; border-radius: 8px; padding: 0px 10px; white-space: nowrap;">操作人：<span style="font-weight: 600; color: %s;">%s</span>%s</div>' % (
            T['ink3'], T['subtle'], T['line'], T['ink2'], who, icon('lock', 12, T['ink4']))
    else:
        who_html = filter_chip('操作人', who or '全部', bool(who))
    left = row(seg(['今天', '近 7 天', '自定义'], period) + divider(True, 16) + who_html + filter_chip('对象类型', '全部') + ('' if compact else filter_chip('动作', '全部')) +
               search_box('搜索对象编号', '180px' if compact else '200px', obj_q, shortcut=False), 8)
    return between(left, '' if compact else row(icon('link', 13, T['ink4']) + nowrap('筛选条件写在地址栏', 12, T['ink4']), 4))


def p27(phase1=False):
    """P27；phase1=True 为第一阶段版：第一阶段外壳，只列第一阶段会出现的对象类型（没有审批单、生产厂对接人与 ✦ 建议，prd_c P27「第一阶段」）。"""
    log = [r for r in AUDIT_LOG if not (phase1 and (r[3] == '审批单' or r[2] == '生产厂对接人' or r[5].startswith('✦')))]
    r0 = log[0]
    meta = '%s · %s · %s · 来源 IP %s' % ('09-11 ' + r0[0], r0[1], r0[2], r0[7])
    exp = audit_expand(AUDIT_P27_EXPAND, meta=meta)
    denied = sum(1 for r in log if r[8])
    legend = row(row(chip('越权访问被拒', 'danger', 11, 'lock') + nowrap('E-24，红色标出', 12, T['ink3']), 6) + divider(True, 12) +
                 ('' if phase1 else row(ai_badge('AI', 10) + nowrap('AI 产出的建议', 12, T['ink3']), 6) + divider(True, 12)) +
                 row(icon('money', 13, T['ink4']) + nowrap('财务字段：无财务权限的角色看到「已隐藏」', 12, T['ink3']), 6), 12)
    head = '<div style="padding: 16px 24px 2px 24px; flex-shrink: 0;">%s</div>' % audit_page_head()
    tbl_head = between(row(label('09-11 今天') + nowrap('共 %d 条 · 越权访问 %d 条 · 点行展开完整前后值' % (len(log), denied), 12, T['ink3']), 8), legend)
    per = 10  # 每页 10 条，演示第 1 页
    pages_n = (len(log) + per - 1) // per
    foot = between(muted('共 %d 条 · 每页 %d 条' % (len(log), per)), row(btn('上一页', 'secondary', 'sm', disabled=True, reason='已是第一页') + nowrap('1 / %d' % pages_n, 12, T['ink2']) +
                                                          btn('下一页', 'secondary', 'sm', disabled=pages_n == 1, reason='已是最后一页'), 8))
    body = head + content(audit_filters() + col(tbl_head + audit_table(log[:per], 0, exp, len(AUDIT_P27_EXPAND)), 10) + foot, '14px 24px', 12)
    return app('zhoumin', '', ['审计日志'], body, phase1=phase1)


if __name__ == '__main__':
    save('AuditLog.dc.html', p27())
    print('ok')
