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
    head = conv_head(t, '婷', actions=btn('合并', 'secondary', 'sm', 'merge', disabled=True) + btn('内部备注', 'secondary', 'sm', 'message') + icon_btn('more', 'secondary', 28))
    summary = ai_summary('9 月 3 日下单 V2 黑色，UPS 自 9 月 5 日无扫描，已超预计送达（9 月 9 日）。客户 9 月 15 日前要用。首次来信，情绪负面，未命中风险信号。')
    msg = sarah_msg()
    tabs_html = ver_tabs(SARAH_VERSIONS, 'A', sarah_huan())
    toolbar = draft_toolbar('English', False, media=False, hint='亚马逊站内信不支持图片和链接')
    ev = evidence([('政策 · 物流停滞或超预计送达处理流程', 'book'), ('政策 · FBM 补发标准', 'book'), ('历史工单 · T-20260614-0117', 'history')])
    foot = draft_foot(btn('提交审批', 'primary', 'md', icon_right='arrow_r') + btn('修改', 'secondary', 'md', 'edit') + btn('转人工', 'secondary', 'md', 'handoff'),
                      btn('拒绝草稿', 'ghost', 'md', 'x_c'))
    dc = draft_card('09-10 16:01 生成 · 置信度 <b style="color: %s;">82%%</b> · 3 条依据' % T['ink2'], tabs_html, toolbar, sarah_body(), ev, check_row(),
                    sarah_approval(), foot, gap=7)
    return middle(head, summary + msg + dc, pad='10px 20px', gap=8)


def p01_right():
    ident = SARAH['identities'][0]
    cust = rsec('客户', col(row(avatar('S', 'grey', 32) + col(text('Sarah Mitchell', 13, T['ink'], 700) + ellipsis(ident[1], 12, T['ink3']), 0, 'min-width: 0px;'), 10) +
                          ai_note('3 笔订单、2 张工单。6 月问过一次物流进度，无投诉、无退款。这次是第一次负面来信。'), 10),
                extra=link('查看客户档案', 12, 'chev_r'))
    o = SARAH['orders'][0]
    order = rsec('订单', col(
        between(nowrap(o[0], 13, T['ink'], 700), row(state('已发货') + chip('超预计送达', 'warning'), 4)) +
        col(kv('商品', 'V2 黑色 ×1 · $49.99') + kv('配送方式', 'FBM · 良仓 US') + kv('下单', '09-03') +
            kv('承运商', 'UPS 1Z4R28830358229017') + kv('最后扫描', '09-05 Louisville, KY') +
            kv('预计送达', '09-09（已超 2 天）', 'warning'), 4), 8),
        extra=link('在积加中打开', 12, 'external'))
    ai = rsec('AI 分析', col(
        kv('意图', cat('未收到与异常')) + kv('情绪', sentiment('负面')) + kv('风险信号', '未命中', 'muted') + kv('语言', '英语') +
        kv('紧急度', '高 · 9 月 15 日前要用') + kv('发送方式', '待审草稿 → 提交审批'), 6) +
        '<div style="border-top: 1px solid %s; padding-top: 10px; display: flex; flex-direction: column; gap: 3px;"><div style="font-size: 12px; font-weight: 600; color: %s;">未转人工的原因</div><div style="font-size: 12px; color: %s; line-height: 1.55;">首次来信，未命中安全、平台、重复联系、高价值等风险信号；诉求明确，按政策可补发，由坐席审阅后提交审批。</div></div>' % (
            T['line2'], T['ink2'], T['ink3']), last=True)
    return right_column(cust + order + ai)


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
                    grid(media_card() + link_card(), 2, 10) + paras(DRAFTS['olivia_end']), gap=8)


def p02_middle():
    t = TK['T-20260911-0031']
    head = conv_head(t, '婷')
    msg = customer_msg('Olivia Turner', 'Gmail · support@forcome.com · 09-11 09:12', MSG_IN['olivia_en'], '', seg(['原文', '中文译文'], '原文', 'sm'))
    tabs_html = ver_tabs([('A', 'A 先排查', chip('AI 推荐', 'accent', 10, 'spark')), ('B', 'B 直接寄滤芯', ''), ('C', 'C 退款', '')], 'A', btn('换一版', 'ghost', 'sm', 'refresh'))
    toolbar = draft_toolbar('English', False, media=True, lib=True)
    ev = evidence([('排查树 · 吸力下降 → 清洁滤芯', 'book'), ('产品事实 · V2 保修 12 个月', 'book'), ('素材库 · IMG-V2-014', 'image')])
    foot = draft_foot(btn('发送', 'primary', 'md', 'send') + btn('修改', 'secondary', 'md', 'edit') + btn('转人工', 'secondary', 'md', 'handoff') +
                      nowrap('以 support@forcome.com 发出', 11, T['ink4']),
                      btn('拒绝草稿', 'ghost', 'md', 'x_c'))
    dc = draft_card('09-11 09:13 生成 · 置信度 <b style="color: %s;">86%%</b> · 3 条依据' % T['ink2'], tabs_html, toolbar, olivia_body(), ev, check_row(), '', foot)
    return middle(head, msg + dc, pad='12px 20px', gap=10)


