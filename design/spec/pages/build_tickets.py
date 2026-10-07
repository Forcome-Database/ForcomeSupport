# -*- coding: utf-8 -*-
"""P04 Tickets · P05 TicketDetail · P06 Customer。"""
import datetime, sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from data import *
from common import *
from inbox_parts import merge_btn, customer_msg

TK = {t['no']: t for t in TICKETS}
TC = ticket_counts()
# 按 SLA 剩余升序；已解决的排在最后（按最近来信倒序）——data.TICKET_LIST_ORDER
LIST_ORDER = TICKET_LIST_ORDER


def sort_head(t, on=False, asc=True):
    """可排序表头：当前排序列主色 + 方向箭头；其他可排序列灰色双向箭头。"""
    arrow = ('↑' if asc else '↓') if on else '↕'
    return '<span style="display: inline-flex; align-items: center; gap: 3px; color: %s; cursor: pointer;">%s<span style="font-size: 11px;">%s</span></span>' % (
        T['accent_ink'] if on else T['ink3'], t, arrow)


TICKET_COLS = [('', 'left'), ('工单号', 'left'), ('优先级', 'left'), ('主题', 'left'), ('渠道与店铺', 'left'), ('客户', 'left'), ('意图', 'left'),
               ('情绪', 'left'), ('状态', 'left'), ('负责人', 'left'), (sort_head('SLA 剩余', True), 'left'), (sort_head('最近来信'), 'left')]
TICKET_TPL = '16px 126px 50px minmax(0, 1fr) 178px 100px 124px 40px 70px 44px 112px 76px'


def prio_mark(p):
    """优先级小标：信号格（紧急 3 格红 / 高 2 格琥珀 / 普通 1 格灰）+ 文字。数据取 TICKETS['priority']。"""
    n, c = {'紧急': (3, T['bad_solid']), '高': (2, T['warn_solid']), '普通': (1, T['ink4'])}[p]
    bars = ''.join('<div style="width: 3px; height: %dpx; border-radius: 1px; background: %s;"></div>' % (4 + 3 * i, c if i < n else T['line_strong']) for i in range(3))
    return '<div style="display: inline-flex; align-items: center; gap: 5px;"><div style="display: flex; align-items: flex-end; gap: 1.5px; height: 10px;">%s</div><div style="font-size: 12px; color: %s; white-space: nowrap;">%s</div></div>' % (
        bars, T['ink2'] if p != '普通' else T['ink4'], p)


def ticket_row(t, on=False):
    tags = row(''.join(pill(x) for x in t['tags']), 4, extra='flex-shrink: 0;') if t['tags'] else ''
    subj = '<div style="display: flex; align-items: center; gap: 6px; min-width: 0px;">%s%s</div>' % (ellipsis(t['subject'], 13, T['ink'], 500), tags)
    owner = nowrap(t['owner'], 13, T['ink4'] if t['owner'] == '未分配' else T['ink'])
    v = t['sla_left'] + (' · 内部' if t.get('sla_kind') and t['sla_level'] != 'none' else '')
    return [cbox(on), nowrap(t['no'], 13, T['accent'], 500), prio_mark(t['priority']), subj, channel(t['channel'], t['site'], t['store']),
            ellipsis(t['customer'], 13), cat(t['intent']), sentiment(t['sentiment']),
            state(t['status']), owner, sla(v, t['sla_level']), nowrap(t['last_in'][6:] if t['last_in'].startswith(NOW[5:10]) else t['last_in'], 12, T['ink3'])]


# 当前负载（未关闭工单数）按 TICKETS 计算（data.owner_load），用于「推荐负责人」
LOAD = owner_load()


def assign_hint(t):
    """未分配工单的行下建议条：✦ 推荐负责人（依据：意图与负载）· 主管点「分配」才生效。"""
    who_ = min(LOAD, key=LOAD.get)
    loads = ' / '.join('%s %d 张' % (k, v) for k, v in sorted(LOAD.items(), key=lambda x: x[1]))
    return ('<div style="display: flex; align-items: center; gap: 10px; padding: 6px 16px 6px 44px; background: %s; border-bottom: 1px solid %s; font-size: 12px; color: %s;">'
            '<span style="color: %s; font-weight: 700;">✦</span><span style="white-space: nowrap;">推荐负责人 <b style="color: %s;">%s</b></span>'
            '<span style="color: %s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0px;">依据：意图「%s」两位坐席均可处理，按当前负载 %s · %s 生成</span>'
            '<div style="flex: 1;"></div>%s%s</div>') % (
        T['subtle'], T['line2'], T['ink2'], T['accent'], T['ink'], who_, T['ink4'], t['intent'], loads, NOW[5:],
        btn('分配给%s' % who_, 'accent_outline', 'sm', 'check'), btn('选其他人', 'ghost', 'sm'))


def tk_table(cols, rows, template, selected=(), bars=None, after=None, py=7):
    """工单列表表格（本页专用）：选中行浅靛蓝底、不加色条（色条只表示风险），选中行里的胶囊改白底描边以免与底色撞色；
    after: {行下标: html} 在该行下插入整宽建议条。"""
    head = ''.join('<div style="text-align: %s; min-width: 0px;">%s</div>' % (a, c) for c, a in cols)
    out = '<div style="display: grid; grid-template-columns: %s; gap: 12px; padding: 9px 16px; background: %s; border-bottom: 1px solid %s; font-size: 11px; font-weight: 700; color: %s; letter-spacing: 0.02em; white-space: nowrap; align-items: center;">%s</div>' % (
        template, T['subtle'], T['line'], T['ink3'], head)
    for i, r in enumerate(rows):
        on = i in selected
        tone = (bars or {}).get(i)
        bar = 'box-shadow: inset 3px 0 0 %s;' % T['bad_solid'] if tone == 'danger' else ''
        cells = ''.join('<div style="text-align: %s; min-width: 0px;">%s</div>' % (cols[j][1], c) for j, c in enumerate(r))
        if on:  # 撞色处理：浅底胶囊 → 白底 + 细描边
            for bgc, bdc in ((T['accent_bg'], T['accent_line']), (T['warn_bg'], T['warn_line']), (T['bad_bg'], T['bad_line']), (T['track'], T['line']), (T['ok_bg'], T['ok_line'])):
                cells = cells.replace('background: %s; border: 1px solid %s;' % (bgc, bgc), 'background: #ffffff; border: 1px solid %s;' % bdc)
                cells = cells.replace('background: %s; border-radius: 6px; padding: 0px 7px; line-height: 20px;' % bgc, 'background: #ffffff; box-shadow: inset 0 0 0 1px %s; border-radius: 6px; padding: 0px 7px; line-height: 20px;' % bdc)
        out += '<div style="display: grid; grid-template-columns: %s; gap: 12px; padding: %dpx 16px; background: %s; border-bottom: 1px solid %s; font-size: 13px; color: %s; align-items: center; font-variant-numeric: tabular-nums; %s">%s</div>' % (
            template, py, T['accent_bg'] if on else '#ffffff', T['line2'], T['ink'], bar, cells)
        out += (after or {}).get(i, '')
    return '<div style="background: #ffffff; border: 1px solid %s; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; box-shadow: %s;">%s</div>' % (T['line'], SHADOW_XS, out)


