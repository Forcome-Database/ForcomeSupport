# -*- coding: utf-8 -*-
"""StatesAdmin · 知识库、报表、设置状态板 K1–K24（K19、K20 为第一阶段报表与渠道卡；K18 复用 build_audit，K19 复用 build_approval_kb_reports 的图表部件）。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from ui import save_bar
from data import *
from as_common import *
import build_settings as BS

W = 864
WW = W * 2 + 32  # 跨两栏的宽画面


# ---------------------------------------------------------------- K1 文档解析
def up_item(name, meta, status_html, extra='', ic='file', ic_color=None):
    return '<div style="display: flex; align-items: flex-start; gap: 12px; padding: 12px 0px; border-top: 1px solid %s;">%s<div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 6px;">%s%s</div></div>' % (
        T['line2'], tile_icon(ic, ic_color), between(row(nowrap(name, 13, T['ink'], 600) + nowrap(meta, 12, T['ink4']), 8), status_html), extra)


def tile_icon(ic, color=None):
    return '<div style="width: 32px; height: 32px; border-radius: 8px; background: %s; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%s</div>' % (T['line2'], icon(ic, 17, color or T['ink3']))


def k1():
    drop = '<div style="border: 1px dashed %s; border-radius: 8px; background: %s; padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">%s%s</div>' % (
        T['line_strong'], T['subtle'], row(icon('upload', 18, T['ink3']) + col(nowrap('拖入文件或点击上传', 13, T['ink'], 600) + nowrap('支持 PDF、Word、Excel，单个不超过 20 MB；解析后生成待审核条目', 12, T['ink3']), 2), 10),
        btn('选择文件', 'secondary', 'sm', 'plus'))
    st = lambda ic, t, c: row(icon(ic, 14, c, 2) + nowrap(t, 12, c, 600), 5)
    items = (
        up_item('V2 用户手册（西班牙语）.pdf', '4.2 MB', row(nowrap('上传中 62%', 12, T['accent_ink'], 600) + icon('x', 14, T['ink4']), 8), progress(62)) +
        up_item('保修条款 2026.docx', '380 KB', row(spinner(14) + nowrap('解析中', 12, T['ink2'], 600), 6), muted('正在识别段落与表格，约 1 分钟。', 12)) +
        up_item('V2 故障图集.pdf', '12.6 MB', st('x_c', '解析失败', T['bad']),
                between(text('文件已加密，无法读取文字。请去除密码后重新上传。', 12, T['bad']), row(btn('重试', 'secondary', 'sm', 'refresh') + btn('删除', 'ghost', 'sm'), 6)), ic_color=T['bad']) +
        up_item('Q3 促销运费政策.pdf', '860 KB', st('check_c', '已解析', T['ok']),
                between(muted('生成 3 条待审核条目 · 政策规则 · 适用全部店铺', 12), link('去审核', 12, 'chev_r')), ic_color=T['ok']))
    return frame(card(drop + '<div style="display: flex; flex-direction: column;">%s</div>' % items, '上传文档', nowrap('知识库 · 赵倩', 12, T['ink3']), pad='14px 16px', gap=12))


# ---------------------------------------------------------------- K2 待审核沉淀为空
def k2():
    head = '<div style="background: #ffffff; border: 1px solid %s; border-radius: 8px; padding: 0px 16px; box-shadow: %s;">%s</div>' % (
        T['line'], SHADOW_XS, tabs([('条目', None), ('素材库', None), ('待审核沉淀', 0), ('知识缺口', KB_COUNTS['知识缺口'])], '待审核沉淀'))
    box = card(empty('check_c', '没有待审核的沉淀', '坐席把已解决工单标记为 FAQ 候选后，会出现在这里等你审核。', row(btn('查看知识缺口 %d' % KB_COUNTS['知识缺口'], 'secondary') + btn('查看已入库沉淀', 'ghost'), 8)), pad='8px 24px')
    return frame(head + box)


# ---------------------------------------------------------------- K3 报表加载中 / K4 报表无数据
def report_page(kpis, main, filters):
    body = page_head('报表', '工单、SLA、AI 与售后成本 · 数据来源：工单系统、登记台账、平台订单', btn('导出', 'secondary', 'md', 'download')) + \
        content(filters + kpis + main, '16px 24px', 14)
    return app('zhoumin', '报表', ['报表', '概览'], body)


def rep_filters(active=False):
    if active:
        return row(seg(['近 7 天', '本月', '自定义'], '近 7 天') + filter_chip('店铺', 'forcome.mx', True) + filter_chip('站点', '全部') + filter_chip('标签', '批发', True) +
                   link('清除筛选', 12), 8)
    return row(seg(['近 7 天', '本月', '自定义'], '近 7 天') + filter_chip('店铺', '全部') + filter_chip('站点', '全部') + filter_chip('标签') + row(spinner(14) + nowrap('正在加载 · 更新于 %s' % report_updated(), 12, T['ink3']), 6), 8)


def k3():
    """局部 1:1：筛选栏 + 指标骨架 + 两张图表骨架（整页缩略图看不清，改为局部原尺寸）。"""
    ks = grid(''.join(card(skel('55%', 10) + skel('70%', 22, 6) + skel('40%', 8), pad='12px 14px', gap=9) for _ in range(5)), 5, 10)
    ch_ = lambda: card(between(skel('120px', 12), skel('64px', 10)) + skel('100%', 150, 6), pad='14px 16px', gap=12)
    main = grid(ch_() + ch_(), 2, 12)
    return frame(rep_filters() + ks + main)


def k4():
    """局部 1:1：筛选已生效 + 指标「—」+ 主区空状态。"""
    ks = grid(''.join(kpi(k, '—', sub='所选范围无数据') for k in ['工单量', '首响中位数', 'SLA 达标率', '草稿采纳率', '自动发送占比']), 5, 10)
    main = card(empty('chart', '所选范围没有数据', '近 7 天 forcome.mx 没有带「批发」标签的工单。调整时间、店铺或标签后再看。',
                      row(btn('调整筛选', 'primary', 'md', 'filter') + btn('清除筛选', 'secondary'), 8), compact=True), pad='20px 24px')
    return frame(rep_filters(True) + ks + main)


# ---------------------------------------------------------------- K5 导出
EXPORT_FILE = '报表_近7天_0905-0911.xlsx'


def k5():
    """导出：服务端按当前筛选与字段权限同步生成，完成后浏览器直接下载；不留存文件、没有导出记录页。"""
    period = seg(['近 7 天', '本月', '自定义'], '近 7 天')
    left = col(cap('生成中') + row(period + btn('正在生成，约 3 秒', 'secondary', 'md', loading=True), 8) +
               row(icon('info', 14, T['ink4']) + muted('按当前筛选与你的字段权限生成；生成期间可继续浏览本页。', 12), 6, 'flex-start'), 12)
    done = toast('success', '已导出 ' + EXPORT_FILE, '已记入审计日志')
    right = col(cap('完成 · 浏览器直接下载') + row(period + btn('导出', 'secondary', 'md', 'download'), 8) + done +
                row(icon('info', 14, T['ink4']) + muted('不留存文件，没有导出记录页；需要时按当前筛选重新导出。', 12), 6, 'flex-start'), 12)
    return frame(grid(left + right, 2, 24))


# ---------------------------------------------------------------- K6 设置保存
def k6():
    cols = [('意图', 'left'), ('置信度阈值', 'left'), ('30 天采纳率', 'right'), ('样本数', 'right'), ('放开条件（当前 / 要求）', 'left'), ('自动发送', 'left')]
    r = [BS.intent_row(BS.INTENTS[0], with_mode=False), BS.intent_row(BS.INTENTS[1], with_mode=False)]
    edited = BS.intent_row(BS.INTENTS[2], with_mode=False)
    en, (e_old, e_new) = list(SEND_RULE_EDITS.items())[0]  # 未保存的修改：data.SEND_RULE_EDITS
    edited[1] = row(input_box(e_new, st='focus', width='64px', h=28, mono=True) + chip('已修改', 'warning', 10), 6)
    r.append(edited)
    t = table(cols, r, '124px 128px 72px 44px minmax(0, 1fr) 52px', dense=True, row_tones={2: 'warning'})
    bar = row(label('发送方式与阈值') + nowrap('%s 置信度阈值 %s → %s' % (en, e_old, e_new), 12, T['ink3']), 8)
    sb = save_bar(1, '%s 置信度阈值 %s → %s' % (en, e_old, e_new))
    ok = toast('success', '设置已保存', '%s置信度阈值 %s → %s，已记入审计日志（周敏 10:24）。' % (en, e_old, e_new))
    off = toast('warning', '网络已断开，暂未保存', '修改已保留在页面上。恢复连接后自动重试保存，无需手动操作。', row(spinner(12, T['ink4']) + nowrap('等待网络恢复…', 12, T['ink3']), 6))
    back = toast('neutral', '已自动重试并保存', '10:26 网络恢复后重试成功：%s阈值 %s → %s，已记入审计日志。' % (en, e_old, e_new))
    arrow = row(icon('arrow_r', 14, T['ink4']) + nowrap('网络恢复后自动重试，结果浮层提示', 11, T['ink4']), 6)
    return frame(cap('修改后 · 底部吸底保存栏') + bar + t + sb + grid(col(cap('保存成功') + ok, 8) + col(cap('断网 · 恢复后自动重试') + off + arrow + back, 8), 2, 24))


# ---------------------------------------------------------------- K7 渠道断开
def k7():
    # 横幅同 G4（data.G4_BANNER，待办 09 Q1 · 10-06 用户确认）；本图为管理员视角，有「查看渠道状态」
    top = banner('danger', *G4_BANNER, action=btn('查看渠道状态', 'secondary', 'sm'))
    im = BS.ch_card('users', '钉钉', state('已连接'), ['通讯录同步 · 工作通知 · 登录'], '', 'ok')
    cards = '<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: stretch;">%s%s%s</div>' % (
        BS.amazon_card(), BS.gmail_card(err=True), im)
    return frame(top + cards)


# ---------------------------------------------------------------- K8 新增店铺校验
K8_H = 860


def multi_select(values):
    """多选下拉：已选项为可移除的小标签。"""
    chips = ''.join(row(nowrap(v, 12, T['ink'], 600) + icon('x', 11, T['ink4']), 4, extra='background: %s; border-radius: 6px; padding: 1px 6px;' % T['track']) for v in values)
    return '<div style="height: 32px; box-sizing: border-box; border: 1px solid %s; border-radius: 8px; background: #ffffff; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0px 10px 0px 6px;">%s%s</div>' % (
        T['line_strong'], row(chips, 4), icon('chev_d', 14, T['ink4']))


def err_chip(t):
    """填错的进线邮箱小标签：描边小标签换成红色边线与红字（抽屉里已加入的邮箱被其他店铺占用时）。"""
    return chip(t, 'outline', 11).replace('color: %s; background: #ffffff; border: 1px solid %s;' % TONES['outline'][0::2], 'color: %s; background: #ffffff; border: 1px solid %s;' % (T['bad'], T['bad_solid']))


def err_lines(lines):
    """字段下方的多条错误（进线邮箱每个地址一条）。"""
    return col(''.join('<div style="display: flex; align-items: center; gap: 4px; font-size: 12px; color: %s;">%s%s</div>' % (T['bad'], icon('alert', 13, T['bad'], 2), t) for t in lines), 4)


def k8_more():
    """K8 的补充小样（第一阶段实现时确认，10-05）：进线邮箱的提示、亚马逊店铺的平台标识、进线邮箱重复、必填项、编辑抽屉、保存结果、店铺表为空、新增时的未保存离开。"""
    amz = field('平台标识 · 亚马逊卖家 ID', input_box(None, '例如 A1FD7Q2M9XK3LC', 'error'), True, error='请填写卖家 ID')
    hint = field('进线邮箱（可填多个，含别名）', col(row(chip('support@forcome.mx', 'outline', 11) + chip('ventas@forcome.mx', 'outline', 11), 6) + input_box(), 6), True,
                 hint='每个地址都用来识别店铺；寄到这些地址的未归属来信保存后自动归位')
    mails = ('<div style="display: flex; flex-direction: column; gap: 6px;"><div style="font-size: 12px; font-weight: 600; color: %s;">进线邮箱（可填多个，含别名）<span style="color: %s; margin-left: 2px;">*</span></div>%s%s%s</div>' % (
        T['ink2'], T['bad'], row(err_chip('support@forcome.mx') + chip('ventas@forcome.mx', 'outline', 11), 6), input_box('ventas@forcome.mx', st='error'),
        err_lines(['ventas@forcome.mx 已经填过', 'support@forcome.mx 已是 forcome.mx 的进线邮箱'])))
    empty_selects = grid(field('平台', select_box(st='error'), True, error='请选择平台') +
                         field('默认站点', select_box(st='error'), True, error='请选择默认站点'), 2, 12, extra='align-items: start;')
    required = empty_selects + col(''.join(row(icon('alert', 13, T['bad'], 2) + nowrap(t, 12, T['bad']), 4) for t in
                                           ('请填写店铺名', '请选择站点', '至少填写一个进线邮箱', '请填写平台标识')), 6)
    edit_head = ('<div style="background: #ffffff; border: 1px solid %s; border-radius: 12px; padding: 16px 20px 14px 20px; display: flex; gap: 12px; align-items: flex-start;">'
                 '<div style="flex: 1; display: flex; flex-direction: column; gap: 4px;"><div style="font-size: 16px; font-weight: 600; color: %s;">编辑店铺</div>'
                 '<div style="font-size: 12px; color: %s; line-height: 1.5;">保存记入审计日志；未归属队列中收件地址与新店铺进线邮箱匹配的来信自动归位。</div></div>%s</div>') % (
        T['line'], T['ink'], T['ink3'], icon('x', 16, T['ink4']))
    ok = toast('success', '店铺已保存', 'forcome.mx，已记入审计日志（刘洋 10:24）。')
    fail = toast('error', '保存失败：网络不可用', '填写的内容已保留在抽屉里。', link('立即重试', 12))
    none = card(empty('store', '还没有店铺', '新增店铺并登记进线邮箱后，来信才能识别店铺、匹配订单。', btn('新增店铺', 'secondary', 'md', 'plus')), pad='0px')
    leave = dialog('离开前保存修改？', muted('「新增店铺」填写的内容还没保存，放弃后不保留。', 13),
                   btn('继续编辑', 'secondary', st='focus') + btn('放弃修改', 'danger_outline') + btn('保存并离开', 'primary'), 460, 'warning')
    return frame(cap('进线邮箱 · 没有错误时字段下方写提示') + hint +
                 cap('亚马逊店铺 · 平台标识为空') + amz +
                 cap('进线邮箱重复 · 输入框里的与已填的重复、已加入的被其他店铺占用') + mails +
                 cap('其余必填项为空：下拉没选时写占位「请选择」（未选平台时平台标识写「平台标识」）') + required +
                 cap('编辑店铺 · 抽屉标题') + edit_head +
                 cap('保存结果') + grid(ok + fail, 2, 12, extra='align-items: start;') +
                 cap('店铺表为空（生产环境上线初期）') + none +
                 cap('新增店铺时有未保存的输入就关闭（G8）') + '<div style="display: flex; justify-content: center;">%s</div>' % leave,
                 w=W, gap=10)


def k8():
    """P18「新增店铺」右侧抽屉：保存时校验全部，错误写在字段下方，保存按钮保持可点、点击后定位到第一个错误（店铺名）。
    数据来源新建时默认模拟数据（开发测试环境外部客户端默认 Fake，ADR 0009；10-05 用户确认）。下方为补充小样（k8_more）。"""
    over = row(chip('签名', 'outline', 11) + link('添加覆盖项', 12, 'plus'), 8)
    dev = dashed_card(row(nowrap('数据来源', 12, T['ink2'], 600) + chip('仅开发测试环境', 'info', 11), 8) + row(radio('真实接口') + radio('模拟数据', True), 20) +
                      muted('生产环境不显示此项；接模拟数据时渠道卡头标「模拟数据」。', 12), '10px 12px', 8)
    body = (grid(field('平台', select_box('Shopify'), True) + field('店铺名', input_box('forcome.com', st='error'), True, error='店铺名已存在，请换一个'), 2, 12, extra='align-items: start;') +
            grid(field('站点（多选）', multi_select(['MX']), True) + field('默认站点', select_box('MX'), True, hint='无订单的来信按它归站点'), 2, 12, extra='align-items: start;') +
            field('进线邮箱（可填多个，含别名）', col(row(chip('support@forcome.mx', 'outline', 11) + chip('ventas@forcome.mx', 'outline', 11), 6) + input_box('info@forcome', st='error'), 6), True,
                  error='邮箱格式不正确，例如 info@forcome.mx', hint='每个地址都用来识别店铺；寄到这些地址的未归属来信保存后自动归位') +
            field('平台标识 · Shopify 店铺域名', input_box(None, '例如 forcome-mx.myshopify.com', 'error'), True, error='请填写店铺域名') +
            field('签名', input_box('Forcome México'), hint='回复末尾使用') +
            field('覆盖项', over, hint='可覆盖签名、政策口径、模板、素材与链接白名单、SLA 内部目标') + dev)
    drw = BS.drawer('新增店铺', body, btn('取消', 'secondary') + btn('保存', 'primary'), 440, '保存记入审计日志；未归属队列中收件地址与新店铺进线邮箱匹配的来信自动归位。')
    page_h = int(K8_H / 0.6)
    return col(BS.drawer_over(scaled(BS.p18(page_h), 1440, page_h, 0.6), drw, W, K8_H) + k8_more(), 0)


# ---------------------------------------------------------------- K9 放开自动发送不可用
def gate_progress(t, cur, need):
    """暂不满足（黄）：文字 + 进度条（当前 / 门槛）。"""
    pct = min(100, int(cur * 100.0 / need))
    bar = '<div style="width: 48px; flex-shrink: 0;">%s</div>' % progress(pct, 'warning', 4)
    return row(icon('alert', 14, T['warn'], 2) + nowrap(t, 12, T['warn'], 600) + bar, 6)


def gate_hard(t):
    """硬规则（灰 + 锁）：不可放开。"""
    return row(icon('lock', 14, T['ink4'], 2) + nowrap(t, 12, T['ink3']), 5)


def switch_locked():
    return row(toggle_off_disabled() + icon('lock', 12, T['ink4'], 2), 4)


def k9():
    cols = [('意图', 'left'), ('置信度阈值', 'left'), ('30 天采纳率', 'right'), ('样本数', 'right'), ('放开条件（当前 / 要求）', 'left'), ('自动发送', 'left')]
    base = [BS.intent_row(BS.INTENTS[i], with_mode=False) for i in (2, 3, 5, 4)]
    num = lambda v: int(v.rstrip('%'))
    gp = lambda it: (lambda k, cur, need, _: gate_progress('%s %s / %s' % (k, cur, need), num(cur), num(need)))(*it[5][1][0])  # 放开进度取 data.SEND_RULES
    base[1][4] = gp(BS.INTENTS[3])
    base[2][4] = gate_hard('硬规则：含高风险动作，不可放开')
    base[2][5] = switch_locked()
    base[3][4] = gp(BS.INTENTS[4])
    t = table(cols, base, '124px 64px 72px 44px minmax(0, 1fr) 64px', dense=True, row_tones={3: 'warning'})
    arrow = '<div style="position: absolute; top: -4px; right: 38px; width: 10px; height: 10px; background: %s; transform: rotate(45deg);"></div>' % T['ink']
    _, cur, need, _ = BS.INTENTS[4][5][1][0]
    tip = '<div style="position: absolute; right: 8px; top: 180px;">%s%s</div>' % (arrow, tooltip('暂不能切换为自动发送：近 30 天采纳率 %s，需高于 %s（还差 %d 个百分点）。满足条件后开关自动可用。' % (cur, need, num(need) - num(cur))))
    leg = row(gate_progress('暂不满足 · 进度', 1, 2) + divider(True, 12) + gate_hard('硬规则 · 不可放开') + divider(True, 12) +
              row(icon('check_c', 14, T['ok'], 2) + nowrap('满足，可放开', 12, T['ok'], 600), 5), 12)
    return frame(leg + '<div style="position: relative; padding-bottom: 72px;">%s%s</div>' % (t, tip))


# ---------------------------------------------------------------- K10 停用成员
CLOSED_T = ('已解决', '已关闭', '已合并')
WL_NO_PEER = '请先在成员表为其他成员分配售后负责人角色'


def handover_block(title, items, empty_text, control=None, hint=None, error=None):
    """停用弹窗里的一类待改派对象：标题 + 张数 + 编号列表 + 接手人。items: [(编号, 状态)]；为空时写明无需改派。"""
    head = row(nowrap(title, 13, T['ink'], 700) + chip('%d 张' % len(items), 'neutral' if items else 'muted', 11), 6)
    if not items:
        body = row(icon('check_c', 14, T['ok'], 2) + muted(empty_text, 12), 6)
    else:
        lst = grid(''.join(row(nowrap(no, 12, T['accent'], 600) + state(st), 6) for no, st in items), 2, 8, extra='row-gap: 6px;')
        body = lst + field('接手人', control, True, hint=hint, error=error)
    return '<div style="border: 1px solid %s; border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;">%s%s</div>' % (T['line'], head, body)


def stop_dialog(key, ticket_ctrl=None, case_ctrl=None, case_err=None, blocked=None):
    """K10 停用成员弹窗：列出未关闭工单与进行中售后单，分别选接手人；blocked 为「改派并停用」置灰的原因。"""
    name = STAFF[key]['name']
    tks = [(t['no'], t['status']) for t in TICKETS if t['owner'] == name and t['status'] not in CLOSED_T]
    cases = [(a['no'], a['status']) for a in AFTERSALES if a['owner'] == name and a['status'] == '进行中']
    body = (muted('停用后%s不能登录，现有会话立即失效；历史记录、审批单与操作日志保留。改派与停用记入审计日志。' % name, 12) +
            handover_block('未关闭工单', tks, '没有未关闭的工单', ticket_ctrl, '可选坐席或客服主管；编辑锁一并转给接手人，客户侧不会收到通知') +
            handover_block('进行中售后单', cases, '没有进行中的售后单，无需改派', case_ctrl, '只列有该店铺范围的售后负责人', case_err))
    if blocked:
        foot = '<div style="flex: 1; min-width: 0px; display: flex; align-items: center; gap: 6px;">%s%s</div>' % (icon('lock', 14, T['ink4']), nowrap(blocked, 12, T['ink3'])) + \
            btn('取消', 'secondary') + btn('改派并停用', 'danger', disabled=True, reason=blocked)
    else:
        foot = btn('取消', 'secondary') + btn('改派并停用', 'danger')
    return dialog('停用成员%s？' % name, body, foot, 520, 'warning')


def k10():
    a = overlay(scaled(BS.p20(1000), 1440, 1000, 0.6), stop_dialog('liting', select_box('陈晨（坐席）')), W, 600)
    b = stop_dialog('wanglei', case_ctrl=select_box(None, '没有可选的售后负责人', 'disabled'), case_err='王磊是唯一的售后负责人，没有其他人可接手', blocked=WL_NO_PEER)
    small = '<div style="background: %s; padding: 16px; display: flex; flex-direction: column; gap: 10px; align-items: flex-start;">%s%s</div>' % (
        T['canvas'], cap('另一张小图 · 停用王磊：4 张进行中售后单，没有其他售后负责人可接手'), b)
    return col(a + small, 0)

# ---------------------------------------------------------------- K11 素材库
def kb_tabs(active):
    return tabs([('条目', None), ('素材库', None), ('待审核沉淀', KB_COUNTS['待审核沉淀']), ('知识缺口', KB_COUNTS['知识缺口'])], active)


def asset_thumb(label_, w=120, h=76):
    return '<div style="width: %dpx; height: %dpx; flex-shrink: 0; border-radius: 6px; background: linear-gradient(135deg, %s, %s); border: 1px solid %s; display: flex; align-items: center; justify-content: center; font-size: 11px; color: %s;">%s</div>' % (
        w, h, T['line2'], T['subtle'], T['line'], T['ink3'], label_)


def k11():
    items = KB_ASSETS  # 素材与纯文字步骤：data.KB_ASSETS
    cells = ''
    for name, code, hits, steps in items:
        pic = '<div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 6px;">%s%s%s</div>' % (
            asset_thumb('图示 · ' + code, 152, 80), row(chip('图文版', 'accent', 10) + nowrap('邮件', 11, T['ink3']), 6), nowrap('%d 步 · 已定稿' % len(steps), 11, T['ink4']))
        body_ = '<br>'.join('%d. %s' % (i + 1, s) for i, s in enumerate(steps))
        txt = '<div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 6px;"><div style="min-height: 80px; box-sizing: border-box; border: 1px dashed %s; border-radius: 6px; padding: 7px 9px; font-size: 11px; line-height: 1.45; color: %s;">%s</div>%s%s</div>' % (
            T['line_strong'], T['ink3'], body_, row(chip('纯文字版', 'neutral', 10) + nowrap('亚马逊', 11, T['ink3']), 6), nowrap('与图文版同步更新', 11, T['ink4']))
        cells += card(between(nowrap(name, 13, T['ink'], 700), nowrap('近 30 天引用 %d 次' % hits, 11, T['ink3'])) + row(pic + txt, 10, 'flex-start'), pad='12px 14px', gap=10)
    head = between(kb_tabs('素材库'), row(search_box('搜索素材名称或编号', '200px') + btn('上传素材', 'primary', 'sm', 'upload'), 8))
    note = row(icon('info', 14, T['ink4']) + nowrap('同一内容成对保存：邮件用图文版，亚马逊站内信用纯文字版（R-CC）。草稿只能插入这里的图片。', 12, T['ink3']), 6)
    return frame(head + note + grid(cells, 2, 12), bg='#ffffff', pad='16px 20px')


# ---------------------------------------------------------------- K12 待审核沉淀 + 审核抽屉
def k12():
    cands = [(q, src, who, i == 0) for i, (q, src, who) in enumerate(KB_REVIEW)]  # data.KB_REVIEW，选中第一条
    lst = ''
    for q, src, who, on in cands:
        lst += '<div style="padding: 10px 12px; border-bottom: 1px solid %s; background: %s; %s display: flex; flex-direction: column; gap: 4px;">%s%s</div>' % (
            T['line2'], T['accent_bg'] if on else '#ffffff', 'box-shadow: inset 3px 0 0 %s;' % T['accent'] if on else '', text(q, 13, T['ink'], 600),
            row(nowrap(src, 12, T['accent'], 600) + nowrap(who, 12, T['ink3']), 8))
    left = '<div style="width: 300px; flex-shrink: 0; border: 1px solid %s; border-radius: 8px; overflow: hidden; background: #ffffff;">%s</div>' % (T['line'], lst)
    drawer = card(
        between(text('审核沉淀', 14, T['ink'], 700), icon('x', 16, T['ink3'])) +
        kv('来源工单', row(nowrap('T-20260904-0098', 12, T['accent'], 600) + state('已解决'), 6)) + kv('提交人', '李婷 · 09-10 09:05') +
        col(label('问题') + text('充电线插上没反应怎么办？', 13, T['ink']), 4) +
        col(label('答案（取自采纳的回复）') + text('先换一个 12V 插座并检查点烟器保险丝；仍不充电时换用其他 USB-C 线测试。其他线能充说明原装线故障，按保修寄新线。', 13, T['ink2']), 4) +
        grid(field('归入', select_box('沉淀问答')) + field('适用店铺', select_box('全部店铺')), 2, 10) +
        field('退回原因', textarea_box(None, '写明需要补充或修改的地方', 'error', 52, '0 / 200'), True, error='退回需要填写原因') +
        between(muted('通过后进入检索，负责人为赵倩，有效期默认 12 个月。', 11), row(btn('退回', 'danger_outline', 'sm') + btn('通过', 'primary', 'sm', 'check'), 6)),
        pad='14px 16px', gap=10)
    body = '<div style="display: flex; gap: 14px; align-items: flex-start;">%s<div style="flex: 1; min-width: 0px;">%s</div></div>' % (left, drawer)
    return frame(kb_tabs('待审核沉淀') + body, bg='#ffffff', pad='16px 20px')


# ---------------------------------------------------------------- K13 知识缺口
def k13():
    import build_approval_kb_reports as P  # 聚类口径与 P16 摘要卡共用 data.KB_GAP_CLUSTERS；色调取 P.GAP_TONE
    out = ''
    for i, (name, site, lang, qs) in enumerate(KB_GAP_CLUSTERS):
        head = between(row(text(name, 13, T['ink'], 700) + nowrap('×%d' % len(qs), 13, T['ink2'], 700) + chip('%s · %s' % (site, lang), 'neutral', 10), 8),
                       row(link('关联已有条目', 12) + link('无需处理', 12) + btn('✦ AI 起草条目', 'accent_outline', 'sm'), 10))
        lines = ''.join('<div style="display: grid; grid-template-columns: minmax(0, 1fr) 128px 128px 40px; gap: 12px; align-items: center; padding: 6px 0px 6px 12px; border-top: 1px solid %s;">%s%s%s%s</div>' % (
            T['line2'], ellipsis(q, 12, T['ink2']), nowrap(src, 12, T['accent'], 600), '<div>%s</div>' % chip(r, P.GAP_TONE[r], 10), nowrap(d, 12, T['ink3'])) for q, src, r, d in qs)
        draft = ''
        if i == 0:
            draft = '<div style="display: flex; flex-direction: column; gap: 4px; background: #faf9ff; border: 1px solid %s; border-radius: 8px; padding: 8px 10px;">%s%s</div>' % (
                T['accent_line'], row(ai_badge('AI 草稿', 10) + nowrap(AI_MADE['K13_draft'], 12, T['ink3']) + nowrap('政策规则 · Forcome Direct（MX）· 西语 · 待你审核后生效', 12, T['ink4']), 8),
                text('锂电池随机寄往墨西哥只能走陆运或海运，不能空运；补发电池预计 10–15 个工作日送达，清关期间不可加急。', 12, T['ink2']))
        out += '<div style="border: 1px solid %s; border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px;">%s%s%s</div>' % (T['line'], head, lines, draft)
    n = sum(len(c[3]) for c in KB_GAP_CLUSTERS)
    note = row(icon('info', 14, T['ink4']) + nowrap('%d 个缺口按问题聚成 %d 类。来源三类：转人工、拒绝原因为知识错误、置信度低于 60%% 的草稿（R-KB-04）；每周处理一次。' % (n, len(KB_GAP_CLUSTERS)), 12, T['ink3']), 6)
    return frame(kb_tabs('知识缺口') + note + out, bg='#ffffff', pad='16px 20px')


# ---------------------------------------------------------------- K14 素材库选择器
def k14():
    import build_inbox
    names = {code: name for name, code, _, _ in KB_ASSETS}  # 素材名取 data.KB_ASSETS；按本工单推荐的顺序，选中 IMG-V2-014
    picks = [(c, names[c], c == 'IMG-V2-014') for c in ('IMG-V2-014', 'IMG-V2-017', 'IMG-V2-021', 'IMG-V2-009')]
    cells = ''.join('<div title="%s" style="min-width: 0px; border: 1.5px solid %s; background: %s; border-radius: 8px; padding: 6px; display: flex; flex-direction: column; gap: 5px;">%s%s%s</div>' % (
        name, T['accent'] if on else T['line'], T['accent_bg'] if on else '#ffffff', asset_thumb(code, 104, 62).replace('width: 104px;', 'width: 100%; box-sizing: border-box;'),
        ellipsis(name, 12, T['ink'], 600), nowrap(code, 11, T['ink4'])) for code, name, on in picks)
    body = search_box('搜索素材', '100%') + row(nowrap('按本工单推荐', 12, T['ink3']) + cat('产品故障与使用问题') + cat('吸力下降'), 6) + grid(cells, 4, 8) + \
        row(icon('lock', 13, T['ink4']) + nowrap('只能插入素材库图片；需要新图请联系知识库负责人上传。', 12, T['ink3']), 6)
    dlg = dialog('插入图片', body, btn('取消', 'secondary') + btn('插入 IMG-V2-014', 'primary', 'md', 'image'), 520)
    return overlay(scaled(build_inbox.p02(), 1440, 900, 0.6), dlg, W, 540)


# ---------------------------------------------------------------- K15–K17、K21 设置页的非默认页签
def k15():
    return frame(BS.rule_tabs('风险信号') + BS.p19_risk(), gap=14)


def k16():
    return frame(BS.rule_tabs('渠道内容能力') + BS.p19_content_cap(), gap=14)


def k17():
    full = frame(BS.team_tabs('角色权限') + BS.perm_matrix(), w=WW, gap=14)
    p1 = frame(cap('第一阶段 · 只显示阶段为「一起」「仅一」的能力行（prd_d 10.1）') + BS.perm_matrix(phase1=True), w=WW, gap=10)
    return col(full + p1 + k17_more(), 16)


# ---------------------------------------------------------------- K17 补充小样：P20 第一阶段的格内修改、吸底保存栏与「从钉钉添加」（待办 06）
P20_COLS = [('成员', 'left'), ('钉钉部门', 'left'), ('角色', 'left'), ('数据范围', 'left'), ('状态', 'left'), ('最近登录', 'left'), ('', 'right')]
P20_TPL = 'minmax(0, 1fr) 150px 190px 110px 90px 110px 28px'
LAST_ROLE = '至少保留一个角色；不再需要的成员请停用'
SCOPE_ALL = '全部店铺（含以后新增的）'
STORE_NAMES = [s['name'] for s in STORES]


def p20_cell(content, edited_=False, error=None):
    """可改的格子：改过的在内容旁标「已修改」（放不下时换行），保存时的报错写在下方。"""
    top = row(content + (BS.edited_tag() if edited_ else ''), 6, wrap=True, extra='row-gap: 4px;')
    return col(top + (err_line(error) if error else ''), 4) if error else top


def p20_row(key, roles=None, scope=None, status='已启用', role_edit=False, scope_edit=False, role_err=None, scope_err=None):
    """成员表的一行（同 BS.member_table(lang=False)）；roles、scope 可换成修改后的样子，并标「已修改」或报错。"""
    s = STAFF[key]
    who_ = row(avatar(s['avatar'], AV_TONE.get(s['role'], 'green'), 28) + col(nowrap(s['name'] + ('（我）' if key == 'liuyang' else ''), 13, T['ink'], 700) + nowrap(s['email'], 12, T['ink4']), 1), 10)
    roles_ = ''.join(cat(r) for r in (roles or [s['role']]))
    scope_ = nowrap(scope or s['stores'], 13, T['ink2'])
    return [who_, nowrap(s['dept'], 13, T['ink2']), p20_cell(roles_, role_edit, role_err), p20_cell(scope_, scope_edit, scope_err),
            state(status), nowrap(s['last_login'], 13, T['ink2']), icon_btn('more', size=24)]


def p20_rows(rows, row_tones=None):
    return table(P20_COLS, rows, P20_TPL, py=11, row_tones=row_tones)


def check_menu(items, width=176):
    """勾选列表（DropdownMenu 的勾选项）：items: [(文字, 勾选, 禁用)]"""
    out = ''
    for t, on, off in items:
        out += '<div style="padding: 7px 10px; border-radius: 6px;">%s</div>' % checkbox(t, on, off)
    return '<div style="width: %dpx; box-sizing: border-box; background: #ffffff; border: 1px solid %s; border-radius: 12px; box-shadow: %s; padding: 5px;">%s</div>' % (width, T['line'], SHADOW_MD, out)


def scope_popover(some=True, chosen=('Forcome Direct',), width=240):
    """「数据范围」的浮层：全部店铺 / 指定店铺；选指定店铺时下方勾选店铺（列全部店铺）。"""
    stores = ''.join('<div>%s</div>' % checkbox(n, n in chosen) for n in STORE_NAMES) if some else ''
    lst = '<div style="margin-left: 24px; padding-left: 12px; border-left: 1px solid %s; display: flex; flex-direction: column; gap: 7px;">%s</div>' % (T['line'], stores) if some else ''
    return '<div style="width: %dpx; box-sizing: border-box; background: #ffffff; border: 1px solid %s; border-radius: 12px; box-shadow: %s; padding: 12px; display: flex; flex-direction: column; gap: 8px;">%s%s%s</div>' % (
        width, T['line'], SHADOW_MD, radio(SCOPE_ALL, not some), radio('指定店铺', some), lst)


def err_line(t):
    return row(icon('alert', 13, T['bad'], 2) + nowrap(t, 12, T['bad']), 4)


def candidate_list(items, search='', empty_text=None, width=400):
    """「从钉钉添加」的成员下拉：上方搜索框，列钉钉通讯录里在职、还没分配角色的人（姓名 · 钉钉部门 · 邮箱）。"""
    box = '<div style="height: 36px; display: flex; align-items: center; gap: 8px; padding: 0px 12px; border-bottom: 1px solid %s;">%s%s</div>' % (
        T['line'], icon('search', 15, T['ink4']), nowrap(search or '搜索姓名或邮箱', 13, T['ink'] if search else T['ink5']))
    if empty_text:
        lst = '<div style="padding: 7px 10px; font-size: 12px; color: %s;">%s</div>' % (T['ink3'], empty_text)
    else:
        lst = ''.join('<div style="padding: 7px 10px; border-radius: 6px; display: flex; flex-direction: column;%s">%s%s</div>' % (
            ' background: %s;' % T['hover'] if i == 0 else '', nowrap(n, 13, T['ink2'], 600), nowrap(sub, 12, T['ink3'])) for i, (n, sub) in enumerate(items))
    return '<div style="width: %dpx; box-sizing: border-box; background: #ffffff; border: 1px solid %s; border-radius: 12px; box-shadow: %s;">%s<div style="padding: 5px;">%s</div></div>' % (
        width, T['line'], SHADOW_MD, box, lst)


def p20_candidates():
    """钉钉通讯录里在职、还没分配角色的人：新入职的（data.DINGTALK_NEWCOMERS）与两家生产厂负责人，按姓名排序。"""
    heads = [(STAFF[k]['name'], STAFF[k]['factory'], None) for k in ('liucz', 'zhoucz')]
    news = [(n['name'], n['dept'], n['email']) for n in DINGTALK_NEWCOMERS]
    order = {'刘厂长': 0, '吴桐': 1, '周厂长': 2}  # 姓名的拼音顺序（liu · wu · zhou）
    people = sorted(heads + news, key=lambda p: order.get(p[0], 9))
    return [(n, ' · '.join(x for x in (dept, mail) if x)) for n, dept, mail in people]


def add_drawer(errors=False):
    """「从钉钉添加成员」右侧抽屉（K8 同款，宽 440）：成员、角色、数据范围都必填；保存时一次报全并定位到第一个。"""
    roles_ = grid(''.join(checkbox(r) for r in ('坐席', '客服主管', '售后负责人', '知识库负责人', '管理员')), 3, 12, extra='row-gap: 8px;')
    body = (field('成员', select_box(st='error' if errors else 'default'), True, error='请选择成员' if errors else None) +
            field('角色', roles_, True, hint='可多选，权限取并集', error='请至少选择一个角色' if errors else None) +
            field('数据范围', col(radio(SCOPE_ALL) + radio('指定店铺'), 8), True, error='请选择数据范围' if errors else None))
    return BS.drawer('从钉钉添加成员', body, btn('取消', 'secondary') + btn('保存', 'primary'), 440,
                     '从钉钉通讯录选人并分配角色与店铺数据范围，分配后才能登录；保存记入审计日志。')


def k17_more():
    """K17 的补充小样（P20 第一阶段实现时确认，待办 06，10-06 用户确认）：格内修改角色与数据范围、改过的格与吸底保存栏（K6）、
    保存结果与断网、保存时的报错、已停用的成员、并发（G7）、离开（G8）、「从钉钉添加」抽屉与成员下拉、添加结果。"""
    zq = STAFF['zhaoqian']
    # ① 修改角色：勾选列表，只剩一个角色时它不能取消
    menu_ = check_menu([(r, r == zq['role'], r == zq['role']) for r in ('坐席', '客服主管', '售后负责人', '知识库负责人', '管理员')])
    tip = '<div style="padding-top: 92px;">%s</div>' % tooltip(LAST_ROLE)
    roles_pick = row('<div>%s</div>' % menu_ + tip, 8, 'flex-start')
    # ② 修改数据范围：全部店铺 / 指定店铺 + 勾选店铺
    scope_pick = row(scope_popover(False) + scope_popover(True), 16, 'flex-start')
    # ③ 修改后：改过的格旁标「已修改」，行首警示色条；吸底保存栏写修改摘要
    summary = '赵倩 角色：知识库负责人 → 坐席、知识库负责人；赵倩 店铺范围：全部店铺 → Forcome Direct'
    changed = p20_rows([p20_row('wanglei'), p20_row('zhaoqian', ['坐席', '知识库负责人'], 'Forcome Direct', role_edit=True, scope_edit=True)], row_tones={1: 'warning'})
    bar = save_bar(2, summary)
    # ④ 保存结果（K6）
    ok = toast('success', '设置已保存', '赵倩 店铺范围：Forcome Direct → 全部店铺，已记入审计日志（刘洋 10:24）。')
    fail = toast('error', '保存失败：网络不可用', '修改已保留在页面上。', link('立即重试', 12))
    off = toast('warning', '网络已断开，暂未保存', '修改已保留在页面上。恢复连接后自动重试保存，无需手动操作。', row(spinner(12, T['ink4']) + nowrap('等待网络恢复…', 12, T['ink3']), 6))
    back = toast('neutral', '已自动重试并保存', '10:26 网络恢复后重试成功：赵倩 店铺范围：Forcome Direct → 全部店铺，已记入审计日志。')
    # ⑤ 保存时的报错写在格子下方；已停用的成员不能改，悬停写原因
    errs = p20_rows([p20_row('zhaoqian', scope='—', scope_edit=True, scope_err='请至少选择一个店铺'),
                     p20_row('liuyang', ['坐席'], role_edit=True, role_err='至少要有一位在职的管理员')], row_tones={0: 'warning', 1: 'warning'})
    gone = p20_rows([p20_row('chenchen', status='已停用')])
    gone_tip = row(tooltip('已停用的成员不能修改角色与数据范围'), 0)
    # ⑥ 并发（G7）
    g7 = banner('warning', '赵倩刚被周敏修改（10:24）', '周敏改了：角色。你的修改还没保存，已保留在表格中；可先查看最新内容再改，或用你的内容覆盖。',
                row(btn('查看最新', 'secondary', 'sm', 'refresh') + btn('覆盖保存', 'danger_outline', 'sm'), 8))
    g7_many = banner('warning', '赵倩等 2 人刚被他人修改', '你的修改还没保存，已保留在表格中；可先查看最新内容再改，或用你的内容覆盖。',
                     row(btn('查看最新', 'secondary', 'sm', 'refresh') + btn('覆盖保存', 'danger_outline', 'sm'), 8))
    g7_unknown = banner('warning', '赵倩刚被他人修改', '你的修改还没保存，已保留在表格中；可先查看最新内容再改，或用你的内容覆盖。',
                        row(btn('查看最新', 'secondary', 'sm', 'refresh') + btn('覆盖保存', 'danger_outline', 'sm'), 8))
    # ⑦ 离开（G8）
    leave = dialog('离开前保存修改？', muted('「团队与权限」有 2 项未保存的修改。放弃后恢复为上次保存的值。', 13),
                   btn('继续编辑', 'secondary', st='focus') + btn('放弃修改', 'danger_outline') + btn('保存并离开', 'primary'), 460, 'warning')
    # ⑧ 「从钉钉添加」抽屉与成员下拉
    drawer_ = '<div style="height: 500px; display: flex;">%s</div>' % add_drawer(True)
    roles_ok = grid(''.join(checkbox(r, r == '坐席') for r in ('坐席', '客服主管', '售后负责人', '知识库负责人', '管理员')), 3, 12, extra='row-gap: 8px;')
    filling = '<div style="width: 400px; background: #ffffff; border: 1px solid %s; border-radius: 12px; padding: 12px 14px;">%s</div>' % (
        T['line'], field('角色', roles_ok, True, hint='可多选，权限取并集'))
    picks = col(candidate_list(p20_candidates()) + candidate_list([], empty_text='钉钉通讯录里的人都已分配角色') +
                candidate_list([], search='李', empty_text='没有匹配的人') + cap('填写时没有报错：角色下方写说明') + filling, 10)
    added = toast('success', '已添加成员', '%s · 坐席，已记入审计日志（刘洋 10:24）。' % DINGTALK_NEWCOMERS[0]['name'])
    add_fail = toast('error', '保存失败：网络不可用', '填写的内容已保留在抽屉里。', link('立即重试', 12))
    taken = '<div style="width: 400px;">%s</div>' % field('成员', select_box(DINGTALK_NEWCOMERS[0]['name'], st='error'), True, error='%s已经分配过角色' % DINGTALK_NEWCOMERS[0]['name'])
    add_leave = dialog('离开前保存修改？', muted('「从钉钉添加成员」填写的内容还没保存，放弃后不保留。', 13),
                       btn('继续编辑', 'secondary', st='focus') + btn('放弃修改', 'danger_outline') + btn('保存并离开', 'primary'), 460, 'warning')
    return frame(cap('P20 补充小样（第一阶段，待办 06）· ① 修改角色：点「角色」格展开勾选列表（P20 能分配的五个角色，没有生产厂对接人）；只剩一个角色时它不能取消，悬停写原因') + roles_pick +
                 cap('② 修改数据范围：点「数据范围」格展开，「全部店铺（含以后新增的）」或「指定店铺」，选指定店铺时下方勾选店铺（列全部店铺）') + scope_pick +
                 cap('③ 修改后：改过的格旁标「已修改」，该行行首警示色条；吸底保存栏写「有 N 项未保存修改」（N 为改过的格数）与修改摘要，几项用「；」接着写，放不下截断、悬停看全部；「放弃」直接撤销全部修改，「保存」不二次确认') + changed + bar +
                 cap('④ 保存结果：成功浮层写修改摘要；断网时保留修改并在恢复后自动重试（K6），仍失败转红色失败浮层') + grid(ok + fail, 2, 12, extra='align-items: start;') + grid(off + back, 2, 12, extra='align-items: start;') +
                 cap('⑤ 保存时的报错写在格子下方，整批都不保存：「指定店铺」没勾店铺；去掉了最后一位在职管理员的「管理员」角色') + errs +
                 cap('已停用的成员：角色与数据范围的格子不能改，悬停写原因') + gone + gone_tip +
                 cap('⑥ 有人已被别人改过（G7）：整批都不保存，表格上方给横幅；几个人时标题写「等 N 人」、不写是谁，一个人但对不出是谁改的（这个人已不在成员表里，例如刚回到通讯录、角色被清空）同样写「他人」；「覆盖保存」需二次确认（同 P18）') + g7 + g7_many + g7_unknown +
                 cap('⑦ 有未保存的修改时离开本页（G8，切换设置菜单、顶栏导航、头像菜单）；切「角色权限」页签不算离开') + '<div style="display: flex; justify-content: center;">%s</div>' % leave +
                 cap('⑧ 「从钉钉添加」右侧抽屉（宽 440）：成员、角色、数据范围都必填，数据范围默认不选；保存时一次报全并定位到第一个错误；在抽屉里直接保存，不进吸底保存栏') +
                 row(drawer_ + picks, 24, 'flex-start') +
                 cap('选的人刚被别人添加过（报在「成员」上）；添加结果；有输入时关闭抽屉（G8）') + taken + grid(added + add_fail, 2, 12, extra='align-items: start;') +
                 '<div style="display: flex; justify-content: center;">%s</div>' % add_leave,
                 w=WW, gap=10)


def k21():
    return frame(BS.rule_tabs('处理说明') + BS.p19_guide(), w=WW, gap=14)


# ---------------------------------------------------------------- K18 审计日志的可见范围
def k18():
    import build_audit as AU
    # ① 李婷（坐席）：只见自己的操作，操作人筛选锁定为本人
    mine = [r for r in AUDIT_LOG if r[1] == '李婷']
    cols = [c for c in AU.COLS if c[0] != '来源 IP']
    a = frame(cap('① 李婷 · 坐席') + AU.audit_page_head() +
              banner('info', '你只能看到自己的操作记录', '操作人筛选已锁定为本人；客服主管与管理员可查看全部（10.2）。') +
              AU.audit_filters('李婷', who_locked=True, compact=True) +
              AU.audit_table(mine, cols=cols, tpl='44px 112px 210px 72px minmax(0, 1fr) 14px', viewer='坐席') + muted('共 %d 条' % len(mine), 12), w=W)
    # ② 刘洋（管理员，无财务权限）：展开 S-20260909-0016 的记录，财务字段前后值显示「已隐藏」；管理员打不开 P13，售后单编号不可点
    d = AUDIT_EXPAND_DEMO
    role = STAFF[AU.NAME_KEY[d['who']]]['role']
    ip = [r[7] for r in AUDIT_LOG if r[1] == d['who']][0]  # 同一操作人的来源 IP
    f0 = d['fields'][0]
    rec = (d['at'], d['who'], role, '售后单', d['obj'], d['action'], '%s：%s → %s' % (f0[0], f0[1], f0[2]), ip, False)
    exp = AU.audit_expand(d['fields'], hide_fin=True, meta='%s · %s · %s · 来源 IP %s' % (d['at'], d['who'], role, ip))
    b = frame(cap('② 刘洋 · 管理员（没有财务权限）') + AU.audit_page_head() +
              row(icon('lock', 14, T['ink4']) + muted('你的角色没有财务权限：成本、承担比例、结算金额的前后值显示「已隐藏」，其他字段照常显示。', 12), 6) +
              AU.audit_filters(None, '近 7 天', d['obj'], compact=True) +
              AU.audit_table([rec], 0, exp, AU.changed_count(d['fields']), cols=cols, tpl='76px 128px 200px 80px minmax(0, 1fr) 14px', viewer='管理员'), w=W)
    pics = '<div style="display: flex; gap: 0px; align-items: stretch;">%s<div style="width: 1px; background: %s; margin: 0px 15px 0px 16px;"></div>%s</div>' % (a, T['line'], b)
    return col(pics + k18_more(), 16)


def k18_more():
    """K18 的补充小样（第一阶段实现时确认，待办 30，10-05）：第一阶段几种记录的写法、列表为空、导出、自定义时间。"""
    import build_audit as AU
    from build_states_as import range_picker
    rows = AUDIT_P1_MORE
    count = lambda n, denied: nowrap('共 %d 条 · 越权访问 %d 条 · 点行展开完整前后值' % (n, denied), 12, T['ink3'])
    week = '09-05 至 09-11 近 7 天'
    tpl = AU.TPL.replace('64px', '76px', 1)  # 跨天时时间列写「月-日 时:分」，加宽
    a = frame(cap('① 周敏 · 近 7 天：第一阶段的几种记录。导出审计日志本身也记一条；新建没有前值，摘要写「字段：— → 后」，「等 N 项」为有值的字段数；'
                  '店铺范围的越权访问写越权的店铺（本例陈晨的店铺范围只有 Forcome Direct）；时间写「月-日 时:分」；周敏打不开 P18，店铺编号不可点') +
              AU.audit_filters(None, '近 7 天') +
              col(row(label(week) + count(len(rows), sum(1 for r in rows if r[8])), 8) + AU.audit_table(rows, tpl=tpl, viewer='客服主管'), 10), w=WW)
    none = '<div style="background: #ffffff;">%s</div>' % empty('search', '没有符合条件的操作记录', '当前筛选：近 7 天 · 操作人 王磊 · 店铺。换个条件试试，或清除筛选。',
                                                               btn('清除筛选', 'secondary', 'md', 'x'))
    b = frame(cap('② 列表为空：说明写当前筛选；偏离默认（今天、其余都没选）时给「清除筛选」，没有分页') +
              AU.audit_filters('王磊', '近 7 天', obj_type='店铺') +
              col(row(label(week) + count(0, 0), 8) + AU.audit_table([], tpl=tpl, empty_html=none), 10), w=WW)
    busy = AU.audit_page_head(actions=btn('正在生成，约 3 秒', 'secondary', 'md', loading=True))
    done = '<div style="display: flex; justify-content: flex-end;">%s</div>' % toast('success', '已导出 %s · 已记入审计日志' % AUDIT_EXPORT_FILE)
    c = frame(cap('③ 导出（K5）：按当前筛选，不分页；生成中与完成。文件名：今天「审计日志_今天_0911」、近 7 天「审计日志_近7天_0905-0911」、自定义「审计日志_0901-0911」') +
              busy + done, w=W)
    picker = '<div style="padding-left: 96px;">%s</div>' % range_picker()
    e = frame(cap('④ 自定义：点「自定义」弹出区间日历（同 P13 费用发生日），点第二天即生效；表头上方写起止') +
              AU.audit_filters(None, '自定义', compact=True) + picker + row(label('09-01 至 09-11') + count(17, 1), 8), w=W)
    return col(a + b + '<div style="display: flex; gap: 0px; align-items: stretch;">%s<div style="width: 1px; background: %s; margin: 0px 15px 0px 16px;"></div>%s</div>' % (c, T['line'], e), 16)


# ---------------------------------------------------------------- K19 第一阶段报表
def p17_p1_kpis():
    R = REPORT
    return grid(kpi('工单量', str(R['tickets_week']), R['tickets_delta'], 'muted', '近 7 天 · 客户来信新建或重开') +
                kpi('首响中位数', R['frt_median'], R['frt_delta'], 'success', '来信到首次回复 · 按来信到达归期') +
                kpi('SLA 达标率（亚马逊）', R['sla_rate'], None, 'muted', '未达标 %d 封' % R['sla_miss']), 3, 12)


def p17_p1_daily(P, drill=True, h=220):
    """每日工单量。drill=False（管理员没有工单页权限）：不可点、没有「查看明细」。"""
    R = REPORT
    d10 = [x for x in R['daily'] if x[0] == '09-10'][0]
    tip = P.drill_tip('09-10 · %d 单' % (d10[1] + d10[2]), ['亚马逊 %d · Shopify 与邮件 %d' % (d10[1], d10[2])], 'P04 工单（%s）' % P1_DRILL['label']) if drill else ''
    body = P.legend([('亚马逊', T['amazon']), ('Shopify 与邮件', T['shopify'])]) + P.stacked_columns(R['daily'], h, 80, 20, hover=R['daily'].index(d10) if drill else None, tip=tip)
    extra = None if drill else chip('没有工单页权限 · 不可下钻', 'muted', 11, 'lock')
    return P.chart_card('每日工单量', '按渠道堆叠 · 近 7 天' + (' · 点柱下钻' if drill else ''), body, extra=extra)


def p17_p1_cost(P):
    cbr = cost_by_resp()
    order = sorted(cbr.items(), key=lambda x: -x[1])
    lt = ledger_totals()
    tot = round(sum(cbr.values()), 2)
    return P.chart_card('售后成本按责任类型', '产品成本 + 运费 + 额外赔偿 + 其他',
                        between(row(text(money(tot), 20, T['ink'], 700) + muted('售后成本 · %d 单 · 来自登记台账，不含待确认 · 点条下钻' % lt['count'], 12), 8, 'baseline'), '') +
                        P.hbars(order, money, 130, T['accent'], 96, 12, 14), tag=P.lock_tag())


def p17_p1_notes():
    return row(row(icon('info', 13, T['ink4']) + nowrap('只统计经店铺邮箱发出的回复', 12, T['ink3']), 5) +
               row(icon('alert', 13, T['warn'], 2) + nowrap('Shopify 订单只回补了 %d 天，更早的 Shopify 来信可能关联不到订单' % SHOPIFY_BACKFILL_DAYS, 12, T['warn']), 5), 16)


def p17_p1(P):
    """第一阶段 P17（周敏）：筛选去掉标签；3 个指标；每日工单量 + 售后成本按责任类型；标题下两条注（prd_c P17「第一阶段」）。"""
    desc = col(nowrap('数据来源：工单（Gmail）、平台订单、登记台账 · 更新于 %s' % report_updated(), 13, T['ink3']) + p17_p1_notes(), 6)
    head = page_head('报表', desc, btn('导出', 'secondary', 'md', 'download'))
    filt = between(row(seg(['近 7 天', '本月', '自定义'], '近 7 天') + nowrap('09-05 至 09-11', 12, T['ink3']) + divider(True, 16) +
                       filter_chip('店铺', '全部') + filter_chip('站点', '全部'), 8), chip('指标为示例数据', 'warning', 11, 'info'))
    charts = grid(p17_p1_daily(P, True, 300) + p17_p1_cost(P), template='minmax(0, 1.25fr) minmax(0, 1fr)', gap=14, extra='align-items: start;')
    return app('zhoumin', '报表', ['报表'], head + content(filt + p17_p1_kpis() + charts, '14px 24px', 12), phase1=True)


def k19():
    import build_approval_kb_reports as P  # 图表部件与 P17 共用
    s = 0.7
    page = scaled(p17_p1(P), 1440, 900, s)
    admin = frame(cap('另一张小图 · 刘洋（管理员）局部 1:1') + p17_p1_kpis() + p17_p1_daily(P, False, 170) +
                  row(icon('lock', 14, T['ink4']) + muted('没有财务权限：不显示售后成本卡；没有工单页权限：每日工单量不可点、没有「查看明细」。', 12), 6, 'flex-start'),
                  w=WW - int(1440 * s) - 24)
    return '<div style="display: flex; gap: 24px; align-items: flex-start; background: %s;">%s%s</div>' % (T['canvas'], page, admin)


# ---------------------------------------------------------------- K20 第一阶段渠道卡
def k20():
    S = STORES[0]
    samples = [
        ('已连接', BS.ch_card('message', 'Gmail', state('已连接'), [], tone='ok', sync=CHANNEL_SYNC['Gmail'], test=False)),
        ('同步延迟 · 钉钉 2 小时、其他 10 分钟', BS.ch_card('users', '钉钉', state('同步延迟'), [], tone='warn', card_tone='warning', sync=BS.DINGTALK_LATE_SYNC, test=False)),
        ('连接异常 · 连续 3 次失败', BS.ch_card('store', '亚马逊 SP-API', state('连接异常'), [], tone='bad', card_tone='danger', sync=CHANNEL_SYNC['SP-API 异常'], test=False)),
        ('未连接', BS.ch_card('store', 'Shopify Admin API', state('未连接'), [], tone='muted', test=False, sub_text='尚未授权')),
        ('模拟数据 · 仅开发测试环境', BS.ch_card('message', 'Gmail', row(chip('模拟数据', 'info', 11) + state('已连接'), 6), [], tone='ok', sync=CHANNEL_SYNC['Gmail'], test=False)),
    ]
    strip = grid(''.join(col(c + nowrap(t, 11, T['ink3'], 600), 6) for t, c in samples), 5, 12)
    st_col = row(nowrap('店铺表「状态」列的写法：', 12, T['ink3']) + BS.store_status(S) + BS.store_status(S, ('Gmail', '同步延迟')) + BS.store_status(S, ('SP-API', '连接异常')) +
                 muted('（店铺任一连接异常时，所属渠道卡同时显示最差状态）', 12), 14)
    ding = '<div style="width: 470px;">%s</div>' % BS.dingtalk_card(phase1=True)
    # 补充小样（待办 09 Q2–Q4、Q6 · 10-06 用户确认）：Gmail 卡同步延迟与连接异常、钉钉卡连接异常的第一阶段写法；「测试连接」的结果浮层
    cards = grid(''.join(col(c + nowrap(t, 11, T['ink3'], 600), 6) for t, c in [
        ('Gmail 同步延迟 · 超过 10 分钟没同步成功', BS.gmail_card_p1('同步延迟')),
        ('Gmail 连接异常 · 连续 3 次失败（全站横幅同 G4）', BS.gmail_card_p1('连接异常')),
        ('钉钉连接异常 · 只提醒管理员、不出横幅', BS.dingtalk_card(err=True)),
        ('Gmail 几个邮箱同时异常、一个延迟（横幅同 G4）', BS.gmail_card_p1('异常与延迟')),
        ('钉钉从没同步成功过 · 连续 3 次失败', BS.dingtalk_card(err='never'))]), 3, 12)
    tests = row(toast('success', '连接正常', 'Gmail：4 个邮箱均可访问') + toast('success', '连接正常', '钉钉：通讯录可访问') +
                toast('error', '测试连接失败：support@forcome.mx 无法访问', '请检查全域委派范围与邮箱状态') +
                toast('error', '测试连接失败：钉钉通讯录无法访问', '请检查应用凭据与通讯录权限') +
                toast('success', '连接正常', 'Shopify：2 个店铺均可访问') +
                toast('error', '测试连接失败：forcome.mx 无法访问', '请检查 Admin API 应用凭据与授权范围') +
                toast('success', '连接正常', '亚马逊 SP-API：2 个店铺均可访问') +
                toast('error', '测试连接失败：%s 无法访问' % AMAZON_ISSUE['store'], '请检查 SP-API 应用凭据与卖家授权') +
                toast('error', '测试连接失败：订单通知队列（SQS） 无法访问', '请检查 AWS 访问密钥与队列地址'), 12, 'flex-start', wrap=True)
    # 补充小样（待办 11 · 协调者 10-06 决定，套用 Gmail 已确认的写法）：Shopify 卡同步延迟与连接异常（按店铺）；Gmail 与 Shopify 同时异常时
    # 全站横幅各一条、Gmail 在上（G4 写法，「查看渠道状态」只对管理员）；Shopify 连接异常与恢复的站内通知、P27 的对象与「补拉」
    shop_cards = grid(''.join(col(c + nowrap(t, 11, T['ink3'], 600), 6) for t, c in [
        ('Shopify 同步延迟 · 超过 10 分钟没同步成功', BS.shopify_card_p1('同步延迟')),
        ('Shopify 连接异常 · 连续 3 次失败（全站横幅同 G4）', BS.shopify_card_p1('连接异常'))]), 3, 12)
    banners = col(banner('danger', *G4_BANNER, action=btn('查看渠道状态', 'secondary', 'sm')) +
                  banner('danger', *G4_BANNER_SHOPIFY, action=btn('查看渠道状态', 'secondary', 'sm')), 8, 'width: 1100px;')
    # 补充小样（待办 12 · 协调者 10-06 决定 Q1–Q7，套用 Shopify 的写法）：亚马逊卡同步延迟与连接异常（按店铺；SQS 行各状态下照写）、
    # SQS 行的四种写法（只影响这一行）；三个渠道同时异常时横幅 Gmail → 亚马逊 → Shopify；亚马逊连接异常与恢复的站内通知、P27 的对象与「补拉」
    amz_cards = grid(''.join(col(c + nowrap(t, 11, T['ink3'], 600), 6) for t, c in [
        ('亚马逊同步延迟 · 超过 10 分钟没同步成功', BS.amazon_card_p1('同步延迟')),
        ('亚马逊连接异常 · 连续 3 次失败（全站横幅同 G4）', BS.amazon_card_p1('连接异常'))]), 3, 12)
    sqs_rows = row(''.join(col(BS.sqs_line(s) + nowrap(t, 11, T['ink3'], 600), 6) for s, t in zip(SQS_STATES, [
        '正常 · 等待拉取的通知少于 10 条（有积压时黄色）', '积压 · 等待拉取的通知 ≥ 10 条（每分钟检查一次）', '拉取失败 · 连续 3 次', '未连接 · 没配置 SQS'])),
        24, 'flex-start')
    # 补充小样（待办 13 · 协调者 10-06 决定 Q2）：订单回补行的四种写法
    backfill_rows = row(''.join(col(BS.backfill_line(s) + nowrap(t, 11, T['ink3'], 600), 6) for s, t in zip(BACKFILL_STATES, [
        '未开始 · 连接上的店铺有还没回补的（含上线后新加的店铺）', '进行中 · 已回补笔数为各店铺合计', '已完成 · 连接上的店铺都回补完了',
        'Shopify 没开通 read_all_orders · 回补完成后'])), 24, 'flex-start')
    amz_banners = col(banner('danger', *G4_BANNER, action=btn('查看渠道状态', 'secondary', 'sm')) +
                      banner('danger', *G4_BANNER_AMAZON, action=btn('查看渠道状态', 'secondary', 'sm')) +
                      banner('danger', *G4_BANNER_SHOPIFY, action=btn('查看渠道状态', 'secondary', 'sm')), 8, 'width: 1100px;')
    amz_notices = row(''.join(col(nowrap(title, 13, T['ink'], 600) + nowrap(body, 12, T['ink3']) + nowrap('P18 · 亚马逊 SP-API', 11, T['ink4']), 2,
                                  'padding: 8px 12px; border: 1px solid %s; border-radius: 8px; background: #ffffff;' % T['line'])
                              for title, body in AMAZON_NOTICES) +
                      col(nowrap(AMAZON_AUDIT['object'] + ' · 恢复连接', 13, T['ink'], 600) + nowrap(AMAZON_AUDIT['summary'], 12, T['ink3']) +
                          nowrap('补拉：' + AMAZON_AUDIT['backfilled'], 12, T['ink3']), 2,
                          'padding: 8px 12px; border: 1px solid %s; border-radius: 8px; background: #ffffff;' % T['line']), 12, 'flex-start')
    notices = row(''.join(col(nowrap(title, 13, T['ink'], 600) + nowrap(body, 12, T['ink3']) + nowrap('P18 · Shopify', 11, T['ink4']), 2,
                              'padding: 8px 12px; border: 1px solid %s; border-radius: 8px; background: #ffffff;' % T['line'])
                          for title, body in SHOPIFY_NOTICES) +
                  col(nowrap(SHOPIFY_AUDIT['object'] + ' · 恢复连接', 13, T['ink'], 600) + nowrap(SHOPIFY_AUDIT['summary'], 12, T['ink3']) +
                      nowrap('补拉：' + SHOPIFY_AUDIT['backfilled'], 12, T['ink3']), 2,
                      'padding: 8px 12px; border: 1px solid %s; border-radius: 8px; background: #ffffff;' % T['line']), 12, 'flex-start')
    return frame(BS.p18(phase1=True) + cap('卡头小样 · 卡片状态的五种写法') + strip + cap('店铺表状态列') + st_col +
                 cap('钉钉卡 · 第一阶段已连接') + ding +
                 cap('补充小样 · 第一阶段 Gmail 卡同步延迟与连接异常、钉钉卡连接异常（下一行为边界：几个邮箱同时异常、钉钉从没同步成功过）') + cards +
                 cap('补充小样 · 「测试连接」的结果（G5 浮层；测试中按钮置灰转圈；测试连接不改状态，Gmail、Shopify、亚马逊测完立即同步一次；'
                     '亚马逊另探一次订单通知队列，店铺与队列都访问不了时写「Forcome Auto、订单通知队列（SQS） 无法访问」）') + tests +
                 cap('补充小样 · 第一阶段 Shopify 卡同步延迟与连接异常（按店铺；回补行在同步延迟时照写，连接异常时不显示）') + shop_cards +
                 cap('补充小样 · Gmail 与 Shopify 同时连接异常：全站横幅各一条，Gmail 在上（G4 写法）') + banners +
                 cap('补充小样 · Shopify 连接异常与恢复的站内通知（G10 写法）、P27 的对象与「补拉」') + notices +
                 cap('补充小样 · 第一阶段亚马逊卡同步延迟与连接异常（按店铺；订单通知队列一行各状态下照写；回补行在同步延迟时照写，连接异常时不显示）') + amz_cards +
                 cap('补充小样 · 订单通知队列（SQS）行的四种写法（只影响这一行：不改卡片与店铺的连接状态、不出横幅、不发通知）') + sqs_rows +
                 cap('补充小样 · 订单回补行的四种写法（亚马逊卡在订单通知队列行之后、Shopify 卡在店铺行之后；只汇总连接上的店铺，'
                     '天数取各店铺回补窗口中最短的；管理员用部署子命令 order-backfill 开始，上线后新加的店铺再执行一次）') + backfill_rows +
                 cap('补充小样 · Gmail、亚马逊、Shopify 同时连接异常：全站横幅各一条，从上到下 Gmail、亚马逊、Shopify（G4 写法）') + amz_banners +
                 cap('补充小样 · 亚马逊连接异常与恢复的站内通知（G10 写法）、P27 的对象与「补拉」') + amz_notices, w=1472, gap=12)


# ---------------------------------------------------------------- K22–K24 客服主管的设置页「SLA」「标签库」「模板」（局部 1:1）
def set_head(title, desc, actions=''):
    return between(col('<div style="font-size: 20px; font-weight: 700; color: %s; letter-spacing: -0.01em;">%s</div>' % (T['ink'], title) + muted(desc, 13), 4), actions, 'flex-end')


def k22():
    amz = between(row(channel('亚马逊') + nowrap('%d 小时' % SLA_HOURS['亚马逊'], 14, T['ink'], 700) + nowrap('自然小时 · 平台考核', 12, T['ink3']), 10),
                  chip('锁定只读', 'muted', 11, 'lock'))
    inner = between(row(channel('Shopify') + channel('邮件') + nowrap('内部目标', 13, T['ink'], 600), 8),
                    row(input_box(str(SLA_HOURS['内部目标']), width='72px', suffix='小时', mono=True) + nowrap('1–72 的整数小时，可按店铺覆盖', 12, T['ink4']), 8))
    rows = []
    for s_ in STORES:
        v = SLA_OVERRIDES[s_['id']]
        val = row(chip('覆盖', 'accent', 11) + nowrap('%d 小时' % v, 13, T['ink'], 600) + icon('edit', 13, T['ink4']), 6) if v else \
            row(nowrap('继承', 12, T['ink4']) + nowrap('%d 小时' % SLA_HOURS['内部目标'], 13, T['ink3']), 6)
        rows.append([nowrap(s_['name'], 13, T['ink'], 600), '<div style="display: flex;">%s</div>' % channel(s_['platform']), val, link('恢复继承', 12) if v else link('覆盖', 12)])
    t = table([('店铺', 'left'), ('平台', 'left'), ('内部目标', 'left'), ('', 'right')], rows, '180px 100px minmax(0, 1fr) 64px', dense=True)
    sla_card = card(amz + divider() + inner + col(label('店铺覆盖') + t, 8), title=row(text('首次回复时限', 13, T['ink'], 700) + nowrap('对每封客户来信计时（R-SL）', 12, T['ink4']), 8),
                    pad='14px 16px', gap=12)
    kvs = col(kv('工作日', '周一至周五') + kv('时段', '09:00–18:00（北京时间）') + kv('节假日', '不扣') + kv('换算', '1 个工作日 = 9 个工作小时'), 4)
    ex = '<div style="display: flex; align-items: center; gap: 8px; background: %s; border: 1px solid %s; border-radius: 8px; padding: 8px 10px;">%s%s</div>' % (
        T['subtle'], T['line'], nowrap('算例', 12, T['ink3'], 600), nowrap('周五 16:00 起 4 个工作小时 → 下周一 11:00', 13, T['ink'], 600))
    wt = card(kvs + ex + muted('生产厂任务、人工操作清单等时限按工作时间计算（R-CL-01、R-CL-02）。', 12),
              title=row(text('工作时间', 13, T['ink'], 700) + nowrap('不扣节假日', 12, T['ink4']), 8), pad='14px 16px', gap=10)
    return frame(set_head('SLA', '首次回复时限与工作时间。修改在底部统一保存，并记入审计日志。') + sla_card + wt +
                 '<div style="margin: 0px -16px -16px -16px;">%s</div>' % save_bar(0, '修改时限或店铺覆盖后在这里统一保存'), gap=12)


def k23():
    rows = [[pill(n), text(d, 13, T['ink2']), nowrap('%d 张工单' % c, 13, T['ink2']), state(st), row(link('编辑', 12) + link('停用', 12), 10)] for n, d, c, st in TAG_LIBRARY]
    t = table([('标签', 'left'), ('说明', 'left'), ('近 30 天使用', 'right'), ('状态', 'left'), ('操作', 'left')], rows, '88px minmax(0, 1fr) 96px 76px 76px', py=10)
    note = row(icon('info', 14, T['ink4']) + muted('一张工单最多 5 个标签，坐席只能选用；报表可按标签筛选。停用而不删除，已打在工单上的标签保留。', 12), 6, 'flex-start')
    body = field('名称', input_box(TAG_LIBRARY[0][0], st='error'), True, error='标签名已存在，请换一个') + \
        field('说明', textarea_box(None, '写明什么情况打这个标签', 'error', 64, '0 / 60'), True, error='请填写说明')
    drw = BS.drawer('新增标签', body, btn('取消', 'secondary') + btn('保存', 'primary'), 380, '保存后坐席即可选用，记入审计日志。')
    side = '<div style="height: 380px; display: flex; justify-content: flex-end; background: %s; border-radius: 8px; overflow: hidden;">%s</div>' % (T['line2'], drw)
    return frame(set_head('标签库', '坐席给工单打的手工标签。', btn('新增标签', 'primary', 'sm', 'plus')) + t + note + cap('点「新增标签」· 右侧抽屉，保存时校验') + side, gap=12)


def k24():
    rows = [[nowrap(n, 13, T['ink'], 600), cat(u), nowrap(lg, 13, T['ink2']), nowrap(ch_, 13, T['ink2']), ellipsis(st, 13, T['ink2']), nowrap(up, 13, T['ink3']), link('编辑', 12)]
            for n, u, lg, ch_, st, up in TEMPLATES]
    t = table([('模板', 'left'), ('用途', 'left'), ('语言', 'left'), ('渠道', 'left'), ('适用店铺', 'left'), ('更新', 'left'), ('', 'right')], rows,
              'minmax(0, 1fr) 84px 72px 52px 190px 52px 32px', sel=0, py=11)
    left = col(set_head('模板', '进展回复、签名与通知模板；按语言、渠道与店铺生效。', btn('新建模板', 'primary', 'sm', 'plus')) + t +
               row(icon('info', 14, T['ink4']) + muted('进展回复模板不得含承诺、金额与具体时刻（R-SL-05），保存时检查。', 12), 6), 12, 'flex: 1; min-width: 0px;')
    D = TEMPLATE_DEMO
    var = lambda v: '<span style="font-size: 12px; font-weight: 600; color: %s; background: %s; border-radius: 4px; padding: 0px 5px;">%s</span>' % (T['accent_ink'], T['accent_bg'], v)
    bad = '<span style="background: %s; color: %s; font-weight: 600; border-radius: 4px; padding: 0px 3px; text-decoration: underline wavy %s;">%s</span>' % (T['bad_bg'], T['bad'], T['bad_solid'], D['bad'])
    txt = D['body'].replace('{客户名}', var('{客户名}')).replace('{订单号}', var('{订单号}')).replace(D['bad'], bad)
    tools = row(nowrap('插入变量', 12, T['ink3']) + var('{客户名}') + var('{订单号}') + var('{店铺名}') + spacer() +
                btn('插入链接', 'secondary', 'sm', 'link', disabled=True, reason='渠道含亚马逊：亚马逊渠道只允许纯文字，不能插入链接'), 6)
    body = (field('名称', input_box(D['name']), True) +
            grid(field('用途', select_box('进展回复')) + field('语言', select_box('英语')) + field('渠道', select_box('全部')), 3, 10) +
            field('正文', textarea_box(txt, None, 'error', 96), True, error='进展回复不得含具体时刻：「%s」（R-SL-05）' % D['bad']) + tools +
            row(icon('lock', 13, T['ink4']) + muted('渠道含亚马逊时按纯文字保存，插入链接置灰。', 12), 6))
    drw = BS.drawer('编辑模板 · ' + D['name'], body, btn('取消', 'secondary') + btn('保存', 'primary'), 460, '修改记入审计日志；已发出的回复不受影响。')
    right = '<div style="height: 520px; display: flex; flex-shrink: 0;">%s</div>' % drw
    return frame('<div style="display: flex; gap: 16px; align-items: flex-start;">%s%s</div>' % (left, right), w=WW, gap=12)


SPEC = {
    'K5': '服务端按当前筛选与字段权限同步生成：生成中按钮转圈并写「正在生成，约 3 秒」；完成后浏览器直接下载，浮层「已导出 %s · 已记入审计日志」；不留存文件、没有导出记录页。' % EXPORT_FILE,
    'K8': 'P18 点「新增店铺」或行尾「编辑」从右侧滑出抽屉（页面保持可见）：店铺名、平台、站点（多选）、默认站点、进线邮箱、平台标识、签名与覆盖项；开发测试环境另有「数据来源：真实接口 / 模拟数据」（新建时默认模拟数据），生产环境不显示也不接受。店铺名重复、平台标识为空、邮箱格式错误在字段下方报错，多个错误一次列全；保存按钮保持可点，点击后定位到第一个错误（AC-ST-01）。保存记入审计日志，未归属队列中收件地址匹配的来信自动归位。下方补充小样：进线邮箱没有错误时的提示、亚马逊店铺的平台标识、进线邮箱重复（每个地址一条错误）、其余必填项、编辑抽屉标题、保存结果浮层（成功 3 秒消失；失败保留输入、可立即重试）、店铺表为空、新增时的未保存离开（G8）。',
    'K10': '二次确认弹窗列出该成员的未关闭工单与进行中售后单，分别选接手人：工单选坐席或客服主管，售后单只列有该店铺范围的售后负责人；选齐后「改派并停用」，变更记审计（AC-ST-02）。成员在钉钉离职后自动停用，其未关闭工单与进行中售后单进入客服主管改派队列（AC-ST-05）。示例：停用李婷，未关闭工单按 data.TICKETS 计 → 接手人陈晨，进行中售后单 0 张；另一张小图：停用王磊，4 张进行中售后单但没有其他售后负责人，「改派并停用」置灰并写原因。',
    'K15': '页签「风险信号 · 7」，7 条风险信号命中即转人工（data.RISK_SIGNALS）。安全事故、平台风险与疑似提示注入（D-21）为硬规则：开关锁定并写「硬规则，不可关闭」。重复联系、高价值行内写明关闭影响「关闭需二次确认：近 30 天约少转人工 N 封」（data.RISK_OFF_IMPACT）；关闭任一可关的信号都是危险开关，二次确认并写明影响（关闭后命中的来信不再转人工，可能自动发送），确认后进入吸底保存栏。「发送方式与阈值」页签名旁圆点表示该页签有未保存修改。',
    'K17': '权限矩阵一张表全部展开（不折叠），按 工单 / 审批 / 售后 / 知识 / 报表 / 设置 / 工厂 分组，能力行照 prd_d 10.1（含第一阶段的标记无需回复、新建与编辑登记、设为已完成，以及指定店铺、补登与汇率、改派售后单负责人、查看成本与结算金额、查看审计日志）；● 有权限、○ 只能看自己发起或负责的（「○ 自己登记的」写明范围）、「—」无权限、文字为部分能力。只读，按角色固定；第一阶段只显示已上线的能力行。下方为 P20 第一阶段的补充小样（待办 06，10-06 用户确认）：格内修改角色与数据范围、改过的格与吸底保存栏（K6）、保存结果与断网、保存时的报错（含至少一位在职管理员）、已停用的成员、并发（G7）、离开（G8）、「从钉钉添加」抽屉与成员下拉、添加结果。',
    'K18': '两张小图：① 李婷（坐席）视角：页头提示「你只能看到自己的操作记录」，操作人筛选锁定为本人，列表只有李婷的记录；② 刘洋（管理员，没有财务权限）视角：展开 S-20260909-0016 的记录（data.AUDIT_EXPAND_DEMO），展开列出该单前后任一侧有值的全部字段、变化的标出，产品成本、运费、额外赔偿、其他、承担比例的前后值显示灰色「已隐藏」，其他字段照常显示；摘要「等 N 项」的 N 是变化的字段数；管理员打不开 P13，售后单编号不可点（10.2、D-24）。示例为完整版，第一阶段只有 P27「第一阶段」列出的对象类型。下方为补充小样（待办 30，10-05 用户确认）：第一阶段几种记录的写法、列表为空、导出、自定义时间。',
    'K19': '周敏视角，第一阶段外壳（导航 工单 · 售后 · 报表，无店铺范围与搜索）：筛选 近 7 天 · 本月 · 自定义 · 店铺 · 站点；标题下「数据来源：工单（Gmail）、平台订单、登记台账 · 更新于 %s」（取 Gmail、亚马逊订单、Shopify 订单中最旧的同步）与两条注；指标 3 个；图表 每日工单量 + 售后成本按责任类型（卡头总额即售后成本）。右为管理员视角局部：没有售后成本卡，每日工单量不可点、没有「查看明细」。导出同步生成后直接下载，记入审计（K5）。' % report_updated(),
    'K20': '刘洋视角，第一阶段外壳：亚马逊 SP-API（订单同步与 SQS 状态、订单回补 %d 天已完成）、Shopify Admin API（回补 %d 天 · 未开通 read_all_orders）、Gmail（4 个邮箱，收件与「已发送」）、钉钉（同步延迟 · 最近同步 %s，超过 2 小时，只提醒管理员、不出全站横幅；通讯录每个整点全量对账一次、失败不重试，每次失败算一次：上次成功超过 2 小时为同步延迟，连续 3 次失败为连接异常，待办 05 · 10-06）；积加、易仓为灰色虚线卡「第二阶段接入」，没有同步时间与测试连接；不显示 17TRACK。店铺表没有覆盖项列，没有吸底保存栏。下方为卡头小样（已连接 · 同步延迟 · 连接异常 · 未连接 · 模拟数据）、店铺表状态列写法与钉钉卡第一阶段已连接时的说明行（没有钉钉内免登）；补充小样（待办 09，10-06 用户确认）：Gmail 卡同步延迟（每个延迟的邮箱一行，其余说明行照常）与连接异常（每个异常的邮箱一行原因与恢复指引、来信暂存、「重新检测」；第一阶段不发信、没有错误日志页）、钉钉卡连接异常（从没同步成功过写「通讯录尚未同步成功」）、几个邮箱同时异常（每个一行、次数为实际的连续失败次数，暂存说明只写一次，延迟行在后；协调者 10-06 决定），以及 Gmail、钉钉两张卡「测试连接」的结果浮层（测试连接不改状态，Gmail 测完立即同步一次）。卡片状态按各邮箱的同步记录：Gmail 卡取各邮箱中最差的状态、最近同步取各邮箱中最旧的一次。补充小样（待办 11、12，协调者 10-06 决定，套用 Gmail 已确认的写法、按店铺）：Shopify 与亚马逊卡同步延迟与连接异常、「测试连接」浮层、几个渠道同时异常时的横幅叠放（Gmail、亚马逊、Shopify）、连接异常与恢复的站内通知与 P27 写法；亚马逊卡另有「订单通知队列（SQS）」一行的四种写法（正常 · 积压 N / 积压 N 条 / 拉取失败 / 未连接），只影响这一行。补充小样（待办 13，协调者 10-06 决定）：订单回补行的四种写法（未开始 / 进行中 · 已回补 N 笔 / 已完成 / 未开通 read_all_orders），只汇总连接上的店铺、天数取最短的，卡片连接异常时不显示。' % (BS.AMZ_BACKFILL_DAYS, SHOPIFY_BACKFILL_DAYS, BS.DINGTALK_LATE_SYNC),
    'K21': '左侧 12 个意图（每项写发布版本，「未收到与异常」选中并标「草稿 v5 未发布」）；上方「发布版本 v4 · 09-08 周敏 · 草稿 v5（未发布）」与店铺下拉；中间四段说明，「何时给哪种方案」一段标「Forcome Direct 覆盖」；右栏结构化部分（只读，代码执行）与回归结果「v5 草稿：18 / 20 通过」，展开 1 条未通过样例（期望「先补发」，实际「先查件」）；「发布 v5」置灰，悬停「还有 2 条回归样例未通过，全部通过后才能发布」。每次发布记入审计，可查看历史版本与对比（D-21）。',
    'K22': '首次回复时限：亚马逊 24 小时（自然小时，平台考核，锁定只读）；Shopify 与邮件内部目标 24 小时（1–72 的整数小时）+ 店铺覆盖表（继承 / 覆盖值，示例 forcome.mx 覆盖为 12 小时，data.SLA_OVERRIDES）。工作时间：周一至周五 09:00–18:00（北京时间），不扣节假日，1 个工作日 = 9 个工作小时，算例「周五 16:00 起 4 个工作小时 → 下周一 11:00」（R-CL-01、R-CL-02）。修改进吸底保存栏，记审计。',
    'K23': '表格：标签 · 说明 · 近 30 天使用 · 状态 · 操作（data.TAG_LIBRARY 4 个）；「新增标签」右侧抽屉，名称不重复、说明必填，保存时校验；停用而不删除（已打在工单上的保留）；表下注「一张工单最多 5 个标签，坐席只能选用；报表可按标签筛选」。',
    'K24': '表格：模板 · 用途（进展回复 / 签名 / 通知）· 语言 · 渠道 · 适用店铺 · 更新（data.TEMPLATES）；编辑用右侧抽屉，正文支持变量（客户名、订单号、店铺名）；渠道含亚马逊时只允许纯文字，插入链接置灰并说明原因；进展回复模板不得含承诺、金额与具体时刻（R-SL-05），保存时检查，本例正文含「by Friday」报错。',
}


def build():
    V = lambda t, spec, f, trig: variant(t, spec, f, W, trigger=trig)
    VW = lambda t, spec, f, trig: variant(t, spec, f, WW, trigger=trig)
    body = col(
        grid(V('K1 文档解析', '上传中显示进度；解析中转圈；解析失败写明原因并可重试或删除；解析完成生成待审核条目。', k1(), '知识库负责人上传文档') +
             V('K2 待审核沉淀为空', '页签计数为 0，空状态说明沉淀从哪里来，并给出知识缺口入口。', k2(), '没有坐席提交的 FAQ 候选'), 2, 32) +
        grid(V('K3 报表加载中', '保留筛选与标题，指标与图表显示骨架；超过 10 秒转加载失败（设计规范第 9 节）。画面为报表页局部 1:1。', k3(), '打开报表或切换筛选，数据超过 300ms 未返回') +
             V('K4 报表无数据', '所选范围无数据时指标显示「—」，主区给出调整筛选与清除筛选。画面为报表页局部 1:1。', k4(), '筛选组合没有任何工单或售后单（AC-RP-03）'), 2, 32) +
        grid(V('K5 导出', SPEC['K5'], k5(), '报表、台账或审计日志点「导出」') +
             V('K6 设置保存', '修改后显示未保存计数与「保存修改」；成功浮层并记审计日志。断网时保留修改，黄色浮层说明「恢复后自动重试」，不要求用户手动重试；恢复后自动重试并用浮层提示结果（成功为中性灰「已自动重试并保存」，仍失败为红色并保留修改）。修改阈值需二次确认。', k6(), '在设置页修改后点「保存修改」；本例保存时网络断开，10:26 恢复'), 2, 32) +
        grid(V('K7 渠道断开', '全站顶部红色横幅（写法同 G4：「查看渠道状态」只对管理员显示，本图为管理员视角）；渠道卡转「连接异常」并写明原因与暂存情况，提供重新授权（Gmail 为服务账号，写恢复指引并「重新检测」）。第一阶段形态见 K20 补充小样。', k7(), 'Gmail、积加、SP-API 或 Shopify 连续 3 次失败，或授权失效') +
             V('K8 新增店铺抽屉与校验', SPEC['K8'], k8(), '管理员在 P18 点「新增店铺」或行尾「编辑」并保存'), 2, 32) +
        grid(V('K9 放开自动发送不可用', '两类禁用分开表达：暂不满足为黄色 + 进度（「采纳率 78% / 90%」「样本 38 / 50」），悬停写明差距，满足后开关自动可用（R-SD-02、AC-AI-11）；硬规则（含高风险动作、规则为转人工）为灰色 + 锁，不可放开。', k9(), '某意图近 30 天采纳率不高于 90% 或样本少于 50；或意图含高风险动作') +
             V('K10 停用成员', SPEC['K10'], k10(), '管理员在 P20 成员行「更多」中点「停用」'), 2, 32) +
        grid(V('K11 素材库', '网格卡片，每项图文版与纯文字版成对显示，标注适用渠道与近 30 天引用次数；纯文字版按各自素材写完整英文步骤（步数与图文版一致）；上传素材后两版一起维护。', k11(), '知识库负责人打开「素材库」页签') +
             V('K12 待审核沉淀', '左侧候选列表，右侧审核抽屉：来源工单、问题、答案、归入层与适用店铺；「通过」入库，「退回」原因必填（R-KB-03）。本例为未填原因点「退回」。', k12(), '坐席把已解决工单标记为 FAQ 候选'), 2, 32) +
        grid(V('K13 知识缺口', '按问题聚类（与 P16 摘要卡同一口径），每簇写明出现次数、站点与语言，展开为问题、来源工单、原因（三类）、最近时间；操作为「✦ AI 起草条目」（草稿进入待审核，人审后生效）、关联已有条目或标记无需处理（R-KB-04、AC-AI-10）。', k13(), '转人工、拒绝原因为知识错误、置信度低于 60% 时自动加入；本例为已点「✦ AI 起草条目」后的第一簇') +
             V('K14 素材库选择器', 'P02 点「插入图片」弹出：按工单意图推荐素材，只能单选素材库图片；卡片标题单行省略，悬停看全名；本机文件不能直接插入（R-CC、E-22）。', k14(), '邮件工单草稿点「插入图片」'), 2, 32) +
        grid(V('K15 处理规则 · 风险信号页签', SPEC['K15'], k15(), '客服主管在 P19 切到「风险信号」页签') +
             V('K16 处理规则 · 渠道内容能力页签', '两行渠道表：邮件可放素材库图片与白名单链接；亚马逊站内信只支持纯文字，插入按钮置灰并说明原因。下方为链接白名单（5 个域名，可删除），「添加域名」打开右侧抽屉（R-CC）。', k16(), '客服主管在 P19 切到「渠道内容能力」页签'), 2, 32) +
        VW('K17 团队与权限 · 角色权限页签', SPEC['K17'], k17(), '管理员在 P20 切到「角色权限」页签') +
        VW('K18 审计日志的可见范围', SPEC['K18'], k18(), '非客服主管、非管理员打开 P27；或无财务权限的角色查看售后单记录') +
        VW('K19 第一阶段报表', SPEC['K19'], k19(), '第一阶段打开 P17') +
        VW('K20 第一阶段渠道卡', SPEC['K20'], k20(), '第一阶段管理员打开 P18') +
        VW('K21 处理规则 · 处理说明页签', SPEC['K21'], k21(), '客服主管在 P19 切到「处理说明」') +
        grid(V('K22 SLA 与工作时间', SPEC['K22'], k22(), '客服主管打开设置「SLA」') +
             V('K23 标签库', SPEC['K23'], k23(), '客服主管打开设置「标签库」'), 2, 32) +
        VW('K24 模板', SPEC['K24'], k24(), '客服主管打开设置「模板」'),
        40)
    return board('知识库、报表、设置状态', '知识库上传与审核、素材库、沉淀审核、知识缺口、报表加载与导出、设置保存与校验、渠道断开、成员停用、设置页的非默认页签，'
                 '审计日志可见范围、第一阶段报表与渠道卡，以及客服主管的 SLA、标签库、模板设置页（K1–K24）。演示时刻 %s。' % NOW_LABEL, body, 1920, 4400)


if __name__ == '__main__':
    save('StatesAdmin.dc.html', build())
    print('ok')
