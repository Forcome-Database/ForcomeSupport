# -*- coding: utf-8 -*-
"""收件箱三栏共用部件（P01–P03 与 StatesInbox 共用）。
只用 ui.py 组件与 T 色板组合；本文件新增的组合部件在报告里列出，便于并入组件库。
"""
import sys, os, re
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ui import *
from data import *

TK = {t['no']: t for t in TICKETS}

# 队列顺序与分段计数取 data.py：INBOX_QUEUE_ORDER / INBOX_NEED_ORDER / INBOX_SEG_COUNTS；来信正文取 data.MSG_IN
QUEUE_ORDER = INBOX_QUEUE_ORDER
SEGMENTS = ['需处理', '待审草稿', '转人工', '待审批', '等待中', '全部']
SEG_OF = {'待审草稿': '待审草稿', '转人工': '转人工', '待审批': '待审批', '等客户': '等待中', '等内部': '等待中', '等外部': '等待中'}
NEED_ORDER = INBOX_NEED_ORDER
SEG_COUNTS = INBOX_SEG_COUNTS


# ---------------------------------------------------------------- 左栏 · 工单队列
def queue_seg(active='需处理', counts=None):
    """队列分段：数字在上、名称在下的六等分胶囊分段（浅灰轨道，选中白底）。第一个「需处理」= 待审草稿 + 转人工，为默认分段。"""
    counts = SEG_COUNTS if counts is None else counts
    cells = ''
    for name in SEGMENTS:
        on = name == active
        n = counts.get(name, 0)
        nc = T['bad'] if (name == '转人工' and n) else (T['accent_ink'] if on else T['ink'])
        cells += ('<div style="display: flex; flex-direction: column; align-items: center; padding: 3px 0px; border-radius: 8px; background: %s; border: 1px solid %s;%s">'
                  '<div style="font-size: 13px; font-weight: 600; color: %s; line-height: 18px; font-variant-numeric: tabular-nums;">%s</div>'
                  '<div style="font-size: 11px; font-weight: %d; color: %s; line-height: 15px; white-space: nowrap;">%s</div></div>') % (
            '#ffffff' if on else 'transparent', T['line'] if on else 'transparent', ' box-shadow: %s;' % SHADOW_XS if on else '', nc, n, 600 if on else 500,
            T['accent_ink'] if on else T['ink3'], name)
    return '<div style="display: grid; grid-template-columns: repeat(%d, minmax(0, 1fr)); gap: 1px; background: %s; border-radius: 8px; padding: 3px;">%s</div>' % (len(SEGMENTS), T['track'], cells)


def esc_state(size=11):
    """「转人工」减红版：中性底 + 红点（风险已由左侧红条、横幅表达，状态胶囊不再整块红）。"""
    return ('<div style="display: inline-flex; align-items: center; gap: 5px; font-size: %dpx; font-weight: 600; color: %s; background: %s; border: 1px solid %s; border-radius: 6px; padding: 0px 7px; white-space: nowrap; line-height: 18px; flex-shrink: 0;">'
            '<div style="width: 6px; height: 6px; border-radius: 999px; background: %s;"></div>转人工</div>') % (size, T['ink2'], T['track'], T['track'], T['bad_solid'])


def status_chip(st, size=11):
    return esc_state(size) if st == '转人工' else state(st, size)


def sla_chip(t, size=11, left=None, level=None, suffix=True):
    """队列 SLA 胶囊：内部目标写进胶囊（「1h 28m · 内部」），与 P04 一致。"""
    v = left or t['sla_left']
    if suffix and t.get('sla_kind') and (level or t['sla_level']) != 'none':
        v += ' · 内部'
    return sla(v, level or t['sla_level'], size)


