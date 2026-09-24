# -*- coding: utf-8 -*-
"""P13 登记台账 · P14 内部结算。合计一律用 data.ledger_totals() 与 total()/fsh_share()/factory_share() 计算。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from data import *
from as_common import *

LT = ledger_totals()
SC = settle_counts()
LEDGER = [a for a in AFTERSALES if a['status'] != '待确认']  # 12 行，按售后单号升序

# P13「待回填」预填建议（data.LEDGER_BACKFILL）：这些单的快递单号没有自动回写（易仓回传延迟），积加出库单里已有单号（AFTERSALES 的 tracking），
# 台账显示「✦ 积加有单号 1Z… · 核对补登」，核对后一键补登（记入审计日志）。
BACKFILL = {no: AS[no]['tracking'] for no in LEDGER_BACKFILL}
LEDGER = [dict(a, tracking=None) if a['no'] in BACKFILL else a for a in LEDGER]


# ================================================================ P13 登记台账
def amt(x):
    return fee_amt(x) if x is None else money(x)


def tracking_cell(a):
    if a['method'] != '寄配件':
        return na()
    if a['tracking']:
        return ellipsis(a['tracking'], 12, T['ink2'])
    if a['status'] != '已完成':
        return na()  # 还没到寄件环节，不算缺失
    sug = BACKFILL.get(a['no'])
    if sug:
        # 生成时间 · 依据（R-AI-01）：格内显示时刻，完整说明在悬停里
        made = AI_MADE['P13_backfill']
        return '<div title="积加出库单回传单号 %s；核对后补登，记入审计日志。%s" style="display: flex; flex-direction: column; gap: 1px; min-width: 0px;">%s%s</div>' % (
            sug, made, row(pending() + nowrap('✦ 积加有单号', 11, T['accent_ink'], 600), 4),
            row(nowrap('…%s · %s' % (sug[-4:], made.split(' ')[0]), 11, T['ink3']) + link('核对补登', 11), 6))
    return row(pending() + link('补登', 12), 6)


def share_cell(a, who):
    """FSH / 工厂承担金额；比例放悬停（title）。比例为建议时按估算样式显示。"""
    _, ss = fee_states(a)
    x = fsh_share(a) if who == 'fsh' else factory_share(a)
    tip = '%s · %s' % (ratio_words(a['ratios']), '建议比例（估算）' if a['ratio_state'] == '建议' else a['ratio_state'])
    return '<div title="%s" style="display: flex; justify-content: flex-end;">%s</div>' % (tip, fee_amt(x if a['product'] is not None else None, ss, 13))


def filing_cell(a):
    if not a['filing']:
        return na()
    t, s = a['filing']
    return row(nowrap(t, 12, T['ink2']) + state(s), 6)


def p13_table():
    cols = [('售后单号', 'left'), ('客户', 'left'), ('店铺与站点', 'left'), ('处理方式', 'left'), ('责任', 'left'), ('生产厂', 'left'), ('快递单号', 'left'),
            ('产品成本', 'right'), ('运费', 'right'), ('额外赔偿', 'right'), ('报备', 'left'), ('FSH 承担 $', 'right'), ('工厂承担 $', 'right'), ('协商', 'left'), ('结算', 'left')]
    rows = []
    for a in LEDGER:
        rows.append([nowrap(a['no'], 13, T['accent'], 600), ellipsis(a['customer'], 13), nowrap(store_site(a), 12, T['ink2']),
                     cat(a['method']), cat(a['resp']), cat(a['factory']) if a.get('factory') else na(), tracking_cell(a),
                     amt(a['product']), amt(a['freight']), money(a['comp']), filing_cell(a), share_cell(a, 'fsh'), share_cell(a, 'factory'), state(a['nego']), state(a['settle'])])
    footer = [(row(nowrap('合计 · %d 单' % LT['count'], 13, T['ink'], 700) + nowrap('首列与合计行固定', 11, T['ink4']), 8), 'left', 7),
              (money(LT['product']), 'right', 1), (money(LT['freight']), 'right', 1), (money(LT['comp']), 'right', 1), ('', 'left', 1),
              (money(LT['fsh']), 'right', 1), (money(LT['factory']), 'right', 1), ('', 'left', 2)]
    tpl = '128px 88px 120px 100px 88px 46px minmax(0, 1fr) 62px 60px 64px 116px 66px 66px 64px 60px'
    return table_span(cols, rows, tpl, footer, gap=8)


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
    right = row(nowrap('已隐藏 1 列：配件 × 数量 · 表格可横向滚动', 12, T['ink3']) + btn('列设置', 'secondary', 'md', 'sort') + btn('导出 Excel', 'secondary', 'md', 'download'), 8)
    return between(left, right)


def p13():
    note = muted('金额统一美元，比索、加元按报备当日汇率折算（S-20260911-0020 %s）；承担金额「≈」为按建议比例估算，悬停看三组比例，以内部结算为准。横向滚动时首列（售后单号）与合计行固定。进行中的单还没发生的字段显示「—」；已完成的单缺字段才标黄「待回填」，积加有数据时给出预填建议，核对后「补登」并记入审计日志。' % money_cur(889.00, 'MXN', 49.39), 12)
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
    'S-20260908-0015': '陈工 09-09 接受' + ratio_words(AS['S-20260908-0015']['ratios']),
    'S-20260910-0017': '陈工 09-10 接受' + ratio_words(AS['S-20260910-0017']['ratios']),
}
# 比例未定的单：说明列做成下一步链接
NEXT = {
    'S-20260903-0012': lambda: link('去录入最终比例', 12, 'arrow_r'),
    'S-20260911-0018': lambda: row(nowrap('等周敏审批', 12, T['ink3']) + nowrap('·', 12, T['ink4']) + link('催办', 12, 'bell'), 4),
    'S-20260911-0019': lambda: row(nowrap('等陈工报价', 12, T['ink3']) + nowrap('·', 12, T['ink4']) + link('催办', 12, 'bell'), 4),
    'S-20260911-0020': lambda: row(nowrap('等周敏审批', 12, T['ink3']) + nowrap('·', 12, T['ink4']) + link('催办', 12, 'bell'), 4),
}


def p14_table():
    cols = [('售后单号', 'left'), ('生产厂', 'left'), ('客户', 'left'), ('责任', 'left'), ('费用合计', 'right'), ('FSH / 工厂 %', 'left'), ('协商', 'left'), ('工厂承担', 'right'), ('说明', 'left')]
    tpl = '124px 44px 96px 88px 84px 92px 76px 80px minmax(0, 1fr)'
    heads = {'已结算': '批次 FQD-A、FZJ-A · 09-08 提前生成 · 09-10 双方确认', '待结算': '比例已确认 · 进入 10-05 生成的批次 2026-09-FQD-B',
             '未定': '比例未定 · 不进批次，按建议比例估算'}
    groups = []
    for st, nos in GROUPS:
        rows = []
        sub = 0.0
        for no in nos:
            a = AS[no]
            quoted = a['product'] is not None
            cs, ss = fee_states(a)
            share = factory_share(a)
            sub += share
            rows.append([nowrap(no, 13, T['accent'], 600), cat(a['factory']), ellipsis(a['customer'], 13), cat(a['resp']),
                         cur_cell(a, cs), ratio_txt(a), state(a['nego']),
                         fee_amt(share if quoted else None, ss, 13, 700), NEXT[no]() if no in NEXT else ellipsis(NOTE[no], 12, T['ink3'])])
        est = '≈ ' if st == '未定' else ''
        groups.append((row(state(st) + nowrap(heads[st], 12, T['ink2']), 8), '%d 单 · 小计 <b style="color: %s;">%s%s</b>' % (len(nos), T['ink3'] if est else T['ink'], est, money(round(sub, 2))), rows))
    footer = [nowrap('合计 · %d 单' % SC['all'], 13, T['ink'], 700), '', '', '', '', '', '', money(LT['factory']), nowrap('已确认 %s · 未定 ≈ %s' % (money(round(LT['settled'] + LT['pending'], 2)), money(LT['undecided'])), 12, T['ink3'])]
    return group_table(cols, groups, tpl, footer)


def p14_batches():
    def bcard(b):
        amt = round(sum(factory_share(AS[x]) for x in b['items']), 2)
        done = b['state'] == '已结算'
        conf = b['note'].split('；')[1] if done else '生成后推送对接人确认，双方确认后转已结算'
        act = '' if done else btn('提前生成批次 %s' % b['no'], 'primary', 'sm', 'plus', full=True)
        return card(between(row(nowrap(b['no'], 13, T['ink'], 600) + cat(b['factory']), 6), state(b['state'])) +
                    kv('售后单 · 工厂承担', '%d 单 · %s' % (len(b['items']), money(amt))) +
                    kv('生成' if done else '计划生成', '%s%s' % (b['at'], '（提前）' if done else ' 自动')) +
                    muted(conf, 12) + act, pad='11px 13px', gap=6, tone=None if done else 'accent')
    rules = card(bullet('每个生产厂每月一个批次，分别确认。') + bullet('只收比例已确认的售后单；比例未定的不进批次。') + bullet('批次状态：待生成 → 待确认 → 已结算。') +
                 bullet('批次生成后其中售后单的比例不能再改，需调整时在下一批次冲销。'), '结算规则', pad='11px 13px', gap=5)
    return label('结算批次 · 按生产厂') + ''.join(bcard(b) for b in SETTLE_BATCHES) + rules


def p14():
    kpis = grid(kpi('工厂承担（含估算）', money(LT['factory']), sub='%d 单 · 2026-09 · 以内部结算为准' % SC['all']) +
                kpi('已结算', money(LT['settled']), sub='批次 FQD-A、FZJ-A · %d 单' % SC['settled']) +
                kpi('待结算', money(LT['pending']), sub='进入 10-05 生成的 FQD-B · %d 单' % SC['pending']) +
                kpi('比例未定', '≈ ' + money(LT['undecided']), sub='%d 单 · 按建议比例估算 · 不进批次' % SC['undecided']), 4, 12)
    filters = between(row(filter_chip('生产厂', '全部') + filter_chip('月份', '2026-09', True) + filter_chip('店铺', '全部'), 8),
                      row(btn('导出结算单', 'secondary', 'md', 'download'), 8))
    main = filters + kpis + p14_table()
    body = as_head('内部结算') + two_col(main, p14_batches(), 300, 16, '16px 24px')
    return app('wanglei', '售后', ['售后', '内部结算'], body)


if __name__ == '__main__':
    save('AfterSalesLog.dc.html', p13())
    save('AfterSalesSettlement.dc.html', p14())
    print('ok', LT)
