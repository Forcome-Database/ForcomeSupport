# -*- coding: utf-8 -*-
"""
Forcome Support 组件库（高保真原型唯一样式来源）

视觉 v3（参考 forcome-support-console.html，研发用 shadcn/ui + Tailwind CSS v4 实现）：
56px 白色顶栏 + 分段导航；浅灰底上的圆角浮动面板；靛蓝主色，靛蓝→青色渐变只用于 AI 标识、品牌标与内部成员头像；
语义色只表达状态。T 的每个键在设计规范板上有对应的 shadcn CSS 变量。
所有页面用 app() 或 factory_app() 生成外壳，内容区只用本文件的组件拼装。
不要在页面脚本里手写颜色、字号、圆角；需要新组件时在本文件里加，并同步到设计规范板。

用法：
    import sys; sys.path.insert(0, r'...\\design\\spec')
    from ui import *
    html = app('liting', '收件箱', ['收件箱', '待处理'], body)
    save('Main.dc.html', html)
"""
import io, os
from data import STAFF, NAV_BY_ROLE, FACTORY_NAV, BADGES

DESIGN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ================================================================ Tokens
T = {
    # 背景与线（shadcn：--background / --card / --muted / --border / --input）
    'canvas': '#f5f6fa', 'surface': '#ffffff', 'subtle': '#f7f8fc', 'hover': '#f1f3f9', 'track': '#f1f3f9',
    'line': '#e7e9f1', 'line2': '#eff1f7', 'line_strong': '#d8dce7',
    # 文字（--foreground / --muted-foreground）
    'ink': '#0f1320', 'ink2': '#3b4356', 'ink3': '#5a6376', 'ink4': '#9099ab',
    # 主色（--primary / --ring / --accent）
    'accent': '#4f46e5', 'accent_hover': '#4338ca', 'accent_ink': '#4338ca', 'accent_bg': '#f0effd', 'accent_line': '#d3d1f9',
    'cyan': '#06b6d4',
    # 语义色（--success / --warning / --destructive / --info，自定义 @theme 变量）
    'ok': '#0b8554', 'ok_bg': '#e7f5ee', 'ok_line': '#bfe4d2', 'ok_solid': '#0f9960',
    'warn': '#a9620a', 'warn_bg': '#faf0e2', 'warn_line': '#efd4aa', 'warn_solid': '#c2740a',
    'bad': '#c8313b', 'bad_bg': '#fcedee', 'bad_line': '#f4c8cb', 'bad_solid': '#dc3b45',
    'flow': '#6d28d9', 'flow_bg': '#f4f1fe', 'flow_line': '#ddd6fe',
    'info': '#2563eb', 'info_bg': '#e9f0fe', 'info_line': '#c5d6fb',
    # 渠道识别色（徽标）
    'amazon': '#2563eb', 'shopify': '#0f9960', 'mail': '#5a6376',
}
SHADOW_XS = '0 1px 2px rgba(16,20,35,0.04)'
SHADOW_CARD = '0 12px 32px -18px rgba(16,20,35,0.24)'
SHADOW_MD = '0 16px 36px -14px rgba(16,20,35,0.28)'
SHADOW_LG = '0 28px 64px -20px rgba(16,20,35,0.40)'
SHADOW_POP = '0 8px 18px -8px rgba(79,70,229,0.5)'
GRAD = 'linear-gradient(120deg, #4f46e5, #06b6d4)'
R = {'panel': 16, 'card': 13, 'ctrl': 9, 'chip': 6}  # 圆角：面板 / 卡片 / 控件 / 徽标（shadcn --radius = 0.8rem 派生）
FONT = '"Inter", "PingFang SC", "HarmonyOS Sans SC", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif'

# 状态 → 色调（全站唯一映射；页面里显示状态一律用 state()）
STATE_TONE = {
    # 工单
    '分诊中': 'neutral', '待审草稿': 'accent', '待审批': 'warning', '转人工': 'danger',
    '等客户': 'outline', '等内部': 'outline', '等外部': 'outline', '已解决': 'success', '已关闭': 'muted', '已合并': 'muted',
    # 售后单
    '待确认': 'warning', '进行中': 'accent', '已完成': 'success', '已取消': 'muted',
    # 审批单 / 报备
    '已批准': 'success', '已驳回': 'danger', '已超时': 'danger', '执行中': 'accent', '已执行': 'success', '执行失败': 'danger', '已撤回': 'muted',
    # 人工操作清单
    '待执行': 'warning', '已回填': 'success',
    # 协商
    '不适用': 'muted', '未发起': 'muted', '待工厂答复': 'accent', '工厂还价': 'warning', '待升级': 'danger', '已确认': 'success',
    # 结算
    '未定': 'muted', '待结算': 'accent', '已结算': 'success', '待生成': 'muted',
    # 工厂任务
    '待处理': 'warning', '已提交': 'accent', '已退回': 'danger', '已作废': 'muted',
    # 草稿
    '生成中': 'neutral', '待审': 'accent', '已采纳': 'success', '已拒绝': 'danger', '已失效': 'muted',
    # 渠道连接
    '已连接': 'success', '未连接': 'muted', '连接异常': 'danger', '同步延迟': 'warning',
    # 知识条目
    '有效': 'success', '即将过期': 'warning', '已过期': 'muted', '已停用': 'muted',
    # 订单与物流（来自平台接口）
    '未发货': 'neutral', '已发货': 'neutral', '已签收': 'success', '超预计送达': 'warning',
    # 工单处理标记
    '新建': 'neutral', 'AI 未处理': 'warning',
    # 成员与文档
    '已启用': 'success', '解析中': 'accent', '解析失败': 'danger',
}
TONES = {
    'neutral': ('#3b4356', '#f1f3f9', '#f1f3f9'),
    'muted':   ('#5a6376', '#f5f6fa', '#e7e9f1'),
    'outline': ('#3b4356', '#ffffff', '#d8dce7'),
    'accent':  (T['accent_ink'], T['accent_bg'], T['accent_bg']),
    'success': (T['ok'], T['ok_bg'], T['ok_bg']),
    'warning': (T['warn'], T['warn_bg'], T['warn_bg']),
    'danger':  (T['bad'], T['bad_bg'], T['bad_bg']),
    'flow':    (T['flow'], T['flow_bg'], T['flow_bg']),
    'info':    (T['info'], T['info_bg'], T['info_bg']),
}

