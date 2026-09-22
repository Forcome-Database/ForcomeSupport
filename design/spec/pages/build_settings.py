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
def ch_card(ic, name, st, lines, foot, tone='accent', card_tone=None):
    head = between(row(tile(ic, tone) + '<div style="font-size: 14px; font-weight: 700; color: %s; white-space: nowrap;">%s</div>' % (T['ink'], name), 10), st)
    body = col(''.join(text(l, 12, T['ink2']) for l in lines), 3)
    return card(head + body + '<div style="margin-top: auto;">%s</div>' % foot, pad='12px 14px', gap=10, tone=card_tone, style='height: 100%; box-sizing: border-box;')


def jijia_card(st='已连接', err=False):
    if err:
        return ch_card('refresh', '积加 ERP · MCP', state('连接异常'),
                       ['09-11 10:05 起连续 3 次调用失败：授权已过期', '亚马逊来信与动作已暂存，恢复后按到达顺序处理'],
                       row(btn('重新授权', 'primary', 'sm', 'refresh') + btn('查看错误日志', 'ghost', 'sm'), 6), 'bad', 'danger')
    return ch_card('refresh', '积加 ERP · MCP', state(st), ['最近同步 10:14', '亚马逊 2 个店铺站内信收发', '4 个店铺订单、库存、发货单、费用'],
                   row(btn('测试连接', 'secondary', 'sm') + icon_btn('more', size=28), 6), 'ok')


def gmail_card(err=False):
    if err:
        return ch_card('message', 'Gmail', state('连接异常'),
                       ['support@forcome.eu 授权已失效（10:05 起连续 3 次失败）', '该邮箱来信暂存，回复进入待发队列'],
                       row(btn('重新授权', 'primary', 'sm', 'refresh') + btn('查看错误日志', 'ghost', 'sm'), 6), 'bad', 'danger')
    return ch_card('message', 'Gmail', state('已连接'), ['2 个邮箱：support@forcome.com', 'support@forcome.eu', '最近推送 10:18'],
                   row(btn('测试连接', 'secondary', 'sm') + btn('添加邮箱', 'ghost', 'sm', 'plus'), 6), 'ok')


def p18_channels():
    im = ch_card('bell', '企业即时通讯', state('未连接'), ['工具待确认（钉钉或企业微信）', '推送审批待办、超时、生产厂任务与催办'],
                 row(btn('连接', 'secondary', 'sm', disabled=True) + nowrap('确定工具后可连接', 11, T['ink4']), 6), 'muted')
    mcp = lambda n: dashed_card(between(row(icon('link', 15, T['ink3']) + nowrap(n, 13, T['ink2'], 700), 6), chip('第三阶段', 'neutral', 10)) +
                                muted('退款、改地址、取消接入统一动作接口，替换人工操作清单', 12), '10px 12px', 4)
    return '<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) 264px; gap: 12px; align-items: stretch;">%s%s%s<div style="display: flex; flex-direction: column; gap: 8px;">%s%s</div></div>' % (
        jijia_card(), gmail_card(), im, mcp('亚马逊 MCP'), mcp('Shopify MCP'))


def p18_stores():
    cols = [('店铺', 'left'), ('站点', 'left'), ('进线', 'left'), ('积加店铺 ID', 'left'), ('签名', 'left'), ('覆盖项', 'left'), ('状态', 'left')]
    over = {'amz-direct': '模板 1', 'amz-auto': '签名', 'shop-com': '政策 1', 'shop-eu': '签名'}
    rows = []
    for s in STORES:
        entry = s['entry']
        if entry.startswith('Gmail'):
            e = col(nowrap('Gmail', 12, T['ink2'], 600) + nowrap(entry.split(' · ')[1], 11, T['ink3']), 0)
        else:
            e = col(nowrap('积加', 12, T['ink2'], 600) + nowrap('亚马逊站内信', 11, T['ink3']), 0)
        rows.append([col(nowrap(s['name'], 12.5, T['ink'], 700) + '<div style="display: flex;">%s</div>' % channel(s['platform'], None, None, 10), 3),
                     nowrap(' · '.join(s['sites']), 12, T['ink2']), e,
                     nowrap(s['jijia_id'], 12, T['ink2']), ellipsis(s['signature'], 12, T['ink2']), nowrap(over[s['id']], 12, T['ink2']), state('已连接')])
    t = table(cols, rows, '112px 72px minmax(0, 1fr) 80px 108px 48px 64px', dense=True)
    head = between(row(label('店铺') + nowrap('4 个', 12, T['ink3']), 8), btn('新增店铺', 'secondary', 'sm', 'plus'))
    rule = card(row(icon('info', 16, T['info']) + text('进线识别：亚马逊按积加店铺 ID + 站点，邮件按收件地址。识别不出的来信进入「未归属店铺」队列，由客服主管指定店铺，不生成草稿。', 12, T['ink2']), 8, 'flex-start') +
                row(icon('shield', 16, T['ink3']) + text('配置按「全局 → 平台 → 店铺」取值。店铺可覆盖签名、政策口径、模板、素材与链接白名单、SLA 内部目标；意图、风险信号、动作分级只能全局配置。', 12, T['ink2']), 8, 'flex-start'),
                pad='12px 14px', gap=8)
    return col(head + t + rule, 10)