def ticket_table(nos, selected_nos=(), bars=None, hints=True):
    rows = [ticket_row(TK[n], n in selected_nos) for n in nos]
    sel = {i for i, n in enumerate(nos) if n in selected_nos}
    cols = list(TICKET_COLS)
    cols[0] = (cbox_partial() if sel else cbox(False), 'left')
    after = {i: assign_hint(TK[n]) for i, n in enumerate(nos) if TK[n]['owner'] == '未分配'} if hints else {}
    return tk_table(cols, rows, TICKET_TPL, sel, bars or {i: 'danger' for i, n in enumerate(nos) if TK[n]['status'] == '转人工'}, after)


def quick_views(active='全部'):
    """快捷视图：全部 · 我的 · 未分配 · 2 小时内到期（计数按 data 实时算）。"""
    mine = sum(1 for t in TICKETS if t['owner'] == '周敏' and t['status'] not in ('已解决',) + CLOSED)
    un = sum(1 for t in TICKETS if t['owner'] == '未分配')
    return seg(['全部 %d' % len(TICKETS), '我的 %d' % mine, '未分配 %d' % un, '2 小时内到期 %d' % TC['due2h']], '全部 %d' % len(TICKETS), 'sm')


def ticket_filters(active=None):
    active = active or {}
    names = [('状态', None), ('渠道', None), ('店铺', None), ('意图', None), ('情绪', None), ('标签', None), ('负责人', None), ('最近来信', '近 30 天')]
    left = ''.join(filter_chip(n, active.get(n, v), n in active or (v is not None)) for n, v in names) + filter_chip('未归属店铺')
    return between(row(quick_views() + divider(True, 20) + left, 6, wrap=True), row(nowrap('排序', 12, T['ink3']) + select_box('SLA 剩余 · 升序', width='148px', h=28), 6))


def ticket_metrics(active=None):
    return grid(metric_tile('未关闭', str(TC['open']), '全部店铺', active=active == '未关闭') +
                metric_tile('待审草稿', str(TC['drafts']), '其中 %d 张未分配' % TC['drafts_unassigned'], 'accent', active == '待审草稿') +
                metric_tile('2 小时内到期', str(TC['due2h']), '亚马逊 %d · 内部目标 %d' % (TC['due2h_amazon'], TC['due2h_internal']), 'danger', active == '2 小时内到期') +
                metric_tile('转人工', str(TC['escalated']), '平台风险 %d' % TC['esc_platform'], 'danger', active == '转人工'), 4, 12)


def batch_bar(n=2):
    return ('<div style="display: flex; align-items: center; gap: 8px; background: %s; border: 1px solid %s; border-radius: 8px; padding: 6px 8px 6px 14px;">'
            '%s<div style="font-size: 13px; font-weight: 700; color: %s; white-space: nowrap;">已选 %d 张</div>%s%s%s%s%s<div style="flex: 1;"></div>%s%s%s</div>') % (
        T['accent_bg'], T['accent_line'], cbox_partial(), T['accent_ink'], n, divider(True, 16),
        btn('改派', 'secondary', 'sm', 'handoff'), btn('添加标签', 'secondary', 'sm', 'tag'),
        btn('合并', 'secondary', 'sm', 'merge', disabled=True, reason='所选 2 张不是同店铺、同客户的工单（Forcome Direct · Sarah Mitchell / Forcome Auto · Marcus Lee），不能合并'),
        row(icon('info', 13, T['ink4']) + nowrap('合并仅限同店铺、同客户的工单', 12, T['ink3']), 4),
        row(btn('关闭', 'secondary', 'sm', 'x_c') + nowrap('可撤销 · 5 秒内', 11, T['ink4']), 6), divider(True, 16),
        btn('取消选择', 'ghost', 'sm'))


# ================================================================ P04 工单列表（周敏）
def p04():
    head = page_head('工单', '全部渠道 · 全部店铺', btn('导出', 'secondary', 'md', 'download') + btn('新建工单', 'primary', 'md', 'plus'))
    inner = ticket_metrics() + ticket_filters() + col(batch_bar(2) + ticket_table(LIST_ORDER, ('T-20260910-0192', 'T-20260910-0195')), 8) + \
        between(muted('共 13 条 · 每页 20 条'), row(btn('上一页', 'secondary', 'sm', disabled=True, reason='已是第一页') + nowrap('1 / 1', 12, T['ink2']) +
                                               btn('下一页', 'secondary', 'sm', disabled=True, reason='已是最后一页（共 13 条，每页 20 条）'), 8))
    return app('zhoumin', '工单', ['工单', '全部工单'], head + content(inner, '14px 24px 12px 24px', 12))


# ================================================================ P05 工单详情 · 全程记录（李婷 · Oliver Grant）
def ev(time_, actor, t):
    """时间线事件行：分隔线 + 时间 + 执行者标识 + 事件。"""
    return '<div style="display: flex; align-items: center; gap: 10px;"><div style="width: 16px; height: 1px; background: %s; flex-shrink: 0;"></div><div style="font-size: 12px; color: %s; white-space: nowrap; font-variant-numeric: tabular-nums;">%s</div>%s<div style="font-size: 12px; color: %s; white-space: nowrap;">%s</div><div style="flex: 1; height: 1px; background: %s;"></div></div>' % (
        T['line'], T['ink4'], time_, who(actor), T['ink2'], t, T['line'])


def lk(t):
    """时间线里的单号链接（售后单、审批单、运单号）：主色 + 下划线，点击打开对应详情或承运商查询。"""
    return '<span style="color: %s; font-weight: 500; text-decoration: underline; text-decoration-color: %s; text-underline-offset: 3px; cursor: pointer;">%s</span>' % (
        T['accent'], T['accent_line'], t)


def day_sep(label_):
    """时间线日期分隔条：「09-05 周六」。"""
    return '<div style="display: flex; align-items: center; gap: 8px; padding-top: 2px;"><div style="font-size: 11px; font-weight: 600; color: %s; background: %s; border-radius: 6px; padding: 0px 8px; line-height: 18px; white-space: nowrap;">%s</div><div style="flex: 1; height: 1px; background: %s;"></div></div>' % (
        T['ink3'], T['track'], label_, T['line'])