# ================================================================ Icons（20×20 网格，1.75 描边）
ICONS = {
    'inbox': '<path d="M3 11l2.2-6h9.6L17 11v5H3z"></path><path d="M3 11h4l1.2 2h3.6L13 11h4"></path>',
    'ticket': '<path d="M3 6h14v3a1.5 1.5 0 0 0 0 3v3H3v-3a1.5 1.5 0 0 0 0-3z"></path><path d="M8 6v9"></path>',
    'box': '<path d="M3 7l7-4 7 4-7 4z"></path><path d="M3 7v6l7 4 7-4V7"></path><path d="M10 11v6"></path>',
    'approve': '<path d="M4 10.5l4 4 8-9"></path><rect x="2.5" y="2.5" width="15" height="15" rx="3"></rect>',
    'book': '<path d="M3 4h5a2 2 0 0 1 2 2v10a1.5 1.5 0 0 0-1.5-1.5H3z"></path><path d="M17 4h-5a2 2 0 0 0-2 2v10a1.5 1.5 0 0 1 1.5-1.5H17z"></path>',
    'chart': '<path d="M3 17h14"></path><path d="M5 14V9"></path><path d="M9 14V5"></path><path d="M13 14v-3"></path><path d="M17 14V7"></path>',
    'gear': '<circle cx="10" cy="10" r="2.5"></circle><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"></path>',
    'search': '<circle cx="9" cy="9" r="5.5"></circle><path d="M13.5 13.5L17 17"></path>',
    'bell': '<path d="M5 8a5 5 0 0 1 10 0c0 5 2 6.5 2 6.5H3S5 13 5 8"></path><path d="M8.5 17h3"></path>',
    'chev_r': '<path d="M7.5 4.5l5 5.5-5 5.5"></path>',
    'chev_d': '<path d="M5 7.5l5 5 5-5"></path>',
    'chev_l': '<path d="M12.5 4.5l-5 5.5 5 5.5"></path>',
    'plus': '<path d="M10 4v12M4 10h12"></path>',
    'filter': '<path d="M3 5h14l-5.5 6.5V16l-3 1.5v-6z"></path>',
    'sort': '<path d="M4 6h12M6 10h8M8 14h4"></path>',
    'clock': '<circle cx="10" cy="10" r="7"></circle><path d="M10 6v4l2.5 2"></path>',
    'alert': '<path d="M10 7.5v3.5"></path><path d="M10 14h.01"></path><path d="M8.6 3.3L2.4 14a1.6 1.6 0 0 0 1.4 2.4h12.4a1.6 1.6 0 0 0 1.4-2.4L11.4 3.3a1.6 1.6 0 0 0-2.8 0z"></path>',
    'info': '<circle cx="10" cy="10" r="7"></circle><path d="M10 9v4.5"></path><path d="M10 6.5h.01"></path>',
    'check': '<path d="M4.5 10.5l3.5 3.5 7.5-8"></path>',
    'check_c': '<circle cx="10" cy="10" r="7"></circle><path d="M7 10.2l2.2 2.2L13.2 8"></path>',
    'x': '<path d="M5 5l10 10M15 5L5 15"></path>',
    'x_c': '<circle cx="10" cy="10" r="7"></circle><path d="M7.5 7.5l5 5M12.5 7.5l-5 5"></path>',
    'refresh': '<path d="M16 10a6 6 0 0 1-10.5 4"></path><path d="M4 10a6 6 0 0 1 10.5-4"></path><path d="M14.5 2.5V6H11"></path><path d="M5.5 17.5V14H9"></path>',
    'link': '<path d="M8.5 11.5a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5l-.8.8"></path><path d="M11.5 8.5a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5l.8-.8"></path>',
    'image': '<rect x="3" y="4" width="14" height="12" rx="2"></rect><circle cx="7.5" cy="8.5" r="1.5"></circle><path d="M17 13l-4-4-7 7"></path>',
    'clip': '<path d="M15.5 9.5l-5.6 5.6a3.5 3.5 0 0 1-5-5l6-6a2.3 2.3 0 0 1 3.3 3.3l-6 6a1.2 1.2 0 0 1-1.7-1.7l5.4-5.4"></path>',
    'send': '<path d="M17 3L8.5 11.5"></path><path d="M17 3l-5 14-3.5-5.5L3 8z"></path>',
    'spark': '<path d="M10 2.5l1.6 4.4 4.4 1.6-4.4 1.6L10 14.5l-1.6-4.4L4 8.5l4.4-1.6z"></path><path d="M15.5 13.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z"></path>',
    'user': '<circle cx="10" cy="7" r="3.5"></circle><path d="M3.5 17a6.5 6.5 0 0 1 13 0"></path>',
    'users': '<circle cx="7.5" cy="7" r="3"></circle><path d="M2 16.5a5.5 5.5 0 0 1 11 0"></path><path d="M13 4.2a3 3 0 0 1 0 5.6"></path><path d="M15 11.5a5.5 5.5 0 0 1 3 5"></path>',
    'store': '<path d="M3 8l1.5-4.5h11L17 8"></path><path d="M3 8a2.3 2.3 0 0 0 4.7 0 2.3 2.3 0 0 0 4.6 0A2.3 2.3 0 0 0 17 8"></path><path d="M4.5 10.5V17h11v-6.5"></path>',
    'lock': '<rect x="4" y="9" width="12" height="8.5" rx="2"></rect><path d="M7 9V6.5a3 3 0 0 1 6 0V9"></path>',
    'arrow_r': '<path d="M4 10h12"></path><path d="M11 5l5 5-5 5"></path>',
    'external': '<path d="M11 3.5h5.5V9"></path><path d="M16.5 3.5L9 11"></path><path d="M14 11.5v4a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 3 15.5v-8A1.5 1.5 0 0 1 4.5 6h4"></path>',
    'more': '<circle cx="5" cy="10" r="1"></circle><circle cx="10" cy="10" r="1"></circle><circle cx="15" cy="10" r="1"></circle>',
    'copy': '<rect x="7" y="7" width="10" height="10" rx="2"></rect><path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"></path>',
    'edit': '<path d="M13.5 3.5l3 3L7 16H4v-3z"></path>',
    'eye': '<path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z"></path><circle cx="10" cy="10" r="2.5"></circle>',
    'download': '<path d="M10 3v10"></path><path d="M6 9l4 4 4-4"></path><path d="M3.5 17h13"></path>',
    'upload': '<path d="M10 13V3"></path><path d="M6 7l4-4 4 4"></path><path d="M3.5 17h13"></path>',
    'factory': '<path d="M2.5 17V8l5 3V8l5 3V4h5v13z"></path><path d="M6 14h1M10 14h1M14 14h1"></path>',
    'truck': '<path d="M2.5 5h9v9h-9z"></path><path d="M11.5 8h3.5l2.5 3v3h-6"></path><circle cx="6" cy="15" r="1.6"></circle><circle cx="14.5" cy="15" r="1.6"></circle>',
    'money': '<rect x="2.5" y="5" width="15" height="10" rx="2"></rect><circle cx="10" cy="10" r="2.2"></circle>',
    'message': '<path d="M3.5 5h13v8.5a1.5 1.5 0 0 1-1.5 1.5H8l-4.5 3z"></path>',
    'translate': '<path d="M3 5h8M7 3v2M5 5c0 3 2 5.5 5 6.5"></path><path d="M9.5 5c-.5 3-2.5 5.5-6 6.5"></path><path d="M11 17l3-7 3 7M12 14.8h4"></path>',
    'tag': '<path d="M3 3.5h6.5L17 11l-6 6-7.5-7.5z"></path><circle cx="7" cy="7" r="1.2"></circle>',
    'merge': '<circle cx="5.5" cy="4.5" r="1.8"></circle><circle cx="5.5" cy="15.5" r="1.8"></circle><circle cx="14.5" cy="10" r="1.8"></circle><path d="M5.5 6.3v7.4M5.5 8c0 2 1.5 2 7.2 2"></path>',
    'shield': '<path d="M10 2.5l6 2.5v4.5c0 4-2.6 6.6-6 8-3.4-1.4-6-4-6-8V5z"></path>',
    'globe': '<circle cx="10" cy="10" r="7"></circle><path d="M3 10h14"></path><path d="M10 3c2 2 3 4.5 3 7s-1 5-3 7c-2-2-3-4.5-3-7s1-5 3-7z"></path>',
    'calendar': '<rect x="3" y="4.5" width="14" height="12.5" rx="2"></rect><path d="M3 8.5h14M7 2.5v4M13 2.5v4"></path>',
    'file': '<path d="M5 2.5h6.5L15 6v11.5H5z"></path><path d="M11.5 2.5V6H15"></path>',
    'wifi_off': '<path d="M2.5 2.5l15 15"></path><path d="M8 5.2A11 11 0 0 1 17.5 8"></path><path d="M2.5 8a11 11 0 0 1 3.3-2.1"></path><path d="M5.3 11.1a6.5 6.5 0 0 1 3-1.6"></path><path d="M10 15.5h.01"></path>',
    'spinner': '<path d="M10 3a7 7 0 1 0 7 7"></path>',
    'phone': '<rect x="5.5" y="2.5" width="9" height="15" rx="2"></rect><path d="M9 15h2"></path>',
    'star': '<path d="M10 3l2.1 4.4 4.9.6-3.6 3.4.9 4.8L10 13.9l-4.3 2.3.9-4.8L3 8l4.9-.6z"></path>',
    'history': '<path d="M3.5 10a6.5 6.5 0 1 0 2-4.7"></path><path d="M3 3.5v3.5h3.5"></path><path d="M10 6.5V10l2.5 1.5"></path>',
    'rows': '<path d="M3.5 6h13M3.5 10h13M3.5 14h13"></path>',
    'moon': '<path d="M16.5 12.2A6.8 6.8 0 0 1 7.8 3.5a6.8 6.8 0 1 0 8.7 8.7z"></path>',
    'panel': '<rect x="2.5" y="3.5" width="15" height="13" rx="2.5"></rect><path d="M12.5 3.5v13"></path>',
    'handoff': '<circle cx="7" cy="6.5" r="3"></circle><path d="M2 16.5a5 5 0 0 1 8.5-3.5"></path><path d="M13 13h5M15.5 10.5L18 13l-2.5 2.5"></path>',
}


def icon(name, size=16, color='#667085', sw=1.75):
    return '<svg width="%d" height="%d" viewBox="0 0 20 20" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;">%s</svg>' % (size, size, color, sw, ICONS[name])


# ================================================================ 基础
def esc(s):
    return s  # 文案由我们自己写，保持原样


def div(content='', style=''):
    return '<div style="%s">%s</div>' % (style, content)


def row(content, gap=8, align='center', justify='flex-start', wrap=False, extra=''):
    return '<div style="display: flex; flex-direction: row; align-items: %s; justify-content: %s; gap: %dpx;%s%s">%s</div>' % (
        align, justify, gap, ' flex-wrap: wrap;' if wrap else '', (' ' + extra) if extra else '', content)


def col(content, gap=8, extra=''):
    return '<div style="display: flex; flex-direction: column; gap: %dpx;%s">%s</div>' % (gap, (' ' + extra) if extra else '', content)


def between(left, right, align='center', extra=''):
    return '<div style="display: flex; align-items: %s; justify-content: space-between; gap: 12px;%s">%s%s</div>' % (align, (' ' + extra) if extra else '', left, right)


def grid(content, cols=2, gap=12, template=None, extra=''):
    tpl = template or 'repeat(%d, minmax(0, 1fr))' % cols
    return '<div style="display: grid; grid-template-columns: %s; gap: %dpx;%s">%s</div>' % (tpl, gap, (' ' + extra) if extra else '', content)