def p02_right():
    info = rsec('工单信息', col(
        kv('店铺', 'forcome.com') + kv('渠道', channel('Shopify', 'US')) + kv('进线', 'Gmail · support@forcome.com') +
        kv('意图', cat('产品故障与使用问题')) + kv('发送方式', '待审草稿（本版无审批项）') + kv('负责人', '李婷') +
        kv('内部目标 SLA', sla('22h 52m', 'normal')), 6))
    chk = rsec('回复检查', check_list([
        ('事实有来源', '3 条事实均可追溯到排查树、产品事实与素材库', True),
        ('不越政策', '保修内寄送新滤芯，在保修条款之内', True),
        ('渠道内容能力', '图片 1 张来自素材库，链接 1 个在白名单', True),
        ('语言一致', '来信英语，回复英语', True),
        ('不泄露内部信息', '未出现内部备注、成本、生产厂', True),
    ]), extra=chip('5 / 5 通过', 'success', 11, 'check'))
    tree = rsec('排查树路径', vsteps([('清洁并晾干 HEPA 滤芯', 'current'), ('检查集尘杯密封圈', 'todo'), ('检查软管与吸口是否堵塞', 'todo'),
                                   ('仍未解决：创建售后单（寄滤芯）', 'todo')]), extra=nowrap('吸力下降排查 · 第 1 步', 11, T['ink3']))
    order = rsec('订单', col(between(nowrap('#1063', 13, T['ink'], 700), state('已签收')) +
                           kv('商品', 'V2 车载吸尘器 ×1 · $54.99') + kv('下单', '08-05') + kv('保修', '保修期内 · 已购买 37 天', 'success'), 4),
                 extra=link('在积加中打开', 12, 'external'), last=True)
    return right_column(info + chk + tree + order)


def p02():
    body = three_col(queue_column('T-20260911-0031'), p02_middle(), p02_right())
    return app('liting', '收件箱', ['收件箱', '待处理', 'T-20260911-0031'], body)


# ================================================================ P03 收件箱 · 转人工工单（陈晨 · Jonas Weber）
JONAS_T = TK['T-20260902-0071']


def jonas_submitted():
    ap = APPROVALS[0]
    prev = DRAFTS['jonas_bound_de'].split('erstattet.')[0] + 'erstattet. …'
    head = between(row(icon('approve', 15, T['warn'], 2) + nowrap('已提交审批', 12, T['ink3']) + nowrap(ap['no'], 13, T['ink'], 700) + state('待审批') + sla('剩 ' + ap['left'], 'warning'), 8),
                   row(nowrap('陈晨 09:30 发起 · 等客服主管 周敏', 12, T['ink3']) + btn('撤回', 'secondary', 'sm'), 10))
    quote = '<div style="font-size: 12px; color: %s; line-height: 1.55; border-left: 2px solid %s; padding: 0px 0px 0px 10px;">%s</div>' % (T['ink2'], T['warn_line'], prev)
    body = col(
        '<div style="display: flex; gap: 28px;">%s%s</div>' % (kvline('报备', '额外赔偿 <b>€44.90</b>（≈ $49.39）· 免退货全额退款', 52),
                                                              kvline('动作', row(nowrap('亚马逊退款 €44.90', 13, T['ink']) + cat('人工操作清单'), 6), 28)) +
        kvline('绑定回复', col(quote + row(muted('Deutsch · 退款回填后自动发出', 12) + link('展开全文与中文译文', 12, 'chev_d'), 12), 3), 52), 5)
    return card(head + body, pad='9px 14px', gap=7, tone='warning')


def jonas_msg():
    two = grid('<div>%s</div>' % DRAFTS['jonas_in_de'] +
               '<div style="color: %s; border-left: 1px solid %s; padding-left: 14px;">%s</div>' % (T['ink2'], T['line'], DRAFTS['jonas_in_zh']),
               gap=14, template='minmax(0, 1.3fr) minmax(0, 1fr)')
    return customer_msg('Jonas Weber', '经积加同步 · 09-10 11:15 · 第 2 次来信', two, '', seg(['并排', '原文', '译文'], '并排', 'sm'))


