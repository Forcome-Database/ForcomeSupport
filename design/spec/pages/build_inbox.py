# -*- coding: utf-8 -*-
"""P01 Main · P02 TicketEmail · P03 TicketEscalated（收件箱三栏）。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from data import *
from inbox_parts import *


# ================================================================ P01 收件箱 · 亚马逊工单（李婷 · Sarah Mitchell）
def p01_middle():
    t = SARAH_T
    head = conv_head(t, '婷', actions=merge_btn(t) + btn('内部备注', 'secondary', 'sm', 'message') + icon_btn('more', 'secondary', 28))
    summary = ai_summary('9 月 3 日下单 V2 黑色，UPS 自 9 月 5 日无扫描，已超预计送达（9 月 9 日）。客户 9 月 15 日前要用。首次来信，情绪负面，未命中风险信号。')
    msg = sarah_msg()
    tabs_html = ver_tabs(SARAH_VERSIONS, 'A', sarah_huan())
    reason = ai_reason(SARAH_REASON)
    toolbar = draft_toolbar('English', False, media=False, hint='亚马逊站内信不支持图片和链接')
    ev = evidence([('政策 · 物流停滞或超预计送达处理流程', 'book'), ('政策 · FBM 补发标准', 'book'), ('历史工单 · T-20260614-0117', 'history')])
    foot = act_foot(btn('提交审批', 'primary', 'md', icon_right='arrow_r'))
    # R-SL-05：A 版含积加补发，审批 4 小时 + 执行 4 个工作小时超过 SLA 剩余，草稿卡顶部提示先发进展回复（prd_c P01「校验」）
    dc = draft_card('09-10 16:01 生成 · %s · 3 条依据' % conf(SARAH_AI['conf'], SARAH_CONF_WHY), tabs_html + reason, toolbar, sarah_body(legend=True, compact=True), ev, check_row(),
                    sarah_approval(), foot, top=rsl05_strip(t['sla_left']), gap=4)
    return middle(head, summary + msg + dc, pad='8px 20px', gap=4)


def cust_sec(name, av, email, summary, basis):
    """右栏「客户」卡：头像 + 姓名 + 邮箱 / ✦ AI 摘要（生成时间 · 依据）。P01–P03 共用。"""
    return rsec('客户', col(row(avatar(av, 'customer', 32) + col(text(name, 13, T['ink'], 700) + ellipsis(email, 12, T['ink3']), 0, 'min-width: 0px;'), 10) +
                          ai_note('<span style="color: %s; font-weight: 700;">✦ </span>%s<div style="font-size: 11px; color: %s; margin-top: 2px;">%s</div>' % (
                              T['accent'], summary, T['ink4'], basis)), 10),
                extra=link('客户档案', 12, 'chev_r'))


def p01_right():
    ident = SARAH['identities'][0]
    cust = cust_sec('Sarah Mitchell', 'SM', ident[1], SARAH['summary_short'], SARAH['summary_basis'])
    o = SARAH['orders'][0]
    order = rsec('订单', col(
        col(nowrap(o[0], 13, T['ink'], 700) + row(state('已发货') + chip('超预计送达', 'warning'), 4), 4) +
        col(kv('商品', 'V2 黑色 ×1 · $49.99') + kv('配送', 'FBM · 易仓 US · 09-03 下单') +
            kv('承运商', '%s %s' % (ORDERS[o[0]]['carrier'], ORDERS[o[0]]['tracking'])) + kv('最后扫描', '09-05 Louisville, KY') +
            kv('预计送达', '09-09（已超 2 天）', 'warning'), 4), 8),
        extra=link('卖家后台', 12, 'external'))
    rel = rsec('关联售后 / 审批', '', extra=nowrap('暂无 · 提交审批时创建', 11, T['ink4']), collapsed=True)
    info = rsec('工单信息', '', extra=nowrap('亚马逊 24h SLA · 李婷', 11, T['ink4']), collapsed=True)
    ai = rsec('AI 分析', col(
        kv('情绪', sentiment('负面')) + kv('风险信号', '未命中', 'muted') + kv('紧急度', '高 · 9 月 15 日前要用') + kv('语言', '英语'), 6) +
        '<div style="border-top: 1px solid %s; padding-top: 10px; display: flex; flex-direction: column; gap: 3px;"><div style="font-size: 12px; font-weight: 600; color: %s;">未转人工的原因</div><div style="font-size: 12px; color: %s; line-height: 1.55;">首次来信，未命中任何风险信号；诉求明确，按政策可补发，由坐席审阅后提交审批。</div></div>' % (
            T['line2'], T['ink2'], T['ink3']), last=True, ai=True, extra=nowrap('09-10 16:00', 11, T['ink4']))
    return right_column(cust + order + rel + info + ai)


def p01():
    body = three_col(queue_column('T-20260910-0192'), p01_middle(), p01_right())
    return app('liting', '收件箱', ['收件箱', '待处理', 'T-20260910-0192'], body)


# ================================================================ P02 收件箱 · 邮件工单（李婷 · Olivia Turner）
FILTER_SVG = ('<svg width="100" height="68" viewBox="0 0 112 76" fill="none" stroke-linecap="round" stroke-linejoin="round">'
              '<rect x="10" y="14" width="36" height="50" rx="6" fill="%(bg)s" stroke="%(s)s" stroke-width="1.6"></rect>'
              '<path d="M16 24h24M16 32h24M16 40h24M16 48h24M16 56h24" stroke="%(l)s" stroke-width="1.4"></path>'
              '<path d="M54 39h18" stroke="%(a)s" stroke-width="2"></path><path d="M66 33l6 6-6 6" stroke="%(a)s" stroke-width="2"></path>'
              '<rect x="80" y="18" width="24" height="42" rx="5" fill="#ffffff" stroke="%(s)s" stroke-width="1.6"></rect>'
              '<path d="M86 28c3 2 9 2 12 0M86 38c3 2 9 2 12 0M86 48c3 2 9 2 12 0" stroke="%(i)s" stroke-width="1.4"></path>'
              '</svg>') % {'bg': T['line2'], 's': T['ink3'], 'l': T['ink4'], 'a': T['accent'], 'i': T['info']}


def media_card():
    """草稿内嵌素材图卡：缩略图 + 名称 + 素材编号。"""
    thumb = '<div style="width: 112px; height: 72px; flex-shrink: 0; box-sizing: border-box; border-radius: 6px; background: %s; border: 1px solid %s; display: flex; align-items: center; justify-content: center; overflow: hidden;">%s</div>' % (
        T['subtle'], T['line'], FILTER_SVG)
    info = col(text('拆下并清洗 HEPA 滤芯', 13, T['ink'], 600) + muted('IMG-V2-014 · 图文版', 12) + row(chip('素材库', 'success', 10, 'check'), 4), 4)
    return '<div style="display: flex; gap: 10px; align-items: center; border: 1px solid %s; border-radius: 6px; padding: 6px; background: #ffffff; min-width: 0px;">%s%s</div>' % (
        T['line'], thumb, info)


def link_card():
    return '<div style="display: flex; gap: 10px; align-items: center; border: 1px solid %s; border-radius: 6px; padding: 8px 10px; background: %s; min-width: 0px;">%s<div style="display: flex; flex-direction: column; gap: 3px; min-width: 0px;"><div style="font-size: 13px; font-weight: 600; color: %s;">V2 filter care guide</div><div style="font-size: 12px; color: %s;">forcome.com/support/v2-filter</div>%s</div></div>' % (
        T['line'], T['subtle'], icon('link', 16, T['accent'], 2), T['accent_ink'], T['ink3'], row(chip('白名单', 'success', 10, 'check'), 4))


def olivia_body():
    steps = ''.join('<div style="display: flex; gap: 8px;"><div style="width: 16px; flex-shrink: 0; color: %s; font-weight: 600;">%d.</div><div>%s</div></div>' % (T['ink3'], i + 1, s)
                    for i, s in enumerate(DRAFTS['olivia_steps']))
    return body_box(paras(DRAFTS['olivia_A']) + '<div style="display: flex; flex-direction: column; gap: 2px;">%s</div>' % steps +
                    grid(media_card() + link_card(), 2, 10) + paras(DRAFTS['olivia_end']), gap=6, hint=EDIT_HINT)


# P02 客户卡取 data.OLIVIA；推荐理由与置信度取 data.DRAFT_AI
OLIVIA_AI = DRAFT_AI['T-20260911-0031']


def p02_middle():
    t = TK['T-20260911-0031']
    head = conv_head(t, '婷')
    msg = customer_msg('Olivia Turner', 'Gmail · support@forcome.com · 09-11 09:12', MSG_IN['olivia_en'], '', seg(['原文', '中文译文'], '原文', 'sm'))
    tabs_html = ver_tabs([('A', 'A 先排查', ai_badge('推荐', 11)), ('B', 'B 直接寄滤芯', ''), ('C', 'C 退款', '')], 'A', btn('换一版', 'ghost', 'sm', 'refresh'))
    toolbar = draft_toolbar('English', False, media=True, lib=True)
    ev = evidence([('排查树 · 吸力下降 → 清洁滤芯', 'book'), ('产品事实 · V2 保修 12 个月', 'book'), ('素材库 · IMG-V2-014', 'image')])
    foot = act_foot(btn('发送', 'primary', 'md', 'send'), extra=nowrap('以 support@forcome.com 发出', 11, T['ink4']), note='发送后自动打开下一张')
    dc = draft_card('09-11 09:13 生成 · %s · 3 条依据' % conf(OLIVIA_AI['conf'], OLIVIA_AI['conf_why']), tabs_html + ai_reason(OLIVIA_AI['reason']), toolbar, olivia_body(), ev, check_row(), '', foot)
    return middle(head, msg + dc, pad='10px 20px', gap=8)


def p02_right():
    t = TK['T-20260911-0031']
    cust = cust_sec('Olivia Turner', 'OT', OLIVIA['email'], OLIVIA['summary'], OLIVIA['summary_basis'])
    order = rsec('订单', col(between(nowrap('#1063', 13, T['ink'], 700), state('已签收')) +
                           kv('商品', '%s · %s' % (ORDERS['#1063']['item'], ORDERS['#1063']['amount'])) + kv('下单', ORDERS['#1063']['date']) + kv('保修', '保修期内 · 已购买 %s' % ORDERS['#1063']['age'], 'success'), 4),
                 extra=link('Shopify 后台', 12, 'external'))
    rel = rsec('关联售后 / 审批', '', extra=nowrap('暂无', 11, T['ink4']), collapsed=True)
    info = rsec('工单信息', col(
        kv('进线', 'Gmail · support@forcome.com') + kv('发送方式', '直接发送（本版无审批项）') + kv('内部目标 SLA', sla(t['sla_left'] + ' · 内部', 'normal')), 6))
    tree = rsec('排查树路径', vsteps([('清洁并晾干 HEPA 滤芯', 'current'), ('检查集尘杯密封圈', 'todo'), ('检查软管与吸口是否堵塞', 'todo'),
                                   ('仍未解决：创建售后单（寄滤芯）', 'todo')]), extra=nowrap('吸力下降排查 · 第 1 步', 11, T['ink3']), last=True)
    return right_column(cust + order + rel + info + tree)


def p02(h=900):
    """h：状态板拿它作弹窗底图时可加高（StatesInbox I21），页面本身固定 900。"""
    body = three_col(queue_column('T-20260911-0031'), p02_middle(), p02_right())
    return app('liting', '收件箱', ['收件箱', '待处理', 'T-20260911-0031'], body, h=h)


# ================================================================ P03 收件箱 · 转人工工单（陈晨 · Mateo Rivas）
MATEO_T = TK['T-20260902-0071']


def mateo_submitted():
    ap = APPROVALS[0]
    prev = DRAFTS['mateo_bound_es'].split('MX$889.00.')[0] + 'MX$889.00. …'
    head = between(row(icon('approve', 15, T['warn'], 2) + nowrap('已提交审批', 12, T['ink3']) + nowrap(ap['no'], 13, T['ink'], 700) + state('待审批') + sla('剩 ' + ap['left'], 'warning'), 8),
                   row(nowrap('陈晨 09:30 发起 · 等客服主管 周敏', 12, T['ink3']) + btn('撤回', 'secondary', 'sm'), 10))
    quote = '<div style="font-size: 12px; color: %s; line-height: 1.55; border-left: 2px solid %s; padding: 0px 0px 0px 10px;">%s</div>' % (T['ink2'], T['warn_line'], prev)
    body = col(
        '<div style="display: flex; gap: 28px;">%s%s</div>' % (kvline('报备', '额外赔偿 <b>MX$889.00</b>（≈ $49.39）· 免退货全额退款', 52),
                                                              kvline('动作', row(nowrap('亚马逊退款 MX$889.00', 13, T['ink']) + cat('SP-API'), 6), 28)) +
        kvline('绑定回复', col(quote + row(muted('Español · 退款成功后自动发出', 12) + link('展开全文与中文译文', 12, 'chev_d'), 12), 3), 52), 5)
    return card(head + body, pad='9px 14px', gap=7, tone='warning')


def mateo_msg():
    two = grid('<div>%s</div>' % DRAFTS['mateo_in_es'] +
               '<div style="color: %s; border-left: 1px solid %s; padding-left: 14px;">%s</div>' % (T['ink2'], T['line'], DRAFTS['mateo_in_zh']),
               gap=14, template='minmax(0, 1.3fr) minmax(0, 1fr)')
    return customer_msg('Mateo Rivas', '亚马逊买家消息 · 09-10 11:15 · 第 2 封来信', two, '', seg(['并排', '原文', '译文'], '并排', 'sm'))


def progress_reply():
    why = '亚马逊站内信不支持图片和链接'
    tb = row(nowrap('回复语言', 12, T['ink3']) + select_box('Español', width='104px', h=28) + tg(True, '用中文写，自动译成西班牙语') + divider(True, 16) +
             btn('插入图片', 'secondary', 'sm', 'image', disabled=True, reason=why) + btn('插入链接', 'secondary', 'sm', 'link', disabled=True, reason=why) +
             row(icon('info', 13, T['ink4']) + nowrap('站内信不支持', 11, T['ink3']), 4), 8)
    zh = col(row(nowrap('中文（可编辑）', 11, T['ink3'], 600) + chip('来自模板 · 进展回复（不含承诺）', 'muted', 11, 'book'), 6) + textarea_box(DRAFTS['mateo_progress_zh'], st='focus', h=84, counter='%d / 1000' % len(DRAFTS['mateo_progress_zh'])), 4)
    es = col(between(nowrap('西班牙语译文 · 将发送', 11, T['ink3'], 600), link('查看回译', 11)) +
             '<div style="min-height: 84px; box-sizing: border-box; border: 1px solid %s; background: %s; border-radius: 8px; padding: 8px 10px; font-size: 13px; line-height: 1.5; color: %s;">%s</div>' % (
                 T['line'], T['subtle'], T['ink'], DRAFTS['mateo_progress_es']), 4)
    # 回复类型（R-TK-03）：插入进展模板后自动选「进展回复」；发送渠道说明放在这一行右侧，按钮行留给五个操作
    rtype = reply_type_row('进展回复', '插入进展模板后自动选择 · 客户再来信不计重复联系', nowrap('经亚马逊买家消息以 Forcome Direct 发出', 11, T['ink4']))
    foot = draft_foot(btn('发送进展回复', 'primary', 'md', 'send') + btn('提交审批', 'secondary', 'md', 'approve') + btn('转售后确认', 'secondary', 'md', 'box') +
                      btn('让 AI 起草', 'secondary', 'md', 'spark') + btn('转客服主管', 'secondary', 'md', 'handoff'))
    return card(tb + grid(zh + es, 2, 12) + rtype + foot.replace('padding-top: 10px;', 'padding-top: 8px;', 1), pad='8px 16px', gap=5)


def p03_middle():
    t = MATEO_T
    head = conv_head(t, '晨', tags=[], actions=merge_btn(t) + btn('内部备注', 'secondary', 'sm', 'message') + icon_btn('more', 'secondary', 28))
    risk = banner('danger', '命中风险信号：平台风险 · 差评威胁 · 已转人工',
                  '原文「…<b>dejar una reseña negativa</b>」，优先级紧急；另：重复联系 1 次。AI 不自动起草，也不自动发送。')
    hist = '<div style="display: flex; align-items: center; gap: 8px; padding: 0px 2px;">%s<div style="font-size: 12px; color: %s; flex: 1; min-width: 0px;">本工单 09-02 首次来信，已建售后单 <span style="color: %s; font-weight: 600;">S-20260903-0012</span>（电池，生产厂直寄运输中）</div>%s</div>' % (
        icon('history', 15, T['ink3']), T['ink2'], T['accent'], link('展开历史', 12, 'chev_d'))
    warn = banner('warning', 'SLA 剩 55 分钟，审批还剩 3h 10m', '承诺退款的回复要在审批后才发出。建议先发一条不含承诺的进展回复（已插入下方回复框）。',
                  btn('已插入 · 重新插入', 'secondary', 'sm', 'check'))
    return middle(head, risk + hist + mateo_msg() + mateo_submitted() + warn + progress_reply(), pad='8px 18px', gap=5)


def p03_right():
    cust = cust_sec('Mateo Rivas', 'MR', MATEO['email'], MATEO['summary'], MATEO['summary_basis'])
    o = ORDERS['302-8811234-9901122']
    order = rsec('订单', '', extra=nowrap('%s · %s 签收' % (o['amount'], o['delivered']), 12, T['ink3']), collapsed=True)
    AS = {a['no']: a for a in AFTERSALES}

    def as_card(no, st, line1, line2):
        return '<div style="border: 1px solid %s; border-radius: 6px; padding: 8px 10px; display: flex; flex-direction: column; gap: 3px;">%s%s%s</div>' % (
            T['line'], between(nowrap(no, 12, T['accent'], 700), st), text(line1, 12, T['ink'], 600), muted(line2, 12))
    a1, a2 = AS['S-20260903-0012'], AS['S-20260911-0020']
    rel = rsec('关联售后 / 审批', col(
        as_card(a1['no'], state(a1['status']), '%s寄件 · 运输中 · %s' % (PARTS[a1['part']], a1['tracking']), '比例协商待升级（内部，不影响客户）') +
        as_card(a2['no'], state(a2['status']), '全额退款 %s · 待审批' % a2['comp_orig'], '%s · 额外赔偿报备 · 等周敏' % a2['approval']), 8), extra=nowrap('2 张', 11, T['ink3']))
    info = rsec('工单信息', col(
        kv('情绪', sentiment('负面')) + kv('重复联系', '1 次', 'warning') + kv('语言', '西班牙语 · usted 敬语'), 6), last=True)
    return right_column(cust + order + rel + info)


def p03():
    body = three_col(queue_column('T-20260902-0071'), p03_middle(), p03_right())
    return app('chenchen', '收件箱', ['收件箱', '待处理', 'T-20260902-0071'], body)


if __name__ == '__main__':
    save('Main.dc.html', p01())
    save('TicketEmail.dc.html', p02())
    save('TicketEscalated.dc.html', p03())
    print('ok')
