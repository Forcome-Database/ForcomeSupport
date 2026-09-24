# -*- coding: utf-8 -*-
"""P07 售后单列表 · P08 确认责任与处理方式 · P09–P11 售后单详情 · P12 承担比例协商。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from data import *
from as_common import *
from data import _parts


# ================================================================ P07 售后单列表
def need_me(a):
    return a['status'] == '待确认' or a['nego'] == '待升级'


# 快捷筛选计数：各项独立计数，可重叠（S-20260903-0012 已完成且协商待升级，同时计入「需我处理」「待协商」与「已完成」）
QUICK = {
    '需我处理': sum(1 for a in AFTERSALES if need_me(a)),
    '等审批': sum(1 for a in AFTERSALES if a['step'].startswith('报备审批')),
    '等生产厂': sum(1 for a in AFTERSALES if a['waiting'].startswith('生产厂')),
    '待协商': N_NEGO,
    '待结算': N_SETTLE,
    '已完成': sum(1 for a in AFTERSALES if a['status'] == '已完成'),
}

# 排序：需我处理（待确认、待升级）→ 等审批 → 等生产厂 → 其余；组内按已等时长
P07_ORDER = ['S-20260911-0022', 'S-20260903-0012',
             'S-20260911-0020', 'S-20260911-0021', 'S-20260911-0018',
             'S-20260911-0019',
             'S-20260910-0017', 'S-20260908-0015', 'S-20260909-0016', 'S-20260905-0014', 'S-20260904-0013', 'S-20260902-0011', 'S-20260901-0010']
P07_SEL = ['S-20260911-0020', 'S-20260911-0021', 'S-20260911-0018']  # 画面：勾选了 3 张等审批的单，表头出现「批量催办」

# 「已等」颜色只按离时限远近：> 1 个工作日常规（ink2）· ≤ 1 个工作日黄 · 超时红（各单的离时限远近取 data.AS_WAIT_LEVEL）
WAIT_LEVEL = AS_WAIT_LEVEL


def waited_cell(a):
    w = a.get('waited')
    if not w:
        return na()
    c = {'warning': T['warn'], 'danger': T['bad']}.get(WAIT_LEVEL.get(a['no']), T['ink2'])
    if ' · ' in w:
        x, y = w.split(' · ', 1)
        return col(nowrap(x, 13, c, 600) + nowrap(y, 11, T['ink4']), 0)
    return nowrap(w, 13, c, 600)


def status_cell(a):
    s = state(a['status'])
    if a['nego'] == '待升级':
        return col(s + chip('协商待升级', 'warning', 11, 'alert'), 3, extra='align-items: flex-start;')
    return s


def owner_cell(a):
    """负责人 = 按店铺分配的售后负责人（弱化显示）；路径 B 的发起坐席在下方小字保留。"""
    if a.get('initiator'):
        return col(nowrap(a['owner'], 12, T['ink4']) + nowrap('%s发起' % a['initiator'], 11, T['ink4']), 0)
    return nowrap(a['owner'], 12, T['ink4'])


def p07_table(order=None, sel_nos=None):
    order = order or P07_ORDER
    sel_nos = P07_SEL if sel_nos is None else sel_nos
    head_box = '<div style="width: 16px; height: 16px; box-sizing: border-box; border-radius: 6px; background: %s; display: flex; align-items: center; justify-content: center;"><div style="width: 8px; height: 2px; background: #ffffff; border-radius: 2px;"></div></div>' % T['accent'] if sel_nos else checkbox('')
    cols = [(head_box, 'left'), ('售后单号', 'left'), ('客户', 'left'), ('渠道与店铺', 'left'), ('处理方式', 'left'), ('责任', 'left'), ('状态', 'left'),
            ('当前环节', 'left'), ('在等谁', 'left'), ('已等', 'left'), ('费用合计', 'right'), ('<span style="padding-left: 4px;">负责人</span>', 'left')]
    rows, tones = [], {}
    for i, no in enumerate(order):
        a = AS[no]
        cs, _ = fee_states(a)
        rows.append([
            checkbox('', no in sel_nos), nowrap(no, 13, T['ink'], 600), ellipsis(a['customer'], 13), ch(a), cat(a['method']), cat(a['resp']), status_cell(a),
            ellipsis(a['step'], 13, T['ink2']), ellipsis(a['waiting'], 13, T['ink2'] if a['waiting'] != '—' else T['ink4']),
            waited_cell(a), cur_cell(a, cs), '<div style="padding-left: 4px;">%s</div>' % owner_cell(a)])
        if need_me(a):
            tones[i] = 'warning'
    tpl = '16px 124px 100px 184px 100px 88px 88px minmax(0, 1fr) 112px 122px 84px 64px'
    t = table(cols, rows, tpl, row_tones=tones, py=6)
    if not sel_nos:
        return t
    # 表头操作条：勾选等审批的行时出现「批量催办」
    bar = '<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; background: %s; border: 1px solid %s; border-radius: 12px; padding: 6px 12px 6px 16px;">%s%s</div>' % (
        T['accent_bg'], T['accent_line'],
        row(nowrap('已选 %d 张 · 均在等审批' % len(sel_nos), 13, T['accent_ink'], 600) + btn('批量催办', 'secondary', 'sm', 'bell') +
            nowrap('向审批人周敏发钉钉工作通知 · 每张每小时最多 1 次', 12, T['ink3']), 10),
        row(btn('导出所选', 'ghost', 'sm', 'download') + link('取消选择', 12), 10))
    return col(bar + t, 8)


def p07_filters(active='全部 %d' % N_ALL, extra_chips=None):
    q = ['需我处理 %d' % QUICK['需我处理'], '等审批 %d' % QUICK['等审批'], '等生产厂 %d' % QUICK['等生产厂'], '待协商 %d' % QUICK['待协商'],
         '待结算 %d' % QUICK['待结算'], '已完成 %d' % QUICK['已完成'], '全部 %d' % N_ALL]
    chips = extra_chips if extra_chips is not None else (filter_chip('店铺', '全部') + filter_chip('处理方式') + filter_chip('责任') + filter_chip('创建时间', '近 30 天'))
    return between(row(seg(q, active) + divider(True, 20) + chips, 8),
                   row(icon('sort', 14, T['ink4']) + nowrap('需我处理在前，再按已等时长', 12, T['ink3']), 6))


def p07():
    actions = btn('导出', 'secondary', 'md', 'download') + btn('新建售后单', 'primary', 'md', 'plus')
    foot = pager('共 %d 条 · 「已等」按离时限远近着色：常规 · ≤ 1 个工作日黄 · 超时红 · 负责人按店铺分配，店铺筛选只选一个店铺时隐藏此列' % N_ALL)
    body = as_head('售后单', actions) + content(p07_filters() + p07_table() + foot, '14px 24px', 10)
    return app('wanglei', '售后', ['售后', '售后单'], body)


# ================================================================ P08 确认责任与处理方式
def p08_sections(err_resp=False, override=False, stock_fail=False):
    a = AS['S-20260911-0022']
    # 1 处理方式
    m_cards = row(radio_card('调整安装方式', '继续指导使用或安装，不寄东西') +
                  radio_card('寄配件', '含换新、整机补发', True, 'AI 建议') +
                  radio_card('退款或部分补偿', '金额不超过订单金额 %s' % ORDERS['114-7788990-2233441']['amount']), 8, 'stretch')
    inl = lambda k, c, req=False: row('<div style="font-size: 12px; font-weight: 600; color: %s; white-space: nowrap;">%s%s</div>' % (
        T['ink2'], k, '<span style="color: %s; margin-left: 2px;">*</span>' % T['bad'] if req else '') + c, 8, extra='min-width: 0px;')
    stock_n = INVENTORY[('FC-V2-CB01', '09-11 10:05')]
    m_more = '<div style="display: grid; grid-template-columns: minmax(0, 1.2fr) 150px minmax(0, 1fr); gap: 16px; align-items: center; background: %s; border: 1px solid %s; border-radius: 8px; padding: 8px 12px;">%s%s%s</div>' % (
        T['subtle'], T['line'],
        inl('配件', select_box('FC-V2-CB01 充电线'), True),
        inl('数量', input_box('1', suffix='件 · 1–10', mono=True), True),
        inl('发货方', input_box('手工选择分支后确定' if stock_fail else '易仓 US（有货 %d）' % stock_n, st='readonly', suffix=None if stock_fail else '按库存自动')))
    s1 = card(sec_head(1, '处理方式', True) + m_cards + m_more, pad='12px 16px', gap=10)

    # 2 责任类型：AI 建议保持预选并标「✦ AI 预选」，改选才要求理由
    sel = None if err_resp else ('其他' if override else '产品质量问题')
    r_cards = row(''.join(radio_card(t, ('默认' if t == '其他' else '') + ratio_words(RATIO_RULE[t]), sel == t, 'AI 预选' if t == '产品质量问题' else None)
                          for t in ('客户使用问题', '产品质量问题', '物流问题', '其他')), 8, 'stretch')
    if err_resp:
        r_cards = '<div style="border-radius: 8px; box-shadow: 0 0 0 1px %s;">%s</div>' % (T['bad_solid'], r_cards)
    basis = '<div style="display: flex; flex-direction: column; gap: 2px; background: %s; border: 1px solid %s; border-radius: 8px; padding: 8px 12px;">%s%s</div>' % (
        T['accent_bg'], T['accent_line'],
        row(ai_badge('AI 预选依据') + nowrap('置信度 %s' % AI_CONFIDENCE['S-20260911-0022'], 12, T['ink3']) + nowrap('· ' + AI_MADE['P08_preselect'], 12, T['ink4']), 8),
        grid(bullet('购买 23 天，在 12 个月保修期内') + bullet('近 30 天同配件 FC-V2-CB01 故障 1 起') + '<div style="grid-column: span 2;">%s</div>' % bullet('换用客户自己的 USB-C 线可以充电，原装线不行，视频已附'), 2, 0, extra='column-gap: 16px;'))
    extra2 = ''
    if err_resp:
        extra2 = '<div style="display: flex; align-items: center; gap: 4px; font-size: 12px; color: %s;">%s请选择责任类型</div>' % (T['bad'], icon('alert', 13, T['bad'], 2))
    if override:
        extra2 = field('改判理由', textarea_box(None, '与 AI 预选不同，请说明依据，例如客户照片、检测结论', 'error', 56, '0 / 200'), True, error='改选了 AI 预选以外的责任类型，请填写改判理由')
    s2 = card(sec_head(2, '责任类型', True, nowrap('已按 AI 建议预选；改选其他类型需填写理由', 12, T['ink3'])) + r_cards + extra2 + basis, pad='12px 16px', gap=10)

    # 3 库存与费用
    if stock_fail:
        stock = '<div style="display: flex; align-items: center; gap: 12px; background: %s; border: 1px solid %s; border-radius: 8px; padding: 10px 12px;">%s<div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 13px; font-weight: 700; color: %s;">库存查询失败</div><div style="font-size: 12px; color: %s;">积加接口超时（10:05，已自动重试 3 次）。可以重试，或手工选择分支后继续。</div></div>%s</div>' % (
            T['bad_bg'], T['bad_line'], icon('wifi_off', 18, T['bad'], 2), T['bad'], T['ink2'], btn('重试', 'secondary', 'sm', 'refresh'))
        stock += row(nowrap('手工选择分支', 12, T['ink2'], 600) + radio('易仓有货') + radio('易仓无货（向生产厂询价）') + nowrap('手工选择会记入审计日志', 12, T['ink4']), 16)
    else:
        stock = row(icon('store', 15, T['ink3']) + nowrap('易仓 US 库存 %d 件' % stock_n, 13, T['ink'], 600) + cat('易仓有货') + nowrap('积加 · 10:05 查询', 12, T['ink4']) + link('重新查询', 12, 'refresh'), 8)
    costs = grid(
        field('产品成本', input_box('1.40', prefix='$', suffix='SKU 成本表', st='readonly', mono=True)) +
        field('运费', input_box('5.90', prefix='$', suffix='易仓运费试算', st='readonly', mono=True)) +
        field('额外赔偿', input_box('0.00', prefix='$', mono=True)) +
        field('其他', input_box('0.00', prefix='$', mono=True)), 4, 12)
    ref = AS['S-20260905-0014']
    ratio_line = '<div style="display: flex; flex-direction: column; gap: 4px; border-top: 1px solid %s; padding-top: 10px;">%s%s</div>' % (
        T['line2'],
        between(row(nowrap('建议承担', 12, T['ink3']) + nowrap(share_words(a, 'FZJ'), 13, T['ink'], 600) + chip('待生产厂确认', 'accent', 11, dot=True), 8),
                row(nowrap('费用合计', 12, T['ink3']) + nowrap(money(total(a)), 14, T['ink'], 700), 8)),
        row(icon('history', 13, T['ink4']) + nowrap('同类参考', 12, T['ink4']) + link(ref['no'], 12) +
            nowrap('%s · 生产厂 FZJ 接受%s' % (ref['customer'], ratio_words(ref['ratios'])), 12, T['ink3']) + state(ref['settle']), 6))
    s3 = card(sec_head(3, '库存与费用') + stock + costs + ratio_line, pad='12px 16px', gap=10)
    return s1, s2, s3


def p08_footer():
    """确认后将发生 + 提交按钮；「退回继续排查」「取消售后单」并排在右侧，都要求填原因。"""
    nxt = row(nowrap('确认后将发生', 12, T['ink3'], 700) + flow_steps(['生成出库单参数', '报备快递费用 $5.90，交客服主管审批', '批准即经积加创建易仓出库单', '批准后向生产厂 FZJ 发起比例提案']), 12)
    bt = between(row(btn('确认并提交报备', 'primary', 'md', icon_right='arrow_r') + btn('暂存') + nowrap('上次暂存：无', 12, T['ink4']), 8),
                 row(nowrap('以下两项都需填写原因', 12, T['ink4']) + btn('退回继续排查', 'secondary', 'md', 'chev_l') + btn('取消售后单', 'danger_outline'), 8))
    return '<div style="display: flex; flex-direction: column; gap: 10px; background: #ffffff; border: 1px solid %s; border-radius: 12px; padding: 10px 16px; box-shadow: %s;">%s%s</div>' % (
        T['accent_line'], SHADOW_XS, nxt, bt)


def p08_right():
    a = AS['S-20260911-0022']
    o = ORDERS['114-7788990-2233441']
    rounds = card(
        row(icon('check_c', 14, T['ok']) + nowrap('排查树「充电线不充电排查」结论：充电线故障', 12, T['ok'], 600), 6) +
        kv('第 1 轮 · 09:30', '换插座、检查保险丝 → 还是不充电', bold=False) +
        kv('第 2 轮 · 09:50', '换 USB-C 线试充 → 自己的线可以充', bold=False) +
        '<div style="font-size: 12px; color: %s; line-height: 1.55; border-left: 2px solid %s; padding-left: 10px;">With my own USB-C cable it charges fine, so it must be the cable that came in the box.<div style="color: %s;">译文：用我自己的线就能充，应该是盒子里那根线的问题。</div></div>' % (T['ink2'], T['line_strong'], T['ink3']) +
        row(img_thumb('视频 0:18', 64, 40) + img_thumb('照片 1', 64, 40), 8) +
        kv('订单 114-7788990-2233441', '%s 购买 · %s · 保修内' % (o['date'], o['age']), bold=False),
        '排查记录与客户原话 · 2 轮', link('查看原工单', 12, 'external'), pad='12px 14px', gap=7)
    # 待确认单尚未报备：报备行写将发起的报备，与左栏「确认后将发生：报备快递费用」一致
    fil = row(nowrap('快递费用 %s' % money(a['freight']), 12, T['ink2']) + nowrap('· 确认后发起', 12, T['ink4']), 6)
    return fee_card(a, filing_override=fil) + rounds


def p08(err_resp=False, override=False, stock_fail=False):
    a = AS['S-20260911-0022']
    head = detail_head('确认责任与处理方式 · Ethan Brooks · 充电线不充电', state('待确认'),
                       btn('查看原工单', 'secondary', 'md', 'external'),
                       meta_line(['售后单 S-20260911-0022', ch(a), '来源工单 T-20260911-0035', '系统创建 10:05（排查两轮未解决）', '已等 15m']))
    s1, s2, s3 = p08_sections(err_resp, override, stock_fail)
    body = head + two_col(s1 + s2 + s3 + p08_footer(), p08_right(), 360, 16, '12px 24px 12px 24px')
    return app('wanglei', '售后', ['售后', '售后单', 'S-20260911-0022'], body)


# ================================================================ P09 售后单详情 · 易仓无货
P09_STEPS = [('确认', '08:20', 'done'), ('派发询价', '08:21', 'done'), ('生产厂报价', '09:40', 'done'),
             ('报备审批', '等周敏审批', 'current'), ('生产厂寄件', '', 'todo'), ('单号回复客户', '', 'todo'), ('完成', '', 'todo')]


def can(t):
    """blocker 里「你可以」的前缀。"""
    return nowrap('你可以', 11, T['ink4'])


def p09_blocker():
    return blocker('客服主管 周敏 审批报备 AP-20260911-003', left='3h 21m', since='39m',
                   can_do=can('') + btn('催办', 'secondary', 'sm', 'bell') + btn('撤回并修改', 'secondary', 'sm', 'edit'))


def p09_filing():
    ap = [x for x in APPROVALS if x['no'] == 'AP-20260911-003'][0]
    a = AS['S-20260911-0018']
    head = between(row(label('报备审批') + nowrap(ap['no'], 12, T['ink2'], 600) + state(ap['status']), 8),
                   row(nowrap('报价不合理？原因必填，将撤回本报备', 12, T['ink3']) + btn('退回报价', 'danger_outline', 'sm', 'chev_l'), 8))
    kvs = grid(stat('报备类型', '快递费用') + stat('金额', '$11.50') + stat('审批人', '客服主管 周敏') +
               stat('发起', '系统 · 09:41') + stat('截止', ap['deadline']) + stat('生产厂报价', '$14.70', '成本 $3.20 + 运费 $11.50'), 6, 12)
    note = text('批准后在工厂工作台生成寄件任务，并向生产厂 FQD 发起比例提案，建议 %s。' % share_words(a, 'FQD'), 12, T['ink2'])
    return card(head + kvs + note, pad='12px 16px', gap=8, tone='warning')


def p09_log():
    return log_card([
        ('08:02', '系统', '由工单 T-20260910-0201 创建售后单：滤芯发黄、吸力下降，排查两轮未解决（路径 A），待确认。'),
        ('08:20', '王磊', '确认：寄配件 · 产品质量问题（AI 预选）。易仓 US 库存 0 件 → 易仓无货。'),
        ('08:21', '系统', '在工厂工作台向生产厂 FQD 派发询价单：HEPA 滤芯组件 FC-V2-HF01 ×1 · 寄往美国，时限 2 个工作日。'),
        ('09:40', '陈工', '提交报价：产品成本 $3.20、运费 $11.50（云途专线），可寄出日期 09-14。已写入登记台账。'),
        ('09:41', '系统', '发起报备 AP-20260911-003 · 快递费用 $11.50，已通知周敏（站内 + 钉钉工作通知）。'),
    ], extra=link('查看审计日志', 12, 'chev_r'))


def reg_groups_for(kind):
    """登记信息分组（处理 / 物流 / 费用 / 结算）。st：1 已填、0 应填未填、None 未到环节（不计入进度）。"""
    later = lambda t='未到环节': na(t)
    if kind == 'P09':
        return [('处理', [('处理方式', '寄配件', 1), ('分支', '易仓无货', 1), ('责任类型', '产品质量问题', 1), ('配件 × 数量', 'FC-V2-HF01 × 1', 1), ('发货方', '生产厂 FQD', 1)]),
                ('物流', [('承运方式', '云途专线', 1), ('寄出日期', later(), None), ('快递单号', later(), None)]),
                ('费用', [('产品成本', '$3.20', 1), ('运费', '$11.50', 1), ('额外赔偿', '$0.00', 1), ('其他', '$0.00', 1)]),
                ('结算', [('报备', state('待审批'), 1), ('承担比例', later('报备通过后协商'), None), ('工厂承担', later('比例确认后'), None),
                          ('结算批次', later('比例确认后'), None)])]
    if kind == 'P10':
        a = AS['S-20260910-0017']
        return [('处理', [('处理方式', '寄配件', 1), ('分支', '易仓有货', 1), ('责任类型', '产品质量问题', 1), ('配件 × 数量', 'FC-V2-DC01 × 1', 1), ('发货方', '易仓 US', 1)]),
                ('物流', [('承运方式', 'UPS Ground', 1), ('寄出日期', '09-10', 1), ('快递单号', '1Z4R28830358229101', 1)]),
                ('费用', [('产品成本', '$4.10', 1), ('运费', '$6.80', 1), ('额外赔偿', '$0.00', 1), ('其他', '$0.00', 1)]),
                ('结算', [('报备', '快递费用 · 已批准', 1), ('承担比例', ratio_words(a['ratios']), 1), ('工厂承担', money(factory_share(a)), 1), ('结算批次', '2026-09-FQD-B', 1)])]
    # P11：9 项不适用折叠
    return [('处理', [('处理方式', '退款或部分补偿', 1), ('责任类型', '物流问题', 1), ('执行', 'Shopify 部分退款', 1)]),
            ('费用', [('产品成本', '$0.00', 1), ('运费', '$0.00', 1), ('额外赔偿', '$12.00', 1), ('其他', '$0.00', 1)]),
            ('结算与索赔', [('报备', '额外赔偿 · 已批准', 1), ('承担比例', ratio_words(R_FSH), 1), ('索赔对象', 'USPS', 1), ('索赔状态', chip('索赔中', 'warning'), 1)])]


def fac_card(body):
    return card(body, '工厂协同 · 生产厂 FQD', link('打开沟通', 12, 'chev_r'), pad='12px 14px', gap=10)


def p09(banner_html=None, steps=None):
    a = AS['S-20260911-0018']
    meta = meta_line(['售后单 S-20260911-0018', '寄配件 · 易仓无货', '产品质量问题', ch(a), '原工单 T-20260910-0201', '订单 111-2233445-5566778', '负责人 王磊'])
    actions = btn('查看原工单', 'secondary', 'md', 'external') + btn('改处理方式') + btn('终止流程', 'danger_outline')
    par = [('比例协商', state('未发起'), '报备通过后自动发起'), ('内部结算', state('未定'), '比例确认后进入月度批次')]
    left = p09_filing() + reg_groups(reg_groups_for('P09')) + p09_log()
    right = fee_card(a)
    return as_detail('wanglei', ['售后', '售后单', 'S-20260911-0018'], 'HEPA 滤芯组件补发 · Laura Bennett', state('进行中'), meta, actions,
                     steps or P09_STEPS, par, left, right, par_right=link('工厂协同 · 陈工 1 条留言', 12, 'chev_r'), banner_html=banner_html, blocker_html=p09_blocker())


# ================================================================ P10 售后单详情 · 易仓有货
P10_STEPS = [('确认', '09-10 09:20', 'done'), ('估算运费', '09-10 09:20', 'done'), ('报备审批', '09-10 09:40 周敏', 'done'), ('易仓创建出库单', '09-10 09:41', 'done'),
             ('易仓发出', '09-10 14:30', 'done'), ('单号回复客户', '09-10 14:35', 'done'), ('完成', '09-10 14:35', 'done')]


def p10(banner_html=None, steps=None, status='已完成', par=None, left_extra=''):
    a = AS['S-20260910-0017']
    meta = meta_line(['售后单 S-20260910-0017', '寄配件 · 易仓有货', '产品质量问题', ch(a), '原工单 T-20260909-0163', '订单 113-2244668-8800997', '负责人 王磊'])
    actions = btn('查看原工单', 'secondary', 'md', 'external') + btn('在积加查看出库单', 'secondary', 'md', 'external')
    reopen = row(btn('重开协商', 'secondary', 'sm', 'refresh') + nowrap('批次 10-05 生成前可用 · 原因必填', 11, T['ink4']), 6)
    par = par or [('比例协商', state('已确认'), row(nowrap('陈工 09-10 17:10 接受 ' + share_words(a, 'FQD'), 12, T['ink2']) + reopen, 10)),
                  ('内部结算', state('待结算'), '批次 2026-09-FQD-B · 10-05 生成')]
    blk = blocker('月度结算 · 批次 2026-09-FQD-B 于 10-05 自动生成', since='17h（比例 09-10 17:10 锁定）',
                  can_do=link('查看内部结算', 12, 'chev_r'))
    filing = card(between(row(label('报备审批') + nowrap(HISTORY_APPROVALS['S-20260910-0017'], 12, T['ink2'], 600) + state('已批准'), 8),
                          row(nowrap('快递费用 $6.80 · 周敏 09-10 09:40 批准 · 实际运费 $6.80', 12, T['ink2']) + nowrap('未超报备 10%', 12, T['ok'], 600), 8)),
                  pad='10px 16px', gap=8)
    log = log_card([
        ('09-10 09:05', '系统', '由工单 T-20260909-0163 创建售后单：集尘杯卡扣断裂，客户照片与已知缺陷一致（路径 A）。'),
        ('09-10 09:20', '王磊', '确认：寄配件 · 产品质量问题（AI 预选）。易仓 US 库存 %d 件 → 易仓有货；易仓运费试算 $6.80，发起报备。' % INVENTORY[('FC-V2-DC01', '09-10 09:20')]),
        ('09-10 09:40', '周敏', '批准报备 AP-20260910-003，视为出库动作已批准。'),
        ('09-10 09:41', '系统', '经积加创建易仓售后出库单：易仓 US · 集尘杯 FC-V2-DC01 ×1；向生产厂 FQD 发起比例提案。'),
        ('09-10 14:30', '易仓', '发出 UPS 1Z4R28830358229101；回传实际运费 $6.80，未超报备。'),
        ('09-10 14:35', '李婷', '采用单号回复草稿 A 版发出，售后单完成。'),
        ('09-10 17:10', '陈工', '接受承担比例 %s，比例锁定，转为待结算。' % share_words(a, 'FQD')),
    ], extra=link('查看全部与审计日志', 12, 'chev_r'))
    fee = fee_card(a, extra=nowrap('$4.10 + $6.80 = $10.90 → FQD 承担 → 批次 FQD-B', 11, T['ink2'], 600))
    return as_detail('wanglei', ['售后', '售后单', 'S-20260910-0017'], '集尘杯补发 · Marcus Lee', state(status), meta, actions,
                     steps or P10_STEPS, par, left_extra + filing + reg_groups(reg_groups_for('P10')) + log, fee,
                     par_right=link('工厂协同', 12, 'chev_r'), banner_html=banner_html, blocker_html=blk)


# ================================================================ P11 售后单详情 · 部分补偿
P11_STEPS = [('确认', '09-02 09:05 规则判定', 'done'), ('金额提案', '09-02 09:05', 'done'), ('报备审批', '09-02 10:10 周敏', 'done'),
             ('执行付款', '09-02 10:11 Shopify API', 'done'), ('回复客户', '09-02 10:11', 'done'), ('完成', '09-02 10:11', 'done')]


def p11():
    a = AS['S-20260902-0011']
    meta = meta_line(['售后单 S-20260902-0011', '退款或部分补偿', '物流问题', ch(a), '原工单 T-20260901-0059', '订单 #1049', '陈晨发起', '负责人 王磊'])
    actions = btn('查看原工单', 'secondary', 'md', 'external') + btn('查看审批单', 'secondary', 'md', 'external')
    claim = row(nowrap('USPS · 索赔中 · 王磊 09-02 提交', 12, T['ink2']) + btn('更新索赔结果', 'secondary', 'sm', 'edit') + nowrap('走补登，记入审计日志', 11, T['ink4']), 8)
    par = [('比例协商', state('不适用'), '物流问题 · FSH $12.00 · 工厂 $0.00'), ('内部结算', state('不适用'), ''), ('索赔', '', claim)]
    blk = blocker('USPS 延误索赔结果（王磊 09-02 提交）', since='9 天', why_not='售后单已完成，索赔结果回来后在并行条「更新索赔结果」')
    manual = card(
        between(row(label('执行付款') + nowrap('Shopify 部分退款 $12.00', 13, T['ink'], 600), 8), row(state('已执行') + nowrap(HISTORY_APPROVALS['S-20260902-0011'], 12, T['ink3']), 8)) +
        '<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; background: %s; border: 1px solid %s; border-radius: 8px; padding: 8px 12px;">%s%s%s%s</div>' % (
            T['subtle'], T['line'], stat('执行方式', 'Shopify Admin API'), stat('外部单号', ORDERS['#1049']['refund_no']), stat('金额', '$12.00 · 与审批一致', tone='success'), stat('执行时间', '09-02 10:11')),
        pad='12px 16px', gap=8, tone='success')
    log = log_card([
        ('09-02 09:05', '陈晨', '在工单 T-20260901-0059 提交审批，同时创建售后单（路径 B）：物流问题（规则：轨迹停滞满 5 天或超预计送达）。'),
        ('09-02 09:05', '系统', '金额提案 $12.00（延误超 7 天补偿运费全额），报备 AP-20260902-004 · 额外赔偿 $12.00。'),
        ('09-02 10:10', '周敏', '批准报备，视为退款动作已批准。'),
        ('09-02 10:11', '系统', 'Shopify Admin API 部分退款 $12.00 成功，外部单号 RF-1049-01；绑定回复经 Gmail 发出，售后单完成。'),
        ('09-02 14:00', '王磊', '向 USPS 提交延误索赔，进行中。'),
    ], extra=link('查看审计日志', 12, 'chev_r'))
    reg = reg_groups(reg_groups_for('P11'), cols=3, folded=(9, '分支、配件、数量、发货方、承运方式、寄出日期、快递单号、比例协商、结算批次 · 不计入进度'))
    policy = card(between(row(label('政策依据') + nowrap('延误补偿规则', 13, T['ink'], 700) + nowrap('forcome.com', 12, T['ink3']), 8), link('知识库', 12, 'chev_r')) +
                  text('延误超 7 天补偿运费全额。本单延误 9 天，补偿运费 $12.00。', 12, T['ink2']), pad='10px 14px', gap=4)
    return as_detail('wanglei', ['售后', '售后单', 'S-20260902-0011'], '延误运费补偿 · Priya Raman', state('已完成'), meta, actions,
                     P11_STEPS, par, manual + reg + log, fee_card(a) + policy, blocker_html=blk)


# ================================================================ P12 承担比例协商
P12_A = 'S-20260903-0012'


def ratio_inputs(vals, err_key=None):
    """三组费用各填「工厂承担 %」，下方实时显示 FSH / 工厂 的比例与金额。"""
    p = _parts(AS[P12_A])
    out = ''
    for lab, k in RATIO_PARTS:
        bad = err_key == k
        v = int(vals[k])
        hint = None if bad else 'FSH %d%% %s · 工厂 %d%% %s' % (100 - v, money(round(p[k] * (100 - v) / 100.0, 2)), v, money(round(p[k] * v / 100.0, 2)))
        out += field('%s %s · 工厂承担' % (lab, money(p[k])), input_box(str(v), suffix='%', st='error' if bad else 'default', mono=True), True,
                     error='比例为 0–100 的整数' if bad else None, hint=hint)
    return out


P12_AI_BASIS = NEGO_AI_BASIS[P12_A]


def p12_form(err=False):
    vals = {'product': '130' if err else '50', 'freight': '50', 'other': '50'}
    inputs = ratio_inputs(vals, 'product' if err else None)
    if err:
        basis = field('商定依据', textarea_box('按五五分', '', 'error', 44, '4 / 200'), True, error='依据不少于 10 个字')
        totals = nowrap('产品成本比例有误，合计暂不计算', 12, T['bad'])
    else:
        lbl = '商定依据 <span style="display: inline-flex; vertical-align: middle; margin: 0px 4px;">%s</span><span style="font-weight: 400; color: %s;">%s · 请核对后提交</span>' % (ai_badge('AI 草稿', 10), T['ink3'], AI_MADE['P12_basis'])
        basis = field(lbl, textarea_box(P12_AI_BASIS, '', 'default', 44, '%d / 200' % len(P12_AI_BASIS)), True)
        totals = row(nowrap('FSH 合计', 12, T['ink3']) + nowrap('$11.70', 13, T['ink'], 700) + nowrap('·', 12, T['ink4']) + nowrap('工厂合计', 12, T['ink3']) + nowrap('$11.70', 13, T['ink'], 700), 6)
    ppl = grid(field('商定人 · FSH 方', select_box('王磊（售后负责人）'), True) + field('商定人 · 生产厂方', select_box('刘厂长（生产厂负责人）'), True) + basis, 3, 12,
               template='minmax(0, 1fr) minmax(0, 1fr) minmax(0, 2fr)')
    foot = between(muted('0–100 的整数，FSH 自动补足 100 · 点「录入最终比例」先弹确认（S12），确认后比例锁定，售后单进入「待结算」', 12),
                   row(totals + btn('录入最终比例', 'primary', 'md', 'check'), 12))
    return card(grid(inputs, 3, 12) + ppl + foot, '录入最终比例', row(chip('已按生产厂还价预填', 'accent', 11) + nowrap('按费用项 · 双方负责人商定后录入', 12, T['ink3']), 8), pad='12px 16px', gap=10)


def p12_cards():
    a = AS[P12_A]
    big = lambda v, c: '<div style="font-size: 20px; font-weight: 700; color: %s; font-variant-numeric: tabular-nums; white-space: nowrap; line-height: 1.2;">%s</div>' % (c, v)
    fsh = card(between(row(label('FSH 提案') + chip('第 1 轮', 'neutral', 10), 6), nowrap('系统 · 09-03 15:20', 12, T['ink3'])) +
               row(big('工厂 100%', T['ink']) + nowrap(share_words(a), 12, T['ink3']), 10, 'baseline') +
               text('依据：产品质量问题，电池在保修期内、签收后不到一周失效。', 12, T['ink2']), pad='12px 16px', gap=6)
    fac = card(between(row(label('生产厂还价') + chip('还价', 'warning', 10), 6), nowrap('陈工 · 09-05 10:30', 12, T['ink3'])) +
               row(big('工厂 50%', T['warn']) + nowrap(share_words(a, parts=a['counter']), 12, T['ink3']), 10, 'baseline') +
               text('理由：电池出厂 9 个月，属库存老化，不完全是生产问题（附批次照片 1 张）。', 12, T['ink2']), pad='12px 16px', gap=6, tone='warning')
    return grid(fsh + fac, 2, 12)


def p12_compare():
    """费用项 × FSH 提案 / 工厂还价 / 差额（均为工厂承担金额）。"""
    a = AS[P12_A]
    p = _parts(a)
    rows = []
    for lab, k in RATIO_PARTS:
        x = round(p[k] * a['ratios'][k][1] / 100.0, 2)
        y = round(p[k] * a['counter'][k][1] / 100.0, 2)
        rows.append([nowrap(lab, 12, T['ink2']), money(p[k]), '%s <span style="font-size: 11px; color: %s;">%d%%</span>' % (money(x), T['ink4'], a['ratios'][k][1]),
                     '%s <span style="font-size: 11px; color: %s;">%d%%</span>' % (money(y), T['ink4'], a['counter'][k][1]),
                     nowrap(money(round(x - y, 2)), 13, T['warn'] if x != y else T['ink4'], 600)])
    t = table([('费用项', 'left'), ('金额', 'right'), ('FSH 提案 · 工厂承担', 'right'), ('工厂还价 · 工厂承担', 'right'), ('差额', 'right')], rows,
              'minmax(0, 1fr) 90px 150px 150px 90px', py=5, fs=13)
    return col(between(label('提案与还价对比'), row(nowrap('争议合计', 12, T['ink3']) + nowrap('$11.70', 13, T['warn'], 700), 6)) + t, 6)


def p12_choice():
    return '<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #ffffff; border: 1px solid %s; border-radius: 12px; padding: 9px 16px; box-shadow: %s;">%s%s</div>' % (
        T['line'], SHADOW_XS,
        row(label('你的选择') + radio('接受还价', disabled=True) + radio('再次提案（第 2 轮，最多 3 轮）', disabled=True) + radio('升级双方负责人 · 09-09 已升级', True), 18),
        row(icon('lock', 13, T['ink4']) + nowrap('已升级，前两项不可用', 12, T['ink3']), 5))


def p12_thread():
    """本单沟通折叠为一行：最新一条 + 展开。"""
    return '<div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #ffffff; border: 1px solid %s; border-radius: 12px; padding: 8px 16px; box-shadow: %s;">%s%s</div>' % (
        T['line'], SHADOW_XS,
        row(label('本单沟通 · 4 条') + actor_tag('系统') + nowrap('09-09 09:00', 12, T['ink4']) + ellipsis('已升级双方负责人（王磊、刘厂长），协商状态转为待升级。', 12, T['ink2']), 8, extra='min-width: 0px;'),
        link('展开全部', 12, 'chev_d'))


def p12_confirm_dialog():
    """S12 录入最终比例确认（不可逆，默认焦点在「取消」）。"""
    a = AS[P12_A]
    p = _parts(a)
    rows = []
    for lab, k in RATIO_PARTS:
        rows.append([nowrap(lab, 13, T['ink2']), money(p[k]), 'FSH 50%% %s' % money(p[k] / 2), '工厂 50%% %s' % money(p[k] / 2)])
    t = table([('费用项', 'left'), ('金额', 'right'), ('FSH', 'right'), ('工厂', 'right')], rows, 'minmax(0, 1fr) 72px 110px 110px', dense=True,
              footer=['合计', '$23.40', 'FSH $11.70', '工厂 $11.70'])
    body = t + grid(kv('商定人', '王磊 · 刘厂长（生产厂 FQD）') + kv('录入人', '王磊'), 2, 16) + \
        col(bullet('录入后比例锁定，售后单协商状态转为「已确认」、结算状态转为「待结算」，进入 10-05 生成的批次 2026-09-FQD-B。') +
            bullet('锁定后只能在批次生成前「重开协商」（原因必填）；批次生成后需在下一批次冲销。'), 4)
    return dialog('录入最终比例并锁定？', body, btn('取消', 'secondary', st='focus') + btn('确认录入并锁定', 'primary', 'md', 'lock'), 500, 'warning',
                  'S-20260903-0012 · 三组均 FSH 50 / 工厂 50 · 默认焦点在「取消」')


def p12(err=False):
    a = AS[P12_A]
    blk = blocker('你与刘厂长商定后录入最终比例', since='2 天（09-09 升级起）', level='warning',
                  can_do=can('') + btn('给刘厂长留言', 'secondary', 'sm', 'message'))
    head = detail_head('承担比例协商 · Mateo Rivas 电池', state('待升级'),
                       btn('查看售后单', 'secondary', 'md', 'external') + btn('查看原工单', 'secondary', 'md', 'external'),
                       meta_line(['售后单 S-20260903-0012', '寄配件 · 易仓无货', '产品质量问题', ch(a), '生产厂 FQD', '第 1 / 3 轮', '负责人 王磊']), blk)
    ev = card(bullet('保修 12 个月内，%s 签收后不到一周失效' % ORDERS['302-8811234-9901122']['delivered']) + bullet('客户视频 1 段 · 09-02；电池批次照片 · 陈工 09-05') +
              bullet('云途 YT2625100012340921 · 09-04 寄出，运输中'), '证据', pad='12px 14px', gap=5)
    tip = banner('warning', '同一工单另有退款售后单', 'S-20260911-0020（额外赔偿 %s）报备审批中，将单独协商，不并入本单。' % money_cur(889.00, 'MXN', 49.39))
    left = p12_cards() + p12_compare() + p12_choice() + p12_form(err) + p12_thread()
    right = fee_card(a) + ev + tip
    body = head + two_col(col(left, 10), col(right, 12), 340, 16, '12px 24px 16px 24px')
    return app('wanglei', '售后', ['售后', '售后单', 'S-20260903-0012'], body)


if __name__ == '__main__':
    save('AfterSalesList.dc.html', p07())
    save('AfterSalesConfirm.dc.html', p08())
    save('AfterSalesTicket.dc.html', p09())
    save('AfterSalesInStock.dc.html', p10())
    save('AfterSalesRefund.dc.html', p11())
    save('AfterSalesNegotiation.dc.html', p12())
    print('ok')