def text(t, size=13, color=None, weight=400, extra=''):
    return '<div style="font-size: %spx; font-weight: %d; color: %s; line-height: 1.5;%s">%s</div>' % (size, weight, color or T['ink'], (' ' + extra) if extra else '', t)


def muted(t, size=12, extra=''):
    return text(t, size, T['ink3'], 400, extra)


def strong(t, size=13, color=None):
    return text(t, size, color, 600)


def nowrap(t, size=12, color=None, weight=400):
    return '<div style="font-size: %spx; font-weight: %d; color: %s; white-space: nowrap;">%s</div>' % (size, weight, color or T['ink3'], t)


def ellipsis(t, size=13, color=None, weight=400):
    return '<div style="font-size: %spx; font-weight: %d; color: %s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0px;">%s</div>' % (size, weight, color or T['ink'], t)


def link(t, size=12, icon_name=None):
    ic = icon(icon_name, 14, T['accent']) if icon_name else ''
    return '<div style="display: inline-flex; align-items: center; gap: 4px; font-size: %spx; font-weight: 500; color: %s; white-space: nowrap;">%s%s</div>' % (size, T['accent'], t, ic)


def label(t, extra=''):
    """区块小标题：11.5px 半粗，字距。"""
    return '<div style="font-size: 11.5px; font-weight: 650; letter-spacing: 0.03em; color: %s;%s">%s</div>' % (T['ink3'], (' ' + extra) if extra else '', t)


def divider(vertical=False, h=16):
    if vertical:
        return '<div style="width: 1px; height: %dpx; background: %s; flex-shrink: 0;"></div>' % (h, T['line'])
    return '<div style="height: 1px; background: %s;"></div>' % T['line2']


def spacer():
    return '<div style="flex: 1;"></div>'


def kbd(k):
    return '<div style="font-size: 10.5px; font-weight: 500; color: %s; background: #ffffff; border: 1px solid %s; border-radius: 5px; padding: 0px 5px; line-height: 16px;">%s</div>' % (T['ink4'], T['line'], k)


# ================================================================ 徽标与状态
def chip(t, tone='neutral', size=11, icon_name=None, dot=False):
    fg, bg, bd = TONES[tone]
    ic = icon(icon_name, 12, fg, 2) if icon_name else ''
    d = '<div style="width: 5px; height: 5px; border-radius: 999px; background: %s;"></div>' % fg if dot else ''
    return '<div style="display: inline-flex; align-items: center; gap: 5px; font-size: %spx; font-weight: 600; color: %s; background: %s; border: 1px solid %s; border-radius: 6px; padding: 0px 7px; white-space: nowrap; line-height: 18px; flex-shrink: 0;">%s%s%s</div>' % (size, fg, bg, bd, d, ic, t)


def state(t, size=11, suffix=''):
    """显示任意业务状态。颜色由 STATE_TONE 统一决定。"""
    tone = STATE_TONE.get(t, 'neutral')
    return chip(t + suffix, tone, size, dot=True)


def cat(t, size=11):
    """分类值（意图、处理方式、责任类型等）：中性灰，不带语义色。"""
    return chip(t, 'neutral', size)


def pill(t, active=False):
    """坐席手工标签：浅灰圆角徽标（选中为主色浅底）。"""
    fg, bg = (T['accent_ink'], T['accent_bg']) if active else (T['ink2'], T['track'])
    return '<div style="display: inline-flex; align-items: center; font-size: 11px; font-weight: 550; color: %s; background: %s; border-radius: 6px; padding: 1px 7px; white-space: nowrap; line-height: 18px;">%s</div>' % (fg, bg, t)


def channel(platform, site=None, store=None, size=11):
    """渠道标识：平台徽标（亚马逊蓝、Shopify 绿、邮件灰）+ 店铺名。"""
    fg, bg = {'亚马逊': (T['info'], T['info_bg']), 'Shopify': (T['ok'], T['ok_bg'])}.get(platform, (T['ink3'], T['track']))
    t = platform + (' ' + site if site else '')
    b = '<div style="font-size: %spx; font-weight: 650; color: %s; background: %s; border-radius: 6px; padding: 0px 6px; line-height: 18px; white-space: nowrap; letter-spacing: 0.01em;">%s</div>' % (size - 0.5, fg, bg, t)
    s_ = '<div style="font-size: %spx; color: %s; white-space: nowrap;">%s</div>' % (size + 0.5, T['ink3'], store) if store else ''
    return '<div style="display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;">%s%s</div>' % (b, s_)


def sentiment(s, show_text=True):
    c = {'负面': T['bad_solid'], '中性': T['ink4'], '正面': T['ok_solid']}[s]
    t = '<div style="font-size: 12px; color: %s;">%s</div>' % (T['ink2'], s) if show_text else ''
    return '<div style="display: inline-flex; align-items: center; gap: 5px;"><div style="width: 7px; height: 7px; border-radius: 999px; background: %s;"></div>%s</div>' % (c, t)


def sla(t, level='normal', size=11):
    """SLA 剩余时间。level: danger ≤ 2h，warning ≤ 6h，normal，none（已回复/无 SLA）。"""
    if level == 'none':
        return '<div style="font-size: %spx; color: %s; white-space: nowrap;">%s</div>' % (size, T['ink4'], t)
    fg, bg = {'danger': (T['bad'], T['bad_bg']), 'warning': (T['warn'], T['warn_bg']), 'normal': (T['ink2'], T['track'])}[level]
    return '<div style="display: inline-flex; align-items: center; gap: 4px; font-size: %spx; font-weight: 650; color: %s; background: %s; border-radius: 7px; padding: 0px 7px; line-height: 20px; white-space: nowrap; font-variant-numeric: tabular-nums;">%s%s</div>' % (size, fg, bg, icon('clock', 11, fg, 2), t)


def sla_meter(label_, t, level='normal', pct=50):
    """SLA 胶囊（带进度条）：用于会话标题区。pct 为剩余比例。"""
    fg = {'danger': T['bad'], 'warning': T['warn'], 'normal': T['ok']}[level]
    tc = {'danger': T['bad'], 'warning': T['warn'], 'normal': T['ink2']}[level]
    return ('<div style="display: inline-flex; align-items: center; gap: 8px; padding: 4px 9px; border-radius: 9px; background: %s; white-space: nowrap;">'
            '<div style="font-size: 10.8px; color: %s; font-weight: 500;">%s</div><div style="font-size: 12px; font-weight: 650; color: %s; font-variant-numeric: tabular-nums;">%s</div>'
            '<div style="width: 52px; height: 4px; border-radius: 99px; background: rgba(15,19,32,0.09); overflow: hidden;"><div style="width: %d%%; height: 100%%; border-radius: 99px; background: %s;"></div></div></div>') % (
        T['track'], T['ink4'], label_, tc, t, max(6, min(100, pct)), fg)


def ai_badge(t='AI', size=10.8):
    """AI 标识：靛蓝→青色渐变小徽标（全站 AI 产出统一用它，不用于其他含义）。"""
    return '<div style="display: inline-flex; align-items: center; gap: 4px; font-size: %spx; font-weight: 650; color: #ffffff; background: %s; border-radius: 6px; padding: 0px 7px; line-height: 18px; white-space: nowrap; letter-spacing: 0.02em; flex-shrink: 0;">✦ %s</div>' % (size, GRAD, t)


def priority(p):
    tone = {'紧急': 'danger', '高': 'warning', '普通': 'muted'}[p]
    return chip(p, tone)


def avatar(ch, tone='accent', size=28):
    """头像：内部成员用渐变（accent），其他色调为浅底。"""
    if tone in ('accent', 'grad'):
        return '<div style="width: %dpx; height: %dpx; border-radius: 999px; background: %s; color: #ffffff; font-size: %dpx; font-weight: 650; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%s</div>' % (size, size, GRAD, int(size * 0.42), ch)
    if tone == 'customer':
        return '<div style="width: %dpx; height: %dpx; border-radius: 999px; background: linear-gradient(140deg, #8b93a8, #5a6376); color: #ffffff; font-size: %dpx; font-weight: 650; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%s</div>' % (size, size, int(size * 0.4), ch)
    fg, bg = {'amber': (T['warn'], T['warn_bg']), 'green': (T['ok'], T['ok_bg']),
              'grey': (T['ink2'], T['track']), 'rose': (T['bad'], T['bad_bg']), 'violet': (T['flow'], T['flow_bg'])}[tone]
    return '<div style="width: %dpx; height: %dpx; border-radius: 999px; background: %s; color: %s; font-size: %dpx; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%s</div>' % (size, size, bg, fg, int(size * 0.42), ch)


def badge_count(n, tone='danger'):
    bg = {'danger': T['bad_solid'], 'accent': T['accent'], 'muted': T['ink4']}[tone]
    return '<div style="min-width: 16px; height: 16px; box-sizing: border-box; border-radius: 999px; background: %s; color: #ffffff; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; padding: 0px 4px;">%s</div>' % (bg, n)


