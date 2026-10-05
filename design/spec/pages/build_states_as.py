# -*- coding: utf-8 -*-
"""StatesAfterSales · 售后状态板 S1–S16（S13–S15 为第一阶段台账，S16 为第二阶段的手工登记单）。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from data import *
from as_common import *
import build_aftersales as BA
import build_ledger as BL

W = 864  # 单个画面宽度（两列）
WIDE = W * 2 + 32 + 32  # 横跨两列的画面（S13–S15：两张 864 宽的小图并排 + 间距 + 内边距）


def detail_top(title, chips, meta, actions, steps, par, banner_html=None, extra='', blocker_html=None):
    """售后单详情顶部（标题 + 状态徽标、元信息行 + 当前卡点 + 步骤条 + 并行条 + 横幅），1:1 局部画面。"""
    below = (blocker_html or '') + '<div style="padding-top: 2px;">%s</div>' % stepper(steps) + parallel_bar(par)
    head = detail_head(title, chips, actions, meta, col(below, 10))
    bn = '<div style="padding: 12px 20px 0px 20px;">%s</div>' % banner_html if banner_html else ''
    ex = '<div style="padding: 12px 20px 16px 20px;">%s</div>' % extra if extra else '<div style="height: 16px;"></div>'
    return '<div style="width: %dpx; box-sizing: border-box; background: %s; display: flex; flex-direction: column;">%s%s%s</div>' % (W, T['canvas'], head, bn, ex)


# ---------------------------------------------------------------- S1 责任类型 AI 预选与改判
def s1():
    _, s2_def, _ = BA.p08_sections()
    _, s2_ovr, _ = BA.p08_sections(override=True)
    foot = between(muted('提交时校验全部必填项，并滚动到第一个错误。', 12), btn('确认并提交报备', 'primary', 'md', icon_right='arrow_r'))
    return frame(cap('默认 · 已按 AI 建议预选（✦ AI 预选），不改选无需理由') + s2_def + cap('改判为「其他」但未填理由') + s2_ovr + foot)


# ---------------------------------------------------------------- S2 库存查询失败
def s2():
    _, _, s3 = BA.p08_sections(stock_fail=True)
    return frame(s3)


# ---------------------------------------------------------------- S3 报备被驳回
def s3():
    steps = [('确认', '08:20', 'done'), ('派发询价', '08:21', 'done'), ('生产厂报价', '09:40', 'done'), ('报备审批', '驳回 10:52 · 待重新提交', 'error'),
             ('生产厂寄件', '', 'todo'), ('单号回复客户', '', 'todo'), ('完成', '', 'todo')]
    bn = banner('danger', '报备已被驳回 · 客服主管周敏 10:52',
                '驳回原因：运费高于同线路均价 30%，请生产厂改走云途普货后重新报价。这是系统发起的报备，售后单保持进行中，当前环节「报备审批 · 待重新提交」；寄件任务未生成。',
                row(btn('退回生产厂报价', 'primary', 'sm') + btn('修改金额后重新提交', 'secondary', 'sm') + btn('查看审批单', 'ghost', 'sm'), 6))
    extra = card(log_row('10:52', '周敏', '驳回 AP-20260911-003（快递费用 $11.50），原因已通知王磊。') +
                 log_row('10:52', '系统', '当前环节改为「报备审批 · 待重新提交」；生产厂 FQD 的报价保留，可退回陈工改承运方式后重新报价。'), '执行记录', pad='12px 16px', gap=8)
    a = AS['S-20260911-0018']
    blk = blocker('你：退回生产厂报价，或修改金额后重新提交', since='刚刚（10:52 驳回）', level='danger',
                  why_not='催办、撤回不可用：报备已被驳回')
    return detail_top('HEPA 滤芯组件补发 · Laura Bennett', state('进行中'),
                      meta_line(['售后单 S-20260911-0018', '寄配件 · 易仓无货', '产品质量问题', ch(a)]),
                      btn('查看原工单', 'secondary', 'md', 'external') + btn('终止流程', 'danger_outline'), steps,
                      [('比例协商', state('未发起'), '报备通过后自动发起'), ('内部结算', state('未定'), '')], bn, extra, blk)


# ---------------------------------------------------------------- S4 库存用尽自动切换
def s4():
    # R-AS-04 两步（D-23 ⑥）：先在积加取消原补单（人工操作清单），确认取消后才切易仓无货，防止缺货解除后重复寄件
    steps = [('确认', '09:35', 'done'), ('易仓创建出库单', '积加回传缺货 10:52', 'error'), ('取消原补单', '李婷 10:58 确认', 'done'), ('派发询价', '10:58', 'current'),
             ('生产厂报价', '', 'todo'), ('报备审批', '', 'todo'), ('生产厂寄件', '', 'todo'), ('单号回复客户', '', 'todo')]
    bn = banner('warning', '易仓缺货：已取消原补单，切到易仓无货',
                '① 10:52 积加回传易仓 US「车载吸尘器 V2 黑色（整机）」缺货，先生成人工操作清单「在积加取消原补单」，当前环节「易仓发货 · 等确认取消原补单」；② 李婷 10:58 确认已取消后，原报备 AP-20260911-002（快递费用 $8.40）作废，已向生产厂 FQD 派发询价，报价后按新金额重新报备。已通知王磊。',
                btn('查看询价单', 'secondary', 'sm'))
    extra = card(log_row('10:51', '周敏', '批准 AP-20260911-002。') +
                 log_row('10:52', '系统', '积加回传易仓 US 整机黑色缺货，推单未完成；生成人工操作清单「在积加取消原补单」，指派李婷（4 个工作小时内）。') +
                 log_row('10:58', '李婷', '回填：已在积加取消原补单。') +
                 log_row('10:58', '系统', '切换为易仓无货，原报备作废；在工厂工作台派发询价：整机黑色 ×1 · 寄往美国。'), '执行记录', pad='12px 16px', gap=8)
    a = AS['S-20260911-0021']
    blk = blocker('生产厂 FQD 报价（10:52 派发询价）', left='2 个工作日', level='normal',
                  why_not='派发满 1 小时后才能催办', can_do=btn('催办', 'secondary', 'sm', 'bell', disabled=True, reason='派发满 1 小时后才能催办（11:52 起）'))
    return detail_top('整机换发 · Marcus Lee', state('进行中'),
                      meta_line(['售后单 S-20260911-0021', '寄配件 · 易仓无货', '物流问题', ch(a)]),
                      btn('查看原工单', 'secondary', 'md', 'external') + btn('改处理方式'), steps,
                      [('比例协商', state('不适用'), '物流问题，向易仓索赔'), ('内部结算', state('不适用'), '')], bn, extra, blk)


# ---------------------------------------------------------------- S5 生产厂超时
def s5():
    base = [('确认', '08:49', 'done'), ('派发询价', '08:50', 'done')]
    tail = [('报备审批', '', 'todo'), ('生产厂寄件', '', 'todo'), ('单号回复客户', '', 'todo'), ('完成', '', 'todo')]
    title = row(nowrap('S-20260911-0019 · 软管 ×2 · Diego Salazar', 13, T['ink'], 700) + state('进行中'), 8)
    a = card(title +
             blocker('生产厂 FQD 报价 · 已自动催办 1 次', left='已超时限', since='2 个工作日', level='warning',
                     can_do=btn('催办', 'secondary', 'sm', 'bell', disabled=True, reason='已催办，每小时最多 1 次（10:00 后可再催）') + btn('给陈工留言', 'secondary', 'sm', 'message')) +
             stepper(base + [('生产厂报价', '已催 1 次 · 已超时限', 'current')] + tail) +
             muted('09-15 09:00 超过 2 个工作日，已自动催办 1 次（钉钉工作通知）。再过 2 个工作日（09-17 周四 09:00）仍未报价标为卡住。', 12),
             pad='12px 16px', gap=12)
    b = card(title +
             blocker('生产厂 FQD 报价 · 卡住，已通知你', left='超时 2 个工作日', since='4 个工作日', level='danger',
                     can_do=btn('给陈工留言', 'secondary', 'sm', 'message') + btn('改处理方式', 'secondary', 'sm')) +
             stepper(base + [('生产厂报价', '卡住 · 超时 2 个工作日', 'error')] + tail) +
             muted('已催办 1 次仍未报价。建议电话跟进陈工，或改处理方式。', 12),
             pad='12px 16px', gap=12, tone='danger')
    return frame(cap('已催 1 次') + a + cap('卡住') + b)


# ---------------------------------------------------------------- S6 终止流程
def s6():
    keep = col(nowrap('取消后保留的已产生费用（默认全部保留，取消勾选的不计入售后成本，R-AS-08）', 12, T['ink2'], 600) +
               checkbox('产品成本 $3.20（生产厂 FQD 报价）', True) + checkbox('运费 $11.50（报备待审批，终止后撤回）', True), 6)
    body = field('终止原因', textarea_box(None, '例如：客户撤回售后申请、改为退款处理', 'error', 64, '0 / 200'), True, error='请填写终止原因') + keep + \
        col(bullet('售后单变为「已取消」，不可恢复；保留的费用照常计入售后成本。') +
            bullet('待审批的报备 AP-20260911-003 自动撤回，生产厂 FQD 的任务自动取消并通知陈工。') +
            bullet('关联工单 T-20260910-0201 不会自动回复客户，请在工单中说明。'), 4)
    dlg = dialog('终止售后单 S-20260911-0018？', body, btn('取消', 'secondary', st='focus') + btn('终止流程', 'danger'), 460, 'danger', '终止后流程停止，无法恢复 · 默认焦点在「取消」')
    return overlay(scaled(BA.p09(), 1440, 900, 0.6), dlg, W, 540)


# ---------------------------------------------------------------- S7 客户改地址
def s7():
    t = [x for x in TICKETS if x['no'] == 'T-20260910-0201'][0]
    ap = AS['S-20260911-0018']['approval']
    a = banner('info', '客户更新了收货地址，已写入售后单',
               '%s 来自工单 %s 的来信。%s → %s。寄件任务尚未生成（报备 %s 待审批），生成时直接使用新地址。' % (
                   t['last_in'], t['no'], ORDERS['111-2233445-5566778']['address'], ORDERS['111-2233445-5566778']['address_new'], ap),
               link('查看变更记录', 12))
    b = card(banner('warning', '包裹已寄出后客户要求改地址', '云途 %s 已于 09-14 寄出。新地址：%s。请选择处理方式。' % (ORDERS['111-2233445-5566778']['tracking'], ORDERS['111-2233445-5566778']['address_new'])) +
             row(radio_card('联系承运商改派', '王磊联系云途改派；改派费发起快递费用报备，批准后计入运费', True) +
                 radio_card('按新地址补发', '重新寄出 1 件，需新的快递费用报备'), 8, 'stretch') +
             between(muted('选择后记入执行记录，并通知工单负责人李婷。', 12), btn('确认处理方式', 'primary', 'sm')), pad='12px 16px', gap=10)
    return frame(cap('寄出前 · 自动更新') + a + cap('寄出后 · 售后负责人选择') + b)


# ---------------------------------------------------------------- S8 录入最终比例校验
def s8():
    return frame(BA.p12_form(err=True))


# ---------------------------------------------------------------- S9 生成结算批次
def s9():
    rows = []
    for no in ['S-20260908-0015', 'S-20260910-0017']:
        a = AS[no]
        rows.append(['<div title="%s">%s</div>' % (ratio_words(a['ratios']), nowrap(no, 13, T['ink'], 600)), a['customer'], money(fsh_share(a)), money(factory_share(a))])
    t = table([('售后单号', 'left'), ('客户', 'left'), ('FSH 承担', 'right'), ('工厂承担', 'right')], rows, '130px minmax(0, 1fr) 80px 80px', dense=True,
              footer=['合计 2 单', '', money(round(sum(fsh_share(AS[x]) for x in ['S-20260908-0015', 'S-20260910-0017']), 2)), money(BL.LT['pending'])])
    body = t + col(bullet('提前批次只收当前比例已确认的售后单；比例未定的 4 单（≈ %s）不进入本批次，确认后进入当月月末批次。' % money(BL.LT['undecided'])) +
                   bullet('生成后批次为「待确认」，推送陈工确认；双方确认后转为已结算。') +
                   bullet('<b>不可撤销</b>：批次生成后其中售后单的比例不能再改，需调整时在下一批次冲销。'), 4)
    dlg = dialog('提前生成批次 2026-09-FQD-B？', body, btn('取消', 'secondary', st='focus') + btn('生成并推送生产厂', 'primary', 'md', 'send'), 540, 'warning',
                 '生产厂 FQD · 原定 %s自动生成 · 生成后不可撤销，默认焦点在「取消」' % BATCH_PLAN_WORDS)
    return overlay(scaled(BL.p14(), 1440, 900, 0.6), dlg, W, 540)


# ---------------------------------------------------------------- S10 列表为空
def s10():
    q = ['需我处理 0', '等审批 0', '等生产厂 0', '待协商 0', '待结算 0', '已完成 0', '全部 0']
    fl = row(seg(q, '全部 0') + filter_chip('店铺', 'forcome.mx', True) + filter_chip('责任', '其他', True) + link('清除筛选', 12), 8)
    head = '<div style="display: grid; grid-template-columns: 124px 100px 1fr 90px 90px 90px; gap: 12px; padding: 9px 16px; background: %s; border-bottom: 1px solid %s; font-size: 11px; font-weight: 700; color: %s;">%s</div>' % (
        T['subtle'], T['line'], T['ink3'], ''.join('<div>%s</div>' % c for c in ['售后单号', '客户', '渠道与店铺', '处理方式', '责任', '状态']))
    box = '<div style="background: #ffffff; border: 1px solid %s; border-radius: 8px; overflow: hidden; box-shadow: %s;">%s%s</div>' % (
        T['line'], SHADOW_XS, head, empty('search', '没有符合条件的售后单', '当前筛选：店铺 forcome.mx · 责任 其他。换个条件试试，或清除筛选查看全部 13 张。', btn('清除筛选', 'secondary', 'md', 'x')))
    return frame(fl + box)


# ---------------------------------------------------------------- S12 录入最终比例确认
def s12():
    return overlay(scaled(BA.p12(), 1440, 900, 0.6), BA.p12_confirm_dialog(), W, 540)


# ---------------------------------------------------------------- S11 导出
def s11():
    prog = '<div style="width: 360px; box-sizing: border-box; display: flex; gap: 10px; align-items: flex-start; background: #ffffff; border: 1px solid %s; border-radius: 8px; padding: 12px 14px; box-shadow: %s;">%s<div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 6px;"><div style="font-size: 13px; font-weight: 700; color: %s;">正在导出登记台账</div><div style="font-size: 12px; color: %s;">12 单 · 按当前筛选（2026-09-01 至 09-11）· 62%%</div>%s</div></div>' % (
        T['line'], SHADOW_MD, spinner(18), T['ink'], T['ink3'], progress(62))
    left = col(cap('生成中') + row(btn('列设置', 'secondary', 'md', 'sort') + btn('导出中', 'secondary', 'md', loading=True), 8) + muted('服务端按当前筛选与字段权限同步生成，约 3 秒（同 K5）', 12), 12)
    done = toast('success', '登记台账已导出', '登记台账_20260901-20260911.xlsx · 12 单，浏览器已开始下载 · 已记入审计日志。')
    right = col(cap('完成') + row(btn('列设置', 'secondary', 'md', 'sort') + btn('导出 Excel', 'secondary', 'md', 'download'), 8) + done, 12)
    return frame(grid(left + right, 2, 24))


# ================================================================ 第一阶段台账（S13–S15，prd_c P13「第一阶段」、prd_b 6.5「第一阶段台账状态」、R-AS-08）
def over_page(dlg_or_drw, h, s=0.6, drawer_=True, w=W):
    """第一阶段 P13 缩小作底，叠抽屉（贴右）或弹窗（居中）；底图页面高度按画面高度反推，避免裁切。"""
    ph = int(h / s)
    bg = scaled(BL.p13_p1(h=ph), 1440, ph, s)
    return BL.drawer_over(bg, dlg_or_drw, w, h) if drawer_ else overlay(bg, dlg_or_drw, w, h)


# ---------------------------------------------------------------- S13 第一阶段登记台账
def s13():
    a = col(cap('售后负责人 王磊 · 第一阶段外壳（导航 工单 · 售后 · 报表，不显示店铺范围与搜索）') + scaled(BL.p13_p1(), 1440, 900, 0.6), 8)
    b = col(cap('坐席 李婷 · 只读：不显示金额七列与合计行，没有「新建登记」「更多」与补登') + scaled(BL.p13_p1('liting'), 1440, 900, 0.6), 8)
    return frame(grid(a + b, 2, 32), WIDE)


# ---------------------------------------------------------------- S14 新建登记与编辑登记
def s14():
    left = col(cap('新建登记 · 寄配件（%s · %s）' % (LEDGER_NEW_DEMO['customer'], LEDGER_NEW_DEMO['store'])) + over_page(BL.reg_drawer(), 1030), 8)
    right = col(cap('保存时校验 · 改为退款或部分补偿、责任「其他」') + over_page(BL.reg_drawer(True), 910) +
                cap('编辑登记 · 进行中的单，比索金额显示折算与汇率日期') + over_page(BL.edit_drawer(), 460, 0.444), 8)
    return col(frame(grid(left + right, 2, 32, extra='align-items: start;'), WIDE) + s14_more() + s14_rates(), 0)


def s14_more():
    """S14 的补充小样（第一阶段实现时确认，10-05）：物流问题的索赔字段、负责人旁的灰字与未选店铺、必填项为空、查库的报错、保存与查询的结果浮层、新建时的未保存离开。"""
    claim = grid(BL.span(field('责任类型', select_box('物流问题'), True)) + BL.span('') +
                 BL.span(field('索赔对象', select_box(), True)) + BL.span(field('索赔状态', select_box(), True)), 4, 10)
    owners = col(field(BL.lbl_note('负责人', '已默认为你本人'), select_box('王磊（售后负责人）')) +
                 field(BL.lbl_note('负责人', '只列有该店铺数据范围的售后负责人'), select_box()) +
                 row(field(BL.lbl_note('负责人', ''), select_box(st='disabled'), extra='flex: 1;') + tooltip('先选店铺'), 10, 'flex-end'), 10)
    required = col(''.join(row(icon('alert', 13, T['bad'], 2) + nowrap(t, 12, T['bad']), 4) for t in (
        '请选择处理方式', '请选择店铺', '请选择站点', '请填写订单号', '请填写客户', '请选择费用发生日', '请选择负责人', '请选择责任类型', '请选择生产厂')), 6)
    checked = grid(field('负责人', select_box('赵敏（售后负责人）', st='error'), True, error='只能选有该店铺数据范围的售后负责人') +
                   field(BL.lbl_note('来源工单', '可不填', False), input_box('T-20990101-0001', st='error', mono=True), error='没有这张工单，或不在你的店铺范围内') +
                   field(BL.lbl_note('来源工单', '可不填', False), input_box('T-20260911-0031', st='error', mono=True), error='来源工单属于 forcome.com，与所选店铺不一致') +
                   field('数量', input_box('12', st='error', suffix='件 · 1–10', mono=True), True, error='数量为 1–10 的整数') +
                   field('产品成本', input_box('3.205', st='error', mono=True), True, error='金额不能为负数，最多两位小数'), 2, 12, extra='align-items: start;')
    ok = toast('success', '登记已保存', 'S-20260911-0023 · Olivia Turner，状态「进行中」，已记入审计日志。')
    fail = toast('error', '保存失败：网络不可用', '填写的内容已保留在抽屉里。', link('立即重试', 12))
    lookup = toast('error', '查询失败：网络不可用', None, link('立即重试', 12))
    leave = dialog('离开前保存修改？', muted('「新建登记」填写的内容还没保存，放弃后不保留。', 13),
                   btn('继续编辑', 'secondary', st='focus') + btn('放弃修改', 'danger_outline') + btn('保存并离开', 'primary'), 460, 'warning')
    # 两列，每列按抽屉宽 640 画（字段与抽屉里的一样宽）
    width = lambda html: '<div style="width: 640px; display: flex; flex-direction: column; gap: 10px;">%s</div>' % html
    left = width(cap('责任为「物流问题」· 索赔对象（承运商 / 易仓）与索赔状态（待发起 / 索赔中 / 已赔付 / 已拒赔）；三组均 FSH 100，生产厂不显示') + claim +
                 cap('负责人旁的灰字：登记人是售后负责人且还有别人 · 有几位要选 · 还没选店铺（下拉不可用，悬停说明）') + owners +
                 cap('必填项为空（保存时校验全部；寄件一节、四项费用、索赔进行中可后填）') + required)
    right = width(cap('要查库的报错：负责人不合格、来源工单不存在或店铺不一致；数量与金额的格式') + checked +
                  cap('保存与查询的结果') + col(ok + fail + lookup, 10) +
                  cap('新建登记时有未保存的输入就关闭（G8）') + leave)
    return frame(cap('S14 补充小样（第一阶段实现时确认，10-05）') + grid(left + right, 2, 32, extra='align-items: start;'), WIDE, gap=10)


# 汇率（第一阶段实现时确认，10-05，待办 20；R-FL-06、E-20）
NO_RATE = '费用发生日及之前没有汇率，暂时不能折算美元'
RATE_TITLE_ECB = '汇率取费用发生日的欧洲央行日汇率；售后负责人可修改并记审计'
RATE_TITLE_MANUAL = '汇率为手工修改：1 USD = 17.50 MXN（售后负责人修改，已记入审计日志）'


def amount_cell(usd, line):
    """P13 的金额单元格（同 build_ledger.p1_comp）：美元 + 下方原币与汇率日期，画成一个单元格大小的卡片。"""
    return ('<div style="width: 168px; box-sizing: border-box; background: #ffffff; border: 1px solid %s; border-radius: 8px; padding: 8px 12px; '
            'display: flex; flex-direction: column; align-items: flex-end; gap: 0px;">%s%s</div>') % (
        T['line'], nowrap(money(usd), 13, T['ink']), nowrap(line, 11, T['ink4']))


def s14_rates():
    """S14 的补充小样之二（第一阶段实现时确认，10-05，待办 20）：非美元金额的即时折算、费用发生日及之前没有汇率、P13 金额悬停说明按汇率来源区分、修改汇率的口径。"""
    width = lambda html: '<div style="width: 640px; display: flex; flex-direction: column; gap: 10px;">%s</div>' % html
    peso = lambda **kw: BL.money_field('额外赔偿', '889.00', 'MXN', **kw)
    left = width(cap('非美元金额 · 金额框下即时显示折算美元与汇率日期；费用发生日当天没有汇率时取此前最近一个有汇率的日期（E-20）') +
                 grid(peso(hint='≈ $49.39 · 汇率 09-10（1 USD = 18.00 MXN）'), 2, 10) +
                 cap('费用发生日及之前都没有汇率（系统刚部署、首次同步还没完成，或日期早于 1999 年）· 保存前：金额框下写说明，比例表与费用合计写「—」') +
                 grid(peso(hint=NO_RATE), 2, 10) +
                 cap('保存时报在该金额下方，不保存') + grid(peso(st='error', error=NO_RATE), 2, 10))
    right = width(cap('P13 金额单元格的悬停说明按汇率来源区分：欧洲央行（备用源 Frankfurter 的数据同样来自欧洲央行）· 手工修改') +
                  row(amount_cell(49.39, 'MX$889.00 · 汇率 09-10') + tooltip(RATE_TITLE_ECB), 12, 'center') +
                  row(amount_cell(50.80, 'MX$889.00 · 汇率 09-10') + tooltip(RATE_TITLE_MANUAL), 12, 'center') +
                  cap('修改汇率（只有售后负责人，PRD 10.1）') +
                  muted('对某个非美元费用项填新汇率（1 USD = x 原币）：冻结美元值按新汇率重算并四舍五入到分；汇率日期为该单的费用发生日，来源记「手工修改」；'
                        '进行中与已完成的单可改，已取消的只读；修改记入审计日志。入口在编辑登记抽屉费用一节下方的「修改汇率」。', 12))
    return frame(cap('S14 补充小样之二 · 汇率（第一阶段实现时确认，10-05）') + grid(left + right, 2, 32, extra='align-items: start;'), WIDE, gap=10)


# ---------------------------------------------------------------- S15 设为已完成、取消与补登
def s15():
    after_bf, c_bf = BL.s15_backfill_after()
    one = col(cap('① 设为已完成 · 点行尾「更多」') + BL.s15_done_before() +
              cap('点「设为已完成」后 · 直接执行，5 秒内可撤销') + BL.s15_done_after() +
              row(muted('不要求登记齐全；完成时间记 %s，计入 9 月完整率分母。页头完整率随之更新：' % NOW[-5:], 12) + BL.s15_done_completion(), 10, wrap=True), 10)
    three = col(cap('③ 补登 · 点已完成单的「待回填」单元格行内编辑（只有售后负责人）') + BL.s15_backfill_before() +
                cap('保存后 · 「缺 1 项」消失') + after_bf +
                row(muted('补登记入审计日志（P27）。页头完整率：', 12) + BL.completion(c_bf), 10, wrap=True), 10)
    two = col(cap('② 取消售后单 · 二次确认，原因必填') + over_page(BL.cancel_dialog(), 680, drawer_=False), 8)
    return frame(grid(col(one + three, 24) + two, 2, 32, extra='align-items: start;'), WIDE)


# ---------------------------------------------------------------- S16 第二阶段的手工登记单（prd_b 6.5 边界，D-27）
def s16():
    fl = row(filter_chip('当前环节', '手工登记', True) + filter_chip('创建路径', '手工登记 · 历史导入', True) + spacer() + nowrap('3 张 · 不计入「需我处理」与售后角标', 12, T['ink4']), 8)
    tone = {'normal': T['ink'], 'warning': T['warn'], 'muted': T['ink3']}
    rows_ = [[nowrap(r[0], 13, T['accent'], 600), nowrap(r[1], 13, T['ink2']), state(r[3]), nowrap(r[4], 12, T['ink2']), nowrap(r[5], 12, T['ink2']),
              nowrap(r[6], 12, T['ink2']), nowrap(r[7], 12, T['ink2']), text(r[8], 12, tone[r[9]], 600 if r[9] == 'warning' else 400)] for r in P2_MANUAL_ROWS]
    tbl = table([('售后单号', 'left'), ('客户', 'left'), ('状态', 'left'), ('当前环节', 'left'), ('在等谁', 'left'), ('生产厂', 'left'), ('协商', 'left'), ('结算', 'left')],
                rows_, '120px 92px 64px 116px 48px 48px 112px minmax(0, 1fr)', dense=True)
    lock = card(between(row(label('编辑登记 · S-20260911-0018') + nowrap('点行打开（S14 同一抽屉）', 12, T['ink4']), 8), '') +
                kv('承担比例', '三组均 FSH 0 / 工厂 100 · 已按登记值确认 · 只读', bold=False) +
                row(icon('info', 13, T['ink4']) + nowrap('需要调整：批次生成前在 P12「重开协商」，批次生成后在下一批次冲销', 12, T['ink3']), 5), pad='10px 14px', gap=6)
    notes = muted('上线时比例确认时间记为上线时刻，只进 9 月月末批次（当月提前生成的批次不收）；工厂比例大于 0 但生产厂为空的单结算为「未定」，补登生产厂后转待结算；历史导入的单结算为「不适用」，不进批次。', 12)
    return frame(fl + tbl + lock + notes)


def build():
    V = lambda t, spec, f, trig: variant(t, spec, f, W, trigger=trig)
    VW = lambda t, spec, f, trig: variant(t, spec, f, WIDE + 32, trigger=trig)  # 横跨两列
    body = col(
        grid(V('S1 责任类型 AI 预选与改判', '责任类型默认预选 AI 建议并标「✦ AI 预选」，不改选无需理由；改选其他类型即为改判，必须填理由（R-AS-03）。报错在字段下方，提交按钮保持可点，点击后定位到第一个错误。', s1(),
               '进入 P08 时预选；改选责任类型后点「确认并提交报备」未填改判理由') +
             col(V('S2 库存查询失败', '第 3 项显示失败原因与重试；可手工选择分支继续确认，手工选择记审计日志。', s2(), '进入 P08 时经积加查询库存超时或报错') +
                 V('S8 录入最终比例校验', '三组费用各填工厂承担比例，必须是 0–100 的整数，FSH 自动补足 100；输入框下实时显示两方金额，比例有误时合计暂不计算；商定依据不少于 10 个字；商定人双方必选。', s8(), 'P12 点「录入最终比例」时校验不通过'), 32), 2, 32) +
        grid(V('S12 录入最终比例确认', '校验通过后弹确认框（不可逆）：列三组比例与两方金额、商定人；确认后比例锁定，协商「已确认」、结算「待结算」。默认焦点在「取消」。', s12(),
               'P12 点「录入最终比例」且 S8 校验通过') +
             V('S9 生成结算批次', '每个生产厂每月至少一个批次：月末自动生成，也可提前生成；提前批次只收当时比例已确认的售后单，月末批次收其余。弹窗只列比例已确认的售后单与两方承担金额（比例悬停可见）；生成不可撤销，默认焦点在「取消」；确认后批次「待确认」并推送生产厂，双方确认后已结算。', s9(),
               'P14 在 FQD-B 批次卡点「提前生成批次」，或月末自动生成前预览'), 2, 32) +
        grid(V('S3 报备被驳回', '详情顶部红色横幅：驳回人、时间、原因。系统发起的报备被驳回（或撤回）时售后单保持进行中，当前环节「报备审批 · 待重新提交」，步骤条当前环节标红；可退回生产厂重新报价，或修改金额后重新提交（R-AP-07）。', s3(),
               '客服主管在审批页驳回生产厂报价后系统发起的快递费用报备') +
             V('S4 库存用尽自动切换', '黄色横幅说明发生了什么与已自动完成的处理：原报备作废、派发询价、通知售后负责人（R-AS-04）。步骤条换成易仓无货分支。', s4(),
               '报备通过后易仓创建出库单返回库存不足'), 2, 32) +
        grid(V('S5 生产厂超时', '超时限自动催办 1 次，步骤条标「已催 1 次」（黄）；再过 2 个工作日标「卡住」（红）并通知售后负责人（E-07）。', s5(),
               '询价 2、寄件 3、比例答复 3、结算确认 5 个工作日内未提交（截止时刻按 R-CL-02）') +
             V('S6 终止流程', '危险弹窗，原因必填；说明已产生的费用照常登记、待审批的报备自动撤回、生产厂任务取消。', s6(), '在售后单详情点「终止流程」'), 2, 32) +
        grid(V('S7 客户改地址', '寄出前：系统自动更新并通知易仓或生产厂，横幅提示即可；寄出后：由售后负责人选择改派或补发（R-AS-05）。', s7(), '客户新来信或坐席修改了收货地址') +
             V('S10 列表为空', '筛选无结果时保留表头与筛选条件，给出清除筛选；快捷筛选（含待协商、待结算）计数随筛选变为 0。', s10(), 'P07 筛选条件组合没有匹配的售后单'), 2, 32) +
        grid(V('S11 导出', '点击后按钮进入处理中，右上角显示进度；完成后成功浮层给出下载链接。导出按当前筛选。', s11(), 'P13 点「导出 Excel」') +
             V('S16 第二阶段的手工登记单', 'P07 按当前环节「手工登记」筛选：进行中的单当前环节「手工登记 · 待补登」、等负责人，协商按登记值「已确认」，结算「待结算」只进上线当月的月末批次；'
               '生产厂为空的单结算「未定 · 待补生产厂」；历史导入的单结算「不适用」。点行打开编辑登记抽屉，承担比例只读（prd_b 6.5 边界，D-27）。', s16(),
               '第二阶段王磊在 P07 筛选第一阶段遗留的手工登记单'), 2, 32) +
        VW('S13 第一阶段登记台账', '王磊视角，按 P13「第一阶段」：标题「登记台账」，没有「售后单」「内部结算」页签；右上 新建登记 · 列设置 · 导出 Excel；页头完整率「9 月登记完整率 %s · %d / %d · 目标 ≥ 98%%」；'
           '筛选 日期（费用发生日）· 店铺 · 处理方式 · 责任 · 状态 · 负责人；列 售后单号（S-20260909-0016 带「缺 1 项」）· 客户 · 店铺与站点 · 处理方式 · 责任 · 状态 · 快递单号 · 产品成本 · 运费 · 额外赔偿 · 费用合计 · FSH 承担 $ · 工厂承担 $'
           '（已隐藏 配件 × 数量、负责人、其他、生产厂）；没有报备、协商、结算列与「✦ 积加有单号」，工厂承担不带「≈」；进行中未发生的字段为「—」，已完成缺字段标黄「待回填」；S-20260911-0020 额外赔偿写「$49.39 · MX$889.00 · 汇率 09-10」；'
           '合计行 12 单，费用合计 %s，与 P17 一致，下方没有结算拆解。另一张小图：坐席视角，金额七列与合计行不显示。' % (BL.COMP['pct'], BL.COMP['ok'], BL.COMP['total'], money(BL.FEE_TOTAL)),
           s13(), '第一阶段售后负责人打开 P13') +
        VW('S14 新建登记与编辑登记', '右侧抽屉，处理方式三选一（调整安装方式 / 寄配件 / 退款或部分补偿）后按 R-AS-08 列出适用字段，不适用的不显示。示例为寄配件：店铺 forcome.com · 站点 US · 订单号 #1063 · 客户 Olivia Turner · 来源工单 T-20260911-0031（可不填）· '
           '负责人 王磊（该店铺唯一的售后负责人，已默认）· 费用发生日 09-11 · 责任 产品质量问题（三组比例按默认预填 FSH 0 / 工厂 100，可改，两侧互补）· 生产厂 FQD（按配件预填）· 配件 HEPA 滤芯组件 FC-V2-HF01 × 1 · 发货方 易仓 · 承运方式 · 寄出日期 · 快递单号（进行中可后填）· '
           '产品成本、运费、额外赔偿、其他（每项选币种 USD / CAD / MXN，非美元即时显示折算与汇率日期）。保存时校验全部，字段下方报错：比例 130 →「比例为 0–100 的整数」；退款或部分补偿的额外赔偿为 0 →「部分补偿、免退货退款的款项记在额外赔偿，须大于 0」；'
           '责任为其他时理由必填；保存按钮保持可点，点击后定位到第一个错误（同 K8）。保存时必须填：处理方式、店铺、站点、订单号、客户、费用发生日、负责人、责任类型、三组比例，以及上面三条；寄件一节、四项费用、索赔对象与状态进行中可后填（费用框默认空，没发生的填 0）。'
           '责任为物流问题时列出索赔对象与索赔状态，三组工厂比例都为 0 时不显示生产厂。来源工单离开输入框时查询，带入店铺、站点、订单号、客户（仍可改，保存时店铺须一致）；选店铺带出默认站点与默认负责人，费用发生日默认今天，寄配件数量默认 1。'
           '编辑登记为同一抽屉，标题「编辑登记 · S-…」，已完成的单只能由售后负责人补登缺失的适用字段与修改汇率，修改记审计。非美元金额按费用发生日取汇率（当天没有取此前最近一个有汇率的日期），费用发生日及之前都没有汇率时不能保存，报「费用发生日及之前没有汇率，暂时不能折算美元」；修改汇率后汇率日期为费用发生日、来源记「手工修改」，P13 金额的悬停说明随之写手工修改的汇率。下方为补充小样（第一阶段实现时确认）。', s14(), 'P13 点「新建登记」或售后单号') +
        VW('S15 设为已完成、取消与补登', '三张小图：① 设为已完成：直接执行，浮层「S-20260911-0018 已完成 · 缺 2 项，已标黄待回填 · 撤销 4s」；② 取消售后单：二次确认弹窗「取消 S-20260911-0021？」，原因必填（0 / 200），逐项列出已登记费用并勾选取消后保留的已产生部分（默认全部保留），'
           '说明「已取消的单不能恢复；保留的费用照常计入售后成本」，默认焦点在「取消」；③ 补登：售后负责人点已完成单的「待回填」单元格行内编辑快递单号，保存后浮层「已补登 · 已记入审计日志」，「缺 N 项」随之减少。', s15(),
           'P13 行尾「更多」或已完成单的「待回填」单元格'),
        40)
    return board('售后状态', '售后单确认、详情、协商、台账、结算的状态与异常（S1–S16；S13–S15 为第一阶段登记台账，S16 为第二阶段的手工登记单）。详情画面同 P09–P12：标题旁只留状态徽标，步骤条上方「当前卡点」；禁用按钮悬停给出原因。示例单号与金额与高保真页面一致；演示时刻 %s，超时类画面按时限推算到之后的时刻。' % NOW_LABEL, body, 1920, 7545)


if __name__ == '__main__':
    save('StatesAfterSales.dc.html', build())
    print('ok')
