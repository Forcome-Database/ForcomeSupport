# -*- coding: utf-8 -*-
"""StatesApproval.dc.html —— 审批状态 A1–A9。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from data import *
from common import scaled, mtable
import build_approval_kb_reports as P

VW = 880
S = 0.6111


def scrim_frame(bg_html, dlg, w=VW, h=550):
    return '<div style="width: %dpx; height: %dpx; position: relative; overflow: hidden; background: %s;">%s<div style="position: absolute; inset: 0px; background: rgba(16,24,40,0.45); display: flex; align-items: center; justify-content: center;">%s</div></div>' % (
        w, h, T['canvas'], bg_html, dlg)


def step_line(n, t, sub=None):
    s = '<div style="font-size: 12px; color: %s; line-height: 1.5;">%s</div>' % (T['ink3'], sub) if sub else ''
    return '<div style="display: flex; gap: 10px; align-items: flex-start;"><div style="width: 20px; height: 20px; border-radius: 999px; background: %s; color: %s; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%d</div><div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 1px;"><div style="font-size: 13px; color: %s; line-height: 1.5;">%s</div>%s</div></div>' % (
        T['accent_bg'], T['accent_ink'], n, T['ink'], t, s)


def exec_step(st, t, sub=None):
    ic = {'ok': icon('check_c', 16, T['ok_solid'], 2), 'fail': icon('x_c', 16, T['bad_solid'], 2), 'todo': icon('clock', 16, T['ink4'], 2)}[st]
    c = {'ok': T['ink'], 'fail': T['bad'], 'todo': T['ink3']}[st]
    s = '<div style="font-size: 12px; color: %s; line-height: 1.5;">%s</div>' % (T['ink3'], sub) if sub else ''
    return '<div style="display: flex; gap: 10px; align-items: flex-start;"><div style="padding-top: 1px;">%s</div><div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 1px;"><div style="font-size: 13px; font-weight: 600; color: %s;">%s</div>%s</div></div>' % (ic, c, t, s)


# ---------------------------------------------------------------- A1 待我审批为空
def p15_empty():
    tabs_html = tabs([('待我审批', 0), ('我发起的', None), ('人工操作清单', 0), ('已处理', 4)], '待我审批')
    note = row(icon('info', 14, T['ink4']) + nowrap('含报备的由客服主管审批，时限 4 小时', 12, T['ink3']), 6)
    head = page_head('审批', None, note, tabs_html)
    em = card(empty('check_c', '没有待你审批的单', '新的审批单会出现在这里，并通过通知提醒你。今天已处理 4 张。', btn('查看已处理', 'secondary', 'md')), pad='40px 0px')
    left = col(em, 10, 'flex: 1; min-width: 0px;')
    log = card(col(P.exec_log(), 6), title='执行日志 · 今日', extra=link('全部日志', 12, 'chev_r'), pad='12px 14px', gap=10)
    right = col(log, 12, 'width: 372px; flex-shrink: 0;')
    body = head + '<div style="flex: 1; min-height: 0px; display: flex; gap: 16px; padding: 14px 24px;">%s%s</div>' % (left, right)
    return app('zhoumin', '审批', ['审批', '待我审批'], body, badges={'收件箱': 4})


def a1():
    return variant('A1 待我审批为空', '保留页签与执行日志；列表区空状态说明原因并给出「查看已处理」。导航「审批」角标消失。',
                   scaled(p15_empty(), 1440, 900, S), VW, trigger='待我审批的数量为 0（本例为全部处理完后的画面）。')


# ---------------------------------------------------------------- A2 批准确认
def a2():
    quote = '<div style="font-size: 12px; color: %s; line-height: 1.55; border-left: 2px solid %s; padding-left: 10px; margin-top: 4px;">%s</div>' % (T['ink2'], T['accent_line'], DRAFTS['mateo_bound_es'])
    body = col(label('批准后按顺序执行') +
               step_line(1, '报备通过：额外赔偿 <b>MX$889.00</b>（≈ $49.39）写入登记台账', '售后单 S-20260911-0020 进入「执行付款」') +
               step_line(2, '经 SP-API 退款 MX$889.00（Forcome Direct · MX）', '失败按 1、5、15 分钟自动重试 3 次；仍失败时陈晨可转人工操作清单') +
               step_line(3, '退款成功后，自动发出西班牙语绑定回复', quote) +
               step_line(4, '在工厂工作台发起比例提案：建议' + ratio_words([x for x in AFTERSALES if x['no'] == 'S-20260911-0020'][0]['ratios']), '与退款并行，客户不等协商结果'), 12)
    dlg = dialog('批准 AP-20260911-001？', body, btn('取消', 'secondary') + btn('批准并退款', 'primary', 'md', 'check'), 560, None,
                 '审批单转「执行中」，每一步的结果写入执行日志。')
    return variant('A2 批准确认', '弹窗按执行顺序列出批准后发生的动作与绑定回复；主按钮文案写清结果。确认后浮层「已批准，正在经 SP-API 退款」。',
                   scrim_frame(scaled(P.p15(), 1440, 900, S), dlg), VW, trigger='在待我审批卡片上点「批准」。')


# ---------------------------------------------------------------- A3 驳回
def a3():
    body = field('驳回原因', textarea_box(None, '写清楚为什么驳回、发起人要怎么改', 'error', 76, '0 / 200'), True, error='请填写驳回原因') + \
        muted('驳回后：陈晨收到通知，绑定回复不会发出；工单 T-20260902-0071 回到提交前的「转人工」；售后单 S-20260911-0020 退回「待确认」并锁定给陈晨，修改后重新提交时沿用同一单号。', 12)
    dlg = dialog('驳回 AP-20260911-001？', body, btn('取消', 'secondary') + btn('驳回', 'danger', 'md', 'x'), 480, 'danger', '报备额外赔偿 MX$889.00 · Mateo Rivas · 发起人陈晨')
    return variant('A3 驳回', '原因必填，未填就点「驳回」时文本框报错；弹窗写明驳回后工单回到提交前状态、售后单退回待确认（R-AP-07）。',
                   scrim_frame(scaled(P.p15(), 1440, 900, S), dlg), VW, trigger='点「驳回」。本例为未填原因直接提交后的画面。')


# ---------------------------------------------------------------- A4 审批超时
def a4():
    a = P.AP['AP-20260911-004']
    ch, sm = P.AP_SUMMARY['AP-20260911-004']
    notified = '<div style="display: flex; align-items: center; gap: 8px; background: %s; border: 1px solid %s; border-radius: 6px; padding: 7px 12px; font-size: 12px; color: %s;">%s<span><b style="color: %s;">13:48 已超时</b>，已通知：李婷（发起人）、王磊（售后负责人，同样可审批）。超时后仍可批准或驳回。</span></div>' % (
        T['bad_bg'], T['bad_line'], T['ink2'], icon('bell', 14, T['bad'], 2), T['bad'])
    c = P.ap_card_collapsed(a, ch, sm, '待审批', 'danger', '已超时 20m', notified, 'danger')
    other = P.ap_card_collapsed(P.AP['AP-20260911-003'], P.AP_SUMMARY['AP-20260911-003'][0], P.AP_SUMMARY['AP-20260911-003'][1], '待审批', 'danger', '已超时 27m')
    frame = mini(col(between(nowrap('待我审批 · 14:08', 12, T['ink3'], 600), nowrap('按截止时间', 12, T['ink3'])) + other + c, 10), VW, 356, pad='20px')
    return variant('A4 审批超时', '剩余胶囊变红「已超时 N」，卡片红色描边并写明超时时刻与已通知的人；剩 1 小时时已提醒过审批人。「已超时」只是标记，统计时保留。',
                   frame, VW, trigger='待审批超过 4 小时（本例为 14:08 的画面）。')


# ---------------------------------------------------------------- A5 执行失败
def a5():
    a = P.AP['AP-20260911-002']
    head = between(row(nowrap(a['no'], 14, T['ink'], 700) + cat('报备 · 快递费用') + cat('动作 · 积加'), 8),
                   row(state('执行失败') + nowrap('周敏 10:51 批准', 12, T['ink3']), 8))
    bn = banner('danger', '良仓出库单创建失败，已自动重试 3 次', '10:52 首次失败，按 1、5、15 分钟重试仍失败（最后一次 11:13）。积加返回：良仓出库单服务超时。绑定回复未发出。')
    steps = col(exec_step('ok', '报备快递费用 $8.40 已登记', '写入登记台账 · S-20260911-0021') +
                exec_step('fail', '良仓创建售后出库单：良仓 US · 整机黑色 ×1', '4 次尝试均失败 · 11:13') +
                exec_step('todo', '发出英语绑定回复', '等出库单创建成功'), 10)
    foot = P.draft_like_foot(btn('重试', 'primary', 'md', 'refresh') + btn('转人工操作清单', 'secondary', 'md', 'handoff'),
                             nowrap('转人工后由你在积加手工创建良仓出库单，回填单号即视为成功', 12, T['ink3']))
    c = card(head + P.ap_meta(a) + bn + steps + foot, pad='14px 18px', gap=11, tone='danger')
    t = [x for x in TICKETS if x['no'] == 'T-20260910-0195'][0]
    inbox = card(row(icon('inbox', 15, T['ink3']) + nowrap('收件箱同步标记', 12, T['ink3'], 600) + divider(True, 12) + nowrap(t['no'], 12.5, T['ink'], 600) +
                     nowrap(t['customer'], 12.5, T['ink2']) + state('待审批') + chip('执行失败', 'danger', 10.5, 'alert') + spacer() +
                     nowrap('工单保持原状态，绑定回复未发出（AC-AP-12）', 12, T['ink3']), 8), pad='10px 16px')
    frame = mini(col(c + inbox, 10), VW, 462, pad='20px')
    return variant('A5 执行失败', '卡片顶部红色横幅写明失败的动作、重试次数与返回原因；逐项显示已成功 / 失败 / 未执行；发起人可「重试」或「转人工操作清单」。',
                   frame, VW, trigger='自动执行按 1、5、15 分钟重试 3 次后仍失败（发起人李婷的视角）。')


# ---------------------------------------------------------------- A6 / A7 人工操作清单回填
def manual_head():
    return between(row(icon('handoff', 16, T['ink2'], 2) + text('亚马逊退款 MX$889.00', 14, T['ink'], 700) + state('待执行'), 8),
                   row(sla('剩 3h 45m', 'warning') + nowrap('4 个工作小时 · 10:45 生成 · 14:45 截止', 12, T['ink3']), 8)) + \
        row(nowrap('AP-20260911-001', 12, T['accent'], 600) + nowrap('Mateo Rivas', 12, T['ink2']) + channel('亚马逊', 'MX', 'Forcome Direct') + nowrap('订单 302-8811234-9901122', 12, T['ink3']), 8)


def manual_steps(done=3):
    items = ['登录亚马逊卖家中心，切换到 Forcome Direct · MX', '订单 302-8811234-9901122 →「退款」', '全额退款 MX$889.00，备注填 AP-20260911-001', '提交后截图退款确认页']
    return col(''.join(checkbox('<span style="color: %s;">%d. %s</span>' % (T['ink'] if i >= done else T['ink3'], i + 1, t), i < done) for i, t in enumerate(items)), 10)


def upload_box():
    f = '<div style="display: flex; align-items: center; gap: 10px; border: 1px solid %s; border-radius: 6px; padding: 6px 10px; background: #ffffff;"><div style="width: 32px; height: 32px; border-radius: 4px; background: %s; display: flex; align-items: center; justify-content: center;">%s</div><div style="flex: 1; min-width: 0px; display: flex; flex-direction: column;"><div style="font-size: 12px; font-weight: 600; color: %s;">refund-302-8811234.png</div><div style="font-size: 11px; color: %s;">248 KB · 已上传</div></div>%s</div>' % (
        T['line'], T['line2'], icon('image', 16, T['ink3']), T['ink'], T['ink4'], icon('x', 14, T['ink4']))
    return col(f + '<div style="border: 1px dashed %s; border-radius: 6px; padding: 8px; font-size: 12px; color: %s; text-align: center;">拖入或点击上传，最多 3 张</div>' % (T['line_strong'], T['ink3']), 6)


def a6():
    form = col(field('外部单号', input_box('302-8811234-9901122-R1', st='focus', mono=True), True, hint='卖家中心退款记录里的退款编号') +
               field('退款金额', input_box('889.00', prefix='MX$', suffix='MXN', mono=True), True, hint='与审批金额 MX$889.00 一致') +
               field('截图', upload_box(), True), 12)
    foot = P.draft_like_foot(btn('回填完成', 'primary', 'md', 'check') + btn('暂存', 'secondary', 'md'), nowrap('回填完成即视为动作成功，西班牙语回复自动发出', 12, T['ink3']))
    body = '<div style="display: flex; gap: 20px;"><div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 10px;">%s%s</div><div style="width: 1px; background: %s;"></div><div style="width: 380px; flex-shrink: 0;">%s</div></div>' % (
        label('操作步骤'), manual_steps(3), T['line2'], form)
    c = card(manual_head() + body + foot, pad='14px 18px', gap=12)
    frame = mini(c, VW, 504, pad='20px')
    return variant('A6 人工操作清单回填', '人工操作清单只作兜底：接口执行失败或暂无接口时生成。左侧逐步勾选，右侧回填外部单号、金额、截图（均必填）；金额与审批一致时给出确认提示。指派给发起人陈晨，4 个工作小时内完成，头部同时显示剩余时长与截止时刻（R-CL-01）。',
                   frame, VW, trigger='AP-20260911-001 批准后 SP-API 退款连续失败 3 次（亚马逊返回：订单已进入退货流程，不允许接口退款），陈晨点「转人工操作清单」，在卖家后台完成后回填。')


def a7():
    form = col(field('外部单号', input_box('302-8811234-9901122-R1', mono=True), True) +
               field('退款金额', input_box('800.00', st='error', prefix='MX$', suffix='MXN', mono=True), True, error='回填金额 MX$800.00 与审批金额 MX$889.00 不一致') +
               field('差异说明', textarea_box('卖家中心只允许退商品金额 MX$800.00，运费 MX$89.00 需另走「运费退款」，已提交申请。', st='focus', h=64, counter='%d / 200' % len('卖家中心只允许退商品金额 MX$800.00，运费 MX$89.00 需另走「运费退款」，已提交申请。')), True), 12)
    warn = banner('warning', '提交后需原审批人周敏确认', '确认前该动作不算成功，西班牙语回复不会发出。')
    foot = P.draft_like_foot(btn('提交并请周敏确认', 'primary', 'md', 'send') + btn('暂存', 'secondary', 'md'), '')
    body = '<div style="display: flex; gap: 20px;"><div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 10px;">%s%s%s</div><div style="width: 1px; background: %s;"></div><div style="width: 380px; flex-shrink: 0;">%s</div></div>' % (
        label('操作步骤'), manual_steps(4), warn, T['line2'], form)
    c = card(manual_head() + body + foot, pad='14px 18px', gap=12)
    frame = mini(c, VW, 504, pad='20px')
    return variant('A7 回填金额不一致', '金额框报错并写明两个金额；出现必填的「差异说明」；主按钮改为「提交并请周敏确认」（R-AP-08）。',
                   frame, VW, trigger='回填金额与审批金额不同。')


# ---------------------------------------------------------------- A8 坐席视角
def a8():
    tabs_html = tabs([('我发起的', 2), ('人工操作清单', 0), ('已处理', None)], '我发起的')
    head = '<div style="background: #ffffff; padding: 14px 20px 0px 20px; border-bottom: 1px solid %s; display: flex; flex-direction: column; gap: 6px;">%s%s</div>' % (
        T['line'], between(text('审批', 18, T['ink'], 700), row(avatar('婷', 'green', 20) + nowrap('李婷 · 坐席', 12, T['ink3']), 6)), '<div style="margin-bottom: -1px;">%s</div>' % tabs_html.replace('border-bottom: 1px solid %s;">' % T['line'], 'border-bottom: 0px;">', 1))
    rows = []
    for no, what in (('AP-20260911-002', '报备快递费用 $8.40 + 良仓创建售后出库单'), ('AP-20260911-004', 'Shopify #1057 改收货地址 · Shopify Admin API')):
        a = P.AP[no]
        rows.append([nowrap(no, 12.5, T['accent'], 600), col(text(a['customer'], 12.5, T['ink'], 600) + ellipsis(what, 12, T['ink3']), 1), state('待审批'),
                     sla('剩 ' + a['left'], 'warning'), nowrap(a['approver'], 12, T['ink2']), btn('撤回', 'secondary', 'sm')])
    tbl = mtable([('审批单', 'left'), ('客户与内容', 'left'), ('状态', 'left'), ('剩余', 'left'), ('审批人', 'left'), ('', 'right')], rows,
                 '128px minmax(0, 1fr) 72px 96px 140px 60px', py=10)
    note = banner('info', '你发起的审批单只读', '批准前可以撤回；撤回后审批单「已撤回」，工单回到提交前状态（一般为「待审草稿」，转人工工单仍为「转人工」），可修改后重新提交。')
    frame = mini(head + '<div style="padding: 16px 20px; display: flex; flex-direction: column; gap: 12px;">%s%s</div>' % (note, tbl), VW, 352)
    return variant('A8 坐席视角', '坐席没有「待我审批」页签；「我发起的」只读，未批准的单可撤回（二次确认）；人工操作清单页签显示指派给自己的待执行项。',
                   frame, VW, trigger='坐席李婷进入「审批」。')


# ---------------------------------------------------------------- A9 转给备用审批人
def a9():
    a = dict(P.AP['AP-20260911-001'], by='周敏')
    top = '<div style="display: flex; align-items: center; gap: 8px; background: %s; border: 1px solid %s; border-radius: 6px; padding: 7px 12px; font-size: 12px; color: %s;">%s<span><b style="color: %s;">备用审批人：王磊</b>　发起人周敏是团队唯一的客服主管，不能审批自己发起的报备，系统已转给你（R-AP-02）。</span></div>' % (
        T['accent_bg'], T['accent_line'], T['ink2'], icon('user', 14, T['accent'], 2), T['accent_ink'])
    c = P.ap_card_expanded(a, top=top)
    head = between(row(avatar('磊', 'amber', 20) + nowrap('王磊 · 售后负责人 · 待我审批', 12, T['ink3'], 600), 6), nowrap('按截止时间', 12, T['ink3']))
    frame = mini(col(head + c, 10), VW, 470, pad='20px')
    return variant('A9 转给备用审批人', '卡片顶部写明「备用审批人：王磊」与转来的原因；王磊按客服主管的权限审批这张含报备的单。周敏打开 P15 时这张单在「我发起的」，没有批准按钮（AC-AP-03、E-28）。',
                   frame, VW, trigger='团队只有一位客服主管周敏，且含报备的审批单由周敏本人发起（本例假设 AP-20260911-001 由周敏接手后提交）。')


def build():
    vs = [a1(), a2(), a3(), a4(), a5(), a6(), a7(), a8(), a9()]
    rows_ = ''
    for k in range(0, len(vs), 2):
        rows_ += grid(''.join(vs[k:k + 2]), template='%dpx %dpx' % (VW, VW), gap=32, extra='align-items: start;')
    leg = row(state('待审批') + state('执行中') + state('已执行') + state('执行失败') + state('已驳回') + state('已撤回') + state('待执行') + state('已回填') + sla('已超时 20m', 'danger'), 6)
    return board('审批状态', 'P15 审批页的空、批准确认、驳回、超时、执行失败、人工操作清单回填、坐席视角与备用审批人。审批单把动作、报备、绑定回复合成一张。演示时刻 %s（A4、A5 为当天稍后的画面）。' % NOW_LABEL,
                 col(rows_, 36), 1920, 800, leg)


if __name__ == '__main__':
    save('StatesApproval.dc.html', build())
    print('ok')
