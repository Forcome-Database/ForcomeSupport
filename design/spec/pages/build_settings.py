# -*- coding: utf-8 -*-
"""P18 设置 · 渠道与店铺 · P19 设置 · 处理规则 · P20 设置 · 团队与权限。三页共用设置左侧菜单（as_common.settings_menu）。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from data import *
from as_common import *


def tile(ic, tone='accent'):
    fg, bg = {'accent': (T['accent'], T['accent_bg']), 'ok': (T['ok'], T['ok_bg']), 'muted': (T['ink3'], T['line2']), 'bad': (T['bad'], T['bad_bg'])}[tone]
    return '<div style="width: 32px; height: 32px; border-radius: 8px; background: %s; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%s</div>' % (bg, icon(ic, 18, fg))


def save_bar():
    return row(nowrap('没有未保存的修改', 12, T['ink4']) + btn('保存修改', 'primary', disabled=True), 10)


# ================================================================ P18 渠道与店铺
def ch_card(ic, name, st, lines, foot='', tone='accent', card_tone=None):
    head = between(row(tile(ic, tone) + '<div style="font-size: 13.5px; font-weight: 650; color: %s; white-space: nowrap;">%s</div>' % (T['ink'], name), 10), st)
    body = col(''.join(text(l, 12, T['ink3']) for l in lines), 2)
    f = '<div style="margin-top: auto;">%s</div>' % foot if foot else ''
    return card(head + body + f, pad='11px 13px', gap=8, tone=card_tone, style='height: 100%; box-sizing: border-box;')


def amazon_card(err=False):
    if err:
        return ch_card('store', '亚马逊 SP-API', state('连接异常'),
                       ['10:05 起连续 3 次调用失败：授权令牌已过期', '退款与取消暂停，恢复后自动补执行；订单查询走积加、买家消息走 Gmail，不受影响'],
                       row(btn('重新授权', 'primary', 'sm', 'refresh') + btn('查看错误日志', 'ghost', 'sm'), 6), 'bad', 'danger')
    return ch_card('store', '亚马逊 SP-API', state('已连接'), ['2 个店铺 · 退款、取消（审批后执行）', '订单、发货与退货信息由积加同步'], '', 'ok')


def shopify_card():
    return ch_card('store', 'Shopify Admin API', state('已连接'), ['2 个店铺 · 退款、改地址、取消、订单备注', '订单信息由积加同步'], '', 'ok')


def jijia_card():
    return ch_card('link', '积加 ERP', state('已连接'), ['订单与物流轨迹（聚合亚马逊、Shopify）', '库存、售后出库单、单号与运费（积加对接良仓）'], '', 'ok')


def gmail_card(err=False):
    if err:
        return ch_card('message', 'Gmail', state('连接异常'),
                       ['support@forcome.mx 授权已失效（10:05 起连续 3 次失败）', '该邮箱来信暂存，回复进入待发队列'],
                       row(btn('重新授权', 'primary', 'sm', 'refresh') + btn('查看错误日志', 'ghost', 'sm'), 6), 'bad', 'danger')
    return ch_card('message', 'Gmail', state('已连接'), ['4 个邮箱：2 个亚马逊买家消息、2 个 Shopify 客服', '最近推送 10:18'], '', 'ok')


def p18_channels():
    im = ch_card('users', '钉钉', state('已连接'), ['通讯录：成员与部门每小时同步 · 最近 10:00', '工作通知推送；扫码登录与钉钉内免登'], '', 'ok')
    lc = dashed_card(between(row(icon('box', 15, T['ink3']) + nowrap('良仓海外仓', 13, T['ink2'], 650), 6), chip('经积加对接', 'neutral', 10)) +
                     muted('库存、售后出库单、单号与实际运费都经积加读写，本系统不直连良仓接口。', 12), '11px 13px', 6)
    return '<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; align-items: stretch;">%s%s%s%s%s%s</div>' % (
        amazon_card(), shopify_card(), gmail_card(), jijia_card(), im, lc)


def p18_stores():
    cols = [('店铺', 'left'), ('站点', 'left'), ('进线邮箱', 'left'), ('平台标识', 'left'), ('覆盖项', 'left'), ('状态', 'left')]
    over = {'amz-direct': '模板 1', 'amz-auto': '签名', 'shop-com': '政策 1', 'shop-mx': '签名'}
    rows = []
    for s_ in STORES:
        amz = s_['platform'] == '亚马逊'
        e = col(nowrap(s_['mailbox'], 12, T['ink2'], 600) + nowrap('亚马逊买家消息' if amz else 'Shopify 客服邮箱', 11, T['ink4']), 0)
        k, v = s_['sid'].rsplit(' ', 1) if amz else ('店铺域名', s_['sid'])
        sid = col(nowrap(k, 10.5, T['ink4']) + ellipsis(v, 11.5, T['ink2']), 0)
        rows.append([col(nowrap(s_['name'], 12.5, T['ink'], 650) + '<div style="display: flex;">%s</div>' % channel(s_['platform'], None, None, 10.5), 3),
                     nowrap(' · '.join(s_['sites']), 12, T['ink2']), e, sid, nowrap(over[s_['id']], 12, T['ink2']), state('已连接')])
    t = table(cols, rows, '112px 64px minmax(0, 1fr) 150px 52px 64px', dense=True)
    head = between(row(label('店铺') + nowrap('4 个', 12, T['ink3']), 8), btn('新增店铺', 'secondary', 'sm', 'plus'))
    rule = card(row(icon('info', 16, T['info']) + text('进线识别：亚马逊按买家消息的收件邮箱（每店一个）与发件域名（amazon.com / .ca / .com.mx）识别店铺和站点；Shopify 按客服邮箱。识别不出的来信进入「未归属店铺」队列，由客服主管指定店铺，不生成草稿。', 12, T['ink2']), 8, 'flex-start') +
                row(icon('shield', 16, T['ink3']) + text('配置按「全局 → 平台 → 店铺」取值。店铺可覆盖签名、政策口径、模板、素材与链接白名单、SLA 内部目标；意图、风险信号、动作分级只能全局配置。', 12, T['ink2']), 8, 'flex-start'),
                pad='11px 13px', gap=8)
    return col(head + t + rule, 10)


def p18_mapping():
    A, W, N, M = 'accent', 'warning', 'neutral', 'muted'
    acts = [('查订单', '只读', ('积加', A), ('积加', A)), ('查物流', '只读', ('积加', A), ('积加', A)),
            ('查库存', '只读', ('积加（良仓）', A), ('积加（良仓）', A)), ('回复客户', '按发送方式', ('Gmail 中转', A), ('Gmail', A)),
            ('创建售后出库单', '高风险', ('积加（良仓）', A), ('积加（良仓）', A)), ('订单备注', '低风险', ('系统内备注', N), ('Admin API', A)),
            ('退款', '高风险', ('SP-API', A), ('Admin API', A)), ('改地址', '高风险', ('平台不支持', M), ('Admin API', A)),
            ('取消', '高风险', ('SP-API', A), ('Admin API', A))]
    rows = [[nowrap(n, 12.5, T['ink'], 600), nowrap(lv, 11.5, T['ink3']), chip(a[0], a[1], 10.5), chip(b[0], b[1], 10.5)] for n, lv, a, b in acts]
    t = table([('统一动作', 'left'), ('分级', 'left'), ('亚马逊店铺', 'left'), ('Shopify 店铺', 'left')], rows, '96px 58px minmax(0, 1fr) minmax(0, 1fr)', dense=True)
    head = between(row(label('动作映射') + nowrap('9 个统一动作', 12, T['ink3']), 8), nowrap('良仓经积加对接', 11.5, T['ink4']))
    return col(head + t, 10)


def p18():
    inner = p18_channels() + '<div style="display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 16px; align-items: start;">%s%s</div>' % (p18_stores(), p18_mapping())
    return settings_page('liuyang', '渠道与店铺', '渠道与店铺', '订单、物流、库存与良仓出库单经积加；退款、改地址、取消走平台官方接口；客户来信统一经 Gmail 收发。店铺决定订单匹配、回复身份、签名与数据权限。', save_bar(),
                         label('渠道连接') + inner)


# ================================================================ P19 处理规则
INTENTS = [
    # 意图, 发送方式, 阈值, 采纳率, 样本, 放开条件(ok, 文字), 开关: on / off / disabled
    ('订单查询', '自动发送', '85%', '96%', '212', (True, '已放开 · 09-01'), 'on'),
    ('发票与收据', '自动发送', '90%', '98%', '64', (True, '已放开 · 09-01'), 'on'),
    ('产品咨询', '待审草稿', '80%', '91%', '57', (True, '满足，可放开'), 'off'),
    ('购买咨询', '待审草稿', '80%', '84%', '38', (False, '样本 38 < 50'), 'disabled'),
    ('未收到与异常', '待审草稿', '80%', '78%', '61', (False, '采纳率 78%，需高于 90%'), 'disabled'),
    ('修改订单', '待审草稿', '—', '88%', '22', (False, '含高风险动作'), 'disabled'),
    ('到货问题', '待审草稿', '—', '83%', '31', (False, '含高风险动作'), 'disabled'),
    ('产品故障与使用问题', '待审草稿', '80%', '72%', '96', (False, '采纳率 72%，需高于 90%'), 'disabled'),
    ('退货与退款', '待审草稿', '80%', '81%', '45', (False, '采纳率 81%、样本 45 不足'), 'disabled'),
    ('保修与配件购买', '待审草稿', '80%', '86%', '18', (False, '样本 18 < 50'), 'disabled'),
    ('批发与合作', '转人工', '—', '—', '—', (False, '规则为转人工'), 'disabled'),
    ('评价与反馈', '转人工', '—', '—', '—', (False, '规则为转人工'), 'disabled'),
]


def cond(ok, t):
    if ok:
        return row(icon('check_c', 14, T['ok'], 2) + ellipsis(t, 12, T['ok'], 600), 5)
    return row(icon('alert', 14, T['warn'], 2) + ellipsis(t, 12, T['ink2']), 5)


def intent_row(it, k9=False):
    n, mode, th, ad, sm, (ok, why), sw = it
    tg = toggle(True) if sw == 'on' else (toggle(False) if sw == 'off' else toggle_off_disabled())
    th_html = row(nowrap(th, 12.5, T['ink'], 600) + icon('edit', 13, T['ink4']), 6) if th != '—' else na()
    return [nowrap(n, 12.5, T['ink'], 600), cat(mode), th_html, nowrap(ad, 12.5, T['ink'] if ad != '—' else T['ink4']), nowrap(sm, 12.5, T['ink2']), cond(ok, why), tg]


def p19_send_table(k9_hint=False):
    cols = [('意图', 'left'), ('发送方式', 'left'), ('置信度阈值', 'left'), ('30 天采纳率', 'right'), ('样本数', 'right'), ('放开条件', 'left'), ('自动发送', 'left')]
    rows = [intent_row(it) for it in INTENTS]
    t = table(cols, rows, '120px 76px 64px 72px 44px minmax(0, 1fr) 52px', dense=True)
    head = between(row(label('发送方式与阈值') + nowrap('12 个意图', 12, T['ink3']), 8), nowrap('阈值修改需二次确认', 12, T['ink3']))
    rule = muted('放开自动发送：连续 30 天采纳率高于 90% 且样本不少于 50 封。熔断：24 小时内被拒绝或修改超过 30%，自动降回待审草稿并通知客服主管。', 12)
    return col(head + t + rule, 10)


def p19_content_cap():
    cols = [('渠道', 'left'), ('图片', 'left'), ('链接', 'left'), ('草稿与插入', 'left')]
    rows = [[channel('邮件', None, 'Shopify 店铺邮箱、直邮'), nowrap('只能来自素材库', 12.5, T['ink2']), nowrap('只能是白名单域名', 12.5, T['ink2']), ellipsis('插入按钮可用；非白名单链接报错', 12.5, T['ink2'])],
            [channel('亚马逊', None, '站内信'), nowrap('不支持', 12.5, T['ink3']), nowrap('不支持', 12.5, T['ink3']), ellipsis('按纯文字生成，插入按钮置灰并说明原因', 12.5, T['ink2'])]]
    t = table(cols, rows, '210px 110px 120px minmax(0, 1fr)', dense=True)
    wl = row(nowrap('链接白名单 5', 12, T['ink2'], 700) + ''.join(chip(d, 'outline', 11) for d in ['forcome.com', 'forcome.mx', 'youtube.com', 'ups.com', 'yuntrack.com']) +
             link('添加域名', 12, 'plus'), 6)
    return col(between(label('渠道内容能力'), wl) + t, 10)


def p19_risk():
    rs = [('安全事故', '起火、冒烟、过热、烫伤、电池鼓包', '紧急', 'lock'), ('平台风险', 'A-to-Z、拒付、差评威胁、投诉到平台、律师', '紧急', 'lock'),
          ('重复联系', '重复联系 2 次（1 次只升优先级）', '高', 'on'), ('高价值', '订单或累计消费超过 $300', '高', 'on'),
          ('要求真人', '客户明确要求与人沟通', '高', 'on'), ('无法处理的内容', '不支持的语言、乱码、只有附件', '普通', 'on')]
    out = ''
    for i, (n, d, p, sw) in enumerate(rs):
        tg = toggle_on_locked() if sw == 'lock' else toggle(True)
        out += '<div style="display: flex; align-items: center; gap: 10px; padding: 6px 0px;%s"><div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 1px;"><div style="display: flex; align-items: center; gap: 6px;"><div style="font-size: 13px; font-weight: 600; color: %s;">%s</div>%s</div><div style="font-size: 12px; color: %s;">%s</div></div>%s</div>' % (
            ' border-top: 1px solid %s;' % T['line2'] if i else '', T['ink'], n, priority(p), T['ink3'], d, tg)
    return card(out, '风险信号 · 6', nowrap('命中即转人工', 12, T['ink3']), pad='12px 14px', gap=2)


def p19_as_rules():
    sub = lambda t: '<div style="font-size: 11px; font-weight: 700; letter-spacing: 0.06em; color: %s; margin-top: 4px;">%s</div>' % (T['ink3'], t)
    # 四类责任 × 三组费用（prd_b 7.9 表，取 data.RATIO_RULE）
    tpl = 'minmax(0, 1fr) 58px 58px 58px'
    cell = lambda t, c=T['ink'], w=600, a='center': '<div style="font-size: 12px; font-weight: %d; color: %s; text-align: %s; white-space: nowrap; font-variant-numeric: tabular-nums;">%s</div>' % (w, c, a, t)
    head = '<div style="display: grid; grid-template-columns: %s; gap: 6px; padding-bottom: 4px; border-bottom: 1px solid %s;">%s%s</div>' % (
        tpl, T['line'], cell('责任类型', T['ink3'], 700, 'left'), ''.join(cell(lab, T['ink3'], 700) for lab, _ in RATIO_LABELS))
    notes = {'客户使用问题': '含顾客购买、使用不当 · 不协商', '产品质量问题': '抱怨索赔 · 需协商',
             '物流问题': '不协商 · 向承运商或良仓索赔', '其他': '需填写理由 · 默认值 · 需协商'}
    resp = head
    for r in ('客户使用问题', '产品质量问题', '物流问题', '其他'):
        left = col(nowrap(r, 12.5, T['ink'], 600) + nowrap(notes[r], 11, T['ink3']), 1, 'line-height: 1.35;')
        resp += '<div style="display: grid; grid-template-columns: %s; gap: 6px; align-items: center; padding: 3px 0px; border-bottom: 1px solid %s;"><div style="min-width: 0px;">%s</div>%s</div>' % (
            tpl, T['line2'], left, ''.join(cell('%d / %d' % RATIO_RULE[r][k]) for _, k in RATIO_LABELS))
    rules = grid(kv('报备类型', '快递费用 · 额外赔偿') + kv('审批人', '客服主管') + kv('时限', '4 小时，剩 1 小时提醒') + kv('金额门槛', '无') +
                 '<div style="grid-column: span 2;">%s</div>' % kv('超额补充报备', '实际金额超出报备 10% 以上'), 2, 6, extra='column-gap: 16px;')
    return card(sub('责任类型与建议比例 FSH / 工厂 · 按三组费用') + col(resp, 0) + divider() + sub('报备规则') + rules,
                '售后规则', link('编辑', 12, 'edit'), pad='12px 14px', gap=8)


def p19():
    left = p19_send_table() + p19_content_cap()
    right = p19_risk() + p19_as_rules()
    inner = '<div style="display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 16px; align-items: start;">%s%s</div>' % (col(left, 16), col(right, 12))
    return settings_page('zhoumin', '处理规则', '处理规则', '发送方式与阈值、风险信号、售后规则、渠道内容能力。修改阈值需二次确认，并记入审计日志。', save_bar(), inner)


# ================================================================ P20 团队与权限
MEMBERS = [(k, STAFF[k]['email'], STAFF[k]['last_login']) for k in ('liting', 'chenchen', 'zhoumin', 'wanglei', 'zhaoqian', 'liuyang')]


def member_table(sel=None):
    cols = [('成员', 'left'), ('钉钉部门', 'left'), ('角色', 'left'), ('数据范围', 'left'), ('语言', 'left'), ('状态', 'left'), ('最近登录', 'left'), ('', 'right')]
    rows = []
    for k, mail, last in MEMBERS:
        s = STAFF[k]
        who_ = row(avatar(s['avatar'], AV_TONE.get(s['role'], 'green'), 28) + col(nowrap(s['name'] + ('（我）' if k == 'liuyang' else ''), 12.5, T['ink'], 700) + nowrap(mail, 11, T['ink3']), 0), 8)
        rows.append([who_, nowrap(s['dept'], 12, T['ink2']), cat(s['role']), nowrap(s['stores'], 12, T['ink2']), nowrap(s.get('lang', '—'), 12, T['ink2'] if s.get('lang') else T['ink4']),
                     state('已启用'), nowrap(last, 12, T['ink2']), icon_btn('more', size=24)])
    return table(cols, rows, 'minmax(0, 1fr) 84px 96px 60px 44px 60px 70px 24px', dense=True, sel=sel)


def factory_accounts():
    def person(av, name, sub_, right):
        return between(row(avatar(av, 'amber', 26) + col(nowrap(name, 12.5, T['ink'], 650) + nowrap(sub_, 11, T['ink3']), 0), 8), right)
    out = ''
    for code in ('FQD', 'FZJ'):
        f = FACTORIES[code]
        c = [k for k, v in STAFF.items() if v.get('factory') == code and v['role'] == '生产厂对接人'][0]
        h = [k for k, v in STAFF.items() if v.get('factory') == code and v['role'] == '生产厂负责人'][0]
        head = between(row(icon('factory', 15, T['ink3']) + nowrap('生产厂 ' + code, 13, T['ink'], 650), 6), link('负责的 SKU', 12, 'chev_r'))
        out += col(head + muted(f['scope'], 11.5) +
                   person(STAFF[c]['avatar'], STAFF[c]['name'], '对接人 · 最近登录 %s' % ('09:40' if code == 'FQD' else '09-10 16:05'), row(state('已启用') + icon_btn('more', size=24), 6)) +
                   person(STAFF[h]['avatar'], STAFF[h]['name'], '负责人 · 钉钉成员，不分配系统角色', chip('比例升级商定人', 'neutral', 10.5)), 7)
        if code == 'FQD':
            out += divider()
    note = muted('成员来自钉钉；只看本厂任务，寄件完成 30 天后隐藏收件信息。', 11)
    return card(out + note, pad='11px 13px', gap=9)


ROLES = ['坐席', '客服主管', '售后负责人', '知识库负责人', '管理员', '生产厂对接人']
ROLE_HEAD = ['坐席', '客服<br>主管', '售后<br>负责人', '知识库<br>负责人', '管理员', '生产厂<br>对接人']
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
    ('维护知识条目、素材库、审核沉淀', ['提交<br>候选', '审核政策<br>规则', '维护<br>排查树', '●', '', '']),
    ('查看报表', ['', '●', '●', '●', '●', '']),
    ('处理规则、发送方式、风险信号、售后规则、标签库、模板、SLA', ['', '●', '', '', '', '']),
    ('渠道、店铺、动作映射、成员、角色、备用审批人、生产厂账号', ['', '', '', '', '●', '']),
    ('工厂工作台：本厂任务的报价、回填、答复、结算确认、留言', ['', '', '', '', '', '●']),
]


def mark(v):
    if v == '●':
        return '<div style="width: 9px; height: 9px; border-radius: 999px; background: %s; margin: 0px auto;"></div>' % T['accent']
    if v == '○':
        return '<div style="width: 9px; height: 9px; box-sizing: border-box; border-radius: 999px; border: 1.5px solid %s; margin: 0px auto;"></div>' % T['accent']
    if v:
        return '<div style="font-size: 11px; color: %s; text-align: center; white-space: nowrap; line-height: 1.3;">%s</div>' % (T['ink3'], v)
    return ''


def matrix_half(items):
    tpl = 'minmax(0, 1fr) repeat(6, 46px)'
    head = '<div style="display: grid; grid-template-columns: %s; gap: 6px; align-items: end; padding: 0px 0px 6px 0px; border-bottom: 1px solid %s; font-size: 11px; font-weight: 700; color: %s; line-height: 1.3;"><div>能力</div>%s</div>' % (
        tpl, T['line'], T['ink3'], ''.join('<div style="text-align: center;">%s</div>' % h for h in ROLE_HEAD))
    body = ''
    for cap, vals in items:
        body += '<div style="display: grid; grid-template-columns: %s; gap: 6px; align-items: center; padding: 3px 0px; border-bottom: 1px solid %s;"><div style="font-size: 12px; color: %s; line-height: 1.35;">%s</div>%s</div>' % (
            tpl, T['line2'], T['ink2'], cap, ''.join('<div>%s</div>' % mark(v) for v in vals))
    return '<div style="display: flex; flex-direction: column; min-width: 0px;">%s%s</div>' % (head, body)


def perm_matrix():
    legend = row(row(mark('●') + nowrap('有权限', 11, T['ink3']), 4) + row(mark('○') + nowrap('只能看自己发起或负责的', 11, T['ink3']), 4) + nowrap('空白：无权限', 11, T['ink3']) +
                 nowrap('系统发起的审批单由关联售后单的负责人撤回', 11, T['ink3']), 14)
    return card(grid(matrix_half(MATRIX[:10]) + matrix_half(MATRIX[10:]), 2, 28), '角色权限', row(legend + divider(True, 12) + nowrap('只读 · 按角色固定', 12, T['ink3']), 12), pad='12px 16px', gap=10)


def p20_body(sel=None):
    left = col(between(row(label('成员') + nowrap('6 人 · 来自钉钉通讯录，10:00 同步', 12, T['ink3']), 8), btn('从钉钉添加', 'primary', 'sm', 'plus')) + member_table(sel), 10)
    right = col(between(row(label('生产厂账号') + nowrap('2 个生产厂', 12, T['ink3']), 8), btn('从钉钉添加生产厂成员', 'secondary', 'sm', 'plus')) + factory_accounts(), 10)
    top = '<div style="display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 16px; align-items: start;">%s%s</div>' % (left, right)
    return top + perm_matrix()


def p20():
    backup = row(col(nowrap('备用审批人', 12, T['ink2'], 650) + nowrap('唯一有权审批的人是发起人时转给此人（R-AP-02）', 11, T['ink4']), 1) + select_box('王磊 · 售后负责人', width='168px', h=32), 10)
    return settings_page('liuyang', '团队与权限', '团队与权限', '成员与部门来自钉钉通讯录；在这里分配角色、店铺数据范围、生产厂与备用审批人。钉钉离职的成员自动停用。', backup, p20_body())


if __name__ == '__main__':
    save('Settings.dc.html', p18())
    save('SettingsRules.dc.html', p19())
    save('SettingsTeam.dc.html', p20())
    print('ok')
