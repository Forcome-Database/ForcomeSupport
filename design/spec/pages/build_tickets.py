# -*- coding: utf-8 -*-
"""P04 Tickets · P05 TicketDetail · P06 Customer。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from data import *
from common import *

TK = {t['no']: t for t in TICKETS}
# 按 SLA 剩余升序；已解决的排在最后（按最近来信倒序）
LIST_ORDER = ['T-20260902-0071', 'T-20260910-0176', 'T-20260910-0192', 'T-20260910-0195', 'T-20260911-0031',
              'T-20260910-0170', 'T-20260911-0035', 'T-20260910-0201', 'T-20260910-0188', 'T-20260909-0142',
              'T-20260909-0128', 'T-20260904-0098', 'T-20260909-0131']
TICKET_COLS = [('', 'left'), ('工单号', 'left'), ('主题', 'left'), ('渠道与店铺', 'left'), ('客户', 'left'), ('意图', 'left'),
               ('情绪', 'left'), ('状态', 'left'), ('负责人', 'left'), ('SLA 剩余', 'left'), ('最近来信', 'left')]
TICKET_TPL = '16px 116px minmax(0, 1fr) 178px 100px 124px 40px 70px 44px 112px 76px'


def ticket_row(t, on=False):
    tags = row(''.join(pill(x) for x in t['tags']), 4, extra='flex-shrink: 0;') if t['tags'] else ''
    subj = '<div style="display: flex; align-items: center; gap: 6px; min-width: 0px;">%s%s</div>' % (ellipsis(t['subject'], 12.5, T['ink'], 500), tags)
    owner = nowrap(t['owner'], 12.5, T['ink4'] if t['owner'] == '未分配' else T['ink'])
    s = sla(t['sla_left'], t['sla_level'])
    if t.get('sla_kind'):
        s = row(s + nowrap('内部', 11, T['ink4']), 4)
    return [cbox(on), nowrap(t['no'], 12.5, T['accent'], 500), subj, channel(t['channel'], t['site'], t['store']),
            ellipsis(t['customer'], 12.5), cat(t['intent']), sentiment(t['sentiment']),
            state(t['status']), owner, s, nowrap(t['last_in'], 12, T['ink3'])]


def ticket_table(nos, selected_nos=(), bars=None):
    rows = [ticket_row(TK[n], n in selected_nos) for n in nos]
    sel = {i for i, n in enumerate(nos) if n in selected_nos}
    cols = list(TICKET_COLS)
    cols[0] = (cbox_partial() if sel else cbox(False), 'left')
    return mtable(cols, rows, TICKET_TPL, sel, bars or {i: 'danger' for i, n in enumerate(nos) if TK[n]['status'] == '转人工'}, py=7)


def ticket_filters(active=None):
    active = active or {}
    names = [('状态', None), ('渠道', None), ('店铺', None), ('意图', None), ('情绪', None), ('标签', None), ('负责人', None), ('最近来信', '近 30 天')]
    left = ''.join(filter_chip(n, active.get(n, v), n in active or (v is not None)) for n, v in names) + filter_chip('未归属店铺')
    return between(row(left, 6, wrap=True), row(nowrap('排序', 12, T['ink3']) + select_box('SLA 剩余 · 升序', width='148px', h=28), 6))


def ticket_metrics(active=None):
    return grid(metric_tile('未关闭', '11', '全部店铺', active=active == '未关闭') +
                metric_tile('待审草稿', '3', '其中 1 张未分配', 'accent', active == '待审草稿') +
                metric_tile('2 小时内到期', '2', '亚马逊 1 · 内部目标 1', 'danger', active == '2 小时内到期') +
                metric_tile('转人工', '1', '平台风险 1', 'danger', active == '转人工'), 4, 12)


def batch_bar(n=2):
    return ('<div style="display: flex; align-items: center; gap: 8px; background: %s; border: 1px solid %s; border-radius: 8px; padding: 6px 8px 6px 14px;">'
            '%s<div style="font-size: 13px; font-weight: 700; color: %s; white-space: nowrap;">已选 %d 张</div>%s%s%s%s%s%s<div style="flex: 1;"></div>%s</div>') % (
        T['accent_bg'], T['accent_line'], cbox_partial(), T['accent_ink'], n, divider(True, 16),
        btn('改派', 'secondary', 'sm', 'handoff'), btn('添加标签', 'secondary', 'sm', 'tag'), btn('合并', 'secondary', 'sm', 'merge', disabled=True),
        row(icon('info', 13, T['ink4']) + nowrap('合并仅限同店铺、同客户的工单', 12, T['ink3']), 4), btn('关闭', 'secondary', 'sm', 'x_c'),
        btn('取消选择', 'ghost', 'sm'))


# ================================================================ P04 工单列表（周敏）
def p04():
    head = page_head('工单', '全部渠道 · 全部店铺', btn('导出', 'secondary', 'md', 'download') + btn('新建工单', 'primary', 'md', 'plus'))
    inner = ticket_metrics() + ticket_filters() + col(batch_bar(2) + ticket_table(LIST_ORDER, ('T-20260910-0192', 'T-20260910-0195')), 8) + pagination('共 13 条 · 每页 20 条', 1, 1)
    return app('zhoumin', '工单', ['工单', '全部工单'], head + content(inner, '14px 24px 12px 24px', 12))


# ================================================================ P05 工单详情 · 全程记录（李婷 · Oliver Grant）
def ev(time_, actor, t):
    """时间线事件行：分隔线 + 时间 + 执行者标识 + 事件。"""
    return '<div style="display: flex; align-items: center; gap: 10px;"><div style="width: 16px; height: 1px; background: %s; flex-shrink: 0;"></div><div style="font-size: 12px; color: %s; white-space: nowrap; font-variant-numeric: tabular-nums;">%s</div>%s<div style="font-size: 12px; color: %s; white-space: nowrap;">%s</div><div style="flex: 1; height: 1px; background: %s;"></div></div>' % (
        T['line'], T['ink4'], time_, who(actor), T['ink2'], t, T['line'])


def p05():
    t = TK['T-20260904-0098']
    head = detail_head('Charger cable not working', state('已解决') + channel('亚马逊', 'UK', 'Forcome Direct') + btn('添加标签', 'link', 'sm', 'plus'),
                       btn('重新打开', 'secondary', 'md', 'refresh') + btn('合并', 'secondary', 'md', 'merge') + btn('内部备注', 'secondary', 'md', 'message') + btn('导出记录', 'secondary', 'md', 'download'),
                       meta=''.join([nowrap(t['no'], 12, T['ink3']), nowrap('·', 12, T['ink4']), nowrap('客户 <span style="color: %s; font-weight: 600;">Oliver Grant</span>' % T['accent'], 12, T['ink3']),
                                     nowrap('·', 12, T['ink4']), nowrap('订单 204-5566778-9900112', 12, T['ink3']), nowrap('·', 12, T['ink4']),
                                     nowrap('负责人 李婷', 12, T['ink3']), nowrap('·', 12, T['ink4']), nowrap('09-10 09:00 已解决，7 天无来信将于 09-17 自动关闭', 12, T['ink3'])]))
    ov = avatar('O', 'grey', 28)
    me = avatar('婷', 'green', 28)
    a_chip = chip('A 版 · 未修改', 'accent', 10, 'spark')
    tl = col(''.join([
        message('Oliver Grant', '经积加同步 · 09-04 10:12', "Hi, the charger cable doesn't work. I plug it in and nothing happens, no light on the vacuum at all.", 'in', ov),
        ev('09-04 10:13', '系统', '意图「产品故障与使用问题」，未命中风险信号；生成 3 版草稿，推荐 A 版排查'),
        message('李婷', '经积加发出 · 09-04 10:40', "Hi Oliver, sorry about the trouble. Could you try a different 12V socket and check the car's cigarette lighter fuse? If it still won't charge, just reply here and we'll sort it out.", 'out', me, a_chip),
        message('Oliver Grant', '经积加同步 · 09-04 20:05', 'Tried another socket, still nothing. But it charges fine with my own USB-C cable.', 'in', ov),
        ev('09-05 09:00', '系统', '排查树结论「充电线故障」，创建售后单 S-20260905-0014（待确认）'),
        ev('09-05 09:10', '人工', '王磊确认：寄配件 · 良仓有货 · 产品质量问题；报备快递费用 $5.90'),
        ev('09-05 09:40', '人工', '周敏批准 AP-20260905-002，积加创建售后发货单'),
        ev('09-05 15:20', '良仓', '良仓发出，UPS 1Z4R28830358229052'),
        message('李婷', '经积加发出 · 09-05 15:30 · 工单转「等客户」', "Hi Oliver, a replacement charging cable is on its way via UPS, tracking 1Z4R28830358229052. Please keep the old cable, no return needed.", 'out', me, a_chip),
        ev('09-06 10:05', '工厂', '陈工在工厂工作台接受承担比例：工厂 100%'),
        ev('09-10 15:30', '系统', '结算批次 2026-09-A 双方确认，已结算；本单工厂承担 $7.30'),
        message('Oliver Grant', '经积加同步 · 09-10 09:00', 'Thanks, the new cable works!', 'in', ov),
        ev('09-10 09:00', '系统', '识别为致谢：亚马逊无需回复，工单转「已解决」'),
    ]), 10)
    left = card(tl, title=text('全程记录', 13, T['ink'], 700), extra=row(seg(['全部', '仅消息', '仅事件'], '全部', 'sm'), 8), pad='14px 18px', gap=12, style='flex: 1; min-height: 0px;')

    info = card(col(kv('店铺', 'Forcome Direct · 亚马逊 UK') + kv('意图', cat('产品故障与使用问题')) + kv('情绪', sentiment('正面')) +
                    kv('重复联系', '1 次'), 6), title='工单信息', pad='12px 16px')

    def sla_line(arr, res, tone, note):
        return '<div style="display: flex; align-items: center; gap: 8px; font-size: 12px;"><div style="color: %s; width: 108px; white-space: nowrap; font-variant-numeric: tabular-nums;">%s 来信</div><div style="flex: 1; color: %s; font-weight: 600; white-space: nowrap;">%s</div>%s</div>' % (
            T['ink3'], arr, T['ink'], res, chip(note, tone, 10) if note else '')
    slab = card(col(sla_line('09-04 10:12', '首次回复 28m', 'success', '达标') + sla_line('09-04 20:05', '首次回复 19h 25m', 'success', '达标') +
                    sla_line('09-10 09:00', '致谢，无需回复', 'muted', None), 8), title='SLA 结果', extra=nowrap('亚马逊 24 小时', 11, T['ink3']), pad='12px 16px')
    fl = row(chip('新建', 'neutral', 11) + flow_arrow() + state('待审草稿') + flow_arrow() + state('等客户') + flow_arrow() + state('等内部') + flow_arrow() +
             state('等客户') + flow_arrow() + state('已解决') + flow_arrow() + chip('09-17 自动关闭', 'muted', 11), 4, wrap=True)
    flow = card(fl, title='状态流转', pad='12px 16px')
    rel = card(col(kv('订单', '204-5566778-9900112') + kv('售后单', row(nowrap('S-20260905-0014', 12, T['accent'], 600) + state('已完成'), 6)) +
                   kv('审批单', row(nowrap('AP-20260905-002', 12, T['accent'], 600) + state('已执行'), 6)) + kv('客户', link('Oliver Grant', 12)), 6), title='关联', pad='12px 16px')
    ai = card(col(kv('回复', '2 次，均采纳 A 版未修改') + kv('采纳率', '计入「产品故障与使用问题」') + kv('知识', '充电线不充电排查（命中 2 次）'), 6),
              title='AI 记录', extra=btn('标记为 FAQ 候选', 'secondary', 'sm', 'star'), pad='12px 16px')
    right = info + slab + flow + rel + ai
    body = head + '<div style="flex: 1; min-height: 0px; display: flex; gap: 16px; padding: 16px 24px;"><div style="flex: 1; min-width: 0px; display: flex; flex-direction: column;">%s</div><div style="width: 380px; flex-shrink: 0; display: flex; flex-direction: column; gap: 12px;">%s</div></div>' % (left, right)
    return app('liting', '工单', ['工单', 'T-20260904-0098'], body)


# ================================================================ P06 客户档案（李婷 · Sarah Mitchell）
def p06():
    ids = SARAH['identities']
    ident = lambda ch, email, extra: row(ch + nowrap(email, 12, T['ink2']) + (extra or ''), 8)
    head_l = row(avatar('S', 'grey', 48) + col(
        row(text('Sarah Mitchell', 18, T['ink'], 700) + chip('已合并 2 个身份', 'outline', 11, 'merge'), 10) +
        ident(channel('亚马逊', 'US', 'Forcome Direct'), ids[0][1], chip('主身份', 'accent', 10)) +
        ident(channel('Shopify', 'US', 'forcome.com'), ids[1][1], nowrap('2026-06-18 李婷确认合并：同名、同收货地址', 12, T['ink3'])), 6), 14, 'flex-start')

    def stat_cell(k, v, sub=None):
        return '<div style="padding: 0px 20px; border-left: 1px solid %s;">%s</div>' % (T['line'], stat(k, v, sub, size=20))
    head_r = row(stat_cell('订单', '3', '跨 2 个店铺') + stat_cell('工单', '2', '1 张处理中') + stat_cell('累计消费', money(SARAH['spend'])) + stat_cell('上次联系', '09-10', '亚马逊站内信'), 0, 'flex-start')
    head = white_panel(between(head_l, head_r, 'flex-start'), '16px 24px')

    note = banner('info', '对客户的回复不提及其他店铺的订单', '回复从来信的同一店铺身份发出。Sarah 在 forcome.com 的订单只供你了解情况，不能写进亚马逊站内信。')

    tk_rows = []
    for no, intent, st, day in SARAH['tickets']:
        subj = TK[no]['subject'] if no in TK else HISTORY_TICKETS[no][1]
        store = channel('亚马逊', 'US', 'Forcome Direct')
        tk_rows.append([nowrap(no, 12.5, T['accent'], 500), ellipsis(subj, 12.5), store, cat(intent), state(st), nowrap(day, 12, T['ink3'])])
    tickets = col(sec_title('工单历史', nowrap('共 2 张', 12, T['ink3'])) +
                  mtable([('工单号', 'left'), ('主题', 'left'), ('店铺', 'left'), ('意图', 'left'), ('状态', 'left'), ('最近来信', 'left')], tk_rows,
                         '124px minmax(0, 1fr) 186px 100px 76px 64px', selected=(), bars={}), 8)
    summ = card(ai_row(SARAH['summary']) + row(muted('09-10 16:01 由 AI 生成 · 依据 3 笔订单与 2 张工单', 11) + link('重新生成', 11), 10), title='客户历史摘要', extra=chip('AI', 'accent', 10), pad='12px 16px')
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
        orows += '<div style="padding: 10px 0px; border-bottom: 1px solid %s; display: flex; flex-direction: column; gap: 5px;">%s%s</div>' % (
            T['line2'], between(nowrap(no, 13, T['ink'], 700), stc), between(row(channel(plat, site, rest) + nowrap(day, 12, T['ink3']), 8), nowrap(item + ' · ' + money(amt), 12, T['ink2'])))
    orders = card(orows, title='订单', extra=nowrap('3 笔 · 跨店铺', 11, T['ink3']), pad='12px 16px 4px 16px', gap=2)

    def id_row(ch, email, meta, main):
        act = chip('主身份', 'accent', 10) if main else btn('拆分身份', 'danger_outline', 'sm')
        return '<div style="border: 1px solid %s; border-radius: 6px; padding: 10px 12px; display: flex; flex-direction: column; gap: 5px;">%s%s%s</div>' % (
            T['line'], between(ch, act), ellipsis(email, 12, T['ink2']), muted(meta, 11))
    idm = card(col(id_row(channel('亚马逊', 'US', 'Forcome Direct'), ids[0][1], '亚马逊匿名邮箱 · 来自积加同步', True) +
                   id_row(channel('Shopify', 'US', 'forcome.com'), ids[1][1], ids[1][2], False), 8) +
               row(btn('合并身份', 'secondary', 'sm', 'merge') + muted('搜索候选客户，按同名、同地址、同邮箱匹配', 11), 10),
               title='身份管理', pad='12px 16px', gap=10)
    right = col(orders + idm, 12, 'width: 400px; flex-shrink: 0;')
    body = head + '<div style="flex: 1; min-height: 0px; padding: 14px 24px 16px 24px; display: flex; flex-direction: column; gap: 12px;">%s<div style="flex: 1; min-height: 0px; display: flex; gap: 16px;">%s%s</div></div>' % (note, left, right)
    return app('liting', '工单', ['工单', '客户', 'Sarah Mitchell'], body)


def ai_row(t):
    return '<div style="display: flex; gap: 8px; align-items: flex-start;"><div style="padding-top: 3px;">%s</div><div style="font-size: 13px; color: %s; line-height: 1.6;">%s</div></div>' % (
        icon('spark', 14, T['accent'], 2), T['ink2'], t)


def note_item(who_, when, t):
    return '<div style="display: flex; gap: 10px; align-items: flex-start;">%s<div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 12px; color: %s;"><span style="font-weight: 700; color: %s;">%s</span> · %s</div><div style="font-size: 13px; color: %s; line-height: 1.55; background: %s; border: 1px solid %s; border-radius: 6px; padding: 6px 10px;">%s</div></div></div>' % (
        avatar(who_[-1], 'green', 24), T['ink3'], T['ink'], who_, when, T['ink'], T['warn_bg'], T['warn_line'], t)


if __name__ == '__main__':
    save('Tickets.dc.html', p04())
    save('TicketDetail.dc.html', p05())
    save('Customer.dc.html', p06())
    print('ok')
