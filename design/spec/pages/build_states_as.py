# -*- coding: utf-8 -*-
"""StatesAfterSales · 售后状态板 S1–S12。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from data import *
from as_common import *
import build_aftersales as BA
import build_ledger as BL

W = 864  # 单个画面宽度（两列）


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
    steps = [('确认', '09:35', 'done'), ('易仓创建出库单', '库存不足 10:52', 'error'), ('派发询价', '10:52', 'current'),
             ('生产厂报价', '', 'todo'), ('报备审批', '', 'todo'), ('生产厂寄件', '', 'todo'), ('单号回复客户', '', 'todo')]
    bn = banner('warning', '出库单创建失败，已切到易仓无货',
                '积加返回易仓 US「车载吸尘器 V2 黑色（整机）」库存不足。原报备 AP-20260911-002（快递费用 $8.40）已作废；已向生产厂 FQD 派发询价，报价后按新金额重新报备。已通知王磊。',
                btn('查看询价单', 'secondary', 'sm'))
    extra = card(log_row('10:51', '周敏', '批准 AP-20260911-002。') +
                 log_row('10:52', '系统', '经积加创建易仓出库单失败：易仓 US 整机黑色库存 0 件。') +
                 log_row('10:52', '系统', '切换为易仓无货，原报备作废；在工厂工作台派发询价：整机黑色 ×1 · 寄往美国。'), '执行记录', pad='12px 16px', gap=8)
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
    body = field('终止原因', textarea_box(None, '例如：客户撤回售后申请、改为退款处理', 'error', 64, '0 / 200'), True, error='请填写终止原因') + \
        col(bullet('售后单变为「已取消」，不可恢复；已产生的费用照常登记到台账。') +
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
    body = t + col(bullet('只含比例已确认的售后单；比例未定的 4 单（≈ %s）不进入本批次。' % money(BL.LT['undecided'])) +
                   bullet('生成后批次为「待确认」，推送陈工确认；双方确认后转为已结算。') +
                   bullet('<b>不可撤销</b>：批次生成后其中售后单的比例不能再改，需调整时在下一批次冲销。'), 4)
    dlg = dialog('提前生成批次 2026-09-FQD-B？', body, btn('取消', 'secondary', st='focus') + btn('生成并推送生产厂', 'primary', 'md', 'send'), 540, 'warning',
                 '生产厂 FQD · 原定 10-05 自动生成 · 生成后不可撤销，默认焦点在「取消」')
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
    left = col(cap('导出中') + row(btn('列设置', 'secondary', 'md', 'sort') + btn('导出中', 'secondary', 'md', loading=True), 8) + prog, 12)
    done = toast('success', '登记台账已导出', '登记台账_20260901-20260911.xlsx · 12 单。文件保留 7 天。', row(link('下载', 12, 'download') + link('查看导出记录', 12), 12))
    right = col(cap('完成') + row(btn('列设置', 'secondary', 'md', 'sort') + btn('导出 Excel', 'secondary', 'md', 'download'), 8) + done, 12)
    return frame(grid(left + right, 2, 24))


def build():
    V = lambda t, spec, f, trig: variant(t, spec, f, W, trigger=trig)
    body = col(
        grid(V('S1 责任类型 AI 预选与改判', '责任类型默认预选 AI 建议并标「✦ AI 预选」，不改选无需理由；改选其他类型即为改判，必须填理由（R-AS-03）。报错在字段下方，提交按钮保持可点，点击后定位到第一个错误。', s1(),
               '进入 P08 时预选；改选责任类型后点「确认并提交报备」未填改判理由') +
             col(V('S2 库存查询失败', '第 3 项显示失败原因与重试；可手工选择分支继续确认，手工选择记审计日志。', s2(), '进入 P08 时经积加查询库存超时或报错') +
                 V('S8 录入最终比例校验', '三组费用各填工厂承担比例，必须是 0–100 的整数，FSH 自动补足 100；输入框下实时显示两方金额，比例有误时合计暂不计算；商定依据不少于 10 个字；商定人双方必选。', s8(), 'P12 点「录入最终比例」时校验不通过'), 32), 2, 32) +
        grid(V('S12 录入最终比例确认', '校验通过后弹确认框（不可逆）：列三组比例与两方金额、商定人；确认后比例锁定，协商「已确认」、结算「待结算」。默认焦点在「取消」。', s12(),
               'P12 点「录入最终比例」且 S8 校验通过') +
             V('S9 生成结算批次', '弹窗只列比例已确认的售后单与两方承担金额（比例悬停可见）；生成不可撤销，默认焦点在「取消」；确认后批次「待确认」并推送生产厂，双方确认后已结算。', s9(),
               'P14 在 FQD-B 批次卡点「提前生成批次」，或每月 5 日自动生成前预览'), 2, 32) +
        grid(V('S3 报备被驳回', '详情顶部红色横幅：驳回人、时间、原因。系统发起的报备被驳回（或撤回）时售后单保持进行中，当前环节「报备审批 · 待重新提交」，步骤条当前环节标红；可退回生产厂重新报价，或修改金额后重新提交（R-AP-07）。', s3(),
               '客服主管在审批页驳回生产厂报价后系统发起的快递费用报备') +
             V('S4 库存用尽自动切换', '黄色横幅说明发生了什么与已自动完成的处理：原报备作废、派发询价、通知售后负责人（R-AS-04）。步骤条换成易仓无货分支。', s4(),
               '报备通过后易仓创建出库单返回库存不足'), 2, 32) +
        grid(V('S5 生产厂超时', '超时限自动催办 1 次，步骤条标「已催 1 次」（黄）；再过 2 个工作日标「卡住」（红）并通知售后负责人（E-07）。', s5(),
               '询价 2、寄件 3、比例答复 3、结算确认 5 个工作日内未提交（截止时刻按 R-CL-02）') +
             V('S6 终止流程', '危险弹窗，原因必填；说明已产生的费用照常登记、待审批的报备自动撤回、生产厂任务取消。', s6(), '在售后单详情点「终止流程」'), 2, 32) +
        grid(V('S7 客户改地址', '寄出前：系统自动更新并通知易仓或生产厂，横幅提示即可；寄出后：由售后负责人选择改派或补发（R-AS-05）。', s7(), '客户新来信或坐席修改了收货地址') +
             V('S10 列表为空', '筛选无结果时保留表头与筛选条件，给出清除筛选；快捷筛选（含待协商、待结算）计数随筛选变为 0。', s10(), 'P07 筛选条件组合没有匹配的售后单'), 2, 32) +
        grid(V('S11 导出', '点击后按钮进入处理中，右上角显示进度；完成后成功浮层给出下载链接。导出按当前筛选。', s11(), 'P13 点「导出 Excel」'), 2, 32),
        40)
    return board('售后状态', '售后单确认、详情、协商、台账、结算的状态与异常（S1–S12）。详情画面同 P09–P12：标题旁只留状态徽标，步骤条上方「当前卡点」；禁用按钮悬停给出原因。示例单号与金额与高保真页面一致；演示时刻 %s，超时类画面按时限推算到之后的时刻。' % NOW_LABEL, body, 1920, 3886)


if __name__ == '__main__':
    save('StatesAfterSales.dc.html', build())
    print('ok')