# ================================================================ 按钮
def btn(t, kind='secondary', size='md', icon_name=None, icon_right=None, disabled=False, loading=False, full=False):
    """按钮（shadcn Button：default / outline / ghost / destructive / link；另加 warn、accent_outline 两个变体）。"""
    h, fs, px = {'sm': (28, 12, 10), 'md': (32, 12.5, 12), 'lg': (36, 13.5, 16)}[size]
    styles = {
        'primary': ('#ffffff', T['accent'], T['accent']),
        'secondary': (T['ink2'], '#ffffff', T['line_strong']),
        'ghost': (T['ink3'], 'transparent', 'transparent'),
        'danger': ('#ffffff', T['bad_solid'], T['bad_solid']),
        'danger_outline': (T['bad'], '#ffffff', T['bad_line']),
        'accent_outline': (T['accent_ink'], T['accent_bg'], T['accent_line']),
        'warn': ('#ffffff', T['warn_solid'], T['warn_solid']),
        'link': (T['accent'], 'transparent', 'transparent'),
    }
    fg, bg, bd = styles[kind]
    if disabled:
        fg, bg, bd = T['ink4'], T['track'], T['track']
    shadow = ''
    if not disabled:
        if kind == 'primary':
            shadow = ' box-shadow: %s;' % SHADOW_POP
        elif kind in ('secondary', 'danger_outline'):
            shadow = ' box-shadow: %s;' % SHADOW_XS
    ic = ''
    if loading:
        ic = '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="%s" stroke-width="2.2" stroke-linecap="round" style="flex-shrink: 0;"><circle cx="10" cy="10" r="7" stroke-opacity="0.25"></circle><path d="M10 3a7 7 0 0 1 7 7"></path></svg>' % fg
    elif icon_name:
        ic = icon(icon_name, 14 if size != 'lg' else 16, fg, 1.9)
    icr = icon(icon_right, 14, fg, 1.9) if icon_right else ''
    pad = '0px %dpx' % (px if kind != 'link' else 2)
    w = ' width: 100%; justify-content: center;' if full else ''
    op = ' opacity: 0.85;' if loading else ''
    fw = 600 if kind in ('primary', 'danger', 'warn', 'link', 'accent_outline') else 500
    return '<div style="height: %dpx; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; font-size: %spx; font-weight: %d; color: %s; background: %s; border: 1px solid %s; border-radius: 9px; padding: %s; white-space: nowrap; flex-shrink: 0;%s%s%s">%s%s%s</div>' % (
        h, fs, fw, fg, bg, bd, pad, shadow, w, op, ic, t, icr)


def icon_btn(name, tone='ghost', size=32, title=None, badge=None, active=False):
    bd = T['line'] if tone == 'secondary' else 'transparent'
    bg = '#ffffff' if tone == 'secondary' else 'transparent'
    c = T['ink3']
    if active:
        bd, bg, c = T['accent_line'], T['accent_bg'], T['accent_ink']
    b = '<div style="position: absolute; top: 6px; right: 6px; width: 7px; height: 7px; border-radius: 999px; background: %s; border: 1.5px solid #ffffff;"></div>' % T['bad_solid'] if badge else ''
    return '<div style="position: relative; width: %dpx; height: %dpx; box-sizing: border-box; border: 1px solid %s; background: %s; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%s%s</div>' % (size, size, bd, bg, icon(name, 16, c), b)


def btn_group(items):
    return row(''.join(items), 8)


# ================================================================ 表单
def input_box(value=None, placeholder='', st='default', prefix=None, suffix=None, width=None, h=32, icon_name=None, mono=False):
    """st: default / focus / error / disabled / readonly（shadcn Input）"""
    bd = {'default': T['line_strong'], 'focus': T['accent'], 'error': T['bad_solid'], 'disabled': T['line'], 'readonly': T['line']}[st]
    bg = {'disabled': T['subtle'], 'readonly': T['subtle']}.get(st, '#ffffff')
    ring = ' box-shadow: 0 0 0 3px %s;' % ('rgba(79,70,229,0.14)' if st == 'focus' else 'rgba(220,59,69,0.12)') if st in ('focus', 'error') else ''
    color = T['ink'] if value else T['ink4']
    if st == 'disabled':
        color = T['ink4']
    w = 'width: %s;' % width if width else 'width: 100%;'
    pre = '<div style="font-size: 13px; color: %s; flex-shrink: 0;">%s</div>' % (T['ink3'], prefix) if prefix else ''
    suf = '<div style="font-size: 12px; color: %s; flex-shrink: 0;">%s</div>' % (T['ink4'], suffix) if suffix else ''
    ic = icon(icon_name, 16, T['ink4']) if icon_name else ''
    ff = ' font-variant-numeric: tabular-nums;' if mono else ''
    caret = '<div style="width: 1px; height: 16px; background: %s; margin-left: -6px;"></div>' % T['accent'] if st == 'focus' else ''
    return '<div style="%s height: %dpx; box-sizing: border-box; border: 1px solid %s; background: %s; border-radius: 9px; display: flex; align-items: center; gap: 8px; padding: 0px 10px;%s">%s%s<div style="flex: 1; min-width: 0px; font-size: 13px; color: %s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;%s">%s</div>%s%s</div>' % (
        w, h, bd, bg, ring, ic, pre, color, ff, value or placeholder, caret, suf)


def select_box(value=None, placeholder='请选择', st='default', width=None, h=32):
    bd = {'default': T['line_strong'], 'focus': T['accent'], 'error': T['bad_solid'], 'disabled': T['line']}[st]
    bg = T['subtle'] if st == 'disabled' else '#ffffff'
    ring = ' box-shadow: 0 0 0 3px %s;' % ('rgba(79,70,229,0.14)' if st == 'focus' else 'rgba(220,59,69,0.12)') if st in ('focus', 'error') else ''
    w = 'width: %s;' % width if width else 'width: 100%;'
    return '<div style="%s height: %dpx; box-sizing: border-box; border: 1px solid %s; background: %s; border-radius: 9px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0px 10px;%s"><div style="font-size: 13px; color: %s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">%s</div>%s</div>' % (
        w, h, bd, bg, ring, T['ink'] if value else T['ink4'], value or placeholder, icon('chev_d', 14, T['ink4']))


def textarea_box(value=None, placeholder='', st='default', h=88, counter=None):
    bd = {'default': T['line_strong'], 'focus': T['accent'], 'error': T['bad_solid'], 'disabled': T['line']}[st]
    ring = ' box-shadow: 0 0 0 3px %s;' % ('rgba(79,70,229,0.14)' if st == 'focus' else 'rgba(220,59,69,0.12)') if st in ('focus', 'error') else ''
    cnt = '<div style="position: absolute; right: 10px; bottom: 6px; font-size: 11px; color: %s;">%s</div>' % (T['bad'] if st == 'error' else T['ink4'], counter) if counter else ''
    return '<div style="position: relative; min-height: %dpx; box-sizing: border-box; border: 1px solid %s; background: #ffffff; border-radius: 9px; padding: 8px 10px 20px 10px; font-size: 13px; line-height: 1.55; color: %s;%s">%s%s</div>' % (
        h, bd, T['ink'] if value else T['ink4'], ring, value or placeholder, cnt)


def field(lbl, control, required=False, hint=None, error=None, extra=''):
    req = '<span style="color: %s; margin-left: 2px;">*</span>' % T['bad'] if required else ''
    h = ''
    if error:
        h = '<div style="display: flex; align-items: center; gap: 4px; font-size: 12px; color: %s;">%s%s</div>' % (T['bad'], icon('alert', 13, T['bad'], 2), error)
    elif hint:
        h = '<div style="font-size: 12px; color: %s; line-height: 1.45;">%s</div>' % (T['ink3'], hint)
    return '<div style="display: flex; flex-direction: column; gap: 6px; min-width: 0px;%s"><div style="font-size: 12px; font-weight: 600; color: %s;">%s%s</div>%s%s</div>' % (
        (' ' + extra) if extra else '', T['ink2'], lbl, req, control, h)


def radio(t, checked=False, disabled=False):
    ring = 'border: 5px solid %s;' % T['accent'] if checked else 'border: 1.5px solid %s;' % (T['line'] if disabled else T['line_strong'])
    return '<div style="display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: %s;"><div style="width: 16px; height: 16px; box-sizing: border-box; border-radius: 999px; background: #ffffff; %s flex-shrink: 0;"></div>%s</div>' % (T['ink4'] if disabled else T['ink'], ring, t)


def checkbox(t, checked=False, disabled=False):
    box = '<div style="width: 16px; height: 16px; box-sizing: border-box; border-radius: 5px; background: %s; border: 1.5px solid %s; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%s</div>' % (
        T['accent'] if checked else '#ffffff', T['accent'] if checked else T['line_strong'], icon('check', 12, '#ffffff', 2.5) if checked else '')
    return '<div style="display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: %s;">%s%s</div>' % (T['ink4'] if disabled else T['ink'], box, t)


