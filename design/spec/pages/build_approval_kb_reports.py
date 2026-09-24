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
    return row(nowrap(a['customer'], 13, T['ink'], 600) + ch + divider(True, 12) + nowrap('发起人 %s %s' % (a['by'], a['at']), 12, T['ink3']) +
               divider(True, 12) + nowrap('关联', 12, T['ink3']) + refs, 8, wrap=True, extra='row-gap: 4px;')


def left_level_of(left_text):
    """倒计时颜色：剩余 > 1 小时灰、≤ 1 小时黄、已超时红。"""
    if left_text.startswith('已超时'):
        return 'danger'
    t = left_text.replace('剩 ', '')
    return 'normal' if 'h' in t else 'warning'


def ap_right(a, st=None, left_level=None, left_text=None):
    """卡片右上：状态（「待我审批」页签内不显示）+ 倒计时 + 截止时刻。"""
    lt = left_text or ('剩 ' + a['left'])
    return row((state(st) if st else '') + sla(lt, left_level or left_level_of(lt)) + nowrap('截止 ' + a['deadline'], 12, T['ink3']), 8)


# 每张审批单涉及的金额（报备与动作是同一笔钱时只算一次）：取 APPROVALS 里报备项的金额，无报备的不涉及金额
AP_AMOUNT = {a['no']: (a['filings'][0][1] if a['filings'] else None) for a in APPROVALS}


def amt_inline(no):
    v = AP_AMOUNT.get(no)
    return row(nowrap('本单涉及', 12, T['ink4']) + (nowrap(v, 14, T['ink'], 700) if v else nowrap('不涉及金额', 12, T['ink4'])), 6, 'baseline')


def lock_chip(t='你正在处理 · 其他审批人只读'):
    return chip(t, 'muted', 11, 'lock')


def amt_block(no, align='right'):
    v = AP_AMOUNT.get(no)
    val = nowrap(v, 14, T['ink'], 700) if v else nowrap('不涉及金额', 12, T['ink4'])
    return '<div style="display: flex; flex-direction: column; align-items: %s; gap: 0px; flex-shrink: 0;">%s%s</div>' % (
        'flex-end' if align == 'right' else 'flex-start', nowrap('本单涉及', 11, T['ink4']), val)


def lock_line(t, sub, mine=True):
    """处理锁（R-AP-03）：审批单被打开即加锁，其他审批人只读。"""
    fg, bg, bd = (T['ink2'], T['subtle'], T['line']) if mine else (T['ink2'], T['track'], T['line_strong'])
    return '<div style="display: flex; align-items: center; gap: 8px; background: %s; border: 1px solid %s; border-radius: 6px; padding: 6px 12px; font-size: 12px; color: %s;">%s<span><b style="color: %s;">%s</b>　%s</span></div>' % (
        bg, bd, fg, icon('lock', 14, T['ink4'], 2), T['ink'], t, sub)


def ap_card_expanded(a, foot=None, top='', st=None, left_level=None, left_text=None, tone='accent', lock=True):
    lk = lock_chip() if lock is True else (lock or '')
    head = '<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px;">%s%s</div>' % (
        row(nowrap(a['no'], 14, T['ink'], 700) + cat('报备 · 额外赔偿') + cat('动作 · SP-API') + lk, 8),
        row(amt_inline(a['no']) + divider(True, 16) + ap_right(a, st, left_level, left_text), 12, extra='margin-left: auto;'))
    reason = '<div style="background: %s; border: 1px solid %s; border-radius: 6px; padding: 6px 12px; font-size: 13px; color: %s; line-height: 1.55;"><span style="font-weight: 700; color: %s;">理由</span>　签收后不到一周故障；09-03 答应补发的电池一周多未到；客户要求退款并威胁差评。</div>' % (
        T['subtle'], T['line'], T['ink2'], T['ink'])
    quote = '<div style="font-size: 12px; color: %s; line-height: 1.55; border-left: 2px solid %s; padding-left: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">%s</div>' % (T['ink2'], T['accent_line'], DRAFTS['mateo_bound_es'])
    detail = col(
        kl('报备', row('额外赔偿 <b>MX$889.00</b>（≈ $49.39）' + muted('免退货全额退款 · 与下方退款为同一笔', 12), 8)) +
        kl('动作', row('亚马逊退款 MX$889.00' + cat('SP-API') + muted('批准后自动执行；失败自动重试 3 次，仍失败可转人工操作清单', 12), 8)) +
        kl('绑定回复', col(row(nowrap('Español · 退款成功后自动发出', 13, T['ink']) + link('展开原文与中文译文', 12, 'chev_d'), 12) + quote, 5)) +
        kl('责任', row(cat('产品质量问题') + nowrap('建议三组均 FSH 0 / 工厂 100，报备通过后另行协商', 12, T['ink3']), 8)), 8)
    f = foot if foot is not None else draft_like_foot(
        btn('批准', 'primary', 'md', 'check') + btn('驳回', 'secondary', 'md', 'x'),
        nowrap('批准后经 SP-API 退款，成功即发出绑定回复；自动展开下一张 002', 12, T['ink3']))
    return card(head + ap_meta(a) + top + reason + detail + f, pad='12px 18px', gap=9, tone=tone)


