# -*- coding: utf-8 -*-
"""设置：左侧菜单每项一个独立页面，页内多块内容用页签，编辑表单用右侧抽屉。
P18 渠道与店铺 · P22 动作映射 · P19 处理规则 · P23 售后规则 · P24 工厂账号 · P20 团队与权限（共用 as_common.settings_menu）。
P19、P20 的非默认页签画面放在 StatesAdmin：K15 风险信号、K16 渠道内容能力、K17 角色权限；P18 新增店铺抽屉为 K8。
保存口径：修改 → 吸底保存栏（ui.save_bar）→ 保存；离开页面时有未保存提示。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from data import *
from as_common import *


def tile(ic, tone='accent', size=32):
    fg, bg = {'accent': (T['accent'], T['accent_bg']), 'ok': (T['ok'], T['ok_bg']), 'muted': (T['ink3'], T['line2']), 'bad': (T['bad'], T['bad_bg'])}[tone]
    return '<div style="width: %dpx; height: %dpx; border-radius: 8px; background: %s; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%s</div>' % (size, size, bg, icon(ic, 18, fg))


def spage(user, active, title, desc, actions, inner, bar='', tabs_html='', h=900):
    """设置页外壳：左侧设置菜单 + 右侧内容区；tabs_html 为页内页签；bar 为吸底保存栏（ui.save_bar），固定在内容区底部。"""
    role = STAFF[user]['role']
    head = between(col('<div style="font-size: 20px; font-weight: 700; color: %s; letter-spacing: -0.01em;">%s</div><div style="font-size: 13px; color: %s;">%s</div>' % (T['ink'], title, T['ink3'], desc), 4),
                   row(actions, 8), 'flex-end')
    scroll = '<div style="flex: 1; min-height: 0px; padding: 16px 24px 16px 24px; display: flex; flex-direction: column; gap: 16px; overflow: hidden;">%s%s%s</div>' % (head, tabs_html, inner)
    main = '<div style="flex: 1; min-width: 0px; min-height: 0px; display: flex; flex-direction: column;">%s%s</div>' % (scroll, bar)
    body = '<div style="flex: 1; min-height: 0px; display: flex; flex-direction: row;">%s%s</div>' % (settings_menu(active, role), main)
    return app(user, '设置', ['设置', active], body, h=h)


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
def test_btn():
    return btn('测试连接', 'link', 'sm')


def ch_card(ic, name, st, lines, foot='', tone='accent', card_tone=None, sync=None, test=True):
    """渠道卡：标题下统一写「最近同步 hh:mm」，右上角为连接状态与「测试连接」文字按钮。"""
    sub_ = nowrap('最近同步 ' + sync, 11, T['ink4']) if sync else ''
    head = between(row(tile(ic, tone) + col('<div style="font-size: 14px; font-weight: 600; color: %s; white-space: nowrap;">%s</div>' % (T['ink'], name) + sub_, 0), 10),
                   row(st + (test_btn() if test else ''), 6))
    body = col(''.join(text(l, 12, T['ink3']) for l in lines), 2)
    f = '<div style="margin-top: auto;">%s</div>' % foot if foot else ''
    return card(head + body + f, pad='12px 14px', gap=8, tone=card_tone, style='height: 100%; box-sizing: border-box;')


def amazon_card(err=False):
    if err:
        return ch_card('store', '亚马逊 SP-API', state('连接异常'),
                       ['10:05 起连续 3 次调用失败：授权令牌已过期', '退款、取消与订单同步暂停，恢复后自动补执行与补拉；买家消息走 Gmail，不受影响'],
                       row(btn('重新授权', 'primary', 'sm', 'refresh') + btn('查看错误日志', 'ghost', 'sm'), 6), 'bad', 'danger', sync=CHANNEL_SYNC['SP-API 异常'])
    return ch_card('store', '亚马逊 SP-API', state('已连接'), ['2 个店铺 · 退款、取消（审批后执行）', '订单经 SP-API 准实时同步（订单通知队列 SQS）'], '', 'ok', sync=CHANNEL_SYNC['SP-API'])


def shopify_card():
    return ch_card('store', 'Shopify Admin API', state('已连接'), ['2 个店铺 · 退款、改地址、取消、订单备注', '订单经 Admin API 准实时同步'], '', 'ok', sync=CHANNEL_SYNC['Shopify'])


def jijia_card():
    return ch_card('link', '积加 ERP', state('已连接'), ['亚马逊订单收件人', '库存、售后出库单、单号与运费（积加对接易仓）'], '', 'ok', sync=CHANNEL_SYNC['积加'])


def gmail_card(err=False):
    if err:
        return ch_card('message', 'Gmail', state('连接异常'),
                       ['support@forcome.mx 访问失败（10:05 起连续 3 次）：请检查全域委派范围与邮箱状态', '该邮箱来信暂存，恢复后自动补拉；回复进入待发队列'],
                       row(btn('重新检测', 'primary', 'sm', 'refresh') + btn('查看错误日志', 'ghost', 'sm'), 6), 'bad', 'danger', sync=CHANNEL_SYNC['Gmail 异常'])
    return ch_card('message', 'Gmail', state('已连接'), ['4 个邮箱：2 个亚马逊买家消息、2 个 Shopify 客服', '新邮件推送，实时收取'], '', 'ok', sync=CHANNEL_SYNC['Gmail'])


def p18_channels():
    im = ch_card('users', '钉钉', state('已连接'), ['通讯录：成员与部门每小时同步', '工作通知推送；扫码登录与钉钉内免登'], '', 'ok', sync=CHANNEL_SYNC['钉钉'])
    lc_head = between(row(tile('box', 'muted') + col(nowrap('易仓海外仓', 14, T['ink2'], 600) + nowrap('最近同步 %s · 经积加' % CHANNEL_SYNC['易仓'], 11, T['ink4']), 0), 10),
                      row(chip('经积加对接', 'neutral', 11) + test_btn(), 6))
    lc = dashed_card(lc_head + muted('库存、售后出库单、单号与实际运费都经积加读写，本系统不直连易仓接口；测试连接走积加。', 12), '12px 14px', 8)
    return '<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: stretch;">%s%s%s%s%s%s</div>' % (
        amazon_card(), shopify_card(), gmail_card(), jijia_card(), im, lc)


def copy_val(v):
    """平台标识全文显示，右侧复制图标。"""
    return row(nowrap(v, 13, T['ink2']) + '<div title="复制" style="flex-shrink: 0; display: flex;">%s</div>' % icon('copy', 13, T['ink4']), 6)


RULE_ROUTE = '亚马逊按买家消息的收件邮箱（每店一个）与发件域名（amazon.com / .ca / .com.mx）识别店铺和站点；Shopify 按客服邮箱。识别不出的来信进入「未归属店铺」队列，由客服主管指定店铺，不生成草稿。'
RULE_LAYER = '配置按「全局 → 平台 → 店铺」取值。店铺可覆盖签名、政策口径、模板、素材与链接白名单、SLA 内部目标；意图、风险信号、动作分级只能全局配置。'


def p18_stores():
    cols = [('店铺', 'left'), ('站点', 'left'), ('进线邮箱', 'left'), ('平台标识', 'left'), ('覆盖项', 'left'), ('状态', 'left'), ('', 'right')]
    rows = []
    for s_ in STORES:
        amz = s_['platform'] == '亚马逊'
        e = col(nowrap(s_['mailbox'], 13, T['ink'], 600) + nowrap('亚马逊买家消息' if amz else 'Shopify 客服邮箱', 11, T['ink4']), 2)
        k, v = s_['sid'].rsplit(' ', 1) if amz else ('店铺域名', s_['sid'])
        sid = col(nowrap(k, 11, T['ink4']) + copy_val(v), 2)
        over = row(''.join(chip(o, 'outline', 11) for o in STORE_OVERRIDES[s_['id']]), 4)
        rows.append([col(nowrap(s_['name'], 13, T['ink'], 600) + '<div style="display: flex;">%s</div>' % channel(s_['platform'], None, None, 11), 4),
                     nowrap(' · '.join(s_['sites']), 13, T['ink2']), e, sid, over, state('已连接'), link('编辑', 12)])
    t = table(cols, rows, '190px 120px 240px 260px minmax(0, 1fr) 80px 40px', py=12)
    head = between(row(label('店铺') + nowrap('4 个', 12, T['ink3']) + divider(True, 12) + info_tip('进线识别', RULE_ROUTE) + info_tip('配置取值层级', RULE_LAYER), 10),
                   btn('新增店铺', 'secondary', 'sm', 'plus'))
    return col(head + t, 10)


def p18(h=900):
    inner = col(label('渠道连接') + p18_channels(), 10) + p18_stores()
    return spage('liuyang', '渠道与店铺', '渠道与店铺', '订单由平台直读；库存、易仓出库单与运费经积加；物流轨迹经 17TRACK；退款、改地址、取消走平台官方接口；客户来信统一经 Gmail 收发。店铺在右侧抽屉里新增与编辑。', '',
                 inner, h=h)


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
                                       muted('该动作由坐席在平台后台人工处理。', 12), 4)))
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
    return spage('liuyang', '动作映射', '动作映射', '统一动作到各平台接口的映射。分级只能全局配置；改映射后在底部统一保存，并记入审计日志。', '',
                 p22_explain() + p22_table(), save_bar(0, '修改接口映射后在这里统一保存，并记入审计日志'))


# ================================================================ P19 处理规则
# 意图发送规则与放开进度取 data.SEND_RULES；未保存修改取 data.SEND_RULE_EDITS
INTENTS = SEND_RULES
EDITED = SEND_RULE_EDITS
RULE_TABS = ['发送方式与阈值', '风险信号', '渠道内容能力']


def rule_tabs(active):
    return tabs([(t, None) for t in RULE_TABS], active)


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
    return spage('zhoumin', '处理规则', '处理规则', '每个意图的发送方式与阈值、风险信号、各渠道能放的内容。修改阈值与关闭风险信号需二次确认，并记入审计日志。', '',
                 p19_send_table(), save_bar(len(EDITED), '%s · 置信度阈值 %s → %s；保存时二次确认，离开页面前会提示' % (en, e_old, e_new)), rule_tabs('发送方式与阈值'))


def p19_risk():
    """「风险信号」页签（StatesAdmin K15）：命中即转人工；两条硬规则锁定，两条关闭需二次确认并写明影响。"""
    out = ''
    for i, (n, d, p, sw) in enumerate(RISK_SIGNALS):
        less = RISK_OFF_IMPACT.get(n)
        tg = toggle_on_locked() if sw == 'lock' else toggle(True)
        right = row((nowrap('硬规则，不可关闭', 12, T['ink4']) if sw == 'lock' else '') + tg, 8)
        warn_ = row(icon('alert', 13, T['warn'], 2) + nowrap('关闭需二次确认 · 影响：近 30 天约少转人工 %d 封，这些来信将按意图生成草稿' % less, 12, T['warn']), 5) if less else ''
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
    return card(head + sku_sec + ppl_sec, pad='16px 18px', gap=16)


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


def member_table(sel=None):
    cols = [('成员', 'left'), ('钉钉部门', 'left'), ('角色', 'left'), ('数据范围', 'left'), ('语言', 'left'), ('状态', 'left'), ('最近登录', 'left'), ('', 'right')]
    rows = []
    for k, mail, last in MEMBERS:
        s = STAFF[k]
        who_ = row(avatar(s['avatar'], AV_TONE.get(s['role'], 'green'), 28) + col(nowrap(s['name'] + ('（我）' if k == 'liuyang' else ''), 13, T['ink'], 700) + nowrap(mail, 12, T['ink4']), 1), 10)
        rows.append([who_, nowrap(s['dept'], 13, T['ink2']), cat(s['role']), nowrap(s['stores'], 13, T['ink2']), nowrap(s.get('lang', '—'), 13, T['ink2'] if s.get('lang') else T['ink4']),
                     state('已启用'), nowrap(last, 13, T['ink2']), icon_btn('more', size=24)])
    return table(cols, rows, 'minmax(0, 1fr) 150px 130px 110px 90px 90px 110px 28px', sel=sel, py=11)


def p20_body(sel=None):
    head = between(row(label('成员') + nowrap('%d 人 · 来自钉钉通讯录，%s 同步；钉钉离职的成员自动停用' % (len(MEMBERS), CHANNEL_SYNC['钉钉']), 12, T['ink3']), 8), btn('从钉钉添加', 'primary', 'sm', 'plus'))
    return col(head + member_table(sel), 10)


def p20():
    backup = row(col(nowrap('备用审批人', 12, T['ink2'], 600) + nowrap('唯一有权审批的人是发起人时转给此人（R-AP-02）', 11, T['ink4']), 1) + select_box('王磊 · 售后负责人', width='168px', h=32), 10)
    return spage('liuyang', '团队与权限', '团队与权限', '成员与部门来自钉钉通讯录；在这里分配角色、店铺数据范围与备用审批人。', backup, p20_body(),
                 save_bar(0, '角色、数据范围与备用审批人的修改在这里统一保存'), team_tabs('成员'))


ROLE_HEAD = ['坐席', '客服主管', '售后负责人', '知识库负责人', '管理员', '生产厂对接人']
MATRIX = [  # prd_d 10.1 功能权限（能力文字与圆点照原文）
    ('查看工单、回复、标签、合并、转人工、手工新建工单', ['●', '●', '●', '只读', '', '']),
    ('合并与拆分客户身份', ['●', '●', '●', '', '', '']),
    ('改派他人工单、强制接手', ['', '●', '', '', '', '']),
    ('提交审批单；提交时同时创建售后单（路径 B）', ['●', '●', '●', '', '', '']),
    ('审批含报备的审批单', ['', '●', '', '', '', '']),
    ('审批只含动作的审批单', ['', '●', '●', '', '', '']),
    ('撤回审批单', ['○', '○', '○', '', '', '']),
    ('执行人工操作清单（兜底）', ['○', '○', '○', '', '', '']),
    ('查看售后单、登记台账', ['只读', '●', '●', '', '', '']),
    ('登记台账补登', ['', '', '●', '', '', '']),
    ('手工新建售后单、确认责任与处理方式、退回继续排查、终止售后单', ['', '●', '●', '', '', '']),
    ('发起与录入比例协商、重开协商、退回生产厂报价、生成结算批次', ['', '', '●', '', '', '']),
    ('维护知识条目、素材库、审核沉淀', ['提交候选', '审核政策规则', '维护排查树', '●', '', '']),
    ('查看报表', ['', '●', '●', '●', '●', '']),
    ('处理规则、发送方式、风险信号、售后规则、标签库、模板、SLA', ['', '●', '', '', '', '']),
    ('渠道、店铺、动作映射、成员、角色、备用审批人、生产厂账号', ['', '', '', '', '●', '']),
    ('工厂工作台：本厂任务的报价、回填、答复、结算确认、留言', ['', '', '', '', '', '●']),
]
# 分组：(组名, MATRIX 下标)；全部展开
MATRIX_GROUPS = [('工单', (0, 1, 2)), ('审批', (3, 4, 5, 6, 7)), ('售后', (8, 9, 10, 11)),
                 ('知识', (12,)), ('报表', (13,)), ('设置', (14, 15)), ('工厂', (16,))]


def mark(v):
    if v == '●':
        return '<div style="width: 9px; height: 9px; border-radius: 999px; background: %s; margin: 0px auto;"></div>' % T['accent']
    if v == '○':
        return '<div style="width: 9px; height: 9px; box-sizing: border-box; border-radius: 999px; border: 1.5px solid %s; margin: 0px auto;"></div>' % T['accent']
    if v:
        return '<div style="font-size: 12px; color: %s; text-align: center; white-space: nowrap;">%s</div>' % (T['ink3'], v)
    return '<div style="font-size: 12px; color: %s; text-align: center;">—</div>' % T['ink4']


def perm_table(groups=MATRIX_GROUPS):
    """一张表全部展开：左侧分组小标题，无权限为「—」。"""
    tpl = '72px minmax(0, 1fr) repeat(6, 120px)'
    g = 'display: grid; grid-template-columns: %s; column-gap: 12px; align-items: center;' % tpl
    head = '<div style="%s padding: 9px 16px; background: %s; border-bottom: 1px solid %s; font-size: 11px; font-weight: 600; color: %s; white-space: nowrap;"><div>分组</div><div>能力</div>%s</div>' % (
        g, T['subtle'], T['line'], T['ink4'], ''.join('<div style="text-align: center;">%s</div>' % h for h in ROLE_HEAD))
    body = ''
    for gi, (name, idx) in enumerate(groups):
        top = ' border-top: 1px solid %s;' % T['line'] if gi else ''
        for k, i in enumerate(idx):
            cap_, vals = MATRIX[i]
            sep = top if k == 0 else ' border-top: 1px solid %s;' % T['line2']
            gl = '<div style="font-size: 12px; font-weight: 700; color: %s;">%s</div>' % (T['ink3'], name) if k == 0 else '<div></div>'
            body += '<div style="%s padding: 7px 16px;%s">%s<div style="font-size: 13px; color: %s; white-space: nowrap; min-width: 0px;">%s</div>%s</div>' % (
                g, sep, gl, T['ink2'], cap_, ''.join('<div>%s</div>' % mark(v) for v in vals))
    return '<div style="border: 1px solid %s; border-radius: 12px; overflow: hidden; background: #ffffff; box-shadow: %s;">%s%s</div>' % (T['line'], SHADOW_XS, head, body)


def perm_legend():
    return row(row(mark('●') + nowrap('有权限', 12, T['ink3']), 5) + row(mark('○') + nowrap('只能看自己发起或负责的', 12, T['ink3']), 5) +
               row(nowrap('—', 12, T['ink4']) + nowrap('无权限', 12, T['ink3']), 5) + nowrap('文字：部分能力', 12, T['ink3']), 16)


def perm_matrix():
    """「角色权限」页签（StatesAdmin K17）。"""
    head = between(row(label('角色权限') + nowrap('只读 · 按角色固定；系统发起的审批单由关联售后单的负责人撤回', 12, T['ink3']), 8), perm_legend())
    return col(head + perm_table(), 10)


if __name__ == '__main__':
    save('Settings.dc.html', p18())
    save('SettingsActions.dc.html', p22())
    save('SettingsRules.dc.html', p19())
    save('SettingsAfterSales.dc.html', p23())
    save('SettingsTeam.dc.html', p20())
    save('SettingsFactory.dc.html', p24())
    print('ok')