def toggle(on=True, t=None):
    track = T['accent'] if on else T['line_strong']
    knob = 'margin-left: 14px;' if on else 'margin-left: 2px;'
    lab = '<div style="font-size: 13px; color: %s; white-space: nowrap;">%s</div>' % (T['ink'], t) if t else ''
    return '<div style="display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0;"><div style="width: 32px; height: 20px; box-sizing: border-box; border-radius: 999px; background: %s; display: flex; align-items: center;"><div style="width: 16px; height: 16px; border-radius: 999px; background: #ffffff; box-shadow: %s; %s"></div></div>%s</div>' % (track, SHADOW_XS, knob, lab)


def radio_card(title, desc=None, selected=False, badge=None, disabled=False, extra_html=''):
    bd = T['accent'] if selected else T['line']
    bg = T['accent_bg'] if selected else (T['subtle'] if disabled else '#ffffff')
    ring = 'border: 5px solid %s;' % T['accent'] if selected else 'border: 1.5px solid %s;' % T['line_strong']
    dot = '<div style="width: 16px; height: 16px; box-sizing: border-box; border-radius: 999px; background: #ffffff; %s flex-shrink: 0; margin-top: 2px;"></div>' % ring
    b = ai_badge(badge, 10) if badge else ''
    d = '<div style="font-size: 12px; color: %s; line-height: 1.5;">%s</div>' % (T['ink3'], desc) if desc else ''
    sh = ' box-shadow: 0 0 0 3px rgba(79,70,229,0.10);' if selected else ''
    return '<div style="flex: 1; min-width: 0px; box-sizing: border-box; border: 1px solid %s; background: %s; border-radius: 12px; padding: 10px 12px; display: flex; gap: 10px; align-items: flex-start;%s">%s<div style="display: flex; flex-direction: column; gap: 3px; min-width: 0px;"><div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;"><div style="font-size: 13px; font-weight: 650; color: %s;">%s</div>%s</div>%s%s</div></div>' % (
        bd, bg, sh, dot, T['ink4'] if disabled else T['ink'], title, b, d, extra_html)


def seg(items, active, size='md'):
    """分段控件（shadcn ToggleGroup / Tabs 胶囊样式）。"""
    fs, py = (11.5, 3) if size == 'sm' else (12.5, 4)
    out = ''
    for it in items:
        if it == active:
            out += '<div style="font-size: %spx; font-weight: 650; color: %s; background: #ffffff; border: 1px solid %s; border-radius: 7px; padding: %dpx 10px; box-shadow: %s; white-space: nowrap;">%s</div>' % (fs, T['accent_ink'], T['line'], py - 1, SHADOW_XS, it)
        else:
            out += '<div style="font-size: %spx; font-weight: 500; color: %s; padding: %dpx 10px; white-space: nowrap;">%s</div>' % (fs, T['ink3'], py, it)
    return '<div style="display: inline-flex; align-items: center; gap: 2px; background: %s; border-radius: 9px; padding: 3px;">%s</div>' % (T['track'], out)


def tabs(items, active, size=13):
    """items: [('标签', 计数或 None)]（shadcn Tabs 下划线样式）"""
    out = ''
    for name, cnt in items:
        on = name == active
        c = '<div style="font-size: 10.5px; font-weight: 650; color: %s; background: %s; border-radius: 5px; padding: 0px 5px; line-height: 16px;">%s</div>' % (
            T['accent_ink'] if on else T['ink4'], T['accent_bg'] if on else T['track'], cnt) if cnt is not None else ''
        u = '<div style="position: absolute; left: 4px; right: 4px; bottom: -1px; height: 2px; border-radius: 2px 2px 0px 0px; background: %s;"></div>' % T['accent'] if on else ''
        out += '<div style="position: relative; display: flex; align-items: center; gap: 6px; font-size: %spx; font-weight: %d; color: %s; padding: 10px 4px 11px 4px; white-space: nowrap;">%s%s%s</div>' % (
            size, 650 if on else 500, T['accent_ink'] if on else T['ink3'], name, c, u)
    return '<div style="display: flex; align-items: center; gap: 16px; border-bottom: 1px solid %s;">%s</div>' % (T['line'], out)


def filter_chip(lbl, value=None, active=False):
    v = '<span style="font-weight: 650; color: %s;">%s</span>' % (T['accent_ink'] if active else T['ink'], value) if value else ''
    bd = T['accent_line'] if active else T['line']
    bg = T['accent_bg'] if active else '#ffffff'
    return '<div style="height: 28px; box-sizing: border-box; display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 500; color: %s; background: %s; border: 1px solid %s; border-radius: 8px; padding: 0px 8px 0px 10px; white-space: nowrap;">%s%s%s</div>' % (
        T['ink3'], bg, bd, lbl + ('：' if value else ''), v, icon('chev_d', 12, T['ink4']))


def search_box(placeholder='搜索', width='260px', value=None, shortcut=True):
    k = row(kbd('Ctrl') + kbd('K'), 3) if shortcut else ''
    return '<div style="width: %s; height: 32px; box-sizing: border-box; background: %s; border: 1px solid %s; border-radius: 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0px 8px 0px 10px;"><div style="display: flex; align-items: center; gap: 8px; min-width: 0px;">%s<div style="font-size: 12.5px; color: %s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">%s</div></div>%s</div>' % (
        width, '#ffffff' if value else T['subtle'], T['line'], icon('search', 15, T['ink4']), T['ink'] if value else T['ink4'], value or placeholder, k)


# ================================================================ 容器
def card(body, title=None, extra=None, pad='14px 16px', gap=10, tone=None, style=''):
    """卡片（shadcn Card）：13px 圆角、1px 边线、轻阴影；tone 为语义浅底。"""
    bd = {'accent': T['accent_line'], 'warning': T['warn_line'], 'danger': T['bad_line'], 'success': T['ok_line'], 'flow': T['flow_line']}.get(tone, T['line'])
    bg = {'warning': '#fdf8f0', 'danger': '#fdf5f6', 'success': '#f4fbf7', 'flow': '#faf8ff', 'accent': '#fcfcff'}.get(tone, '#ffffff')
    head = ''
    if title is not None:
        head = between(label(title) if isinstance(title, str) and not title.startswith('<') else title, extra or '')
    return '<div style="background: %s; border: 1px solid %s; border-radius: 13px; padding: %s; display: flex; flex-direction: column; gap: %dpx; box-shadow: %s;%s">%s%s</div>' % (
        bg, bd, pad, gap, SHADOW_XS, (' ' + style) if style else '', head, body)


def panel(body, pad='0px', style=''):
    """无阴影的白底分区（用于三栏布局中的栏）。"""
    return '<div style="background: #ffffff; padding: %s; display: flex; flex-direction: column;%s">%s</div>' % (pad, (' ' + style) if style else '', body)


def kv(k, v, tone=None, bold=True):
    color = {'danger': T['bad'], 'warning': T['warn'], 'success': T['ok'], 'accent': T['accent_ink'], 'muted': T['ink4']}.get(tone, T['ink'])
    return '<div style="display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-size: 12px; line-height: 1.5;"><div style="color: %s; white-space: nowrap;">%s</div><div style="font-weight: %d; color: %s; text-align: right; min-width: 0px;">%s</div></div>' % (
        T['ink3'], k, 600 if bold else 400, color, v)


def stat(k, v, sub=None, tone=None, size=13):
    """纵向键值：小字标签在上，值在下。"""
    color = {'danger': T['bad'], 'warning': T['warn'], 'success': T['ok'], 'accent': T['accent_ink'], 'muted': T['ink4']}.get(tone, T['ink'])
    s = '<div style="font-size: 11px; color: %s;">%s</div>' % (T['ink4'], sub) if sub else ''
    return '<div style="display: flex; flex-direction: column; gap: 2px; min-width: 0px;"><div style="font-size: 11px; color: %s;">%s</div><div style="font-size: %dpx; font-weight: 600; color: %s; font-variant-numeric: tabular-nums;">%s</div>%s</div>' % (
        T['ink4'], k, size, color, v, s)


def kpi(k, v, delta=None, delta_tone='muted', sub=None):
    dc = {'success': T['ok'], 'danger': T['bad'], 'warning': T['warn'], 'muted': T['ink3']}[delta_tone]
    d = '<div style="font-size: 12px; font-weight: 600; color: %s;">%s</div>' % (dc, delta) if delta else ''
    s = '<div style="font-size: 11.5px; color: %s;">%s</div>' % (T['ink4'], sub) if sub else ''
    return card('<div style="font-size: 12px; color: %s;">%s</div><div style="display: flex; align-items: baseline; gap: 8px;"><div style="font-size: 24px; font-weight: 700; color: %s; font-variant-numeric: tabular-nums; letter-spacing: -0.01em;">%s</div>%s</div>%s' % (T['ink3'], k, T['ink'], v, d, s), pad='12px 16px', gap=2)