def draft_like_foot(left, right=''):
    return '<div style="display: flex; align-items: center; gap: 8px; padding-top: 12px; border-top: 1px solid %s;">%s<div style="flex: 1;"></div>%s</div>' % (T['line2'], left, right)


def ap_card_collapsed(a, chips, summary, st=None, left_level=None, left_text=None, extra_top='', tone=None, actions=None, extra_body=''):
    """折叠卡：左为单号、元信息与摘要；中为金额独立列（右对齐）；右为倒计时与按钮。"""
    acts = actions if actions is not None else row(btn('批准', 'secondary', 'sm', 'check') + btn('驳回', 'secondary', 'sm', 'x'), 6)
    head = between(row(icon('chev_r', 14, T['ink4'], 2) + nowrap(a['no'], 14, T['ink'], 700) + chips, 8), ap_right(a, st, left_level, left_text))
    left = col(ap_meta(a) + text(summary, 12, T['ink2']), 5, 'flex: 1; min-width: 0px; padding-left: 22px;')
    amt = '<div style="min-width: 104px; flex-shrink: 0; display: flex; justify-content: flex-end;">%s</div>' % amt_block(a['no'])
    body = '<div style="display: flex; gap: 16px; align-items: flex-end;">%s%s%s</div>' % (left, amt, acts)
    eb = '<div style="padding-left: 22px;">%s</div>' % extra_body if extra_body else ''
    return card(head + body + eb + extra_top, pad='10px 18px', gap=7, tone=tone)


AP_SUMMARY = {
    'AP-20260911-002': (cat('报备 · 快递费用') + cat('动作 · 积加'),
                        '报备快递费用 <b>$8.40</b>（错发换发）+ 良仓 US 出库整机黑色 ×1；责任：物流问题（良仓错发，向良仓索赔）。'),
    'AP-20260911-003': (cat('报备 · 快递费用') + cat('动作 · 工厂工作台'),
                        '报备快递费用 <b>$11.50</b>（生产厂直寄美国，云途）；批准后生成工厂寄件任务并发起比例协商，无绑定回复。'),
    'AP-20260911-004': (cat('动作 · Shopify Admin API') + nowrap('审批人：客服主管或售后负责人', 12, T['ink3']),
                        'Shopify 订单 #1057 改收货地址，批准后经 Shopify Admin API 执行，成功即发出英语绑定回复。'),
}

# AP-004 改地址：原地址 → 新地址，逐字段对比（data.PRIYA_ADDRESS_DIFF）
PRIYA_ADDR = PRIYA_ADDRESS_DIFF


