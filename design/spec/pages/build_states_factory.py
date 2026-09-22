# -*- coding: utf-8 -*-
"""StatesFactory · 工厂工作台状态板 F1–F9。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from data import *
from as_common import *
import build_factory as BF

W = 864


def task_head(title, st, right, meta):
    return '<div style="display: flex; flex-direction: column; gap: 4px;">%s%s</div>' % (
        between(row('<div style="font-size: 18px; font-weight: 700; color: %s;">%s</div>' % (T['ink'], title) + state(st), 10), right),
        row(meta_line(meta), 10, extra='font-size: 12px; color: %s;' % T['ink3']))


# ---------------------------------------------------------------- F1 待办为空
def f1():
    mid = '<div style="flex: 1; display: flex; align-items: center; justify-content: center;">%s</div>' % card(
        empty('inbox', '暂无待办', '东莞生产厂当前没有需要处理的询价、寄件、比例答复或结算确认。新任务会推送到企业即时通讯。',
              row(btn('查看已完成', 'secondary') + btn('查看结算', 'secondary'), 8)), pad='8px 24px')
    body = '<div style="flex: 1; min-height: 0px; display: flex; flex-direction: row;">%s%s</div>' % (BF.f_list(empty=True), mid)
    return scaled(factory_app('待办', ['待办'], body, badges={}), 1440, 900, 0.6)


# ---------------------------------------------------------------- F2 报价校验
def f2():
    return frame(cap('金额为空、为 0，日期早于今天') + BF.quote_form('err_a') + cap('金额超过两位小数') + BF.quote_form('err_b'))


# ---------------------------------------------------------------- F3 提交成功
def f3():
    page = BF.p21(override={'S-20260911-0019': ('已提交', '已报价 $18.00，等 FSH 报备')}, st='已提交', form_html=BF.submitted_card(),
                  head_right=nowrap('提交于 10:22', 12, T['ink3']), badges={},
                  thread_extra=sys_comment('10:22', '陈工提交报价：产品成本 $5.20、运费 $12.80，已写入登记台账，已通知王磊。'))
    t = toast('success', '报价已提交', 'S-20260911-0019 已转为「已提交」。FSH 报备通过后会生成寄件任务并推送给你。')
    return toast_at(scaled(page, 1440, 900, 0.6), t, W, 540)


# ---------------------------------------------------------------- F4 回填单号
def f4():
    head = task_head('寄件 · S-20260911-0018', '待处理', sla('剩 3 个工作日', 'normal'), ['派发 09-11 13:45', '报备已批准 · 快递费用 $11.50', 'FSH 对接人 王磊'])
    recv = card(grid(stat('收件人', 'Laura Bennett') + stat('电话', '+1 404-555-0182') + stat('配件', 'HEPA 滤芯组件 FC-V2-HF01 ×1') +
                     '<div style="grid-column: span 2;">%s</div>' % stat('地址', '1180 Peachtree St NE, Atlanta, GA 30309, United States') + stat('承运方式', '云途专线（报价时选择）'), 3, 12) +
                row(icon('lock', 13, T['ink4']) + nowrap('收件信息仅用于本次寄件，寄件完成 30 天后隐藏。', 12, T['ink3']), 6),
                '收件信息', link('复制地址', 12, 'copy'), pad='14px 16px', gap=10)
    form = card(grid(field('快递单号', input_box('YT2625100012351234', mono=True), True) +
                     field('实际运费', input_box('13.20', prefix='$', suffix='USD', mono=True), True, hint='报备金额 $11.50') +
                     field('寄出日期', input_box('2026-09-12', icon_name='calendar', mono=True), True) +
                     field('面单照片', row(img_thumb('面单 1', 64, 32) + btn('上传', 'secondary', 'sm', 'upload'), 8)), 4, 12) +
                banner('warning', '实际运费 $13.20 超出报备金额 $11.50 的 10%（+14.8%）', '可以照常提交。提交后 FSH 会自动发起补充报备，不影响已寄出的包裹。') +
                between(muted('单号与实际运费提交后直接写入 FSH 登记台账，并由 FSH 回复客户。', 12), btn('提交单号', 'primary', 'md', 'send')),
                '回填单号', nowrap('单号只能包含字母和数字', 12, T['ink3']), pad='14px 16px', gap=12)
    return frame(head + recv + form, bg='#ffffff', pad='16px 20px')


# ---------------------------------------------------------------- F5 比例答复
def f5():
    head = task_head('比例协商 · S-20260911-0018', '待处理', sla('剩 3 个工作日', 'normal'), ['FSH 提案 09-12 09:10', '第 1 轮，最多 3 轮', 'FSH 对接人 王磊'])
    big = '<div style="font-size: 20px; font-weight: 700; color: %s; font-variant-numeric: tabular-nums;">工厂 100%%</div>' % T['ink']
    prop = card(row(big + nowrap('FSH 0% · 费用 $14.70 = 产品成本 $3.20 + 运费 $11.50 + 额外赔偿 $0.00 + 其他 $0.00', 12, T['ink3']), 10, 'baseline') +
                text('依据：产品质量问题。HEPA 滤芯发黄、吸力下降，排查两轮未解决，在保修期内。', 12, T['ink2']),
                'FSH 提案', nowrap('王磊 · 09-12 09:10', 12, T['ink3']), pad='12px 16px', gap=8)
    choice = row(radio_card('接受', '工厂承担 100%，$14.70') + radio_card('还价', '提出新的比例与理由', True) + radio_card('拒绝', '需填写理由，转双方负责人商定'), 8, 'stretch')
    form = grid(field('工厂承担', input_box('50', suffix='%', mono=True), True) + field('FSH 承担', input_box('50', suffix='%', st='readonly', mono=True), hint='按 100 减去工厂比例') +
                '<div style="grid-column: span 2;">%s</div>' % field('还价理由', textarea_box(None, '说明为什么调整比例，例如来料批次、检测结论；可附图', 'error', 56, '0 / 200'), True, error='还价需要填写理由'), 4, 12)
    ans = card(choice + form + between(muted('答复后写入登记台账；FSH 可接受、再次提案或升级双方负责人。', 12), btn('提交答复', 'primary', 'md', 'send')),
               '你的答复', pad='12px 16px', gap=12)
    return frame(head + prop + ans, bg='#ffffff', pad='16px 20px')


# ---------------------------------------------------------------- F6 越权
def f6():
    mid = '<div style="flex: 1; display: flex; align-items: center; justify-content: center;">%s</div>' % card(
        no_permission('没有访问权限', '这张单据不属于东莞生产厂。工厂工作台只显示本厂任务，本次访问已记录。', btn('返回待办', 'primary', 'md', 'chev_l')), pad='8px 24px')
    return scaled(factory_app('待办', ['待办', '单据详情'], mid), 1440, 900, 0.6)


# ---------------------------------------------------------------- F7 网络失败
def f7():
    page = BF.p21(form_st='filled')
    t = toast('error', '提交失败：网络不可用', '报价内容已保留在表单里，恢复连接后点「重试」即可，不需要重新填写。', row(link('重试', 12, 'refresh') + link('复制报价内容', 12, 'copy'), 12))
    return toast_at(scaled(page, 1440, 900, 0.6), t, W, 540)


# ---------------------------------------------------------------- F8 结算确认
def f8():
    b = SETTLE_BATCHES[1]
    head = task_head('结算确认 · 批次 2026-09-B', '待处理', sla('5 个工作日内确认', 'normal'), ['10-05 09:00 自动生成', '%d 单' % len(b['items']), '国庆假期不计入时限', 'FSH 对接人 王磊'])
    cols = [('售后单号', 'left'), ('配件', 'left'), ('责任', 'left'), ('费用合计', 'right'), ('FSH / 工厂 %', 'left'), ('工厂承担', 'right')]
    rows = []
    for no in b['items']:
        a = AS[no]
        rows.append([nowrap(no, 12.5, T['ink'], 600), ellipsis('%s ×%d' % (PARTS[a['part']], a['qty']), 12.5, T['ink2']), cat(a['resp']), money(total(a)),
                     nowrap('%d / %d' % a['ratio'], 12.5, T['ink2']), nowrap(money(factory_share(a)), 12.5, T['ink'], 700)])
    amt = round(sum(factory_share(AS[x]) for x in b['items']), 2)
    tbl = table(cols, rows, '136px minmax(0, 1fr) 104px 76px 92px 80px', footer=[nowrap('合计 · %d 单' % len(b['items']), 12.5, T['ink'], 700), '', '', '', '', money(amt)])
    note = row(icon('info', 14, T['ink4']) + nowrap('只含比例已确认的售后单；点行可展开产品成本、运费、额外赔偿、其他四项。', 12, T['ink3']), 6)
    choice = row(radio_card('确认', '同意本批次工厂承担 %s' % money(amt)) + radio_card('有异议', '批次保持待确认，王磊会收到通知', True), 8, 'stretch')
    reason = field('异议理由', textarea_box(None, '写明哪一单、哪一项金额或比例有异议', 'error', 56, '0 / 200'), True, error='有异议需要填写理由')
    ans = card(choice + reason + between(muted('双方确认后批次转「已结算」；有异议时王磊核对后重新推送，需改比例的在下一批次冲销（Q-13）。', 12), btn('提交', 'primary', 'md', 'send')),
               '你的确认', pad='12px 16px', gap=12)
    return frame(head + tbl + note + ans, bg='#ffffff', pad='16px 20px')


# ---------------------------------------------------------------- F9 手机端
def phone(inner):
    return '<div style="width: 375px; height: 720px; box-sizing: border-box; border: 1px solid %s; border-radius: 24px; overflow: hidden; background: %s; display: flex; flex-direction: column; flex-shrink: 0;">%s</div>' % (
        T['line_strong'], T['canvas'], inner)


def m_bar(left, right=''):
    return '<div style="background: #ffffff; border-bottom: 1px solid %s; padding: 14px 16px 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">%s%s</div>' % (T['line'], left, right)


def f9():
    import build_factory as BF2
    opens = BF2.OPEN_TASKS
    cards = ''
    for t in opens:
        due = sla(t['due'], 'normal') if t.get('due') else nowrap(t.get('note', ''), 12, T['ink3'])
        cards += '<div style="background: #ffffff; border: 1px solid %s; border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px;">%s%s%s</div>' % (
            T['line'], between(row(cat(t['type']) + nowrap(t['aftersales'], 13, T['ink'], 700), 6), state(t['state'])), text(t['item'], 12.5, T['ink2']), between(due, nowrap(t['at'], 11, T['ink4'])))
    nav = '<div style="margin-top: auto; background: #ffffff; border-top: 1px solid %s; display: grid; grid-template-columns: repeat(3, 1fr); padding: 8px 0px 14px 0px;">%s</div>' % (
        T['line'], ''.join('<div style="display: flex; flex-direction: column; align-items: center; gap: 3px; font-size: 11px; font-weight: %d; color: %s;">%s%s</div>' % (
            700 if n == '待办' else 500, T['accent'] if n == '待办' else T['ink3'], icon(ic, 20, T['accent'] if n == '待办' else T['ink3']), n) for n, ic in [('待办', 'inbox'), ('已完成', 'check_c'), ('结算', 'money')]))
    p1 = phone(m_bar(col(row(text('待办', 17, T['ink'], 700) + chip(str(len(opens)), 'accent', 11), 6) + nowrap('东莞生产厂 · 陈工', 12, T['ink3']), 2), icon_btn('bell', 'secondary', 30)) +
               '<div style="padding: 12px 14px; display: flex; flex-direction: column; gap: 10px;">%s%s</div>' % (seg(['全部 %d' % len(opens), '待处理 1', '已提交 2'], '全部 %d' % len(opens), 'sm'), cards) + nav)
    need = '<div style="background: #ffffff; border: 1px solid %s; border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px;">%s%s%s%s</div>' % (
        T['line'], kv('配件', '软管 FC-V2-HS02 ×2'), kv('寄往', '德国 10115'), text('软管在接口处开裂，吸尘时漏气。', 12.5, T['ink2']), row(img_thumb('照片 1', 64, 48) + img_thumb('照片 2', 64, 48), 8))
    form = col(field('产品成本', input_box('5.20', prefix='$', suffix='USD', mono=True), True) +
               field('运费', input_box('12.80', prefix='$', suffix='USD', mono=True), True) +
               field('承运方式', select_box('云途专线')) +
               field('可寄出日期', input_box('2026-09-14', icon_name='calendar', mono=True), True), 10)
    sticky = '<div style="margin-top: auto; background: #ffffff; border-top: 1px solid %s; padding: 10px 14px 16px 14px; display: flex; gap: 8px; box-shadow: 0 -4px 12px rgba(16,24,40,0.06);">%s%s</div>' % (
        T['line'], btn('无法供货', 'danger_outline'), btn('提交报价', 'primary', 'md', 'send', full=True))
    p2 = phone(m_bar(row(icon('chev_l', 18, T['ink2']) + col(text('询价 · S-20260911-0019', 14, T['ink'], 700) + nowrap('派发 09-11 08:50', 11, T['ink3']), 1), 6), sla('剩 2 个工作日', 'normal')) +
               '<div style="padding: 12px 14px; display: flex; flex-direction: column; gap: 12px; overflow: hidden;">%s%s</div>' % (need, form) + sticky)
    return '<div style="display: flex; gap: 32px; padding: 20px; background: %s;">%s%s</div>' % (T['canvas'], p1, p2)


def build():
    V = lambda t, spec, f, trig: variant(t, spec, f, W, trigger=trig)
    body = col(
        grid(V('F1 待办为空', '左栏与中栏显示空状态，说明新任务从哪里来；底部本月应承担保留。', f1(), '本厂没有待处理或已提交的任务') +
             V('F2 报价校验', '金额必填、大于 0、最多两位小数；可寄出日期不早于今天。失焦校验单项，提交时校验全部。', f2(), '提交报价时表单不符合要求'), 2, 32) +
        grid(V('F3 提交成功', '成功浮层；左栏任务转「已提交」，中栏表单变为只读结果；本单沟通追加系统记录。报价直接写入登记台账（R-FT-03）。', f3(), '报价校验通过并提交') +
             V('F4 回填单号', '寄件任务可见收件人姓名、完整地址、电话（R-FT-02）；回填快递单号与实际运费。实际运费超报备 10% 以上时黄色提示将触发补充报备（R-FL-05）。', f4(),
               '报备通过后生成寄件任务，生产厂寄出后回填'), 2, 32) +
        grid(V('F5 比例答复', '接受、还价、拒绝三选一；还价需填新比例与理由，拒绝需填理由。第 3 轮后仍未达成转待升级（R-AS-06）。', f5(), 'FSH 在工厂工作台发起比例提案') +
             V('F6 越权', '打开他厂单据链接时显示无权限，不透露单据内容，记审计日志（E-24）。', f6(), '生产厂对接人访问不属于本厂的售后单或任务'), 2, 32) +
        grid(V('F7 网络失败', '失败浮层不自动消失，表单内容保留，提供重试；按钮恢复可点。', f7(), '提交报价、单号或答复时网络中断或服务超时') +
             V('F8 结算确认', '批次明细与合计（工厂承担 $21.95）；「确认」或「有异议」二选一，有异议必须填理由，批次保持待确认并通知王磊（E-30、AC-AS-19）。', f8(), '批次 2026-09-B 于 10-05 生成并推送（未来画面）'), 2, 32) +
        grid(V('F9 手机端', '375 宽单栏：待办卡片列表 + 底部导航；任务详情表单纵向排列，「提交报价」固定在底部。字段、校验与桌面端一致。', f9(), '陈工在手机浏览器打开企业即时通讯推送的任务链接'), 2, 32),
        40)
    return board('工厂工作台状态', '东莞生产厂对接人陈工在工厂工作台的空、校验、成功、回填、答复、越权、失败、结算确认与手机端状态（F1–F9）。演示时刻 %s；寄件与比例答复为报备通过后的后续画面。' % NOW_LABEL, body, 1920, 2879)


if __name__ == '__main__':
    save('StatesFactory.dc.html', build())
    print('ok')
