# -*- coding: utf-8 -*-
"""P21 工厂工作台（陈工 · 生产厂 FQD）。部件供 StatesFactory 复用。
界面文字按工厂人员易懂的说法：比例协商 → 费用分摊，报备 → FSH 审批，三组 → 成本 / 运费 / 其他三项；
任务类型内部名不变（悬停显示原名）。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from data import *
from as_common import *

FAC = 'FQD'  # 当前登录：陈工 · 生产厂 FQD（只看本厂任务）
LT = factory_totals(FAC)
SEL = 'S-20260911-0019'
Q = QUOTES[SEL]  # 报价「已填 / 已提交」画面用
DEST = ORDERS[[t['order'] for t in TICKETS if t['no'] == AS[SEL]['ticket']][0]]  # 目的国与邮编
amt2 = lambda x: '%.2f' % x
OPEN_TASKS = [t for t in FACTORY_TASKS if t['factory'] == FAC and t['state'] != '已完成']
DONE_TASKS = [t for t in FACTORY_TASKS if t['factory'] == FAC and t['state'] == '已完成']

# 报价参考（仅参考，仍由对接人填写）：该配件近 3 次报价（每根）与寄往墨西哥的运费区间——data.QUOTE_REF
REF_UNIT = tuple(money(x) for x in QUOTE_REF[AS[SEL]['part']]['unit'])
REF_FREIGHT_MX = tuple(money(x) for x in QUOTE_REF[AS[SEL]['part']]['freight']['MX'])

# 工厂侧叫法（只改界面文字）
TYPE_LABEL = {'比例协商': '费用分摊'}
PART_LABEL = {'产品成本': '成本', '快递物流': '运费', '其他费用': '其他'}
_WORDS = [('比例协商', '费用分摊'), ('三组均', '三项均'), ('三组', '三项'), ('FSH 报备审批', 'FSH 审批'), ('FSH 报备', 'FSH 审批'), ('报备', 'FSH 审批'),
          ('产品成本 FSH', '成本 FSH'), ('快递物流 FSH', '运费 FSH'), ('其他费用 FSH', '其他 FSH')]


def fx(s):
    for a, b in _WORDS:
        s = s.replace(a, b)
    return s


def type_chip(t):
    lab = TYPE_LABEL.get(t)
    if not lab:
        return cat(t)
    return '<div title="系统内部名：%s" style="display: inline-flex; flex-shrink: 0;">%s</div>' % (t, cat(lab))


# ---------------------------------------------------------------- 左栏 · 待办列表
def task_row(t, selected=False, override_state=None, override_note=None):
    st = override_state or t['state']
    bar = ' box-shadow: inset 3px 0 0 %s;' % T['accent'] if selected else ''
    note = fx(override_note or t.get('due') or t.get('note', ''))
    due_html = sla(note, 'normal') if (t.get('due') and not override_note) else ellipsis(note, 12, T['ink3'])
    foot = '<div style="display: flex; align-items: center; gap: 8px;"><div style="flex: 1; min-width: 0px; display: flex;">%s</div><div style="flex-shrink: 0;">%s</div></div>' % (
        due_html, nowrap(t['at'], 11, T['ink4']))
    return '<div style="display: flex; flex-direction: column; gap: 5px; padding: 11px 16px; border-bottom: 1px solid %s; background: %s;%s">%s%s%s</div>' % (
        T['line2'], T['accent_bg'] if selected else '#ffffff', bar,
        between(row(type_chip(t['type']) + nowrap(t['aftersales'], 13, T['ink'], 700), 6), state(st)),
        ellipsis(fx(t['item']), 12, T['ink2']), foot)


def group_head(t, n, tone='accent', sub_=None):
    dot = '<div style="width: 6px; height: 6px; border-radius: 999px; background: %s;"></div>' % (T['accent'] if tone == 'accent' else T['ink4'])
    return '<div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 16px 6px 16px; border-bottom: 1px solid %s; background: %s;">%s%s</div>' % (
        T['line2'], T['subtle'], row(dot + nowrap(t, 12, T['ink2'], 700) + nowrap(str(n), 12, T['ink3'], 600), 6), nowrap(sub_, 11, T['ink4']) if sub_ else '')


def f_list(sel='S-20260911-0019', empty=False, override=None):
    """override: {售后单号: (状态, 说明)}。待办分两组：需要你处理（待处理）/ 等待 FSH（已提交）。"""
    override = override or {}
    st_of = lambda t: override.get(t['aftersales'], (t['state'],))[0]
    mine = [] if empty else [t for t in OPEN_TASKS if st_of(t) == '待处理']
    wait = [] if empty else [t for t in OPEN_TASKS if st_of(t) != '待处理']
    head = '<div style="padding: 14px 16px 12px 16px; border-bottom: 1px solid %s;">%s</div>' % (
        T['line'], between(row('<div style="font-size: 16px; font-weight: 700; color: %s;">待办</div>' % T['ink'] + nowrap('%d 项' % (len(mine) + len(wait)), 12, T['ink3']), 8),
                           nowrap('按截止时间', 12, T['ink3'])))
    if empty:
        body = '<div style="flex: 1; padding: 20px 16px;">%s</div>' % row(icon('check_c', 16, T['ok'], 2) + nowrap('全部处理完毕', 13, T['ink2'], 600), 8)
    else:
        def rows_of(ts):
            out = ''
            for t in ts:
                ov = override.get(t['aftersales'])
                out += task_row(t, t['aftersales'] == sel, ov[0] if ov else None, ov[1] if ov else None)
            return out
        rows = group_head('需要你处理', len(mine), 'accent')
        rows += rows_of(mine) if mine else '<div style="padding: 10px 16px; border-bottom: 1px solid %s;">%s</div>' % (T['line2'], nowrap('暂无，新任务会推送到钉钉工作通知', 12, T['ink4']))
        rows += group_head('等待 FSH', len(wait), 'muted', 'FSH 处理后会通知你') + rows_of(wait)
        rows += '<div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid %s;">%s%s</div>' % (
            T['line2'], row(icon('chev_r', 14, T['ink3']) + nowrap('已完成 %d 项' % len(DONE_TASKS), 12, T['ink2'], 600), 6), nowrap('展开', 12, T['accent'], 500))
        body = '<div style="flex: 1; min-height: 0px; display: flex; flex-direction: column;">%s</div>' % rows
    foot = '<div style="padding: 12px 16px; border-top: 1px solid %s; background: %s; display: flex; flex-direction: column; gap: 4px;">%s%s%s</div>' % (
        T['line'], T['subtle'], between(nowrap('本月本厂应承担（已确认）', 12, T['ink3']), nowrap(money(round(LT['settled'] + LT['pending'], 2)), 14, T['ink'], 700)),
        nowrap('已结算 %s · 待结算 %s' % (money(LT['settled']), money(LT['pending'])), 11, T['ink3']),
        between(nowrap('批次 2026-09-FQD-B 于 10-05 生成', 11, T['ink3']), link('查看结算', 12, 'chev_r')))
    return '<div style="width: 320px; flex-shrink: 0; box-sizing: border-box; background: #ffffff; border: 1px solid %s; border-radius: 16px; box-shadow: 0 1px 2px rgba(16,20,35,0.04); overflow: hidden; margin: 10px 0px 12px 14px; display: flex; flex-direction: column; min-height: 0px;">%s%s%s</div>' % (
        T['line'], head, body, foot)


# ---------------------------------------------------------------- 中栏 · 询价任务
def need_card():
    info = grid(stat('配件', '软管 FC-V2-HS02') + stat('数量', '2 根') + stat('目的国', DEST['country']) + stat('邮编', DEST['zip']), 4, 12)
    desc = col(nowrap('故障描述', 11, T['ink4']) + text('软管在接口处开裂，吸尘时漏气。客户使用约 3 周。', 13, T['ink']), 2)
    pics = row(img_thumb('照片 1', 88, 64) + img_thumb('照片 2', 88, 64), 8)
    note = row(icon('lock', 13, T['ink4']) + nowrap('询价阶段只显示配件、数量、目的国与邮编；批准寄件后可见收件信息。', 12, T['ink3']), 6)
    return card(info + divider() + row(desc + spacer() + pics, 16, 'flex-start') + note, 'FSH 的需求', nowrap('系统自动派发 · 08:50', 12, T['ink3']), pad='14px 16px', gap=12)


def ref_line(compact=False):
    """✦ 报价参考：只作参考，仍由对接人填写。"""
    t = '该配件近 3 次报价 %s–%s / 根 · 到%s运费参考 %s–%s' % (REF_UNIT[0], REF_UNIT[1], DEST['country'], REF_FREIGHT_MX[0], REF_FREIGHT_MX[1])
    if compact:
        t = '近 3 次 %s–%s / 根 · 运费 %s–%s' % (REF_UNIT[0], REF_UNIT[1], REF_FREIGHT_MX[0], REF_FREIGHT_MX[1])
    made = AI_MADE['P21_quote_ref']  # 生成时间 · 依据（R-AI-01）
    if compact:
        return '<div title="%s" style="display: flex; align-items: center; gap: 8px; background: %s; border-radius: 8px; padding: 6px 10px; min-width: 0px;">%s%s<div style="flex: 1;"></div>%s</div>' % (
            made, T['accent_bg'], nowrap('✦ 参考', 12, T['accent_ink'], 700), ellipsis(t, 12, T['ink2']), nowrap(made.split(' · ')[0], 11, T['ink4']))
    return '<div style="display: flex; flex-direction: column; gap: 2px; background: %s; border-radius: 8px; padding: 6px 10px; min-width: 0px;"><div style="display: flex; align-items: center; gap: 8px; min-width: 0px;">%s%s<div style="flex: 1;"></div>%s</div>%s</div>' % (
        T['accent_bg'], nowrap('✦ 参考', 12, T['accent_ink'], 700), ellipsis(t, 12, T['ink2']), nowrap('仅供参考，请按实际填写', 12, T['ink4']),
        '<div style="padding-left: 52px;">%s</div>' % nowrap(made, 11, T['ink4']))


def date_picker():
    """可寄出日期的日历浮层：今天（09-11）以前不可选。2026-09-01 为周二。"""
    cell = 'width: 30px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 6px; font-size: 12px; font-variant-numeric: tabular-nums;'
    wk = ''.join('<div style="%s color: %s; font-weight: 600;">%s</div>' % (cell, T['ink4'], d) for d in '一二三四五六日')
    days = '<div style="%s"></div>' % cell
    for d in range(1, 31):
        if d < 11:
            st = 'color: %s; text-decoration: line-through;' % T['ink5']
        elif d == 11:
            st = 'color: %s; font-weight: 700; box-shadow: inset 0 0 0 1px %s;' % (T['accent'], T['accent'])
        elif d == 14:
            st = 'color: #ffffff; font-weight: 700; background: %s;' % T['accent']
        else:
            st = 'color: %s;' % T['ink']
        days += '<div title="%s" style="%s %s">%d</div>' % ('今天以前不可选' if d < 11 else '', cell, st, d)
    head = '<div style="display: flex; align-items: center; justify-content: space-between;">%s%s%s</div>' % (icon('chev_l', 14, T['ink3']), nowrap('2026 年 9 月', 13, T['ink'], 600), icon('chev_r', 14, T['ink3']))
    foot = row(icon('lock', 12, T['ink4']) + nowrap('今天（09-11）以前不可选', 11, T['ink3']), 4)
    return '<div style="width: 236px; box-sizing: border-box; background: #ffffff; border: 1px solid %s; border-radius: 12px; box-shadow: %s; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px;">%s<div style="display: grid; grid-template-columns: repeat(7, 30px); row-gap: 2px;">%s%s</div>%s</div>' % (
        T['line'], SHADOW_MD, head, wk, days, foot)


def quote_form(st='default'):
    """st: default / err_a（为空、为 0、日期早于今天）/ err_b（三位小数）/ filled"""
    if st == 'err_a':
        p = field('产品成本', input_box(None, '如 5.20', 'error', prefix='$', suffix='USD', mono=True), True, error='请填写产品成本')
        f = field('运费', input_box('0', st='error', prefix='$', suffix='USD', mono=True), True, error='运费须大于 0')
        c = field('承运方式', select_box('云途专线'))
        d = field('可寄出日期', input_box('2026-09-10', st='error', icon_name='calendar', mono=True), True, error='不能早于今天（09-11）')
    elif st == 'err_b':
        p = field('产品成本', input_box('5.205', st='error', prefix='$', suffix='USD', mono=True), True, error='最多两位小数，例如 5.21')
        f = field('运费', input_box(amt2(Q['freight']), prefix='$', suffix='USD', mono=True), True)
        c = field('承运方式', select_box(Q['carrier']))
        d = field('可寄出日期', input_box(Q['ship_date'], icon_name='calendar', mono=True), True)
    elif st == 'filled':
        p = field('产品成本', input_box(amt2(Q['product']), prefix='$', suffix='USD', mono=True), True)
        f = field('运费', input_box(amt2(Q['freight']), prefix='$', suffix='USD', mono=True), True)
        c = field('承运方式', select_box(Q['carrier']))
        d = field('可寄出日期', input_box(Q['ship_date'], icon_name='calendar', mono=True), True)
    else:
        p = field('产品成本', input_box(None, '如 5.20', prefix='$', suffix='USD', mono=True), True, hint='%d 根合计' % AS[SEL]['qty'])
        f = field('运费', input_box(None, '如 12.80', prefix='$', suffix='USD', mono=True), True, hint='寄到%s %s 的运费' % (DEST['country'], DEST['zip']))
        c = field('承运方式', select_box(None, '请选择承运方式'), hint='如云途专线、DHL')
        d = field('可寄出日期', input_box(None, '选择日期', icon_name='calendar'), True, hint='今天（09-11）以前不可选')
    memo = field('备注', textarea_box(Q['memo'] if st == 'filled' else None, '例如库存批次、包装方式', h=52, counter='0 / 200' if st != 'filled' else '%d / 200' % len(Q['memo'])))
    # 危险操作「无法供货」放左下，与主按钮拉开
    foot = between(btn('无法供货', 'danger_outline', 'md', 'x_c'),
                   row(row(icon('info', 14, T['ink4']) + nowrap('提交后直接写入 FSH 登记台账，不需要另发邮件。', 12, T['ink3']), 6) + btn('提交报价', 'primary', 'md', 'send'), 12))
    return card(ref_line() + grid(p + f + c + d, 4, 12) + memo + foot, '报价', nowrap('金额为美元，最多两位小数', 12, T['ink3']), pad='14px 16px', gap=12)


def f_detail_head(title='询价 · S-20260911-0019', st='待处理', right=None):
    r = right if right is not None else sla('剩 2 个工作日 · 09-15 周二 09:00 截止', 'normal')
    return '<div style="display: flex; flex-direction: column; gap: 4px;">%s%s</div>' % (
        between(row('<div style="font-size: 20px; font-weight: 700; color: %s;">%s</div>' % (T['ink'], title) + state(st), 10), r),
        row(meta_line(['派发 08:50（从 09:00 起算）', '报价时限 2 个工作日', '已催办 0 次', 'FSH 对接人 王磊']), 10, extra='font-size: 12px; color: %s;' % T['ink3']))


def submitted_card():
    """报价提交后的只读结果。"""
    info = grid(stat('产品成本', money(Q['product'])) + stat('运费', money(Q['freight'])) + stat('合计', money(round(Q['product'] + Q['freight'], 2))) +
                stat('承运方式', Q['carrier']) + stat('可寄出日期', Q['ship_date'][5:]), 5, 12)
    return card(info + row(icon('check_c', 14, T['ok'], 2) + nowrap('陈工 ' + Q['at'] + ' 提交，已写入 FSH 登记台账。FSH 审批通过后会生成寄件任务。', 12, T['ink2']), 6) +
                between(muted('需要修改时请在本单沟通里说明，由 FSH 退回后再改。', 12), btn('在本单沟通留言', 'secondary', 'sm', 'message')),
                '已提交的报价', state('已提交'), pad='14px 16px', gap=12, tone='success')


def next_card():
    """提交报价后会发生什么（让对接人知道后续步骤）。"""
    return card(row(nowrap('提交后', 12, T['ink3'], 600) + flow_steps(['FSH 审批', '生成寄件任务（显示收件信息）', '寄出后回填单号与运费', '费用分摊']), 12),
                pad='11px 16px', gap=6)


def f_middle(form_st='default', st='待处理', extra_top='', form_html=None, head_right=None):
    return '<div style="flex: 1; min-width: 0px; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; overflow: hidden;">%s%s%s%s%s</div>' % (
        f_detail_head(st=st, right=head_right), extra_top, need_card(), form_html if form_html is not None else quote_form(form_st), next_card())


# ---------------------------------------------------------------- 右栏 · 本单沟通
def f_thread(extra=''):
    msgs = sys_comment('08:50', '已派发询价：软管 FC-V2-HS02 ×%d · 寄往%s %s，请在 2 个工作日内报价。' % (AS[SEL]['qty'], DEST['country'], DEST['zip'])) + extra
    box = '<div style="display: flex; flex-direction: column; gap: 8px; border-top: 1px solid %s; padding-top: 12px;">%s%s</div>' % (
        T['line'], textarea_box(None, '给 FSH 留言，可附图片', h=72), between(row(icon_btn('image', 'secondary', 28) + icon_btn('clip', 'secondary', 28), 6), btn('发送', 'secondary', 'sm', 'send')))
    return '<div style="width: 316px; flex-shrink: 0; box-sizing: border-box; background: #ffffff; border: 1px solid %s; border-radius: 16px; box-shadow: 0 1px 2px rgba(16,20,35,0.04); overflow: hidden; margin: 10px 14px 12px 0px; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px;">%s%s<div style="flex: 1;"></div>%s%s</div>' % (
        T['line'], between(row('<div style="font-size: 14px; font-weight: 700; color: %s;">本单沟通</div>' % T['ink'] + nowrap('S-20260911-0019', 12, T['ink3']), 8), ''),
        msgs, muted('留言随售后单存档；FSH 回复会推送到钉钉工作通知。', 11), box)


def p21(form_st='default', sel='S-20260911-0019', override=None, st='待处理', extra_top='', thread_extra='', form_html=None, head_right=None, badges=None):
    body = '<div style="flex: 1; min-height: 0px; display: flex; flex-direction: row;">%s%s%s</div>' % (
        f_list(sel, override=override), f_middle(form_st, st, extra_top, form_html, head_right), f_thread(thread_extra))
    return factory_app('待办', ['待办', '询价 · S-20260911-0019'], body, badges=badges)


if __name__ == '__main__':
    save('FactoryPortal.dc.html', p21())
    print('ok')