def addr_diff(shipped=False):
    """原地址 → 新地址逐字段对比（变更字段高亮）+ 积加发货状态（已发货标红风险）。"""
    cells = ''
    for k, old, new in PRIYA_ADDR:
        ch = old != new
        nv = '<span style="background: %s; color: %s; font-weight: 600; border-radius: 4px; padding: 0px 4px;">%s</span>' % (T['accent_bg'], T['accent_ink'], new) if ch else \
            '<span style="color: %s;">%s</span>' % (T['ink3'], new)
        ov = '<span style="color: %s;%s">%s</span>' % (T['ink4'], ' text-decoration: line-through;' if ch else '', old)
        cells += '<div style="display: flex; flex-direction: column; gap: 2px; min-width: 0px;"><div style="font-size: 11px; color: %s;">%s</div><div style="font-size: 12px; line-height: 18px; white-space: nowrap;">%s</div><div style="font-size: 12px; line-height: 18px; white-space: nowrap;">%s</div></div>' % (
            T['ink4'], k, ov, nv)
    grid_ = '<div style="display: grid; grid-template-columns: 30px 108px 70px 96px 28px 44px; gap: 10px; align-items: end;"><div style="display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: %s;"><div>&nbsp;</div><div style="line-height: 18px;">原</div><div style="line-height: 18px;">新</div></div>%s</div>' % (T['ink4'], cells)
    ship = chip('积加发货状态：已发货 · 改地址有风险', 'danger', 11, 'alert') if shipped else chip('积加发货状态：未发货', 'success', 11, 'check_c')
    return '<div style="display: flex; align-items: center; gap: 16px; background: %s; border: 1px solid %s; border-radius: 6px; padding: 7px 12px;">%s<div style="flex: 1;"></div>%s</div>' % (
        T['subtle'], T['line'], grid_, ship)


# 执行日志：「失败后重试成功」按中性灰 + 信息图标显示（不是失败，也不需要关注）——data.APPROVAL_LOG_OVERRIDE
LOG_OVERRIDE = APPROVAL_LOG_OVERRIDE


def exec_log():
    out = ''
    for i, (tm, title, src, ref, tone) in enumerate(APPROVAL_LOG_TODAY):
        tone, ref = LOG_OVERRIDE.get(tm, (tone, ref))
        warn = tone == 'warning'
        neu = tone == 'neutral'
        ic = icon('alert', 15, T['warn'], 2) if warn else (icon('info', 15, T['ink3'], 2) if neu else icon('check_c', 15, T['ok_solid'], 2))
        bg = 'background: %s; border: 1px solid %s; border-radius: 6px; padding: 8px 10px;' % (T['warn_bg'], T['warn_line']) if warn else \
            ('background: %s; border: 1px solid %s; border-radius: 6px; padding: 8px 10px;' % (T['subtle'], T['line']) if neu else 'padding: 2px 10px;')
        out += '<div style="display: flex; gap: 10px; align-items: flex-start; %s"><div style="width: 38px; flex-shrink: 0; font-size: 12px; color: %s; font-variant-numeric: tabular-nums; padding-top: 1px;">%s</div><div style="padding-top: 1px;">%s</div><div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 1px;"><div style="font-size: 13px; font-weight: 600; color: %s;">%s</div><div style="font-size: 12px; color: %s;">%s</div><div style="font-size: 12px; color: %s;">%s</div></div></div>' % (
            bg, T['ink4'], tm, ic, T['ink'], title, T['ink3'], src, T['warn'] if warn else (T['ink3'] if neu else T['ink4']), ref)
    return out


def kvl(k, v, kw=72):
    """规则摘要：键在左、值左对齐（长值换行不掉到右侧）。"""
    return '<div style="display: flex; gap: 10px; align-items: baseline; font-size: 12px; line-height: 1.5;"><div style="width: %dpx; flex-shrink: 0; color: %s;">%s</div><div style="flex: 1; min-width: 0px; color: %s;">%s</div></div>' % (
        kw, T['ink3'], k, T['ink'], v)


def rules_card():
    return card(col(kvl('审批人', '含报备 → 客服主管；只含动作 → 客服主管或售后负责人') +
                    kvl('时限', '4 小时；剩 1 小时时提醒你，并同时提醒备用审批人王磊') +
                    kvl('超时', '标记已超时，通知发起人与其他审批人') +
                    kvl('处理锁', '打开即加锁，其他审批人只读，防重复审批；关闭审批单或 10 分钟无操作释放') +
                    kvl('执行失败', '1、5、15 分钟自动重试 3 次') +
                    kvl('人工操作清单', '接口失败时兜底；指派发起人，4 个工作小时内回填'), 5),
                title='规则摘要', pad='12px 14px', gap=8)


