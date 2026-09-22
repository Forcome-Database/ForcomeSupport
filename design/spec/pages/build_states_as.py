# -*- coding: utf-8 -*-
"""StatesAfterSales · 售后状态板 S1–S11。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from data import *
from as_common import *
import build_aftersales as BA
import build_ledger as BL

W = 864  # 单个画面宽度（两列）


def detail_top(title, chips, meta, actions, steps, par, banner_html=None, extra=''):
    """售后单详情顶部（标题区 + 步骤条 + 并行条 + 横幅），1:1 局部画面。"""
    below = '<div style="padding-top: 2px;">%s</div>' % stepper(steps) + parallel_bar(par)
    head = detail_head(title, chips, actions, meta, col(below, 10))
    bn = '<div style="padding: 12px 20px 0px 20px;">%s</div>' % banner_html if banner_html else ''
    ex = '<div style="padding: 12px 20px 16px 20px;">%s</div>' % extra if extra else '<div style="height: 16px;"></div>'
    return '<div style="width: %dpx; box-sizing: border-box; background: %s; display: flex; flex-direction: column;">%s%s%s</div>' % (W, T['canvas'], head, bn, ex)


# ---------------------------------------------------------------- S1 确认页未选必填
def s1():
    _, s2_err, _ = BA.p08_sections(err_resp=True)
    _, s2_ovr, _ = BA.p08_sections(override=True)
    foot = between(muted('提交时校验全部必填项，并滚动到第一个错误。', 12), btn('确认并提交报备', 'primary', 'md', icon_right='arrow_r'))
    return frame(cap('未选责任类型') + s2_err + cap('改判为「其他」但未填理由') + s2_ovr + foot)


# ---------------------------------------------------------------- S2 库存查询失败
def s2():
    _, _, s3 = BA.p08_sections(stock_fail=True)
    return frame(s3)


# ---------------------------------------------------------------- S3 报备被驳回
def s3():
    steps = [('确认', '08:20', 'done'), ('派发询价', '08:21', 'done'), ('生产厂报价', '09:40', 'done'), ('报备审批', '周敏驳回 10:52', 'error'),
             ('生产厂寄件', '', 'todo'), ('单号回复客户', '', 'todo'), ('完成', '', 'todo')]
    bn = banner('danger', '报备已被驳回 · 客服主管周敏 10:52',
                '驳回原因：运费高于同线路均价 30%，请生产厂改走云途普货后重新报价。售后单已退回「待确认」，寄件任务未生成，绑定回复未发出。',
                row(btn('修改后重新提交', 'primary', 'sm') + btn('查看审批单', 'secondary', 'sm'), 6))
    extra = card(log_item('10:52', '人工', '周敏驳回 AP-20260911-003（快递费用 $11.50），原因已通知王磊。') +
                 log_item('10:52', '系统', '售后单退回待确认；东莞生产厂的报价保留，可请陈工改承运方式后重新报价。'), '执行记录', pad='12px 16px', gap=8)
    return detail_top('HEPA 滤芯组件补发 · Laura Bennett', state('待确认') + cat('寄配件 · 良仓无货') + cat('产品质量问题'),
                      meta_line(['售后单 S-20260911-0018', '原工单 T-20260910-0201', '负责人 王磊']),
                      btn('查看原工单', 'secondary', 'md', 'external') + btn('终止流程', 'danger_outline'), steps,
                      [('比例协商', state('未发起'), '报备通过后自动发起'), ('内部结算', state('未定'), '')], bn, extra)


# ---------------------------------------------------------------- S4 库存用尽自动切换
def s4():
    steps = [('确认', '09:35', 'done'), ('积加创建发货单', '库存不足 10:31', 'error'), ('派发询价', '10:31', 'current'),
             ('生产厂报价', '', 'todo'), ('报备审批', '', 'todo'), ('生产厂寄件', '', 'todo'), ('单号回复客户', '', 'todo')]
    bn = banner('warning', '发货单创建失败，已切到良仓无货',
                '积加返回良仓 US「车载吸尘器 V2 黑色（整机）」库存不足。原报备 AP-20260911-002（快递费用 $8.40）已作废；已向东莞生产厂派发询价，报价后按新金额重新报备。已通知王磊。',
                btn('查看询价单', 'secondary', 'sm'))
    extra = card(log_item('10:30', '人工', '周敏批准 AP-20260911-002。') +
                 log_item('10:31', '自动', '积加 MCP 创建售后发货单失败：良仓 US 整机黑色库存 0 件。') +
                 log_item('10:31', '系统', '切换为良仓无货，原报备作废；在工厂工作台派发询价：整机黑色 ×1 · 寄往美国。'), '执行记录', pad='12px 16px', gap=8)
    return detail_top('整机换发 · Marcus Lee', state('进行中') + cat('寄配件 · 良仓无货') + cat('物流问题'),
                      meta_line(['售后单 S-20260911-0021', '原工单 T-20260910-0195', '负责人 王磊']),
                      btn('查看原工单', 'secondary', 'md', 'external') + btn('改处理方式'), steps,
                      [('比例协商', state('不适用'), '物流问题，向良仓索赔'), ('内部结算', state('不适用'), '')], bn, extra)


# ---------------------------------------------------------------- S5 生产厂超时
def s5():
    base = [('确认', '08:49', 'done'), ('派发询价', '08:50', 'done')]
    tail = [('报备审批', '', 'todo'), ('生产厂寄件', '', 'todo'), ('单号回复客户', '', 'todo'), ('完成', '', 'todo')]
    a = card(between(row(nowrap('S-20260911-0019 · 软管 ×2 · Lukas Braun', 13, T['ink'], 700) + state('进行中'), 8), nowrap('等东莞生产厂', 12, T['ink3'])) +
             stepper(base + [('生产厂报价', '已催 1 次 · 已超时限', 'current')] + tail) +
             row(icon('bell', 14, T['warn']) + nowrap('09-15 08:50 报价超过 2 个工作日，已自动催办 1 次（企业即时通讯）。再过 2 个工作日仍未报价将标为卡住。', 12, T['ink2']), 6),
             pad='12px 16px', gap=12)
    b = card(between(row(nowrap('S-20260911-0019 · 软管 ×2 · Lukas Braun', 13, T['ink'], 700) + state('进行中'), 8), nowrap('等东莞生产厂', 12, T['ink3'])) +
             stepper(base + [('生产厂报价', '卡住 · 超时 2 个工作日', 'error')] + tail) +
             banner('danger', '生产厂报价卡住，已通知你', '东莞生产厂超过时限 2 个工作日仍未报价（已催办 1 次）。建议电话跟进陈工，或改处理方式。',
                    row(btn('给陈工留言', 'secondary', 'sm') + btn('改处理方式', 'secondary', 'sm'), 6)),
             pad='12px 16px', gap=12, tone='danger')
    return frame(cap('已催 1 次') + a + cap('卡住') + b)


# ---------------------------------------------------------------- S6 终止流程
def s6():
    body = field('终止原因', textarea_box(None, '例如：客户撤回售后申请、改为退款处理', 'error', 64, '0 / 200'), True, error='请填写终止原因') + \
        col(bullet('售后单变为「已取消」，不可恢复；已产生的费用照常登记到台账。') +
            bullet('待审批的报备 AP-20260911-003 自动撤回，东莞生产厂的任务自动取消并通知陈工。') +
            bullet('关联工单 T-20260910-0201 不会自动回复客户，请在工单中说明。'), 4)
    dlg = dialog('终止售后单 S-20260911-0018？', body, btn('取消', 'secondary') + btn('终止流程', 'danger'), 460, 'danger', '终止后流程停止，无法恢复。')
    return overlay(scaled(BA.p09(), 1440, 900, 0.6), dlg, W, 540)


# ---------------------------------------------------------------- S7 客户改地址
def s7():
    a = banner('info', '客户更新了收货地址，已同步到生产厂寄件任务',
               '10:15 来自工单 T-20260910-0201 新来信。1180 Peachtree St NE, Atlanta, GA 30309 → 455 Ponce De Leon Ave NE, Atlanta, GA 30308。已通知东莞生产厂。',
               link('查看变更记录', 12))
    b = card(banner('warning', '包裹已寄出后客户要求改地址', '云途 YT2625100012351234 已于 09-12 寄出。新地址：455 Ponce De Leon Ave NE, Atlanta, GA 30308。请选择处理方式。') +
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
        rows.append([nowrap(no, 12.5, T['ink'], 600), a['customer'], ratio_txt(a), money(factory_share(a))])
    t = table([('售后单号', 'left'), ('客户', 'left'), ('FSH / 工厂 %', 'left'), ('工厂承担', 'right')], rows, '130px minmax(0, 1fr) 90px 72px', dense=True,
              footer=['合计 2 单', '', '', money(BL.LT['pending'])])
    body = t + col(bullet('只含比例已确认的售后单；比例未定的 4 单（%s）不进入本批次。' % money(BL.LT['undecided'])) +
                   bullet('生成后批次为「待确认」，推送陈工确认；双方确认后转为已结算。') +
                   bullet('批次生成后，其中售后单的比例不能再改。'), 4)
    dlg = dialog('提前生成批次 2026-09-B？', body, btn('取消', 'secondary') + btn('生成并推送生产厂', 'primary', 'md', 'send'), 480, None, '东莞生产厂 · 2026-09 · 原定 10-05 自动生成。')
    return overlay(scaled(BL.p14(), 1440, 900, 0.6), dlg, W, 540)


# ---------------------------------------------------------------- S10 列表为空
def s10():
    q = ['需我处理 0', '等审批 0', '等生产厂 0', '已完成 0', '全部 0']
    fl = row(seg(q, '全部 0') + filter_chip('店铺', 'forcome.eu', True) + filter_chip('责任', '其他', True) + link('清除筛选', 12), 8)
    head = '<div style="display: grid; grid-template-columns: 124px 100px 1fr 90px 90px 90px; gap: 12px; padding: 9px 16px; background: %s; border-bottom: 1px solid %s; font-size: 11px; font-weight: 700; color: %s;">%s</div>' % (
        T['subtle'], T['line'], T['ink3'], ''.join('<div>%s</div>' % c for c in ['售后单号', '客户', '渠道与店铺', '处理方式', '责任', '状态']))
    box = '<div style="background: #ffffff; border: 1px solid %s; border-radius: 8px; overflow: hidden; box-shadow: %s;">%s%s</div>' % (
        T['line'], SHADOW_XS, head, empty('search', '没有符合条件的售后单', '当前筛选：店铺 forcome.eu · 责任 其他。换个条件试试，或清除筛选查看全部 13 张。', btn('清除筛选', 'secondary', 'md', 'x')))
    return frame(fl + box)


# ---------------------------------------------------------------- S11 导出
def s11():
    prog = '<div style="width: 360px; box-sizing: border-box; display: flex; gap: 10px; align-items: flex-start; background: #ffffff; border: 1px solid %s; border-radius: 8px; padding: 12px 14px; box-shadow: %s;">%s<div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 6px;"><div style="font-size: 13px; font-weight: 700; color: %s;">正在导出登记台账</div><div style="font-size: 12px; color: %s;">12 单 · 按当前筛选（2026-09-01 至 09-11）· 62%%</div>%s</div></div>' % (
        T['line'], SHADOW_MD, spinner(18), T['ink'], T['ink3'], progress(62))
    left = col(cap('导出中') + row(btn('列设置', 'secondary', 'md', 'sort') + btn('同步到积加', 'secondary', 'md', 'refresh') + btn('导出中', 'secondary', 'md', loading=True), 8) + prog, 12)
    done = toast('success', '登记台账已导出', '登记台账_20260901-20260911.xlsx · 12 单。文件保留 7 天。', row(link('下载', 12, 'download') + link('查看导出记录', 12), 12))
    right = col(cap('完成') + row(btn('列设置', 'secondary', 'md', 'sort') + btn('同步到积加', 'secondary', 'md', 'refresh') + btn('导出 Excel', 'secondary', 'md', 'download'), 8) + done, 12)
    return frame(grid(left + right, 2, 24))


def build():
    V = lambda t, spec, f, trig: variant(t, spec, f, W, trigger=trig)
    body = col(
        grid(V('S1 确认页未选必填', '处理方式、责任类型必选；责任与 AI 建议不同即为改判，必须填理由（R-AS-03）。报错在字段下方，提交按钮保持可点，点击后定位到第一个错误。', s1(),
               '在 P08 点「确认并提交报备」时未选责任类型，或改判未填理由') +
             col(V('S2 库存查询失败', '第 3 项显示失败原因与重试；可手工选择分支继续确认，手工选择记审计日志。', s2(), '进入 P08 时积加库存接口超时或报错') +
                 V('S8 录入最终比例校验', '比例为 0–100 的整数，两者之和须为 100；商定依据不少于 10 个字；商定人双方必选。', s8(), 'P12 点「录入最终比例」时校验不通过'), 32), 2, 32) +
        grid(V('S3 报备被驳回', '详情顶部红色横幅：驳回人、时间、原因；售后单退回待确认（R-AP-07），步骤条当前环节标红。「修改后重新提交」回到 P08 并带入原值。', s3(),
               '客服主管在审批页驳回含报备的审批单') +
             V('S4 库存用尽自动切换', '黄色横幅说明发生了什么与已自动完成的处理：原报备作废、派发询价、通知售后负责人（R-AS-04）。步骤条换成良仓无货分支。', s4(),
               '报备通过后积加创建发货单返回库存不足'), 2, 32) +
        grid(V('S5 生产厂超时', '超时限自动催办 1 次，步骤条标「已催 1 次」（黄）；再过 2 个工作日标「卡住」（红）并通知售后负责人（E-07）。', s5(),
               '询价 2 个工作日、寄件 3 个工作日、比例答复 3 个工作日未提交') +
             V('S6 终止流程', '危险弹窗，原因必填；说明已产生的费用照常登记、待审批的报备自动撤回、生产厂任务取消。', s6(), '在售后单详情点「终止流程」'), 2, 32) +
        grid(V('S7 客户改地址', '寄出前：系统自动更新并通知良仓或生产厂，横幅提示即可；寄出后：由售后负责人选择改派或补发（R-AS-05）。', s7(), '客户新来信或坐席修改了收货地址') +
             V('S9 生成结算批次', '弹窗只列比例已确认的售后单与金额；确认后批次「待确认」并推送生产厂，双方确认后已结算。', s9(), 'P14 点「提前生成批次」，或每月 5 日自动生成前预览'), 2, 32) +
        grid(V('S10 列表为空', '筛选无结果时保留表头与筛选条件，给出清除筛选；快捷筛选计数随筛选变为 0。', s10(), 'P07 筛选条件组合没有匹配的售后单') +
             V('S11 导出', '点击后按钮进入处理中，右上角显示进度；完成后成功浮层给出下载链接。导出按当前筛选。', s11(), 'P13 点「导出 Excel」'), 2, 32),
        40)
    return board('售后状态', '售后单确认、详情、协商、台账、结算的状态与异常（S1–S11）。示例单号与金额与高保真页面一致；演示时刻 %s，超时类画面按时限推算到之后的时刻。' % NOW_LABEL, body, 1920, 3393)


if __name__ == '__main__':
    save('StatesAfterSales.dc.html', build())
    print('ok')
