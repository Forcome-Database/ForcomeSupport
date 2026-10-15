# -*- coding: utf-8 -*-
"""设置：左侧菜单每项一个独立页面，页内多块内容用页签，编辑表单用右侧抽屉。
P18 渠道与店铺 · P22 动作映射 · P19 处理规则 · P23 售后规则 · P24 工厂账号 · P20 团队与权限（共用 as_common.settings_menu）；
P25 模型、P26 系统状态在 build_settings_more.py，沿用本文件的 spage 外壳。
P19、P20 的非默认页签画面放在 StatesAdmin：K15 风险信号、K16 渠道内容能力、K21 处理说明、K17 角色权限；P18 新增店铺抽屉为 K8，第一阶段 P18 为 K20。
保存口径：修改 → 吸底保存栏（ui.save_bar）→ 保存；离开页面时有未保存提示。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from data import *
from as_common import *
import as_common as _AC

P1_MENU = ('渠道与店铺', '团队与权限')  # 第一阶段设置只有 P18、P20（prd_b 4.1）


def tile(ic, tone='accent', size=32):
    fg, bg = {'accent': (T['accent'], T['accent_bg']), 'ok': (T['ok'], T['ok_bg']), 'muted': (T['ink3'], T['line2']), 'bad': (T['bad'], T['bad_bg']),
              'warn': (T['warn'], T['warn_bg'])}[tone]
    return '<div style="width: %dpx; height: %dpx; border-radius: 8px; background: %s; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%s</div>' % (size, size, bg, icon(ic, 18, fg))


def menu(active, role, phase1=False):
    """设置菜单：第二阶段起 11 项；第一阶段只列 P18、P20（临时收窄 as_common.SETTINGS_MENU 后复用同一部件）。"""
    if not phase1:
        return settings_menu(active, role)
    full = _AC.SETTINGS_MENU
    _AC.SETTINGS_MENU = [m for m in full if m[0] in P1_MENU]
    try:
        html = settings_menu(active, role)
    finally:
        _AC.SETTINGS_MENU = full
    return html.replace('带锁的项由客服主管维护', '第一阶段只开放这两项设置')


def spage(user, active, title, desc, actions, inner, bar='', tabs_html='', h=900, phase1=False):
    """设置页外壳：左侧设置菜单 + 右侧内容区；tabs_html 为页内页签；bar 为吸底保存栏（ui.save_bar），固定在内容区底部。
    phase1=True 为第一阶段外壳（导航 NAV_BY_ROLE_P1、不显示店铺范围与搜索，菜单只有 P18、P20）。"""
    role = STAFF[user]['role']
    head = between(col('<div style="font-size: 20px; font-weight: 700; color: %s; letter-spacing: -0.01em;">%s</div><div style="font-size: 13px; color: %s; line-height: 1.5;">%s</div>' % (T['ink'], title, T['ink3'], desc), 4),
                   row(actions, 8), 'flex-end')
    scroll = '<div style="flex: 1; min-height: 0px; padding: 16px 24px 16px 24px; display: flex; flex-direction: column; gap: 16px; overflow: hidden;">%s%s%s</div>' % (head, tabs_html, inner)
    main = '<div style="flex: 1; min-width: 0px; min-height: 0px; display: flex; flex-direction: column;">%s%s</div>' % (scroll, bar)
    body = '<div style="flex: 1; min-height: 0px; display: flex; flex-direction: row;">%s%s</div>' % (menu(active, role, phase1), main)
    return app(user, '设置', ['设置', active], body, h=h, phase1=phase1)


def edited_tag():
    return chip('已修改', 'warning', 11, dot=True)


def info_tip(t, tip):
    """说明收进 ⓘ：短标题常显，全文悬停显示（title）。"""
    return '<div title="%s" style="display: flex; align-items: center; gap: 4px; cursor: help;">%s%s</div>' % (tip, icon('info', 14, T['ink4']), nowrap(t, 12, T['ink3']))


def drawer(title, body, footer, width=440, desc=None):
    """右侧抽屉（shadcn Sheet）：高度占满，标题区 + 表单区 + 底部按钮。"""
    d = '<div style="font-size: 12px; color: %s; line-height: 1.5;">%s</div>' % (T['ink3'], desc) if desc else ''
    return ('<div style="width: %dpx; height: 100%%; box-sizing: border-box; background: #ffffff; border-left: 1px solid %s; box-shadow: %s; display: flex; flex-direction: column;">'
            '<div style="padding: 16px 20px 14px 20px; border-bottom: 1px solid %s; display: flex; gap: 12px; align-items: flex-start;"><div style="flex: 1; display: flex; flex-direction: column; gap: 4px;"><div style="font-size: 16px; font-weight: 600; color: %s;">%s</div>%s</div>%s</div>'
            '<div style="flex: 1; min-height: 0px; overflow: hidden; padding: 16px 20px; display: flex; flex-direction: column; gap: 14px;">%s</div>'
            '<div style="padding: 12px 20px; border-top: 1px solid %s; background: %s; display: flex; justify-content: flex-end; gap: 8px;">%s</div></div>') % (
        width, T['line'], SHADOW_LG, T['line2'], T['ink'], title, d, icon('x', 16, T['ink4']), body, T['line2'], T['subtle'], footer)


def drawer_over(inner, drw, w, h):
    """页面上盖遮罩，抽屉贴右侧。"""
    return '<div style="width: %dpx; height: %dpx; position: relative; overflow: hidden;">%s<div style="position: absolute; inset: 0px; background: rgba(16,24,40,0.45); display: flex; justify-content: flex-end;">%s</div></div>' % (
        w, h, inner, drw)


# ================================================================ P18 渠道与店铺

# 客户来信经店铺进线邮箱收发，每个邮箱各自选服务商 Gmail 或 163 企业邮箱（D-28，待办 34）
P18_DESC = '订单由平台直读；库存、易仓出库单与运费经积加；物流轨迹经 17TRACK；退款、改地址、取消走平台官方接口；客户来信经店铺进线邮箱（Gmail 或 163 企业邮箱）收发。店铺决定订单匹配、回复身份、签名与数据权限。'
P18_DESC_P1 = '订单由平台直读；客户来信经店铺进线邮箱（Gmail 或 163 企业邮箱）收取。店铺决定订单匹配与数据权限。'
RULE_CARD_STATE = ('卡片显示该渠道下最差的状态，并列出异常的邮箱或店铺；店铺表「状态」列显示该店铺各连接的状态。'
                   '同步延迟按数据源阈值：邮箱、订单 10 分钟，钉钉 2 小时；连续 3 次失败为连接异常。'
                   '钉钉例外：异常只在钉钉卡显示、只提醒管理员，不出全站横幅（6.9）。')


def test_btn():
    return btn('测试连接', 'link', 'sm')


def ch_card(ic, name, st, lines, foot='', tone='accent', card_tone=None, sync=None, test=True, sub_text=None):
    """渠道卡：标题下统一写「最近同步 hh:mm」（sub_text 可替换为其他说明），右上角为连接状态与「测试连接」文字按钮。"""
    sub_ = nowrap(sub_text if sub_text else ('最近同步 ' + sync), 11, T['ink4']) if (sync or sub_text) else ''
    head = between(row(tile(ic, tone) + col('<div style="font-size: 14px; font-weight: 600; color: %s; white-space: nowrap;">%s</div>' % (T['ink'], name) + sub_, 0), 10),
                   row(st + (test_btn() if test else ''), 6))
    body = col(''.join(text(l, 12, T['ink3']) for l in lines), 2) if lines else ''
    f = '<div style="margin-top: auto;">%s</div>' % foot if foot else ''
    return card(head + body + f, pad='10px 14px', gap=8, tone=card_tone, style='height: 100%; box-sizing: border-box;')


def sqs_line(st=SQS_STATE):
    """亚马逊卡的订单通知队列状态（D-21；四种写法为待办 12 Q7 · 协调者 10-06 决定）：正常（少于 10 条，写出等待拉取的条数，0 绿、其余黄）、
    积压 N 条（≥ 10 条，黄）、拉取失败（连续 3 次，红）、未连接（没配置 SQS，灰）。只影响这一行，不改卡片状态。"""
    s, n = st
    if s == '正常':
        c = chip('正常 · 积压 %d' % n, 'success' if not n else 'warning', 11, dot=True)
    elif s == '积压':
        c = chip('积压 %d 条' % n, 'warning', 11, dot=True)
    elif s == '拉取失败':
        c = chip('拉取失败', 'danger', 11, dot=True)
    else:
        c = chip('未连接', 'muted', 11, dot=True)
    return row(nowrap('订单通知队列（SQS）', 12, T['ink3']) + c, 6)


def amazon_card(err=False):
    if err:
        return ch_card('store', '亚马逊 SP-API', state('连接异常'),
                       ['10:05 起连续 3 次调用失败：授权令牌已过期', '退款、取消与订单同步暂停，恢复后自动补执行与补拉；买家消息经店铺邮箱收取，不受影响'],
                       row(btn('重新授权', 'primary', 'sm', 'refresh') + btn('查看错误日志', 'ghost', 'sm'), 6), 'bad', 'danger', sync=CHANNEL_SYNC['SP-API 异常'])
    return ch_card('store', '亚马逊 SP-API', state('已连接'), ['2 个店铺 · 退款、取消（审批后执行）', '订单经 SP-API 准实时同步', sqs_line()], '', 'ok', sync=CHANNEL_SYNC['SP-API'])


def shopify_card():
    return ch_card('store', 'Shopify Admin API', state('已连接'), ['2 个店铺 · 退款、改地址、取消、订单备注', '订单经 Admin API 准实时同步'], '', 'ok', sync=CHANNEL_SYNC['Shopify'])


def track_card():
    """17TRACK 物流轨迹（第二阶段起）：注册单号后每 4 小时一轮，工单打开时即时查询。"""
    return ch_card('truck', '17TRACK 物流轨迹', state('已连接'), ['每 4 小时一轮 · 工单打开时即时查询 · 本月额度 3,100 / 10,000'], '', 'ok', sync=CHANNEL_SYNC['17TRACK'])


def jijia_card():
    return ch_card('link', '积加 ERP', state('已连接'), ['亚马逊订单收件人', '库存、售后出库单、单号与运费（积加对接易仓）'], '', 'ok', sync=CHANNEL_SYNC['积加'])


def mailbox_count_line(provider):
    """邮箱卡的第一行：该服务商的进线邮箱数，按亚马逊买家消息、Shopify 客服分列（取 STORES 的 provider，D-28）。"""
    mine = [s_ for s_ in STORES if s_['provider'] == provider]
    amz = sum(1 for s_ in mine if s_['platform'] == '亚马逊')
    parts = (['%d 个亚马逊买家消息' % amz] if amz else []) + (['%d 个 Shopify 客服' % (len(mine) - amz)] if len(mine) > amz else [])
    return '%d 个邮箱：%s' % (len(mine), '、'.join(parts))


def gmail_card(err=False):
    if err:
        return ch_card('message', 'Gmail', state('连接异常'),
                       ['support@forcome.mx 访问失败（10:05 起连续 3 次）：' + GMAIL_GUIDE, '该邮箱来信暂存，恢复后自动补拉；回复进入待发队列'],
                       row(btn('重新检测', 'primary', 'sm', 'refresh') + btn('查看错误日志', 'ghost', 'sm'), 6), 'bad', 'danger', sync=CHANNEL_SYNC['Gmail 异常'])
    return ch_card('message', 'Gmail', state('已连接'), [mailbox_count_line('Gmail'), '新邮件推送，实时收取'], '', 'ok', sync=CHANNEL_SYNC['Gmail'])


def qiye_card(err=False):
    """163 企业邮箱卡（D-28，待办 34）：结构同 Gmail 卡；按邮箱用客户端授权码经 IMAP 收信（常驻连接 + 每 5 分钟检查）、SMTP 发信（第二阶段起）。
    连接异常的恢复指引按服务商写：检查客户端授权码与网易后台的 IMAP、客户端登录设置（Gmail 为全域委派）。"""
    e = QIYE_ISSUE
    if err:
        return ch_card('inbox', QIYE, state('连接异常'),
                       ['%s 访问失败（%s 起连续 %d 次）：%s' % (e['mailbox'], e['since'], e['failures'], QIYE_GUIDE), '该邮箱来信暂存，恢复后自动补拉；回复进入待发队列'],
                       row(btn('重新检测', 'primary', 'sm', 'refresh') + btn('查看错误日志', 'ghost', 'sm'), 6), 'bad', 'danger', sync=e['last'])
    return ch_card('inbox', QIYE, state('已连接'), [mailbox_count_line(QIYE), 'IMAP 常驻连接，新邮件实时收取；SMTP 发送回复'], '', 'ok', sync=CHANNEL_SYNC[QIYE])


DINGTALK_LINES_P1 = ['通讯录：成员与部门每小时同步', '工作通知推送；扫码登录']  # 第一阶段已连接时的说明行（钉钉内免登随第二阶段）
DINGTALK_NOTE = '只提醒管理员，不出全站横幅；成员与部门保持上次结果，登录与权限不受影响'


def dingtalk_card(late=False, phase1=False, err=False):
    """钉钉卡。late=True 为同步延迟（超过 2 小时）、err=True 为连接异常（连续 3 次失败，待办 09 Q6 · 10-06 用户确认）：
    都只在本卡显示、只提醒管理员，不出全站横幅（6.9、E-32）。phase1=True 且已连接时用第一阶段的说明行（没有钉钉内免登）。"""
    if err:
        # err='never'：从没同步成功过就连续 3 次失败（新部署凭据配错，E4，协调者 10-06 决定），没有最近同步时刻
        never = err == 'never'
        first = '通讯录尚未同步成功，连续 3 次失败' if never else '通讯录 %s 后未同步成功，连续 3 次失败' % DINGTALK_LATE_SYNC
        return ch_card('users', '钉钉', state('连接异常'), [first, DINGTALK_NOTE, '工作通知推送；扫码登录'],
                       '', 'bad', 'danger', sync=None if never else DINGTALK_LATE_SYNC)
    if late:
        return ch_card('users', '钉钉', state('同步延迟'),
                       ['通讯录 %s 后未同步成功，超过 2 小时' % DINGTALK_LATE_SYNC, DINGTALK_NOTE, '工作通知推送；扫码登录'],
                       '', 'warn', 'warning', sync=DINGTALK_LATE_SYNC)
    lines = DINGTALK_LINES_P1 if phase1 else ['通讯录：成员与部门每小时同步', '工作通知推送；扫码登录与钉钉内免登']
    return ch_card('users', '钉钉', state('已连接'), lines, '', 'ok', sync=CHANNEL_SYNC['钉钉'])


GMAIL_LINES_P1 = [mailbox_count_line('Gmail'), '收件与「已发送」：识别到我方回复即转等客户']  # 第一阶段已连接时的说明行
QIYE_LINES_P1 = [mailbox_count_line(QIYE), '收件与「已发送」：识别到我方回复即转等客户']  # 163 企业邮箱卡同 Gmail 卡（D-28）


def gmail_card_p1(st='已连接'):
    """第一阶段 Gmail 卡（K20，待办 09 Q2、Q3 · 10-06 用户确认）。同步延迟（超过 10 分钟）：每个延迟的邮箱一行「<邮箱> hh:mm 后未同步成功，
    超过 10 分钟」，其余说明行照常。连接异常（连续 3 次失败，K7）：每个异常的邮箱一行原因与恢复指引，再写来信暂存，底部「重新检测」
    （立即重测并补拉）；第一阶段不发信、没有错误日志页，所以不写「回复进入待发队列」、没有「查看错误日志」。"""
    if st == '同步延迟':
        d = GMAIL_DELAYED
        return ch_card('message', 'Gmail', state('同步延迟'), ['%s %s 后未同步成功，超过 10 分钟' % (d['mailbox'], d['last'])] + GMAIL_LINES_P1,
                       '', 'warn', 'warning', sync=d['last'])
    if st == '异常与延迟':
        # 几个邮箱同时异常、另有一个延迟（E3，协调者 10-06 决定）：每个异常的邮箱一行（次数为实际的连续失败次数），暂存说明只写一次，延迟行在后；
        # 卡上的最近同步取各邮箱中最旧的一次
        lines = ['%s 访问失败（%s 起连续 %d 次）：' % i + GMAIL_GUIDE for i in GMAIL_ISSUES_MIXED] + ['该邮箱来信暂存，恢复后自动补拉'] + \
                ['%s %s 后未同步成功，超过 10 分钟' % GMAIL_DELAYED_MIXED]
        return ch_card('message', 'Gmail', state('连接异常'), lines, row(btn('重新检测', 'primary', 'sm', 'refresh'), 6), 'bad', 'danger',
                       sync=GMAIL_ISSUE['last'])
    if st == '连接异常':
        e = GMAIL_ISSUE
        return ch_card('message', 'Gmail', state('连接异常'),
                       ['%s 访问失败（%s 起连续 %d 次）：%s' % (e['mailbox'], e['since'], e['failures'], GMAIL_GUIDE), '该邮箱来信暂存，恢复后自动补拉'],
                       row(btn('重新检测', 'primary', 'sm', 'refresh'), 6), 'bad', 'danger', sync=e['last'])
    return ch_card('message', 'Gmail', state('已连接'), GMAIL_LINES_P1, '', 'ok', sync=CHANNEL_SYNC['Gmail'])


def qiye_card_p1(st='已连接'):
    """第一阶段 163 企业邮箱卡（K20，D-28，待办 34）：写法套用 Gmail 卡（gmail_card_p1）——同步延迟每个延迟的邮箱一行；连接异常每个异常的邮箱一行原因与
    恢复指引（检查客户端授权码与网易后台的 IMAP、客户端登录设置）、来信暂存、「重新检测」；第一阶段不发信，不写「回复进入待发队列」。"""
    if st == '同步延迟':
        d = QIYE_DELAYED
        return ch_card('inbox', QIYE, state('同步延迟'), ['%s %s 后未同步成功，超过 10 分钟' % (d['mailbox'], d['last'])] + QIYE_LINES_P1,
                       '', 'warn', 'warning', sync=d['last'])
    if st == '连接异常':
        e = QIYE_ISSUE
        return ch_card('inbox', QIYE, state('连接异常'),
                       ['%s 访问失败（%s 起连续 %d 次）：%s' % (e['mailbox'], e['since'], e['failures'], QIYE_GUIDE), '该邮箱来信暂存，恢复后自动补拉'],
                       row(btn('重新检测', 'primary', 'sm', 'refresh'), 6), 'bad', 'danger', sync=e['last'])
    return ch_card('inbox', QIYE, state('已连接'), QIYE_LINES_P1, '', 'ok', sync=CHANNEL_SYNC[QIYE])


SHOPIFY_LINES_P1 = ['2 个店铺 · 订单经 Admin API 准实时同步']  # 第一阶段 Shopify 卡的店铺行（回补窗口行另画）


def backfill_line(st):
    """亚马逊、Shopify 卡的订单回补行（K20；四种写法为待办 13 · 协调者 10-06 决定 Q2，见 data.BACKFILL_STATES）：未开始（灰）、
    进行中 · 已回补 N 笔（蓝）、已完成（绿勾）、Shopify 没开通 read_all_orders 只回补 60 天、完成后为「未开通 read_all_orders」（黄）。
    亚马逊卡在订单通知队列行之后、Shopify 卡在店铺行之后；该平台没有连接上的店铺、卡片连接异常时不显示这一行（部分店铺未连接时照写）。"""
    s, days, n = st
    if s == '未开始':
        c = chip('未开始', 'muted', 11)
    elif s == '进行中':
        c = chip('进行中 · 已回补 {:,} 笔'.format(n), 'info', 11)
    elif s == '已完成':
        c = chip('已完成', 'success', 11, 'check')
    else:
        c = chip('未开通 read_all_orders', 'warning', 11)
    return row(nowrap('订单回补 %d 天' % days, 12, T['ink3']) + c, 6)


def shopify_backfill_line():
    return backfill_line(('未开通', SHOPIFY_BACKFILL_DAYS, None))


def shopify_card_p1(st='已连接'):
    """第一阶段 Shopify 卡（K20；待办 11 · 协调者 10-06 决定，套用 Gmail 卡已确认的写法，异常与延迟按店铺）。同步延迟（超过 10 分钟）：
    每个延迟的店铺一行「<店铺> hh:mm 后未同步成功，超过 10 分钟」，其余说明行照常。连接异常（连续 3 次失败）：每个异常的店铺一行原因与恢复指引，
    再写一次订单暂停同步，底部「重新检测」（立即重测并补拉）；第一阶段没有「重新授权」与错误日志页。"""
    if st == '同步延迟':
        d = SHOPIFY_DELAYED
        return ch_card('store', 'Shopify Admin API', state('同步延迟'), ['%s %s 后未同步成功，超过 10 分钟' % (d['store'], d['last'])] + SHOPIFY_LINES_P1 + [shopify_backfill_line()],
                       '', 'warn', 'warning', sync=d['last'])
    if st == '连接异常':
        e = SHOPIFY_ISSUE
        return ch_card('store', 'Shopify Admin API', state('连接异常'),
                       ['%s 访问失败（%s 起连续 %d 次）：请检查 Admin API 应用凭据与授权范围' % (e['store'], e['since'], e['failures']),
                        '该店铺订单暂停同步，恢复后自动补拉；来信照常收取'],
                       row(btn('重新检测', 'primary', 'sm', 'refresh'), 6), 'bad', 'danger', sync=e['last'])
    return ch_card('store', 'Shopify Admin API', state('已连接'), SHOPIFY_LINES_P1 + [shopify_backfill_line()], '', 'ok', sync=CHANNEL_SYNC['Shopify'])


AMAZON_LINES_P1 = ['2 个店铺 · 订单经 SP-API 准实时同步']  # 第一阶段亚马逊卡的店铺行（SQS 行、回补行另画）


def amazon_backfill_line():
    return backfill_line(('已完成', AMZ_BACKFILL_DAYS, None))


def amazon_card_p1(st='已连接', sqs=SQS_STATE):
    """第一阶段亚马逊卡（K20；待办 12 · 协调者 10-06 决定 Q1、Q2、Q7，套用 Shopify 卡的写法，异常与延迟按店铺）。同步延迟（超过 10 分钟）：
    每个延迟的店铺一行「<店铺> hh:mm 后未同步成功，超过 10 分钟」，其余说明行照常。连接异常（连续 3 次失败）：每个异常的店铺一行原因与恢复指引，
    再写一次订单暂停同步，底部「重新检测」；第一阶段没有「重新授权」与错误日志页。SQS 行（订单通知队列）与连接状态无关，各状态下都照写。"""
    if st == '同步延迟':
        d = AMAZON_DELAYED
        return ch_card('store', '亚马逊 SP-API', state('同步延迟'),
                       ['%s %s 后未同步成功，超过 10 分钟' % (d['store'], d['last'])] + AMAZON_LINES_P1 + [sqs_line(sqs), amazon_backfill_line()],
                       '', 'warn', 'warning', sync=d['last'])
    if st == '连接异常':
        e = AMAZON_ISSUE
        return ch_card('store', '亚马逊 SP-API', state('连接异常'),
                       ['%s 访问失败（%s 起连续 %d 次）：请检查 SP-API 应用凭据与卖家授权' % (e['store'], e['since'], e['failures']),
                        '该店铺订单暂停同步，恢复后自动补拉；来信照常收取', sqs_line(sqs)],
                       row(btn('重新检测', 'primary', 'sm', 'refresh'), 6), 'bad', 'danger', sync=e['last'])
    return ch_card('store', '亚马逊 SP-API', state('已连接'), AMAZON_LINES_P1 + [sqs_line(sqs), amazon_backfill_line()], '', 'ok', sync=CHANNEL_SYNC['SP-API'])


def grid3(cells):
    return '<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; align-items: stretch;">%s</div>' % ''.join(cells)


def p18_channels():
    lc_head = between(row(tile('box', 'muted') + col(nowrap('易仓海外仓', 14, T['ink2'], 600) + nowrap('最近同步 %s · 经积加' % CHANNEL_SYNC['易仓'], 11, T['ink4']), 0), 10),
                      row(chip('经积加对接', 'neutral', 11) + test_btn(), 6))
    lc = dashed_card(lc_head + muted('库存、售后出库单、单号与实际运费都经积加读写，本系统不直连易仓接口；测试连接走积加。', 12), '10px 14px', 8)
    return grid3([amazon_card(), shopify_card(), gmail_card(), qiye_card(), jijia_card(), track_card(), dingtalk_card(), lc])


def phase2_card(ic, name, desc):
    """第一阶段尚未接入的渠道：灰色虚线卡「第二阶段接入」，没有同步时间与测试连接。"""
    head = between(row(tile(ic, 'muted') + col(nowrap(name, 14, T['ink2'], 600) + nowrap('暂不连接', 11, T['ink4']), 0), 10), chip('第二阶段接入', 'muted', 11))
    return dashed_card(head + muted(desc, 12), '12px 14px', 8)


def p18_channels_p1():
    """第一阶段渠道卡（K20）：订单同步、回补与来信收取（Gmail、163 企业邮箱各一张）；不显示 17TRACK。
    积加与易仓第二阶段接入，合成一张灰色虚线卡（加了 163 企业邮箱卡后仍是 3 × 2，待办 34）。"""
    return grid3([amazon_card_p1(), shopify_card_p1(), gmail_card_p1(), qiye_card_p1(), dingtalk_card(late=True),
                  phase2_card('link', '积加 ERP · 易仓海外仓', '亚马逊订单收件人、库存、售后出库单、单号与运费；易仓经积加读写，本系统不直连易仓接口。')])


def copy_val(v):
    """平台标识全文显示，右侧复制图标。"""
    return row(nowrap(v, 13, T['ink2']) + '<div title="复制" style="flex-shrink: 0; display: flex;">%s</div>' % icon('copy', 13, T['ink4']), 6)


RULE_ROUTE = ('亚马逊按买家消息的收件邮箱与发件域名（amazon.com / .ca / .com.mx）识别店铺和站点；Shopify 按客服邮箱。'
              '一个店铺可以登记多个进线邮箱（含别名）。识别不出的来信进入「未归属店铺」队列，由客服主管指定店铺，不生成草稿。')
# 第一阶段没有草稿，不写「不生成草稿」（D-26：进线邮箱可填多个，含别名；待办 07 实现时与用户确认，10-05）
RULE_ROUTE_P1 = RULE_ROUTE.replace('，不生成草稿。', '。')
RULE_LAYER = '配置按「全局 → 平台 → 店铺」取值。店铺可覆盖签名、政策口径、模板、素材与链接白名单、SLA 内部目标；意图、风险信号、动作分级只能全局配置。'


def default_site(s_):
    return s_.get('default_site') or STORE_DEFAULT_SITE[s_['id']]


def site_cell(s_):
    """站点列：默认站点加粗（无订单的来信按默认站点归站点，D-23）。"""
    d = default_site(s_)
    parts = ['<span style="font-weight: %d; color: %s;">%s</span>' % (700 if x == d else 400, T['ink'] if x == d else T['ink3'], x) for x in s_['sites']]
    return '<div title="默认站点 %s" style="font-size: 13px; color: %s; white-space: nowrap;">%s</div>' % (d, T['ink4'], ' · '.join(parts))


def store_conns(s_):
    """店铺的连接：进线邮箱的服务商（Gmail 或 163 企业邮箱，D-28）+ 订单接口。"""
    return [s_['provider'], 'SP-API' if s_['platform'] == '亚马逊' else 'Admin API']


def store_status(s_, issue=None):
    """店铺表「状态」列：该店铺各连接的状态。都正常写「已连接」并列出连接；有异常写「Gmail 同步延迟」（色调同 STATE_TONE）。"""
    if issue:
        conn, st = issue
        return '<div style="display: flex;">%s</div>' % chip('%s %s' % (conn, st), STATE_TONE[st], 11, dot=True)
    return col('<div style="display: flex;">%s</div>' % state('已连接') + nowrap(' · '.join(store_conns(s_)), 11, T['ink4']), 3)


def p18_stores(phase1=False, issues=None):
    """店铺表。phase1=True 不显示覆盖项列（第一阶段没有店铺签名与覆盖项）；issues: {店铺 id: (连接, 状态)}。"""
    issues = issues or {}
    cols = [('店铺', 'left'), ('站点（加粗为默认）', 'left'), ('进线邮箱', 'left'), ('平台标识', 'left')] + ([] if phase1 else [('覆盖项', 'left')]) + [('状态', 'left'), ('', 'right')]
    rows = []
    for s_ in STORES:
        amz = s_['platform'] == '亚马逊'
        # 进线邮箱下一行写用途与服务商（D-28）
        e = col(nowrap(s_['mailbox'], 13, T['ink'], 600) + nowrap('%s · %s' % ('亚马逊买家消息' if amz else 'Shopify 客服邮箱', s_['provider']), 11, T['ink4']), 2)
        k, v = s_['sid'].rsplit(' ', 1) if amz else ('店铺域名', s_['sid'])
        sid = col(nowrap(k, 11, T['ink4']) + copy_val(v), 2)
        over = [row(''.join(chip(o, 'outline', 11) for o in STORE_OVERRIDES[s_['id']]), 4)] if not phase1 else []
        rows.append([col(nowrap(s_['name'], 13, T['ink'], 600) + '<div style="display: flex;">%s</div>' % channel(s_['platform'], None, None, 11), 4),
                     site_cell(s_), e, sid] + over + [store_status(s_, issues.get(s_['id'])), link('编辑', 12)])
    tpl = '190px 130px 230px 250px %s140px 40px' % ('' if phase1 else 'minmax(0, 1fr) ')
    if phase1:
        tpl = '200px 150px 260px minmax(0, 1fr) 160px 40px'
    t = table(cols, rows, tpl, py=12)
    head = between(row(label('店铺') + nowrap('%d 个' % len(STORES), 12, T['ink3']) + divider(True, 12) + info_tip('进线识别', RULE_ROUTE_P1 if phase1 else RULE_ROUTE) +
                       ('' if phase1 else info_tip('配置取值层级', RULE_LAYER)), 10),
                   btn('新增店铺', 'secondary', 'sm', 'plus'))
    return col(head + t, 10)


def p18(h=900, phase1=False):
    """P18；phase1=True 为第一阶段版（K20）：页头说明、渠道卡、店铺表按 prd_c P18「第一阶段」，没有吸底保存栏。"""
    ch_head = row(label('渠道连接') + info_tip('卡片状态按店铺计算', RULE_CARD_STATE), 10)
    inner = col(ch_head + (p18_channels_p1() if phase1 else p18_channels()), 10) + p18_stores(phase1)
    return spage('liuyang', '渠道与店铺', '渠道与店铺', P18_DESC_P1 if phase1 else P18_DESC, btn('查看审计日志', 'secondary', 'md', 'history'),
                 inner, h=h, phase1=phase1)


# ================================================================ P22 动作映射
def risk_tag(lv):
    if lv == '高风险':
        return chip('高风险', 'warning', 11)
    if lv == '低风险':
        return chip('低风险', 'muted', 11)
    return nowrap(lv, 12, T['ink3'])


def unsupported(t, why):
    """平台不支持：灰色删除线标签，悬停说明原因。"""
    return '<div title="%s" style="display: inline-flex; font-size: 11px; font-weight: 500; color: %s; background: %s; border-radius: 6px; padding: 0px 7px; line-height: 18px; white-space: nowrap; text-decoration: line-through;">%s</div>' % (
        why, T['ink4'], T['track'], t)


EXEC_BY_LEVEL = {'只读': '直接查询，不需审批', '低风险': '直接执行，记入工单日志', '高风险': '提交审批，批准后执行', '按发送方式': '自动发送或待审草稿（见处理规则）'}


def p22_explain():
    item = lambda ic, t, d: row(tile(ic, 'muted', 28) + col(nowrap(t, 13, T['ink'], 600) + d, 3), 10, 'flex-start')
    lv = row(nowrap('只读', 12, T['ink3']) + chip('低风险', 'muted', 11) + chip('高风险', 'warning', 11) + nowrap('按发送方式', 12, T['ink3']), 8)
    cells = (item('link', '%d 个统一动作 × 两类店铺' % len(ACTION_MAP), muted('亚马逊店铺 / Shopify 店铺。AI 与坐席只调用统一动作，按工单所属店铺的平台落到对应接口。', 12)) +
             item('box', '易仓经积加对接', muted('库存与售后出库单都经积加读写，本系统不直连易仓接口。', 12)) +
             item('shield', '分级标签', col(lv + muted('高风险动作一律提交审批，批准后执行。', 12), 4)) +
             item('x_c', '平台不支持', col(row(unsupported('平台不支持', ACTION_UNSUPPORTED['改地址']) + nowrap('灰色删除线，悬停看原因', 12, T['ink3']), 8) +
                                       muted('亚马逊订单不允许卖家改地址：草稿引导买家取消后重新下单（R-IN 修改订单）。', 12), 4)))
    return card(grid(cells, 4, 20), pad='14px 16px')


def p22_table():
    rows = []
    for n, lv, a, b in ACTION_MAP:
        amz = chip(a[0], a[1], 11) if a else unsupported('平台不支持', ACTION_UNSUPPORTED[n])
        rows.append([nowrap(n, 13, T['ink'], 600), risk_tag(lv), amz, chip(b[0], b[1], 11), nowrap(EXEC_BY_LEVEL[lv], 13, T['ink2'])])
    t = table([('统一动作', 'left'), ('分级', 'left'), ('亚马逊店铺', 'left'), ('Shopify 店铺', 'left'), ('执行方式', 'left')], rows,
              '200px 140px minmax(0, 1fr) minmax(0, 1fr) 280px', py=10)
    head = between(row(label('接口映射') + nowrap('%d 个统一动作 · 2 类店铺' % len(ACTION_MAP), 12, T['ink3']), 8), nowrap('易仓经积加对接', 12, T['ink4']))
    return col(head + t, 10)


def p22():
    return spage('liuyang', '动作映射', '动作映射', '统一动作到各平台接口的映射。分级只能全局配置；改映射后在底部统一保存，并记入审计日志。', btn('查看审计日志', 'secondary', 'md', 'history'),
                 p22_explain() + p22_table(), save_bar(0, '修改接口映射后在这里统一保存，并记入审计日志'))


# ================================================================ P19 处理规则
# 意图发送规则与放开进度取 data.SEND_RULES；未保存修改取 data.SEND_RULE_EDITS
INTENTS = SEND_RULES
EDITED = SEND_RULE_EDITS
RULE_TABS = [('发送方式与阈值', None), ('风险信号', len(RISK_SIGNALS)), ('渠道内容能力', None), ('处理说明', None)]
P19_DESC = '所有修改在底部统一保存；修改阈值与关闭风险信号需二次确认，并记入审计日志。'


def dirty_dot():
    return '<span title="有未保存修改" style="display: inline-block; width: 6px; height: 6px; border-radius: 999px; background: %s; margin-left: 2px;"></span>' % T['warn_solid']


def rule_tabs(active, dirty=('发送方式与阈值',)):
    """P19 四个页签；dirty 中的页签名旁加黄色圆点，表示该页签有未保存修改（切换页签不丢修改）。"""
    deco = lambda n: n + dirty_dot() if n in dirty else n
    return tabs([(deco(n), c) for n, c in RULE_TABS], deco(active))


def mini_bar(pct, w=28):
    return '<div style="width: %dpx; height: 4px; border-radius: 999px; background: %s; overflow: hidden; flex-shrink: 0;"><div style="width: %d%%; height: 100%%; background: %s;"></div></div>' % (
        w, T['warn_bg'], pct, T['warn_solid'])


def cond(c):
    kind, v = c
    if kind == 'ok':
        return row(icon('check_c', 14, T['ok'], 2) + ellipsis(v, 12, T['ok'], 600), 5)
    if kind == 'hard':
        return row(icon('lock', 13, T['ink4']) + ellipsis(v, 12, T['ink3']), 5)
    items = ''.join(row(nowrap('%s %s / %s' % (k, cur, need), 12, T['warn'], 600) + mini_bar(p, 40), 6) for k, cur, need, p in v)
    return row(icon('alert', 14, T['warn'], 2) + row(items, 16), 6)


def intent_row(it, k9=False, with_mode=True, edited=False):
    """with_mode=False：P19 不显示「发送方式」列（与自动发送开关重复）。edited：阈值为未保存的新值，标「已修改」。"""
    n, mode, th, ad, sm, c, sw = it
    tg = toggle(True) if sw == 'on' else (toggle(False) if sw == 'off' else toggle_off_disabled())
    if edited and n in EDITED:
        th_html = row(nowrap(EDITED[n][1], 13, T['ink'], 600) + icon('edit', 13, T['ink4']) + edited_tag(), 6)
    else:
        th_html = row(nowrap(th, 13, T['ink'], 600) + icon('edit', 13, T['ink4']), 6) if th != '—' else na()
    cells = [nowrap(n, 13, T['ink'], 600), cat(mode), th_html, nowrap(ad, 13, T['ink'] if ad != '—' else T['ink4']), nowrap(sm, 13, T['ink2']), cond(c), tg]
    return cells if with_mode else cells[:1] + cells[2:]


def p19_send_table():
    cols = [('意图', 'left'), ('置信度阈值', 'left'), ('30 天采纳率', 'right'), ('样本数', 'right'), ('放开条件（当前 / 要求）', 'left'), ('自动发送', 'left')]
    rows = [intent_row(it, with_mode=False, edited=True) for it in INTENTS]
    idx = [i for i, it in enumerate(INTENTS) if it[0] in EDITED]
    t = table(cols, rows, '200px 170px 110px 90px minmax(0, 1fr) 80px', dense=True, row_tones={i: 'warning' for i in idx})
    head = between(row(label('12 个意图') + nowrap('开关打开为自动发送，关闭为待审草稿', 12, T['ink3']), 8),
                   row(row(icon('lock', 12, T['ink4']) + nowrap('硬规则，不可放开', 12, T['ink3']), 4) + row(icon('alert', 12, T['warn'], 2) + nowrap('暂不满足', 12, T['ink3']), 4) +
                       row(edited_tag() + nowrap('未保存', 12, T['ink3']), 4), 14))
    rule = row(icon('info', 14, T['ink4']) + muted('放开：连续 30 天采纳率高于 90% 且样本不少于 50 封。熔断：24 小时内被拒绝或修改超过 30%，自动降回待审草稿并通知客服主管。', 12), 6)
    return col(head + t + rule, 10)


def p19():
    en, (e_old, e_new) = list(EDITED.items())[0]
    return spage('zhoumin', '处理规则', '处理规则', P19_DESC, '',
                 p19_send_table(), save_bar(len(EDITED), '%s · 置信度阈值 %s → %s；保存时二次确认，离开页面前会提示' % (en, e_old, e_new)), rule_tabs('发送方式与阈值'))


def p19_risk():
    """「风险信号」页签（StatesAdmin K15）：命中即转人工；安全事故、平台风险、疑似提示注入为硬规则锁定，重复联系、高价值关闭需二次确认并写明影响。"""
    out = ''
    for i, (n, d, p, sw) in enumerate(RISK_SIGNALS):
        less = RISK_OFF_IMPACT.get(n)
        tg = toggle_on_locked() if sw == 'lock' else toggle(True)
        right = row((nowrap('硬规则，不可关闭', 12, T['ink4']) if sw == 'lock' else '') + tg, 8)
        warn_ = row(icon('alert', 13, T['warn'], 2) + nowrap('关闭需二次确认：近 30 天约少转人工 %d 封；关闭后命中的来信不再转人工，可能自动发送' % less, 12, T['warn']), 5) if less else ''
        out += '<div style="display: flex; align-items: center; gap: 16px; padding: 12px 16px;%s"><div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 3px;"><div style="display: flex; align-items: center; gap: 8px;"><div style="font-size: 13px; font-weight: 600; color: %s;">%s</div>%s</div><div style="font-size: 12px; color: %s;">%s</div>%s</div>%s</div>' % (
            ' border-top: 1px solid %s;' % T['line2'] if i else '', T['ink'], n, priority(p), T['ink3'], d, warn_, right)
    head = between(row(label('风险信号') + nowrap('%d 条 · 命中即转人工，优先级取最高一条' % len(RISK_SIGNALS), 12, T['ink3']), 8),
                   row(row(icon('lock', 12, T['ink4']) + nowrap('硬规则', 12, T['ink3']), 4) + row(icon('alert', 12, T['warn'], 2) + nowrap('关闭需二次确认', 12, T['ink3']), 4), 14))
    return col(head + '<div style="background: #ffffff; border: 1px solid %s; border-radius: 12px; overflow: hidden; box-shadow: %s;">%s</div>' % (T['line'], SHADOW_XS, out), 10)


def p19_content_cap():
    """「渠道内容能力」页签（StatesAdmin K16）：两行渠道表 + 链接白名单。"""
    cols = [('渠道', 'left'), ('图片', 'left'), ('链接', 'left'), ('草稿与插入', 'left')]
    rows = [[channel('邮件', None, 'Shopify 店铺邮箱、直邮'), nowrap('只能来自素材库', 13, T['ink2']), nowrap('只能是白名单域名', 13, T['ink2']), text('插入按钮可用；非白名单链接报错', 13, T['ink2'])],
            [channel('亚马逊', None, '站内信'), nowrap('不支持', 13, T['ink3']), nowrap('不支持', 13, T['ink3']), text('按纯文字生成，插入按钮置灰并说明原因', 13, T['ink2'])]]
    t = table(cols, rows, '220px 120px 130px minmax(0, 1fr)', py=12)
    wl_head = between(row(label('链接白名单') + nowrap('%d 个域名 · 邮件草稿只能放这些域名的链接' % len(LINK_WHITELIST), 12, T['ink3']), 8), btn('添加域名', 'secondary', 'sm', 'plus'))
    wl = card(wl_head + row(''.join(row(nowrap(d, 13, T['ink'], 600) + icon('x', 12, T['ink4']), 6, extra='border: 1px solid %s; border-radius: 8px; padding: 5px 10px; background: %s;' % (T['line'], T['subtle']))
                                    for d in LINK_WHITELIST), 8, wrap=True), pad='14px 16px', gap=12)
    head = row(label('渠道内容能力') + nowrap('按渠道限制草稿里能放的图片与链接', 12, T['ink3']), 8)
    return col(head + t, 10) + wl


def kvl(k, v, kw=84):
    """键在左、值左对齐（长值换行不掉到右侧）。"""
    return '<div style="display: flex; gap: 10px; align-items: baseline; font-size: 12px; line-height: 1.55;"><div style="width: %dpx; flex-shrink: 0; color: %s;">%s</div><div style="flex: 1; min-width: 0px; color: %s;">%s</div></div>' % (
        kw, T['ink3'], k, T['ink'], v)


def guide_intents():
    """处理说明左侧：12 个意图，每项写当前发布版本与是否有未发布草稿（data.INTENT_GUIDE_LIST）。"""
    dv = INTENT_GUIDE['draft'].split('（')[0]
    out = ''
    for name, ver, draft in INTENT_GUIDE_LIST:
        on = name == INTENT_GUIDE['intent']
        sub_ = row(nowrap('发布 ' + ver, 11, T['accent_ink'] if on else T['ink4']) + (chip('草稿 %s 未发布' % dv, 'warning', 11) if draft else ''), 6)
        out += '<div style="padding: 7px 10px; border-radius: 6px; background: %s; display: flex; flex-direction: column; gap: 1px;%s">%s%s</div>' % (
            T['accent_bg'] if on else 'transparent', ' box-shadow: inset 3px 0 0 %s;' % T['accent'] if on else '',
            nowrap(name, 13, T['accent_ink'] if on else T['ink2'], 700 if on else 500), sub_)
    return card(col(out, 1), title=row(label('意图') + nowrap('%d 个' % len(INTENT_GUIDE_LIST), 12, T['ink4']), 6), pad='12px 8px', gap=8, style='width: 236px; flex-shrink: 0; box-sizing: border-box;')


GUIDE_PUBLISH_WHY = '还有 %d 条回归样例未通过，全部通过后才能发布'


def guide_body():
    """处理说明右侧：版本行 + 四段自然语言说明（可按店铺覆盖）+ 右栏结构化部分（只读）与回归结果（K21，D-21）。"""
    G = INTENT_GUIDE
    dv = G['draft'].split('（')[0]
    passed, total_ = G['regress']
    why = GUIDE_PUBLISH_WHY % (total_ - passed)
    # 悬停提示画在按钮左侧（箭头指向按钮），不遮挡下方右栏
    tip = '<div style="position: relative; display: flex; align-items: center; flex-shrink: 0;">%s<div style="position: absolute; right: -4px; top: 50%%; margin-top: -4px; width: 8px; height: 8px; background: %s; transform: rotate(45deg);"></div></div>' % (
        tooltip(why), T['ink'])
    pub = row(tip + btn('发布 %s' % dv, 'primary', 'md', 'upload', disabled=True, reason=why), 10)
    head = between(col(row(text(G['intent'], 16, T['ink'], 700) + chip('发布版本 ' + G['published'], 'neutral', 11) + chip('草稿 ' + G['draft'], 'warning', 11, dot=True), 8) +
                       muted('正在编辑草稿 %s · 每段可按店铺覆盖，覆盖的段落标「店铺覆盖」' % dv, 12), 4),
                   row(row(nowrap('店铺', 12, T['ink3']) + select_box('Forcome Direct', width='168px'), 6) + link('历史版本与对比', 12, 'history') + pub, 12))
    secs = ''
    for title, body, ov in G['sections']:
        ov_html, tag = '', ''
        if ov:
            who_, txt = ov.split('：', 1)
            tag = chip(who_, 'accent', 11, 'store')
            ov_html = '<div style="display: flex; gap: 8px; align-items: flex-start; background: %s; border: 1px solid %s; border-radius: 8px; padding: 7px 10px;">%s%s</div>' % (
                T['accent_bg'], T['accent_line'], icon('store', 14, T['accent_ink']), text(txt, 12, T['accent_ink'], 600))
        secs += card(between(row(text(title, 13, T['ink'], 700) + tag, 8), icon('edit', 14, T['ink4'])) + text(body, 13, T['ink2']) + ov_html,
                     pad='12px 14px', gap=6, tone='accent' if ov else None)
    struct = card(col(''.join(kvl(k, v) for k, v in G['structured']), 6), title='结构化部分', extra=chip('只读 · 代码执行', 'muted', 11, 'lock'), pad='12px 14px', gap=10)
    fails = ''
    for i, (no, case, want, got) in enumerate(G['failed']):
        head_ = between(row(icon('chev_d' if i == 0 else 'chev_r', 13, T['ink4'], 2) + icon('x_c', 14, T['bad'], 2) + nowrap(no, 12, T['accent'], 600), 6),
                        nowrap('期望「%s」· 实际「%s」' % (want, got), 12, T['ink3']) if i else '')
        detail = ''
        if i == 0:
            detail = col(kvl('情形', case, 40) + kvl('期望', '<b>%s</b>' % want, 40) + kvl('实际', '<span style="color: %s; font-weight: 600;">%s</span>' % (T['bad'], got), 40), 3, 'padding: 4px 0px 0px 25px;')
        fails += '<div style="border-top: 1px solid %s; padding: 8px 0px; display: flex; flex-direction: column; gap: 2px;">%s%s</div>' % (T['line2'], head_, detail)
    pct = int(round(passed * 100.0 / total_))
    reg = card(row(text('上次回归 %s 草稿：%d / %d 通过' % (dv, passed, total_), 13, T['ink'], 700) + nowrap('%d 条未通过' % (total_ - passed), 12, T['bad'], 600), 8) +
               progress(pct, 'warning', 6) + '<div style="display: flex; flex-direction: column;">%s</div>' % fails,
               title='回归样例', extra=btn('重新运行回归', 'secondary', 'sm', 'refresh'), pad='12px 14px', gap=8)
    note = row(icon('info', 14, T['ink4']) + muted('发布前自动跑该意图的回归样例，未全部通过时「发布」置灰；每次发布记入审计，可查看历史版本与对比。', 12), 6, 'flex-start')
    right = col(struct + reg + note, 12, 'width: 400px; flex-shrink: 0;')
    return col(head + '<div style="display: flex; gap: 16px; align-items: flex-start;">%s%s</div>' % (col(secs, 10, 'flex: 1; min-width: 0px;'), right), 14, 'flex: 1; min-width: 0px;')


def p19_guide():
    """「处理说明」页签（StatesAdmin K21）：左侧意图列表，右侧所选意图的处理说明、结构化部分与回归结果。"""
    return '<div style="display: flex; gap: 16px; align-items: flex-start;">%s%s</div>' % (guide_intents(), guide_body())


# ================================================================ P23 售后规则
def share_txt(v):
    f, c = v
    if f == 100:
        return 'FSH 100%'
    if c == 100:
        return '工厂 100%'
    return 'FSH %d · 工厂 %d' % (f, c) if f != c else '各 %d%%' % f


def edit_val(t, size=13, color=None):
    """点值直接修改：值 + 铅笔图标。"""
    return row(nowrap(t, size, color or T['ink'], 600) + icon('edit', 13, T['ink4']), 6)


def p23_ratio():
    cols = [('责任类型', 'left'), ('包含', 'left'), ('协商', 'left')] + [(lab, 'left') for lab, _ in RATIO_LABELS]
    rows = []
    for r in ('客户使用问题', '产品质量问题', '物流问题', '其他'):
        tag, tip = RESP_NOTES[r]
        rows.append([nowrap(r, 13, T['ink'], 600), nowrap(tip, 13, T['ink2']), chip(tag, 'accent' if tag == '需协商' else 'neutral', 11)] +
                    [edit_val(share_txt(RATIO_RULE[r][k]), 13, T['ink'] if RATIO_RULE[r][k][0] != RATIO_RULE[r][k][1] else T['ink2']) for _, k in RATIO_LABELS])
    t = table(cols, rows, '180px minmax(0, 1fr) 100px 150px 150px 150px', py=12)
    head = between(row(label('建议承担方') + nowrap('四类责任 × 三组费用 · 比例顺序 FSH / 工厂', 12, T['ink3']), 8),
                   row(icon('edit', 13, T['ink4']) + nowrap('点值直接修改，底部统一保存', 12, T['ink4']), 4))
    note = row(icon('info', 14, T['ink4']) + muted('新建售后单按责任类型带出建议比例；标「需协商」的类型确认后由售后负责人发起比例协商，协商不成时升级给生产厂负责人商定。', 12), 6)
    return col(head + t + note, 10)


def p23_filing():
    cells = ''.join(col(nowrap(k, 12, T['ink3']) + edit_val(v, 14), 6, 'padding: 14px 16px; min-width: 0px;%s' % (' border-left: 1px solid %s;' % T['line2'] if i else ''))
                    for i, (k, v) in enumerate(FILING_RULES))
    box = '<div style="display: grid; grid-template-columns: 1fr 1fr 1.2fr 0.8fr 1.4fr; background: #ffffff; border: 1px solid %s; border-radius: 12px; box-shadow: %s;">%s</div>' % (T['line'], SHADOW_XS, cells)
    head = row(label('报备规则') + nowrap('快递费用、额外赔偿先报备、审批通过后才能支付', 12, T['ink3']), 8)
    return col(head + box, 10)


def p23():
    return spage('zhoumin', '售后规则', '售后规则', '建议承担方与报备规则。修改只影响之后新建的售后单与报备；所有修改在底部统一保存，并记入审计日志。', '',
                 p23_ratio() + p23_filing(), save_bar(0, '修改承担方或报备规则后在这里统一保存'))


# ================================================================ P24 工厂账号
def factory_card(code):
    f = FACTORIES[code]
    c = [k for k, v in STAFF.items() if v.get('factory') == code and v['role'] == '生产厂对接人'][0]
    h = [k for k, v in STAFF.items() if v.get('factory') == code and v['role'] == '生产厂负责人'][0]
    skus = [k for k, v in PART_FACTORY.items() if v == code]
    head = between(row(tile('factory', 'accent', 36) + col(nowrap('生产厂 ' + code, 15, T['ink'], 700) + nowrap(f['scope'], 12, T['ink3']), 2), 12), chip('%d 个 SKU' % len(skus), 'neutral', 11))
    sku_t = table([('SKU', 'left'), ('名称', 'left'), ('类别', 'left')],
                  [[nowrap(k, 13, T['ink'], 600), nowrap(PARTS[k], 13, T['ink2']), nowrap(PART_CATEGORY[k], 13, T['ink2'])] for k in skus],
                  '140px minmax(0, 1fr) 90px', dense=True)
    sku_sec = col(between(row(label('负责的 SKU') + nowrap('售后单按 SKU 派发给本厂', 12, T['ink4']), 8), btn('编辑负责的 SKU', 'secondary', 'sm', 'edit')) + sku_t, 8)

    def person(k, role, sub_, right):
        s = STAFF[k]
        return between(row(avatar(s['avatar'], 'amber', 28) + col(row(nowrap(s['name'], 13, T['ink'], 600) + nowrap(role, 12, T['ink3']), 8) + nowrap(sub_, 12, T['ink4']), 1), 10), right)
    ppl = (person(c, '对接人', '%s · 最近登录 %s' % (STAFF[c]['dept'], STAFF[c]['last_login']), row(state('已启用') + icon_btn('more', size=24), 6)) +
           divider() + person(h, '负责人', '不分配系统角色，不登录系统', chip('比例升级商定人', 'neutral', 11)))
    ppl_sec = col(label('成员') + card(ppl, pad='10px 14px', gap=10), 8)
    # 来信邮箱：识别生产厂来信（来源「生产厂」，R-FT-06、E-27）；第一阶段为种子数据，第二阶段起在这里维护（D-27）
    mail_sec = col(between(row(label('来信邮箱') + nowrap('用于识别生产厂来信', 12, T['ink4']), 8), btn('编辑', 'secondary', 'sm', 'edit')) +
                   row(''.join(chip(m, 'neutral', 12) for m in f['mail']), 6, wrap=True), 8)
    return card(head + sku_sec + mail_sec + ppl_sec, pad='16px 18px', gap=16)


def p24():
    note = row(icon('info', 14, T['ink4']) + muted('成员来自钉钉通讯录。对接人只看本厂任务，寄件完成 30 天后隐藏收件信息；负责人只在比例协商升级时商定，不分配系统角色。', 12), 6)
    cards = '<div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start;">%s%s</div>' % (factory_card('FQD'), factory_card('FZJ'))
    return spage('liuyang', '工厂账号', '工厂账号', '集团内两家生产厂。售后单按 SKU 归属派发，报价、协商与结算按厂分开。', btn('从钉钉添加生产厂成员', 'primary', 'md', 'plus'),
                 cards + note, save_bar(0, '成员与负责的 SKU 的修改在这里统一保存'))


# ================================================================ P20 团队与权限
MEMBERS = [(k, STAFF[k]['email'], STAFF[k]['last_login']) for k in ('liting', 'chenchen', 'zhoumin', 'wanglei', 'zhaoqian', 'liuyang')]
TEAM_TABS = ['成员', '角色权限']


def team_tabs(active):
    return tabs([('成员', len(MEMBERS)), ('角色权限', None)], active)


def role_cell(s):
    """角色列：成员可有多个角色（导航取并集），逐个显示为中性标签；示例数据为单角色（STAFF['roles'] 缺省时取 role）。"""
    return row(''.join(cat(r) for r in (s.get('roles') or [s['role']])), 4, wrap=True, extra='row-gap: 4px;')


def member_table(sel=None, lang=True):
    """成员表；lang=False 为第一阶段（不显示「语言」列，prd_c P20「第一阶段」）。"""
    cols = [('成员', 'left'), ('钉钉部门', 'left'), ('角色', 'left'), ('数据范围', 'left')] + ([('语言', 'left')] if lang else []) + [('状态', 'left'), ('最近登录', 'left'), ('', 'right')]
    rows = []
    for k, mail, last in MEMBERS:
        s = STAFF[k]
        who_ = row(avatar(s['avatar'], AV_TONE.get(s['role'], 'green'), 28) + col(nowrap(s['name'] + ('（我）' if k == 'liuyang' else ''), 13, T['ink'], 700) + nowrap(mail, 12, T['ink4']), 1), 10)
        lang_ = [nowrap(s.get('lang', '—'), 13, T['ink2'] if s.get('lang') else T['ink4'])] if lang else []
        rows.append([who_, nowrap(s['dept'], 13, T['ink2']), role_cell(s), nowrap(s['stores'], 13, T['ink2'])] + lang_ +
                    [state('已启用'), nowrap(last, 13, T['ink2']), icon_btn('more', size=24)])
    return table(cols, rows, 'minmax(0, 1fr) 150px 190px 110px %s90px 110px 28px' % ('90px ' if lang else ''), sel=sel, py=11)


def p20_body(sel=None, lang=True):
    head = between(row(label('成员') + nowrap('%d 人 · 来自钉钉通讯录，%s 同步' % (len(MEMBERS), CHANNEL_SYNC['钉钉']), 12, T['ink3']), 8), btn('从钉钉添加', 'primary', 'sm', 'plus'))
    return col(head + member_table(sel, lang), 10)


def p20(h=900, phase1=False):
    """P20；phase1=True 为第一阶段版：页头没有备用审批人，成员表没有「语言」列（prd_c P20「第一阶段」）。"""
    if phase1:
        return spage('liuyang', '团队与权限', '团队与权限', '成员与部门来自钉钉通讯录；在这里分配角色与店铺数据范围。钉钉离职的成员自动停用。', '', p20_body(lang=False),
                     save_bar(0, '角色与数据范围的修改在这里统一保存'), team_tabs('成员'), h=h, phase1=True)
    backup = row(col(nowrap('备用审批人', 12, T['ink2'], 600) + nowrap('唯一有权审批的人是发起人时转给此人（R-AP-02）', 11, T['ink4']), 1) + select_box('王磊 · 售后负责人', width='168px', h=32), 10)
    return spage('liuyang', '团队与权限', '团队与权限', '成员与部门来自钉钉通讯录；在这里分配角色、店铺数据范围与备用审批人。钉钉离职的成员自动停用。', backup, p20_body(),
                 save_bar(0, '角色、数据范围与备用审批人的修改在这里统一保存'), team_tabs('成员'), h=h)


ROLE_HEAD = ['坐席', '客服主管', '售后负责人', '知识库负责人', '管理员', '生产厂对接人']
MATRIX = [  # prd_d 10.1 功能权限：(能力, 上线阶段, 各角色)；空白画为「—」。阶段：一起 = 第一阶段起，仅一 = 只在第一阶段，二起，三
    ('查看工单（列表与详情）', '一起', ['●', '●', '●', '只读', '', '']),
    ('标记来信「无需回复」', '一起', ['●', '●', '', '', '', '']),
    ('为未归属店铺的来信指定店铺', '一起', ['', '●', '', '', '', '']),
    ('回复、标签、合并、转人工、手工新建、认领、标记解决、重开与关闭', '二起', ['●', '●', '●', '', '', '']),
    ('合并与拆分客户身份', '二起', ['●', '●', '●', '', '', '']),
    ('改派他人工单、强制接手、调整工单优先级', '二起', ['', '●', '', '', '', '']),
    ('提交审批单；提交时同时创建售后单（路径 B）', '二起', ['●', '●', '●', '', '', '']),
    ('审批含报备的审批单', '二起', ['', '●', '', '', '', '']),
    ('审批只含动作的审批单', '二起', ['', '●', '●', '', '', '']),
    ('撤回审批单', '二起', ['○', '○', '○', '', '', '']),
    ('执行人工操作清单（兜底）', '二起', ['○', '○', '○', '', '', '']),
    ('查看售后单、登记台账', '一起', ['只读', '●', '●', '', '', '']),
    ('新建登记（手工登记）', '仅一', ['', '●', '●', '', '', '']),
    ('编辑进行中的手工登记单、设为已完成', '一起', ['', '○ 自己登记的', '○ 登记或负责的', '', '', '']),
    ('登记台账补登（已完成的单）、修改汇率', '一起', ['', '', '●', '', '', '']),
    ('改派售后单负责人', '一起', ['', '●', '●', '', '', '']),
    ('取消（终止）售后单', '一起', ['', '●', '●', '', '', '']),
    ('在工单上「转售后确认」', '二起', ['●', '●', '', '', '', '']),
    ('手工新建售后单、确认责任与处理方式、退回继续排查', '二起', ['', '●', '●', '', '', '']),
    ('发起与录入比例协商、重开协商、退回生产厂报价、生成结算批次', '二起', ['', '', '●', '', '', '']),
    ('维护知识条目、素材库、审核沉淀', '三', ['提交候选', '审核政策规则', '维护排查树', '●', '', '']),
    ('查看报表', '一起', ['', '●', '●', '●', '●', '']),
    ('查看成本、承担比例与结算金额（含报表、导出、下钻与审计前后值）', '一起', ['', '●', '●', '', '', '本厂部分']),
    ('查看审计日志（P27）', '一起', ['○', '●', '○', '○', '●', '']),
    ('售后规则（P23）、标签库、模板、SLA', '二起', ['', '●', '', '', '', '']),
    ('处理规则（P19：发送方式、风险信号、渠道内容能力、处理说明）', '三', ['', '●', '', '', '', '']),
    ('渠道与店铺（P18）、成员与角色、店铺数据范围（P20）', '一起', ['', '', '', '', '●', '']),
    ('动作映射（P22）、备用审批人（P20）、工厂账号（P24）、模型（P25）、系统状态（P26）', '二起', ['', '', '', '', '●', '']),
    ('工厂工作台：本厂任务的报价、回填、答复、结算确认、留言', '二起', ['', '', '', '', '', '●']),
]
P1_STAGES = ('一起', '仅一')  # 第一阶段 K17 只显示这些行（prd_d 10.1）
# 分组：(组名, MATRIX 下标)；全部展开。成本可见与审计日志都是「看数据」的能力，归入「报表」组
MATRIX_GROUPS = [('工单', (0, 1, 2, 3, 4, 5)), ('审批', (6, 7, 8, 9, 10)), ('售后', (11, 12, 13, 14, 15, 16, 17, 18, 19)),
                 ('知识', (20,)), ('报表', (21, 22, 23)), ('设置', (24, 25, 26, 27)), ('工厂', (28,))]


def mark(v):
    if v == '●':
        return '<div style="width: 9px; height: 9px; border-radius: 999px; background: %s; margin: 0px auto;"></div>' % T['accent']
    if v == '○':
        return '<div style="width: 9px; height: 9px; box-sizing: border-box; border-radius: 999px; border: 1.5px solid %s; margin: 0px auto;"></div>' % T['accent']
    if v.startswith('○'):  # 「○（自己登记的）」：空心圆 + 范围说明
        return '<div style="display: flex; align-items: center; justify-content: center; gap: 4px;"><div style="width: 9px; height: 9px; box-sizing: border-box; border-radius: 999px; border: 1.5px solid %s; flex-shrink: 0;"></div><div style="font-size: 11px; color: %s; white-space: nowrap;">%s</div></div>' % (
            T['accent'], T['ink3'], v[1:].strip('（）'))
    if v:
        return '<div style="font-size: 12px; color: %s; text-align: center; white-space: nowrap;">%s</div>' % (T['ink3'], v)
    return '<div style="font-size: 12px; color: %s; text-align: center;">—</div>' % T['ink4']


def perm_table(groups=MATRIX_GROUPS, stages=None):
    """一张表全部展开：左侧分组小标题，无权限为「—」。stages 给定时只显示这些上线阶段的行（第一阶段 K17）。"""
    tpl = '72px minmax(0, 1fr) repeat(6, 120px)'
    g = 'display: grid; grid-template-columns: %s; column-gap: 12px; align-items: center;' % tpl
    head = '<div style="%s padding: 9px 16px; background: %s; border-bottom: 1px solid %s; font-size: 11px; font-weight: 600; color: %s; white-space: nowrap;"><div>分组</div><div>能力</div>%s</div>' % (
        g, T['subtle'], T['line'], T['ink4'], ''.join('<div style="text-align: center;">%s</div>' % h for h in ROLE_HEAD))
    body = ''
    gi = 0
    for name, idx in groups:
        idx = [i for i in idx if stages is None or MATRIX[i][1] in stages]
        if not idx:
            continue
        top = ' border-top: 1px solid %s;' % T['line'] if gi else ''
        gi += 1
        for k, i in enumerate(idx):
            cap_, _stage, vals = MATRIX[i]
            sep = top if k == 0 else ' border-top: 1px solid %s;' % T['line2']
            gl = '<div style="font-size: 12px; font-weight: 700; color: %s;">%s</div>' % (T['ink3'], name) if k == 0 else '<div></div>'
            body += '<div style="%s padding: 7px 16px;%s">%s<div style="font-size: 13px; color: %s; white-space: nowrap; min-width: 0px;">%s</div>%s</div>' % (
                g, sep, gl, T['ink2'], cap_, ''.join('<div>%s</div>' % mark(v) for v in vals))
    return '<div style="border: 1px solid %s; border-radius: 12px; overflow: hidden; background: #ffffff; box-shadow: %s;">%s%s</div>' % (T['line'], SHADOW_XS, head, body)


def perm_legend():
    return row(row(mark('●') + nowrap('有权限', 12, T['ink3']), 5) + row(mark('○') + nowrap('只能看自己发起或负责的', 12, T['ink3']), 5) +
               row(nowrap('—', 12, T['ink4']) + nowrap('无权限', 12, T['ink3']), 5) + nowrap('文字：部分能力', 12, T['ink3']), 16)


def perm_matrix(phase1=False):
    """「角色权限」页签（StatesAdmin K17）。phase1=True 时只显示第一阶段已上线的能力行（prd_d 10.1「阶段」列）。"""
    note = '只读 · 第一阶段只显示已上线的能力' if phase1 else '只读 · 按角色固定；系统发起的审批单由关联售后单的负责人撤回'
    head = between(row(label('角色权限') + nowrap(note, 12, T['ink3']), 8), perm_legend())
    return col(head + perm_table(stages=P1_STAGES if phase1 else None), 10)


if __name__ == '__main__':
    save('Settings.dc.html', p18())
    save('SettingsActions.dc.html', p22())
    save('SettingsRules.dc.html', p19())
    save('SettingsAfterSales.dc.html', p23())
    save('SettingsTeam.dc.html', p20())
    save('SettingsFactory.dc.html', p24())
    print('ok')