def kbd_tabs(tabs_html):
    """页签右侧：处理顺序说明小字（不设快捷键）。"""
    tb = tabs_html.replace('border-bottom: 1px solid %s;">' % T['line'], 'border-bottom: 0px;">', 1)
    hint = row(nowrap('按截止时间排序 · 批准后自动展开下一张', 12, T['ink4']), 6)
    return '<div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid %s;">%s%s</div>' % (T['line'], tb, hint)


def p15():
    tabs_html = kbd_tabs(tabs([('待我审批', 4), ('我发起的', None), ('人工操作清单', 0), ('已处理', None)], '待我审批'))
    note = row(icon('info', 14, T['ink4']) + nowrap('含报备的由客服主管审批，时限 4 小时', 12, T['ink3']), 6)
    head = page_head('审批', None, note, tabs_html)
    cards = ap_card_expanded(AP['AP-20260911-001'])
    for no in ('AP-20260911-002', 'AP-20260911-003', 'AP-20260911-004'):
        ch, sm = AP_SUMMARY[no]
        cards += ap_card_collapsed(AP[no], ch, sm, extra_body=addr_diff() if no == 'AP-20260911-004' else '')
    left = col(between(row(text('按截止时间', 12, T['ink3']) + icon('sort', 13, T['ink4']), 4), row(filter_chip('类型', '全部') + filter_chip('店铺', '全部'), 6)) + cards, 9, 'flex: 1; min-width: 0px;')
    log = card(col(exec_log(), 6), title='执行日志 · 今日', extra=link('全部日志', 12, 'chev_r'), pad='12px 14px', gap=10)
    right = col(log + rules_card(), 12, 'width: 372px; flex-shrink: 0;')
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


# 待审核沉淀取 data.KB_REVIEW；知识缺口聚类取 data.KB_GAP_CLUSTERS（与 StatesAdmin K12、K13 一致）
GAP_CLUSTERS = KB_GAP_CLUSTERS
GAP_TONE = {'置信度低于 60%': 'warning', '拒绝原因：知识错误': 'danger', '转人工': 'neutral'}


def kb_pagination(total_text, page=1, pages=14):
    return between(muted(total_text), row(btn('上一页', 'secondary', 'sm', disabled=True, reason='已在第 1 页') + nowrap('%d / %d' % (page, pages), 12, T['ink2']) +
                                          btn('下一页', 'secondary', 'sm'), 8))


def kb_summary_cards():
    rv = ''.join('<div style="display: flex; align-items: center; gap: 8px; min-width: 0px;"><div style="flex: 1; min-width: 0px;">%s</div>%s%s</div>' % (
        ellipsis(q, 12, T['ink'], 500), nowrap(src, 12, T['accent'], 600), nowrap(who.split(' · ')[0], 12, T['ink3'])) for q, src, who in KB_REVIEW)
    review = card(col(rv, 8), title=row(text('待审核沉淀', 13, T['ink'], 700) + badge_count(len(KB_REVIEW), 'accent'), 6), extra=link('去审核', 12, 'chev_r'),
                  pad='12px 14px', gap=8, style='min-width: 0px;')
    gl = ''
    for name, site, lang, qs in GAP_CLUSTERS:
        gl += '<div style="display: flex; align-items: center; gap: 8px; min-width: 0px;"><div style="flex: 1; min-width: 0px; display: flex; align-items: center; gap: 6px;">%s%s%s</div>%s</div>' % (
            ellipsis(name, 12, T['ink'], 600), nowrap('×%d' % len(qs), 12, T['ink2'], 700), nowrap('%s · %s' % (site, lang), 11, T['ink4']),
            btn('✦ AI 起草条目', 'accent_outline', 'sm'))
    n = sum(len(c[3]) for c in GAP_CLUSTERS)
    gaps = card(col(gl, 6) + muted('AI 起草的条目进入待审核，你确认后才生效。', 11),
                title=row(text('知识缺口', 13, T['ink'], 700) + badge_count(n, 'accent') + nowrap('按问题聚成 %d 类' % len(GAP_CLUSTERS), 12, T['ink4']), 6),
                extra=link('全部缺口', 12, 'chev_r'), pad='12px 14px', gap=8, style='min-width: 0px;')
    return grid(review + gaps, template='minmax(0, 0.9fr) minmax(0, 1.1fr)', gap=12)