def vflow(steps, step_gap=5):
    """纵向状态流转（带时间）：steps: [(状态 html, 时间, 'done'|'current'|'todo')]；step_gap 为步与步的间距。"""
    out = ''
    n = len(steps)
    for i, (s_, tm, st) in enumerate(steps):
        c = {'done': T['ok_solid'], 'current': T['accent'], 'todo': T['line_strong'], 'closed': T['ink4']}[st]  # closed：已关闭的最后一步（灰色实心）
        dot = '<div style="width: 10px; height: 10px; box-sizing: border-box; border-radius: 999px; background: %s; border: 2px solid %s; flex-shrink: 0; margin-top: 5px;"></div>' % (
            '#ffffff' if st == 'todo' else c, c)
        ln = '<div style="position: absolute; left: 4px; top: 17px; bottom: -3px; width: 2px; background: %s;"></div>' % T['line'] if i < n - 1 else ''
        out += '<div style="position: relative; display: flex; gap: 10px; align-items: flex-start; padding-bottom: %dpx;">%s%s<div style="flex: 1; display: flex; justify-content: space-between; align-items: center; gap: 8px; min-width: 0px;">%s<div style="font-size: 12px; color: %s; white-space: nowrap; font-variant-numeric: tabular-nums;">%s</div></div></div>' % (
            0 if i == n - 1 else step_gap, ln, dot, s_, T['ink4'], tm)
    return '<div style="display: flex; flex-direction: column;">%s</div>' % out


RCARD_PAD = '10px 14px'  # P05 右栏卡片内边距（右栏 5 张卡要在 900 高度内放下）


def sla_line(arr, res, tone, note):
    """SLA 结果一行：来信到达时刻 · 结果 · 达标 / 未达标 / 不计 徽标。P05 与第一阶段 I18 共用。"""
    return '<div style="display: flex; align-items: center; gap: 8px; font-size: 12px;"><div style="color: %s; width: 108px; white-space: nowrap; font-variant-numeric: tabular-nums;">%s 来信</div><div style="flex: 1; color: %s; font-weight: 600; white-space: nowrap;">%s</div>%s</div>' % (
        T['ink3'], arr, T['ink'], res, chip(note, tone, 10) if note else '')


def order_card(no, pad=RCARD_PAD, synced=None):
    """订单卡（平台镜像，SP-API 非受限角色：不含买家姓名与地址明细，只有城市、州、国家），数据取 data.ORDERS；
    标题右侧「平台镜像 · 最近同步」取 data.CHANNEL_SYNC['SP-API']。P05 与第一阶段 I18 共用。"""
    o = ORDERS[no]
    head = between(nowrap(no, 13, T['ink'], 700), row(state(o['status']) + nowrap(o['delivered'], 12, T['ink3']), 6))
    body = col(head + col(kv('商品', o['item']) + kv('金额', '%s（≈ %s）' % (o['amount'], money(o['usd']))) +
                          grid(kv('履约方式', o['fulfil']) + kv('承诺送达', o['promise']), 2, 20) + kv('收件城市', o['ship_to']) +
                          kv('承运商', '%s %s' % (o['carrier'], o['tracking'])), 3), 6)
    return card(body, title='订单', extra=nowrap('平台镜像 · 最近同步 %s' % (synced or CHANNEL_SYNC['SP-API']), 11, T['ink3']), pad=pad, gap=8)


def order_card_p1(no, synced, pad='12px 16px'):
    """第一阶段订单卡（待办 17，协调者 2026-10-07 决定 Q1、Q2）：取第一期订单镜像的示例（data.AMAZON_ORDERS_P1 / SHOPIFY_ORDERS_P1）。
    状态写平台履约状态的中文（P1_ORDER_STATUS，没有签收），右侧「更新于」平台最近更新日期；金额非美元的按演示汇率折算「≈ $」；
    亚马逊多一行「履约方式 · 承诺送达」，Shopify 没有这一行；没有值写「—」。no 为 None 时写「未关联订单」。"""
    extra = nowrap('平台镜像 · 最近同步 %s' % synced, 11, T['ink3'])
    if no is None:
        return card(nowrap('未关联订单', 12, T['ink3']), title='订单', pad=pad, gap=8)
    amazon = no in AMAZON_ORDERS_P1
    o = AMAZON_ORDERS_P1[no] if amazon else SHOPIFY_ORDERS_P1[no]
    status = P1_ORDER_STATUS[o['status'] if amazon else o['fulfilled']]
    head = between(nowrap(no, 13, T['ink'], 700), row(state(status) + nowrap('更新于 ' + o['updated'][:5], 12, T['ink3']), 6))
    items = '、'.join('%s ×%d' % (t, q) for t, q in o['items'])
    if amazon:
        money_ = money_cur(*o['total'])  # 非美元附「（≈ $）」
        city, region, _zip, country = o['ship_to']
        fulfil = {'MFN': 'MFN（自发货）', 'AFN': 'AFN（亚马逊配送）'}[o['fulfil']]
        extra_row = grid(kv('履约方式', fulfil) + kv('承诺送达', o['deliver_by'][:5]), 2, 20)
    else:
        money_ = money(o['total'])
        _street, _apt, city, region, _zip, country = o['ship_to']
        extra_row = ''
    track = '%s %s' % o['tracking'] if o['tracking'] else '—'
    body = col(head + col(kv('商品', items) + kv('金额', money_) + extra_row + kv('收件城市', '%s, %s, %s' % (city, region, country)) +
                          kv('承运商', track), 3), 6)
    return card(body, title='订单', extra=extra, pad=pad, gap=8)


def inline_kv(k, v):
    """行内键值：灰色小字标签 + 值（同一行放几项时用）。"""
    return row(nowrap(k, 12, T['ink3']) + v, 6, extra='flex-shrink: 0;')