def p18_mapping():
    acts = [('查订单', '只读', '积加 MCP', None), ('查物流', '只读', '积加 MCP', None), ('查库存', '只读', '积加 MCP', None),
            ('发站内信', '按发送方式', '积加 MCP', None), ('创建发货单', '高风险', '积加 MCP', None), ('订单备注', '低风险', '积加 MCP', None),
            ('退款', '高风险', '人工操作清单', '亚马逊、Shopify 平台退款'), ('改地址', '高风险', '人工操作清单', 'Shopify 订单'), ('取消', '高风险', '人工操作清单', '仅未发货订单')]
    rows = []
    for n, lv, ad, note in acts:
        a = chip(ad, 'accent' if ad == '积加 MCP' else 'warning', 11)
        rows.append([nowrap(n, 12.5, T['ink'], 600), cat(lv), col('<div style="display: flex;">%s</div>' % a + (nowrap(note, 11, T['ink3']) if note else ''), 2)])
    t = table([('统一动作', 'left'), ('分级', 'left'), ('当前适配器', 'left')], rows, '72px 84px minmax(0, 1fr)', dense=True)
    head = between(row(label('动作映射') + nowrap('9 个统一动作', 12, T['ink3']), 8), nowrap('积加 MCP 6 · 人工操作清单 3', 12, T['ink3']))
    return col(head + t, 10)


def p18():
    inner = p18_channels() + '<div style="display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 16px; align-items: start;">%s%s</div>' % (p18_stores(), p18_mapping())
    return settings_page('liuyang', '渠道与店铺', '渠道与店铺', '积加与 Gmail 两条进线；店铺决定订单匹配、回复身份、签名与数据权限。', save_bar(),
                         label('渠道连接') + inner)


