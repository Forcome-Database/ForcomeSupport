# -*- coding: utf-8 -*-
"""P21 工厂工作台（陈工 · 生产厂 FQD）。部件供 StatesFactory 复用。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from data import *
from as_common import *

FAC = 'FQD'  # 当前登录：陈工 · 生产厂 FQD（只看本厂任务）
LT = factory_totals(FAC)
OPEN_TASKS = [t for t in FACTORY_TASKS if t['factory'] == FAC and t['state'] != '已完成']
DONE_TASKS = [t for t in FACTORY_TASKS if t['factory'] == FAC and t['state'] == '已完成']


# ---------------------------------------------------------------- 左栏 · 待办列表
def task_row(t, selected=False, override_state=None, override_note=None):
    st = override_state or t['state']
    bar = ' box-shadow: inset 3px 0 0 %s;' % T['accent'] if selected else ''
    note = override_note or t.get('due') or t.get('note', '')
    due_html = sla(note, 'normal') if (t.get('due') and not override_note) else nowrap(note, 12, T['ink3'])
    return '<div style="display: flex; flex-direction: column; gap: 5px; padding: 12px 16px; border-bottom: 1px solid %s; background: %s;%s">%s%s%s</div>' % (
        T['line2'], T['accent_bg'] if selected else '#ffffff', bar,
        between(row(cat(t['type']) + nowrap(t['aftersales'], 13, T['ink'], 700), 6), state(st)),
        ellipsis(t['item'], 12, T['ink2']),
        between(due_html, nowrap(t['at'], 11, T['ink4'])))


def f_list(sel='S-20260911-0019', empty=False, override=None):
    """override: {售后单号: (状态, 说明)}"""
    override = override or {}
    head = '<div style="padding: 14px 16px 10px 16px; display: flex; flex-direction: column; gap: 10px; border-bottom: 1px solid %s;">%s%s</div>' % (
        T['line'], between(row('<div style="font-size: 16px; font-weight: 700; color: %s;">待办</div>' % T['ink'] + nowrap('%d 项' % (0 if empty else len(OPEN_TASKS)), 12, T['ink3']), 8),
                           nowrap('按截止时间', 12, T['ink3'])),
        seg(['全部 %d' % (0 if empty else len(OPEN_TASKS)), '待处理 %d' % (0 if empty else sum(1 for t in OPEN_TASKS if (override.get(t['aftersales'], (t['state'],))[0]) == '待处理')),
             '已提交 %d' % (0 if empty else sum(1 for t in OPEN_TASKS if (override.get(t['aftersales'], (t['state'],))[0]) == '已提交'))], '全部 %d' % (0 if empty else len(OPEN_TASKS)), 'sm'))
    if empty:
        body = '<div style="flex: 1; padding: 20px 16px;">%s</div>' % row(icon('check_c', 16, T['ok'], 2) + nowrap('全部处理完毕', 13, T['ink2'], 600), 8)
    else:
        rows = ''
        for t in OPEN_TASKS:
            ov = override.get(t['aftersales'])
            rows += task_row(t, t['aftersales'] == sel, ov[0] if ov else None, ov[1] if ov else None)
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
    info = grid(stat('配件', '软管 FC-V2-HS02') + stat('数量', '2 根') + stat('目的国', '德国') + stat('邮编', '10115'), 4, 12)
    desc = col(nowrap('故障描述', 11, T['ink4']) + text('软管在接口处开裂，吸尘时漏气。客户使用约 3 周。', 13, T['ink']), 2)
    pics = row(img_thumb('照片 1', 88, 64) + img_thumb('照片 2', 88, 64), 8)
    note = row(icon('lock', 13, T['ink4']) + nowrap('询价阶段只显示配件、数量、目的国与邮编；批准寄件后可见收件信息。', 12, T['ink3']), 6)
    return card(info + divider() + row(desc + spacer() + pics, 16, 'flex-start') + note, 'FSH 的需求', nowrap('王磊 · 08:50 派发', 12, T['ink3']), pad='14px 16px', gap=12)


def quote_form(st='default'):
    """st: default / err_a（为空、为 0、日期早于今天）/ err_b（三位小数）/ filled"""
    if st == 'err_a':
        p = field('产品成本', input_box(None, '0.00', 'error', prefix='$', suffix='USD', mono=True), True, error='请填写产品成本')
        f = field('运费', input_box('0', st='error', prefix='$', suffix='USD', mono=True), True, error='运费须大于 0')
        c = field('承运方式', select_box('云途专线'))
        d = field('可寄出日期', input_box('2026-09-10', st='error', icon_name='calendar', mono=True), True, error='不能早于今天（09-11）')
    elif st == 'err_b':
        p = field('产品成本', input_box('5.205', st='error', prefix='$', suffix='USD', mono=True), True, error='最多两位小数，例如 5.21')
        f = field('运费', input_box('12.80', prefix='$', suffix='USD', mono=True), True)
        c = field('承运方式', select_box('云途专线'))
        d = field('可寄出日期', input_box('2026-09-14', icon_name='calendar', mono=True), True)
    elif st == 'filled':
        p = field('产品成本', input_box('5.20', prefix='$', suffix='USD', mono=True), True)
        f = field('运费', input_box('12.80', prefix='$', suffix='USD', mono=True), True)
        c = field('承运方式', select_box('云途专线'))
        d = field('可寄出日期', input_box('2026-09-14', icon_name='calendar', mono=True), True)
    else:
        p = field('产品成本', input_box(None, '0.00', prefix='$', suffix='USD', mono=True), True, hint='2 根合计')
        f = field('运费', input_box(None, '0.00', prefix='$', suffix='USD', mono=True), True, hint='寄到德国 10115 的运费')
        c = field('承运方式', select_box(None, '请选择承运方式'), hint='如云途专线、DHL')
        d = field('可寄出日期', input_box(None, '不早于 09-11', icon_name='calendar'), True, hint='最早今天')
    memo = field('备注', textarea_box('批次号 HS-2608，现货。' if st == 'filled' else None, '例如库存批次、包装方式', h=52, counter='0 / 200' if st != 'filled' else '14 / 200'))
    foot = between(row(icon('info', 14, T['ink4']) + nowrap('提交后直接写入 FSH 登记台账，不需要另发邮件。', 12, T['ink3']), 6),
                   row(btn('无法供货', 'danger_outline') + btn('提交报价', 'primary', 'md', 'send'), 8))
    return card(grid(p + f + c + d, 4, 12) + memo + foot, '报价', nowrap('金额为美元，最多两位小数', 12, T['ink3']), pad='14px 16px', gap=12)


def f_detail_head(title='询价 · S-20260911-0019', st='待处理', right=None):
    r = right if right is not None else sla('剩 2 个工作日', 'normal')
    return '<div style="display: flex; flex-direction: column; gap: 4px;">%s%s</div>' % (
        between(row('<div style="font-size: 18px; font-weight: 700; color: %s;">%s</div>' % (T['ink'], title) + state(st), 10), r),
        row(meta_line(['派发 09-11 08:50', '报价时限 2 个工作日', '已催办 0 次', 'FSH 对接人 王磊']), 10, extra='font-size: 12px; color: %s;' % T['ink3']))


def submitted_card():
    """报价提交后的只读结果。"""
    info = grid(stat('产品成本', '$5.20') + stat('运费', '$12.80') + stat('合计', '$18.00') + stat('承运方式', '云途专线') + stat('可寄出日期', '09-14'), 5, 12)
    return card(info + row(icon('check_c', 14, T['ok'], 2) + nowrap('陈工 10:22 提交，已写入 FSH 登记台账。FSH 报备通过后会生成寄件任务。', 12, T['ink2']), 6) +
                between(muted('需要修改时请在本单沟通里说明，由 FSH 退回后再改。', 12), btn('在本单沟通留言', 'secondary', 'sm', 'message')),
                '已提交的报价', state('已提交'), pad='14px 16px', gap=12, tone='success')


def f_middle(form_st='default', st='待处理', extra_top='', form_html=None, head_right=None):
    return '<div style="flex: 1; min-width: 0px; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; overflow: hidden;">%s%s%s%s</div>' % (
        f_detail_head(st=st, right=head_right), extra_top, need_card(), form_html if form_html is not None else quote_form(form_st))


# ---------------------------------------------------------------- 右栏 · 本单沟通
def f_thread(extra=''):
    msgs = sys_comment('08:50', '已派发询价：软管 FC-V2-HS02 ×2 · 寄往德国 10115，请在 2 个工作日内报价。') + extra
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