def table(cols, rows, template, sel=None, dense=False, footer=None, head_bg=None, row_tones=None, py=None, fs=12.5):
    """cols: [(标题, 'left'|'right')]；rows: [[cell_html...]]；template: grid-template-columns 字符串。
    sel: 选中行下标；row_tones: {下标: 'warning'|'danger'} 行首色条。（shadcn Table + TanStack Table）"""
    py = py if py is not None else (8 if dense else 10)
    head = ''.join('<div style="text-align: %s; min-width: 0px;">%s</div>' % (a, c) for c, a in cols)
    out = '<div style="display: grid; grid-template-columns: %s; gap: 12px; padding: 9px 16px; background: %s; border-bottom: 1px solid %s; font-size: 11px; font-weight: 650; color: %s; letter-spacing: 0.02em; white-space: nowrap;">%s</div>' % (
        template, head_bg or T['subtle'], T['line'], T['ink4'], head)
    for i, r in enumerate(rows):
        bg = T['accent_bg'] if sel == i else '#ffffff'
        tone = (row_tones or {}).get(i)
        bar = 'box-shadow: inset 3px 0 0 %s;' % {'warning': T['warn_solid'], 'danger': T['bad_solid'], 'accent': T['accent']}[tone] if tone else ''
        if sel == i:
            bar = 'box-shadow: inset 3px 0 0 %s;' % T['accent']
        cells = ''.join('<div style="text-align: %s; min-width: 0px;">%s</div>' % (cols[j][1], c) for j, c in enumerate(r))
        out += '<div style="display: grid; grid-template-columns: %s; gap: 12px; padding: %dpx 16px; background: %s; border-bottom: 1px solid %s; font-size: %spx; color: %s; align-items: center; font-variant-numeric: tabular-nums; %s">%s</div>' % (
            template, py, bg, T['line2'], fs, T['ink'], bar, cells)
    if footer:
        cells = ''.join('<div style="text-align: %s; min-width: 0px;">%s</div>' % (cols[j][1], c) for j, c in enumerate(footer))
        out += '<div style="display: grid; grid-template-columns: %s; gap: 12px; padding: 10px 16px; background: %s; font-size: 12.5px; font-weight: 650; color: %s; align-items: center; font-variant-numeric: tabular-nums;">%s</div>' % (
            template, T['subtle'], T['ink'], cells)
    return '<div style="background: #ffffff; border: 1px solid %s; border-radius: 13px; overflow: hidden; display: flex; flex-direction: column; box-shadow: %s;">%s</div>' % (T['line'], SHADOW_XS, out)


def pagination(total_text, page=1, pages=1):
    return between(muted(total_text), row(btn('上一页', 'secondary', 'sm', disabled=page == 1) + nowrap('%d / %d' % (page, pages), 12, T['ink2']) + btn('下一页', 'secondary', 'sm', disabled=page == pages), 8))


# ================================================================ 流程类
def stepper(steps):
    """steps: [(名称, 说明, 'done'|'current'|'todo'|'error'|'skip')]"""
    out = ''
    n = len(steps)
    for i, (name, sub, st) in enumerate(steps):
        if st == 'done':
            dot = '<div style="width: 20px; height: 20px; border-radius: 999px; background: %s; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%s</div>' % (T['ok_solid'], icon('check', 12, '#ffffff', 3))
            nc, sc, w = T['ink'], T['ink4'], 600
        elif st == 'current':
            dot = '<div style="width: 20px; height: 20px; box-sizing: border-box; border-radius: 999px; background: %s; border: 4px solid %s; flex-shrink: 0;"></div>' % (T['accent'], '#e0e7ff')
            nc, sc, w = T['accent_ink'], T['warn'], 700
        elif st == 'error':
            dot = '<div style="width: 20px; height: 20px; border-radius: 999px; background: %s; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%s</div>' % (T['bad_solid'], icon('x', 11, '#ffffff', 3))
            nc, sc, w = T['bad'], T['bad'], 700
        else:
            dot = '<div style="width: 20px; height: 20px; box-sizing: border-box; border-radius: 999px; background: #ffffff; border: 2px solid %s; flex-shrink: 0;"></div>' % T['line_strong']
            nc, sc, w = T['ink4'], T['ink4'], 500
        line = ''
        if i < n - 1:
            lc = T['ok_solid'] if st == 'done' else T['line']
            line = '<div style="position: absolute; top: 9px; left: calc(50%% + 14px); right: calc(-50%% + 14px); height: 2px; background: %s;"></div>' % lc
        out += '<div style="position: relative; display: flex; flex-direction: column; align-items: center; gap: 5px; min-width: 0px;">%s%s<div style="font-size: 12px; font-weight: %d; color: %s; white-space: nowrap;">%s</div><div style="font-size: 11px; color: %s; white-space: nowrap;">%s</div></div>' % (
            line, dot, w, nc, name, sc, sub)
    return '<div style="display: grid; grid-template-columns: repeat(%d, minmax(0, 1fr)); gap: 0px;">%s</div>' % (n, out)


def who(t):
    tone = {'自动': 'accent', 'AI': 'accent', '系统': 'neutral', '人工': 'warning', '工厂': 'flow', '良仓': 'neutral', '客户': 'outline', '外部': 'neutral'}.get(t, 'neutral')
    return chip(t, tone, 10)


def log_item(time_, actor, body, last=False):
    return '<div style="display: flex; gap: 12px; align-items: flex-start;"><div style="width: 78px; flex-shrink: 0; font-size: 12px; color: %s; padding-top: 1px; font-variant-numeric: tabular-nums;">%s</div><div style="flex-shrink: 0; padding-top: 1px;">%s</div><div style="flex: 1; min-width: 0px; font-size: 13px; color: %s; line-height: 1.55;">%s</div></div>' % (
        T['ink4'], time_, who(actor), T['ink'], body)


def event_line(time_, t):
    return '<div style="display: flex; align-items: center; gap: 10px;"><div style="flex: 1; height: 1px; background: %s;"></div><div style="font-size: 11.5px; color: %s; white-space: nowrap;"><span style="color: %s; font-variant-numeric: tabular-nums;">%s</span> · %s</div><div style="flex: 1; height: 1px; background: %s;"></div></div>' % (
        T['line'], T['ink3'], T['ink4'], time_, t, T['line'])


def message(name, meta, body, kind='in', av=None, extra_head=''):
    """kind: in 客户来信 / out 我方回复 / note 内部备注 / draft AI 草稿（气泡左上角小圆角）"""
    bg, bd = {'in': ('#ffffff', T['line']), 'out': ('#f6f5fe', T['accent_line']), 'note': ('#fdf8f0', T['warn_line']), 'draft': ('#ffffff', T['accent_line'])}[kind]
    a = av or ''
    return '<div style="display: flex; gap: 10px; align-items: flex-start;">%s<div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 6px;"><div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;"><div style="font-size: 12.8px; font-weight: 650; color: %s;">%s</div><div style="font-size: 11.5px; color: %s;">%s</div>%s</div><div style="background: %s; border: 1px solid %s; border-radius: 4px 13px 13px 13px; padding: 9px 13px; font-size: 13px; line-height: 1.6; color: %s; box-shadow: %s;">%s</div></div></div>' % (
        a, T['ink'], name, T['ink4'], meta, extra_head, bg, bd, T['ink'], SHADOW_XS, body)


# ================================================================ 反馈
def banner(kind, title, desc=None, action=None, dismiss=False):
    """页内横幅（shadcn Alert）。kind: info / success / warning / danger"""
    fg, bg, bd, ib = {'info': (T['info'], '#f1f5fe', T['info_line'], T['info_bg']), 'success': (T['ok'], '#f1f9f5', T['ok_line'], T['ok_bg']),
                      'warning': (T['warn'], '#fcf5eb', T['warn_line'], '#f6e3c6'), 'danger': (T['bad'], '#fdf2f3', T['bad_line'], '#f9dadd')}[kind]
    ic = {'info': 'info', 'success': 'check_c', 'warning': 'alert', 'danger': 'alert'}[kind]
    d = '<div style="font-size: 12px; color: %s; line-height: 1.55;">%s</div>' % (T['ink2'], desc) if desc else ''
    a = action or ''
    x = icon('x', 14, T['ink4']) if dismiss else ''
    dot = '<div style="width: 24px; height: 24px; border-radius: 999px; background: %s; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%s</div>' % (ib, icon(ic, 14, fg, 2))
    return '<div style="display: flex; align-items: flex-start; gap: 10px; background: %s; border: 1px solid %s; border-radius: 13px; padding: 10px 12px;">%s<div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 2px; padding-top: 2px;"><div style="font-size: 13px; font-weight: 650; color: %s;">%s</div>%s</div>%s%s</div>' % (
        bg, bd, dot, T['ink'] if kind != 'danger' else fg, title, d, a, x)


def toast(kind, title, desc=None, action=None):
    """浮层提示（shadcn Sonner）：3 秒自动消失，失败类不自动消失。"""
    fg = {'success': T['ok_solid'], 'error': T['bad_solid'], 'info': T['accent'], 'warning': T['warn_solid']}[kind]
    ic = {'success': 'check_c', 'error': 'x_c', 'info': 'info', 'warning': 'alert'}[kind]
    d = '<div style="font-size: 12px; color: %s; line-height: 1.5;">%s</div>' % (T['ink3'], desc) if desc else ''
    a = '<div style="padding-top: 2px;">%s</div>' % action if action else ''
    return '<div style="width: 360px; box-sizing: border-box; display: flex; gap: 10px; align-items: flex-start; background: #ffffff; border: 1px solid %s; border-radius: 12px; padding: 12px 14px; box-shadow: %s;">%s<div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 13px; font-weight: 650; color: %s;">%s</div>%s%s</div>%s</div>' % (
        T['line'], SHADOW_MD, icon(ic, 18, fg, 2), T['ink'], title, d, a, icon('x', 14, T['ink4']))


