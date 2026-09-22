# -*- coding: utf-8 -*-
"""StatesAdmin · 知识库、报表、设置状态板 K1–K14。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
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
        up_item('V2 用户手册（德语）.pdf', '4.2 MB', row(nowrap('上传中 62%', 12, T['accent_ink'], 600) + icon('x', 14, T['ink4']), 8), progress(62)) +
        up_item('保修条款 2026.docx', '380 KB', row(spinner(14) + nowrap('解析中', 12, T['ink2'], 600), 6), muted('正在识别段落与表格，约 1 分钟。', 12)) +
        up_item('V2 故障图集.pdf', '12.6 MB', st('x_c', '解析失败', T['bad']),
                between(text('文件已加密，无法读取文字。请去除密码后重新上传。', 12, T['bad']), row(btn('重试', 'secondary', 'sm', 'refresh') + btn('删除', 'ghost', 'sm'), 6)), ic_color=T['bad']) +
        up_item('Q3 促销运费政策.pdf', '860 KB', st('check_c', '已解析', T['ok']),
                between(muted('生成 3 条待审核条目 · 政策规则 · 适用全部店铺', 12), link('去审核', 12, 'chev_r')), ic_color=T['ok']))
    return frame(card(drop + '<div style="display: flex; flex-direction: column;">%s</div>' % items, '上传文档', nowrap('知识库 · 赵倩', 12, T['ink3']), pad='14px 16px', gap=12))


# ---------------------------------------------------------------- K2 待审核沉淀为空
def k2():
    head = '<div style="background: #ffffff; border: 1px solid %s; border-radius: 8px; padding: 0px 16px; box-shadow: %s;">%s</div>' % (
        T['line'], SHADOW_XS, tabs([('条目', None), ('素材库', None), ('待审核沉淀', 0), ('知识缺口', 5)], '待审核沉淀'))
    box = card(empty('check_c', '没有待审核的沉淀', '坐席把已解决工单标记为 FAQ 候选后，会出现在这里等你审核。', row(btn('查看知识缺口 5', 'secondary') + btn('查看已入库沉淀', 'ghost'), 8)), pad='8px 24px')
    return frame(head + box)


# ---------------------------------------------------------------- K3 报表加载中 / K4 报表无数据
def report_page(kpis, main, filters):
    body = page_head('报表', '工单、SLA、AI 与售后成本 · 数据来源：工单系统、登记台账、亚马逊 SP-API、Shopify', btn('导出', 'secondary', 'md', 'download')) + \
        content(filters + kpis + main, '16px 24px', 14)
    return app('zhoumin', '报表', ['报表', '概览'], body)


def rep_filters(active=False):
    if active:
        return row(seg(['本周', '本月', '自定义'], '本周') + filter_chip('店铺', 'forcome.eu', True) + filter_chip('站点', '全部') + filter_chip('标签', '批发', True) +
                   link('清除筛选', 12), 8)
    return row(seg(['本周', '本月', '自定义'], '本周') + filter_chip('店铺', '全部') + filter_chip('站点', '全部') + filter_chip('标签') + row(spinner(14) + nowrap('正在加载 · 数据截至 10:15', 12, T['ink3']), 6), 8)


def k3():
    ks = grid(''.join(card(skel('45%', 10) + skel('60%', 24, 6) + skel('35%', 8), pad='14px 16px', gap=10) for _ in range(5)), 5, 12)
    ch_ = lambda: card(between(skel('120px', 12), skel('64px', 10)) + skel('100%', 200, 6), pad='14px 16px', gap=12)
    main = grid(ch_() + ch_() + ch_() + ch_(), 2, 14)
    return scaled(report_page(ks, main, rep_filters()), 1440, 900, 0.6)


def k4():
    ks = grid(''.join(kpi(k, '—', sub='所选范围无数据') for k in ['工单量', '首响中位数', 'SLA 达标率（亚马逊）', '草稿采纳率', '自动发送占比']), 5, 12)
    main = card(empty('chart', '所选范围没有数据', '本周 forcome.eu 没有带「批发」标签的工单。调整时间、店铺或标签后再看。',
                      row(btn('调整筛选', 'primary', 'md', 'filter') + btn('清除筛选', 'secondary'), 8)), pad='60px 24px', style='flex: 1;')
    return scaled(report_page(ks, main, rep_filters(True)), 1440, 900, 0.6)


# ---------------------------------------------------------------- K5 导出
def k5():
    prog = '<div style="width: 360px; box-sizing: border-box; display: flex; gap: 10px; align-items: flex-start; background: #ffffff; border: 1px solid %s; border-radius: 8px; padding: 12px 14px; box-shadow: %s;">%s<div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 6px;"><div style="font-size: 13px; font-weight: 700; color: %s;">正在生成报表</div><div style="font-size: 12px; color: %s;">本周 · 全部店铺 · 5 项指标与 4 张图表明细 · 40%%</div>%s</div></div>' % (
        T['line'], SHADOW_MD, spinner(18), T['ink'], T['ink3'], progress(40))
    left = col(cap('生成中') + row(seg(['本周', '本月', '自定义'], '本周') + btn('导出中', 'secondary', 'md', loading=True), 8) + prog, 12)
    done = toast('success', '报表已导出', '报表_本周_0905-0911.xlsx · 含明细与图表数据。文件保留 7 天。', row(link('下载', 12, 'download') + link('查看导出记录', 12), 12))
    right = col(cap('完成') + row(seg(['本周', '本月', '自定义'], '本周') + btn('导出', 'secondary', 'md', 'download'), 8) + done, 12)
    return frame(grid(left + right, 2, 24))


# ---------------------------------------------------------------- K6 设置保存
def k6():
    cols = [('意图', 'left'), ('发送方式', 'left'), ('置信度阈值', 'left'), ('30 天采纳率', 'right'), ('样本数', 'right'), ('放开条件', 'left'), ('自动发送', 'left')]
    r = [BS.intent_row(BS.INTENTS[0]), BS.intent_row(BS.INTENTS[1])]
    edited = BS.intent_row(BS.INTENTS[2])
    edited[2] = row(input_box('85%', st='focus', width='64px', h=28, mono=True) + chip('已修改', 'warning', 10), 6)
    r.append(edited)
    t = table(cols, r, '120px 76px 128px 72px 44px minmax(0, 1fr) 52px', dense=True, row_tones={2: 'warning'})
    bar = between(row(label('发送方式与阈值') + nowrap('产品咨询 置信度阈值 80% → 85%', 12, T['ink3']), 8),
                  row(nowrap('1 项未保存的修改', 12, T['warn'], 600) + btn('放弃修改', 'ghost', 'sm') + btn('保存修改', 'primary', 'sm'), 8))
    ok = toast('success', '设置已保存', '产品咨询置信度阈值 80% → 85%，已记入审计日志（周敏 10:24）。')
    bad = toast('error', '保存失败：网络不可用', '你的修改已保留在页面上，恢复连接后再点「保存修改」。', link('重试', 12, 'refresh'))
    return frame(cap('修改后') + bar + t + grid(col(cap('保存成功') + ok, 8) + col(cap('保存失败') + bad, 8), 2, 24))


# ---------------------------------------------------------------- K7 渠道断开
def k7():
    top = banner('danger', 'Gmail 连接中断：support@forcome.eu', '09-11 10:05 起连续 3 次失败，授权已失效。该邮箱来信暂存，回复进入待发队列；恢复后自动补拉，SLA 按原到达时间计算。',
                 btn('查看渠道状态', 'secondary', 'sm'))
    im = BS.ch_card('users', '钉钉', state('已连接'), ['通讯录同步 · 工作通知 · 登录'], '', 'ok')
    cards = '<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: stretch;">%s%s%s</div>' % (
        BS.amazon_card(), BS.gmail_card(err=True), im)
    return frame(top + cards)


# ---------------------------------------------------------------- K8 新增店铺校验
def k8():
    body = grid(field('平台', select_box('Shopify'), True) + field('站点', select_box('US'), True) +
                field('店铺名', input_box('forcome.com', st='error'), True, error='店铺名已存在，请换一个') +
                field('Shopify 店铺域名', input_box(None, '例如 forcome-uk.myshopify.com', 'error'), True, error='请填写店铺域名') +
                field('客服邮箱', input_box('support@forcome', st='error'), True, error='邮箱格式不正确，例如 support@forcome.com') +
                field('签名', input_box('Forcome Support'), hint='回复末尾使用，可在店铺覆盖项里修改'), 2, 14)
    dlg = dialog('新增店铺', body, btn('取消', 'secondary') + btn('保存店铺', 'primary'), 560, None, '保存后可在处理规则里设置该店铺的覆盖项。')
    return overlay(scaled(BS.p18(), 1440, 900, 0.6), dlg, W, 540)


# ---------------------------------------------------------------- K9 放开自动发送不可用
def k9():
    cols = [('意图', 'left'), ('发送方式', 'left'), ('置信度阈值', 'left'), ('30 天采纳率', 'right'), ('样本数', 'right'), ('放开条件', 'left'), ('自动发送', 'left')]
    rows = [BS.intent_row(BS.INTENTS[i]) for i in (2, 3, 4, 5)]
    t = table(cols, rows, '120px 76px 64px 72px 44px minmax(0, 1fr) 52px', dense=True, row_tones={2: 'warning'})
    arrow = '<div style="position: absolute; top: -4px; right: 30px; width: 10px; height: 10px; background: %s; transform: rotate(45deg);"></div>' % T['ink']
    tip = '<div style="position: absolute; right: 8px; top: 142px;">%s%s</div>' % (arrow, tooltip('不能切换为自动发送：近 30 天采纳率 78%，需高于 90%。满足条件后开关自动可用。'))
    return frame('<div style="position: relative; padding-bottom: 20px;">%s%s</div>' % (t, tip))


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
    return tabs([('条目', None), ('素材库', None), ('待审核沉淀', 3), ('知识缺口', 5)], active)


def asset_thumb(label_, w=120, h=76):
    return '<div style="width: %dpx; height: %dpx; flex-shrink: 0; border-radius: 6px; background: linear-gradient(135deg, %s, %s); border: 1px solid %s; display: flex; align-items: center; justify-content: center; font-size: 11px; color: %s;">%s</div>' % (
        w, h, T['line2'], T['subtle'], T['line'], T['ink3'], label_)


def k11():
    items = [('拆下并清洗 HEPA 滤芯', 'IMG-V2-014', 15, '4 步'), ('点烟器保险丝检查', 'IMG-V2-009', 11, '3 步'),
             ('集尘杯卡扣安装', 'IMG-V2-017', 8, '3 步'), ('软管接口重新安装', 'IMG-V2-021', 6, '2 步')]
    cells = ''
    for name, code, hits, steps in items:
        pic = '<div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 6px;">%s%s%s</div>' % (
            asset_thumb('图示 · ' + code, 152, 80), row(chip('图文版', 'accent', 10) + nowrap('邮件', 11, T['ink3']), 6), nowrap('%s · 已定稿' % steps, 11, T['ink4']))
        txt = '<div style="flex: 1; min-width: 0px; display: flex; flex-direction: column; gap: 6px;"><div style="height: 80px; box-sizing: border-box; border: 1px dashed %s; border-radius: 6px; padding: 8px 10px; font-size: 11px; line-height: 1.5; color: %s; overflow: hidden;">1. Twist the dust cup off…<br>2. Pull the filter straight out…<br>3. Rinse under cold water…</div>%s%s</div>' % (
            T['line_strong'], T['ink3'], row(chip('纯文字版', 'neutral', 10) + nowrap('亚马逊', 11, T['ink3']), 6), nowrap('与图文版同步更新', 11, T['ink4']))
        cells += card(between(nowrap(name, 13, T['ink'], 700), nowrap('近 30 天引用 %d 次' % hits, 11, T['ink3'])) + row(pic + txt, 10, 'flex-start'), pad='12px 14px', gap=10)
    head = between(kb_tabs('素材库'), row(search_box('搜索素材名称或编号', '200px') + btn('上传素材', 'primary', 'sm', 'upload'), 8))
    note = row(icon('info', 14, T['ink4']) + nowrap('同一内容成对保存：邮件用图文版，亚马逊站内信用纯文字版（R-CC）。草稿只能插入这里的图片。', 12, T['ink3']), 6)
    return frame(head + note + grid(cells, 2, 12), bg='#ffffff', pad='16px 20px')


# ---------------------------------------------------------------- K12 待审核沉淀 + 审核抽屉
def k12():
    cands = [('充电线不充电：先换插座、查保险丝，再换线测试', 'T-20260904-0098', '李婷 · 09-10', True),
             ('HEPA 滤芯多久更换一次', 'T-20260909-0131', '李婷 · 09-09', False),
             ('软管接口松脱的重新安装方法', 'T-20260908-0140', '陈晨 · 09-08', False)]
    lst = ''
    for q, src, who, on in cands:
        lst += '<div style="padding: 10px 12px; border-bottom: 1px solid %s; background: %s; %s display: flex; flex-direction: column; gap: 4px;">%s%s</div>' % (
            T['line2'], T['accent_bg'] if on else '#ffffff', 'box-shadow: inset 3px 0 0 %s;' % T['accent'] if on else '', text(q, 12.5, T['ink'], 600),
            row(nowrap(src, 11.5, T['accent'], 600) + nowrap(who, 11.5, T['ink3']), 8))
    left = '<div style="width: 300px; flex-shrink: 0; border: 1px solid %s; border-radius: 8px; overflow: hidden; background: #ffffff;">%s</div>' % (T['line'], lst)
    drawer = card(
        between(text('审核沉淀', 14, T['ink'], 700), icon('x', 16, T['ink3'])) +
        kv('来源工单', row(nowrap('T-20260904-0098', 12, T['accent'], 600) + state('已解决'), 6)) + kv('提交人', '李婷 · 09-10 09:05') +
        col(label('问题') + text('充电线插上没反应怎么办？', 13, T['ink']), 4) +
        col(label('答案（取自采纳的回复）') + text('先换一个 12V 插座并检查点烟器保险丝；仍不充电时换用其他 USB-C 线测试。其他线能充说明原装线故障，按保修寄新线。', 12.5, T['ink2']), 4) +
        grid(field('归入', select_box('沉淀问答')) + field('适用店铺', select_box('全部店铺')), 2, 10) +
        field('退回原因', textarea_box(None, '写明需要补充或修改的地方', 'error', 52, '0 / 200'), True, error='退回需要填写原因') +
        between(muted('通过后进入检索，负责人为赵倩，有效期默认 12 个月。', 11), row(btn('退回', 'danger_outline', 'sm') + btn('通过', 'primary', 'sm', 'check'), 6)),
        pad='14px 16px', gap=10)
    body = '<div style="display: flex; gap: 14px; align-items: flex-start;">%s<div style="flex: 1; min-width: 0px;">%s</div></div>' % (left, drawer)
    return frame(kb_tabs('待审核沉淀') + body, bg='#ffffff', pad='16px 20px')


# ---------------------------------------------------------------- K13 知识缺口
def k13():
    from common import mtable
    gaps = [('V2 是否兼容 Tesla Model Y 的 12V 插座', 'T-20260910-0176', '置信度低于 60%', 3, '09-10'),
            ('UK 站配件的插头与充电器规格', 'T-20260909-0131', '置信度低于 60%', 2, '09-09'),
            ('DE 站退货后退款的到账时间', 'T-20260909-0128', '拒绝原因：知识错误', 1, '09-09'),
            ('客户威胁差评时的退款口径', 'T-20260902-0071', '转人工', 1, '09-10'),
            ('批发 200 台的报价口径', 'T-20260909-0142', '转人工', 1, '09-09')]
    tone = {'置信度低于 60%': 'warning', '拒绝原因：知识错误': 'danger', '转人工': 'neutral'}
    rows = [[text(q, 12.5, T['ink'], 600), nowrap(src, 12, T['accent'], 600), chip(r, tone[r], 10), nowrap('%d 次' % n, 12, T['ink2']), nowrap(d, 12, T['ink3']),
             row(link('关联条目', 12) + link('无需处理', 12), 10)] for q, src, r, n, d in gaps]
    tbl = mtable([('问题', 'left'), ('来源工单', 'left'), ('原因', 'left'), ('次数', 'left'), ('最近', 'left'), ('操作', 'left')], rows,
                 'minmax(0, 1fr) 128px 128px 44px 48px 128px', py=9)
    note = row(icon('info', 14, T['ink4']) + nowrap('来源三类：转人工、拒绝原因为知识错误、置信度低于 60% 的草稿（R-KB-04）；每周处理一次。点工单号打开 P05。', 12, T['ink3']), 6)
    return frame(kb_tabs('知识缺口') + note + tbl, bg='#ffffff', pad='16px 20px')


# ---------------------------------------------------------------- K14 素材库选择器
def k14():
    import build_inbox
    picks = [('IMG-V2-014', '拆下并清洗 HEPA 滤芯', True), ('IMG-V2-017', '集尘杯卡扣安装', False), ('IMG-V2-021', '软管接口重新安装', False), ('IMG-V2-009', '点烟器保险丝检查', False)]
    cells = ''.join('<div style="border: 1.5px solid %s; background: %s; border-radius: 8px; padding: 6px; display: flex; flex-direction: column; gap: 5px;">%s%s%s</div>' % (
        T['accent'] if on else T['line'], T['accent_bg'] if on else '#ffffff', asset_thumb(code, 104, 62), nowrap(name, 11.5, T['ink'], 600), nowrap(code, 10.5, T['ink4'])) for code, name, on in picks)
    body = search_box('搜索素材', '100%') + row(nowrap('按本工单推荐', 12, T['ink3']) + cat('产品故障与使用问题') + cat('吸力下降'), 6) + grid(cells, 4, 8) + \
        row(icon('lock', 13, T['ink4']) + nowrap('只能插入素材库图片；需要新图请联系知识库负责人上传。', 12, T['ink3']), 6)
    dlg = dialog('插入图片', body, btn('取消', 'secondary') + btn('插入 IMG-V2-014', 'primary', 'md', 'image'), 520)
    return overlay(scaled(build_inbox.p02(), 1440, 900, 0.6), dlg, W, 540)


def build():
    V = lambda t, spec, f, trig: variant(t, spec, f, W, trigger=trig)
    body = col(
        grid(V('K1 文档解析', '上传中显示进度；解析中转圈；解析失败写明原因并可重试或删除；解析完成生成待审核条目。', k1(), '知识库负责人上传文档') +
             V('K2 待审核沉淀为空', '页签计数为 0，空状态说明沉淀从哪里来，并给出知识缺口入口。', k2(), '没有坐席提交的 FAQ 候选'), 2, 32) +
        grid(V('K3 报表加载中', '保留筛选与标题，指标与图表显示骨架；超过 10 秒转加载失败（G4）。', k3(), '打开报表或切换筛选，数据超过 300ms 未返回') +
             V('K4 报表无数据', '所选范围无数据时指标显示「—」，主区给出调整筛选与清除筛选。', k4(), '筛选组合没有任何工单或售后单（AC-RP-03）'), 2, 32) +
        grid(V('K5 导出', '生成中按钮进入处理中并显示进度；完成后成功浮层给出下载链接，文件保留 7 天。', k5(), '报表或台账点「导出」') +
             V('K6 设置保存', '修改后显示未保存计数与「保存修改」；成功浮层并记审计日志；失败保留修改、可重试。修改阈值需二次确认。', k6(), '在设置页修改后点「保存修改」'), 2, 32) +
        grid(V('K7 渠道断开', '全站顶部红色横幅（G4）；渠道卡转「连接异常」并写明原因与暂存情况，提供重新授权。', k7(), 'Gmail、SP-API、Shopify 或良仓接口连续 3 次失败，或授权失效') +
             V('K8 新增店铺校验', '店铺名唯一、店铺标识（亚马逊卖家 ID 或 Shopify 店铺域名）必填、邮箱格式正确；保存时校验全部，错误写明怎么改（AC-ST-01）。', k8(), '管理员在 P18 点「新增店铺」并保存'), 2, 32) +
        grid(V('K9 放开自动发送不可用', '条件不满足时开关禁用，悬停写明差距（R-SD-02、AC-AI-11）；满足后开关恢复可用。', k9(), '某意图近 30 天采纳率不高于 90% 或样本少于 50') +
             V('K10 停用成员', '手动停用需二次确认，有未关闭工单时必须先选接手人改派（AC-ST-02）；成员在钉钉离职后自动停用，其未关闭工单进入客服主管的改派队列（AC-ST-05）。', k10(), '管理员在 P20 成员行「更多」中点「停用」'), 2, 32) +
        grid(V('K11 素材库', '网格卡片，每项图文版与纯文字版成对显示，标注适用渠道与近 30 天引用次数；上传素材后两版一起维护。', k11(), '知识库负责人打开「素材库」页签') +
             V('K12 待审核沉淀', '左侧候选列表，右侧审核抽屉：来源工单、问题、答案、归入层与适用店铺；「通过」入库，「退回」原因必填（R-KB-03）。本例为未填原因点「退回」。', k12(), '坐席把已解决工单标记为 FAQ 候选'), 2, 32) +
        grid(V('K13 知识缺口', '列出问题、来源工单链接、原因（三类）、出现次数；操作为关联到条目或标记无需处理（R-KB-04、AC-AI-10）。', k13(), '转人工、拒绝原因为知识错误、置信度低于 60% 时自动加入') +
             V('K14 素材库选择器', 'P02 点「插入图片」弹出：按工单意图推荐素材，只能单选素材库图片；本机文件不能直接插入（R-CC、E-22）。', k14(), '邮件工单草稿点「插入图片」'), 2, 32),
        40)
    return board('知识库、报表、设置状态', '知识库上传与审核、素材库、沉淀审核、知识缺口、报表加载与导出、设置保存与校验、渠道断开、成员停用等状态（K1–K14）。演示时刻 %s。' % NOW_LABEL, body, 1920, 3206)


if __name__ == '__main__':
    save('StatesAdmin.dc.html', build())
    print('ok')