def p05():
    t = TK['T-20260904-0098']
    head = detail_head('Charger cable not working', state('已解决') + channel('亚马逊', 'CA', 'Forcome Direct') + btn('添加标签', 'link', 'sm', 'plus'),
                       btn('重新打开', 'secondary', 'md', 'refresh') + merge_btn(t, 'md') + btn('内部备注', 'secondary', 'md', 'message') + btn('导出记录', 'secondary', 'md', 'download'),
                       meta=''.join([nowrap(t['no'], 12, T['ink3']), nowrap('·', 12, T['ink4']), nowrap('客户 <span style="color: %s; font-weight: 600;">Oliver Grant</span>' % T['accent'], 12, T['ink3']),
                                     nowrap('·', 12, T['ink4']), nowrap('订单 204-5566778-9900112', 12, T['ink3']), nowrap('·', 12, T['ink4']),
                                     nowrap('负责人 李婷', 12, T['ink3']), nowrap('·', 12, T['ink4']), nowrap('09-10 09:00 已解决，7 天无来信将于 09-17 自动关闭', 12, T['ink3'])]))
    ov = avatar('OG', 'customer', 28)
    me = avatar('婷', 'grad', 28)
    a_chip = ai_badge('A 版 · 未修改', 10)
    AS14 = [a for a in AFTERSALES if a['no'] == 'S-20260905-0014'][0]
    ap, trk = HISTORY_APPROVALS['S-20260905-0014'], AS14['tracking']
    # 日期分隔：2026-09-11 为周五（NOW_LABEL），09-04 周五、09-05 周六、09-06 周日、09-10 周四
    tl = col(''.join([
        day_sep('09-04 周五'),
        message('Oliver Grant', '亚马逊买家消息 · 10:12', "Hi, the charger cable doesn't work. I plug it in and nothing happens, no light on the vacuum at all.", 'in', ov),
        ev('10:13', '系统', '意图「产品故障与使用问题」，未命中风险信号；生成 3 版草稿，推荐 A 版排查'),
        message('李婷', '经亚马逊买家消息发出 · 10:40', "Hi Oliver, sorry about the trouble. Could you try a different 12V socket and check the car's cigarette lighter fuse? If it still won't charge, just reply here and we'll sort it out.", 'out', me, a_chip),
        day_sep('09-05 周六'),
        message('Oliver Grant', '亚马逊买家消息 · 08:58', 'Tried another socket, still nothing. But it charges fine with my own USB-C cable.', 'in', ov),
        ev('08:59', '系统', '排查树结论「充电线故障」，创建售后单 %s（待确认）' % lk(AS14['no'])),
        ev('09:10', '人工', '王磊确认：寄配件 · 易仓有货 · 产品质量问题；报备快递费用 %s' % money(AS14['freight'])),
        ev('09:40', '人工', '周敏批准 %s，经积加创建易仓出库单' % lk(ap)),
        ev('15:20', '易仓', '易仓发出，UPS %s' % lk(trk)),
        message('李婷', '经亚马逊买家消息发出 · 15:30 · 工单转「等客户」', "Hi Oliver, a replacement charging cable is on its way via UPS, tracking %s. Please keep the old cable, no return needed." % trk, 'out', me, a_chip),
        day_sep('09-06 周日'),
        ev('10:05', '工厂', '张工（生产厂 FZJ）在工厂工作台接受承担比例：%s' % ratio_words(R_FAC)),
        day_sep('09-10 周四'),
        message('Oliver Grant', '亚马逊买家消息 · 09:00', 'Thanks, the new cable works!', 'in', ov),
        ev('09:00', '系统', '识别为致谢：亚马逊无需回复，工单转「已解决」'),
        ev('09:05', '人工', '李婷标记为 FAQ 候选，等赵倩审核'),
        ev('16:05', '系统', '结算批次 %s 双方确认，已结算；本单工厂承担 %s' % (lk(AS14['batch']), money(factory_share(AS14)))),
    ]), 7, 'flex: 1; min-height: 0px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: %s transparent; padding-right: 6px;' % T['line_strong'])
    left = card(tl, title=text('全程记录', 13, T['ink'], 700), extra=row(seg(['全部', '仅消息', '仅事件'], '全部', 'sm'), 8), pad='14px 18px', gap=12, style='flex: 1; min-height: 0px;')

    # 右栏：工单信息与关联合为一张卡（意图 · 情绪 · 重复联系一行；关联售后单、审批单各一行），给订单卡腾出高度
    info = card(col(row(inline_kv('意图', cat('产品故障与使用问题')) + inline_kv('情绪', sentiment('正面')) + inline_kv('重复联系', nowrap('0 次', 12, T['ink'], 600)), 16) +
                    divider() +
                    kv('关联售后单', row(nowrap(AS14['no'], 12, T['accent'], 600) + state(AS14['status']), 6)) +
                    kv('关联审批单', row(nowrap(ap, 12, T['accent'], 600) + state('已执行'), 6)), 6), title='工单信息', pad=RCARD_PAD, gap=8)
    order = order_card(t['order'])
    slab = card(col(sla_line('09-04 10:12', '首次回复 28m', 'success', '达标') + sla_line('09-05 08:58', '首次回复 6h 32m', 'success', '达标') +
                    sla_line('09-10 09:00', '致谢，无需回复', 'muted', None), 6), title='SLA 结果', extra=nowrap('亚马逊 24 小时', 11, T['ink3']), pad=RCARD_PAD, gap=8)
    fl = vflow([(chip('新建', 'neutral', 11), '09-04 10:12', 'done'), (state('待审草稿'), '09-04 10:13', 'done'), (state('等客户'), '09-04 10:40', 'done'),
                (state('等内部'), '09-05 08:59', 'done'), (state('等客户'), '09-05 15:30', 'done'), (state('已解决'), '09-10 09:00', 'current'),
                (chip('已关闭', 'muted', 11), '预计 09-17 自动', 'todo')], 2)
    flow = card(fl, title='状态流转', extra=nowrap('7 天无来信自动关闭', 11, T['ink3']), pad=RCARD_PAD, gap=8)
    ai = card(col(kv('回复', '2 次，均采纳 A 版未修改 · 已计入采纳率') + kv('知识', '充电线不充电排查（命中 2 次）'), 5),
              title='AI 记录', extra=chip('FAQ 候选 · 李婷 09-10 提交 · 待审核', 'accent', 11, 'star'), pad=RCARD_PAD, gap=8)
    right = info + order + slab + flow + ai
    body = head + '<div style="flex: 1; min-height: 0px; display: flex; gap: 16px; padding: 14px 24px 16px 24px;"><div style="flex: 1; min-width: 0px; display: flex; flex-direction: column;">%s</div><div style="width: 380px; flex-shrink: 0; display: flex; flex-direction: column; gap: 10px;">%s</div></div>' % (left, right)
    return app('liting', '工单', ['工单', 'T-20260904-0098'], body)


# ================================================================ 第一阶段 P04 工单列表（StatesInbox I16，周敏；prd_c P04「第一阶段」）
# 只读：没有指标行、快捷视图、批量条、选择框、优先级、意图、情绪、负责人、导出、新建工单
P1_COLS = [('工单号', 'left'), ('主题', 'left'), ('来源', 'left'), ('渠道与店铺', 'left'), ('客户', 'left'), ('订单号', 'left'), ('状态', 'left'),
           (sort_head('SLA 剩余', True), 'left'), ('最近来信', 'left')]