def p16():
    total_n = sum(KB_COUNTS[k] for k in ('产品事实表', '政策规则', '故障排查树', '模板与素材', '沉淀问答'))
    tabs_html = tabs([('条目', None), ('素材库', None), ('待审核沉淀', KB_COUNTS['待审核沉淀']), ('知识缺口', KB_COUNTS['知识缺口'])], '条目')
    head = page_head('知识库', '四层知识与沉淀问答，按店铺、语言、渠道生效', btn('上传文档', 'secondary', 'md', 'upload') + btn('新建条目', 'primary', 'md', 'plus'), tabs_html)
    nav = col(label('分类', 'padding: 0px 10px;') + cat_nav([('全部', total_n, 'book'), ('产品事实表', KB_COUNTS['产品事实表'], 'file'), ('政策规则', KB_COUNTS['政策规则'], 'shield'),
                                                         ('故障排查树', KB_COUNTS['故障排查树'], 'merge'), ('模板与素材', KB_COUNTS['模板与素材'], 'image'), ('沉淀问答', KB_COUNTS['沉淀问答'], 'message')], '全部'), 2) + \
        col(label('有效期', 'padding: 0px 10px;') + cat_nav([('即将过期', 1, 'clock'), ('已过期', 0, 'x_c')], None), 2)
    nav_panel = '<div style="width: 188px; flex-shrink: 0; box-sizing: border-box; background: #ffffff; border: 1px solid %s; border-radius: 16px; box-shadow: 0 1px 2px rgba(16,20,35,0.04); overflow: hidden; margin: 10px 0px 14px 24px; padding: 14px 10px; display: flex; flex-direction: column; gap: 18px;">%s</div>' % (T['line'], nav)

    rows = []
    for (title, layer, store, lang, ch, owner, exp, hits, st) in [KB[i] for i in (0, 1, 2, 3, 5, 8)]:
        exp_html = nowrap(exp, 12, T['warn'] if st == '即将过期' else T['ink2'])
        rows.append([text(title, 13, T['ink'], 600), cat(layer), text(store, 12, T['ink2']), nowrap(lang, 12, T['ink2']), nowrap(ch, 12, T['ink2']),
                     nowrap(owner, 12, T['ink2']), exp_html, nowrap(str(hits), 13, T['ink']), kb_state(st)])
    cols = [('标题', 'left'), ('层', 'left'), ('适用店铺', 'left'), ('语言', 'left'), ('渠道', 'left'), ('负责人', 'left'), ('有效期', 'left'), ('30 天命中', 'right'), ('状态', 'left')]
    tbl = mtable(cols, rows, 'minmax(0, 1fr) 78px 128px 40px 44px 38px 72px 52px 70px', selected={0}, py=10)
    filt = between(search_box('搜索标题、正文', '220px', shortcut=False), row(filter_chip('店铺') + filter_chip('语言') + filter_chip('渠道') + filter_chip('状态'), 6))
    exp = banner('warning', '1 条知识将在 7 天内过期', 'Q3 促销运费政策 2026-09-15 到期，已提醒负责人周敏。过期后不参与 AI 检索。',
                 row(btn('续期', 'secondary', 'sm', 'calendar') + btn('停用', 'danger_outline', 'sm'), 6))
    main = '<div style="flex: 1; min-width: 0px; padding: 14px 20px; display: flex; flex-direction: column; gap: 12px;">%s%s%s%s%s</div>' % (
        exp, kb_summary_cards(), filt, tbl, kb_pagination('共 %d 条' % total_n, 1, 14))

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
    prev_panel = '<div style="width: 336px; flex-shrink: 0; box-sizing: border-box; background: #ffffff; border: 1px solid %s; border-radius: 16px; box-shadow: 0 1px 2px rgba(16,20,35,0.04); overflow: hidden; margin: 10px 24px 14px 0px; padding: 16px 18px; display: flex; flex-direction: column; gap: 14px;">%s</div>' % (T['line'], prev)
    body = head + '<div style="flex: 1; min-height: 0px; display: flex;">%s%s%s</div>' % (nav_panel, main, prev_panel)
    return app('zhaoqian', '知识库', ['知识库', '条目'], body)


