# -*- coding: utf-8 -*-
"""页面脚本共用的组合部件（只用 ui.py 组件与 T 色板）。报告里列出，便于并入组件库。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ui import *
from data import *


def mtable(cols, rows, template, selected=(), bars=None, dense=True, footer=None, fs='13px', py=None):
    """table() 的多选版：selected 为选中行下标集合（浅靛蓝底 + 左侧靛蓝条）；bars: {下标: 'warning'|'danger'|'accent'}。
    其余样式与 ui.table 完全一致。"""
    py = py if py is not None else (8 if dense else 10)
    head = ''.join('<div style="text-align: %s; min-width: 0px;">%s</div>' % (a, c) for c, a in cols)
    out = '<div style="display: grid; grid-template-columns: %s; gap: 12px; padding: 9px 16px; background: %s; border-bottom: 1px solid %s; font-size: 11px; font-weight: 700; color: %s; letter-spacing: 0.02em; white-space: nowrap; align-items: center;">%s</div>' % (
        template, T['subtle'], T['line'], T['ink3'], head)
    for i, r in enumerate(rows):
        on = i in selected
        bg = T['accent_bg'] if on else '#ffffff'
        tone = (bars or {}).get(i)
        bar = ''
        if on:
            bar = 'box-shadow: inset 3px 0 0 %s;' % T['accent']
        elif tone:
            bar = 'box-shadow: inset 3px 0 0 %s;' % {'warning': T['warn_solid'], 'danger': T['bad_solid'], 'accent': T['accent']}[tone]
        cells = ''.join('<div style="text-align: %s; min-width: 0px;">%s</div>' % (cols[j][1], c) for j, c in enumerate(r))
        out += '<div style="display: grid; grid-template-columns: %s; gap: 12px; padding: %dpx 16px; background: %s; border-bottom: 1px solid %s; font-size: %s; color: %s; align-items: center; font-variant-numeric: tabular-nums; %s">%s</div>' % (
            template, py, bg, T['line2'], fs, T['ink'], bar, cells)
    if footer:
        cells = ''.join('<div style="text-align: %s; min-width: 0px;">%s</div>' % (cols[j][1], c) for j, c in enumerate(footer))
        out += '<div style="display: grid; grid-template-columns: %s; gap: 12px; padding: 10px 16px; background: %s; font-size: 13px; font-weight: 700; color: %s; align-items: center; font-variant-numeric: tabular-nums;">%s</div>' % (
            template, T['subtle'], T['ink'], cells)
    return '<div style="background: #ffffff; border: 1px solid %s; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; box-shadow: %s;">%s</div>' % (T['line'], SHADOW_XS, out)


def table_empty(cols, template, empty_html):
    """表头 + 表体空状态（同一容器，样式与 ui.table 一致）。"""
    head = ''.join('<div style="text-align: %s; min-width: 0px;">%s</div>' % (a, c) for c, a in cols)
    return '<div style="background: #ffffff; border: 1px solid %s; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; box-shadow: %s;"><div style="display: grid; grid-template-columns: %s; gap: 12px; padding: 9px 16px; background: %s; border-bottom: 1px solid %s; font-size: 11px; font-weight: 700; color: %s; letter-spacing: 0.02em; white-space: nowrap;">%s</div>%s</div>' % (
        T['line'], SHADOW_XS, template, T['subtle'], T['line'], T['ink3'], head, empty_html)


def metric_tile(k, v, sub=None, tone=None, active=False, note=None):
    """可点击的紧凑指标（点击即按该条件筛选）：标签 / 数值 + 说明。比 kpi() 矮，用于列表页顶部。"""
    vc = {'danger': T['bad'], 'warning': T['warn'], 'success': T['ok'], 'accent': T['accent_ink']}.get(tone, T['ink'])
    bd = T['accent'] if active else T['line']
    bg = T['accent_bg'] if active else '#ffffff'
    s = '<div style="font-size: 12px; color: %s; white-space: nowrap;">%s</div>' % (T['ink3'], sub) if sub else ''
    n = '<div style="font-size: 11px; color: %s; white-space: nowrap;">%s</div>' % (T['ink4'], note) if note else ''
    return '<div style="background: %s; border: 1px solid %s; border-radius: 8px; padding: 10px 14px; box-shadow: %s; display: flex; flex-direction: column; gap: 2px; min-width: 0px;"><div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;"><div style="font-size: 12px; color: %s; white-space: nowrap;">%s</div>%s</div><div style="display: flex; align-items: baseline; gap: 8px;"><div style="font-size: 20px; font-weight: 700; color: %s; line-height: 1.25; font-variant-numeric: tabular-nums;">%s</div>%s</div></div>' % (
        bg, bd, SHADOW_XS, T['ink3'], k, n or icon('filter', 13, T['ink4']), vc, v, s)


def cbox(on=False):
    """表格里的复选框（不带文字）。"""
    return '<div style="width: 16px; height: 16px; box-sizing: border-box; border-radius: 4px; background: %s; border: 1.5px solid %s; display: flex; align-items: center; justify-content: center;">%s</div>' % (
        T['accent'] if on else '#ffffff', T['accent'] if on else T['line_strong'], icon('check', 12, '#ffffff', 2.5) if on else '')


def cbox_partial():
    return '<div style="width: 16px; height: 16px; box-sizing: border-box; border-radius: 4px; background: %s; border: 1.5px solid %s; display: flex; align-items: center; justify-content: center;"><div style="width: 8px; height: 2px; background: #ffffff; border-radius: 999px;"></div></div>' % (
        T['accent'], T['accent'])


def flow_arrow():
    return icon('chev_r', 12, T['ink4'], 2)


def scaled(inner, w=1440, h=900, s=0.5):
    return '<div style="width: %dpx; height: %dpx; overflow: hidden; position: relative;"><div style="position: absolute; left: 0px; top: 0px; width: %dpx; height: %dpx; transform: scale(%s); transform-origin: 0px 0px;">%s</div></div>' % (
        int(w * s), int(h * s), w, h, s, inner)


def white_panel(inner, pad='16px 20px', gap=12, extra=''):
    return '<div style="background: #ffffff; border-bottom: 1px solid %s; padding: %s; display: flex; flex-direction: column; gap: %dpx; flex-shrink: 0;%s">%s</div>' % (
        T['line'], pad, gap, (' ' + extra) if extra else '', inner)


def sec_title(t, extra=''):
    """卡片内的区块标题（13 / 700）+ 右侧操作。"""
    return between(text(t, 13, T['ink'], 700), extra)