P1_TPL = '124px minmax(0, 1fr) 72px 196px 112px 148px 70px 132px 76px'


def source_badge(src, size=11):
    """来源徽标（prd_a 1.4「来源」）：客户不显示徽标；生产厂、其他供应商用紫色徽标（与时间线「工厂」执行者同色）。"""
    return chip(src, 'flow', size, 'factory' if src == '生产厂' else 'truck')


def short_time(v):
    """最近来信：当天只写时分。"""
    return v[6:] if v.startswith(NOW[5:10]) else v


def p1_row(t):
    """第一阶段工单行。SLA：待回复写剩余或「已超时」，Shopify 与邮件加「· 内部」；等客户「已回复」；其余「—」（数据由 data.p1_tickets 给出）。"""
    internal = t['channel'] in ('Shopify', '邮件') and t['sla_level'] != 'none'
    src = nowrap('客户', 12, T['ink4']) if t['source'] == '客户' else source_badge(t['source'])
    return [nowrap(t['no'], 13, T['accent'], 500), ellipsis(t['subject'], 13, T['ink'], 500), src, channel(t['channel'], t['site'], t['store']),
            ellipsis(t['customer'], 13), nowrap(t['order'] or '—', 12, T['ink2'] if t['order'] else T['ink4']), state(t['status']),
            sla(t['sla_left'] + (' · 内部' if internal else ''), t['sla_level']), nowrap(short_time(t['last_in']), 12, T['ink3'])]


def drill_chip(lbl):
    """「来自报表」筛选芯片（可移除）：从 P17 下钻进入时带上与指标同口径的条件（prd_c P04 第一阶段、P17）。"""
    return ('<div style="height: 28px; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; color: %s; background: %s; border: 1px solid %s; border-radius: 8px; padding: 0px 6px 0px 8px; white-space: nowrap;">'
            '%s来自报表：<span style="font-weight: 600; color: %s;">%s</span><div title="移除这条筛选" style="display: flex; padding: 2px; border-radius: 4px; cursor: pointer;">%s</div></div>') % (
        T['ink3'], T['accent_bg'], T['accent_line'], icon('chart', 13, T['accent_ink']), T['accent_ink'], lbl, icon('x', 12, T['accent_ink'], 2))


# ---------------------------------------------------------------- 第一阶段未归属店铺来信队列（I17；P04 打开队列的整页为待办 15 的补充，协调者 2026-10-07 决定）
UNASSIGNED_EMPTY = '没有识别不出店铺的来信'


def unassigned_entry(n, active=False):
    """筛选行右侧的客服主管专用入口「未归属店铺 N」：切换按钮（地址栏 ?view=unassigned），打开队列时为选中态（主色浅底，同「最近来信」芯片），
    再点回到工单列表；N 为 0 时照常显示，计数用中性色（没有待处理时不吸引注意）。"""
    return row(nowrap('仅客服主管可见', 11, T['ink4']) +
               btn('未归属店铺 ' + chip(str(n), 'warning' if n else 'neutral', 11), 'accent_outline' if active else 'secondary', 'sm', 'inbox'), 8)


def unassigned_head(n, hint=True):
    """未归属店铺队列标题行（I14、I17 共用）：标题 + 计数 · 仅客服主管可见、不受店铺数据范围限制 | 自动归位提示（D-24，不设「去登记店铺」入口）。
    hint=False：提示已写在下方横幅里时不重复（I17）。计数为 0 时用中性色（同入口）。"""
    left = row(text('未归属店铺', 16, T['ink'], 700) + chip(str(n), 'warning' if n else 'neutral', 11) + nowrap('仅客服主管可见 · 不受店铺数据范围限制', 12, T['ink3']), 8)
    right = row(icon('info', 13, T['ink4']) + nowrap('管理员登记新店铺后，收件地址匹配的来信会自动归位', 12, T['ink3']), 5)
    return between(left, right if hint else '')


def unassigned_note(n):
    """I17 的提示条：几封来信识别不出店铺；队列为空时不显示。"""
    return banner('warning', '%d 封来信识别不出店铺' % n, 'SLA 按原到达时间照常计时 · 管理员登记新店铺后，收件地址匹配的来信会自动归位')


I17_COLS = [('来信', 'left'), ('识别依据', 'left'), ('到达', 'left'), ('SLA', 'left'), ('指定店铺（只列你的授权店铺）', 'left')]
I17_TPL = 'minmax(0, 1fr) minmax(0, 1.3fr) 44px 132px 222px'


def i17_table(mails, template=I17_TPL):
    """没有 ✦ 推荐列；识别依据 = 收件头字段名 + 收件地址 +「未登记」（发件域作补充）；指定店铺下拉未预选，只列当前客服主管的授权店铺，
    没选店铺时「指定」置灰、悬停「先选择店铺」。
    队列为空时保留表头，表体为空状态（同 I10 的空状态组件，没有按钮）。"""
    if not mails:
        return table_empty(I17_COLS, template, empty('inbox', UNASSIGNED_EMPTY))
    rows = [[col(text(m['customer'], 13, T['ink'], 600) + ellipsis(m['subject'], 12, T['ink3']), 1),
             col(nowrap(m['to_hdr'], 11, T['ink4']) + row(nowrap(m['to'], 12, T['ink'], 600) + chip('未登记', 'warning', 10), 6) + nowrap('发件域 ' + m['from_domain'], 11, T['ink4']), 2),
             nowrap(m['at'], 12, T['ink2']),
             col(sla(m['sla'], 'normal') + nowrap(m['sla_kind'], 11, T['ink4']), 3),
             # 还没选店铺时「指定」置灰，悬停写原因（协调者 2026-10-07 决定 Q7）
             row(select_box(None, '选择店铺', width='164px', h=28) + btn('指定', 'primary', 'sm', disabled=True, reason='先选择店铺'), 6)] for m in mails]
    return mtable(I17_COLS, rows, template, py=10)


def unassigned_queue(mails):
    """P04 打开「未归属店铺 N」后的列表区（I17）：标题行、提示条（队列为空时不显示）与表格。"""
    n = len(mails)
    return col(unassigned_head(n, False) + (unassigned_note(n) if n else '') + i17_table(mails), 12)


def p1_filters(drill=False, view=None):
    """第一阶段筛选行：状态 · 渠道 · 店铺 · 站点 · 来源 · 最近来信（近 30 天）；右侧客服主管专用「未归属店铺 N」入口（I17）。
    view：'unassigned' 打开队列、'unassigned_empty' 打开空队列——入口为选中态，左侧的工单筛选不显示（它们只作用于工单列表）。"""
    names = [('状态', None), ('渠道', None), ('店铺', None), ('站点', None), ('来源', None), ('最近来信', '近 30 天')]
    chips = ''.join(filter_chip(n, v, v is not None) for n, v in names)
    if drill:
        chips = drill_chip(P1_DRILL['label']) + divider(True, 20) + chips
    n = 0 if view == 'unassigned_empty' else len(UNASSIGNED_MAIL)
    entry = unassigned_entry(n, active=view is not None)
    return between(row('' if view else chips, 6, wrap=True), entry, extra='min-height: 28px;')