def queue_row(t, selected=False, sla_html=None, highlight=None, dense=False, status_html=None):
    """队列卡片：渠道徽标 + 客户名 + SLA / 主题 / 意图 · 状态（· 负面）。
    左侧色条只表示风险（转人工或 highlight='danger' 为红条）；选中改用浅靛蓝底 + 描边，不加色条。情绪只在负面时写「负面」。"""
    bar_c = T['bad_solid'] if (t['status'] == '转人工' or highlight == 'danger') else None
    bar = '<div style="position: absolute; left: 0px; top: 10px; bottom: 10px; width: 3px; border-radius: 0px 3px 3px 0px; background: %s;"></div>' % bar_c if bar_c else ''
    bg = T['accent_bg'] if selected else '#ffffff'
    bd = T['accent_line'] if selected else 'transparent'
    k = 1 if dense else 0  # 紧凑密度：字号小一档（最小 11），行内边距 9 → 6，行距 4 → 2
    s_ = sla_html if sla_html is not None else sla_chip(t, 11 - k, suffix=False)  # 队列列宽有限：内部目标写在第三行右侧
    line1 = between('<div style="display: flex; align-items: center; gap: 7px; min-width: 0px;">%s%s</div>' % (
        channel(t['channel'], t['site'], None, 11 - k), ellipsis(t['customer'], 13 - k, T['ink'], 600)), s_)
    line2 = ellipsis(t['subject'], 13 - k, T['ink'] if selected else T['ink2'], 500 if selected else 400)
    neg = nowrap('负面', 11, T['bad']) if t['sentiment'] == '负面' else ''
    st = status_html if status_html is not None else status_chip(t['status'], 11 - k)
    inner = nowrap('内部目标', 11, T['ink4']) if (t.get('sla_kind') and t['sla_level'] != 'none' and sla_html is None) else ''
    line3 = between(row(nowrap(t['intent'], 12 - k, T['ink3']) + st + neg, 6), inner)
    return '<div style="position: relative; padding: %s; border-radius: %dpx; border: 1px solid %s; background: %s; display: flex; flex-direction: column; gap: %dpx;">%s%s%s%s</div>' % (
        '6px 10px 6px 11px' if dense else '9px 11px 9px 12px', 12, bd, bg, 2 if dense else 4, bar, line1, line2, line3)


def queue_head(active_seg='需处理', counts=None, mine=False):
    return col(between(text('待处理', 14, T['ink'], 600), toggle(mine, '只看我的')) + queue_seg(active_seg, counts), 10)


def queue_list_note(n, extra=''):
    """列表顶部小字：张数 + 排序方式。"""
    return '<div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 2px 6px 4px 6px;">%s%s</div>' % (
        row(icon('sort', 13, T['ink4']) + nowrap('%d 张 · 按 SLA 剩余升序' % n, 11, T['ink4']), 4), extra)


def queue_column(selected_no=None, active_seg='需处理', rows_html=None, counts=None, w=308, mine=False):
    if rows_html is None:
        nos = NEED_ORDER if active_seg == '需处理' else QUEUE_ORDER
        rows_html = queue_list_note(len(nos)) + ''.join(queue_row(TK[n], n == selected_no) for n in nos)
        if active_seg == '需处理':
            rows_html += '<div style="padding: 12px 8px 0px 8px; font-size: 11px; color: %s; line-height: 1.6; text-align: center;">需处理的 %d 张已全部列出<br>待审批 %d · 等待中 %d 在对应分段查看</div>' % (
                T['ink4'], len(nos), SEG_COUNTS['待审批'], SEG_COUNTS['等待中'])
    return ('<div style="width: %dpx; flex-shrink: 0; box-sizing: border-box; background: #ffffff; border: 1px solid %s; border-radius: 16px; box-shadow: %s; display: flex; flex-direction: column; min-height: 0px; overflow: hidden;">'
            '<div style="padding: 13px 14px 11px 14px; border-bottom: 1px solid %s; flex-shrink: 0;">%s</div>'
            '<div style="flex: 1; min-height: 0px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: %s transparent; padding: 6px 8px 10px 8px; display: flex; flex-direction: column; gap: 3px;">%s</div></div>') % (
        w, T['line'], SHADOW_XS, T['line2'], queue_head(active_seg, counts, mine), T['line_strong'], rows_html)


# ---------------------------------------------------------------- 中栏
def _sla_pct(t):
    m = re.match(r'(\d+)h (\d+)m', t.get('sla_left', ''))
    return int((int(m.group(1)) * 60 + int(m.group(2))) * 100 / (24 * 60)) if m else 0


def merge_btn(t, size='sm'):
    """「合并」按钮（R-TK-04）：按 data.merge_candidates 判断；同店铺同客户没有其他未关闭工单时置灰，悬停说明原因。"""
    if merge_candidates(t['no']):
        return btn('合并', 'secondary', size, 'merge')
    why = '%s 在 %s 没有其他未关闭的工单，无可合并对象（合并仅限同店铺、同客户）' % (t['customer'], t['store'])
    return btn('合并', 'secondary', size, 'merge', disabled=True, reason=why)


