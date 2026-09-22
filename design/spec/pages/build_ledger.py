# -*- coding: utf-8 -*-
"""P13 登记台账 · P14 内部结算。合计一律用 data.ledger_totals() 与 total()/fsh_share()/factory_share() 计算。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from data import *
from as_common import *

LT = ledger_totals()
LEDGER = [a for a in AFTERSALES if a['status'] != '待确认']  # 12 行，按售后单号升序


# ================================================================ P13 登记台账
def amt(x):
    return pending('待报价') if x is None else money(x)


def tracking_cell(a):
    if a['method'] != '寄配件':
        return na()
    if a['tracking']:
        return nowrap(a['tracking'], 12, T['ink2'])
    if a['status'] != '已完成':
        return na()  # 还没到寄件环节，不算缺失
    return row(pending() + link('补登', 12), 6)


def filing_cell(a):
    if not a['filing']:
        return na()
    t, s = a['filing']
    return row(nowrap(t, 12, T['ink2']) + state(s), 6)


def p13_table():
    cols = [('售后单号', 'left'), ('客户', 'left'), ('店铺与站点', 'left'), ('处理方式', 'left'), ('责任', 'left'), ('快递单号', 'left'),
            ('产品成本', 'right'), ('运费', 'right'), ('额外赔偿', 'right'), ('报备', 'left'), ('FSH / 工厂 %', 'left'), ('协商', 'left'), ('结算', 'left')]
    rows = []
    for a in LEDGER:
        rows.append([nowrap(a['no'], 12.5, T['ink'], 600), ellipsis(a['customer'], 12.5), nowrap(store_site(a), 12, T['ink2']),
                     cat(a['method']), cat(a['resp']), tracking_cell(a),
                     amt(a['product']), amt(a['freight']), money(a['comp']), filing_cell(a), ratio_txt(a), state(a['nego']), state(a['settle'])])
    lab = lambda t: '<span style="font-size: 12px; font-weight: 500; color: %s;">%s</span>' % (T['ink3'], t)
    footer = [(nowrap('合计 · %d 单' % LT['count'], 12.5, T['ink'], 700), 'left', 6),
              (money(LT['product']), 'right', 1), (money(LT['freight']), 'right', 1), (money(LT['comp']), 'right', 1),
              ('%s %s <span style="color: %s; margin: 0px 6px;">·</span> %s %s' % (lab('FSH 承担'), money(LT['fsh']), T['ink4'], lab('工厂承担'), money(LT['factory'])), 'left', 4)]
    tpl = '118px 92px 124px 100px 88px minmax(0, 1fr) 62px 60px 64px 116px 80px 64px 60px'
    return table_span(cols, rows, tpl, footer)


def p13_summary():
    """工厂承担的结算构成（与 P14、P17 同口径）。"""
    seg_ = lambda k, v, c: row(nowrap(k, 12, T['ink3']) + nowrap(v, 13, c, 700), 6)
    plus = nowrap('+', 13, T['ink4'])
    inner = row(nowrap('工厂承担', 12, T['ink2'], 700) + nowrap(money(LT['factory']), 13, T['ink'], 700) + nowrap('=', 13, T['ink4']) +
                seg_('已结算', money(LT['settled']), T['ok']) + plus + seg_('待结算', money(LT['pending']), T['accent_ink']) +
                nowrap('（已确认 %s）' % money(round(LT['settled'] + LT['pending'], 2)), 12, T['ink3']) + plus +
                seg_('未定', money(LT['undecided']), T['ink2']) + nowrap('（按建议比例估算）', 12, T['ink3']), 8)
    right = row(nowrap('费用合计', 12, T['ink3']) + nowrap(money(round(LT['product'] + LT['freight'] + LT['comp'] + LT['other'], 2)), 13, T['ink'], 700) +
                link('查看内部结算', 12, 'chev_r'), 8)
    return '<div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; background: #ffffff; border: 1px solid %s; border-radius: 8px; padding: 9px 16px; box-shadow: %s;">%s%s</div>' % (
        T['line'], SHADOW_XS, inner, right)


def p13_filters():
    left = row(filter_chip('日期', '2026-09-01 至 09-11', True) + filter_chip('店铺', '全部') + filter_chip('处理方式') + filter_chip('责任') + filter_chip('报备') + filter_chip('结算'), 8)
    right = row(nowrap('已隐藏 1 列：配件 × 数量 · 表格可横向滚动', 12, T['ink3']) + btn('列设置', 'secondary', 'md', 'sort') + btn('同步到积加', 'secondary', 'md', 'refresh') + btn('导出 Excel', 'secondary', 'md', 'download'), 8)
    return between(left, right)


def p13():
    note = muted('金额统一美元，欧元、英镑按报备当日汇率折算（S-20260911-0020 €44.90 ≈ $49.39）；工厂承担含建议比例估算的部分，以内部结算为准。进行中的单还没发生的字段显示「—」；已完成的单缺字段才标黄「待回填」并可「补登」，记入审计日志。', 12)
    body = as_head('登记台账') + content(p13_filters() + p13_table() + p13_summary() + note, '16px 24px', 12)
    return app('wanglei', '售后', ['售后', '登记台账'], body)


# ================================================================ P14 内部结算
GROUPS = [
    ('已结算', ['S-20260904-0013', 'S-20260905-0014']),
    ('待结算', ['S-20260908-0015', 'S-20260910-0017']),
    ('未定', ['S-20260903-0012', 'S-20260911-0018', 'S-20260911-0019', 'S-20260911-0020']),
]
NOTE = {
    'S-20260904-0013': '09-10 结算', 'S-20260905-0014': '09-10 结算',
    'S-20260908-0015': '陈工 09-09 接受 50 / 50', 'S-20260910-0017': '陈工 09-10 接受工厂 100%',
    'S-20260903-0012': '双方负责人商定中', 'S-20260911-0018': '报备通过后发起协商',
    'S-20260911-0019': '等生产厂报价', 'S-20260911-0020': '报备通过后发起协商',
}


def p14_table():
    cols = [('售后单号', 'left'), ('客户', 'left'), ('责任', 'left'), ('费用合计', 'right'), ('FSH / 工厂 %', 'left'), ('协商', 'left'), ('工厂承担', 'right'), ('说明', 'left')]
    tpl = '124px 104px 96px 76px 88px 84px 76px minmax(0, 1fr)'
    heads = {'已结算': '批次 2026-09-A · 09-08 生成（提前）· 09-10 双方确认', '待结算': '比例已确认 · 进入 10-05 生成的批次 2026-09-B',
             '未定': '比例未定 · 不进批次，按建议比例估算'}
    groups = []
    for st, nos in GROUPS:
        rows = []
        sub = 0.0
        for no in nos:
            a = AS[no]
            quoted = a['product'] is not None
            share = factory_share(a)
            sub += share
            rows.append([nowrap(no, 12.5, T['accent'], 600), ellipsis(a['customer'], 12.5), cat(a['resp']),
                         money(total(a)) if quoted else pending('待报价'), ratio_txt(a), state(a['nego']),
                         nowrap(money(share) if quoted else '待报价', 12.5, T['ink'] if quoted else T['ink4'], 700), ellipsis(NOTE[no], 12, T['ink3'])])
        groups.append((row(state(st) + nowrap(heads[st], 12, T['ink2']), 8), '%d 单 · 小计 <b style="color: %s;">%s</b>' % (len(nos), T['ink'], money(round(sub, 2))), rows))
    footer = [nowrap('合计 · 8 单', 12.5, T['ink'], 700), '', '', '', '', '', money(LT['factory']), nowrap('已确认 %s · 未定 %s' % (money(round(LT['settled'] + LT['pending'], 2)), money(LT['undecided'])), 12, T['ink3'])]
    return group_table(cols, groups, tpl, footer)


def p14_batches():
    a = SETTLE_BATCHES[0]
    b = SETTLE_BATCHES[1]
    amt_a = round(sum(factory_share(AS[x]) for x in a['items']), 2)
    amt_b = round(sum(factory_share(AS[x]) for x in b['items']), 2)
    ca = card(between(nowrap('批次 ' + a['no'], 14, T['ink'], 700), state(a['state'])) +
              kv('售后单', '%d 单' % len(a['items'])) + kv('工厂承担', money(amt_a)) + kv('生成', '09-08（提前生成）') +
              kv('生产厂确认', '陈工 · 09-10 15:30') + kv('FSH 确认', '王磊 · 09-10') + link('查看结算单', 12, 'chev_r'), pad='12px 14px', gap=7)
    cb = card(between(nowrap('批次 ' + b['no'], 14, T['ink'], 700), state(b['state'])) +
              kv('售后单', '%d 单' % len(b['items'])) + kv('工厂承担', money(amt_b)) + kv('计划生成', '10-05 自动') +
              muted('每月 5 日自动生成上月批次，可提前生成。生成后推送陈工确认，双方确认后转为已结算。', 12), pad='12px 14px', gap=7, tone='accent')
    rules = card(bullet('只收比例已确认的售后单；比例未定的不进批次。') + bullet('批次状态：待生成 → 待确认 → 已结算。') +
                 bullet('批次生成后其中售后单的比例不能再改，需调整时在下一批次冲销。'), '结算规则', pad='12px 14px', gap=6)
    return label('结算批次 · 东莞生产厂') + ca + cb + rules


def p14():
    kpis = grid(kpi('工厂承担（含估算）', money(LT['factory']), sub='8 单 · 2026-09 · 以内部结算为准') +
                kpi('已结算', money(LT['settled']), sub='批次 2026-09-A · 2 单') +
                kpi('待结算', money(LT['pending']), sub='进入 10-05 生成的 2026-09-B · 2 单') +
                kpi('比例未定', money(LT['undecided']), sub='4 单 · 不进批次'), 4, 12)
    filters = between(row(filter_chip('生产厂', '东莞生产厂', True) + filter_chip('月份', '2026-09', True) + filter_chip('店铺', '全部'), 8),
                      row(btn('导出结算单', 'secondary', 'md', 'download') + btn('提前生成批次 2026-09-B', 'primary', 'md', 'plus'), 8))
    main = filters + kpis + p14_table()
    body = as_head('内部结算') + two_col(main, p14_batches(), 300, 16, '16px 24px')
    return app('wanglei', '售后', ['售后', '内部结算'], body)


if __name__ == '__main__':
    save('AfterSalesLog.dc.html', p13())
    save('AfterSalesSettlement.dc.html', p14())
    print('ok', LT)
