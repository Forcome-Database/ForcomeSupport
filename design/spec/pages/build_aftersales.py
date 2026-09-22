# -*- coding: utf-8 -*-
"""P07 售后单列表 · P08 确认责任与处理方式 · P09–P11 售后单详情 · P12 承担比例协商。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from data import *
from as_common import *


# ================================================================ P07 售后单列表
def need_me(a):
    return a['status'] == '待确认' or a['nego'] == '待升级'


# 快捷筛选计数：各项独立计数，可重叠（S-20260903-0012 已完成且协商待升级，同时计入「需我处理」与「已完成」）
QUICK = {
    '需我处理': sum(1 for a in AFTERSALES if need_me(a)),
    '等审批': sum(1 for a in AFTERSALES if a['step'].startswith('报备审批')),
    '等生产厂': sum(1 for a in AFTERSALES if a['waiting'] == '东莞生产厂'),
    '已完成': sum(1 for a in AFTERSALES if a['status'] == '已完成'),
}

# 排序：需我处理（待确认、待升级）→ 等审批 → 等生产厂 → 其余；组内按已等时长
P07_ORDER = ['S-20260911-0022', 'S-20260903-0012',
             'S-20260911-0020', 'S-20260911-0021', 'S-20260911-0018',
             'S-20260911-0019',
             'S-20260910-0017', 'S-20260908-0015', 'S-20260909-0016', 'S-20260905-0014', 'S-20260904-0013', 'S-20260902-0011', 'S-20260901-0010']


def waited_cell(a):
    w = a.get('waited')
    if not w:
        return na()
    if ' · ' in w:
        x, y = w.split(' · ', 1)
        return col(nowrap(x, 12.5, T['ink'], 600) + nowrap(y, 11, T['ink3']), 0)
    tone = T['warn'] if need_me(a) else T['ink']
    return nowrap(w, 12.5, tone, 600)


def owner_cell(a):
    """负责人 = 按店铺分配的售后负责人；路径 B 的发起坐席在下方小字显示。"""
    if a.get('initiator'):
        return row(nowrap(a['owner'], 12.5, T['ink2']) + nowrap('· %s发起' % a['initiator'], 11, T['ink4']), 4)
    return nowrap(a['owner'], 12.5, T['ink2'])


def p07_table(order=None, sel=None):
    order = order or P07_ORDER
    cols = [('售后单号', 'left'), ('客户', 'left'), ('渠道与店铺', 'left'), ('处理方式', 'left'), ('责任', 'left'), ('状态', 'left'),
            ('当前环节', 'left'), ('在等谁', 'left'), ('已等', 'left'), ('费用合计', 'right'), ('负责人', 'left')]
    rows, tones = [], {}
    for i, no in enumerate(order):
        a = AS[no]
        fee = pending('待报价') if a['product'] is None else money(total(a))
        rows.append([
            nowrap(no, 12.5, T['ink'], 600), ellipsis(a['customer'], 12.5), ch(a), cat(a['method']), cat(a['resp']), state(a['status']),
            ellipsis(a['step'], 12.5, T['ink2']), ellipsis(a['waiting'], 12.5, T['ink2'] if a['waiting'] != '—' else T['ink4']),
            waited_cell(a), fee, owner_cell(a)])
        if need_me(a):
            tones[i] = 'warning'
    tpl = '124px 100px 184px 100px 88px 64px minmax(0, 1fr) 112px 92px 70px 100px'
    return table(cols, rows, tpl, sel=sel, row_tones=tones)


def p07_filters(active='全部 %d' % N_ALL, extra_chips=None):
    q = ['需我处理 %d' % QUICK['需我处理'], '等审批 %d' % QUICK['等审批'], '等生产厂 %d' % QUICK['等生产厂'], '已完成 %d' % QUICK['已完成'], '全部 %d' % N_ALL]
    chips = extra_chips if extra_chips is not None else (filter_chip('店铺', '全部') + filter_chip('处理方式') + filter_chip('责任') + filter_chip('创建时间', '近 30 天'))
    return between(row(seg(q, active) + divider(True, 20) + chips, 8),
                   row(icon('sort', 14, T['ink4']) + nowrap('需我处理在前，其次等审批、等生产厂，再按已等时长', 12, T['ink3']), 6))


def p07():
    actions = btn('导出', 'secondary', 'md', 'download') + btn('新建售后单', 'primary', 'md', 'plus')
    body = as_head('售后单', actions) + content(p07_filters() + p07_table() + pagination('共 %d 条' % N_ALL), '16px 24px', 12)
    return app('wanglei', '售后', ['售后', '售后单'], body)


# ================================================================ P08 确认责任与处理方式
def p08_sections(err_resp=False, override=False, stock_fail=False):
    a = AS['S-20260911-0022']
    # 1 处理方式
    m_cards = row(radio_card('调整安装方式', '继续指导使用或安装，不寄东西') +
                  radio_card('寄配件', '含换新、整机补发', True, 'AI 建议') +
                  radio_card('退款或部分补偿', '金额不超过订单金额 $49.99'), 8, 'stretch')
    inl = lambda k, c, req=False: row('<div style="font-size: 12px; font-weight: 600; color: %s; white-space: nowrap;">%s%s</div>' % (
        T['ink2'], k, '<span style="color: %s; margin-left: 2px;">*</span>' % T['bad'] if req else '') + c, 8, extra='min-width: 0px;')
    m_more = '<div style="display: grid; grid-template-columns: minmax(0, 1.2fr) 150px minmax(0, 1fr); gap: 16px; align-items: center; background: %s; border: 1px solid %s; border-radius: 8px; padding: 8px 12px;">%s%s%s</div>' % (
        T['subtle'], T['line'],
        inl('配件', select_box('FC-V2-CB01 充电线'), True),
        inl('数量', input_box('1', suffix='件 · 1–10', mono=True), True),
        inl('发货方', input_box('按第 3 项库存自动选择', st='readonly')))
    s1 = card(sec_head(1, '处理方式', True) + m_cards + m_more, pad='12px 16px', gap=10)

    # 2 责任类型
    sel = None if err_resp else ('其他' if override else '产品质量问题')
    r_cards = row(''.join(radio_card(t, d, sel == t, 'AI 建议' if t == '产品质量问题' else None) for t, d in [
        ('客户使用问题', 'FSH 100 / 工厂 0'), ('产品质量问题', 'FSH 0 / 工厂 100'),
        ('物流问题', 'FSH 100 / 工厂 0'), ('其他', '默认 FSH 50 / 工厂 50')]), 8, 'stretch')
    if err_resp:
        r_cards = '<div style="border-radius: 10px; box-shadow: 0 0 0 1px %s;">%s</div>' % (T['bad_solid'], r_cards)
    basis = '<div style="display: flex; flex-direction: column; gap: 2px; background: %s; border: 1px solid %s; border-radius: 8px; padding: 8px 12px;">%s%s</div>' % (
        T['accent_bg'], T['accent_line'],
        row(icon('spark', 14, T['accent']) + nowrap('AI 建议依据', 12, T['accent_ink'], 700) + nowrap('置信度 88%', 11, T['ink3']), 6),
        grid(bullet('购买 23 天，在 12 个月保修期内') + bullet('近 30 天同配件 FC-V2-CB01 故障 1 起') + '<div style="grid-column: span 2;">%s</div>' % bullet('换用客户自己的 USB-C 线可以充电，原装线不行，视频已附'), 2, 0, extra='column-gap: 16px;'))
    extra2 = ''
    if err_resp:
        extra2 = '<div style="display: flex; align-items: center; gap: 4px; font-size: 12px; color: %s;">%s请选择责任类型</div>' % (T['bad'], icon('alert', 13, T['bad'], 2))
    if override:
        extra2 = field('改判理由', textarea_box(None, '与 AI 建议不同，请说明依据，例如客户照片、检测结论', 'error', 56, '0 / 200'), True, error='改判需要填写理由')
    s2 = card(sec_head(2, '责任类型', True, nowrap('与 AI 建议不同时需填写改判理由', 12, T['ink3'])) + r_cards + extra2 + basis, pad='12px 16px', gap=10)

    # 3 库存与费用
    if stock_fail:
        stock = '<div style="display: flex; align-items: center; gap: 12px; background: %s; border: 1px solid %s; border-radius: 8px; padding: 10px 12px;">%s<div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 13px; font-weight: 700; color: %s;">良仓库存查询失败</div><div style="font-size: 12px; color: %s;">积加接口超时（10:05，已自动重试 3 次）。可以重试，或手工选择分支后继续。</div></div>%s</div>' % (
            T['bad_bg'], T['bad_line'], icon('wifi_off', 18, T['bad'], 2), T['bad'], T['ink2'], btn('重试', 'secondary', 'sm', 'refresh'))
        stock += row(nowrap('手工选择分支', 12, T['ink2'], 600) + radio('良仓有货') + radio('良仓无货（向生产厂询价）') + nowrap('手工选择会记入审计日志', 12, T['ink4']), 16)
    else:
        stock = row(icon('store', 15, T['ink3']) + nowrap('良仓 US 库存 12 件', 13, T['ink'], 600) + cat('良仓有货') + nowrap('积加 · 10:05 查询', 12, T['ink4']) + link('重新查询', 12, 'refresh'), 8)
    costs = grid(
        field('产品成本', input_box('1.40', prefix='$', suffix='积加成本', st='readonly', mono=True)) +
        field('运费', input_box('5.90', prefix='$', suffix='积加费率估算', st='readonly', mono=True)) +
        field('额外赔偿', input_box('0.00', prefix='$', mono=True)) +
        field('其他', input_box('0.00', prefix='$', mono=True)), 4, 12)
    ratio_line = '<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; border-top: 1px solid %s; padding-top: 10px;">%s%s</div>' % (
        T['line2'], row(nowrap('建议承担比例', 12, T['ink3']) + nowrap('FSH 0 / 工厂 100', 13, T['ink'], 700) + cat('需要协商') + nowrap('运费按 UPS Ground 估算，良仓发出后以积加回传为准', 12, T['ink4']), 8),
        row(nowrap('费用合计', 12, T['ink3']) + nowrap(money(total(a)), 14, T['ink'], 700), 8))
    s3 = card(sec_head(3, '库存与费用') + stock + costs + ratio_line, pad='12px 16px', gap=10)
    return s1, s2, s3


def p08_footer():
    """确认后将发生 + 提交按钮（合在一张底部卡里）。"""
    nxt = row(nowrap('确认后将发生', 12, T['ink3'], 700) + flow_steps(['生成发货单参数', '报备快递费用 $5.90，交客服主管审批', '批准即经积加创建发货单', '批准后在工厂工作台发起比例提案']), 12)
    bt = between(row(btn('确认并提交报备', 'primary', 'md', icon_right='arrow_r') + btn('暂存') + nowrap('上次暂存：无', 12, T['ink4']), 8), btn('取消售后单', 'danger_outline'))
    return '<div style="display: flex; flex-direction: column; gap: 10px; background: #ffffff; border: 1px solid %s; border-radius: 8px; padding: 10px 16px; box-shadow: %s;">%s%s</div>' % (
        T['accent_line'], SHADOW_XS, nxt, bt)


def p08_right():
    src = card(kv('工单', row(nowrap('T-20260911-0035', 12, T['ink'], 600) + state('等内部'), 6)) + kv('主题', 'Cable does not charge the vacuum') +
               kv('订单', '114-7788990-2233441') + kv('购买日期', '08-19 · 23 天前 · 保修内') + kv('坐席', '李婷'),
               '来源工单', link('打开', 12, 'external'), pad='12px 14px', gap=7)
    rounds = card(
        col(row(chip('第 1 轮', 'neutral', 10) + nowrap('09:30 李婷发出', 12, T['ink3']), 6) +
            text('换插座、检查点烟器保险丝后再试。', 12, T['ink2']) +
            text('客户 09:42：换了插座，还是不充电。', 12, T['ink3']), 3) +
        divider() +
        col(row(chip('第 2 轮', 'neutral', 10) + nowrap('09:50 李婷发出', 12, T['ink3']), 6) +
            text('换用其他 USB-C 线试充，并拍一段视频。', 12, T['ink2']) +
            text('客户 09:58：用自己的线可以充，原装线不行（附视频）。', 12, T['ink3']), 3) +
        row(icon('check_c', 14, T['ok']) + nowrap('排查树「充电线不充电排查」结论：充电线故障', 12, T['ok'], 600), 6) +
        text('10:06 李婷发出进展回复：已转售后确认，确认后告知寄送安排（不含承诺）。', 12, T['ink3']),
        '排查记录 · 2 轮', pad='12px 14px', gap=8)
    quote = card(
        '<div style="font-size: 12px; color: %s; line-height: 1.55; border-left: 2px solid %s; padding-left: 10px;">I tried another outlet, still nothing. With my own USB-C cable it charges fine, so it must be the cable that came in the box.</div>' % (T['ink2'], T['line_strong']) +
        muted('译文：换了插座还是不行。用我自己的 USB-C 线就能正常充电，所以应该是盒子里那根线的问题。', 12) +
        row(img_thumb('视频 0:18', 64, 44) + img_thumb('照片 1', 64, 44), 8),
        '客户原话与附件', pad='12px 14px', gap=8)
    ref = card(between(row(nowrap('S-20260905-0014', 12, T['accent'], 600) + nowrap('Oliver Grant', 12, T['ink2']), 6), row(nowrap('工厂 100%', 12, T['ink2']) + state('已结算'), 6)),
               '同类参考', nowrap('近 30 天 FC-V2-CB01 · 1 单', 11, T['ink3']), pad='12px 14px', gap=8)
    return src + rounds + quote + ref


def p08(err_resp=False, override=False, stock_fail=False):
    a = AS['S-20260911-0022']
    head = detail_head('确认责任与处理方式 · Ethan Brooks · 充电线不充电', state('待确认') + ch(a),
                       btn('查看原工单', 'secondary', 'md', 'external') + btn('退回客服继续排查', 'secondary', 'md', 'chev_l'),
                       meta_line(['售后单 S-20260911-0022', '来源工单 T-20260911-0035', '系统创建 10:05（排查两轮未解决）', '已等 15m']))
    s1, s2, s3 = p08_sections(err_resp, override, stock_fail)
    body = head + two_col(s1 + s2 + s3 + p08_footer(), p08_right(), 360, 16, '14px 24px 16px 24px')
    return app('wanglei', '售后', ['售后', '售后单', 'S-20260911-0022'], body)


# ================================================================ P09 售后单详情 · 良仓无货
P09_STEPS = [('确认', '08:20', 'done'), ('派发询价', '08:21', 'done'), ('生产厂报价', '09:40', 'done'),
             ('报备审批', '等周敏 · 剩 3h 21m', 'current'), ('生产厂寄件', '', 'todo'), ('单号回复客户', '', 'todo'), ('完成', '', 'todo')]


def p09_filing():
    ap = [x for x in APPROVALS if x['no'] == 'AP-20260911-003'][0]
    head = between(row(label('报备审批') + nowrap(ap['no'], 12, T['ink2'], 600), 8), row(state(ap['status']) + sla('剩 ' + ap['left'], 'normal'), 6))
    kvs = grid(kv('报备类型', '快递费用') + kv('金额', '$11.50') +
               kv('审批人', '客服主管 周敏') + kv('发起', '系统 · 09:41') +
               kv('生产厂报价', row(nowrap('$14.70', 12.5, T['ink'], 600) + link('退回报价', 12), 8)) + kv('截止', ap['deadline']), 2, 6, extra='column-gap: 28px;')
    note = '<div style="display: flex; flex-direction: column; gap: 3px; background: #ffffff; border: 1px solid %s; border-radius: 6px; padding: 8px 10px;">%s%s</div>' % (
        T['warn_line'], text('说明：%s；报价 = 产品成本 $3.20 + 运费 $11.50。' % ap['filings'][0][2], 12, T['ink2']),
        text('批准后：在工厂工作台生成寄件任务，同时发起比例协商（建议工厂 100%）。报价不合理可「退回报价」（原因必填），本报备随之撤回。', 12, T['ink2']))
    foot = between(row(btn('催办', 'secondary', 'sm', 'bell') + nowrap('每小时最多 1 次 · 尚未催办', 12, T['ink3']), 8),
                   row(nowrap('含报备的审批单由客服主管审批', 12, T['ink4']) + btn('撤回并修改', 'secondary', 'sm', 'edit'), 10))
    return card(head + kvs + note + foot, pad='12px 16px', gap=10, tone='warning')


def p09_log():
    return log_card([
        ('08:02', '系统', '由工单 T-20260910-0201 创建售后单：滤芯发黄、吸力下降，排查两轮未解决（路径 A），待确认。'),
        ('08:20', '人工', '王磊确认：寄配件 · 产品质量问题（AI 建议）。良仓 US 库存 0 件 → 良仓无货。'),
        ('08:21', '自动', '在工厂工作台向东莞生产厂派发询价单：HEPA 滤芯组件 FC-V2-HF01 ×1 · 寄往美国，时限 2 个工作日。'),
        ('09:40', '工厂', '陈工提交报价：产品成本 $3.20、运费 $11.50（云途专线），可寄出日期 09-12。已写入登记台账。'),
        ('09:41', '系统', '发起报备 AP-20260911-003 · 快递费用 $11.50，审批人客服主管，已通知周敏（站内 + 企业即时通讯）。'),
    ], extra=link('查看审计日志', 12, 'chev_r'))


def reg_fields(kind):
    if kind == 'P09':
        return [('处理方式', '寄配件', 1), ('分支', '良仓无货', 1), ('责任类型', '产品质量问题', 1), ('配件', 'FC-V2-HF01', 1),
                ('数量', '1', 1), ('发货方', '东莞生产厂', 1), ('承运方式', '云途专线', 1), ('寄出日期', na('未到寄件环节'), 0),
                ('快递单号', na('未到寄件环节'), 0, True),
                ('产品成本', '$3.20', 1), ('运费', '$11.50', 1), ('额外赔偿', '$0.00', 1), ('其他费用', '$0.00', 1),
                ('报备', state('待审批'), 0), ('承担比例', na('建议 0 / 100'), 0), ('结算批次', na('比例确认后进入'), 0)]
    if kind == 'P10':
        return [('处理方式', '寄配件', 1), ('分支', '良仓有货', 1), ('责任类型', '产品质量问题', 1), ('配件', 'FC-V2-DC01', 1),
                ('数量', '1', 1), ('发货方', '良仓 US', 1), ('承运方式', 'UPS Ground', 1), ('寄出日期', '09-10', 1),
                ('快递单号', '1Z4R28830358229101', 1, True),
                ('产品成本', '$4.10', 1), ('运费', '$6.80', 1), ('额外赔偿', '$0.00', 1), ('其他费用', '$0.00', 1),
                ('报备', '快递费用 · 已批准', 1), ('承担比例', '0 / 100', 1), ('结算批次', '2026-09-B', 1)]
    return [('处理方式', '退款或部分补偿', 1), ('分支', na('不适用'), 1), ('责任类型', '物流问题', 1), ('配件', na('不适用'), 1),
            ('数量', na('不适用'), 1), ('发货方', na('不适用'), 1), ('承运方式', na('不适用'), 1), ('寄出日期', na('不适用'), 1),
            ('快递单号', na('不适用'), 1, True),
            ('产品成本', '$0.00', 1), ('运费', '$0.00', 1), ('额外赔偿', '$12.00', 1), ('其他费用', '$0.00', 1),
            ('报备', '额外赔偿 · 已批准', 1), ('承担比例', '100 / 0', 1), ('结算批次', na('不适用'), 1)]


def cust_card(rows):
    return card(''.join(kv(k, v) for k, v in rows), '客户与订单', link('查看客户档案', 12, 'chev_r'), pad='12px 14px', gap=7)


def p09(banner_html=None, steps=None):
    a = AS['S-20260911-0018']
    chips = state('进行中') + cat('寄配件 · 良仓无货') + cat('产品质量问题') + nowrap('责任已确认', 12, T['ok'], 600) + ch(a)
    meta = meta_line(['售后单 S-20260911-0018', '原工单 T-20260910-0201', '订单 111-2233445-5566778', '负责人 王磊', '创建 08:02'])
    actions = btn('查看原工单', 'secondary', 'md', 'external') + btn('改处理方式') + btn('终止流程', 'danger_outline')
    par = [('比例协商', state('未发起'), '报备通过后自动发起，建议工厂 100%'), ('内部结算', state('未定'), '比例确认后进入月度批次')]
    fac = card(comment('陈工', '陈', 'amber', '09:40', '滤芯有现货，报价已提交，批准后次日寄出。', '生产厂') +
               sys_comment('08:21', '已派发询价单，请 2 个工作日内报价。'),
               '工厂协同 · 东莞生产厂', link('打开沟通', 12, 'chev_r'), pad='12px 14px', gap=10)
    cust = cust_card([('客户', 'Laura Bennett'), ('订单', '111-2233445-5566778'), ('原工单', row(nowrap('T-20260910-0201', 12, T['ink'], 600) + state('等内部'), 6))])
    left = p09_filing() + p09_log()
    right = reg_card(reg_fields('P09')) + fac + cust
    return as_detail('wanglei', ['售后', '售后单', 'S-20260911-0018'], 'HEPA 滤芯组件补发 · Laura Bennett', chips, meta, actions,
                     steps or P09_STEPS, par, left, right, banner_html=banner_html)


# ================================================================ P10 售后单详情 · 良仓有货
P10_STEPS = [('确认', '09-10 09:20', 'done'), ('估算运费', '09-10 09:20', 'done'), ('报备审批', '09-10 09:40 周敏', 'done'), ('积加创建发货单', '09-10 09:41', 'done'),
             ('良仓发出', '09-10 14:30', 'done'), ('单号回复客户', '09-10 14:35', 'done'), ('完成', '09-10 14:35', 'done')]


def p10(banner_html=None, steps=None, status='已完成', par=None, left_extra=''):
    a = AS['S-20260910-0017']
    chips = state(status) + cat('寄配件 · 良仓有货') + cat('产品质量问题') + ch(a)
    meta = meta_line(['售后单 S-20260910-0017', '原工单 T-20260909-0163', '订单 113-2244668-8800997', '负责人 王磊', '创建 09-10 09:05'])
    actions = btn('查看原工单', 'secondary', 'md', 'external') + btn('在积加中打开发货单', 'secondary', 'md', 'external') + btn('重开协商', 'secondary', 'md', 'refresh')
    par = par or [('比例协商', state('已确认'), '陈工 09-10 17:10 接受工厂 100%'), ('内部结算', state('待结算'), '进入 10-05 生成的批次 2026-09-B · 批次生成前可重开协商（原因必填）')]
    filing = card(between(row(label('报备审批') + nowrap('AP-20260910-003', 12, T['ink2'], 600), 8), state('已批准')) +
                  grid(kv('报备类型', '快递费用') + kv('报备金额', '$6.80') + kv('审批人', '客服主管 周敏') + kv('批准', '09-10 09:40') +
                       kv('实际运费', '$6.80') + kv('超报备', '否（未超 10%）', 'success'), 3, 6, extra='column-gap: 28px;'),
                  pad='12px 16px', gap=10)
    log = log_card([
        ('09-10 09:05', '系统', '由工单 T-20260909-0163 创建售后单：集尘杯卡扣断裂，客户照片与已知缺陷一致（路径 A）。'),
        ('09-10 09:20', '人工', '王磊确认：寄配件 · 产品质量问题（AI 建议）。良仓 US 库存 8 件 → 良仓有货。'),
        ('09-10 09:20', '自动', '按积加费率估算运费 $6.80（UPS Ground），发起报备 AP-20260910-003 · 快递费用 $6.80。'),
        ('09-10 09:40', '人工', '周敏批准报备，视为发货动作已批准。'),
        ('09-10 09:41', '自动', '积加 MCP 创建售后发货单：良仓 US · 集尘杯 FC-V2-DC01 ×1；在工厂工作台发起比例提案（工厂 100%）。'),
        ('09-10 14:30', '良仓', '良仓发出 UPS 1Z4R28830358229101；积加回传实际运费 $6.80，未超报备。'),
        ('09-10 14:35', '人工', '李婷采用单号回复草稿 A 版发出，售后单完成。'),
        ('09-10 17:10', '工厂', '陈工接受工厂承担 100%，比例锁定。'),
        ('09-10 17:10', '系统', '结算状态转为待结算，将进入 10-05 生成的批次 2026-09-B。'),
    ], extra=link('查看审计日志', 12, 'chev_r'))
    fac = card(comment('陈工', '陈', 'amber', '09-10 17:10', '卡扣断裂属来料问题，接受工厂 100%。', '生产厂') +
               sys_comment('09-10 09:41', '已发起比例提案：建议工厂 100%，费用 $10.90。'),
               '工厂协同 · 东莞生产厂', link('打开沟通', 12, 'chev_r'), pad='12px 14px', gap=10)
    cust = cust_card([('客户', 'Marcus Lee'), ('订单', '113-2244668-8800997'), ('原工单', row(nowrap('T-20260909-0163', 12, T['ink'], 600) + state('已解决'), 6))])
    return as_detail('wanglei', ['售后', '售后单', 'S-20260910-0017'], '集尘杯补发 · Marcus Lee', chips, meta, actions,
                     steps or P10_STEPS, par, left_extra + filing + log, reg_card(reg_fields('P10')) + fac + cust,
                     par_right=link('查看协商', 12, 'chev_r'), banner_html=banner_html)


# ================================================================ P11 售后单详情 · 部分补偿
P11_STEPS = [('确认', '09-02 09:05 规则判定', 'done'), ('金额提案', '09-02 09:05', 'done'), ('报备审批', '09-02 10:10 周敏', 'done'),
             ('执行付款', '09-02 11:20 人工清单', 'done'), ('回复客户', '09-02 11:21', 'done'), ('完成', '09-02 11:21', 'done')]


def p11():
    a = AS['S-20260902-0011']
    chips = state('已完成') + cat('退款或部分补偿') + cat('物流问题') + ch(a)
    meta = meta_line(['售后单 S-20260902-0011', '原工单 T-20260901-0059', '订单 #1049', '发起人 陈晨', '负责人 王磊', '创建 09-02 09:05'])
    actions = btn('查看原工单', 'secondary', 'md', 'external') + btn('查看审批单', 'secondary', 'md', 'external')
    par = [('比例协商', state('不适用'), '物流问题，FSH 承担 100%'), ('内部结算', state('不适用'), ''), ('索赔', '', '索赔对象 USPS · 索赔中 · 王磊 09-02 提交')]
    steps_list = ['登录 Shopify 后台 forcome.com，打开订单 #1049。', '点击「退款」，只填退款金额 $12.00，不勾选退回商品。',
                  '退款原因填「物流延误补偿」，不通知客户（回复由系统发出）。', '提交后复制退款编号（回填为外部单号），截图退款成功页。']
    manual = card(
        between(row(label('人工操作清单') + nowrap('Shopify 后台部分退款 $12.00', 13, T['ink'], 700), 8), row(state('已回填') + nowrap('AP-20260902-004', 12, T['ink3']), 8)) +
        col(''.join(checkbox('%d. %s' % (i + 1, s), True) for i, s in enumerate(steps_list)), 7) +
        '<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)) 84px; gap: 12px; align-items: end; background: %s; border: 1px solid %s; border-radius: 8px; padding: 10px 12px;">%s%s%s%s%s</div>' % (
            T['subtle'], T['line'],
            stat('外部单号', 'RF-1049-01'), stat('回填金额', '$12.00', '与审批金额一致', 'success'), stat('执行人', '陈晨'), stat('回填时间', '09-02 11:20'),
            img_thumb('截图 1', 84, 52)),
        pad='12px 16px', gap=10, tone='success')
    log = log_card([
        ('09-02 09:05', '人工', '陈晨在工单 T-20260901-0059 提交审批，同时创建售后单（路径 B）：物流问题（规则：轨迹停滞满 5 天且超预计送达）。'),
        ('09-02 09:05', '系统', '金额提案 $12.00（延误超 7 天补偿运费全额），报备 AP-20260902-004 · 额外赔偿 $12.00。'),
        ('09-02 10:10', '人工', '周敏批准报备，视为退款动作已批准。'),
        ('09-02 10:10', '系统', '积加不支持 Shopify 退款，生成人工操作清单，指派陈晨，4 个工作小时内回填。'),
        ('09-02 11:20', '人工', '陈晨回填：外部单号 RF-1049-01、金额 $12.00、截图 1 张；金额与审批一致，动作成功。'),
        ('09-02 11:21', '自动', '绑定回复经 Gmail 以 support@forcome.com 发出，售后单完成。'),
        ('09-02 14:00', '人工', '王磊向 USPS 提交延误索赔，进行中。'),
    ], extra=link('查看审计日志', 12, 'chev_r'))
    reg = reg_card(reg_fields('P11'), extra=divider() + grid(kv('比例协商', state('不适用')) + kv('索赔对象', 'USPS') + kv('索赔状态', '索赔中', 'warning'), 3, 4, extra='column-gap: 20px;'))
    policy = card(row(cat('政策规则') + nowrap('延误补偿规则', 13, T['ink'], 700) + nowrap('forcome.com 覆盖', 12, T['ink3']), 8) +
                  text('延误超 7 天补偿运费全额。本单延误 9 天，补偿运费 $12.00。', 12, T['ink2']),
                  '政策依据', link('在知识库中查看', 12, 'chev_r'), pad='12px 14px', gap=8)
    cust = cust_card([('客户', 'Priya Raman'), ('订单', '#1049'), ('原工单', row(nowrap('T-20260901-0059', 12, T['ink'], 600) + state('已关闭'), 6))])
    return as_detail('wanglei', ['售后', '售后单', 'S-20260902-0011'], '延误运费补偿 · Priya Raman', chips, meta, actions,
                     P11_STEPS, par, manual + log, reg + policy + cust)


# ================================================================ P12 承担比例协商
def p12_form(err=False):
    if err:
        fsh = field('FSH 承担', input_box('60', suffix='%', st='error', mono=True), True)
        fac = field('工厂承担', input_box('30', suffix='%', st='error', mono=True), True)
        basis = field('商定依据', textarea_box('按五五分', '', 'error', 48, '4 / 200'), True, error='依据不少于 10 个字')
        sum_err = '<div style="display: flex; align-items: center; gap: 4px; font-size: 12px; color: %s;">%s两者之和须为 100（当前 90）</div>' % (T['bad'], icon('alert', 13, T['bad'], 2))
    else:
        fsh = field('FSH 承担', input_box(None, '0–100', suffix='%', mono=True), True)
        fac = field('工厂承担', input_box(None, '0–100', suffix='%', mono=True), True)
        basis = field('商定依据', textarea_box(None, '写明双方负责人商定的理由，例如检测结论、库存时长，不少于 10 个字', h=48, counter='0 / 200'), True)
        sum_err = ''
    ppl = field('商定人 · FSH 方', select_box('王磊（售后负责人）'), True) + field('商定人 · 生产厂方', select_box('刘厂长（生产厂负责人）'), True)
    body = grid(fsh + fac + ppl, 4, 12) + sum_err + basis + between(muted('比例为 0–100 的整数，两者之和须为 100。录入后比例锁定，售后单进入内部结算「待结算」。', 12), btn('录入最终比例', 'primary', 'md', 'check'))
    return card(body, '录入最终比例', nowrap('双方负责人商定后由售后负责人录入', 12, T['ink3']), pad='12px 16px', gap=10)


def p12_cards():
    a = AS['S-20260903-0012']
    big = lambda v, c: '<div style="font-size: 20px; font-weight: 700; color: %s; font-variant-numeric: tabular-nums;">%s</div>' % (c, v)
    fsh = card(between(row(label('FSH 提案') + chip('第 1 轮', 'neutral', 10), 6), nowrap('王磊 · 09-03 15:20', 12, T['ink3'])) +
               row(big('工厂 100%', T['ink']) + nowrap('FSH 0% · 费用 $23.40 = 产品 $9.80 + 运费 $13.60', 12, T['ink3']), 10, 'baseline') +
               text('依据：产品质量问题，电池在保修期内使用 2 周失效。', 12, T['ink2']), pad='12px 16px', gap=6)
    fac = card(between(row(label('生产厂答复') + chip('还价', 'warning', 10), 6), nowrap('陈工 · 09-05 10:30', 12, T['ink3'])) +
               row(big('工厂 50%', T['warn']) + nowrap('FSH 50% · 附电池批次照片 1 张', 12, T['ink3']), 10, 'baseline') +
               text('理由：电池出厂 9 个月，属库存老化，不完全是生产问题。', 12, T['ink2']), pad='12px 16px', gap=6, tone='warning')
    return grid(fsh + fac, 2, 12)


def p12_choice():
    return card(row(radio_card('接受 50 / 50', 'FSH 承担 $11.70，工厂承担 $11.70', disabled=True) +
                    radio_card('再次提案', '第 2 轮，最多 3 轮', disabled=True) +
                    radio_card('升级双方负责人', '09-09 已升级 · 王磊与刘厂长商定', True), 8, 'stretch'),
                '你的选择', row(icon('lock', 13, T['ink4']) + nowrap('已升级，前两项不可用；商定后在下方录入最终比例', 12, T['ink3']), 5), pad='12px 16px', gap=10)


def p12_thread():
    return card(sys_comment('09-03 15:20', '发起比例提案（第 1 轮）：产品质量问题，建议工厂 100%，费用 $23.40，3 个工作日内答复。') +
                comment('陈工', '陈', 'amber', '09-05 10:30', '这批电池 2025 年 12 月出厂，到客户手里放了 9 个月，属于库存老化，建议工厂 50%。附批次照片。', '生产厂') +
                comment('王磊', '磊', 'amber', '09-08 11:00', '电池在保修期内失效，老化检测应在出厂前完成。本周内无法达成就升级。', 'FSH') +
                sys_comment('09-09 09:00', '已升级双方负责人（王磊、刘厂长），协商状态转为待升级。'),
                '本单沟通 · 4 条', link('打开沟通', 12, 'chev_r'), pad='12px 16px', gap=10)


def p12(err=False):
    a = AS['S-20260903-0012']
    head = detail_head('承担比例协商 · Jonas Weber 电池', state('待升级') + cat('产品质量问题') + ch(a),
                       btn('查看售后单', 'secondary', 'md', 'external') + btn('查看原工单', 'secondary', 'md', 'external'),
                       meta_line(['售后单 S-20260903-0012', '寄配件 · 良仓无货', '第 1 轮', '已等 2 天（09-09 升级起）', '负责人 王磊']))
    info = card(kv('轮次', '1 / 3') + kv('协商状态', state('待升级')) + kv('发起提案', '09-03 15:20') + kv('生产厂还价', '09-05 10:30') +
                kv('升级', '09-09 09:00') + kv('争议金额', '$11.70', 'warning'), '协商信息', pad='12px 14px', gap=7)
    fee = card(kv('产品成本', '$9.80') + kv('运费', '$13.60') + kv('额外赔偿', '$0.00') + divider() + kv('费用合计', '$23.40') +
               kv('报备', '快递费用 $13.60 · 已批准') + kv('结算', state('未定')), '费用', pad='12px 14px', gap=7)
    ev = card(bullet('保修 12 个月内，客户使用 2 周失效') + bullet('客户视频 1 段 · 09-02') + bullet('电池批次照片 · 陈工 09-05') + bullet('快递单号 YT2625100012340921 · 云途 · 运输中（09-04 寄出）'),
              '证据', pad='12px 14px', gap=6)
    tip = banner('warning', '同一工单另有退款售后单', 'S-20260911-0020（额外赔偿 €44.90）报备审批中，将单独协商，不并入本单。')
    left = p12_cards() + p12_choice() + p12_form(err) + p12_thread()
    right = info + fee + ev + tip
    body = head + two_col(col(left, 12), col(right, 12), 340, 16, '14px 24px 16px 24px')
    return app('wanglei', '售后', ['售后', '待协商', 'S-20260903-0012'], body)


if __name__ == '__main__':
    save('AfterSalesList.dc.html', p07())
    save('AfterSalesConfirm.dc.html', p08())
    save('AfterSalesTicket.dc.html', p09())
    save('AfterSalesInStock.dc.html', p10())
    save('AfterSalesRefund.dc.html', p11())
    save('AfterSalesNegotiation.dc.html', p12())
    print('ok')