# ================================================================ P19 处理规则
INTENTS = [
    # 意图, 发送方式, 阈值, 采纳率, 样本, 放开条件(ok, 文字), 开关: on / off / disabled
    ('订单查询', '自动发送', '85%', '96%', '212', (True, '已放开 · 09-01'), 'on'),
    ('发票与收据', '自动发送', '90%', '98%', '64', (True, '已放开 · 09-01'), 'on'),
    ('产品咨询', '待审草稿', '80%', '91%', '57', (True, '满足，可放开'), 'off'),
    ('购买咨询', '待审草稿', '80%', '84%', '38', (False, '样本 38 < 50'), 'disabled'),
    ('未收到与异常', '待审草稿', '80%', '78%', '61', (False, '采纳率 78%，需高于 90%'), 'disabled'),
    ('修改订单', '提交审批', '—', '88%', '22', (False, '含高风险动作'), 'disabled'),
    ('到货问题', '提交审批', '—', '83%', '31', (False, '含高风险动作'), 'disabled'),
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
    wl = row(nowrap('链接白名单 5', 12, T['ink2'], 700) + ''.join(chip(d, 'outline', 11) for d in ['forcome.com', 'forcome.eu', 'youtube.com', 'ups.com', 'yuntrack.com']) +
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
    resp = ''.join(between(cat(r), row(nowrap(v, 12.5, T['ink'], 600) + nowrap(n, 12, T['ink3']), 6)) for r, v, n in [
        ('客户使用问题', '100 / 0', '不协商'), ('产品质量问题', '0 / 100', '需协商'),
        ('物流问题', '100 / 0', '不协商 · FSH 向承运商或良仓索赔'), ('其他', '默认 50 / 50', '人工填写 · 需协商')])
    rules = (kv('报备类型', '快递费用 · 额外赔偿') + kv('审批人', '客服主管') + kv('时限', '4 小时，剩 1 小时提醒') + kv('金额门槛', '无') +
             kv('超额补充报备', '实际金额超出报备 10% 以上'))
    return card(sub('责任类型与建议比例 FSH / 工厂') + resp + divider() + sub('报备规则') + rules,
                '售后规则', link('编辑', 12, 'edit'), pad='12px 14px', gap=8)


def p19():
    left = p19_send_table() + p19_content_cap()
    right = p19_risk() + p19_as_rules()
    inner = '<div style="display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 16px; align-items: start;">%s%s</div>' % (col(left, 16), col(right, 12))
    return settings_page('zhoumin', '处理规则', '处理规则', '发送方式与阈值、风险信号、售后规则、渠道内容能力。修改阈值需二次确认，并记入审计日志。', save_bar(), inner)


# ================================================================ P20 团队与权限
MEMBERS = [('liting', 'liting@forcome.com', '10:02'), ('chenchen', 'chenchen@forcome.com', '09:15'), ('zhoumin', 'zhoumin@forcome.com', '10:18'),
           ('wanglei', 'wanglei@forcome.com', '10:20'), ('zhaoqian', 'zhaoqian@forcome.com', '09-10 18:30'), ('liuyang', 'liuyang@forcome.com', '10:20')]


def member_table(sel=None):
    cols = [('成员', 'left'), ('角色', 'left'), ('数据范围', 'left'), ('语言', 'left'), ('状态', 'left'), ('最近登录', 'left'), ('', 'right')]
    rows = []
    for k, mail, last in MEMBERS:
        s = STAFF[k]
        who_ = row(avatar(s['avatar'], AV_TONE.get(s['role'], 'green'), 28) + col(nowrap(s['name'] + ('（我）' if k == 'liuyang' else ''), 12.5, T['ink'], 700) + nowrap(mail, 11, T['ink3']), 0), 8)
        rows.append([who_, cat(s['role']), nowrap(s['stores'], 12, T['ink2']), nowrap(s.get('lang', '—'), 12, T['ink2'] if s.get('lang') else T['ink4']),
                     state('已启用'), nowrap(last, 12, T['ink2']), icon_btn('more', size=24)])
    return table(cols, rows, 'minmax(0, 1fr) 96px 64px 56px 64px 72px 24px', dense=True, sel=sel)


def factory_accounts():
    r1 = between(row(avatar('陈', 'amber', 28) + col(nowrap('陈工', 12.5, T['ink'], 700) + nowrap('生产厂对接人 · 最近登录 09:40', 11, T['ink3']), 0), 8),
                 row(state('已启用') + icon_btn('more', size=24), 8))
    r2 = between(row(avatar('刘', 'amber', 28) + col(nowrap('刘厂长', 12.5, T['ink'], 700) + nowrap('生产厂负责人 · 不登录系统', 11, T['ink3']), 0), 8),
                 row(chip('比例升级商定人', 'neutral', 11) + icon_btn('more', size=24), 8))
    head = row(icon('factory', 16, T['ink3']) + nowrap('东莞生产厂', 13, T['ink'], 700), 8)
    note = muted('生产厂账号只看本厂任务；询价看不到客户姓名与地址，寄件任务可见收件信息，寄件完成 30 天后隐藏。', 12)
    return card(head + note + divider() + r1 + divider() + r2, pad='12px 14px', gap=10)


ROLES = ['坐席', '客服主管', '售后负责人', '知识库负责人', '管理员', '生产厂对接人']
ROLE_HEAD = ['坐席', '客服<br>主管', '售后<br>负责人', '知识库<br>负责人', '管理员', '生产厂<br>对接人']
MATRIX = [
    ('查看工单、回复、标签、合并、转人工', ['●', '●', '●', '只读', '', '']),
    ('合并与拆分客户身份', ['●', '●', '●', '', '', '']),
    ('改派他人工单、强制接手', ['', '●', '', '', '', '']),
    ('提交审批单；同时创建售后单（路径 B）', ['●', '●', '●', '', '', '']),
    ('审批含报备的审批单', ['', '●', '', '', '', '']),
    ('审批只含动作的审批单', ['', '●', '●', '', '', '']),
    ('撤回审批单', ['○', '○', '○', '', '', '']),
    ('执行人工操作清单', ['○', '○', '○', '', '', '']),
    ('查看售后单、登记台账', ['只读', '●', '●', '', '', '']),
    ('同步台账到积加、补登', ['', '', '●', '', '', '']),
    ('确认责任与处理方式、终止售后单', ['', '●', '●', '', '', '']),
    ('比例协商与重开、退回报价、结算批次', ['', '', '●', '', '', '']),
    ('维护知识条目、素材库、审核沉淀', ['部分', '部分', '部分', '●', '', '']),
    ('查看报表', ['', '●', '●', '●', '●', '']),
    ('规则、风险信号、标签库、模板、SLA', ['', '●', '', '', '', '']),
    ('渠道、店铺、成员、备用审批人、工厂账号', ['', '', '', '', '●', '']),
    ('工厂工作台（本厂任务）', ['', '', '', '', '', '●']),
]


def mark(v):
    if v == '●':
        return '<div style="width: 9px; height: 9px; border-radius: 999px; background: %s; margin: 0px auto;"></div>' % T['accent']
    if v == '○':
        return '<div style="width: 9px; height: 9px; box-sizing: border-box; border-radius: 999px; border: 1.5px solid %s; margin: 0px auto;"></div>' % T['accent']
    if v:
        return '<div style="font-size: 11px; color: %s; text-align: center; white-space: nowrap;">%s</div>' % (T['ink3'], v)
    return ''


def matrix_half(items):
    tpl = 'minmax(0, 1fr) repeat(6, 46px)'
    head = '<div style="display: grid; grid-template-columns: %s; gap: 6px; align-items: end; padding: 0px 0px 6px 0px; border-bottom: 1px solid %s; font-size: 11px; font-weight: 700; color: %s; line-height: 1.3;"><div>能力</div>%s</div>' % (
        tpl, T['line'], T['ink3'], ''.join('<div style="text-align: center;">%s</div>' % h for h in ROLE_HEAD))
    body = ''
    for cap, vals in items:
        body += '<div style="display: grid; grid-template-columns: %s; gap: 6px; align-items: center; padding: 5px 0px; border-bottom: 1px solid %s;"><div style="font-size: 12px; color: %s; line-height: 1.35;">%s</div>%s</div>' % (
            tpl, T['line2'], T['ink2'], cap, ''.join('<div>%s</div>' % mark(v) for v in vals))
    return '<div style="display: flex; flex-direction: column; min-width: 0px;">%s%s</div>' % (head, body)


def perm_matrix():
    legend = row(row(mark('●') + nowrap('有权限', 11, T['ink3']), 4) + row(mark('○') + nowrap('只限自己发起或负责的', 11, T['ink3']), 4) + nowrap('空白：无权限', 11, T['ink3']) +
                 nowrap('知识库「部分」：坐席提交沉淀候选；客服主管审核政策规则；售后负责人维护排查树', 11, T['ink3']), 14)
    return card(grid(matrix_half(MATRIX[:9]) + matrix_half(MATRIX[9:]), 2, 28) + legend, '角色权限', nowrap('只读 · 按角色固定', 12, T['ink3']), pad='12px 16px', gap=10)


def p20_body(sel=None):
    left = col(between(row(label('成员') + nowrap('6 人', 12, T['ink3']), 8), btn('邀请成员', 'primary', 'sm', 'plus')) + member_table(sel), 10)
    backup = card(between(nowrap('备用审批人', 12.5, T['ink'], 700), select_box('王磊 · 售后负责人', width='168px', h=28)) +
                  muted('发起人恰好是唯一有权审批的人时，审批单转给此人（R-AP-02，人选待确认 Q-19）。', 11), pad='10px 14px', gap=6)
    right = col(between(row(label('生产厂账号') + nowrap('1 个生产厂', 12, T['ink3']), 8), btn('新增生产厂账号', 'secondary', 'sm', 'plus')) + factory_accounts() + backup, 10)
    top = '<div style="display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 16px; align-items: start;">%s%s</div>' % (left, right)
    return top + perm_matrix()


def p20():
    return settings_page('liuyang', '团队与权限', '团队与权限', '成员、角色、店铺数据范围与生产厂账号。停用成员前需先改派其未处理的工单。', '', p20_body())


if __name__ == '__main__':
    save('Settings.dc.html', p18())
    save('SettingsRules.dc.html', p19())
    save('SettingsTeam.dc.html', p20())
    print('ok')
