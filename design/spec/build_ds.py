# -*- coding: utf-8 -*-
"""生成 DesignSystem.dc.html（设计规范）与 GlobalStates.dc.html（全局状态与反馈）。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *


def sec(title, desc, body):
    return card(col('<div style="font-size: 16px; font-weight: 700; color: %s;">%s</div><div style="font-size: 13px; color: %s; line-height: 1.55;">%s</div>' % (T['ink'], title, T['ink3'], desc), 4) + body, pad='20px 24px', gap=16)


def sw(name, hexv, use, dark=False):
    return col('<div style="height: 44px; border-radius: 6px; background: %s; border: 1px solid %s;"></div><div style="font-size: 12px; font-weight: 700; color: %s;">%s</div><div style="font-size: 11px; color: %s; font-variant-numeric: tabular-nums;">%s</div><div style="font-size: 11px; color: %s; line-height: 1.4;">%s</div>' % (hexv, T['line'], T['ink'], name, T['ink3'], hexv, T['ink4'], use), 3)


colors = grid(''.join([
    sw('画布', T['canvas'], '页面底色'), sw('表面', T['surface'], '卡片、栏、表格'), sw('浅底', T['subtle'], '表头、次级区'),
    sw('分隔线', T['line'], '卡片边框、栏分隔'), sw('描边', T['line_strong'], '输入框、次按钮'), sw('导航栏', T['rail'], '左侧导航底色'),
    sw('主文字', T['ink'], '标题、正文'), sw('次文字', T['ink2'], '按钮文字、表格次要'), sw('辅助文字', T['ink3'], '说明、元信息'), sw('弱文字', T['ink4'], '占位、禁用'),
    sw('强调', T['accent'], '主按钮、选中、链接'), sw('强调底', T['accent_bg'], '选中行、强调标签底'),
]), 6, 12) + grid(''.join([
    sw('成功', T['ok'], '已完成、已批准、通过'), sw('警示', T['warn'], '待处理、待审批、临近超时'), sw('危险', T['bad'], '转人工、驳回、失败、超时'),
    sw('流程', T['flow'], '工厂相关的执行记录'), sw('信息', T['info'], '中性提示横幅'), sw('渠道色', T['amazon'] , '亚马逊橙、Shopify 绿：渠道圆点与按渠道拆分的图表'),
]), 6, 12)

type_scale = col(''.join(
    '<div style="display: flex; align-items: baseline; gap: 20px; border-bottom: 1px solid %s; padding-bottom: 8px;"><div style="width: 150px; font-size: 12px; color: %s;">%s</div><div style="font-size: %dpx; font-weight: %d; color: %s;">%s</div></div>' % (T['line2'], T['ink3'], a, s, w, T['ink'], t)
    for a, s, w, t in [
        ('24 / 700 · 指标数字', 24, 700, '$129.94  96.4%'),
        ('20 / 700 · 页面标题', 20, 700, '售后单'),
        ('18 / 700 · 详情标题', 18, 700, 'HEPA 滤芯组件补发 · Laura Bennett'),
        ('16 / 700 · 弹窗与区块标题', 16, 700, '驳回报备'),
        ('14 / 600 · 强调正文', 14, 600, '批准并通知生产厂寄出'),
        ('13 / 400 · 正文、表格', 13, 400, 'UPS 自 09-05 无扫描且已超预计送达。'),
        ('12 / 400 · 元信息、表单标签', 12, 400, '经积加同步 · 09-10 16:00'),
        ('11 / 700 · 区块小标题、标签', 11, 700, '登记信息'),
    ]), 8) + muted('字体：Manrope（拉丁字母与数字）+ Noto Sans SC（中文），导出时回退到 PingFang SC / 微软雅黑。数字一律等宽（tabular-nums），金额、时间、单号对齐。', 12)

spacing = grid(
    card(label('间距（4 的倍数）') + row(''.join('<div style="display: flex; flex-direction: column; align-items: center; gap: 4px;"><div style="width: %dpx; height: %dpx; background: %s; border-radius: 2px;"></div><div style="font-size: 11px; color: %s;">%d</div></div>' % (s, s, T['accent_line'], T['ink3'], s) for s in (4, 8, 12, 16, 20, 24, 32)), 14, 'flex-end'), pad='14px 16px') +
    card(label('圆角') + row(''.join('<div style="display: flex; flex-direction: column; align-items: center; gap: 4px;"><div style="width: 44px; height: 32px; border: 1.5px solid %s; border-radius: %dpx;"></div><div style="font-size: 11px; color: %s;">%s</div></div>' % (T['ink3'], r, T['ink3'], n) for r, n in ((4, '4 标签'), (6, '6 按钮输入'), (8, '8 卡片'), (10, '10 弹窗'), (999, '999 胶囊'))), 14, 'flex-end'), pad='14px 16px') +
    card(label('阴影') + row(''.join('<div style="display: flex; flex-direction: column; align-items: center; gap: 6px;"><div style="width: 60px; height: 36px; background: #ffffff; border-radius: 8px; box-shadow: %s;"></div><div style="font-size: 11px; color: %s;">%s</div></div>' % (s, T['ink3'], n) for s, n in ((SHADOW_XS, 'xs 卡片按钮'), (SHADOW_MD, 'md 浮层提示菜单'), (SHADOW_LG, 'lg 弹窗'))), 20, 'flex-end'), pad='14px 16px') +
    card(label('控件高度') + col(row(btn('28 小', 'secondary', 'sm') + btn('32 默认', 'secondary') + btn('36 表单主按钮', 'primary', 'lg'), 8) + muted('同一行内的按钮、输入框、筛选器高度一致。', 12), 8), pad='14px 16px'),
    4, 12)

buttons = col(
    grid(''.join(col(label(n) + row(btn(n2, k) + btn(n2, k, disabled=True) + btn('处理中', k, loading=True), 8, wrap=True), 6) for n, n2, k in [
        ('主操作 primary · 每个区域最多一个', '批准', 'primary'), ('次操作 secondary', '驳回', 'secondary'), ('危险 danger · 不可撤销', '终止流程', 'danger'),
        ('危险描边 danger_outline', '驳回报备', 'danger_outline'), ('强调描边 accent_outline', '修改后发送', 'accent_outline'), ('幽灵 ghost / 链接 link', '取消', 'ghost')]), 3, 16) +
    row(btn('带图标', 'secondary', 'md', 'refresh') + btn('提交审批', 'primary', 'md', icon_right='arrow_r') + btn('小按钮', 'secondary', 'sm', 'plus') + btn('大按钮', 'primary', 'lg') + icon_btn('more', 'secondary') + icon_btn('bell', badge=True) + link('查看全部', 12, 'chev_r'), 10) +
    muted('文案用动词短语，说清结果：「批准并通知生产厂寄出」而不是「确定」。禁用按钮必须在旁边或悬停提示里说明原因。点击后进入「处理中」并防止重复提交；成功后按钮恢复并弹出成功提示。', 12), 14)

forms = grid(''.join([
    field('默认', input_box(None, '请输入快递单号')),
    field('聚焦', input_box('1Z4R2883', st='focus')),
    field('错误', input_box('abc', st='error'), error='快递单号只能包含字母和数字，长度 10–30 位'),
    field('禁用', input_box('良仓 US', st='disabled'), hint='由系统根据库存自动选择'),
    field('必填 + 前后缀', input_box('11.50', prefix='$', suffix='USD', mono=True), required=True),
    field('下拉选择', select_box('产品质量问题')),
    field('下拉 · 错误', select_box(None, '请选择责任类型', 'error'), required=True, error='请选择责任类型'),
    field('多行文本 · 计数', textarea_box('驳回原因：运费高于同线路均价 30%，请生产厂改走云途普货。', st='focus', h=72, counter='38 / 200')),
]), 4, 16) + grid(''.join([
    col(label('单选 / 复选 / 开关') + row(radio('接受', True) + radio('还价') + radio('拒绝', disabled=True), 16) + row(checkbox('同时发起比例协商', True) + checkbox('短信提醒', False) + checkbox('不可选', False, True), 16) + row(toggle(True, '自动发送') + toggle(False, '待审草稿'), 16), 10),
    col(label('选项卡片（单选的富选项）') + row(radio_card('寄配件', '充电线 FC-V2-CB01 ×1', True, 'AI 建议') + radio_card('调整安装方式', '继续指导，不寄东西'), 8, 'stretch'), 8),
    col(label('分段 / 选项卡 / 筛选 / 搜索') + seg(['待审草稿 3', '转人工 1', '待审批 2', '全部 11'], '待审草稿 3') + tabs([('售后单', 13), ('登记台账', None), ('待协商', 1), ('内部结算', None)], '售后单') + row(filter_chip('状态', '全部') + filter_chip('店铺', 'Forcome Direct', True) + filter_chip('责任'), 6) + search_box('搜索售后单号、客户', '100%'), 10),
]), 3, 24, extra='margin-top: 8px;') + muted('校验时机：失焦时校验单个字段，提交时校验全部并滚动到第一个错误。错误文案写「哪里错 + 怎么改」。必填用红色星号；只读值用浅底，不用禁用灰。', 12)

state_groups = [
    ('工单状态', ['分诊中', '待审草稿', '待审批', '转人工', '等客户', '等内部', '等外部', '已解决', '已关闭', '已合并']),
    ('售后单状态', ['待确认', '进行中', '已完成', '已取消']),
    ('审批单状态', ['待审批', '执行中', '已执行', '执行失败', '已驳回', '已撤回']),
    ('审批项状态（报备项、动作项）', ['待审批', '已批准', '已驳回', '已作废']),
    ('标记（叠加在状态上，不是状态）', ['已超时', 'AI 未处理', '执行失败']),
    ('人工操作清单', ['待执行', '已回填']),
    ('比例协商', ['不适用', '未发起', '待工厂答复', '工厂还价', '待升级', '已确认']),
    ('内部结算', ['不适用', '未定', '待结算', '已结算']),
    ('工厂任务', ['待处理', '已提交', '已退回', '已完成', '已取消']),
    ('AI 草稿', ['生成中', '待审', '已采纳', '已拒绝', '已失效']),
    ('渠道连接', ['已连接', '同步延迟', '连接异常', '未连接']),
]
states = grid(''.join(col(label(n) + row(''.join(state(s) for s in ss), 6, wrap=True), 8) for n, ss in state_groups), 3, 18) + grid(''.join([
    col(label('渠道与店铺（分类值，中性底色 + 平台圆点）') + row(channel('亚马逊', 'US', 'Forcome Direct') + channel('Shopify', 'US', 'forcome.com') + channel('邮件'), 6, wrap=True), 8),
    col(label('分类值（意图、处理方式、责任）') + row(cat('未收到与异常') + cat('寄配件') + cat('产品质量问题'), 6, wrap=True), 8),
    col(label('SLA 剩余（≤2h 危险，≤6h 警示）') + row(sla('0h 55m', 'danger') + sla('5h 40m', 'warning') + sla('11h 10m') + sla('已回复', 'none'), 6, wrap=True), 8),
    col(label('优先级 / 情绪 / 标签 / 计数') + row(priority('紧急') + priority('高') + priority('普通') + sentiment('负面') + sentiment('中性') + sentiment('正面') + pill('路途急') + badge_count(12), 8, wrap=True), 8),
]), 2, 18) + muted('规则：状态一律带圆点并用语义色；分类值一律中性灰。同一个状态在所有页面颜色相同，映射表在组件库 STATE_TONE。', 12)

feedback = grid(''.join([
    col(label('页内横幅') + banner('info', '工单已合并到 T-20260902-0071', '原工单只读，新来信会进入主工单。') + banner('success', '已批准，发货单创建成功', '回复已自动发出，SLA 计时停止。') + banner('warning', 'SLA 剩 55 分钟，审批时限 4 小时', '承诺类回复要等审批后才能发出。建议先发一条不含承诺的进展回复。', btn('插入进展回复', 'secondary', 'sm')) + banner('danger', '积加连接中断，亚马逊来信暂存队列', '09-11 10:05 起未同步。恢复后按到达顺序处理，SLA 从原到达时间计算。', btn('查看状态', 'secondary', 'sm')), 10),
    col(label('浮层提示（右上角，成功 3 秒消失，失败需手动关闭）') + toast('success', '已提交审批', '周敏会在 4 小时内处理，结果会通知你。') + toast('error', '发送失败：积加接口超时', '草稿已保留，系统将在 1 分钟后自动重试。', row(link('立即重试') + link('复制草稿'), 12)) + toast('info', '陈晨正在处理这张工单', '你可以查看，但不能同时编辑回复。') + toast('warning', '草稿已失效', '客户在你编辑期间又来了一封信，请先阅读新消息。'), 10),
    col(label('确认弹窗 / 驳回弹窗') + dialog('驳回这张审批单？', field('驳回原因', textarea_box(None, '写清楚为什么驳回、发起人要怎么改', 'error', 64, '0 / 200'), True, error='请填写驳回原因') + checkbox('同时退回售后单到「待确认」', True), btn('取消', 'secondary') + btn('驳回', 'danger'), 420, 'danger', '驳回后发起人会收到通知，绑定的回复不会发出。'), 10),
    col(label('提示气泡 / 下拉菜单') + tooltip('禁用原因：这张工单由陈晨处理中。你可以在工单详情里申请接手。') + menu([('改派', 'handoff', None), ('合并到其他工单', 'merge', None), ('添加标签', 'tag', None), '-', ('关闭工单', 'x_c', 'danger')], 220), 10),
]), 4, 20)

data_disp = grid(''.join([
    col(label('表格（表头浅底，行高 40，选中行左侧强调条）') + table([('售后单号', 'left'), ('客户', 'left'), ('状态', 'left'), ('费用', 'right')], [
        ['S-20260911-0018', 'Laura Bennett', state('进行中'), '$14.70'],
        ['S-20260910-0017', 'Marcus Lee', state('已完成'), '$10.90'],
        ['S-20260911-0022', 'Ethan Brooks', state('待确认'), '$7.30'],
    ], '140px minmax(0, 1fr) 100px 80px', sel=0, footer=['合计', '3 单', '', '$32.90']), 8),
    col(label('键值 / 指标') + card(kv('产品成本', '$3.20') + kv('运费', '$11.50') + kv('承担比例', 'FSH 0 / 工厂 100', 'accent') + kv('协商状态', '未发起', 'muted'), pad='12px 14px', gap=6) + grid(kpi('工厂应承担 · 9 月', '$129.94', sub='含比例未定 $87.49') + kpi('SLA 达标率', '96.4%', '-1.2%', 'danger'), 2, 10), 8),
    col(label('步骤条') + card(stepper([('确认', '08:20', 'done'), ('询价', '08:21', 'done'), ('报价', '09:40', 'done'), ('报备', '等周敏', 'current'), ('寄出', '', 'todo')]), pad='14px 12px') + label('执行记录') + card(log_item('09-11 09:40', '工厂', '陈工在工厂工作台提交报价 $14.70。') + log_item('09-11 09:41', '人工', '报备待审批 · 快递费用 $11.50。'), pad='12px 14px', gap=8), 8),
]), 3, 20)

loading = grid(''.join([
    col(label('空状态') + card(empty('inbox', '收件箱已清空', '没有待你处理的工单。新来信会自动出现在这里。', btn('查看全部工单', 'secondary')), pad='0px'), 8),
    col(label('无权限') + card(no_permission('没有访问权限', '「设置」只对客服主管和管理员开放。如需开通，请联系管理员刘洋。'), pad='0px'), 8),
    col(label('加载失败') + card(load_error('报表加载失败', '积加数据接口超时。已显示的数据截止 09-11 09:30。'), pad='0px'), 8),
    col(label('骨架屏（首屏加载 > 300ms 时显示）') + card(skel_rows(4, True), pad='0px') + row(spinner() + muted('局部加载用行内转圈，不遮挡整页'), 8) + progress(62) , 8),
]), 4, 20)

copy_rules = table([('场景', 'left'), ('写法', 'left'), ('示例', 'left')], [
    ['按钮', '动词 + 对象，说清结果', '批准并通知生产厂寄出 / 提交审批 / 录入最终比例'],
    ['状态', '名词短语，与状态机名称完全一致', '待审草稿、待审批、等内部'],
    ['时间', '当天只写时分；其他写 月-日 时:分；跨年写年', '10:20 · 09-10 16:00 · 2025-12-30'],
    ['时长', '小时与分钟，SLA 精确到分钟', '5h 40m · 剩 2 个工作日'],
    ['金额', '币种符号 + 两位小数；欧元订单同时显示折算', '$14.70 · €44.90（≈ $49.39）'],
    ['单号', '固定前缀：T 工单、S 售后单、AP 审批单', 'T-20260910-0192 · S-20260911-0018 · AP-20260911-001'],
    ['错误', '发生了什么 + 怎么处理，不道歉、不含糊', '发送失败：积加接口超时。草稿已保留，1 分钟后自动重试。'],
    ['空状态', '说明为什么空 + 下一步', '没有待你处理的工单。新来信会自动出现在这里。'],
], '120px 320px minmax(0, 1fr)', dense=True)

shell_note = grid(''.join([
    card(label('页面外壳') + text('左侧 64px 深色导航栏：图标 + 两字标签，当前项靛蓝底，待办数用红色角标。导航项按角色显示，没有权限的入口不出现；直接访问链接显示无权限状态。', 13) + text('顶部 48px 工具条：面包屑、店铺范围选择（按授权店铺过滤全站数据）、全局搜索（Ctrl K）、通知。', 13) + text('内容区：列表页用「标题区 + 筛选行 + 表格」；详情页用「标题区 + 左主右辅两栏（右栏 360–400px）」；收件箱用三栏（列表 320 / 会话 / 上下文 340）。', 13), pad='16px 18px'),
    card(label('交互通则') + text('1. 所有写操作点击后立即进入「处理中」，防重复提交；成功给浮层提示，失败给可重试的提示并保留输入。', 13) + text('2. 不可撤销的操作（驳回、终止流程、关闭工单、执行退款）必须二次确认，驳回与终止必须填原因。', 13) + text('3. 同一工单同一时间只允许一人编辑回复，其他人只读并看到「谁在处理」。', 13) + text('4. 列表默认排序写在列表上方；筛选条件在地址栏保留，刷新后不丢。', 13), pad='16px 18px'),
]), 2, 16)

body = col(''.join([
    sec('1 色彩', '中性色表达层级，靛蓝只用于主操作与选中；绿、黄、红、紫只表达状态，不做装饰。', colors),
    sec('2 字体与字号', '8 级字号，正文 13px。', type_scale),
    sec('3 间距、圆角、阴影、控件高度', '所有尺寸取自下列刻度。', spacing),
    sec('4 按钮', '每种按钮都有默认、禁用、处理中三态。', buttons),
    sec('5 表单控件', '标签在上、控件在中、说明或错误在下。', forms),
    sec('6 状态与分类标识', '全站状态颜色唯一映射。', states),
    sec('7 反馈', '横幅用于持续存在的情况，浮层提示用于一次性结果，弹窗用于需要确认或填写原因的操作。', feedback),
    sec('8 数据展示', '表格、键值、指标、步骤条、执行记录。', data_disp),
    sec('9 空、无权限、失败、加载', '每个列表和面板都要设计这四种情况。', loading),
    sec('10 外壳与交互通则', '所有页面共用。', shell_note),
    sec('11 文案规范', '同一概念全站同一个词，术语以 PRD 第 1.4 节术语表为准。', copy_rules),
]), 20)
save('DesignSystem.dc.html', board('设计规范', '视觉方向 A「精密工作台」。本板定义色彩、字体、间距、组件与状态，所有高保真页面只使用这里的组件；代码实现时以组件库 spec/ui.py 为准。', body, 1920, 2400))

# ---------------------------------------------------------------- 全局状态
from data import NOW_LABEL
page_skel = app('liting', '收件箱', ['收件箱', '待处理'], '<div style="flex: 1; display: flex; min-height: 0px;"><div style="width: 320px; background: #ffffff; border-right: 1px solid %s;">%s</div><div style="flex: 1; padding: 20px 24px; display: flex; flex-direction: column; gap: 12px;">%s%s%s%s</div><div style="width: 340px; background: #ffffff; border-left: 1px solid %s; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px;">%s%s%s%s</div></div>' % (
    T['line'], skel_rows(8), skel('50%', 16), skel('100%', 90, 8), skel('100%', 200, 8), skel('40%', 32, 6), T['line'], skel('40%', 10), skel('80%', 10), skel('100%', 120, 8), skel('100%', 80, 8)), w=1440, h=900)
page_403 = app('liting', '', ['设置'], '<div style="flex: 1; display: flex; align-items: center; justify-content: center;">%s</div>' % card(no_permission('没有访问权限', '「设置」只对客服主管和管理员开放。你当前的角色是坐席。如需开通，请联系管理员刘洋。', row(btn('返回收件箱', 'primary', 'md', 'chev_l') + btn('申请权限', 'secondary'), 8)), pad='8px 24px'))
page_404 = app('liting', '工单', ['工单', 'T-20260801-9999'], '<div style="flex: 1; display: flex; align-items: center; justify-content: center;">%s</div>' % card(empty('search', '找不到这张工单', '工单 T-20260801-9999 不存在，或已按数据保留策略清除。', row(btn('返回工单列表', 'primary') + btn('按订单号搜索', 'secondary', 'md', 'search'), 8)), pad='8px 24px'))
page_offline = app('liting', '收件箱', ['收件箱', '待处理'], '<div style="flex: 1; display: flex; align-items: center; justify-content: center;">%s</div>' % card(load_error('网络连接已断开', '你刚才编辑的回复已保存在本机。恢复连接后会自动同步，不需要重新输入。', row(btn('重新连接', 'primary', 'md', 'refresh'), 8)), pad='8px 24px'),
                   banner_html=banner('danger', '积加连接中断，亚马逊来信暂存队列', '09-11 10:05 起未同步。恢复后按到达顺序处理，SLA 从原到达时间计算。管理员已收到通知。', btn('查看渠道状态', 'secondary', 'sm')))


def scaled(inner, w=1440, h=900, s=0.5):
    return '<div style="width: %dpx; height: %dpx; overflow: hidden; position: relative;"><div style="position: absolute; left: 0px; top: 0px; width: %dpx; height: %dpx; transform: scale(%s); transform-origin: 0px 0px;">%s</div></div>' % (int(w * s), int(h * s), w, h, s, inner)


toasts_frame = mini(col(toast('success', '已提交审批', '周敏会在 4 小时内处理，结果会通知你。') + toast('error', '保存失败：网络不可用', '你的修改已保存在本机，恢复后自动同步。', link('立即重试')) + toast('info', '有 3 封新来信', '已按 SLA 剩余时间插入收件箱。', link('查看')), 10, 'align-items: flex-end;'), 700, 330, pad='20px')
confirm_frame = mini('<div style="flex: 1; display: flex; align-items: center; justify-content: center; background: rgba(16,24,40,0.45);">%s</div>' % dialog('关闭这张工单？', muted('关闭后 SLA 停止计时；同一订单 30 天内客户再来信会自动重新打开。', 13) + field('关闭原因', select_box('问题已解决'), True), btn('取消', 'secondary') + btn('关闭工单', 'primary'), 440), 700, 330)
conflict_frame = mini(col(banner('info', '陈晨正在处理这张工单', '09-11 10:12 开始编辑回复。你可以查看会话和上下文，回复框只读。', row(btn('申请接手', 'secondary', 'sm') + btn('刷新', 'ghost', 'sm', 'refresh'), 6)) + banner('warning', '这张工单在你编辑期间收到新来信', '09-11 10:18 Jonas Weber 又发来 1 封。你的草稿已保留，请阅读新消息后再发送。', btn('查看新消息', 'secondary', 'sm')) + banner('danger', '你没有这个店铺的权限', '工单属于店铺 forcome.eu，你的数据范围是 Forcome Direct、forcome.com。', btn('联系主管', 'secondary', 'sm')), 10), 700, 330, pad='20px')
unsaved_frame = mini('<div style="flex: 1; display: flex; align-items: center; justify-content: center; background: rgba(16,24,40,0.45);">%s</div>' % dialog('离开前保存修改？', muted('回复草稿有未发送的修改。离开后草稿会保留 7 天，下次打开这张工单时恢复。', 13), btn('继续编辑', 'secondary') + btn('保留草稿并离开', 'primary'), 440, 'warning'), 700, 330)

gs_body = col(
    grid(variant('G1 整页加载', '首屏数据超过 300ms 未返回时显示骨架屏，保留外壳与导航；超过 10 秒转为 G4 加载失败。', scaled(page_skel)) +
         variant('G2 无权限（403）', '导航里不显示无权限入口；从链接直接进入时显示本页。按钮回到该角色的默认首页。', scaled(page_403)), 2, 32) +
    grid(variant('G3 找不到（404）', '单号不存在或已按保留策略清除。提供按订单号搜索的出口。', scaled(page_404)) +
         variant('G4 网络断开 + 集成中断', '浏览器断网：整页提示，未发送的草稿保存在本机。积加或 Gmail 中断：全站顶部红色横幅，仅管理员可关闭。', scaled(page_offline)), 2, 32) +
    grid(variant('G5 浮层提示', '右上角堆叠，最多 3 条。成功与信息 3 秒消失；失败与警示不自动消失，必须给出重试或下一步。', toasts_frame, 700) +
         variant('G6 二次确认', '关闭工单、驳回、终止流程、执行退款前确认；带原因的操作原因必填。', confirm_frame, 700), 2, 32) +
    grid(variant('G7 并发与数据范围', '同一工单只允许一人编辑回复；编辑期间来新信则草稿失效提醒；访问无权店铺的数据显示范围提示。', conflict_frame, 700) +
         variant('G8 未保存离开', '回复框、表单有未提交修改时离开页面，提示保留草稿。', unsaved_frame, 700), 2, 32),
    32)
save('GlobalStates.dc.html', board('全局状态与反馈', '所有页面共用的加载、无权限、找不到、断网、集成中断、提示、确认、并发与未保存状态。各模块自己的状态见对应状态板。演示时刻 %s。' % NOW_LABEL, gs_body, 1920, 2400))
print('ok')