# ================================================================ P17 报表（周敏）
def legend(items):
    return row(''.join('<div style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: %s; white-space: nowrap;"><div style="width: 10px; height: 10px; border-radius: 2px; background: %s;"></div>%s</div>' % (T['ink2'], c, t) for t, c in items), 14)


def drill_tip(title, lines, target):
    """悬停下钻提示：数值 + 「点击查看明细 → P04 / P13」。"""
    body = ''.join('<div style="color: rgba(255,255,255,0.82);">%s</div>' % l for l in lines)
    return '<div style="background: %s; color: #ffffff; font-size: 12px; line-height: 1.5; border-radius: 8px; padding: 7px 10px; box-shadow: %s; white-space: nowrap; display: flex; flex-direction: column; gap: 1px;"><div style="font-weight: 600;">%s</div>%s<div style="display: flex; align-items: center; gap: 4px; margin-top: 3px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.18); font-weight: 600; color: #c7d2fe;">点击查看明细 → %s</div></div>' % (
        T['ink'], SHADOW_MD, title, body, target)


def stacked_columns(data, h=150, ymax=60, step=20, colors=(T['amazon'], T['shopify']), hover=None, tip=''):
    """每日工单量：纵向堆叠柱（2px 表面间隔、4px 圆角顶端、顶端直标合计）。hover：悬停柱下标，tip 显示在其左侧。"""
    grid_ = ''
    for v in range(0, ymax + 1, step):
        y = h - v * h / ymax
        grid_ += '<div style="position: absolute; left: 28px; right: 0px; top: %.1fpx; height: 1px; background: %s;"></div><div style="position: absolute; left: 0px; width: 22px; top: %.1fpx; font-size: 11px; color: %s; text-align: right; font-variant-numeric: tabular-nums;">%d</div>' % (
            y, T['line2'] if v else T['line'], y - 8, T['ink4'], v)
    bars = ''
    for i, (d, a, b) in enumerate(data):
        ha, hb = a * h / ymax, b * h / ymax
        on = i == hover
        band = '<div style="position: absolute; left: 0px; right: 0px; top: 0px; bottom: 0px; background: %s; border-radius: 6px;"></div>' % T['accent_bg'] if on else ''
        tp = '<div style="position: absolute; right: calc(50%% + 22px); bottom: %.1fpx; z-index: 2;">%s</div>' % (ha + hb - 40, tip) if on else ''
        bars += ('<div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: %dpx; position: relative;">%s'
                 '<div style="position: relative; font-size: 11px; font-weight: 600; color: %s; margin-bottom: 4px; font-variant-numeric: tabular-nums;">%d</div>'
                 '<div style="position: relative; width: 28px; height: %.1fpx; background: %s; border-radius: 4px 4px 0px 0px; margin-bottom: 2px;"></div>'
                 '<div style="position: relative; width: 28px; height: %.1fpx; background: %s;"></div>%s</div>') % (h, band, T['ink'] if on else T['ink2'], a + b, hb - 2, colors[1], ha, colors[0], tp)
    xl = ''.join('<div style="flex: 1; text-align: center; font-size: 11px; color: %s; font-variant-numeric: tabular-nums;">%s</div>' % (T['ink3'], d) for d, _, _ in data)
    return '<div style="display: flex; flex-direction: column; gap: 6px;"><div style="position: relative; height: %dpx;">%s<div style="position: absolute; left: 36px; right: 8px; top: 0px; bottom: 0px; display: flex; align-items: flex-end; gap: 14px;">%s</div></div><div style="display: flex; gap: 14px; padding: 0px 8px 0px 36px;">%s</div></div>' % (
        h, grid_, bars, xl)