def dialog(title, body, footer, width=480, tone=None, desc=None):
    """弹窗（shadcn Dialog / AlertDialog）。"""
    ic = ''
    if tone == 'danger':
        ic = '<div style="width: 36px; height: 36px; border-radius: 12px; background: %s; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%s</div>' % (T['bad_bg'], icon('alert', 18, T['bad'], 2))
    elif tone == 'warning':
        ic = '<div style="width: 36px; height: 36px; border-radius: 12px; background: %s; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%s</div>' % (T['warn_bg'], icon('alert', 18, T['warn'], 2))
    d = '<div style="font-size: 12.5px; color: %s; line-height: 1.55;">%s</div>' % (T['ink3'], desc) if desc else ''
    return '<div style="width: %dpx; box-sizing: border-box; background: #ffffff; border-radius: 16px; box-shadow: %s; display: flex; flex-direction: column; overflow: hidden;"><div style="padding: 18px 20px 0px 20px; display: flex; gap: 12px; align-items: flex-start;">%s<div style="flex: 1; display: flex; flex-direction: column; gap: 4px;"><div style="font-size: 15.5px; font-weight: 650; color: %s;">%s</div>%s</div>%s</div><div style="padding: 14px 20px 18px 20px; display: flex; flex-direction: column; gap: 12px;">%s</div><div style="padding: 12px 20px; border-top: 1px solid %s; display: flex; justify-content: flex-end; gap: 8px; background: %s;">%s</div></div>' % (
        width, SHADOW_LG, ic, T['ink'], title, d, icon('x', 16, T['ink4']), body, T['line2'], T['subtle'], footer)


def scrim(content, dlg, w=1440, h=900):
    """在页面之上盖一层遮罩并居中显示弹窗（用于状态板或整页状态）。"""
    return '<div style="position: relative; width: %dpx; height: %dpx; overflow: hidden;">%s<div style="position: absolute; inset: 0px; background: rgba(16,24,40,0.45); display: flex; align-items: center; justify-content: center;">%s</div></div>' % (w, h, content, dlg)


def empty(icon_name, title, desc=None, action=None, compact=False):
    s_ = 38 if compact else 44
    d = '<div style="font-size: 12.5px; color: %s; line-height: 1.6; text-align: center; max-width: 340px;">%s</div>' % (T['ink3'], desc) if desc else ''
    a = '<div style="margin-top: 6px;">%s</div>' % action if action else ''
    return '<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; padding: %s;"><div style="width: %dpx; height: %dpx; border-radius: 12px; background: %s; display: flex; align-items: center; justify-content: center; margin-bottom: 4px;">%s</div><div style="font-size: 14px; font-weight: 650; color: %s;">%s</div>%s%s</div>' % (
        '20px' if compact else '36px 24px', s_, s_, T['accent_bg'], icon(icon_name, 20, T['accent_ink']), T['ink'], title, d, a)


def no_permission(title='没有访问权限', desc='你的角色不能查看这个页面。如需开通，请联系管理员。', action=None):
    return empty('lock', title, desc, action or btn('返回收件箱', 'secondary', 'md', 'chev_l'))


def load_error(title='加载失败', desc='网络或服务暂时不可用，已保留你在页面上的输入。', action=None):
    return empty('wifi_off', title, desc, action or btn('重试', 'secondary', 'md', 'refresh'))


def skel(w='100%', h=10, r=5):
    return '<div style="width: %s; height: %dpx; border-radius: %dpx; background: linear-gradient(90deg, #eceef5 0%%, #f5f6fa 50%%, #eceef5 100%%); flex-shrink: 0;"></div>' % (w, h, r)


def skel_rows(n=5, avatar_=False):
    out = ''
    for i in range(n):
        a = skel('28px', 28, 999) if avatar_ else ''
        out += '<div style="display: flex; gap: 10px; align-items: center; padding: 12px 16px; border-bottom: 1px solid %s;">%s<div style="flex: 1; display: flex; flex-direction: column; gap: 7px;">%s%s</div></div>' % (
            T['line2'], a, skel('%d%%' % (70 - (i % 3) * 12), 10), skel('%d%%' % (45 + (i % 2) * 20), 8))
    return out


def progress(pct, tone='accent', h=6):
    c = {'accent': GRAD, 'success': T['ok_solid'], 'warning': T['warn_solid'], 'danger': T['bad_solid']}[tone]
    return '<div style="height: %dpx; border-radius: 999px; background: %s; overflow: hidden;"><div style="width: %s%%; height: 100%%; background: %s; border-radius: 999px;"></div></div>' % (h, T['track'], pct, c)


def spinner(size=16, color=None):
    c = color or T['accent']
    return '<svg width="%d" height="%d" viewBox="0 0 20 20" fill="none" stroke="%s" stroke-width="2.2" stroke-linecap="round" style="flex-shrink: 0;"><circle cx="10" cy="10" r="7" stroke-opacity="0.2"></circle><path d="M10 3a7 7 0 0 1 7 7"></path></svg>' % (size, size, c)


def tooltip(t):
    return '<div style="display: inline-block; background: %s; color: #ffffff; font-size: 12px; line-height: 1.5; border-radius: 8px; padding: 6px 10px; box-shadow: %s; max-width: 260px;">%s</div>' % (T['ink'], SHADOW_MD, t)


def menu(items, width=200):
    """下拉菜单（shadcn DropdownMenu）。items: [(文字, icon或None, 'danger'|None|'muted')]，'-' 为分隔线。"""
    out = ''
    for it in items:
        if it == '-':
            out += '<div style="height: 1px; background: %s; margin: 4px 0px;"></div>' % T['line2']
            continue
        t, ic, tone = it
        c = {'danger': T['bad'], 'muted': T['ink4']}.get(tone, T['ink2'])
        out += '<div style="display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 7px; font-size: 13px; color: %s;">%s%s</div>' % (c, icon(ic, 15, c) if ic else '', t)
    return '<div style="width: %dpx; box-sizing: border-box; background: #ffffff; border: 1px solid %s; border-radius: 12px; box-shadow: %s; padding: 5px;">%s</div>' % (width, T['line'], SHADOW_MD, out)


# ================================================================ 页面外壳
NAV_ICON = {'收件箱': 'inbox', '工单': 'ticket', '售后': 'box', '审批': 'approve', '知识库': 'book', '报表': 'chart', '设置': 'gear',
            '待办': 'inbox', '已完成': 'check_c', '结算': 'money'}
AV_TONE = {'坐席': 'green', '客服主管': 'accent', '售后负责人': 'amber', '知识库负责人': 'violet', '管理员': 'grey', '生产厂对接人': 'amber', '生产厂负责人': 'amber'}


def _brand(sub_='Support'):
    return ('<div style="display: flex; align-items: center; gap: 9px; flex-shrink: 0;"><div style="width: 28px; height: 28px; border-radius: 9px; background: %s; color: #ffffff; font-size: 14px; font-weight: 700; display: flex; align-items: center; justify-content: center; box-shadow: %s;">F</div>'
            '<div style="font-size: 14.5px; font-weight: 650; color: %s; letter-spacing: -0.01em;">Forcome</div><div style="font-size: 12.5px; font-weight: 450; color: %s; margin-left: -3px; white-space: nowrap;">%s</div></div>') % (
        GRAD, SHADOW_POP, T['ink'], T['ink4'], sub_)


def _segnav(items, active, badges=None):
    badges = badges or {}
    out = ''
    for n in items:
        on = n == active
        b = ''
        if badges.get(n):
            b = '<div style="font-size: 10.4px; font-weight: 650; color: %s; background: %s; border-radius: 5px; padding: 0px 5px; line-height: 16px;">%s</div>' % (T['accent_ink'], T['accent_bg'], badges[n])
        if on:
            out += '<div style="display: flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 8px; font-size: 12.7px; font-weight: 650; color: %s; background: #ffffff; border: 1px solid %s; box-shadow: %s; white-space: nowrap;">%s%s</div>' % (T['accent_ink'], T['line'], SHADOW_XS, n, b)
        else:
            out += '<div style="display: flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 8px; font-size: 12.7px; font-weight: 500; color: %s; white-space: nowrap;">%s%s</div>' % (T['ink3'], n, b)
    return '<div style="display: flex; align-items: center; gap: 2px; background: %s; padding: 3px; border-radius: 10px; flex-shrink: 0;">%s</div>' % (T['track'], out)


