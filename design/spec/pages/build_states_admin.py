# -*- coding: utf-8 -*-
"""StatesAdmin · 知识库、报表、设置状态板 K1–K14。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from ui import save_bar
from data import *
from as_common import *
import build_settings as BS

W = 864


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
    body = page_head('报表', '工单、SLA、AI 与售后成本 · 数据来源：工单系统、登记台账、积加（订单与物流）', btn('导出', 'secondary', 'md', 'download')) + \
        content(filters + kpis + main, '16px 24px', 14)
    return app('zhoumin', '报表', ['报表', '概览'], body)


def rep_filters(active=False):
    if active:
        return row(seg(['近 7 天', '本月', '自定义'], '近 7 天') + filter_chip('店铺', 'forcome.mx', True) + filter_chip('站点', '全部') + filter_chip('标签', '批发', True) +
                   link('清除筛选', 12), 8)
    return row(seg(['近 7 天', '本月', '自定义'], '近 7 天') + filter_chip('店铺', '全部') + filter_chip('站点', '全部') + filter_chip('标签') + row(spinner(14) + nowrap('正在加载 · 数据截至 10:15', 12, T['ink3']), 6), 8)


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
def k5():
    prog = '<div style="width: 360px; box-sizing: border-box; display: flex; gap: 10px; align-items: flex-start; background: #ffffff; border: 1px solid %s; border-radius: 8px; padding: 12px 14px; box-shadow: %s;">%s<div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 6px;"><div style="font-size: 13px; font-weight: 700; color: %s;">正在生成报表</div><div style="font-size: 12px; color: %s;">近 7 天 · 全部店铺 · 5 项指标与 4 张图表明细 · 40%%</div>%s</div></div>' % (
        T['line'], SHADOW_MD, spinner(18), T['ink'], T['ink3'], progress(40))
    left = col(cap('生成中') + row(seg(['近 7 天', '本月', '自定义'], '近 7 天') + btn('导出中', 'secondary', 'md', loading=True), 8) + prog, 12)
    done = toast('success', '报表已导出', '报表_近7天_0905-0911.xlsx · 含明细与图表数据。文件保留 7 天。', row(link('下载', 12, 'download') + link('查看导出记录', 12), 12))
    right = col(cap('完成') + row(seg(['近 7 天', '本月', '自定义'], '近 7 天') + btn('导出', 'secondary', 'md', 'download'), 8) + done, 12)
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
    top = banner('danger', 'Gmail 连接中断：support@forcome.mx', '10:05 起连续 3 次失败，授权已失效。该邮箱来信暂存，回复进入待发队列；恢复后自动补拉，SLA 按原到达时间计算。',
                 btn('查看渠道状态', 'secondary', 'sm'))
    im = BS.ch_card('users', '钉钉', state('已连接'), ['通讯录同步 · 工作通知 · 登录'], '', 'ok')
    cards = '<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: stretch;">%s%s%s</div>' % (
        BS.amazon_card(), BS.gmail_card(err=True), im)
    return frame(top + cards)


# ---------------------------------------------------------------- K8 新增店铺校验
K8_H = 700


def k8():
    """P18「新增店铺」右侧抽屉：保存时校验全部，错误写在字段下方。"""
    body = (banner('danger', '有 3 项需要修改', '改完后再点「保存店铺」。') +
            grid(field('平台', select_box('Shopify'), True) + field('站点', select_box('MX'), True), 2, 12) +
            field('店铺名', input_box('forcome.com', st='error'), True, error='店铺名已存在，请换一个') +
            field('Shopify 店铺域名', input_box(None, '例如 forcome-mx.myshopify.com', 'error'), True, error='请填写店铺域名') +
            field('客服邮箱', input_box('support@forcome', st='error'), True, error='邮箱格式不正确，例如 support@forcome.com') +
            field('签名', input_box('Forcome Support'), hint='回复末尾使用，可在店铺覆盖项里修改'))
    drw = BS.drawer('新增店铺', body, btn('取消', 'secondary') + btn('保存店铺', 'primary'), 420, '保存后可在店铺表「编辑」里维护覆盖项：签名、政策口径、模板、白名单、SLA 内部目标。')
    page_h = int(K8_H / 0.6)
    return BS.drawer_over(scaled(BS.p18(page_h), 1440, page_h, 0.6), drw, W, K8_H)


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
def k10():
    open_n = sum(1 for t in TICKETS if t['owner'] == '李婷' and t['status'] not in ('已解决', '已关闭', '已合并'))
    body = banner('warning', '李婷有 %d 张未关闭的工单，需先改派' % open_n, 'T-20260910-0192、T-20260910-0195、T-20260911-0031 等 %d 张。改派后才能停用。' % open_n) + \
        field('接手人', select_box('陈晨（坐席）'), True, hint='工单与编辑锁一并转给接手人，客户侧不会收到通知') + \
        muted('停用后李婷不能登录，历史记录、审批单与操作日志保留。', 12)
    dlg = dialog('停用成员李婷？', body, btn('取消', 'secondary') + btn('改派并停用', 'danger'), 480, 'warning')
    return overlay(scaled(BS.p20(), 1440, 900, 0.6), dlg, W, 540)

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


# ---------------------------------------------------------------- K15–K17 设置页的非默认页签
def k15():
    return frame(BS.rule_tabs('风险信号') + BS.p19_risk(), gap=14)


def k16():
    return frame(BS.rule_tabs('渠道内容能力') + BS.p19_content_cap(), gap=14)


def k17():
    return frame(BS.team_tabs('角色权限') + BS.perm_matrix(), w=W * 2 + 32, gap=14)


def build():
    V = lambda t, spec, f, trig: variant(t, spec, f, W, trigger=trig)
    body = col(
        grid(V('K1 文档解析', '上传中显示进度；解析中转圈；解析失败写明原因并可重试或删除；解析完成生成待审核条目。', k1(), '知识库负责人上传文档') +
             V('K2 待审核沉淀为空', '页签计数为 0，空状态说明沉淀从哪里来，并给出知识缺口入口。', k2(), '没有坐席提交的 FAQ 候选'), 2, 32) +
        grid(V('K3 报表加载中', '保留筛选与标题，指标与图表显示骨架；超过 10 秒转加载失败（设计规范第 9 节）。画面为报表页局部 1:1。', k3(), '打开报表或切换筛选，数据超过 300ms 未返回') +
             V('K4 报表无数据', '所选范围无数据时指标显示「—」，主区给出调整筛选与清除筛选。画面为报表页局部 1:1。', k4(), '筛选组合没有任何工单或售后单（AC-RP-03）'), 2, 32) +
        grid(V('K5 导出', '生成中按钮进入处理中并显示进度；完成后成功浮层给出下载链接，文件保留 7 天。', k5(), '报表或台账点「导出」') +
             V('K6 设置保存', '修改后显示未保存计数与「保存修改」；成功浮层并记审计日志。断网时保留修改，黄色浮层说明「恢复后自动重试」，不要求用户手动重试；恢复后自动重试并用浮层提示结果（成功为中性灰「已自动重试并保存」，仍失败为红色并保留修改）。修改阈值需二次确认。', k6(), '在设置页修改后点「保存修改」；本例保存时网络断开，10:26 恢复'), 2, 32) +
        grid(V('K7 渠道断开', '全站顶部红色横幅（G4）；渠道卡转「连接异常」并写明原因与暂存情况，提供重新授权。', k7(), 'Gmail、积加、SP-API 或 Shopify 连续 3 次失败，或授权失效') +
             V('K8 新增店铺校验', '右侧抽屉（页面保持可见）。店铺名唯一、店铺标识（亚马逊卖家 ID 或 Shopify 店铺域名）必填、邮箱格式正确；保存时校验全部，顶部汇总错误数，字段下写明怎么改（AC-ST-01）。编辑店铺用同一抽屉。', k8(), '管理员在 P18 点「新增店铺」并保存'), 2, 32) +
        grid(V('K9 放开自动发送不可用', '两类禁用分开表达：暂不满足为黄色 + 进度（「采纳率 78% / 90%」「样本 38 / 50」），悬停写明差距，满足后开关自动可用（R-SD-02、AC-AI-11）；硬规则（含高风险动作、规则为转人工）为灰色 + 锁，不可放开。', k9(), '某意图近 30 天采纳率不高于 90% 或样本少于 50；或意图含高风险动作') +
             V('K10 停用成员', '手动停用需二次确认，有未关闭工单时必须先选接手人改派（AC-ST-02）；成员在钉钉离职后自动停用，其未关闭工单进入客服主管的改派队列（AC-ST-05）。', k10(), '管理员在 P20 成员行「更多」中点「停用」'), 2, 32) +
        grid(V('K11 素材库', '网格卡片，每项图文版与纯文字版成对显示，标注适用渠道与近 30 天引用次数；纯文字版按各自素材写完整英文步骤（步数与图文版一致）；上传素材后两版一起维护。', k11(), '知识库负责人打开「素材库」页签') +
             V('K12 待审核沉淀', '左侧候选列表，右侧审核抽屉：来源工单、问题、答案、归入层与适用店铺；「通过」入库，「退回」原因必填（R-KB-03）。本例为未填原因点「退回」。', k12(), '坐席把已解决工单标记为 FAQ 候选'), 2, 32) +
        grid(V('K13 知识缺口', '按问题聚类（与 P16 摘要卡同一口径），每簇写明出现次数、站点与语言，展开为问题、来源工单、原因（三类）、最近时间；操作为「✦ AI 起草条目」（草稿进入待审核，人审后生效）、关联已有条目或标记无需处理（R-KB-04、AC-AI-10）。', k13(), '转人工、拒绝原因为知识错误、置信度低于 60% 时自动加入；本例为已点「✦ AI 起草条目」后的第一簇') +
             V('K14 素材库选择器', 'P02 点「插入图片」弹出：按工单意图推荐素材，只能单选素材库图片；卡片标题单行省略，悬停看全名；本机文件不能直接插入（R-CC、E-22）。', k14(), '邮件工单草稿点「插入图片」'), 2, 32) +
        grid(V('K15 处理规则 · 风险信号页签', '6 条风险信号，命中即转人工。安全事故、平台风险为硬规则：开关锁定并写「硬规则，不可关闭」。重复联系、高价值关闭需二次确认，行内写明影响（近 30 天约少转人工的封数，取 data.RISK_OFF_IMPACT）；修改进入吸底保存栏。', k15(), '客服主管在 P19 切到「风险信号」页签') +
             V('K16 处理规则 · 渠道内容能力页签', '两行渠道表：邮件可放素材库图片与白名单链接；亚马逊站内信只支持纯文字，插入按钮置灰并说明原因。下方为链接白名单（5 个域名，可删除），「添加域名」打开右侧抽屉（R-CC）。', k16(), '客服主管在 P19 切到「渠道内容能力」页签'), 2, 32) +
        variant('K17 团队与权限 · 角色权限页签', '权限矩阵一张表全部展开（不折叠），按 工单 / 审批 / 售后 / 知识 / 报表 / 设置 / 工厂 分组；● 有权限、○ 只能看自己发起或负责的、「—」无权限、文字为部分能力。只读，按角色固定（prd_d 10.1）。', k17(), W * 2 + 32, trigger='管理员在 P20 切到「角色权限」页签'),
        40)
    return board('知识库、报表、设置状态', '知识库上传与审核、素材库、沉淀审核、知识缺口、报表加载与导出、设置保存与校验、渠道断开、成员停用，以及设置页的非默认页签（K1–K17）。演示时刻 %s。' % NOW_LABEL, body, 1920, 4400)


if __name__ == '__main__':
    save('StatesAdmin.dc.html', build())
    print('ok')