def hbars(items, fmt, vmax, color=T['accent'], lw=112, h=10, gap=9, vw=64, hover=None, tip=''):
    """横向条形。hover：悬停条下标（该行浅底高亮，tip 浮在条末端右下方）。"""
    out = ''
    for i, (name, v) in enumerate(items):
        pct = v * 100.0 / vmax
        on = i == hover
        tp = '<div style="position: absolute; left: %.1f%%; top: %dpx; z-index: 2;">%s</div>' % (min(pct * 0.5, 30), h + 8, tip) if on else ''
        bg = ' background: %s; border-radius: 6px; margin: -3px -6px; padding: 3px 6px;' % T['accent_bg'] if on else ''
        out += '<div style="display: flex; align-items: center; gap: 10px;%s"><div style="width: %dpx; flex-shrink: 0; font-size: 12px; color: %s; white-space: nowrap;">%s</div><div style="flex: 1; height: %dpx; position: relative;"><div style="position: absolute; left: 0px; top: 0px; bottom: 0px; width: %.1f%%; background: %s; border-radius: 0px 4px 4px 0px;"></div>%s</div><div style="width: %dpx; flex-shrink: 0; text-align: right; font-size: 12px; font-weight: 600; color: %s; font-variant-numeric: tabular-nums; white-space: nowrap;">%s</div></div>' % (
            bg, lw, T['ink2'] if not on else T['ink'], name, h, pct, color, tp, vw, T['ink'], fmt(v))
    return col(out, gap)


def lock_tag(t='本月 · 不随时间筛选'):
    return chip(t, 'muted', 11, 'lock')


def chart_card(title, sub, body, extra=None, tag=''):
    t = col(row(text(title, 13, T['ink'], 700) + tag, 8) + muted(sub, 12), 1)
    return card(body, title=t, extra=extra or link('查看明细', 12, 'chev_r'), pad='14px 18px', gap=12, style='min-width: 0px;')