def p04_p1(drill=False, h=900, view=None):
    """drill=True：从 P17「每日工单量」09-10 的柱下钻进入（局部画面，只列示例数据里 09-10 新建的客户来信工单；总数取 P1_DRILL）。
    view='unassigned'：客服主管点「未归属店铺 2」打开队列（I17）；'unassigned_empty'：队列为空（N = 0）。页头不变，列表区换成队列。"""
    if view:
        note = row(icon('refresh', 14, T['ink4']) + nowrap('只读 · 数据变化时自动刷新', 12, T['ink3']), 6)
        head = page_head('工单', '全部渠道 · 全部店铺', note)
        mails = [] if view == 'unassigned_empty' else UNASSIGNED_MAIL
        inner = p1_filters(view=view) + unassigned_queue(mails)
        return app('zhoumin', '工单', ['工单'], head + content(inner, '14px 24px 12px 24px', 12), phase1=True, h=h)
    rows = p1_tickets()
    if drill:
        rows = [t for t in rows if t['no'].startswith('T-' + NOW[:4] + '0910') and t['source'] == '客户']
    note = row(icon('refresh', 14, T['ink4']) + nowrap('只读 · 数据变化时自动刷新', 12, T['ink3']), 6)
    head = page_head('工单', '全部渠道 · 全部店铺', note)
    tbl = tk_table(P1_COLS, [p1_row(t) for t in rows], P1_TPL)
    if drill:
        count = between(row(text('共 %d 条' % P1_DRILL['count'], 13, T['ink'], 600) + muted('条件与报表「每日工单量」09-10 的柱同口径：客户来信触发的新建或重开 09-10', 12), 10),
                        btn('清除筛选', 'link', 'sm'))
        inner = p1_filters(True) + col(count + tbl, 8)
    else:
        foot = between(muted('共 %d 条 · 每页 20 条 · 已超时在前，其后按 SLA 剩余升序，再按 待回复 → 等客户 → 已解决 → 已关闭，组内按最近来信倒序' % len(rows)),
                       row(btn('上一页', 'secondary', 'sm', disabled=True, reason='已是第一页') + nowrap('1 / 1', 12, T['ink2']) +
                           btn('下一页', 'secondary', 'sm', disabled=True, reason='已是最后一页（共 %d 条，每页 20 条）' % len(rows)), 8))
        inner = p1_filters() + tbl + foot
    return app('zhoumin', '工单', ['工单'], head + content(inner, '14px 24px 12px 24px', 12), phase1=True, h=h)


# ================================================================ 第一阶段 P05 工单详情（StatesInbox I18，李婷 · Oliver Grant；prd_c P05「第一阶段」）
def our_reply(mailbox, via, time_, body):
    """第一阶段我方回复卡：回信来自 Gmail「已发送」，对应不到成员，只写「我方 · 发件邮箱 · 经…」。"""
    return message('我方', '%s · %s · %s' % (mailbox, via, time_), body, 'out', avatar(icon('send', 13, T['ink2'], 2), 'grey', 28))


def p1_event(state_, at, trig, reason=None):
    """状态迁移事件行（触发方 · 事件 → 目标状态），数据取 P1_OLIVER['flow'] 与 P1_DETAIL_CASES（待办 17 补重开、撤销、按时关闭的写法，Q6 e）。"""
    actor, what = trig.split(' · ')
    t = {'新建': '新建工单，状态「%s」', '新来信': '新来信，回到「%s」', '重开': '同一订单来信，重开为「%s」',
         '撤销标记无需回复': '撤销标记无需回复，回到「%s」'}.get(what, what + '，转「%s」') % state_
    if what in ('7 天无来信', '14 天无新来信'):
        t = '%s，关闭（%s）' % (what, reason)
    return ev(at[6:], '系统', t) if actor == '系统' else ev(at[6:], '人工', actor + t)


# 第一阶段按时关闭（prd_b 6.1）：状态 → 规则（元信息、状态流转卡头）
P1_CLOSE_RULE = {'待回复': '14 天无新来信', '等客户': '7 天无来信', '已解决': '7 天无来信'}


def p1_flow(steps, close):
    """第一阶段状态流转：每步写状态、触发方与时间。还没关闭的最后一步写预计关闭时刻与关闭原因（灰色空心圈）；
    已关闭的最后一步是实际关闭（灰色实心圈，时间不带「预计」，触发方后写关闭原因，待办 17 Q6 d）。"""
    at, reason, closed = close
    n = len(steps)
    vs = []
    for i, (s, when, trig) in enumerate(steps):
        if s == '已关闭':
            vs.append((row(chip('已关闭', 'muted', 11) + nowrap('%s（%s）' % (trig, reason), 11, T['ink3']), 6), when, 'closed'))
        else:
            vs.append((row(state(s) + nowrap(trig, 11, T['ink3']), 6), when, 'current' if i == n - 1 else 'done'))
    if not closed:
        vs.append((row(chip('已关闭', 'muted', 11) + nowrap(reason, 11, T['ink3']), 6), '预计 ' + at, 'todo'))
    return vflow(vs, 3)


def p1_close_words(status, close):
    """元信息里的自动关闭（prd_c P05「第一阶段」，待办 17 Q6 d）：待回复不写状态前缀（PRD 例句），已关闭写实际关闭时刻"""
    at, reason, closed = close
    if closed:
        return '已关闭 · %s 自动关闭（%s）' % (at, reason)
    prefix = '' if status == '待回复' else status + ' · '
    return '%s%s将于 %s 自动关闭（%s）' % (prefix, P1_CLOSE_RULE[status], at, reason)


P1TK = {t['no']: t for t in p1_tickets()}
# 来信卡头的渠道写法（待办 17 Q6 a）；我方回复只在亚马逊工单写「经亚马逊买家消息」
P1_VIA_IN = {'亚马逊': '亚马逊买家消息', 'Shopify': 'Shopify 联系表单', '邮件': '邮件'}
P1_WEEKDAY = '一二三四五六日'


def p1_day_label(md):
    """日期分隔条：「09-05 周六」（2026 年）"""
    d = datetime.date(2026, int(md[:2]), int(md[3:]))
    return '%s 周%s' % (md, P1_WEEKDAY[d.weekday()])