def conv_head(t, owner_av, tags=None, actions=None, sla_label=None):
    """会话标题区（三行，P01–P03 共用）：主题 + 操作 / 编号 · 渠道与店铺 · 负责人 · 状态 · 优先级 | SLA 胶囊 / 意图 · 标签。"""
    acts = actions if actions is not None else (merge_btn(t) + btn('内部备注', 'secondary', 'sm', 'message') + icon_btn('more', 'secondary', 28))
    r1 = between('<div style="flex: 1; min-width: 0px;">%s</div>' % ellipsis(t['subject'], 17, T['ink'], 600), row(acts, 6))
    lbl = sla_label or ('内部目标' if t.get('sla_kind') else '亚马逊 24h SLA' if t['channel'] == '亚马逊' else 'SLA')
    tg_ = ''.join(pill(x) for x in (t['tags'] if tags is None else tags))
    add = '<div style="font-size: 11px; color: %s; border: 1px dashed %s; border-radius: 6px; padding: 0px 7px; line-height: 18px; white-space: nowrap;">＋ 标签</div>' % (T['ink4'], T['line_strong'])
    if t['sla_level'] == 'none':
        s_ = row(nowrap(lbl, 11, T['ink4']) + sla(t['sla_left'], 'none', 12), 6)
    else:
        s_ = sla_meter(lbl, ('剩 ' + t['sla_left']) if t['sla_left'][0].isdigit() else t['sla_left'], {'danger': 'danger', 'warning': 'warning'}.get(t['sla_level'], 'normal'), _sla_pct(t))
    meta = row(nowrap(t['no'], 12, T['ink4']) + channel(t['channel'], t['site'], t['store']) + divider(True, 12) +
               row(avatar(owner_av, 'grad', 18) + nowrap(t['owner'], 12, T['ink2']), 5) + divider(True, 12) +
               row(status_chip(t['status']) + priority(t['priority']), 4), 8)
    r2 = between(meta, s_, extra='flex-wrap: wrap; row-gap: 6px;')  # 窄画面（状态板）时 SLA 胶囊换到下一行
    r3 = row(cat(t['intent']) + (divider(True, 12) if tg_ else '') + tg_ + add, 6)
    return '<div style="padding: 11px 18px 10px 18px; border-bottom: 1px solid %s; display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; background: #ffffff;">%s%s%s</div>' % (
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
    return '<div style="display: flex; align-items: center; gap: 10px; background: #ffffff; border: 1px solid %s; border-radius: 12px; padding: 8px 12px; box-shadow: %s; flex-shrink: 0;">%s<div style="flex: 1; min-width: 0px; font-size: 13px; color: %s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">%s</div>%s</div>' % (
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


EDIT_HINT = '点击正文即可编辑，失焦后重新检查'


def body_box(inner, st='default', gap=6, pad='10px 14px', hint=None, corner=''):
    """草稿正文区。点正文即进入编辑（不再有「修改」按钮）：hint 为右上角淡提示；corner 放右下角（如承诺图例）。"""
    bd = {'default': T['line'], 'focus': T['accent'], 'readonly': T['line'], 'stale': T['line']}[st]
    bg = T['subtle'] if st in ('readonly', 'stale') else '#ffffff'
    ring = ' box-shadow: 0 0 0 3px rgba(79,70,229,0.14);' if st == 'focus' else ''
    color = T['ink3'] if st == 'stale' else T['ink']
    h = ''
    if hint:
        h = '<div style="position: absolute; top: 8px; right: 10px; display: flex; align-items: center; gap: 4px; font-size: 11px; color: %s; white-space: nowrap;">%s%s</div>' % (
            T['ink4'], icon('edit', 12, T['ink4']), hint)
    c = '<div style="position: absolute; right: 10px; bottom: 8px;">%s</div>' % corner if corner else ''
    return '<div style="position: relative; border: 1px solid %s; border-radius: 8px; background: %s; padding: %s; font-size: 13px; line-height: 1.6; color: %s; display: flex; flex-direction: column; gap: %dpx; cursor: text;%s">%s%s%s</div>' % (
        bd, bg, pad, color, gap, ring, h, inner, c)


def ver_tabs(items, active, right='', keys=True):
    """草稿版本切换：胶囊分段 + 数字键提示 1/2/3（右端放「换一版」）。items: [(键, 文字, 附加html)]"""
    out = ''
    for key, name, extra in items:
        on = key == active
        out += '<div style="display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: %d; color: %s; padding: %s; border-radius: 6px; background: %s; border: 1px solid %s;%s white-space: nowrap;">%s%s</div>' % (
            600 if on else 500, T['accent_ink'] if on else T['ink3'], '3px 10px' if on else '4px 10px', '#ffffff' if on else 'transparent',
            T['line'] if on else 'transparent', ' box-shadow: %s;' % SHADOW_XS if on else '', name, extra)
    n = len(items)
    k = ''  # 只有顶部搜索保留快捷键，版本页签不显示按键
    return '<div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">%s%s</div>' % (
        row('<div style="display: inline-flex; align-items: center; gap: 2px; background: %s; border-radius: 8px; padding: 3px;">%s</div>' % (T['track'], out) + k, 10), right)


def ai_reason(t, basis=None):
    """版本页签下的 AI 推荐理由（✦）：一行，写理由与依据。"""
    b = '<span style="color: %s;"> · 依据 %s</span>' % (T['ink4'], basis) if basis else ''
    return '<div style="display: flex; align-items: center; gap: 6px; min-width: 0px; font-size: 12px; color: %s; line-height: 18px;"><span style="color: %s; font-weight: 700; flex-shrink: 0;">✦</span><div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0px;"><span style="color: %s; font-weight: 600;">推荐理由</span>　%s%s</div></div>' % (
        T['ink2'], T['accent'], T['accent_ink'], t, b)


def conf(pct, why):
    """置信度 + ⓘ（悬停说明依据齐全度与同类历史采纳率）。"""
    return '置信度 <b style="color: %s;">%s</b><span title="%s" style="display: inline-flex; vertical-align: -2px; margin-left: 3px; cursor: help;">%s</span>' % (
        T['ink2'], pct, why, icon('info', 13, T['ink4']))


def promise_legend(note='悬停联动高亮审批卡'):
    """承诺高亮图例：与正文承诺内容同样式的小样 + 说明。"""
    sw = '<span style="display: inline-block; width: 16px; height: 9px; background: %s; border-bottom: 1.5px dashed %s;"></span>' % (T['warn_bg'], T['warn_solid'])
    n = '<span style="color: %s;"> · %s</span>' % (T['ink4'], note) if note else ''
    return '<div style="display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: %s; white-space: nowrap;">%s承诺内容 · 需审批%s</div>' % (T['ink3'], sw, n)


AUTO_NEXT = '提交后自动打开下一张 · 可在个人设置关闭'


def act_foot(primary, handoff=True, extra='', right=None, note=AUTO_NEXT):
    """草稿底栏：主按钮 · 转人工 · 其他 | 自动下一张说明 · 拒绝草稿。"""
    left = primary
    if handoff:
        left += handoff if isinstance(handoff, str) else btn('转人工', 'secondary', 'md', 'handoff')
    left += extra
    r = (nowrap(note, 11, T['ink4']) if note else '') + (btn('拒绝草稿', 'ghost', 'md', 'x_c') if right is None else right)
    return draft_foot(left, row(r, 8))


def draft_toolbar(lang, cn_on=False, media=True, hint=None, lib=False, cn_label='用中文修改'):
    p = nowrap('回复语言', 12, T['ink3']) + select_box(lang, width='104px', h=28) + tg(cn_on, cn_label) + divider(True, 16)
    why = '亚马逊站内信不支持图片和链接'
    p += btn('插入图片', 'secondary', 'sm', 'image', disabled=not media, reason=why) + btn('插入链接', 'secondary', 'sm', 'link', disabled=not media, reason=why)
    if lib:
        p += btn('素材库', 'secondary', 'sm', 'book')
    if hint:
        p += row(icon('info', 13, T['ink4']) + nowrap(hint, 11, T['ink3']), 4)
    return row(p, 8)


def evidence(items, right=''):
    """依据行：依据徽标（左）+ 图例等（右，可选）。"""
    left = row(nowrap('依据', 12, T['ink4']) + ''.join(chip(t, 'muted', 11, ic) for t, ic in items), 6, wrap=True)
    return between(left, right) if right else left


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
    flag = '<div style="font-size: 11px; font-weight: 600; color: %s; background: #f6e3c6; border-radius: 6px; padding: 1px 7px; white-space: nowrap;">审批人 %s · 时限 %s</div>' % (T['warn'], approver, limit)
    head = between(row(ico + text('需要审批的内容', 13, T['ink'], 600), 8), flag)
    return '<div style="background: #fcf5eb; border: 1px solid %s; border-radius: 12px; padding: 8px 13px; display: flex; flex-direction: column; gap: 5px;">%s%s%s</div>' % (
        T['warn_line'], head, col(body, 4), muted(note, 12))


def draft_foot(left, right=''):
    return '<div style="display: flex; align-items: center; gap: 8px; padding-top: 10px; border-top: 1px solid %s;">%s<div style="flex: 1;"></div>%s</div>' % (T['line2'], left, right)


def draft_card(meta, tabs_html, toolbar, body, evid='', check='', approval='', foot='', top='', gap=8, head_right=''):
    """AI 草稿卡（动作壳）：顶部渐变细条 → 头部（AI 徽标 · 生成时间 · 置信度 | 回复检查）→ 版本 → 工具行 → 正文 → 依据 → 审批项 → 底栏按钮。"""
    head = '<div style="padding: 9px 14px 8px 14px; background: linear-gradient(180deg, %s, #ffffff); display: flex; align-items: center; justify-content: space-between; gap: 10px;">%s%s</div>' % (
        T['accent_bg'], row(ai_badge('AI 回复草稿') + nowrap(meta, 12, T['ink3']), 8), head_right or check)
    inner = '<div style="padding: 2px 14px 12px 14px; display: flex; flex-direction: column; gap: %dpx;">%s%s%s%s%s%s</div>' % (gap, top, tabs_html, toolbar, body, evid, approval)
    f = ''
    if foot:
        f = '<div style="padding: 8px 14px; background: %s; border-top: 1px solid %s;">%s</div>' % (
            T['subtle'], T['line2'], foot.replace('padding-top: 10px; border-top: 1px solid %s;' % T['line2'], '', 1))
    return '<div style="position: relative; background: #ffffff; border: 1px solid %s; border-radius: 16px; box-shadow: %s; overflow: hidden; display: flex; flex-direction: column; flex-shrink: 0;"><div style="height: 2.5px; background: %s; flex-shrink: 0;"></div>%s%s%s</div>' % (
        T['accent_line'], SHADOW_CARD, GRAD, head, inner, f)


def customer_msg(name, meta, body, av, toggle_html=None, kind='in', extra=''):
    ex = (spacer() + toggle_html) if toggle_html else ''
    if not av:  # 客户头像：灰色渐变 + 姓名首字母（内部成员用品牌渐变）
        av = avatar(''.join(w[0] for w in name.split()[:2]).upper(), 'customer', 28)
    return message(name, meta, body, kind, av, extra + ex)


# ---------------------------------------------------------------- 右栏
def rsec(title, body, extra='', last=False, gap=10, collapsed=False, ai=False):
    """右栏分区：圆角卡片，标题 + 右侧补充 + 折叠箭头；collapsed=True 只显示标题行。"""
    t = row((ai_badge('', 11).replace('✦ ', '✦') if ai else '') + text(title, 13, T['ink'], 600), 6)
    head = '<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px;">%s%s</div>' % (
        t, row(extra + icon('chev_r' if collapsed else 'chev_d', 14, T['ink4']), 8))
    b = '' if collapsed else '<div style="padding: 0px 12px 12px 12px; display: flex; flex-direction: column; gap: %dpx;">%s</div>' % (gap, body)
    return '<div style="border: 1px solid %s; border-radius: 12px; background: #ffffff; flex-shrink: 0;">%s%s</div>' % (T['line'], head, b)


def right_column(inner, w=332, title='工单上下文'):
    head = '<div style="padding: 12px 14px 10px 14px; border-bottom: 1px solid %s; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">%s%s</div>' % (
        T['line2'], text(title, 14, T['ink'], 600), icon_btn('panel', size=26))
    return '<div style="width: %dpx; flex-shrink: 0; box-sizing: border-box; background: #ffffff; border: 1px solid %s; border-radius: 16px; box-shadow: %s; display: flex; flex-direction: column; min-height: 0px; overflow: hidden;">%s<div style="flex: 1; min-height: 0px; overflow: hidden; padding: 12px; display: flex; flex-direction: column; gap: 10px;">%s</div></div>' % (
        w, T['line'], SHADOW_XS, head, inner)


def ai_note(t):
    return '<div style="background: %s; border-radius: 8px; padding: 8px 10px; font-size: 12px; color: %s; line-height: 1.6;">%s</div>' % (T['accent_bg'], T['ink2'], t)


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
            dot = '<div style="width: 18px; height: 18px; box-sizing: border-box; border-radius: 999px; background: %s; color: #ffffff; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%d</div>' % (T['accent'], i + 1)
            c, w = T['accent_ink'], 700
        else:
            dot = '<div style="width: 18px; height: 18px; box-sizing: border-box; border-radius: 999px; background: #ffffff; border: 1.5px solid %s; color: %s; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%d</div>' % (T['line_strong'], T['ink4'], i + 1)
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
SARAH_VERSIONS = [('A', 'A 先补发', ai_badge('推荐', 11)), ('B', 'B 先查件再定', ''), ('C', 'C 部分退款', '')]
SARAH_PROMISE = 'a replacement ships Friday, Sep 11 via UPS Next Day Air at no cost to you and arrives Monday, Sep 14'


# P01 草稿头部：推荐理由与置信度依据（data.DRAFT_AI）
SARAH_AI = DRAFT_AI['T-20260910-0192']
SARAH_REASON = SARAH_AI['reason']
SARAH_REASON_BASIS = SARAH_AI['basis']
SARAH_CONF_WHY = SARAH_AI['conf_why']


def sarah_body(hint=EDIT_HINT, legend=False, compact=False):
    """legend=True：右下角放承诺图例（与依据行同一视线；依据徽标占满一行，图例放正文角上不另起一行）。
    compact=True：段距与上下内边距收紧（P01 草稿卡顶部多了 R-SL-05 提示条，要在 900 高度内放下）。"""
    return body_box(paras(DRAFTS['sarah_A'], [(SARAH_PROMISE, promise(SARAH_PROMISE))]), gap=3 if compact else 5, pad='8px 14px' if compact else '10px 14px',
                    hint=hint, corner=promise_legend() if legend else '')


def sarah_approval():
    return approval_needed([
        ('动作', '易仓创建售后出库单：易仓 US · V2 黑色 ×1 · UPS Next Day Air'),
        [('报备', '快递费用 <span style="font-weight: 700;">%s</span>' % money(ORDERS['113-4567890-1234567']['resend_freight'])), ('责任', '物流问题（规则：轨迹停滞满 5 天或超预计送达）')],
    ], '提交后会同时创建售后单。批准后经积加创建易仓出库单，积加回传已推送易仓且未缺货后自动发出这封回复。')


def rsl05_strip(sla_left, action='积加补发'):
    """R-SL-05 提示条（草稿卡顶部）：SLA 剩余少于「审批剩余时限 + 动作预计执行时长」且草稿含审批项时显示，建议先发不含承诺的进展回复。"""
    why = 'R-SL-05：审批剩余时限加上动作预计执行时长（%s按 4 个工作小时）后晚于 SLA 截止，承诺类回复来不及在 SLA 内发出' % action
    return ('<div title="%s" style="display: flex; align-items: center; gap: 8px; background: %s; border: 1px solid %s; border-radius: 8px; padding: 3px 10px;">%s'
            '<div style="flex: 1; min-width: 0px; font-size: 12px; color: %s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"><b style="color: %s;">SLA 剩 %s</b>，短于「审批时限 + %s执行时长」，建议先发不含承诺的进展回复</div>%s</div>') % (
        why, T['warn_bg'], T['warn_line'], icon('clock', 14, T['warn'], 2), T['ink2'], T['warn'], sla_left, action, link('插入进展回复模板', 12))


def sarah_msg(toggle_on='原文'):
    return customer_msg('Sarah Mitchell', '亚马逊买家消息 · 09-10 16:00', MSG_IN['sarah_en'] if toggle_on == '原文' else MSG_IN['sarah_zh'],
                        '', seg(['原文', '中文译文'], toggle_on, 'sm'))


def sarah_huan():
    return btn('换一版', 'ghost', 'sm', 'refresh')