def p17():
    head = page_head('报表', '数据来源：工单系统、登记台账、积加（订单与物流） ·更新于 10:15', btn('导出', 'secondary', 'md', 'download'))
    filt = between(row(seg(['近 7 天', '本月', '自定义'], '近 7 天') + nowrap('09-05 至 09-11', 12, T['ink3']) + divider(True, 16) +
                       filter_chip('店铺', '全部') + filter_chip('站点', '全部') + filter_chip('标签'), 8),
                   chip('指标为示例数据', 'warning', 11, 'info'))
    R = REPORT
    kpis = grid(kpi('工单量', str(R['tickets_week']), R['tickets_delta'], 'muted', '近 7 天 · 全部渠道') +
                kpi('首响中位数', R['frt_median'], R['frt_delta'], 'success', '从来信到第一封回复') +
                kpi('SLA 达标率（亚马逊）', R['sla_rate'], None, 'muted', '未达标 %d 封' % R['sla_miss']) +
                kpi('草稿采纳率', R['adopt_rate'], None, 'muted', R['adopt_split']) +
                kpi('自动发送占比', R['auto_rate'], None, 'muted', R['auto_note']), 5, 12)

    d10 = [x for x in R['daily'] if x[0] == '09-10'][0]
    tip_d = drill_tip('09-10 · %d 单' % (d10[1] + d10[2]), ['亚马逊 %d · Shopify 与邮件 %d' % (d10[1], d10[2])], 'P04 工单（09-10）')
    daily = chart_card('每日工单量', '按渠道堆叠 · 近 7 天 · 点柱下钻', legend([('亚马逊', T['amazon']), ('Shopify 与邮件', T['shopify'])]) +
                       stacked_columns(R['daily'], 184, 80, 20, hover=R['daily'].index(d10), tip=tip_d))
    ic = intent_counts(R['tickets_week'], R['intents'])
    by_pct = {p: ic[n] for n, p in R['intents']}  # 示例百分比各不相同，可按百分比取单数
    fmt_i = lambda v: '%d%% · <span style="font-weight: 400; color: %s;">%d 单</span>' % (v, T['ink3'], by_pct[v])
    intents = chart_card('意图分布', '近 7 天工单主意图占比 · 共 %d 单 · 点条下钻 → P04' % R['tickets_week'],
                         hbars(R['intents'], fmt_i, 35, T['accent'], 124, 12, 17, 96))

    cbr = cost_by_resp()
    order = sorted(cbr.items(), key=lambda x: -x[1])
    lt = ledger_totals()
    tot = round(sum(cbr.values()), 2)
    tip_c = drill_tip('%s · %s' % (order[0][0], money(order[0][1])), ['本月登记台账，不含待确认'], 'P13 登记台账（已按责任筛选）')
    cost = chart_card('售后成本按责任类型', '来自登记台账（不含待确认）· 点条下钻',
                      between(row(text(money(tot), 20, T['ink'], 700) + muted('%d 单 · 产品成本 + 运费 + 额外赔偿' % lt['count'], 12), 8, 'baseline'), '') +
                      hbars(order, money, 130, T['accent'], 96, hover=0, tip=tip_c), tag=lock_tag())

    seg_bar = ''
    parts = [('已结算', lt['settled'], T['ok_solid']), ('待结算', lt['pending'], T['accent']), ('比例未定', lt['undecided'], T['line_strong'])]
    for i, (n, v, c) in enumerate(parts):
        seg_bar += '<div style="width: %.2f%%; height: 100%%; background: %s;%s%s"></div>' % (
            v * 100.0 / lt['factory'], c, ' margin-right: 2px;' if i < 2 else '', ' border-radius: 4px 0px 0px 4px;' if i == 0 else (' border-radius: 0px 4px 4px 0px;' if i == 2 else ''))
    bar = '<div style="display: flex; height: 14px;">%s</div>' % seg_bar
    rows_ = col(''.join('<div style="display: flex; align-items: center; gap: 8px; font-size: 12px;"><div style="width: 10px; height: 10px; border-radius: 2px; background: %s;"></div><div style="flex: 1; color: %s;">%s</div><div style="color: %s; width: 56px; text-align: right;">%s</div><div style="font-weight: 600; color: %s; width: 64px; text-align: right; font-variant-numeric: tabular-nums;">%s</div></div>' % (
        c, T['ink2'], n + note, T['ink3'], '%.0f%%' % (v * 100.0 / lt['factory']), T['ink'], money(v)) for (n, v, c), note in zip(parts, [' · 批次 FQD-A、FZJ-A', ' · 进入 10-05 生成的 FQD-B', ' · 按建议比例估算，不进批次'])), 8)
    fac = chart_card('工厂承担与结算进度', '生产厂 FQD、FZJ · 点分段下钻 → P13', tag=lock_tag(), body=
                     row(text(money(lt['factory']), 20, T['ink'], 700) + muted('工厂承担（含估算）· 其中已确认 %s' % money(round(lt['settled'] + lt['pending'], 2)), 12), 8, 'baseline') + bar + rows_ +
                     '<div style="display: flex; gap: 16px; border-top: 1px solid %s; padding-top: 8px; font-size: 12px; color: %s;">%s</div>' % (T['line2'], T['ink3'], ''.join(
                         '<div>生产厂 %s <b style="color: %s;">%s</b>（已确认 %s）</div>' % (c, T['ink'], money(factory_totals(c)['factory']), money(round(factory_totals(c)['settled'] + factory_totals(c)['pending'], 2))) for c in ('FQD', 'FZJ'))))
    charts = grid(daily + intents, template='minmax(0, 1.25fr) minmax(0, 1fr)', gap=14) + grid(cost + fac, template='minmax(0, 1fr) minmax(0, 1fr)', gap=14)
    return app('zhoumin', '报表', ['报表', '概览'], head + content(filt + kpis + charts, '14px 24px', 12))


if __name__ == '__main__':
    save('Actions.dc.html', p15())
    save('KnowledgeBase.dc.html', p16())
    save('Reports.dc.html', p17())
    print('ok')
