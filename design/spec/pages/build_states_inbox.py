# -*- coding: utf-8 -*-
"""StatesInbox.dc.html —— 收件箱与工单状态 I1–I18（I16–I18 为第一阶段）。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from data import *  # 含 P1_FACTORY_MAIL（I18 生产厂来信正文）
from inbox_parts import *
from common import mtable, cbox, table_empty, scaled
import build_inbox
import build_tickets

VW = 880  # 变体画面宽度（两列）


def abs_(inner, css):
    return '<div style="position: absolute; %s">%s</div>' % (css, inner)


def scrim_frame(bg_html, dlg, w=VW, h=550):
    return '<div style="width: %dpx; height: %dpx; position: relative; overflow: hidden; background: %s;">%s<div style="position: absolute; inset: 0px; background: rgba(16,24,40,0.45); display: flex; align-items: center; justify-content: center;">%s</div></div>' % (
        w, h, T['canvas'], bg_html, dlg)


# ---------------------------------------------------------------- I1 收件箱加载中
def i1():
    q = ('<div style="width: 308px; flex-shrink: 0; background: #ffffff; border: 1px solid %s; border-radius: 16px; overflow: hidden; display: flex; flex-direction: column;">'
         '<div style="padding: 14px 16px 12px 16px; border-bottom: 1px solid %s; display: flex; flex-direction: column; gap: 10px;">%s%s</div>%s</div>') % (
        T['line'], T['line'], between(text('待处理', 16, T['ink'], 700), skel('84px', 20, 999)), skel('100%', 42, 6), skel_rows(8))
    mid = '<div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; background: #ffffff; border: 1px solid %s; border-radius: 16px; overflow: hidden;"><div style="background: #ffffff; border-bottom: 1px solid %s; padding: 14px 20px; display: flex; flex-direction: column; gap: 10px;">%s%s%s</div><div style="padding: 14px 20px; display: flex; flex-direction: column; gap: 12px;">%s%s%s</div></div>' % (
        T['line'], T['line2'], skel('46%', 16), skel('72%', 10), skel('38%', 10), skel('100%', 56, 8), skel('100%', 92, 8),
        card(col(row(spinner(16) + muted('正在载入 AI 草稿…', 12), 8) + skel('60%', 12) + skel('100%', 10) + skel('94%', 10) + skel('88%', 10) + skel('100%', 10) + skel('52%', 10), 10), pad='14px 16px', tone='accent'))
    right = '<div style="width: 332px; flex-shrink: 0; background: #ffffff; border: 1px solid %s; border-radius: 16px; padding: 16px 18px; display: flex; flex-direction: column; gap: 14px;">%s</div>' % (
        T['line'], ''.join(col(skel('30%', 10) + skel('100%', 12) + skel('80%', 12) + skel('90%', 12), 8) + divider() for _ in range(3)))
    page = app('liting', '收件箱', ['收件箱', '待处理'], three_col(q, mid, right))
    return variant('I1 收件箱加载中', '保留外壳、导航与队列标题，三栏用骨架占位；草稿区显示行内转圈。超过 10 秒转为加载失败（设计规范第 9 节：原因 + 重试）。',
                   build_inbox_scaled(page), VW, trigger='首屏数据超过 300ms 未返回。')


def build_inbox_scaled(page, s=0.6111):
    from common import scaled
    return scaled(page, 1440, 900, s)


# ---------------------------------------------------------------- I2 队列为空
def i2():
    counts = {'需处理': 0, '待审草稿': 0, '转人工': 0, '待审批': 3, '等待中': 8, '全部': 11}
    em = empty('check_c', '需处理已清空', '没有待审草稿，也没有转人工的工单。新来信生成草稿或触发转人工后会自动出现在这里。',
               row(btn('查看全部 11 张', 'secondary', 'sm') + btn('看待审批 3 张', 'ghost', 'sm'), 6), compact=True)
    qc = queue_column(None, '需处理', '<div style="padding-top: 60px;">%s</div>' % em, counts)
    mid = '<div style="flex: 1; display: flex; align-items: center; justify-content: center;">%s</div>' % empty('inbox', '未选择工单', '从左侧队列选择一张工单开始处理。', compact=True)
    frame = mini('<div style="flex: 1; display: flex; min-height: 0px;">%s%s</div>' % (qc, mid), VW, 440)
    return variant('I2 队列为空', '默认分段「需处理」（待审草稿 + 转人工）计数为 0 时列表区显示空状态，给出跳到其他分段的出口；中栏显示未选择。计数随处理实时更新（4 张处理后：待审批 +1、等待中 +3）。',
                   frame, VW, trigger='默认分段「需处理」没有工单（本例：3 张草稿与 1 张转人工都已处理）。')


# ---------------------------------------------------------------- I3 草稿生成中
def i3():
    tabs_html = ver_tabs(SARAH_VERSIONS + [('D', row(spinner(14) + 'D 生成中', 6), '')], 'D',
                         btn('换一版', 'ghost', 'sm', 'refresh', disabled=True, reason='第 D 版生成中，完成后才能再换一版'), keys=False)
    gen = '<div style="border: 1px dashed %s; border-radius: 6px; background: %s; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px;">%s%s%s%s%s</div>' % (
        T['accent_line'], T['subtle'], row(spinner(16) + text('正在生成第 D 版', 13, T['accent_ink'], 700) + muted('约 10 秒 · 已查询订单、物流与 3 条知识', 12), 8),
        skel('100%', 10), skel('92%', 10), skel('97%', 10), skel('58%', 10))
    foot = act_foot(btn('提交审批', 'primary', 'md', icon_right='arrow_r', disabled=True, reason='第 D 版生成中，正文和回复检查还没有结果'),
                    right=nowrap('生成完成前可按 1 / 2 / 3 切回 A / B / C 版', 12, T['ink3']), note=None)
    dc = draft_card('本来信第 4 版 · 最多 5 版', tabs_html, draft_toolbar('English', False, media=False), gen, '', '', '', foot, head_right=chip('生成中', 'neutral', 11))
    frame = mini(dc, VW, 360, pad='20px')
    return variant('I3 草稿生成中', '新版本页签显示转圈并自动选中；正文区骨架 + 进度说明；生成期间正文不可点编辑、「提交审批」不可用，「换一版」置灰（悬停说明原因）。同一来信最多 5 版。',
                   frame, VW, trigger='第 ③ 步进行中，或坐席点「换一版」。')


# ---------------------------------------------------------------- I4 AI 未处理
def i4():
    t = TK['T-20260910-0192']
    t4 = dict(t, status='转人工')
    row_html = queue_row(t4, True, sla('23h 58m', 'normal'), status_html=row(esc_state() + chip('AI 未处理', 'warning', 11, 'alert'), 4))
    left = '<div style="width: 308px; flex-shrink: 0; background: #ffffff; border-right: 1px solid %s; padding: 6px 8px; box-sizing: border-box; display: flex; flex-direction: column; gap: 3px;">%s%s</div>' % (
        T['line'], row_html, queue_row(TK['T-20260910-0195']))
    bn = banner('warning', 'AI 暂不可用，请人工回复', '09-10 16:00 来信时模型服务超时（60 秒未返回）。风险拦截已按关键词规则完成，未命中；本来信未生成草稿，工单记为转人工。恢复后可点「让 AI 起草」。')
    why = '亚马逊站内信不支持图片和链接'
    reply = card(row(nowrap('回复语言', 12, T['ink3']) + select_box('English', width='104px', h=28) + tg(False, '用中文写') + divider(True, 16) +
                     btn('插入图片', 'secondary', 'sm', 'image', disabled=True, reason=why) + btn('插入链接', 'secondary', 'sm', 'link', disabled=True, reason=why), 8) +
                 textarea_box("Hi Sarah,<br><br>I'm sorry the tracking has been stuck since Sep 5. I'm checking with UPS now", st='focus', h=110, counter='96 / 2000') +
                 draft_foot(btn('发送', 'primary', 'md', 'send') + btn('提交审批', 'secondary', 'md') +
                            btn('让 AI 起草', 'secondary', 'md', 'spark', disabled=True, reason='模型服务暂不可用，恢复后自动变为可点'), nowrap('发送前仍会运行回复检查', 12, T['ink3'])),
                 pad='12px 16px', gap=10)
    right = '<div style="flex: 1; min-width: 0px; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px;">%s%s</div>' % (bn, reply)
    frame = mini('<div style="flex: 1; display: flex; min-height: 0px;">%s%s</div>' % (left, right), VW, 360)
    return variant('I4 AI 未处理', '工单状态记为「转人工」并带「AI 未处理」标记，归入转人工分段（6.1）；中栏黄色横幅说明原因，回复框直接可写，「让 AI 起草」置灰直到恢复。人工回复同样要过回复检查。',
                   frame, VW, trigger='模型不可用或生成失败（E-03）。本例为 Sarah 来信（09-10 16:00）时模型超时、2 分钟后的画面。')


# ---------------------------------------------------------------- I5 发送失败
def i5():
    tabs_html = ver_tabs(SARAH_VERSIONS, 'B', '')
    body = body_box(paras(DRAFTS['sarah_B']), hint=EDIT_HINT)
    status = ('<div style="display: flex; align-items: center; gap: 8px; background: %s; border: 1px solid %s; border-radius: 8px; padding: 6px 10px;">%s'
              '<div style="display: flex; flex-direction: column; gap: 1px; min-width: 0px;"><div style="font-size: 12px; font-weight: 600; color: %s; white-space: nowrap;">10:21 发送失败：Gmail 接口超时 · 草稿已保留</div>'
              '<div style="font-size: 11px; color: %s; white-space: nowrap;">第 1 / 3 次自动重试 · 工单仍为「待审草稿」，SLA 继续计时</div></div></div>') % (
        T['bad_bg'], T['bad_line'], icon('alert', 15, T['bad'], 2), T['bad'], T['ink3'])
    foot = draft_foot(btn('48 秒后自动重试', 'primary', 'md', 'refresh', disabled=True, reason='正在倒计时，48 秒后自动重试；想马上发送请点「立即重试」') +
                      btn('立即重试', 'secondary', 'md', 'send') + btn('复制草稿', 'ghost', 'md', 'copy'), status)
    dc = draft_card('B 版无审批项 · 可直接发送', tabs_html, '', body, '', check_row(), '', foot)
    note = row(icon('info', 13, T['ink4']) + nowrap('停留在本页时只在底栏行内提示，不弹右上浮层；离开页面时才弹浮层（不自动消失，带「立即重试」与「回到工单」）。', 12, T['ink3']), 6)
    frame = mini(col(dc + note, 10), VW, 380, pad='20px')
    return variant('I5 发送失败', '失败状态只在底栏行内显示：原因 + 自动重试倒计时（1 分钟后，最多 3 次）+ 立即重试 + 复制草稿；草稿原样保留。坐席离开本页后才弹右上浮层。',
                   frame, VW, trigger='点「发送」后 Gmail 接口超时或返回错误。')


# ---------------------------------------------------------------- I6 他人处理中
def i6():
    bn = banner('info', '陈晨正在处理这张工单', '10:12 开始编辑回复。你可以查看会话和上下文，回复框只读；5 分钟无操作后自动释放。',
                row(btn('申请接手', 'secondary', 'sm', 'handoff') + btn('刷新', 'ghost', 'sm', 'refresh'), 6))
    tabs_html = ver_tabs(SARAH_VERSIONS, 'A', '')
    body = body_box(paras(DRAFTS['sarah_A']), 'readonly', hint='只读 · 陈晨编辑中，点击正文不会进入编辑')
    why = '陈晨正在处理这张工单（编辑锁），申请接手或等 5 分钟无操作自动释放后可用'
    foot = draft_foot(btn('提交审批', 'primary', 'md', icon_right='arrow_r', disabled=True, reason=why) + btn('转人工', 'secondary', 'md', 'handoff', disabled=True, reason=why),
                      row(avatar('晨', 'green', 20) + nowrap('陈晨 编辑中', 12, T['ink2']) + icon('lock', 14, T['ink4']), 6))
    dc = draft_card('09-10 16:01 生成', tabs_html, '', body, '', '', '', foot, head_right=chip('只读', 'muted', 11, 'lock'))
    frame = mini(col(bn + dc, 12), VW, 450, pad='20px')
    return variant('I6 他人处理中', '蓝色横幅写明谁、从何时开始处理；草稿正文只读（浅底，点击不进入编辑），所有写操作置灰并悬停说明原因。客服主管看到的按钮为「强制接手」。',
                   frame, VW, trigger='另一名坐席已开始编辑回复（编辑锁，R-TK-06）。')


# ---------------------------------------------------------------- I7 草稿失效
def i7():
    bn = banner('warning', '编辑期间客户又来了一封信，原草稿已失效', '10:18 Sarah Mitchell 又发来 1 封，系统已为新来信重新生成草稿（10:19）。你在旧稿里改过 1 处，已保存在草稿历史，可一键合并到新稿。')
    newmsg = '<div style="border: 1px solid %s; border-radius: 8px; background: %s; padding: 8px 14px; display: flex; flex-direction: column; gap: 2px;">%s%s</div>' % (
        T['accent_line'], T['accent_bg'], row(chip('新来信', 'accent', 10) + text('Sarah Mitchell', 13, T['ink'], 700) + muted('亚马逊买家消息 · 10:18', 12), 8),
        text(MSG_IN['sarah_followup'], 13, T['ink']))
    # 坐席在旧稿里加的一句、旧稿与新稿正文：data.DRAFTS
    mine = DRAFTS['sarah_edit']
    add = lambda s: '<span style="background: %s; box-shadow: inset 0 -1.5px 0 %s; padding: 0px 1px;">%s</span>' % (T['ok_bg'], T['ok_solid'], s)
    old = body_box('<div>%s %s</div>' % (DRAFTS['sarah_A_stale'], add(mine)), 'stale', pad='8px 12px')
    new = body_box('<div>%s %s</div>' % (DRAFTS['sarah_new'], add(mine)), pad='8px 12px')
    lbl = lambda a, b: row(nowrap(a, 12, T['ink2'], 600) + b, 6)
    legend = row('<span style="display: inline-block; width: 14px; height: 9px; background: %s; box-shadow: inset 0 -1.5px 0 %s;"></span>' % (T['ok_bg'], T['ok_solid']) + nowrap('你的修改（合并后保留）', 11, T['ink3']), 5)
    cmp_ = grid(col(lbl('旧草稿 · A 先补发', state('已失效')) + old, 6) + col(lbl('新草稿 · 合并预览', ai_badge('10:19 生成 · 依据 新来信 + 原 3 条', 11)) + new, 6), 2, 12)
    foot = draft_foot(btn('把我的修改合并到新稿', 'primary', 'md', 'merge') + btn('只用新稿', 'secondary', 'md') +
                      btn('提交审批', 'secondary', 'md', icon_right='arrow_r', disabled=True, reason='旧草稿已失效；请先选择合并或只用新稿，新稿会重新运行回复检查'), legend)
    frame = mini(col(bn + newmsg + card(cmp_ + foot, pad='12px 14px', gap=10), 10), VW, 440, pad='20px')
    return variant('I7 草稿失效', '黄色横幅 + 新消息高亮（强调底）；旧草稿标「已失效」、正文置灰；新稿生成后并排对照，你的修改用绿色底线标出，点「把我的修改合并到新稿」保留这些改动，合并后重新运行回复检查。',
                   frame, VW, trigger='坐席编辑或审阅期间客户来了新信。')


# ---------------------------------------------------------------- I8 提交审批确认
def i8():
    def line(k, v):
        return '<div style="display: flex; gap: 12px; align-items: flex-start; padding: 8px 0px; border-bottom: 1px solid %s;"><div style="width: 64px; flex-shrink: 0; font-size: 12px; color: %s; padding-top: 1px;">%s</div><div style="flex: 1; min-width: 0px; font-size: 13px; color: %s; line-height: 1.55;">%s</div></div>' % (
            T['line2'], T['ink3'], k, T['ink'], v)
    body = col(line('动作', '易仓创建售后出库单：易仓 US · V2 黑色 ×1 · UPS Next Day Air') +
               line('报备', '快递费用 <b>%s</b>' % money(ORDERS['113-4567890-1234567']['resend_freight'])) +
               line('绑定回复', 'English · A 先补发，积加回传已推送易仓且未缺货后自动发出') +
               line('售后单', '同时创建：寄配件 · 易仓有货 · 物流问题（FSH 100%，向 UPS 索赔）') +
               line('审批人', '客服主管 周敏 · 时限 4 小时（14:20 前）'), 0) + \
        row(icon('clock', 14, T['warn'], 2) + text('SLA 剩 %s，短于「审批时限 + 积加补发执行时长」，建议先发进展回复<span style="white-space: nowrap;">（R-SL-05）</span>' % SARAH_T['sla_left'], 12, T['warn'], 600), 6, 'flex-start')
    dlg = dialog('提交审批？', body, btn('取消', 'secondary') + btn('提交审批', 'primary', icon_right='arrow_r'), 520, None, '提交后工单转「待审批」（转人工工单保持「转人工」）。审批通过前，这封回复不会发出。')
    return variant('I8 提交审批确认', '弹窗逐项列出动作、报备、绑定回复（积加回传已推送易仓且未缺货后自动发出）、同时创建的售后单、审批人与时限；SLA 剩余短于「审批时限 + 积加补发执行时长」时提示先发进展回复（R-SL-05）。确认后浮层「已提交审批，周敏会在 4 小时内处理」。',
                   scrim_frame(build_inbox_scaled(build_inbox.p01()), dlg), VW, trigger='草稿含审批项且回复检查通过，点「提交审批」。')


# ---------------------------------------------------------------- I9 SLA 已超时
def i9():
    t = TK['T-20260902-0071']
    rows = queue_row(t, True, sla('已超时 2h 00m', 'danger'), 'danger') + queue_row(TK['T-20260910-0176'], False, sla('已超时 1h 27m', 'danger'))
    left = '<div style="width: 308px; flex-shrink: 0; background: #ffffff; border-right: 1px solid %s;">%s</div>' % (T['line'], rows)
    head = conv_head(dict(t, sla_left='已超时 2h 00m'), '晨', tags=[], actions=icon_btn('more', 'secondary', 28), sla_label='SLA')
    bn = banner('danger', 'SLA 已超时 2 小时', '亚马逊来信 09-10 11:15 到达，24 小时内未回复，已计入平台考核。请尽快回复；客服主管周敏已收到通知。',
                btn('插入进展回复模板', 'secondary', 'sm', 'book'))
    right = '<div style="flex: 1; min-width: 0px; display: flex; flex-direction: column;">%s<div style="padding: 14px 20px;">%s</div></div>' % (head, bn)
    frame = mini('<div style="flex: 1; display: flex; min-height: 0px;">%s%s</div>' % (left, right), VW, 300)
    return variant('I9 SLA 已超时', '队列行 SLA 胶囊改为红色「已超时 N 小时」，并保留红色左条；详情顶部红色横幅。Shopify 与邮件的内部目标超时同样显示，但不计入平台考核。',
                   frame, VW, trigger='来信超过 24 小时未回复（本例为 09-11 13:15 的画面）。')


# ---------------------------------------------------------------- I10 搜索无结果
def i10():
    filt = between(row(filter_chip('状态', '转人工', True) + filter_chip('渠道') + filter_chip('店铺', 'forcome.mx', True) + filter_chip('意图') + filter_chip('情绪') + btn('清除筛选', 'link', 'sm'), 6),
                   row(nowrap('排序', 12, T['ink3']) + select_box('SLA 剩余 · 升序', width='148px', h=28), 6))
    cols = [('', 'left'), ('工单号', 'left'), ('主题', 'left'), ('渠道与店铺', 'left'), ('客户', 'left'), ('状态', 'left'), ('SLA 剩余', 'left')]
    em = empty('search', '没有符合条件的工单', '当前筛选：状态 转人工 · 店铺 forcome.mx。换个条件，或清除筛选后查看全部 13 张。', btn('清除筛选', 'secondary', 'md', 'x'))
    tbl = table_empty(cols, '16px 116px minmax(0, 1fr) 170px 100px 72px 90px', em)
    frame = mini(col(filt + tbl, 10), VW, 380, pad='20px')
    return variant('I10 搜索无结果', '保留筛选条与表头，表体换成空状态，写明当前条件并给出清除筛选。筛选条件保留在地址栏。',
                   frame, VW, trigger='工单列表筛选或搜索结果为空。')


# ---------------------------------------------------------------- I11 合并工单
def i11():
    cur = '<div style="background: %s; border: 1px solid %s; border-radius: 6px; padding: 8px 12px; display: flex; flex-direction: column; gap: 3px;">%s%s</div>' % (
        T['subtle'], T['line'], row(muted('当前工单', 12) + nowrap(MERGE_DEMO['no'], 12, T['ink'], 700) + state('分诊中'), 8), text('%s · %s · 无订单号' % (MERGE_DEMO['subject'], MERGE_DEMO['at']), 13, T['ink2']))
    main_t = next(t for t in TICKETS if t['no'] == 'T-20260902-0071')
    opts = radio_card('%s · %s' % (main_t['no'], main_t['subject']),'%s · %s · 订单 %s · 最近来信 %s' % (main_t['status'], main_t['owner'], main_t['order'], main_t['last_in']), True, None)
    body = cur + label('合并到') + opts + \
        muted('只列出同店铺（Forcome Direct）、同客户（Mateo Rivas）的未关闭工单。合并后当前工单变为「已合并」只读，消息与标签并入主工单。', 12)
    dlg = dialog('合并工单', body, btn('取消', 'secondary') + btn('合并到 T-20260902-0071', 'primary', 'md', 'merge'), 520)
    bg = build_inbox_scaled(build_inbox.p03())
    return variant('I11 合并工单', '选择主工单（单选）；候选只来自同店铺、同客户的未关闭工单；不同店铺的工单不出现。成功后跳转主工单并浮层提示。',
                   scrim_frame(bg, dlg), VW, trigger='演示时刻之后到达的新来信 %s（%s，Mateo Rivas 另开的一封）：在工单列表对它点「合并」。背景为 P03 画面（%s，此时尚无其他未关闭工单），仅示意。' % (MERGE_DEMO['no'], MERGE_DEMO['at'], NOW[-5:]))


# ---------------------------------------------------------------- I12 合并客户身份
def i12():
    def basis(t, ok):
        return row(icon('check_c' if ok else 'x_c', 14, T['ok_solid'] if ok else T['ink4'], 2) + nowrap(t, 12, T['ink'] if ok else T['ink3']), 5)
    cand = '<div style="border: 1.5px solid %s; background: %s; border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px;">%s%s%s</div>' % (
        T['accent'], T['accent_bg'], between(row(text('Sarah Mitchell', 13, T['ink'], 700) + channel('邮件', None, 'forcome.com'), 8), chip('匹配 2 / 3', 'accent', 10)),
        muted('s.mitchell.home@example.com · 来信 1 封（08-22），无订单', 12),
        row(basis('同名', True) + basis('同收货地址（来信中提供）', True) + basis('同邮箱', False), 14))
    body = input_box('Sarah Mitchell', 'focus', icon_name='search') + label('候选客户 · 1 个') + cand + \
        banner('info', '合并后两个身份的工单与订单显示在同一档案', '对客户的回复仍从来信的店铺身份发出，不提及其他店铺的订单。合并记入审计，可拆分。')
    dlg = dialog('合并客户身份', body, btn('取消', 'secondary') + btn('确认合并', 'primary', 'md', 'merge'), 520, None, '把其他身份合并到 Sarah Mitchell（亚马逊 US · Forcome Direct）。')
    bg = build_inbox_scaled(build_tickets.p06())
    return variant('I12 合并客户身份', '搜索候选客户，逐项显示匹配依据（同名、同地址、同邮箱）；人工确认后合并，身份管理里可拆分（二次确认）。',
                   scrim_frame(bg, dlg), VW, trigger='客户档案点「合并身份」。')


# ---------------------------------------------------------------- I13 链接或图片不合规
def i13():
    pop = '<div style="width: 460px; box-sizing: border-box; background: #ffffff; border: 1px solid %s; border-radius: 8px; box-shadow: %s; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px;">%s%s%s%s</div>' % (
        T['line'], SHADOW_MD, text('插入链接', 13, T['ink'], 700),
        field('网址', input_box('https://bit.ly/v2-filter', st='error'), True, error='链接不在白名单：bit.ly。请从素材库选择或联系知识库负责人加白'),
        field('显示文字', input_box('V2 filter care guide')),
        row(spacer() + btn('取消', 'secondary', 'sm') + btn('插入', 'primary', 'sm', disabled=True, reason='链接不在白名单，改用素材库或白名单内的链接后可插入'), 8))
    a = col(label('邮件渠道 · 非白名单链接') + row(btn('插入图片', 'secondary', 'sm', 'image') + btn('插入链接', 'accent_outline', 'sm', 'link') + btn('素材库', 'secondary', 'sm', 'book'), 8) + pop, 10)
    tip = '<div style="position: relative; padding-top: 6px;">%s</div>' % tooltip('亚马逊站内信不支持图片和链接。草稿里的图示步骤已改写为文字步骤。')
    why = '亚马逊站内信不支持图片和链接'
    b = col(label('亚马逊渠道 · 插入按钮置灰') + row(btn('插入图片', 'secondary', 'sm', 'image', disabled=True, reason=why) + btn('插入链接', 'secondary', 'sm', 'link', disabled=True, reason=why), 8) + tip +
            '<div style="margin-top: 6px;">%s</div>' % banner('danger', '回复检查未通过：渠道内容能力', '正文含链接 forcome.com/support。站内信不能带链接，请删除后重新检查。', None) +
            row(btn('提交审批', 'primary', 'md', icon_right='arrow_r', disabled=True, reason='回复检查未通过：正文含链接，删除后重新检查才能提交') + muted('检查通过前不可提交', 12), 8), 10)
    frame = mini('<div style="flex: 1; display: flex; gap: 24px;"><div style="flex: 1; min-width: 0px;">%s</div><div style="width: 1px; background: %s;"></div><div style="width: 330px; flex-shrink: 0;">%s</div></div>' % (a, T['line'], b), VW, 400, pad='20px')
    return variant('I13 链接或图片不合规', '邮件：输入框即时校验白名单，报错写明域名与出路，「插入」禁用。亚马逊：插入按钮置灰，悬停说明原因；正文若仍含链接，回复检查判不通过并禁用提交。',
                   frame, VW, trigger='邮件草稿插入非白名单链接或非素材库图片；亚马逊草稿尝试插入。')


# ---------------------------------------------------------------- I14 未归属店铺队列
def i14():
    def rec(store, basis):
        return '<div style="display: flex; align-items: flex-start; gap: 5px; font-size: 12px; color: %s; line-height: 1.5;"><span style="color: %s; font-weight: 700;">✦</span><div>推荐 <b style="color: %s;">%s</b><span style="color: %s;">（依据：%s）</span></div></div>' % (
            T['ink2'], T['accent'], T['ink'], store, T['ink4'], basis)

    def pick(v):
        return row(select_box('✦ ' + v, width='186px', h=28) + btn('确认', 'primary', 'sm'), 6)
    cols = [('来信', 'left'), ('识别依据 · AI 推荐', 'left'), ('到达 · SLA', 'left'), ('指定店铺（已预选推荐，主管确认）', 'left')]
    # 来信、识别依据与推荐店铺：data.UNASSIGNED_MAIL
    rows = [
        [col(text(m['customer'], 13, T['ink'], 600) + ellipsis(m['subject'], 12, T['ink3']), 1),
         col(text(m['source'], 12, T['warn'], 600) +
             rec(m['store'], '%s · %s 生成' % (m['basis'], m['at'])), 3),
         col(nowrap(m['at'], 12, T['ink2']) + sla(m['sla'], 'normal'), 3), pick(m['store'])]
        for m in UNASSIGNED_MAIL
    ]
    tbl = mtable(cols, rows, 'minmax(0, 1fr) minmax(0, 1.8fr) 100px 250px', py=10)
    head = unassigned_head(len(UNASSIGNED_MAIL))
    note = banner('warning', '%d 封来信识别不出店铺，未生成草稿' % len(UNASSIGNED_MAIL), 'SLA 按原到达时间照常计时。AI 推荐只做预选，主管点「确认」后才归入该店铺队列并开始五步处理（E-13）。')
    tail = row(icon('check_c', 14, T['ok_solid'], 2) + nowrap('确认后浮层「已归入 forcome.mx，正在生成草稿」（5 秒内可撤销），本行移出列表；改选其他店铺同样生效，并记入推荐采纳统计。', 12, T['ink3']), 6)
    frame = mini(col(head + note + tbl + tail, 12), VW, 420, pad='20px')
    return variant('I14 未归属店铺队列', '客服主管周敏的视角（仅客服主管可见，不受店铺数据范围限制；P04 筛选「未归属店铺 2」或收件箱提醒进入）。提示「2 封来信识别不出店铺，未生成草稿 · SLA 按原到达时间照常计时」；每行显示识别依据（收件地址、卖家 ID）与 ✦ AI 推荐店铺（写依据与生成时间），下拉已预选推荐值，主管确认后生效；确认前不生成草稿、不能回复。不设登记入口：管理员登记新店铺后，收件地址匹配的来信会自动归位。',
                   frame, VW, trigger='收件地址或卖家 ID 未登记（E-13、AC-TK-09、AC-TK-11）。')


def unassigned_head(n, hint=True):
    """未归属店铺队列标题行（I14、I17 共用）：标题 + 计数 · 仅客服主管可见、不受店铺数据范围限制 | 自动归位提示（D-24，不设「去登记店铺」入口）。
    hint=False：提示已写在下方横幅里时不重复（I17）。"""
    left = row(text('未归属店铺', 16, T['ink'], 700) + chip(str(n), 'warning', 11) + nowrap('仅客服主管可见 · 不受店铺数据范围限制', 12, T['ink3']), 8)
    right = row(icon('info', 13, T['ink4']) + nowrap('管理员登记新店铺后，收件地址匹配的来信会自动归位', 12, T['ink3']), 5)
    return between(left, right if hint else '')


# ---------------------------------------------------------------- I15 已达 5 版上限
def i15():
    vers = SARAH_VERSIONS + [('D', 'D 先退运费', ''), ('E', 'E 延期说明', '')]
    huan = '<div style="position: relative;">%s<div style="position: absolute; right: 0px; top: 34px; z-index: 2; width: 250px; display: flex; justify-content: flex-end;">%s</div></div>' % (
        btn('换一版', 'ghost', 'sm', 'refresh', disabled=True, reason='本封来信已生成 5 版，达到上限'), tooltip('本封来信已生成 5 版，达到上限。请修改现有版本或手写回复。'))
    tabs_html = ver_tabs(vers, 'A', huan)
    foot = act_foot(btn('提交审批', 'primary', 'md', icon_right='arrow_r'), note=None)
    dc = draft_card('本来信已生成 5 版 · 已达上限', tabs_html, draft_toolbar('English', False, media=False, hint='亚马逊站内信不支持图片和链接'), sarah_body(), '', '', '', foot, gap=8)
    frame = mini(dc, VW, 470, pad='20px')
    return variant('I15 已达 5 版上限', '同一来信最多 5 版（R-DF-01）。第 5 版生成后「换一版」置灰，悬停提示原因；其余操作不受影响，可点正文修改、提交或拒绝后手写。',
                   frame, VW, trigger='同一封来信已有 A–E 共 5 版草稿（AC-AI-05）。')


# ---------------------------------------------------------------- 第一阶段（I16–I18）共用：一个变体里上下放两张画面，各带一行小标题
def cap(t):
    return '<div style="padding: 8px 14px; background: %s; border-bottom: 1px solid %s; font-size: 12px; font-weight: 600; color: %s;">%s</div>' % (
        T['subtle'], T['line'], T['ink2'], t)


def stack(*parts):
    """parts: [(小标题, 画面 html)]，自上而下排列。"""
    out = ''.join('<div style="display: flex; flex-direction: column;%s">%s%s</div>' % (' border-top: 1px solid %s;' % T['line'] if i else '', cap(c), h)
                  for i, (c, h) in enumerate(parts))
    return '<div style="width: %dpx; display: flex; flex-direction: column; background: %s;">%s</div>' % (VW, T['canvas'], out)


# ---------------------------------------------------------------- I16 第一阶段工单列表
def i16():
    main = build_inbox_scaled(build_tickets.p04_p1())
    drill = scaled(build_tickets.p04_p1(True, 520), 1440, 520, 0.6111)
    frame = stack(('① 第一阶段 P04 · 周敏（客服主管）· 共 16 条', main), ('② 从 P17「每日工单量」09-10 的柱下钻进入（局部画面：示例数据只含其中 7 张）', drill))
    return variant('I16 第一阶段工单列表',
                   '按 P04「第一阶段」小节：只读，没有指标行、快捷视图、批量条、选择框、优先级、意图、情绪、负责人、导出、新建工单。筛选 状态 · 渠道 · 店铺 · 站点 · 来源 · 最近来信（近 30 天），条件写在地址栏；右侧「未归属店铺 2」只对客服主管显示，打开 I17。'
                   '列 工单号 · 主题 · 来源（非客户显示徽标）· 渠道与店铺（含站点）· 客户 · 订单号 · 状态 · SLA 剩余 · 最近来信（当天只写时分）。SLA：待回复写最早一封未回复的应回复来信的剩余或「已超时」，Shopify 与邮件加「· 内部」，来源为生产厂的工单写「—」；等客户「已回复」；已解决、已关闭「—」。'
                   '默认排序：已超时在前，其后按剩余升序，再按 待回复 → 等客户 → 已解决 → 已关闭，组内按最近来信倒序。点击行进 I18。② 下钻进入时筛选行多一枚可移除的「来自报表：%s ×」芯片，写「共 %d 条」。' % (P1_DRILL['label'], P1_DRILL['count']),
                   frame, VW, trigger='第一阶段客服主管打开 P04（默认首页）；或从 P17 下钻进入。')


# ---------------------------------------------------------------- I17 第一阶段未归属店铺来信队列
def i17_table(mails, picked=None):
    """没有 ✦ 推荐列；识别依据 = 收件头字段名 + 收件地址 +「未登记」（发件域作补充）；指定店铺下拉未预选，只列当前客服主管的授权店铺。"""
    cols = [('来信', 'left'), ('识别依据', 'left'), ('到达', 'left'), ('SLA', 'left'), ('指定店铺（只列你的授权店铺）', 'left')]
    rows = [[col(text(m['customer'], 13, T['ink'], 600) + ellipsis(m['subject'], 12, T['ink3']), 1),
             col(nowrap(m['to_hdr'], 11, T['ink4']) + row(nowrap(m['to'], 12, T['ink'], 600) + chip('未登记', 'warning', 10), 6) + nowrap('发件域 ' + m['from_domain'], 11, T['ink4']), 2),
             nowrap(m['at'], 12, T['ink2']),
             col(sla(m['sla'], 'normal') + nowrap(m['sla_kind'], 11, T['ink4']), 3),
             row(select_box(None, '选择店铺', width='164px', h=28) + btn('指定', 'primary', 'sm'), 6)] for m in mails]
    return mtable(cols, rows, 'minmax(0, 1fr) minmax(0, 1.3fr) 44px 132px 222px', py=10)


def i17():
    def note(n):
        return banner('warning', '%d 封来信识别不出店铺' % n, 'SLA 按原到达时间照常计时 · 管理员登记新店铺后，收件地址匹配的来信会自动归位')
    mails = UNASSIGNED_MAIL
    tail = row(icon('info', 13, T['ink4']) + nowrap('点「指定」后本行移出；5 秒撤销窗口结束才归并成工单，撤销则来信回到队列、不产生工单。', 12, T['ink3']), 6)
    a = mini(col(unassigned_head(len(mails), False) + note(len(mails)) + i17_table(mails) + tail, 12), VW, 380, pad='20px')
    rest = [m for m in mails if m['store'] != 'forcome.mx']  # Lucía Herrera 已指定到 forcome.mx，移出队列
    ts = '<div style="position: absolute; right: 20px; bottom: 16px;">%s</div>' % toast('success', '已归入 forcome.mx', '5 秒后归并成工单', undo=5, remain=5)
    b = mini(col(unassigned_head(len(rest), False) + note(len(rest)) + i17_table(rest), 12) + ts, VW, 344, pad='20px')
    frame = stack(('① 周敏打开 P04「未归属店铺 2」', a), ('② Lucía Herrera 选 forcome.mx 后点「指定」：本行移出，撤销浮层倒计时', b))
    return variant('I17 第一阶段未归属店铺来信队列',
                   '与 I14 同一入口与位置（仅客服主管可见，不受店铺数据范围限制），但没有 ✦ 推荐列：列为 来信（客户 + 主题）· 识别依据（收件地址 To / Delivered-To +「未登记」）· 到达 · SLA · 指定店铺（下拉未预选，只列周敏的授权店铺）+「指定」。'
                   '② 点「指定」后该行移出，浮层「已归入 forcome.mx · 5 秒后归并成工单 · 撤销」带倒计时；窗口结束才提交归并，撤销后来信回到队列、不产生工单。',
                   frame, VW, trigger='第一阶段店铺识别失败（E-13）：收件地址未登记。')


# ---------------------------------------------------------------- I18 第一阶段工单详情
def mail_hdr(t):
    """来信卡正文顶部的邮件头小字（发件人、Auto-Submitted 等识别依据）。"""
    return '<div style="font-size: 11px; color: %s; line-height: 1.5; margin-bottom: 2px; font-variant-numeric: tabular-nums;">%s</div>' % (T['ink4'], t)


def auto_reply_card(a):
    """带 Auto-Submitted 的我方邮件：灰色虚线卡，写「自动回复 · 不算回复」，不结束 SLA 计时（R-SL-08）。数据取 data.P1_AUTO_REPLY。"""
    av = avatar(icon('send', 13, T['ink4'], 2), 'grey', 28)
    head = row(nowrap('我方', 13, T['ink3'], 600) + nowrap('%s · %s' % (a['from'], a['at'][6:]), 12, T['ink4']) + chip('自动回复 · 不算回复', 'muted', 10), 8)
    bubble = '<div style="background: %s; border: 1px dashed %s; border-radius: 4px 12px 12px 12px; padding: 7px 13px 9px 13px; font-size: 13px; line-height: 1.6; color: %s;">%s%s</div>' % (
        T['subtle'], T['line_strong'], T['ink3'], mail_hdr(a['header']), a['body'])
    return '<div style="display: flex; gap: 10px; align-items: flex-start;">%s<div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 6px;">%s%s</div></div>' % (av, head, bubble)


def i18_kinds():
    """第二张小图：SLA 结果的写法（P1_SLA_KINDS，取自不同工单）· 生产厂来信卡 · 自动回复 · 未回复来信的「标记无需回复」。"""
    slab = card(col(''.join(build_tickets.sla_line(*x) for x in P1_SLA_KINDS), 9), title='SLA 结果 · 写法示例', extra=nowrap('取自不同工单', 11, T['ink3']), pad='12px 16px', gap=10)
    fx = [t for t in P1_EXTRA_TICKETS if t['source'] == '生产厂'][0]
    fav = avatar(icon('factory', 14, T['flow'], 2), 'violet', 28)
    store = [s for s in STORES if s['name'] == fx['store']][0]
    fmail = message(fx['customer'], '邮件 · %s' % fx['last_in'][6:],
                    mail_hdr('发件人 %s → %s' % (fx['from'], store['mailbox'])) + '<b>%s</b><br>%s' % (fx['subject'], P1_FACTORY_MAIL), 'in', fav,
                    build_tickets.source_badge('生产厂', 10) + chip('不计（生产厂）', 'muted', 10) + spacer() + btn('标记无需回复', 'secondary', 'sm', 'check'))
    tl = col(row(nowrap(fx['no'], 12, T['ink3'], 600) + state(fx['status']) + nowrap('· %s' % fx['store'], 12, T['ink3']), 6) +
             fmail + build_tickets.ev(fx['last_in'][6:], '系统', '新建工单，状态「待回复」；来源生产厂，不计工单量与 SLA') +
             auto_reply_card(P1_AUTO_REPLY) + build_tickets.ev(P1_AUTO_REPLY['at'][6:], '系统', '自动回复不算回复，工单保持「待回复」'), 9)
    return mini(grid(slab + tl, template='316px minmax(0, 1fr)', gap=20, extra='align-items: start;'), VW, 380, pad='20px')


def i18():
    frame = stack(('① 第一阶段 P05 · 李婷 · 09-10 09:05 标记致谢来信无需回复之后', build_inbox_scaled(build_tickets.p05_p1())),
                  ('② SLA 结果的写法、来源为生产厂的来信、自动回复，以及未回复来信的「标记无需回复」', i18_kinds()))
    return variant('I18 第一阶段工单详情',
                   '按 P05「第一阶段」小节：只读，标题区没有重新打开、合并、内部备注、导出记录、添加标签与负责人，元信息写自动关闭预计「已解决 · 7 天无来信将于 09-17 09:00 自动关闭（已解决后无来信）」；客户名不是链接。'
                   '全程记录：我方回复卡写「我方 · amz-direct@forcome.com · 经亚马逊买家消息」（回信来自 Gmail「已发送」，对应不到成员）；每次状态迁移一条事件行（系统 / 李婷）；致谢来信卡写「无需回复 · 李婷 · 09:05」，底部浮层「已标记无需回复 · 工单转已解决 · 撤销 4s」。'
                   '右栏：工单信息（店铺、站点、渠道、进线邮箱、来源、订单号）· 订单（平台镜像 · 最近同步 %s）· SLA 结果（每封应回复来信一行）· 状态流转（每步写状态、时间与触发方，最后一步写关闭原因）。'
                   '② 未关闭工单里未回复的来信卡右上有「标记无需回复」；生产厂来信带来源徽标并写「不计（生产厂）」；带 Auto-Submitted 的我方邮件为灰色「自动回复 · 不算回复」。' % CHANNEL_SYNC['SP-API'],
                   frame, VW, trigger='第一阶段打开 P05；画面为 09-10 09:05 李婷标记致谢来信之后。')


def build():
    vs = [i1(), i2(), i3(), i4(), i5(), i6(), i7(), i8(), i9(), i10(), i11(), i12(), i13(), i14(), i15(), i16(), i17(), i18()]
    rows_ = ''
    for k in range(0, len(vs), 2):
        pair = vs[k:k + 2]
        rows_ += grid(''.join(pair), template='%dpx %dpx' % (VW, VW), gap=32, extra='align-items: start;')
    body = col(rows_, 36)
    leg = row(state('待审草稿') + state('待审批') + state('转人工') + state('待回复') + state('已失效') + sla('5h 40m', 'warning') + sla('已超时 2h 00m', 'danger'), 6)
    return board('收件箱与工单状态', 'I1–I18：P01–P06 的加载、空、生成、失败、并发、确认、超时、筛选、合并、渠道内容能力、未归属店铺与草稿版本上限状态，以及第一阶段的工单列表、未归属店铺来信队列与工单详情（I16–I18，D-22、D-24）。画面数据取自 data.py，演示时刻 %s（I9 为 13:15 的画面）。' % NOW_LABEL,
                 body, 1920, 800, leg)


if __name__ == '__main__':
    save('StatesInbox.dc.html', build())
    print('ok')
