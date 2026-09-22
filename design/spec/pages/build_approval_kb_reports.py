# -*- coding: utf-8 -*-
"""P15 Actions（审批）· P16 KnowledgeBase（知识库）· P17 Reports（报表）。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from data import *
from common import *

AP = {a['no']: a for a in APPROVALS}


# ================================================================ P15 审批（周敏）
def kl(k, v, kw=56):
    return '<div style="display: flex; gap: 12px; align-items: baseline; min-width: 0px;"><div style="width: %dpx; flex-shrink: 0; font-size: 12px; color: %s; white-space: nowrap;">%s</div><div style="flex: 1; min-width: 0px; font-size: 13px; color: %s; line-height: 1.55;">%s</div></div>' % (
        kw, T['ink3'], k, T['ink'], v)


def ap_meta(a, by_time=True):
    ch = channel('亚马逊' if a['store'].startswith('Forcome') else 'Shopify', a['site'], a['store'])
    refs = nowrap(a['ticket'], 12, T['accent'], 600) + (nowrap(a['aftersales'], 12, T['accent'], 600) if a['aftersales'] else '')
    return row(text(a['customer'], 13, T['ink'], 600) + ch + divider(True, 12) + nowrap('发起人 %s %s' % (a['by'], a['at']), 12, T['ink3']) +
               divider(True, 12) + nowrap('关联', 12, T['ink3']) + refs, 8)


def ap_right(a, st='待审批', left_level='warning', left_text=None):
    return row(state(st) + sla(left_text or ('剩 ' + a['left']), left_level) + nowrap('截止 ' + a['deadline'], 12, T['ink3']), 8)


def ap_card_expanded(a, foot=None, top='', st='待审批', left_level='warning', left_text=None, tone='accent'):
    head = between(row(nowrap(a['no'], 14, T['ink'], 700) + cat('报备 · 额外赔偿') + cat('动作 · 人工操作清单'), 8), ap_right(a, st, left_level, left_text))
    reason = '<div style="background: %s; border: 1px solid %s; border-radius: 6px; padding: 8px 12px; font-size: 13px; color: %s; line-height: 1.55;"><span style="font-weight: 700; color: %s;">理由</span>　使用两周故障；09-02 答应补发的电池一周多未到；客户要求退款并威胁差评。</div>' % (
        T['subtle'], T['line'], T['ink2'], T['ink'])
    quote = '<div style="font-size: 12px; color: %s; line-height: 1.55; border-left: 2px solid %s; padding-left: 10px;">%s</div>' % (T['ink2'], T['accent_line'], DRAFTS['jonas_bound_de'])
    detail = col(
        kl('报备', row('额外赔偿 <b>€44.90</b>（≈ $49.39）' + muted('免退货全额退款', 12), 8)) +
        kl('动作', row('亚马逊后台退款 €44.90' + cat('人工操作清单') + muted('指派陈晨，4 个工作小时内回填', 12), 8)) +
        kl('绑定回复', col(row(nowrap('Deutsch · 退款回填后自动发出', 13, T['ink']) + link('展开原文与中文译文', 12, 'chev_d'), 12) + quote, 5)) +
        kl('责任', row(cat('产品质量问题') + nowrap('建议工厂承担 100%，报备通过后另行协商', 12, T['ink3']), 8)), 9)
    f = foot if foot is not None else draft_like_foot(btn('批准', 'primary', 'md', 'check') + btn('驳回', 'secondary', 'md', 'x'),
                                                      nowrap('批准后生成人工操作清单给陈晨；回填完成即发出绑定回复', 12, T['ink3']))
    return card(head + ap_meta(a) + top + reason + detail + f, pad='14px 18px', gap=11, tone=tone)


def draft_like_foot(left, right=''):
    return '<div style="display: flex; align-items: center; gap: 8px; padding-top: 12px; border-top: 1px solid %s;">%s<div style="flex: 1;"></div>%s</div>' % (T['line2'], left, right)


def ap_card_collapsed(a, chips, summary, st='待审批', left_level='warning', left_text=None, extra_top='', tone=None, actions=None):
    acts = actions if actions is not None else row(btn('批准', 'secondary', 'sm', 'check') + btn('驳回', 'secondary', 'sm', 'x'), 6)
    head = between(row(icon('chev_r', 14, T['ink4'], 2) + nowrap(a['no'], 14, T['ink'], 700) + chips, 8), ap_right(a, st, left_level, left_text))
    body = between(col(ap_meta(a) + text(summary, 12, T['ink2']), 5, 'min-width: 0px; padding-left: 22px;'), acts, 'flex-end')
    return card(head + extra_top + body, pad='12px 18px', gap=8, tone=tone)


AP_SUMMARY = {
    'AP-20260911-002': (cat('报备 · 快递费用') + cat('动作 · 积加 MCP'),
                        '报备快递费用 <b>$8.40</b>（错发换发，UPS Ground）+ 积加创建售后发货单：良仓 US · 整机黑色 ×1。责任：物流问题（良仓错发，向良仓索赔）。'),
    'AP-20260911-003': (cat('报备 · 快递费用') + cat('动作 · 工厂工作台'),
                        '报备快递费用 <b>$11.50</b>（生产厂直寄美国，云途专线）。批准后在工厂工作台生成寄件任务，并发起比例协商。无绑定回复。'),
    'AP-20260911-004': (cat('动作 · 人工操作清单') + nowrap('审批人：客服主管或售后负责人', 12, T['ink3']),
                        'Shopify 订单 #1057 改收货地址 → 人工操作清单。新地址 %s。' % DRAFTS['priya_address_new']),
}


def exec_log():
    out = ''
    for i, (tm, title, src, ref, tone) in enumerate(APPROVAL_LOG_TODAY):
        warn = tone == 'warning'
        ic = icon('alert', 15, T['warn'], 2) if warn else icon('check_c', 15, T['ok_solid'], 2)
        bg = 'background: %s; border: 1px solid %s; border-radius: 6px; padding: 8px 10px;' % (T['warn_bg'], T['warn_line']) if warn else 'padding: 2px 10px;'
        sub = ref if not warn else ref
        out += '<div style="display: flex; gap: 10px; align-items: flex-start; %s"><div style="width: 38px; flex-shrink: 0; font-size: 12px; color: %s; font-variant-numeric: tabular-nums; padding-top: 1px;">%s</div><div style="padding-top: 1px;">%s</div><div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 1px;"><div style="font-size: 13px; font-weight: 600; color: %s;">%s</div><div style="font-size: 12px; color: %s;">%s</div><div style="font-size: 12px; color: %s;">%s</div></div></div>' % (
            bg, T['ink4'], tm, ic, T['ink'], title, T['ink3'], src, T['warn'] if warn else T['ink4'], sub)
    return out


def p15():
    tabs_html = tabs([('待我审批', 4), ('我发起的', None), ('人工操作清单', 0), ('已处理', None)], '待我审批')
    note = row(icon('info', 14, T['ink4']) + nowrap('含报备的由客服主管审批，时限 4 小时', 12, T['ink3']), 6)
    head = page_head('审批', None, note, tabs_html)
    cards = ap_card_expanded(AP['AP-20260911-001'])
    for no in ('AP-20260911-002', 'AP-20260911-003', 'AP-20260911-004'):
        ch, sm = AP_SUMMARY[no]
        cards += ap_card_collapsed(AP[no], ch, sm)
    left = col(between(row(text('按截止时间', 12, T['ink3']) + icon('sort', 13, T['ink4']), 4), row(filter_chip('类型', '全部') + filter_chip('店铺', '全部'), 6)) + cards, 9, 'flex: 1; min-width: 0px;')
    log = card(col(exec_log(), 6), title='执行日志 · 今日', extra=link('全部日志', 12, 'chev_r'), pad='12px 14px', gap=10)
    rules = card(col(kv('审批人', '含报备 → 客服主管', bold=False) + kv('', '只含动作 → 客服主管或售后负责人', bold=False) +
                     kv('时限', '4 小时，剩 1 小时提醒', bold=False) + kv('超时', '标记已超时，通知发起人与其他审批人', bold=False) +
                     kv('执行失败', '1、5、15 分钟自动重试 3 次', bold=False) + kv('人工操作清单', '指派发起人，4 个工作小时内回填', bold=False), 5),
                 title='规则摘要', pad='12px 14px', gap=8)
    right = col(log + rules, 12, 'width: 372px; flex-shrink: 0;')
    body = head + '<div style="flex: 1; min-height: 0px; display: flex; gap: 16px; padding: 14px 24px;">%s%s</div>' % (left, right)
    return app('zhoumin', '审批', ['审批', '待我审批'], body)


# ================================================================ P16 知识库（赵倩）
KB_TONE = {'有效': 'success', '即将过期': 'warning', '已过期': 'muted', '已停用': 'muted'}


def kb_state(t):
    """知识条目状态（STATE_TONE 未收录，按语义补：有效 success / 即将过期 warning / 已过期、已停用 muted）。"""
    return chip(t, KB_TONE.get(t, 'neutral'), 11, dot=True)


LAYER_SHORT = {'政策规则': '政策规则', '故障排查树': '故障排查树', '产品事实表': '产品事实表', '模板与素材': '模板与素材'}


def cat_nav(items, active):
    out = ''
    for name, n, ic in items:
        on = name == active
        out += '<div style="display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 6px; background: %s;">%s<div style="flex: 1; font-size: 13px; font-weight: %d; color: %s; white-space: nowrap;">%s</div><div style="font-size: 12px; color: %s; font-variant-numeric: tabular-nums;">%s</div></div>' % (
            T['accent_bg'] if on else 'transparent', icon(ic, 15, T['accent'] if on else T['ink3']), 700 if on else 500, T['accent_ink'] if on else T['ink2'], name, T['accent_ink'] if on else T['ink4'], n)
    return out


def p16():
    total_n = sum(KB_COUNTS[k] for k in ('产品事实表', '政策规则', '故障排查树', '模板与素材', '沉淀问答'))
    tabs_html = tabs([('条目', None), ('素材库', None), ('待审核沉淀', KB_COUNTS['待审核沉淀']), ('知识缺口', KB_COUNTS['知识缺口'])], '条目')
    head = page_head('知识库', '四层知识与沉淀问答，按店铺、语言、渠道生效', btn('上传文档', 'secondary', 'md', 'upload') + btn('新建条目', 'primary', 'md', 'plus'), tabs_html)
    nav = col(label('分类', 'padding: 0px 10px;') + cat_nav([('全部', total_n, 'book'), ('产品事实表', KB_COUNTS['产品事实表'], 'file'), ('政策规则', KB_COUNTS['政策规则'], 'shield'),
                                                         ('故障排查树', KB_COUNTS['故障排查树'], 'merge'), ('模板与素材', KB_COUNTS['模板与素材'], 'image'), ('沉淀问答', KB_COUNTS['沉淀问答'], 'message')], '全部'), 2) + \
        col(label('有效期', 'padding: 0px 10px;') + cat_nav([('即将过期', 1, 'clock'), ('已过期', 0, 'x_c')], None), 2)
    nav_panel = '<div style="width: 188px; flex-shrink: 0; box-sizing: border-box; background: #ffffff; border-right: 1px solid %s; padding: 16px 10px; display: flex; flex-direction: column; gap: 18px;">%s</div>' % (T['line'], nav)

    rows = []
    for (title, layer, store, lang, ch, owner, exp, hits, st) in KB:
        exp_html = nowrap(exp, 12, T['warn'] if st == '即将过期' else T['ink2'])
        rows.append([text(title, 12.5, T['ink'], 600), cat(layer), text(store, 12, T['ink2']), nowrap(lang, 12, T['ink2']), nowrap(ch, 12, T['ink2']),
                     nowrap(owner, 12, T['ink2']), exp_html, nowrap(str(hits), 12.5, T['ink']), kb_state(st)])
    cols = [('标题', 'left'), ('层', 'left'), ('适用店铺', 'left'), ('语言', 'left'), ('渠道', 'left'), ('负责人', 'left'), ('有效期', 'left'), ('30 天命中', 'right'), ('状态', 'left')]
    tbl = mtable(cols, rows, 'minmax(0, 1fr) 78px 128px 40px 44px 38px 72px 52px 70px', selected={0}, py=10)
    filt = between(search_box('搜索标题、正文', '220px', shortcut=False), row(filter_chip('店铺') + filter_chip('语言') + filter_chip('渠道') + filter_chip('状态'), 6))
    exp = banner('warning', '1 条知识将在 7 天内过期', 'Q3 促销运费政策 2026-09-15 到期，已提醒负责人周敏。过期后不参与 AI 检索。', btn('续期或停用', 'secondary', 'sm'))
    main = '<div style="flex: 1; min-width: 0px; padding: 14px 20px; display: flex; flex-direction: column; gap: 12px;">%s%s%s%s</div>' % (
        exp, filt, tbl, pagination('共 %d 条' % total_n, 1, 14))

    k0 = KB[0]
    summ = col(''.join('<div style="display: flex; gap: 8px; font-size: 13px; color: %s; line-height: 1.55;"><div style="width: 14px; flex-shrink: 0; color: %s; font-weight: 600;">%d.</div><div>%s</div></div>' % (T['ink'], T['ink3'], i + 1, s) for i, s in enumerate([
        '轨迹停滞满 5 天，或已超过预计送达日期，视为物流异常。',
        '先向承运商发起查件，并告知客户预计答复时间。',
        '客户有明确用车期限，或停滞超过 7 天：补发，报备快递费用。',
        '亚马逊 FBM 订单按「FBM 补发标准」选承运方式。',
    ])), 5)
    refs = col(''.join('<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px;"><div style="display: flex; align-items: center; gap: 8px; min-width: 0px;"><div style="color: %s; font-weight: 600; white-space: nowrap;">%s</div><div style="color: %s; white-space: nowrap;">%s</div></div>%s</div>' % (
        T['accent'], no, T['ink2'], nm, st) for no, nm, st in [('T-20260910-0192', 'Sarah Mitchell', state('待审草稿')), ('T-20260901-0059', 'Priya Raman', state('已关闭'))]), 8)
    prev = col(
        col(row(cat(k0[1]) + kb_state(k0[8]), 6) + text(k0[0], 16, T['ink'], 700) + muted('负责人 %s · 更新于 08-28 · 版本 3' % k0[5], 12), 6) +
        divider() + col(label('正文摘要') + summ, 8) + divider() +
        col(label('适用范围') + kv('店铺', k0[2]) + kv('语言', k0[3]) + kv('渠道', k0[4]) + kv('有效期', k0[6]) + kv('近 30 天命中', '%d 次' % k0[7]), 6) + divider() +
        col(label('引用它的最近工单') + refs, 8) +
        row(btn('编辑', 'secondary', 'sm', 'edit') + btn('停用', 'danger_outline', 'sm') + spacer() + link('查看全文', 12, 'chev_r'), 8), 14)
    prev_panel = '<div style="width: 336px; flex-shrink: 0; box-sizing: border-box; background: #ffffff; border-left: 1px solid %s; padding: 16px 20px; display: flex; flex-direction: column; gap: 14px; overflow: hidden;">%s</div>' % (T['line'], prev)
    body = head + '<div style="flex: 1; min-height: 0px; display: flex;">%s%s%s</div>' % (nav_panel, main, prev_panel)
    return app('zhaoqian', '知识库', ['知识库', '条目'], body)


# ================================================================ P17 报表（周敏）
def legend(items):
    return row(''.join('<div style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: %s; white-space: nowrap;"><div style="width: 10px; height: 10px; border-radius: 2px; background: %s;"></div>%s</div>' % (T['ink2'], c, t) for t, c in items), 14)


def stacked_columns(data, h=150, ymax=60, step=20, colors=(T['amazon'], T['shopify'])):
    """每日工单量：纵向堆叠柱（2px 表面间隔、4px 圆角顶端、顶端直标合计）。"""
    grid_ = ''
    for v in range(0, ymax + 1, step):
        y = h - v * h / ymax
        grid_ += '<div style="position: absolute; left: 28px; right: 0px; top: %.1fpx; height: 1px; background: %s;"></div><div style="position: absolute; left: 0px; width: 22px; top: %.1fpx; font-size: 11px; color: %s; text-align: right; font-variant-numeric: tabular-nums;">%d</div>' % (
            y, T['line2'] if v else T['line'], y - 8, T['ink4'], v)
    bars = ''
    for d, a, b in data:
        ha, hb = a * h / ymax, b * h / ymax
        bars += ('<div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: %dpx; position: relative;">'
                 '<div style="font-size: 11px; font-weight: 600; color: %s; margin-bottom: 4px; font-variant-numeric: tabular-nums;">%d</div>'
                 '<div style="width: 28px; height: %.1fpx; background: %s; border-radius: 4px 4px 0px 0px; margin-bottom: 2px;"></div>'
                 '<div style="width: 28px; height: %.1fpx; background: %s;"></div></div>') % (h, T['ink2'], a + b, hb - 2, colors[1], ha, colors[0])
    xl = ''.join('<div style="flex: 1; text-align: center; font-size: 11px; color: %s; font-variant-numeric: tabular-nums;">%s</div>' % (T['ink3'], d) for d, _, _ in data)
    return '<div style="display: flex; flex-direction: column; gap: 6px;"><div style="position: relative; height: %dpx;">%s<div style="position: absolute; left: 36px; right: 8px; top: 0px; bottom: 0px; display: flex; align-items: flex-end; gap: 14px;">%s</div></div><div style="display: flex; gap: 14px; padding: 0px 8px 0px 36px;">%s</div></div>' % (
        h, grid_, bars, xl)


def hbars(items, fmt, vmax, color=T['accent'], lw=112, h=10, gap=9):
    out = ''
    for name, v in items:
        pct = v * 100.0 / vmax
        out += '<div style="display: flex; align-items: center; gap: 10px;"><div style="width: %dpx; flex-shrink: 0; font-size: 12px; color: %s; white-space: nowrap;">%s</div><div style="flex: 1; height: %dpx; position: relative;"><div style="position: absolute; left: 0px; top: 0px; bottom: 0px; width: %.1f%%; background: %s; border-radius: 0px 4px 4px 0px;"></div></div><div style="width: 64px; flex-shrink: 0; text-align: right; font-size: 12px; font-weight: 600; color: %s; font-variant-numeric: tabular-nums;">%s</div></div>' % (
            lw, T['ink2'], name, h, pct, color, T['ink'], fmt(v))
    return col(out, gap)


def chart_card(title, sub, body, extra=None):
    t = col(text(title, 13, T['ink'], 700) + muted(sub, 12), 1)
    return card(body, title=t, extra=extra or link('查看明细', 12, 'chev_r'), pad='14px 18px', gap=12, style='min-width: 0px;')


def p17():
    head = page_head('报表', '数据来源：工单系统、登记台账、积加 · 更新于 10:15', btn('导出', 'secondary', 'md', 'download'))
    filt = between(row(seg(['本周', '本月', '自定义'], '本周') + nowrap('09-05 至 09-11', 12, T['ink3']) + divider(True, 16) +
                       filter_chip('店铺', '全部') + filter_chip('站点', '全部') + filter_chip('标签'), 8),
                   chip('指标为示例数据', 'warning', 11, 'info'))
    R = REPORT
    kpis = grid(kpi('工单量', str(R['tickets_week']), R['tickets_delta'], 'muted', '本周 · 全部渠道') +
                kpi('首响中位数', R['frt_median'], R['frt_delta'], 'success', '从来信到第一封回复') +
                kpi('SLA 达标率（亚马逊）', R['sla_rate'], None, 'muted', '未达标 %d 封' % R['sla_miss']) +
                kpi('草稿采纳率', R['adopt_rate'], None, 'muted', R['adopt_split']) +
                kpi('自动发送占比', R['auto_rate'], None, 'muted', R['auto_note']), 5, 12)

    daily = chart_card('每日工单量', '按渠道堆叠 · 本周', legend([('亚马逊', T['amazon']), ('Shopify 与邮件', T['shopify'])]) + stacked_columns(R['daily'], 184, 80, 20))
    intents = chart_card('意图分布', '本周工单主意图占比', hbars(R['intents'], lambda v: '%d%%' % v, 35, T['accent'], 124, 12, 17))

    cbr = cost_by_resp()
    order = sorted(cbr.items(), key=lambda x: -x[1])
    lt = ledger_totals()
    tot = round(sum(cbr.values()), 2)
    cost = chart_card('售后成本按责任类型', '本月 · 来自登记台账（不含待确认）',
                      between(row(text(money(tot), 20, T['ink'], 700) + muted('%d 单 · 产品成本 + 运费 + 额外赔偿' % lt['count'], 12), 8, 'baseline'), '') +
                      hbars(order, money, 130, T['accent'], 96))

    seg_bar = ''
    parts = [('已结算', lt['settled'], T['ok_solid']), ('待结算', lt['pending'], T['accent']), ('比例未定', lt['undecided'], T['line_strong'])]
    for i, (n, v, c) in enumerate(parts):
        seg_bar += '<div style="width: %.2f%%; height: 100%%; background: %s;%s%s"></div>' % (
            v * 100.0 / lt['factory'], c, ' margin-right: 2px;' if i < 2 else '', ' border-radius: 4px 0px 0px 4px;' if i == 0 else (' border-radius: 0px 4px 4px 0px;' if i == 2 else ''))
    bar = '<div style="display: flex; height: 14px;">%s</div>' % seg_bar
    rows_ = col(''.join('<div style="display: flex; align-items: center; gap: 8px; font-size: 12px;"><div style="width: 10px; height: 10px; border-radius: 2px; background: %s;"></div><div style="flex: 1; color: %s;">%s</div><div style="color: %s; width: 56px; text-align: right;">%s</div><div style="font-weight: 600; color: %s; width: 64px; text-align: right; font-variant-numeric: tabular-nums;">%s</div></div>' % (
        c, T['ink2'], n + note, T['ink3'], '%.0f%%' % (v * 100.0 / lt['factory']), T['ink'], money(v)) for (n, v, c), note in zip(parts, ['· 批次 2026-09-A', '· 进入 10-05 生成的 2026-09-B', '· 按建议比例估算，不进批次'])), 8)
    fac = chart_card('工厂承担与结算进度', '东莞生产厂 · 本月',
                     row(text(money(lt['factory']), 20, T['ink'], 700) + muted('工厂承担（含估算）· 其中已确认 %s' % money(round(lt['settled'] + lt['pending'], 2)), 12), 8, 'baseline') + bar + rows_)
    charts = grid(daily + intents, template='minmax(0, 1.25fr) minmax(0, 1fr)', gap=14) + grid(cost + fac, template='minmax(0, 1fr) minmax(0, 1fr)', gap=14)
    return app('zhoumin', '报表', ['报表', '概览'], head + content(filt + kpis + charts, '14px 24px', 12))


if __name__ == '__main__':
    save('Actions.dc.html', p15())
    save('KnowledgeBase.dc.html', p16())
    save('Reports.dc.html', p17())
    print('ok')
