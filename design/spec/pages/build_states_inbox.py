# -*- coding: utf-8 -*-
"""StatesInbox.dc.html —— 收件箱与工单状态 I1–I15。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from data import *
from inbox_parts import *
from common import mtable, cbox, table_empty
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
    return variant('I1 收件箱加载中', '保留外壳、导航与队列标题，三栏用骨架占位；草稿区显示行内转圈。超过 10 秒转为全局 G4 加载失败。',
                   build_inbox_scaled(page), VW, trigger='首屏数据超过 300ms 未返回。')


def build_inbox_scaled(page, s=0.6111):
    from common import scaled
    return scaled(page, 1440, 900, s)


# ---------------------------------------------------------------- I2 队列为空
def i2():
    counts = {'待审草稿': 0, '转人工': 1, '待审批': 3, '等待中': 7, '全部': 11}
    em = empty('check_c', '待审草稿已清空', '没有待你审阅的草稿。新来信生成草稿后会自动出现在这里。', row(btn('查看全部 11 张', 'secondary', 'sm') + btn('看转人工 1 张', 'ghost', 'sm'), 6), compact=True)
    qc = queue_column(None, '待审草稿', '<div style="padding-top: 60px;">%s</div>' % em, counts)
    mid = '<div style="flex: 1; display: flex; align-items: center; justify-content: center;">%s</div>' % empty('inbox', '未选择工单', '从左侧队列选择一张工单开始处理。', compact=True)
    frame = mini('<div style="flex: 1; display: flex; min-height: 0px;">%s%s</div>' % (qc, mid), VW, 440)
    return variant('I2 队列为空', '分段计数为 0 时列表区显示空状态，给出跳到其他分段的出口；中栏显示未选择。计数随处理实时更新（3 张草稿处理后：待审批 +1、等待中 +2）。',
                   frame, VW, trigger='当前分段没有工单（本例：待审草稿已全部处理）。')


# ---------------------------------------------------------------- I3 草稿生成中
def i3():
    tabs_html = ver_tabs(SARAH_VERSIONS + [('D', row(spinner(14) + 'D 生成中', 6), '')], 'D', btn('换一版', 'ghost', 'sm', 'refresh', disabled=True))
    gen = '<div style="border: 1px dashed %s; border-radius: 6px; background: %s; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px;">%s%s%s%s%s</div>' % (
        T['accent_line'], T['subtle'], row(spinner(16) + text('正在生成第 D 版', 13, T['accent_ink'], 700) + muted('约 10 秒 · 已查询订单、物流与 3 条知识', 12), 8),
        skel('100%', 10), skel('92%', 10), skel('97%', 10), skel('58%', 10))
    foot = draft_foot(btn('提交审批', 'primary', 'md', icon_right='arrow_r', disabled=True) + btn('修改', 'secondary', 'md', 'edit', disabled=True) + btn('转人工', 'secondary', 'md', 'handoff'),
                      nowrap('生成完成前可切回 A / B / C 版', 12, T['ink3']))
    dc = draft_card('本来信第 4 版 · 最多 5 版', tabs_html, draft_toolbar('English', False, media=False), gen, '', '', '', foot, head_right=chip('生成中', 'neutral', 11))
    frame = mini(dc, VW, 360, pad='20px')
    return variant('I3 草稿生成中', '新版本页签显示转圈并自动选中；正文区骨架 + 进度说明；生成期间「提交审批」「修改」不可用，「换一版」置灰。同一来信最多 5 版。',
                   frame, VW, trigger='第 ③ 步进行中，或坐席点「换一版」。')


# ---------------------------------------------------------------- I4 AI 未处理
def i4():
    t = TK['T-20260910-0192']
    row_html = queue_row(t, True, sla(t['sla_left'], t['sla_level']))
    row_html = row_html.replace(state('待审草稿'), chip('AI 未处理', 'warning', 11, 'alert'))
    left = '<div style="width: 320px; flex-shrink: 0; background: #ffffff; border-right: 1px solid %s;">%s%s</div>' % (T['line'], row_html, queue_row(TK['T-20260910-0195']))
    bn = banner('warning', 'AI 暂不可用，请人工回复', '模型服务 10:05 起不可用。风险拦截已按关键词规则完成，未命中；本来信未生成草稿。恢复后可点「让 AI 起草」。')
    reply = card(row(nowrap('回复语言', 12, T['ink3']) + select_box('English', width='104px', h=28) + tg(False, '用中文写') + divider(True, 16) +
                     btn('插入图片', 'secondary', 'sm', 'image', disabled=True) + btn('插入链接', 'secondary', 'sm', 'link', disabled=True), 8) +
                 textarea_box("Hi Sarah,<br><br>I'm sorry the tracking has been stuck since Sep 5. I'm checking with UPS now", st='focus', h=110, counter='96 / 2000') +
                 draft_foot(btn('发送', 'primary', 'md', 'send') + btn('提交审批', 'secondary', 'md') + btn('让 AI 起草', 'secondary', 'md', 'spark', disabled=True), nowrap('发送前仍会运行回复检查', 12, T['ink3'])),
                 pad='12px 16px', gap=10)
    right = '<div style="flex: 1; min-width: 0px; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px;">%s%s</div>' % (bn, reply)
    frame = mini('<div style="flex: 1; display: flex; min-height: 0px;">%s%s</div>' % (left, right), VW, 360)
    return variant('I4 AI 未处理', '队列行状态处显示「AI 未处理」；中栏黄色横幅说明原因，回复框直接可写，「让 AI 起草」置灰直到恢复。人工回复同样要过回复检查。',
                   frame, VW, trigger='模型不可用或生成失败（E-03）。')


# ---------------------------------------------------------------- I5 发送失败
def i5():
    tabs_html = ver_tabs(SARAH_VERSIONS, 'B', '')
    body = body_box(paras(DRAFTS['sarah_B']))
    foot = draft_foot(btn('48 秒后自动重试', 'primary', 'md', 'refresh', disabled=True) + btn('立即重试', 'secondary', 'md', 'send') + btn('复制草稿', 'ghost', 'md', 'copy'),
                      row(icon('alert', 14, T['bad'], 2) + nowrap('10:21 经亚马逊买家消息发送失败，草稿已保留', 12, T['bad']), 6))
    dc = draft_card('B 版无审批项 · 可直接发送', tabs_html, '', body, '', check_row(), '', foot)
    tst = toast('error', '发送失败：Gmail 接口超时', '草稿已保留，48 秒后自动重试。工单仍为「待审草稿」，SLA 继续计时。', row(link('立即重试') + link('复制草稿'), 12))
    frame = mini(dc + abs_(tst, 'top: 14px; right: 16px;'), VW, 390, pad='64px 20px 20px 20px')
    return variant('I5 发送失败', '失败浮层不自动消失；草稿原样保留；主按钮变为倒计时（1 分钟后自动重试，最多 3 次），旁边提供立即重试与复制草稿。',
                   frame, VW, trigger='点「发送」后 Gmail 接口超时或返回错误。')


# ---------------------------------------------------------------- I6 他人处理中
def i6():
    bn = banner('info', '陈晨正在处理这张工单', '10:12 开始编辑回复。你可以查看会话和上下文，回复框只读；5 分钟无操作后自动释放。',
                row(btn('申请接手', 'secondary', 'sm', 'handoff') + btn('刷新', 'ghost', 'sm', 'refresh'), 6))
    tabs_html = ver_tabs(SARAH_VERSIONS, 'A', '')
    body = body_box(paras(DRAFTS['sarah_A']), 'readonly')
    foot = draft_foot(btn('提交审批', 'primary', 'md', icon_right='arrow_r', disabled=True) + btn('修改', 'secondary', 'md', 'edit', disabled=True) + btn('转人工', 'secondary', 'md', 'handoff', disabled=True),
                      row(avatar('晨', 'green', 20) + nowrap('陈晨 编辑中', 12, T['ink2']) + icon('lock', 14, T['ink4']), 6))
    dc = draft_card('09-10 16:01 生成', tabs_html, '', body, '', '', '', foot, head_right=chip('只读', 'muted', 11, 'lock'))
    frame = mini(col(bn + dc, 12), VW, 450, pad='20px')
    return variant('I6 他人处理中', '蓝色横幅写明谁、从何时开始处理；草稿与回复框只读（浅底），所有写操作置灰。客服主管看到的按钮为「强制接手」。',
                   frame, VW, trigger='另一名坐席已开始编辑回复（编辑锁，R-TK-06）。')


# ---------------------------------------------------------------- I7 草稿失效
def i7():
    bn = banner('warning', '编辑期间客户又来了一封信，原草稿已失效', '10:18 Sarah Mitchell 又发来 1 封。系统正在为新来信重新生成草稿；你改过的内容已保存在草稿历史。',
                btn('查看新草稿', 'secondary', 'sm'))
    newmsg = '<div style="border: 1px solid %s; border-radius: 8px; background: %s; padding: 10px 14px; display: flex; flex-direction: column; gap: 4px;">%s%s</div>' % (
        T['accent_line'], T['accent_bg'], row(chip('新来信', 'accent', 10) + text('Sarah Mitchell', 13, T['ink'], 700) + muted('亚马逊买家消息 · 10:18', 12), 8),
        text('Any update on this? I leave Tuesday morning and really need it before then.', 13, T['ink']))
    stale = draft_card('09-10 16:01 生成 · A 先补发', '', '', body_box(paras(DRAFTS['sarah_A'].split('\n\n')[1]), 'stale'), '', '', '',
                       draft_foot(btn('提交审批', 'primary', 'md', icon_right='arrow_r', disabled=True) + btn('基于新来信重新生成', 'secondary', 'md', 'refresh', loading=True), ''),
                       head_right=state('已失效'))
    frame = mini(col(bn + newmsg + stale, 10), VW, 356, pad='20px')
    return variant('I7 草稿失效', '黄色横幅 + 新消息高亮（强调底）；旧草稿标「已失效」、正文置灰、提交不可用；系统自动为新来信重新生成。',
                   frame, VW, trigger='坐席编辑或审阅期间客户来了新信。')


# ---------------------------------------------------------------- I8 提交审批确认
def i8():
    def line(k, v):
        return '<div style="display: flex; gap: 12px; align-items: flex-start; padding: 8px 0px; border-bottom: 1px solid %s;"><div style="width: 64px; flex-shrink: 0; font-size: 12px; color: %s; padding-top: 1px;">%s</div><div style="flex: 1; min-width: 0px; font-size: 13px; color: %s; line-height: 1.55;">%s</div></div>' % (
            T['line2'], T['ink3'], k, T['ink'], v)
    body = col(line('动作', '良仓创建售后出库单：良仓 US · V2 黑色 ×1 · UPS Next Day Air') +
               line('报备', '快递费用 <b>$12.40</b>') +
               line('绑定回复', 'English · A 先补发，发货单创建成功后自动发出') +
               line('售后单', '同时创建：寄配件 · 良仓有货 · 物流问题（FSH 100%，向 UPS 索赔）') +
               line('审批人', '客服主管 周敏 · 时限 4 小时（14:20 前）'), 0) + \
        muted('SLA 剩 5h 40m，长于审批时限，不需要先发进展回复。', 12)
    dlg = dialog('提交审批？', body, btn('取消', 'secondary') + btn('提交审批', 'primary', icon_right='arrow_r'), 520, None, '提交后工单转「待审批」（转人工工单保持「转人工」）。审批通过前，这封回复不会发出。')
    return variant('I8 提交审批确认', '弹窗逐项列出动作、报备、绑定回复、同时创建的售后单、审批人与时限。确认后浮层「已提交审批，周敏会在 4 小时内处理」。',
                   scrim_frame(build_inbox_scaled(build_inbox.p01()), dlg), VW, trigger='草稿含审批项且回复检查通过，点「提交审批」。')


# ---------------------------------------------------------------- I9 SLA 已超时
def i9():
    t = TK['T-20260902-0071']
    rows = queue_row(t, True, sla('已超时 2h 00m', 'danger'), 'danger') + queue_row(TK['T-20260910-0176'], False, sla('已超时 1h 27m', 'danger'))
    left = '<div style="width: 320px; flex-shrink: 0; background: #ffffff; border-right: 1px solid %s;">%s</div>' % (T['line'], rows)
    head = conv_head(dict(t, sla_left='已超时 2h 00m'), '晨', actions=icon_btn('more', 'secondary', 28), sla_label='SLA')
    bn = banner('danger', 'SLA 已超时 2 小时', '亚马逊来信 09-10 11:15 到达，24 小时内未回复，已计入平台考核。请尽快回复；客服主管周敏已收到通知。',
                btn('插入进展回复模板', 'secondary', 'sm', 'book'))
    right = '<div style="flex: 1; min-width: 0px; display: flex; flex-direction: column;">%s<div style="padding: 14px 20px;">%s</div></div>' % (head, bn)
    frame = mini('<div style="flex: 1; display: flex; min-height: 0px;">%s%s</div>' % (left, right), VW, 300)
    return variant('I9 SLA 已超时', '队列行 SLA 胶囊改为红色「已超时 N 小时」，并保留红色左条；详情顶部红色横幅。Shopify 与邮件的内部目标超时同样显示，但不计入平台考核。',
                   frame, VW, trigger='来信超过 24 小时未回复（本例为 09-11 13:15 的画面）。')


# ---------------------------------------------------------------- I10 搜索无结果
def i10():
    filt = between(row(filter_chip('状态', '转人工', True) + filter_chip('渠道') + filter_chip('店铺', 'forcome.eu', True) + filter_chip('意图') + filter_chip('情绪') + btn('清除筛选', 'link', 'sm'), 6),
                   row(nowrap('排序', 12, T['ink3']) + select_box('SLA 剩余 · 升序', width='148px', h=28), 6))
    cols = [('', 'left'), ('工单号', 'left'), ('主题', 'left'), ('渠道与店铺', 'left'), ('客户', 'left'), ('状态', 'left'), ('SLA 剩余', 'left')]
    em = empty('search', '没有符合条件的工单', '当前筛选：状态 转人工 · 店铺 forcome.eu。换个条件，或清除筛选后查看全部 13 张。', btn('清除筛选', 'secondary', 'md', 'x'))
    tbl = table_empty(cols, '16px 116px minmax(0, 1fr) 170px 100px 72px 90px', em)
    frame = mini(col(filt + tbl, 10), VW, 380, pad='20px')
    return variant('I10 搜索无结果', '保留筛选条与表头，表体换成空状态，写明当前条件并给出清除筛选。筛选条件保留在地址栏。',
                   frame, VW, trigger='工单列表筛选或搜索结果为空。')


# ---------------------------------------------------------------- I11 合并工单
def i11():
    cur = '<div style="background: %s; border: 1px solid %s; border-radius: 6px; padding: 8px 12px; display: flex; flex-direction: column; gap: 3px;">%s%s</div>' % (
        T['subtle'], T['line'], row(muted('当前工单', 12) + nowrap('T-20260911-0038', 12, T['ink'], 700) + state('分诊中'), 8), text('Wo bleibt meine Erstattung? · 09-11 10:05 · 无订单号', 13, T['ink2']))
    opts = radio_card('T-20260902-0071 · Gerät funktioniert nach 2 Wochen nicht mehr', '转人工 · 陈晨 · 订单 302-8811234-9901122 · 最近来信 09-10 11:15', True, None)
    body = cur + label('合并到') + opts + \
        muted('只列出同店铺（Forcome Direct）、同客户（Jonas Weber）的未关闭工单。合并后当前工单变为「已合并」只读，消息与标签并入主工单。', 12)
    dlg = dialog('合并工单', body, btn('取消', 'secondary') + btn('合并到 T-20260902-0071', 'primary', 'md', 'merge'), 520)
    bg = build_inbox_scaled(build_inbox.p03())
    return variant('I11 合并工单', '选择主工单（单选）；候选只来自同店铺、同客户的未关闭工单；不同店铺的工单不出现。成功后跳转主工单并浮层提示。',
                   scrim_frame(bg, dlg), VW, trigger='在收件箱或工单列表点「合并」。')


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
        row(spacer() + btn('取消', 'secondary', 'sm') + btn('插入', 'primary', 'sm', disabled=True), 8))
    a = col(label('邮件渠道 · 非白名单链接') + row(btn('插入图片', 'secondary', 'sm', 'image') + btn('插入链接', 'accent_outline', 'sm', 'link') + btn('素材库', 'ghost', 'sm', 'book'), 8) + pop, 10)
    tip = '<div style="position: relative; padding-top: 6px;">%s</div>' % tooltip('亚马逊站内信不支持图片和链接。草稿里的图示步骤已改写为文字步骤。')
    b = col(label('亚马逊渠道 · 插入按钮置灰') + row(btn('插入图片', 'secondary', 'sm', 'image', disabled=True) + btn('插入链接', 'secondary', 'sm', 'link', disabled=True), 8) + tip +
            '<div style="margin-top: 6px;">%s</div>' % banner('danger', '回复检查未通过：渠道内容能力', '正文含链接 forcome.com/support。站内信不能带链接，请删除后重新检查。', None) +
            row(btn('提交审批', 'primary', 'md', icon_right='arrow_r', disabled=True) + muted('检查通过前不可提交', 12), 8), 10)
    frame = mini('<div style="flex: 1; display: flex; gap: 24px;"><div style="flex: 1; min-width: 0px;">%s</div><div style="width: 1px; background: %s;"></div><div style="width: 330px; flex-shrink: 0;">%s</div></div>' % (a, T['line'], b), VW, 400, pad='20px')
    return variant('I13 链接或图片不合规', '邮件：输入框即时校验白名单，报错写明域名与出路，「插入」禁用。亚马逊：插入按钮置灰，悬停说明原因；正文若仍含链接，回复检查判不通过并禁用提交。',
                   frame, VW, trigger='邮件草稿插入非白名单链接或非素材库图片；亚马逊草稿尝试插入。')


# ---------------------------------------------------------------- I14 未归属店铺队列
def i14():
    cols = [('来信', 'left'), ('识别依据', 'left'), ('到达', 'left'), ('SLA', 'left'), ('指定店铺', 'left')]
    rows = [
        [col(text('Tom Harris', 12.5, T['ink'], 600) + ellipsis('Where is my order? Tracking says delivered.', 12, T['ink3']), 1),
         col(nowrap('亚马逊买家消息 · Gmail', 12, T['ink2']) + nowrap('收件地址 amz-uk@forcome.com 未登记', 11.5, T['warn'], 600), 1),
         nowrap('09-11 10:02', 12, T['ink2']), col(sla('23h 42m', 'normal') + nowrap('亚马逊 24 小时', 11, T['ink4']), 2),
         select_box(None, '选择店铺', width='150px', h=28)],
        [col(text('Hanna Vogel', 12.5, T['ink'], 600) + ellipsis('Der Filter passt nicht in mein Gerät.', 12, T['ink3']), 1),
         col(nowrap('邮件 · Gmail', 12, T['ink2']) + nowrap('收件地址 info@forcome.eu 未登记', 11.5, T['warn'], 600), 1),
         nowrap('09-11 09:47', 12, T['ink2']), col(sla('23h 27m', 'normal') + nowrap('内部目标', 11, T['ink4']), 2),
         select_box('forcome.eu', st='focus', width='150px', h=28)],
    ]
    tbl = mtable(cols, rows, 'minmax(0, 1.3fr) minmax(0, 1.4fr) 84px 104px 160px', py=10)
    head = between(row(text('未归属店铺', 15, T['ink'], 700) + chip('2', 'warning', 11), 8), row(nowrap('仅客服主管可见', 12, T['ink3']) + btn('去登记店铺', 'secondary', 'sm', 'store'), 8))
    note = banner('warning', '2 封来信识别不出店铺，未生成草稿', 'SLA 按原到达时间照常计时。指定店铺后进入该店铺队列并开始五步处理；新店铺请管理员在「设置 · 渠道与店铺」登记（E-13）。')
    tail = row(icon('check_c', 14, T['ok_solid'], 2) + nowrap('指定后浮层「已归入 forcome.eu，正在生成草稿」，本行移出列表。', 12, T['ink3']), 6)
    frame = mini(col(head + note + tbl + tail, 12), VW, 400, pad='20px')
    return variant('I14 未归属店铺队列', '客服主管周敏的视角（P04 筛选「未归属店铺」或收件箱提醒进入）。每行显示识别依据（收件地址、卖家 ID）、到达时间、仍在计时的 SLA，行尾「指定店铺」下拉；不生成草稿、不能回复，直到指定店铺。',
                   frame, VW, trigger='收件地址或卖家 ID 未登记（E-13、AC-TK-09、AC-TK-11）。')


# ---------------------------------------------------------------- I15 已达 5 版上限
def i15():
    vers = SARAH_VERSIONS + [('D', 'D 先退运费', ''), ('E', 'E 延期说明', '')]
    huan = '<div style="position: relative;">%s<div style="position: absolute; right: 0px; top: 34px; z-index: 2; width: 250px; display: flex; justify-content: flex-end;">%s</div></div>' % (
        btn('换一版', 'ghost', 'sm', 'refresh', disabled=True), tooltip('本封来信已生成 5 版，达到上限。请修改现有版本或手写回复。'))
    tabs_html = ver_tabs(vers, 'A', huan)
    foot = draft_foot(btn('提交审批', 'primary', 'md', icon_right='arrow_r') + btn('修改', 'secondary', 'md', 'edit') + btn('转人工', 'secondary', 'md', 'handoff'),
                      btn('拒绝草稿', 'ghost', 'md', 'x_c'))
    dc = draft_card('本来信已生成 5 版 · 已达上限', tabs_html, draft_toolbar('English', False, media=False, hint='亚马逊站内信不支持图片和链接'), sarah_body(), '', '', '', foot, gap=8)
    frame = mini(dc, VW, 470, pad='20px')
    return variant('I15 已达 5 版上限', '同一来信最多 5 版（R-DF-01）。第 5 版生成后「换一版」置灰，悬停提示原因；其余操作不受影响，可继续修改、提交或拒绝后手写。',
                   frame, VW, trigger='同一封来信已有 A–E 共 5 版草稿（AC-AI-05）。')


def build():
    vs = [i1(), i2(), i3(), i4(), i5(), i6(), i7(), i8(), i9(), i10(), i11(), i12(), i13(), i14(), i15()]
    rows_ = ''
    for k in range(0, len(vs), 2):
        pair = vs[k:k + 2]
        rows_ += grid(''.join(pair), template='%dpx %dpx' % (VW, VW), gap=32, extra='align-items: start;')
    body = col(rows_, 36)
    leg = row(state('待审草稿') + state('待审批') + state('转人工') + state('已失效') + sla('5h 40m', 'warning') + sla('已超时 2h 00m', 'danger'), 6)
    return board('收件箱与工单状态', 'P01–P06 的加载、空、生成、失败、并发、确认、超时、筛选、合并、渠道内容能力、未归属店铺与草稿版本上限状态。画面数据取自 data.py，演示时刻 %s（I9 为 13:15 的画面）。' % NOW_LABEL,
                 body, 1920, 800, leg)


if __name__ == '__main__':
    save('StatesInbox.dc.html', build())
    print('ok')
