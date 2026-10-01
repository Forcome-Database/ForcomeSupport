# -*- coding: utf-8 -*-
"""P13 登记台账（完整版与第一阶段版）· P14 内部结算；以及 StatesAfterSales S13–S15 用到的台账部件（编辑登记抽屉、取消弹窗、行内补登）。
合计一律用 data.ledger_totals() 与 total()/fsh_share()/factory_share() 计算；缺失字段与完整率用 data.ledger_missing()、ledger_completion()（R-AS-08）。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from data import *
from as_common import *

LT = ledger_totals()
SC = settle_counts()
LEDGER = [a for a in AFTERSALES if a['status'] != '待确认']  # 12 行，按售后单号升序
FEE_TOTAL = round(LT['product'] + LT['freight'] + LT['comp'] + LT['other'], 2)  # 费用合计 $188.79（与 P17 售后成本一致）

# P13「待回填」预填建议（data.LEDGER_BACKFILL）：这些单的快递单号没有自动回写（易仓回传延迟），积加出库单里已有单号（AFTERSALES 的 tracking），
# 台账显示「✦ 积加有单号 1Z… · 核对补登」，核对后一键补登（记入审计日志）。只在第二阶段（完整版）出现。
BACKFILL = {no: AS[no]['tracking'] for no in LEDGER_BACKFILL}
LEDGER = [dict(a, tracking=None) if a['no'] in BACKFILL else a for a in LEDGER]

# 第一阶段台账行（补上订单号、费用发生日、完成时间、发货方等 LEDGER_EXTRA 字段）；完整版的「缺 N 项」也按这些行判断
P1 = p1_ledger_rows()
P1R = {r['no']: r for r in P1}
COMP = ledger_completion()
MISS = {r['no']: ledger_missing(r) for r in P1 if r['status'] == '已完成' and ledger_missing(r)}  # 已完成且缺适用字段（含隐藏列）
HIDDEN = ['配件 × 数量', '负责人', '其他']  # 默认隐藏的列（prd_c P13）
HIDDEN_P1 = HIDDEN + ['生产厂']  # 第一阶段：生产厂列保留但默认隐藏（prd_c P13「第一阶段」）


# ================================================================ 共用小部件
def amt(x):
    return fee_amt(x) if x is None else money(x)


def completion(c=None, month='9'):
    """页头「当月登记完整率」（R-AS-08）：只随店铺数据范围与店铺筛选变化，不随日期筛选；点击筛出缺字段的已完成单。"""
    c = c or COMP
    miss = c['total'] - c['ok']
    v = c['ok'] * 100.0 / c['total'] if c['total'] else 0
    good = v >= 98
    bar = '<div style="width: 56px;">%s</div>' % progress(int(round(v)), 'success' if good else 'warning', 4)
    right = link('筛出缺字段的 %d 单' % miss, 12, 'chev_r') if miss else nowrap('无缺字段的单', 12, T['ok'], 600)
    return ('<div title="已完成售后单中适用字段齐全的比例，按完成时间归月，历史导入不计（R-AS-08）。点击筛出缺字段的已完成单" style="height: 32px; box-sizing: border-box; display: inline-flex; align-items: center; gap: 8px; '
            'background: #ffffff; border: 1px solid %s; border-radius: 8px; padding: 0px 10px; box-shadow: %s; white-space: nowrap; flex-shrink: 0;">%s%s%s%s%s%s%s</div>') % (
        T['line'], SHADOW_XS, nowrap('%s 月登记完整率' % month, 12, T['ink3']), nowrap(c['pct'], 14, T['ok'] if good else T['warn'], 700), bar,
        nowrap('%d / %d' % (c['ok'], c['total']), 12, T['ink2'], 600), nowrap('· 目标 ≥ 98%', 12, T['ink4']), divider(True, 16), right)


def completion_of(rows, month='09'):
    """同 data.ledger_completion() 的口径，作用于改动后的行（S15 设为已完成、补登之后）。"""
    done = [r for r in rows if r['status'] == '已完成' and r.get('done', '').startswith(month) and r.get('reg') != '历史导入']
    ok = [r for r in done if not ledger_missing(r)]
    pct = ('%.1f%%' % (100.0 * len(ok) / len(done))).replace('.0%', '%') if done else '—'
    return {'ok': len(ok), 'total': len(done), 'pct': pct}


def no_cell(no, miss=None):
    """售后单号（链接，进售后单详情或「编辑登记」）；已完成且缺适用字段时下方带「缺 N 项」，悬停列出缺的字段（含隐藏列）。"""
    n = nowrap(no, 13, T['accent'], 600)
    if not miss:
        return n
    tag = '<div title="缺：%s（含隐藏列里的字段）">%s</div>' % ('、'.join(miss), chip('缺 %d 项' % len(miss), 'warning', 11))
    return col(n + tag, 3, extra='align-items: flex-start;')


def hidden_line(cols=HIDDEN, scroll=True):
    t = '已隐藏 %d 列：%s' % (len(cols), '、'.join(cols)) + (' · 表格可横向滚动' if scroll else '')
    return row(icon('eye', 14, T['ink4']) + nowrap(t, 12, T['ink3']) + link('在「列设置」中显示', 12), 6)


def more_cell(active=False):
    """行尾「更多」：设为已完成、取消售后单、改派负责人（第一阶段）。"""
    bg = 'background: %s; box-shadow: inset 0 0 0 1px %s;' % (T['accent_bg'], T['accent_line']) if active else ''
    return '<div title="更多：设为已完成 · 取消售后单 · 改派负责人" style="width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; %s">%s</div>' % (
        bg, icon('more', 16, T['accent_ink'] if active else T['ink4']))


# ================================================================ P13 登记台账（完整版，第二阶段起）
def tracking_cell(a):
    if a['method'] != '寄配件':
        return na()
    if a['tracking']:
        return ellipsis(a['tracking'], 12, T['accent'])  # 链接：承运商查询页
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
    """报备：只显示状态徽标，报备类型（快递费用 / 额外赔偿）放悬停（列多，给金额列留出间距）。"""
    if not a['filing']:
        return na()
    t, s = a['filing']
    return '<div title="%s · %s">%s</div>' % (t, s, state(s))


def p13_table():
    cols = [('售后单号', 'left'), ('客户', 'left'), ('店铺与站点', 'left'), ('处理方式', 'left'), ('责任', 'left'), ('状态', 'left'), ('生产厂', 'left'), ('快递单号', 'left'),
            ('产品成本', 'right'), ('运费', 'right'), ('额外赔偿', 'right'), ('费用合计', 'right'), ('报备', 'left'), ('FSH 承担 $', 'right'), ('工厂承担 $', 'right'),
            ('协商', 'left'), ('结算', 'left')]
    rows = []
    for a in LEDGER:
        rows.append([no_cell(a['no'], MISS.get(a['no'])), ellipsis(a['customer'], 13), nowrap(store_site(a), 12, T['ink2']), cat(a['method']), cat(a['resp']), state(a['status']),
                     cat(a['factory']) if a.get('factory') else na(), tracking_cell(a),
                     amt(a['product']), amt(a['freight']), money(a['comp']), fee_amt(total(a) if a['product'] is not None else None, 'confirmed', 13, 600),
                     filing_cell(a), share_cell(a, 'fsh'), share_cell(a, 'factory'), state(a['nego']), state(a['settle'])])
    label_ = row(nowrap('合计 · %d 单' % LT['count'], 13, T['ink'], 700) + nowrap('首列与合计行固定', 11, T['ink4']) +
                 nowrap('· 隐藏列「其他」%s' % money(LT['other']), 11, T['ink4']), 8)
    footer = [(label_, 'left', 8), (money(LT['product']), 'right', 1), (money(LT['freight']), 'right', 1), (money(LT['comp']), 'right', 1),
              (money(FEE_TOTAL), 'right', 1), ('', 'left', 1), (money(LT['fsh']), 'right', 1), (money(LT['factory']), 'right', 1), ('', 'left', 2)]
    tpl = '126px 86px 116px 94px 82px 60px 40px minmax(0, 1fr) 52px 52px 54px 60px 60px 62px 62px 60px 60px'
    return table_span(cols, rows, tpl, footer, gap=7, px=12)


def p13_summary():
    """工厂承担的结算构成（与 P14、P17 同口径）。"""
    seg_ = lambda k, v, c: row(nowrap(k, 12, T['ink3']) + nowrap(v, 13, c, 700), 6)
    plus = nowrap('+', 13, T['ink4'])
    inner = row(nowrap('工厂承担', 12, T['ink2'], 700) + nowrap(money(LT['factory']), 13, T['ink'], 700) + nowrap('=', 13, T['ink4']) +
                seg_('已结算', money(LT['settled']), T['ok']) + plus + seg_('待结算', money(LT['pending']), T['accent_ink']) +
                nowrap('（已确认 %s）' % money(round(LT['settled'] + LT['pending'], 2)), 12, T['ink3']) + plus +
                seg_('未定', money(LT['undecided']), T['ink2']) + nowrap('（按建议比例估算）', 12, T['ink3']), 8)
    right = row(nowrap('费用合计', 12, T['ink3']) + nowrap(money(FEE_TOTAL), 13, T['ink'], 700) + link('查看内部结算', 12, 'chev_r'), 8)
    return '<div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; background: #ffffff; border: 1px solid %s; border-radius: 8px; padding: 9px 16px; box-shadow: %s;">%s%s</div>' % (
        T['line'], SHADOW_XS, inner, right)


def p13_filters():
    left = row(filter_chip('费用发生日', '2026-09-01 至 09-11', True) + filter_chip('店铺', '全部') + filter_chip('处理方式') + filter_chip('责任') +
               filter_chip('状态') + filter_chip('负责人') + filter_chip('报备') + filter_chip('结算'), 8)
    right = row(btn('列设置', 'secondary', 'md', 'sort') + btn('导出 Excel', 'secondary', 'md', 'download'), 8)
    return col(between(left, right) + hidden_line(), 8)


def p13():
    note = muted('金额统一美元，比索、加元按报备当日汇率折算（第一阶段按费用发生日；例 S-20260911-0020 %s，R-FL-06）；承担金额「≈」为按建议比例估算，悬停看三组比例，以内部结算为准。'
                 '进行中的单还没发生的字段显示「—」；已完成的单缺适用字段才标黄「待回填」，售后单号下标「缺 N 项」（含隐藏列）；积加有数据时给出 ✦ 预填建议，核对后「补登」并记入审计日志。' % money_cur(889.00, 'MXN', 49.39), 12)
    body = as_head('登记台账', completion()) + content(p13_filters() + p13_table() + p13_summary() + note, '12px 24px', 8)
    return app('wanglei', '售后', ['售后', '登记台账'], body)


# ================================================================ P13 第一阶段（S13）
def p1_val(r, x, fmt=money):
    """进行中的单还没发生的金额显示「—」；已完成的单缺失才标黄「待回填」。"""
    if x is None:
        return pending() if r['status'] == '已完成' else na()
    return nowrap(fmt(x), 13, T['ink'])


def p1_tracking(r, can_backfill=True):
    """第一阶段没有「✦ 积加有单号」预填；已完成缺单号时点「待回填」行内补登（只有售后负责人）。"""
    if r['method'] != '寄配件':
        return na()
    if r.get('tracking'):
        return ellipsis(r['tracking'], 12, T['accent'])
    if r['status'] != '已完成':
        return na()
    return row(pending() + (link('补登', 12) if can_backfill else ''), 6)


def p1_comp(r):
    """额外赔偿：非美元时金额下方写原币与汇率日期（例「MX$889.00 · 汇率 09-10」，R-FL-06、AC-P1-08）。"""
    if r.get('comp_orig'):
        return '<div title="汇率取费用发生日的欧洲央行日汇率；售后负责人可修改并记审计" style="display: flex; flex-direction: column; align-items: flex-end; gap: 0px;">%s%s</div>' % (
            nowrap(money(r['comp']), 13, T['ink']), nowrap('%s · 汇率 %s' % (r['comp_orig'], r['rate_date']), 11, T['ink4']))
    return p1_val(r, r['comp'])


def p1_share(r, who):
    """第一阶段比例由登记人按责任类型默认值确认，承担金额不带「≈」；比例写在悬停里。"""
    x = fsh_share(r) if who == 'fsh' else factory_share(r)
    return '<div title="%s" style="display: flex; justify-content: flex-end;">%s</div>' % (ratio_words(r['ratios']), nowrap(money(x), 13, T['ink']))


P1_COLS = [('售后单号', 'left'), ('客户', 'left'), ('店铺与站点', 'left'), ('处理方式', 'left'), ('责任', 'left'), ('状态', 'left'), ('快递单号', 'left')]
P1_FIN = [('产品成本', 'right'), ('运费', 'right'), ('额外赔偿', 'right'), ('费用合计', 'right'), ('FSH 承担 $', 'right'), ('工厂承担 $', 'right')]


def p1_cells(r, fin=True, more=True, miss=None, tracking=None, more_on=False, can_backfill=True):
    m = MISS.get(r['no']) if miss is None else miss
    cells = [no_cell(r['no'], m), ellipsis(r['customer'], 13), nowrap(store_site(r), 12, T['ink2']), cat(r['method']), cat(r['resp']), state(r['status']),
             tracking if tracking is not None else p1_tracking(r, can_backfill)]
    if fin:
        cells += [p1_val(r, r['product']), p1_val(r, r['freight']), p1_comp(r), nowrap(money(total(r)), 13, T['ink'], 600), p1_share(r, 'fsh'), p1_share(r, 'factory')]
    if more:
        cells.append(more_cell(more_on))
    return cells


def p13_p1_table(fin=True):
    if fin:
        cols = P1_COLS + P1_FIN + [('', 'left')]
        tpl = '130px 96px 124px 100px 88px 64px minmax(0, 1fr) 70px 62px 144px 74px 76px 76px 24px'
        label_ = row(nowrap('合计 · %d 单' % LT['count'], 13, T['ink'], 700) + nowrap('首列与合计行固定', 11, T['ink4']) +
                     nowrap('· 隐藏列「其他」%s' % money(LT['other']), 11, T['ink4']), 8)
        footer = [(label_, 'left', 7), (money(LT['product']), 'right', 1), (money(LT['freight']), 'right', 1), (money(LT['comp']), 'right', 1),
                  (money(FEE_TOTAL), 'right', 1), (money(LT['fsh']), 'right', 1), (money(LT['factory']), 'right', 1), ('', 'left', 1)]
        return table_span(cols, [p1_cells(r) for r in P1], tpl, footer, gap=8)
    # 坐席只读：不显示金额七列（产品成本、运费、额外赔偿、其他、费用合计、FSH 承担、工厂承担）与合计行，没有「更多」与补登
    tpl = '160px 140px 180px 140px 130px 100px minmax(0, 1fr)'
    return table_span(P1_COLS, [p1_cells(r, False, False, can_backfill=False) for r in P1], tpl, None, gap=12)


def p13_p1(user='wanglei', h=900):
    """第一阶段 P13（prd_c P13「第一阶段」）：页头只有标题，没有「售后单」「内部结算」页签；筛选去掉报备、结算；列去掉报备、协商、结算；
    合计行下没有结算拆解。坐席只读，不显示金额七列与合计行。"""
    role = STAFF[user]['role']
    fin = role != '坐席'
    create = btn('新建登记', 'primary', 'md', 'plus') if role in ('客服主管', '售后负责人') else ''
    actions = completion() + btn('列设置', 'secondary', 'md', 'sort') + btn('导出 Excel', 'secondary', 'md', 'download') + create
    desc = '售后单的处理方式、费用与承担比例 · 第一阶段由客服主管、售后负责人手工登记' if fin else '售后单的处理方式与寄件登记 · 只读，不含财务字段'
    head = page_head('登记台账', desc, actions)
    filters = col(row(filter_chip('费用发生日', '2026-09-01 至 09-11', True) + filter_chip('店铺', '全部') + filter_chip('处理方式') + filter_chip('责任') +
                      filter_chip('状态') + filter_chip('负责人'), 8) +
                  hidden_line(HIDDEN_P1 if fin else HIDDEN_P1[:2] + HIDDEN_P1[3:], fin), 8)
    if fin:
        note = muted('金额统一美元；比索、加元按费用发生日的欧洲央行日汇率折算，金额下方写原币与汇率日期（R-FL-06）。工厂承担 = 各组费用 × 该组工厂比例，逐行取整到分；'
                     'FSH 承担 = 该行费用合计 − 工厂承担（R-AS-08）。进行中的单还没发生的字段显示「—」；已完成的单缺适用字段标黄「待回填」，售后单号下标「缺 N 项」（含隐藏列）。'
                     '点售后单号打开「编辑登记」；行尾「更多」：设为已完成、取消售后单、改派负责人。', 12)
    else:
        note = muted('坐席只读：不显示产品成本、运费、额外赔偿、其他、费用合计、FSH 承担、工厂承担七列与合计行，导出同样不含这些字段；点售后单号查看登记（只读）。'
                     '已完成的单缺适用字段标黄「待回填」，由售后负责人补登。', 12)
    body = head + content(filters + p13_p1_table(fin) + note, '14px 24px', 10)
    return app(user, '售后', ['售后', '登记台账'], body, phase1=True, h=h)


# ================================================================ S14 新建登记、编辑登记（右侧抽屉）
def drawer(title, body, footer, width=440, desc=None):
    """右侧抽屉（shadcn Sheet，同 build_settings.drawer）：高度占满，标题区 + 表单区 + 底部按钮。"""
    d = '<div style="font-size: 12px; color: %s; line-height: 1.5;">%s</div>' % (T['ink3'], desc) if desc else ''
    return ('<div style="width: %dpx; height: 100%%; box-sizing: border-box; background: #ffffff; border-left: 1px solid %s; box-shadow: %s; display: flex; flex-direction: column;">'
            '<div style="padding: 16px 20px 14px 20px; border-bottom: 1px solid %s; display: flex; gap: 12px; align-items: flex-start;"><div style="flex: 1; display: flex; flex-direction: column; gap: 4px;"><div style="font-size: 16px; font-weight: 600; color: %s;">%s</div>%s</div>%s</div>'
            '<div style="flex: 1; min-height: 0px; overflow: hidden; padding: 14px 20px; display: flex; flex-direction: column; gap: 12px;">%s</div>'
            '<div style="padding: 12px 20px; border-top: 1px solid %s; background: %s; display: flex; align-items: center; justify-content: flex-end; gap: 8px;">%s</div></div>') % (
        width, T['line'], SHADOW_LG, T['line2'], T['ink'], title, d, icon('x', 16, T['ink4']), body, T['line2'], T['subtle'], footer)


def drawer_over(inner, drw, w, h):
    """页面上盖遮罩，抽屉贴右侧（同 build_settings.drawer_over）。"""
    return '<div style="width: %dpx; height: %dpx; position: relative; overflow: hidden;">%s<div style="position: absolute; inset: 0px; background: rgba(16,24,40,0.45); display: flex; justify-content: flex-end;">%s</div></div>' % (
        w, h, inner, drw)


def fsec(n, title, inner, right='', first=False):
    """抽屉内分节：序号圆标 + 标题，节与节之间细线分隔。"""
    bd = '' if first else ' border-top: 1px solid %s; padding-top: 12px;' % T['line2']
    return '<div style="display: flex; flex-direction: column; gap: 10px;%s">%s%s</div>' % (bd, sec_head(n, title, False, nowrap(right, 12, T['ink4']) if right else ''), inner)


def span(html, n=2):
    return '<div style="grid-column: span %d; min-width: 0px;">%s</div>' % (n, html)


def fold_line(strong_t, t):
    """抽屉里折叠或在视口外的分节，用一行摘要表示。"""
    return '<div style="display: flex; align-items: center; gap: 8px; background: %s; border: 1px solid %s; border-radius: 8px; padding: 7px 10px; font-size: 12px; color: %s;">%s<span style="font-weight: 600; color: %s; white-space: nowrap;">%s</span><span>%s</span></div>' % (
        T['subtle'], T['line'], T['ink3'], icon('chev_d', 13, T['ink4']), T['ink2'], strong_t, t)


def lbl_note(lbl, note, req=True):
    """字段标签 + 必填星号 + 灰色短注（不另占一行），如「负责人 * 该店铺唯一的售后负责人，已默认」；配合 field(..., required=False) 使用。"""
    star = '<span style="color: %s; margin-left: 2px;">*</span>' % T['bad'] if req else ''
    return '%s%s<span style="font-weight: 400; color: %s; margin-left: 6px;">%s</span>' % (lbl, star, T['ink4'], note)


def money_field(lbl, value, cur='USD', st='default', error=None, hint=None, req=True):
    """金额 + 币种（USD / CAD / MXN，输入框右侧的下拉）。非美元时 hint 写折算美元与汇率日期。"""
    cur_sel = '<span style="display: inline-flex; align-items: center; gap: 2px; padding-left: 8px; border-left: 1px solid %s; font-weight: 600; color: %s;">%s%s</span>' % (
        T['line'], T['ink2'], cur, icon('chev_d', 12, T['ink4']))
    return field(lbl, input_box(value, '0.00', st, suffix=cur_sel, mono=True), req, hint=hint, error=error)


def ratio_rows(vals, amounts, err=None):
    """三组承担比例：FSH % 与工厂 % 两侧互补（改一侧另一侧自动补足 100），右侧实时显示两方金额。
    vals: {组: 工厂%}；amounts: {组: 美元}；err：比例有误的组（显示「比例为 0–100 的整数」，合计暂不计算）。"""
    tpl = '72px 64px minmax(0, 1fr) minmax(0, 1fr) 76px 76px'
    hd = ''.join('<div style="text-align: %s;">%s</div>' % (a, t) for t, a in (('费用组', 'left'), ('金额', 'right'), ('FSH %', 'left'), ('工厂 %', 'left'), ('FSH 承担', 'right'), ('工厂承担', 'right')))
    out = '<div style="display: grid; grid-template-columns: %s; gap: 8px; font-size: 11px; font-weight: 600; color: %s;">%s</div>' % (tpl, T['ink4'], hd)
    fs, cs = 0.0, 0.0
    for lab, k in RATIO_LABELS:
        c = vals[k]
        bad = err == k
        x = amounts[k]
        c_amt = round(x * c / 100.0, 2)
        if not bad:
            cs += c_amt
            fs += round(x - c_amt, 2)  # FSH = 金额 − 工厂（R-AS-08）
        out += '<div style="display: grid; grid-template-columns: %s; gap: 8px; align-items: center;">%s</div>' % (tpl, ''.join([
            nowrap(lab, 12, T['ink2'], 600), '<div style="text-align: right;">%s</div>' % nowrap(money(x), 12, T['ink3']),
            input_box('—' if bad else str(100 - c), suffix='%', mono=True, h=28), input_box(str(c), suffix='%', st='error' if bad else 'default', mono=True, h=28),
            '<div style="display: flex; justify-content: flex-end;">%s</div>' % nowrap('—' if bad else money(round(x - c_amt, 2)), 12, T['ink2']),
            '<div style="display: flex; justify-content: flex-end;">%s</div>' % nowrap('—' if bad else money(c_amt), 12, T['ink2'])]))
        if bad:
            out += '<div style="display: flex; align-items: center; gap: 4px; font-size: 12px; color: %s; padding-left: 144px;">%s比例为 0–100 的整数</div>' % (T['bad'], icon('alert', 13, T['bad'], 2))
    tot = '有比例错误，合计暂不计算' if err else 'FSH 合计 %s · 工厂合计 %s' % (money(round(fs, 2)), money(round(cs, 2)))
    out += '<div style="display: flex; justify-content: flex-end;">%s</div>' % nowrap(tot, 12, T['bad'] if err else T['ink'], 600)
    return col(out, 6)


def ratio_field(vals, amounts, err=None):
    lbl = '承担比例（三组）<span style="color: %s; margin-left: 2px;">*</span><span style="font-weight: 400; color: %s; margin-left: 8px;">按责任类型默认值预填，可改；改一侧另一侧自动补足 100</span>' % (T['bad'], T['ink4'])
    return '<div style="display: flex; flex-direction: column; gap: 6px;"><div style="font-size: 12px; font-weight: 600; color: %s;">%s</div>%s</div>' % (T['ink2'], lbl, ratio_rows(vals, amounts, err))


def method_cards(sel):
    return row(radio_card('调整安装方式', '不寄东西', sel == '调整安装方式') +
               radio_card('寄配件', '含换新、整机补发', sel == '寄配件') +
               radio_card('退款或部分补偿', '款项记在额外赔偿', sel == '退款或部分补偿'), 8, 'stretch')


def basic_grid(d):
    """基本信息：店铺、站点（有来源工单时取工单站点）、订单号、客户、来源工单（第一阶段可不填）、费用发生日、负责人（只列有该店铺数据范围的售后负责人）。"""
    return grid(field('店铺', select_box(d['store']), True) + field('站点', select_box(d['site']), True) +
                field('订单号', input_box(d['order'], mono=True), True) + field('客户', input_box(d['customer']), True) +
                field(lbl_note('来源工单', '可不填', False), input_box(d['ticket'], mono=True)) + field('费用发生日', input_box('%s-%s' % (NOW[:4], d['fee_date']), icon_name='calendar', mono=True), True) +
                span(field(lbl_note('负责人', '该店铺唯一的售后负责人，已默认'), select_box('%s（售后负责人）' % d['owner']))), 4, 10,
                template='minmax(0, 1.12fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.88fr)')


def reg_body(err=False):
    """新建登记抽屉正文。err=False：寄配件 · Olivia Turner（LEDGER_NEW_DEMO）；
    err=True：改成「退款或部分补偿」+ 责任「其他」后点保存的校验态——抽屉滚到第一个错误，第 1、2 节在视口上方，用一行摘要表示。"""
    d = LEDGER_NEW_DEMO
    resp = '其他' if err else d['resp']
    fac_note = '工厂比例大于 0 时必填' if err else '按配件 %s 预填' % d['part']
    resp_row = grid(span(field('责任类型', select_box(resp), True)) +
                    span(field(lbl_note('生产厂', fac_note), select_box(d['factory']))), 4, 10)
    reason = field('责任理由', textarea_box(None, '责任为「其他」时说明依据，例如双方分摊的原因', 'error', 52, '0 / 200'), True,
                   error='责任为「其他」时须填写理由') if err else ''
    amounts = {'product': 0.0, 'freight': 0.0, 'other': 0.0} if err else {'product': d['product'], 'freight': d['freight'], 'other': 0.0}
    vals = {'product': 130, 'freight': 50, 'other': 50} if err else {k: RATIO_RULE[resp][k][1] for _, k in RATIO_LABELS}
    s3 = fsec(3, '责任与承担比例', resp_row + reason + ratio_field(vals, amounts, 'product' if err else None), first=err)
    if err:
        above = fold_line('1 处理方式 退款或部分补偿 · 2 基本信息 已填', '寄件字段不适用，已隐藏')
        fees = grid(money_field('产品成本', '0.00') + money_field('运费', '0.00') +
                    money_field('额外赔偿', '0.00', st='error', error='部分补偿、免退货退款的款项记在额外赔偿，须大于 0') + money_field('其他', '0.00'), 2, 10)
        return (banner('danger', '有 3 项需要修改', '已滚动到第一个错误「责任理由」；改完后再点「保存登记」。') + above + s3 +
                fsec(4, '费用（原币）', fees, '费用合计 $0.00'))
    part = PARTS[d['part']]
    s1 = fsec(1, '处理方式 <span style="color: %s;">*</span>' % T['bad'], method_cards(d['method']), '按 R-AS-08 只列适用字段', True)
    s2 = fsec(2, '基本信息', basic_grid(d))
    ship = grid(span(field('配件', select_box('%s %s' % (part, d['part'])), True)) + field('数量', input_box(str(d['qty']), suffix='件 · 1–10', mono=True), True) +
                field('发货方', select_box(d['shipper']), True) +
                field('承运方式', input_box(d['carrier']), True) + field('寄出日期', input_box(None, '寄出后填写', icon_name='calendar'), True) +
                span(field('快递单号', input_box(None, '寄出后填写', mono=True), True)), 4, 10)
    s4 = fsec(4, '寄件', ship, '进行中可后填；完成时缺失计入「待回填」')
    fees = grid(money_field('产品成本', '%.2f' % d['product']) + money_field('运费', '%.2f' % d['freight']) +
                money_field('额外赔偿', '0.00') + money_field('其他', '0.00'), 4, 10)
    s5 = fsec(5, '费用（原币）', fees + muted('没有发生的填 0。每项可选 USD / CAD / MXN，非美元时下方即时显示折算美元与汇率日期（R-FL-06）', 12),
              '费用合计 %s' % money(round(d['product'] + d['freight'], 2)))
    return s1 + s2 + s3 + s4 + s5


def reg_footer(save='保存登记', note='保存后状态为「进行中」，记入审计日志'):
    return '<div style="margin-right: auto;">%s</div>' % nowrap(note, 12, T['ink4']) + btn('取消', 'secondary') + btn(save, 'primary', 'md', 'check')


def reg_drawer(err=False):
    note = '保存按钮保持可点，点击后定位到第一个错误' if err else '保存后状态为「进行中」，记入审计日志'
    return drawer('新建登记', reg_body(err), reg_footer(note=note), 640, '按处理方式列出适用字段（R-AS-08），不适用的不显示；保存时校验全部')


def edit_drawer():
    """编辑登记（同一抽屉）：进行中的 S-20260911-0020，额外赔偿为比索，显示折算与汇率日期。"""
    r = P1R['S-20260911-0020']
    head = row(state(r['status']) + nowrap('%s · %s · %s' % (r['customer'], store_site(r), r['method']), 12, T['ink2']) +
               nowrap('· 负责人 %s' % r['owner'], 12, T['ink4']), 8)
    fees = grid(money_field('产品成本', '0.00') + money_field('运费', '0.00') +
                money_field('额外赔偿', '889.00', 'MXN', hint='≈ %s · 汇率 %s（1 USD = %.2f MXN）' % (money(r['comp']), r['rate_date'], USD_MXN)) +
                money_field('其他', '0.00'), 2, 10)
    rate = row(link('修改汇率', 12, 'edit') + nowrap('取费用发生日的欧洲央行日汇率；只有售后负责人可改，记入审计日志', 12, T['ink4']), 8)
    body = head + fold_line('1–3 节同新建登记', '处理方式 · 基本信息 · 责任与承担比例') + fsec(4, '费用（原币）', fees + rate, '费用合计 %s' % money(total(r)))
    desc = '进行中：登记人或负责人可改全部字段；已完成：只有售后负责人补登缺失字段；已取消：只读'
    return drawer('编辑登记 · %s' % r['no'], body, reg_footer('保存修改', '修改记入审计日志'), 640, desc)


# ================================================================ S15 设为已完成、取消与补登
MINI_COLS = [('售后单号', 'left'), ('客户', 'left'), ('处理方式', 'left'), ('状态', 'left'), ('快递单号', 'left'), ('费用合计', 'right'), ('', 'left')]
MINI_TPL = '140px 104px 100px 66px minmax(0, 1fr) 72px 24px'


def mini_row(r, miss=None, tracking=None, more_on=False):
    m = miss if miss is not None else (ledger_missing(r) if r['status'] == '已完成' else [])
    return [no_cell(r['no'], m), ellipsis(r['customer'], 13), cat(r['method']), state(r['status']), tracking if tracking is not None else p1_tracking(r),
            nowrap(money(total(r)), 13, T['ink'], 600), more_cell(more_on)]


def mini_table(rows, tones=None):
    return table_span(MINI_COLS, rows, MINI_TPL, None, gap=10, row_tones=tones)


DONE_ROW = dict(P1R[LEDGER_DONE_DEMO], status='已完成', done=NOW[5:])  # S15 ①：演示时刻设为已完成，完成时间记 NOW


def s15_done_before():
    """① 行尾「更多」展开。"""
    nos = ['S-20260910-0017', LEDGER_DONE_DEMO, 'S-20260911-0019']
    rows = [mini_row(P1R[n], more_on=n == LEDGER_DONE_DEMO) for n in nos]
    m = menu([('设为已完成', 'check_c', None), ('改派负责人', 'users', None), '-', ('取消售后单', 'x_c', 'danger')], 168)
    return '<div style="position: relative; padding-bottom: 76px;">%s<div style="position: absolute; right: 8px; top: 112px;">%s</div></div>' % (
        mini_table(rows, {1: 'select'}), m)


def s15_done_after():
    """① 设为已完成后：直接执行，5 秒内可撤销；缺字段的单照样完成，标黄待回填。"""
    nos = ['S-20260910-0017', LEDGER_DONE_DEMO, 'S-20260911-0019']
    rows = [mini_row(DONE_ROW if n == LEDGER_DONE_DEMO else P1R[n]) for n in nos]
    miss = ledger_missing(DONE_ROW)
    t = toast('success', '%s 已完成' % LEDGER_DONE_DEMO, '缺 %d 项，已标黄待回填' % len(miss), undo=5, remain=4)
    return '<div style="position: relative; padding-top: 58px;">%s<div style="position: absolute; right: 0px; top: 0px;">%s</div></div>' % (mini_table(rows, {1: 'select'}), t)


def s15_done_completion():
    rows = [DONE_ROW if r['no'] == LEDGER_DONE_DEMO else r for r in P1]
    return completion(completion_of(rows))


BACKFILL_P1 = P1_LEDGER_MISSING_TRACKING[0]  # 第一阶段缺快递单号的已完成单 S-20260909-0016


def s15_backfill_before():
    r = P1R[BACKFILL_P1]
    ed = row('<div style="flex: 1; min-width: 0px;">%s</div>' % input_box(AS[BACKFILL_P1]['tracking'], st='focus', mono=True, h=28) + btn('保存', 'primary', 'sm'), 6)
    return mini_table([mini_row(P1R['S-20260908-0015']), mini_row(r, tracking=ed), mini_row(P1R['S-20260910-0017'])], {1: 'select'})


def s15_backfill_after():
    done = dict(P1R[BACKFILL_P1], tracking=AS[BACKFILL_P1]['tracking'])
    rows = [done if r['no'] == BACKFILL_P1 else r for r in P1]
    c = completion_of(rows)
    t = toast('success', '已补登 · 已记入审计日志', '%s 快递单号 %s' % (BACKFILL_P1, done['tracking']))
    tbl = mini_table([mini_row(P1R['S-20260908-0015']), mini_row(done), mini_row(P1R['S-20260910-0017'])])
    return '<div style="position: relative; padding-top: 80px;">%s<div style="position: absolute; right: 0px; top: 0px;">%s</div></div>' % (tbl, t), c


def cancel_dialog():
    """② 取消售后单：二次确认，原因必填（0 / 200），逐项列出已登记费用并勾选取消后保留的已产生部分（默认全部保留）；默认焦点在「取消」。"""
    r = P1R[LEDGER_CANCEL_DEMO]
    items = [('产品成本', r['product']), ('运费', r['freight']), ('额外赔偿', r['comp']), ('其他', r['other'])]
    lines = ''.join('<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 12px;%s">%s%s</div>' % (
        ' border-top: 1px solid %s;' % T['line2'] if i else '', checkbox(k, True), nowrap(money(v), 13, T['ink'], 600)) for i, (k, v) in enumerate(items))
    keep = sum(v for _, v in items)
    box = '<div style="border: 1px solid %s; border-radius: 8px; overflow: hidden;">%s<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 12px; background: %s; border-top: 1px solid %s;">%s%s</div></div>' % (
        T['line'], lines, T['subtle'], T['line'], nowrap('保留合计 · 按费用发生日 %s 计入售后成本' % r['fee_date'], 12, T['ink3']), nowrap(money(round(keep, 2)), 13, T['ink'], 700))
    body = field('取消原因', textarea_box(None, '例如：客户撤回售后申请、改为退款处理', 'default', 56, '0 / 200'), True) + \
        col(between(label('已登记费用 · 勾选取消后保留的已产生部分'), nowrap('默认全部保留', 12, T['ink4'])) + box, 6) + \
        col(bullet('已取消的单不能恢复；保留的费用照常计入售后成本。') + bullet('未勾选的项不计入售后成本，登记值与取消原因记入审计日志。'), 4)
    return dialog('取消 %s？' % r['no'], body, btn('取消', 'secondary', st='focus') + btn('取消售后单', 'danger'), 460, 'danger',
                  '%s · %s · %s · 默认焦点在「取消」' % (r['customer'], r['method'], r['resp']))


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
    heads = {'已结算': '批次 FQD-A、FZJ-A · 09-08 提前生成 · 09-10 双方确认', '待结算': '比例已确认 · 进入 %s生成的批次 2026-09-FQD-B' % BATCH_PLAN_WORDS,
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
        amt_ = round(sum(factory_share(AS[x]) for x in b['items']), 2)
        done = b['state'] == '已结算'
        at = BATCH_PLAN.get(b['no'], b['at'])
        conf = b['note'].split('；')[1] if done else '月末批次收届时比例已确认、尚未入批的单；生成后推送对接人确认，双方确认后转已结算'
        act = '' if done else btn('提前生成批次 %s' % b['no'], 'primary', 'sm', 'plus', full=True)
        return card(between(row(nowrap(b['no'], 13, T['ink'], 600) + cat(b['factory']), 6), state(b['state'])) +
                    kv('售后单 · 工厂承担', '%d 单 · %s' % (len(b['items']), money(amt_))) +
                    kv('生成' if done else '计划生成', '%s%s' % (at, '（提前）' if done else ' 月末自动')) +
                    muted(conf, 12) + act, pad='11px 13px', gap=6, tone=None if done else 'accent')
    rules = card(bullet('每个生产厂每月至少一个批次：月末自动生成，也可提前生成；分别确认。') +
                 bullet('只收比例已确认的售后单：提前批次只收当时已确认的，其余进入月末批次；比例未定的不进批次。') + bullet('批次状态：待生成 → 待确认 → 已结算。') +
                 bullet('批次生成后其中售后单的比例不能再改，需调整时在下一批次冲销。'), '结算规则', pad='11px 13px', gap=5)
    return label('结算批次 · 按生产厂') + ''.join(bcard(b) for b in SETTLE_BATCHES) + rules


def p14():
    kpis = grid(kpi('工厂承担（含估算）', money(LT['factory']), sub='%d 单 · 2026-09 · 以内部结算为准' % SC['all']) +
                kpi('已结算', money(LT['settled']), sub='批次 FQD-A、FZJ-A · %d 单' % SC['settled']) +
                kpi('待结算', money(LT['pending']), sub='进入 %s生成的 FQD-B · %d 单' % (BATCH_PLAN_WORDS, SC['pending'])) +
                kpi('比例未定', '≈ ' + money(LT['undecided']), sub='%d 单 · 按建议比例估算 · 不进批次' % SC['undecided']), 4, 12)
    filters = between(row(filter_chip('生产厂', '全部') + filter_chip('月份', '2026-09', True) + filter_chip('店铺', '全部'), 8),
                      row(btn('导出结算单', 'secondary', 'md', 'download'), 8))
    main = filters + kpis + p14_table()
    body = as_head('内部结算') + two_col(main, p14_batches(), 300, 16, '16px 24px')
    return app('wanglei', '售后', ['售后', '内部结算'], body)


if __name__ == '__main__':
    save('AfterSalesLog.dc.html', p13())
    save('AfterSalesSettlement.dc.html', p14())
    print('ok', LT, COMP)