def p1_case(no):
    """P05 第一阶段画面的数据：Oliver Grant 取 P1_OLIVER（画面为 09-10 09:05 标记之后，带撤销浮层），其余取 P1_DETAIL_CASES"""
    if no == P1_OLIVER['ticket']:
        o = P1_OLIVER
        return {'timeline': o['timeline'], 'flow': o['flow'], 'close': (o['close_at'], o['close_reason'], False), 'sla': o['sla'],
                'order_synced': o['order_synced'], 'marked': (o['marked_by'], o['marked_at']), 'toast': True}
    return dict(P1_DETAIL_CASES[no], marked=None, toast=False)


def p05_p1(no=None):
    """第一阶段 P05（I18）：默认 Oliver Grant（已解决，标记之后）；no 给 P1_DETAIL_CASES 的工单号时画待回复、等客户、已关闭（待办 17 补充小样）"""
    no = no or P1_OLIVER['ticket']
    o = p1_case(no)
    t = P1TK[no]
    store = [s for s in STORES if s['name'] == t['store']][0]
    via_in = P1_VIA_IN[t['channel']]
    out_meta = (store['mailbox'] + ' · 经亚马逊买家消息') if t['channel'] == '亚马逊' else store['mailbox']
    open_ = not o['close'][2]
    meta = ''.join([nowrap(t['no'], 12, T['ink3']), nowrap('·', 12, T['ink4']), nowrap('客户 ' + t['customer'], 12, T['ink3']), nowrap('·', 12, T['ink4'])] +
                   ([nowrap('订单 ' + t['order'], 12, T['ink3']), nowrap('·', 12, T['ink4'])] if t['order'] else []) +
                   [nowrap(p1_close_words(t['status'], o['close']), 12, T['ink3'])])
    head = detail_head(t['subject'], state(t['status']) + channel(t['channel'], t['site'], t['store']), '', meta=meta)
    # 全程记录：消息与状态迁移事件按时刻合并，按日期分组；未关闭工单里最后一封我方回复之后、没被标记的来信卡右上有「标记无需回复」
    last_out = max(['%s %s' % (d[:5], tm) for d, tm, k, _ in o['timeline'] if k == 'out'] or [''])
    items = [('%s %s' % (d[:5], tm), 0, k, b) for d, tm, k, b in o['timeline']] + [(at, 1, s, trig) for s, at, trig in o['flow']]
    tl, last_day = '', None
    for at, kind, a, b in sorted(items, key=lambda x: (x[0], x[1])):
        if at[:5] != last_day:
            tl += day_sep(p1_day_label(at[:5]))
            last_day = at[:5]
        if kind == 1:
            tl += p1_event(a, at, b, o['close'][1])
        elif a == 'out':
            tl += message('我方', '%s · %s' % (out_meta, at[6:]), b, 'out', avatar(icon('send', 13, T['ink2'], 2), 'grey', 28))
        else:
            if a == 'marked':
                mark = chip('无需回复 · %s · %s' % (o['marked'][0], o['marked'][1][6:]), 'muted', 11, 'check')
            elif open_ and at > last_out:
                mark = btn('标记无需回复', 'secondary', 'sm', 'check')
            else:
                mark = None
            tl += customer_msg(t['customer'], '%s · %s' % (via_in, at[6:]), b, '', mark)
    tl = col(tl, 7, 'flex: 1; min-height: 0px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: %s transparent; padding-right: 6px;' % T['line_strong'])
    left = card(tl, title=text('全程记录', 13, T['ink'], 700), extra=row(seg(['全部', '仅消息', '仅事件'], '全部', 'sm'), 8), pad='14px 18px', gap=12, style='flex: 1; min-height: 0px;')

    info = card(col(grid(kv('店铺', t['store']) + kv('站点', t['site']) + kv('渠道', t['channel']) + kv('来源', t['source']), 2, 20, extra='row-gap: 6px;') +
                    kv('进线邮箱', store['mailbox']) + kv('订单号', t['order'] or '—'), 6), title='工单信息', pad='12px 16px', gap=8)
    target = '亚马逊 24 小时' if t['channel'] == '亚马逊' else '内部目标 24 小时'
    slab = card(col(''.join(sla_line(*x) for x in o['sla']), 8), title='SLA 结果', extra=nowrap(target, 11, T['ink3']), pad='12px 16px', gap=8)
    rule = nowrap('%s %s自动关闭' % (t['status'], P1_CLOSE_RULE[t['status']]), 11, T['ink3']) if open_ else ''
    flow = card(p1_flow(o['flow'], o['close']), title='状态流转', extra=rule, pad='12px 16px', gap=8)
    right = info + order_card_p1(t['order'], o['order_synced']) + slab + flow
    ts = ('<div style="position: absolute; right: 436px; bottom: 30px;">%s</div>' % toast('success', '已标记无需回复 · 工单转已解决', undo=5, remain=4)) if o['toast'] else ''
    body = head + '<div style="flex: 1; min-height: 0px; display: flex; gap: 16px; padding: 14px 24px 16px 24px;"><div style="flex: 1; min-width: 0px; display: flex; flex-direction: column;">%s</div><div style="width: 380px; flex-shrink: 0; display: flex; flex-direction: column; gap: 12px;">%s</div></div>%s' % (left, right, ts)
    return app('liting', '工单', ['工单', t['no']], body, phase1=True)