def progress_reply():
    tb = row(nowrap('回复语言', 12, T['ink3']) + select_box('Deutsch', width='104px', h=28) + tg(True, '用中文写，自动译成德语') + divider(True, 16) +
             btn('插入图片', 'secondary', 'sm', 'image', disabled=True) + btn('插入链接', 'secondary', 'sm', 'link', disabled=True) +
             row(icon('info', 13, T['ink4']) + nowrap('站内信不支持', 11, T['ink3']), 4), 8)
    zh = col(nowrap('中文（可编辑）', 11, T['ink3'], 600) + textarea_box(DRAFTS['jonas_progress_zh'], st='focus', h=84, counter='58 / 1000'), 4)
    de = col(between(nowrap('德语译文 · 将发送', 11, T['ink3'], 600), link('查看回译', 11)) +
             '<div style="min-height: 84px; box-sizing: border-box; border: 1px solid %s; background: %s; border-radius: 6px; padding: 8px 10px; font-size: 13px; line-height: 1.55; color: %s;">%s</div>' % (
                 T['line'], T['subtle'], T['ink'], DRAFTS['jonas_progress_de']), 4)
    foot = draft_foot(btn('发送进展回复', 'primary', 'md', 'send') + btn('让 AI 起草', 'secondary', 'md', 'spark') + btn('转客服主管', 'secondary', 'md', 'handoff'),
                      nowrap('经积加以 Forcome Direct 发出', 11, T['ink4']))
    return card(tb + grid(zh + de, 2, 12) + foot, pad='10px 16px', gap=8)


def p03_middle():
    t = JONAS_T
    head = conv_head(t, '晨', actions=btn('合并', 'secondary', 'sm', 'merge') + btn('内部备注', 'secondary', 'sm', 'message') + icon_btn('more', 'secondary', 28))
    risk = banner('danger', '命中风险信号：平台风险 · 差评威胁 · 已转人工',
                  '原文「…<b>schlechte Bewertung hinterlassen</b>」，优先级紧急；另：重复联系 1 次。AI 不自动起草，也不自动发送。')
    hist = '<div style="display: flex; align-items: center; gap: 8px; padding: 0px 2px;">%s<div style="font-size: 12px; color: %s; flex: 1; min-width: 0px;">本工单 09-02 首次来信，已建售后单 <span style="color: %s; font-weight: 600;">S-20260903-0012</span>（电池，生产厂直寄运输中）</div>%s</div>' % (
        icon('history', 15, T['ink3']), T['ink2'], T['accent'], link('展开历史', 12, 'chev_d'))
    warn = banner('warning', 'SLA 剩 55 分钟，审批还剩 3h 10m', '承诺退款的回复要在审批后才发出。建议先发一条不含承诺的进展回复。', btn('插入进展回复模板', 'secondary', 'sm', 'book'))
    return middle(head, risk + hist + jonas_msg() + jonas_submitted() + warn + progress_reply(), pad='12px 20px', gap=8)


def p03_right():
    info = rsec('工单信息', col(
        kv('意图', cat('退货与退款')) + kv('情绪', sentiment('负面')) + kv('优先级', priority('紧急')) + kv('负责人', '陈晨') +
        kv('审批单', row(nowrap('AP-20260911-001', 12, T['accent'], 600) + state('待审批'), 6)) +
        kv('重复联系', '1 次', 'warning') + kv('风险信号', chip('平台风险 · 差评威胁', 'danger')) + kv('语言', '德语 · 正式称呼'), 6))
    hist = rsec('客户历史', ai_note('亚马逊 DE 客户，1 笔订单 €44.90。09-02 首次来信反映机器不工作，已补发电池（生产厂直寄，运输中）。本次是第 2 封来信（重复联系 1 次），要求退款并威胁差评。'))

    def as_card(no, tags, st, step):
        return '<div style="border: 1px solid %s; border-radius: 6px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px;">%s%s%s</div>' % (
            T['line'], between(nowrap(no, 12, T['accent'], 700), st), row(tags, 4, wrap=True), muted(step, 12))
    rel = rsec('关联售后单', col(
        as_card('S-20260903-0012', cat('寄配件') + cat('良仓无货') + cat('产品质量问题'), row(state('已完成'), 4), '比例协商：待升级 · 单号已回复客户') +
        as_card('S-20260911-0020', cat('退款或部分补偿') + cat('产品质量问题'), state('进行中'), '当前环节：报备审批 · 额外赔偿 · 等周敏'), 8), extra=nowrap('2 张', 11, T['ink3']))
    order = rsec('订单', col(between(nowrap('302-8811234-9901122', 13, T['ink'], 700), state('已签收')) +
                           kv('商品', '车载吸尘器 V2 ×1 · €44.90') + kv('站点', '亚马逊 DE · Forcome Direct') + kv('签收', '08-27'), 4),
                 extra=link('在积加中打开', 12, 'external'), last=True)
    return right_column(info + hist + rel + order)


def p03():
    body = three_col(queue_column('T-20260902-0071'), p03_middle(), p03_right())
    return app('chenchen', '收件箱', ['收件箱', '待处理', 'T-20260902-0071'], body)


if __name__ == '__main__':
    save('Main.dc.html', p01())
    save('TicketEmail.dc.html', p02())
    save('TicketEscalated.dc.html', p03())
    print('ok')