def _topbar(items, active, user, badges=None, scope='全部店铺', show_scope=True, right_extra='', search_ph='搜索工单、订单号、客户邮箱', brand_sub='Support', scope_label='店铺', scope_fixed=False):
    """56px 白色顶栏：品牌 · 分段导航 · 店铺范围 · 搜索（Ctrl K 命令面板）· 密度（舒适 / 紧凑）· 通知 · 当前用户。第一期只有浅色，不放主题切换。"""
    scope_html = '<div style="height: 32px; box-sizing: border-box; display: flex; align-items: center; gap: 6px; border: 1px solid %s; border-radius: 10px; padding: 0px 10px; background: #ffffff; white-space: nowrap;">%s<div style="font-size: 12px; color: %s;">%s：<span style="font-weight: 650; color: %s;">%s</span></div>%s</div>' % (
        T['line'], icon('lock' if scope_fixed else 'store', 14, T['ink4']), T['ink3'], scope_label, T['ink'], scope, '' if scope_fixed else icon('chev_d', 12, T['ink4'])) if show_scope else ''
    role = {'知识库负责人': '知识库', '售后负责人': '售后负责人', '生产厂对接人': '生产厂对接人', '生产厂负责人': '生产厂负责人'}.get(user['role'], user['role'])
    me = '<div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">%s<div style="display: flex; flex-direction: column; line-height: 1.25;"><div style="font-size: 12.5px; font-weight: 650; color: %s; white-space: nowrap;">%s</div><div style="font-size: 11px; color: %s; white-space: nowrap;">%s</div></div></div>' % (
        avatar(user['avatar'], 'grad', 30), T['ink'], user['name'], T['ink4'], role)
    right = right_extra + scope_html + search_box(search_ph, '240px') + icon_btn('rows', size=32) + icon_btn('bell', size=32, badge=True) + me
    return '<div style="height: 56px; flex-shrink: 0; box-sizing: border-box; background: #ffffff; border-bottom: 1px solid %s; display: flex; align-items: center; gap: 16px; padding: 0px 16px;">%s%s<div style="margin-left: auto; display: flex; align-items: center; gap: 8px;">%s</div></div>' % (
        T['line'], _brand(brand_sub), _segnav(items, active, badges), right)


def app(user_key, active, crumbs, body, badges=None, scope='全部店铺', banner_html=None, right_extra='', show_scope=True, w=1440, h=900):
    """客服系统页面外壳：顶栏 + 内容区（浅灰底）。body 自带内边距与布局；crumbs 记录页面层级（在页面标题区体现）。"""
    user = STAFF[user_key]
    items = NAV_BY_ROLE[user['role']]
    b = BADGES.get(user_key, {}) if badges is None else badges
    b = {k: v for k, v in b.items() if k in items}
    bn = '<div style="padding: 12px 16px 0px 16px; flex-shrink: 0;">%s</div>' % banner_html if banner_html else ''
    return '<div style="width: %dpx; height: %dpx; box-sizing: border-box; background: %s; display: flex; flex-direction: column; overflow: hidden; position: relative; font-variant-numeric: tabular-nums;">%s%s<div style="flex: 1; display: flex; flex-direction: column; min-height: 0px; min-width: 0px;">%s</div></div>' % (
        w, h, T['canvas'], _topbar(items, active, user, b, scope, show_scope, right_extra), bn, body)


def factory_app(active, crumbs, body, badges=None, w=1440, h=900, user_key='chengong'):
    """工厂工作台外壳：同一顶栏样式，导航只有待办 / 已完成 / 结算，范围固定为本厂。"""
    user = STAFF[user_key]
    b = badges if badges is not None else {'待办': 1}
    return '<div style="width: %dpx; height: %dpx; box-sizing: border-box; background: %s; display: flex; flex-direction: column; overflow: hidden; position: relative; font-variant-numeric: tabular-nums;">%s<div style="flex: 1; display: flex; flex-direction: column; min-height: 0px; min-width: 0px;">%s</div></div>' % (
        w, h, T['canvas'], _topbar(FACTORY_NAV, active, user, b, '生产厂 ' + user['factory'], True, '', '搜索售后单号、配件号', '工厂工作台', '范围', True), body)


def page_head(title, desc=None, actions='', tabs_html='', chips=''):
    """列表页标题区（直接落在浅灰底上）。"""
    d = '<div style="font-size: 12.5px; color: %s;">%s</div>' % (T['ink3'], desc) if desc else ''
    ch = '<div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">%s</div>' % chips if chips else ''
    t = '<div style="margin-top: 2px;">%s</div>' % tabs_html if tabs_html else ''
    return '<div style="padding: 16px 24px %s 24px; display: flex; flex-direction: column; gap: 8px; flex-shrink: 0;">%s%s</div>' % (
        '0px' if tabs_html else '2px',
        between(col('<div style="font-size: 19px; font-weight: 700; color: %s; letter-spacing: -0.015em;">%s</div>%s%s' % (T['ink'], title, d, ch), 4), row(actions, 8), 'flex-end'), t)


def detail_head(title, chips='', actions='', meta='', below=''):
    """详情页标题区（浅灰底上，标题 17.6px）。"""
    m = '<div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 12px; color: %s;">%s</div>' % (T['ink3'], meta) if meta else ''
    b = below or ''
    return '<div style="padding: 16px 24px 4px 24px; display: flex; flex-direction: column; gap: 12px; flex-shrink: 0;">%s%s</div>' % (
        between(col('<div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;"><div style="font-size: 17.6px; font-weight: 650; color: %s; letter-spacing: -0.015em;">%s</div>%s</div>%s' % (T['ink'], title, chips, m), 6), row(actions, 8), 'flex-start'), b)


def content(inner, pad='16px 24px', gap=14, scroll=False):
    return '<div style="flex: 1; min-height: 0px; padding: %s; display: flex; flex-direction: column; gap: %dpx;%s">%s</div>' % (pad, gap, ' overflow: hidden;' if not scroll else '', inner)


def two_col(left, right, right_w=360, gap=16, pad='16px 24px'):
    return '<div style="flex: 1; min-height: 0px; display: flex; flex-direction: row; gap: %dpx; padding: %s;"><div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 12px;">%s</div><div style="width: %dpx; flex-shrink: 0; display: flex; flex-direction: column; gap: 12px;">%s</div></div>' % (
        gap, pad, left, right_w, right)


# ================================================================ 状态板
def board(title, desc, body, w=1920, h=1200, legend=''):
    """状态板 / 规范板外框。"""
    return '<div style="width: %dpx; min-height: %dpx; box-sizing: border-box; background: %s; padding: 40px 48px; display: flex; flex-direction: column; gap: 24px;">%s%s</div>' % (
        w, h, T['canvas'], between(col('<div style="font-size: 24px; font-weight: 700; color: %s; letter-spacing: -0.01em;">%s</div><div style="font-size: 14px; color: %s; max-width: 1100px; line-height: 1.55;">%s</div>' % (T['ink'], title, T['ink3'], desc), 6), legend, 'flex-end'), body)


def variant(title, spec, frame_html, w=None, trigger=None):
    """状态板里的一个变体：编号标题 + 触发条件 + 画面。"""
    ww = 'width: %dpx;' % w if w else ''
    tr = '<div style="font-size: 12px; color: %s; line-height: 1.55;"><span style="font-weight: 650; color: %s;">触发：</span>%s</div>' % (T['ink3'], T['ink2'], trigger) if trigger else ''
    sp = '<div style="font-size: 12px; color: %s; line-height: 1.55;"><span style="font-weight: 650; color: %s;">规格：</span>%s</div>' % (T['ink3'], T['ink2'], spec) if spec else ''
    return '<div style="%s display: flex; flex-direction: column; gap: 8px; min-width: 0px;"><div style="font-size: 14px; font-weight: 650; color: %s;">%s</div>%s%s<div style="align-self: flex-start; border: 1px solid %s; border-radius: 14px; overflow: hidden; background: #ffffff; box-shadow: %s;">%s</div></div>' % (
        ww, T['ink'], title, tr, sp, T['line'], SHADOW_CARD, frame_html)


def mini(inner, w, h, bg=None, pad='0px'):
    """固定尺寸的局部画面。"""
    return '<div style="width: %dpx; height: %dpx; box-sizing: border-box; background: %s; overflow: hidden; position: relative; padding: %s; display: flex; flex-direction: column;">%s</div>' % (w, h, bg or T['canvas'], pad, inner)


# ================================================================ 文件
HEAD = '''<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400..700&amp;family=Noto+Sans+SC:wght@400..700&amp;display=swap">
  <style>
    body { margin: 0; font-family: "Inter", "PingFang SC", "HarmonyOS Sans SC", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif; color: #0f1320; -webkit-font-smoothing: antialiased; font-feature-settings: "cv11", "ss01"; }
    a { color: #4f46e5; } a:hover { color: #4338ca; }
  </style>
</helmet>
'''
TAIL = '''
</x-dc>
</body>
</html>
'''


def save(filename, root_html):
    path = os.path.join(DESIGN_DIR, filename)
    io.open(path, 'w', encoding='utf-8').write(HEAD + root_html + TAIL)
    return path