# ================================================================ P06 客户档案（李婷 · Sarah Mitchell）
def p06():
    ids = SARAH['identities']
    ident = lambda ch, email, extra: row(ch + nowrap(email, 12, T['ink2']) + (extra or ''), 8)
    head_l = row('<div style="width: 48px; height: 48px; border-radius: 12px; background: linear-gradient(140deg, #8b93a8, #5a6376); color: #ffffff; font-size: 16px; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">SM</div>' + col(
        row(text('Sarah Mitchell', 20, T['ink'], 600) + chip('已合并 2 个身份', 'outline', 11, 'merge'), 10) +
        ident(channel('亚马逊', 'US', 'Forcome Direct'), ids[0][1], chip('主身份', 'accent', 10)) +
        ident(channel('Shopify', 'US', 'forcome.com'), ids[1][1], nowrap('2026-06-18 李婷确认合并：同名、同收货地址', 12, T['ink3'])), 6), 14, 'flex-start')

    def stat_cell(k, v, sub=None):
        return '<div style="padding: 0px 20px; border-left: 1px solid %s;">%s</div>' % (T['line'], stat(k, v, sub, size=20))
    head_r = row(stat_cell('订单', '3', '跨 2 个店铺') + stat_cell('工单', '2', '1 张处理中') + stat_cell('累计消费', money(SARAH['spend'])) + stat_cell('上次联系', '09-10', '亚马逊站内信'), 0, 'flex-start')
    top = between(row(link('返回 T-20260910-0192', 13, None).replace('>返回', '>%s返回' % icon('chev_l', 14, T['accent']), 1) + nowrap('·', 13, T['ink4']) +
                      text('客户档案', 16, T['ink'], 600), 8),
                  row(btn('新建工单（预填该客户）', 'secondary', 'md', 'plus') + more_btn('更多：合并身份 · 导出档案'), 8))
    top = '<div style="padding: 12px 24px 0px 24px; flex-shrink: 0;">%s</div>' % top
    head = top + '<div style="margin: 10px 24px 0px 24px; background: #ffffff; border: 1px solid %s; border-radius: 16px; box-shadow: %s; padding: 16px 20px; flex-shrink: 0;">%s</div>' % (T['line'], SHADOW_XS, between(head_l, head_r, 'flex-start'))

    tk_rows = []
    for no, intent, st, day in SARAH['tickets']:
        subj = TK[no]['subject'] if no in TK else HISTORY_TICKETS[no][1]
        store = channel('亚马逊', 'US', 'Forcome Direct')
        tk_rows.append([nowrap(no, 13, T['accent'], 500), ellipsis(subj, 13), store, cat(intent), state(st), nowrap(day, 12, T['ink3'])])
    tickets = col(sec_title('工单历史', nowrap('共 2 张', 12, T['ink3'])) +
                  mtable([('工单号', 'left'), ('主题', 'left'), ('店铺', 'left'), ('意图', 'left'), ('状态', 'left'), ('最近来信', 'left')], tk_rows,
                         '124px minmax(0, 1fr) 186px 100px 76px 64px', selected=(), bars={}), 8)
    summ = card(ai_row(SARAH['summary']) + row(muted('09-10 16:01 由 AI 生成 · 依据 3 笔订单与 2 张工单', 11) + link('重新生成', 11), 10), title='客户历史摘要', extra=ai_badge('AI 摘要'), pad='12px 16px')
    notes = card(col(
        note_item('李婷', '2026-06-18 14:20', '亚马逊与 Shopify 两个身份为同一人，已合并。客户对送达时间敏感，出行前下单较多。') +
        note_item('李婷', '2026-06-14 11:05', '询问物流进度，已告知预计送达日期，当天客户确认收到。'), 10) +
        textarea_box(None, '写一条内部备注，只在团队内可见', h=56) + row(spacer() + btn('添加备注', 'secondary', 'sm', 'plus'), 8),
        title='内部备注', extra=nowrap('仅团队可见', 11, T['ink3']), pad='12px 16px', gap=10)
    left = col(tickets + summ + notes, 12, 'flex: 1; min-width: 0px;')

    orows = ''
    for no, store, day, item, amt, st in SARAH['orders']:
        p, rest = store.split(' · ')
        plat, site = (p.split(' ') + [None])[:2] if p.startswith('亚马逊') else ('Shopify', 'US')
        stc = row(state('已发货') + chip('超预计送达', 'warning'), 4) if st.startswith('已发货') else state('已签收')
        tk = ORDER_TICKET.get(no)
        tkl = row(icon('ticket', 13, T['ink4']) + (nowrap(tk, 12, T['accent'], 500) if tk else nowrap('无关联工单', 12, T['ink4'])), 4)
        orows += '<div style="padding: 9px 0px; border-bottom: 1px solid %s; display: flex; flex-direction: column; gap: 4px;">%s%s%s</div>' % (
            T['line2'], between(nowrap(no, 13, T['ink'], 700), stc), between(row(channel(plat, site, rest) + nowrap(day, 12, T['ink3']), 8), nowrap(item + ' · ' + money(amt), 12, T['ink2'])), tkl)
    rst07 = row(icon('info', 13, T['info']) + text('回复只从来信的店铺身份发出，不提及其他店铺的订单（R-ST-07）', 11, T['ink3']), 5, 'flex-start')
    orders = card(rst07 + orows, title='订单', extra=nowrap('3 笔 · 跨店铺', 11, T['ink3']), pad='12px 16px 4px 16px', gap=4)

    def id_row(ch, email, meta, main):
        act = chip('主身份', 'accent', 10) if main else more_btn('更多：设为主身份 · 拆分身份（需二次确认，记入审计）', 28)
        return '<div style="border: 1px solid %s; border-radius: 6px; padding: 10px 12px; display: flex; flex-direction: column; gap: 5px;">%s%s%s</div>' % (
            T['line'], between(ch, act), ellipsis(email, 12, T['ink2']), muted(meta, 11))
    idm = card(col(id_row(channel('亚马逊', 'US', 'Forcome Direct'), ids[0][1], '亚马逊匿名邮箱 · 来自买家消息', True) +
                   id_row(channel('Shopify', 'US', 'forcome.com'), ids[1][1], ids[1][2], False), 8) +
               row(btn('合并身份', 'secondary', 'sm', 'merge') + muted('搜索候选客户，按同名、同地址、同邮箱匹配', 11), 10),
               title='身份管理', pad='12px 16px', gap=10)
    right = col(orders + idm, 12, 'width: 400px; flex-shrink: 0;')
    body = head + '<div style="flex: 1; min-height: 0px; padding: 14px 24px 16px 24px; display: flex; flex-direction: column; gap: 12px;"><div style="flex: 1; min-height: 0px; display: flex; gap: 16px;">%s%s</div></div>' % (left, right)
    return app('liting', '工单', ['工单', '客户', 'Sarah Mitchell'], body)


def more_btn(title, size=32):
    """「…」更多按钮（悬停列出菜单项；icon_btn 不带 title，这里包一层）。"""
    return '<div title="%s" style="display: inline-flex; flex-shrink: 0;">%s</div>' % (title, icon_btn('more', 'secondary', size))


def ai_row(t):
    return '<div style="font-size: 13px; color: %s; line-height: 1.65;">%s</div>' % (T['ink2'], t)


def note_item(who_, when, t):
    return '<div style="display: flex; gap: 10px; align-items: flex-start;">%s<div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 12px; color: %s;"><span style="font-weight: 700; color: %s;">%s</span> · %s</div><div style="font-size: 13px; color: %s; line-height: 1.55; background: %s; border: 1px solid %s; border-radius: 6px; padding: 6px 10px;">%s</div></div></div>' % (
        avatar(who_[-1], 'grad', 24), T['ink3'], T['ink'], who_, when, T['ink'], '#fdf8f0', T['warn_line'], t)


if __name__ == '__main__':
    save('Tickets.dc.html', p04())
    save('TicketDetail.dc.html', p05())
    save('Customer.dc.html', p06())
    print('ok')
