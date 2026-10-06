# -*- coding: utf-8 -*-
"""生成 DesignSystem.dc.html（设计规范）与 GlobalStates.dc.html（全局状态与反馈）。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from data import AFTERSALES


def sec(title, desc, body):
    return card(col('<div style="font-size: 16px; font-weight: 700; color: %s;">%s</div><div style="font-size: 13px; color: %s; line-height: 1.55;">%s</div>' % (T['ink'], title, T['ink3'], desc), 4) + body, pad='20px 24px', gap=16)


def sw(name, hexv, use, dark=False):
    return col('<div style="height: 44px; border-radius: 6px; background: %s; border: 1px solid %s;"></div><div style="font-size: 12px; font-weight: 700; color: %s;">%s</div><div style="font-size: 11px; color: %s; font-variant-numeric: tabular-nums;">%s</div><div style="font-size: 11px; color: %s; line-height: 1.4;">%s</div>' % (hexv, T['line'], T['ink'], name, T['ink3'], hexv, T['ink4'], use), 3)


colors = grid(''.join([
    sw('画布', T['canvas'], '页面底色'), sw('表面', T['surface'], '卡片、栏、表格'), sw('浅底', T['subtle'], '表头、次级区'),
    sw('分隔线', T['line'], '卡片与面板边框'), sw('描边', T['line_strong'], '输入框、次按钮'), sw('轨道', T['track'], '分段控件与徽标浅底'),
    sw('主文字', T['ink'], '标题、正文 · 白底 18.5:1'), sw('次文字', T['ink2'], '按钮文字、表格次要 · 9.9:1'), sw('辅助文字', T['ink3'], '说明、元信息 · 6.0:1'), sw('弱文字 ink4', T['ink4'], '时间、表头、计数等次要信息 · 白底 5.1:1、画布 4.7:1'),
    sw('占位 / 禁用 ink5', T['ink5'], '只用于输入框占位符与禁用控件文字（2.9:1，不承载信息）'), sw('强调', T['accent'], '主按钮、选中、链接'),
]), 6, 12) + grid(''.join([
    sw('强调底', T['accent_bg'], '选中行、强调标签底'), sw('青色', T['cyan'], '只作渐变第二色'), col('<div style="height: 44px; border-radius: 8px; background: %s;"></div><div style="font-size: 12px; font-weight: 700; color: %s;">AI 渐变</div><div style="font-size: 11px; color: %s;">#4f46e5 → #06b6d4 · 120°</div><div style="font-size: 11px; color: %s; line-height: 1.4;">只用于 AI 标识（✦）、品牌标、草稿卡顶条、内部成员头像</div>' % (GRAD, T['ink'], T['ink3'], T['ink4']), 3),
]), 6, 12) + label('语义色 · 文字色（浅底上的字与图标，白底 ≥ 4.5:1）') + grid(''.join([
    sw('成功 ok', T['ok'], '已完成、已批准、通过 · 4.7:1'), sw('警示 warn', T['warn'], '需要关注、未超限 · 4.7:1'), sw('危险 bad', T['bad'], '失败、超时、驳回 · 5.3:1'),
    sw('流程 flow', T['flow'], '工厂相关的执行记录'), sw('信息 info', T['info'], '中性提示横幅（偏青，与主色靛蓝区分）· 5.4:1'), sw('亚马逊 amazon', T['amazon'], '渠道徽标文字（品牌橙）· 浅橙底 4.7:1'),
]), 6, 12) + label('语义色 · 实心色（白字底、圆点、进度、行首色条，白字 ≥ 4.5:1）') + grid(''.join([
    sw('成功实心 ok_solid', T['ok_solid'], '步骤完成点、成功进度 · 白字 5.4:1'), sw('警示实心 warn_solid', T['warn_solid'], 'warn 按钮、待处理色条 · 白字 4.9:1'), sw('危险实心 bad_solid', T['bad_solid'], 'danger 按钮、失败点 · 白字 4.4:1（按钮字 13 / 600）'),
    sw('亚马逊底', T['amazon_bg'], '亚马逊徽标浅底'), sw('信息底', T['info_bg'], '信息横幅图标底'), sw('渠道色', T['shopify'], '亚马逊橙、Shopify 绿、邮件灰：渠道徽标与按渠道拆分的图表'),
]), 6, 12)

type_scale = col(''.join(
    '<div style="display: flex; align-items: baseline; gap: 20px; border-bottom: 1px solid %s; padding-bottom: 8px;"><div style="width: 280px; font-size: 12px; color: %s;">%s</div><div style="font-size: %spx; font-weight: %d; color: %s;">%s</div></div>' % (T['line2'], T['ink3'], a, s, w, T['ink'], t)
    for a, s, w, t in [
        ('24 / 700 · 指标数字、板标题', 24, 700, '$129.94  96.4%'),
        ('20 / 700 · 页面标题', 20, 700, '售后单'),
        ('20 / 600 · 详情页标题', 20, 600, 'HEPA 滤芯组件补发 · Laura Bennett'),
        ('16 / 600 · 弹窗标题、会话标题', 16, 600, '驳回报备'),
        ('14 / 600 · 面板标题、卡片标题', 14, 600, '待处理 · 工单上下文'),
        ('13 / 400 · 正文、表格、按钮', 13, 400, 'UPS 自 09-05 无扫描且已超预计送达。'),
        ('12 / 400 · 元信息、表单标签', 12, 400, '亚马逊买家消息 · 09-10 16:00'),
        ('12 / 600 · 区块小标题', 12, 600, '登记信息'),
        ('11 / 600 · 徽标、表头、快捷键（最小字号）', 11, 600, '待审批  Ctrl K'),
    ]), 8) + muted('字号只用 11 / 12 / 13 / 14 / 16 / 20 / 24 七档（规范板展示大字另可用 28、32）；中文最小 11，不用小数字号。组件库 _fs() 会把传入字号收敛到这七档。字重只用 400、500、600、700 四档。字体：Inter（拉丁字母与数字）+ PingFang SC / HarmonyOS Sans SC / Noto Sans SC（中文），最后回退微软雅黑。数字一律等宽（tabular-nums），金额、时间、单号对齐。', 12)

spacing = grid(
    card(label('间距（4 的倍数）') + row(''.join('<div style="display: flex; flex-direction: column; align-items: center; gap: 4px;"><div style="width: %dpx; height: %dpx; background: %s; border-radius: 2px;"></div><div style="font-size: 11px; color: %s;">%d</div></div>' % (s, s, T['accent_line'], T['ink3'], s) for s in (4, 8, 12, 16, 20, 24, 32)), 14, 'flex-end'), pad='14px 16px') +
    card(label('圆角') + row(''.join('<div style="display: flex; flex-direction: column; align-items: center; gap: 4px;"><div style="width: 44px; height: 32px; border: 1.5px solid %s; border-radius: %dpx;"></div><div style="font-size: 11px; color: %s;">%s</div></div>' % (T['ink3'], r, T['ink3'], n) for r, n in ((6, '6 徽标'), (8, '8 按钮输入'), (12, '12 卡片'), (16, '16 面板弹窗'), (999, '999 圆点'))), 14, 'flex-end'), pad='14px 16px') +
    card(label('阴影') + row(''.join('<div style="display: flex; flex-direction: column; align-items: center; gap: 6px;"><div style="width: 60px; height: 36px; background: #ffffff; border-radius: 8px; box-shadow: %s;"></div><div style="font-size: 11px; color: %s;">%s</div></div>' % (s, T['ink3'], n) for s, n in ((SHADOW_XS, 'xs 卡片'), (SHADOW_CARD, 'card 草稿卡'), (SHADOW_MD, 'md 浮层菜单'), (SHADOW_LG, 'lg 弹窗'), (SHADOW_POP, 'pop 主按钮'))), 14, 'flex-end'), pad='14px 16px') +
    card(label('控件高度') + col(row(btn('28 小', 'secondary', 'sm') + btn('32 默认', 'secondary') + btn('36 表单主按钮', 'primary', 'lg'), 8) + muted('同一行内的按钮、输入框、筛选器高度一致。', 12), 8), pad='14px 16px'),
    4, 12)

buttons = col(
    grid(''.join(col(label(n) + row(btn(n2, k) + btn(n2, k, st='hover') + btn(n2, k, st='active') + btn(n2, k, st='focus') + btn(n2, k, disabled=True, reason='示例禁用原因') + btn('处理中', k, loading=True), 8, wrap=True), 6) for n, n2, k in [
        ('主操作 primary · 每个区域最多一个', '批准', 'primary'), ('次操作 secondary', '驳回', 'secondary'), ('危险 danger · 不可撤销', '终止流程', 'danger'),
        ('危险描边 danger_outline', '驳回报备', 'danger_outline'), ('强调浅底 accent_outline', '修改后发送', 'accent_outline'), ('警示 warn · 建议动作', '提交建议动作', 'warn')]), 2, 16) +
    muted('每行依次为：默认 · 悬停 hover · 按下 active · 键盘聚焦 focus-visible（2px 主色焦点环、2px 偏移，Tailwind ring-2 ring-primary ring-offset-2，只在键盘操作时出现）· 禁用 · 处理中。', 12) +
    row(btn('带图标', 'secondary', 'md', 'refresh') + btn('提交审批', 'primary', 'md', icon_right='arrow_r') + btn('小按钮', 'secondary', 'sm', 'plus') + btn('大按钮', 'primary', 'lg') + icon_btn('more', 'secondary') + icon_btn('bell', badge=True) + link('查看全部', 12, 'chev_r') + btn('查看全部', 'link', st='hover'), 10) +
    grid(col(label('禁用必须写原因 · btn(..., disabled=True, reason=…)') + row(btn('合并', 'secondary', 'sm', 'merge', disabled=True, reason='Laura Bennett 在 Forcome Auto 没有其他未关闭的工单') +
                                                                              tooltip('Laura Bennett 在 Forcome Auto 没有其他未关闭的工单，无可合并对象（合并仅限同店铺、同客户）'), 10, 'flex-start') +
             muted('禁用按钮必须给出原因：外层带 title 悬停说明（研发用 Tooltip 包裹禁用按钮）；原因影响下一步时同时写在按钮旁。不给原因的禁用按钮不允许出现。', 12), 8) +
         col(label('快捷键 Kbd（shadcn Kbd）') + row(kbd('Ctrl') + kbd('K') + nowrap('全局搜索与命令面板', 13, T['ink2']), 6) +
             muted('全站只有顶部搜索设快捷键（Mac 为 ⌘K）。其他按钮、队列、页签不设快捷键，也不显示按键小标。第一阶段不显示全局搜索（prd_b 4.1）。', 12), 8), 2, 24) +
    muted('文案用动词短语，说清结果：「批准并通知生产厂寄出」而不是「确定」。禁用按钮必须写原因（见上）。点击后进入「处理中」并防止重复提交；成功后按钮恢复并弹出成功提示。', 12), 14)

forms = grid(''.join([
    field('默认（占位符 ink5）', input_box(None, '请输入快递单号')),
    field('悬停 hover', input_box(None, '请输入快递单号', 'hover')),
    field('聚焦 · 输入中', input_box('1Z4R2883', st='focus')),
    field('键盘聚焦 focus-visible', input_box('1Z4R2883', st='focus_visible'), hint='Tab 进入时：2px 主色焦点环、2px 偏移'),
    field('错误', input_box('abc', st='error'), error='快递单号只能包含字母和数字，长度 10–30 位'),
    field('禁用', input_box('易仓 US', st='disabled'), hint='由系统根据库存自动选择'),
    field('必填 + 前后缀', input_box('11.50', prefix='$', suffix='USD', mono=True), required=True),
    field('下拉选择', select_box('产品质量问题')),
    field('下拉 · 错误', select_box(None, '请选择责任类型', 'error'), required=True, error='请选择责任类型'),
    field('多行文本 · 计数', textarea_box('驳回原因：运费高于同线路均价 30%，请生产厂改走云途普货。', st='focus', h=72, counter='%d / 200' % len('驳回原因：运费高于同线路均价 30%，请生产厂改走云途普货。'))),
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
    col(label('渠道与店铺（平台徽标 + 店铺名）') + row(channel('亚马逊', 'US', 'Forcome Direct') + channel('Shopify', 'US', 'forcome.com') + channel('邮件'), 6, wrap=True), 8),
    col(label('分类值（意图、处理方式、责任）') + row(cat('未收到与异常') + cat('寄配件') + cat('产品质量问题'), 6, wrap=True), 8),
    col(label('SLA 剩余（≤2h 危险，≤6h 警示）') + row(sla('0h 55m', 'danger') + sla('5h 40m', 'warning') + sla('11h 10m') + sla('已回复', 'none'), 6, wrap=True), 8),
    col(label('优先级 / 情绪 / 标签 / 计数') + row(priority('紧急') + priority('高') + priority('普通') + sentiment('负面') + sentiment('中性') + sentiment('正面') + pill('路途急') + badge_count(12), 8, wrap=True), 8),
]), 2, 18) + muted('规则：状态一律带圆点并用语义浅底；分类值一律中性灰；AI 产出一律用渐变 ✦ 徽标（' + ai_badge('AI 摘要') + '）。同一个状态在所有页面颜色相同，映射表在组件库 STATE_TONE。', 12)

feedback = grid(''.join([
    col(label('页内横幅') + banner('info', '工单已合并到 T-20260902-0071', '原工单只读，新来信会进入主工单。') + banner('success', '已批准，出库单创建成功', '回复已自动发出，SLA 计时停止。') + banner('warning', 'SLA 剩 55 分钟，审批时限 4 小时', '承诺类回复要等审批后才能发出。建议先发一条不含承诺的进展回复。', btn('插入进展回复', 'secondary', 'sm')) + banner('danger', 'Gmail 连接中断，来信暂存队列', '09-11 10:05 起未收取。恢复后按到达顺序处理，SLA 从原到达时间计算。管理员、客服主管已收到通知。', btn('查看渠道状态', 'secondary', 'sm')), 10),
    col(label('浮层提示（右上角，成功 3 秒消失，失败需手动关闭）') + toast('success', '已提交审批', '周敏会在 4 小时内处理，结果会通知你。') + toast('error', '发送失败：Gmail 接口超时', '草稿已保留，系统将在 1 分钟后自动重试。', row(link('立即重试') + link('复制草稿'), 12)) + toast('info', '陈晨正在处理这张工单', '你可以查看，但不能同时编辑回复。') + toast('warning', '草稿已失效', '客户在你编辑期间又来了一封信，请先阅读新消息。') +
        toast('neutral', '查询易仓库存：第 2 次重试成功', '积加接口首次超时，结果已更新。') +
        label('可撤销浮层 · toast(..., undo=5)（可逆操作不弹确认）', 'margin-top: 4px;') + toast('success', '已关闭工单 T-20260910-0192', undo=5, remain=3) + toast('success', '已驳回报备 AP-20260911-003', '已通知发起人王磊。', undo=5), 10),
    col(label('确认弹窗（只用于不可逆操作；危险确认默认焦点在「取消」）') + dialog('驳回这张审批单？', field('驳回原因', textarea_box(None, '写清楚为什么驳回、发起人要怎么改', 'error', 64, '0 / 200'), True, error='请填写驳回原因') + muted('驳回后工单回到提交前状态，售后单退回「待确认」。驳回可撤销，确认框只用于收集必填原因。', 12), btn('取消', 'secondary', st='focus') + btn('驳回', 'danger'), 420, 'danger', '驳回后发起人会收到通知，绑定的回复不会发出。') +
        dialog('执行退款 MX$889.00？', muted('退款经 SP-API 立即发给买家，执行后不能撤销。', 13) + kv('订单', '302-8811234-9901122') + kv('金额', money_cur(889.00, 'MXN')), btn('取消', 'secondary', st='focus') + btn('执行退款', 'danger'), 420, 'danger'), 10),
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
]), 3, 20) + grid(
    col(label('当前卡点 blocker（详情页步骤条上方 · 自定义组件，基于 shadcn Alert）') +
        blocker('客服主管 周敏 审批报备 · 快递费用 $11.50', '3h 21m', btn('催办', 'secondary', 'sm', 'bell') + btn('撤回报备', 'ghost', 'sm'), level='normal', since='39m') +
        blocker('生产厂 FQD 报价', '09-15 周二 09:00 截止', None, '只有生产厂对接人能提交报价；超时后系统提醒售后负责人王磊。', level='warning') +
        blocker('双方负责人商定最终比例', None, btn('录入最终比例', 'primary', 'sm'), level='danger', since='2 天') +
        muted('一句话说清：在等谁 · 还剩多久 · 你可以做什么；不能做时写为什么（灰色锁）。剩余时间色调同 SLA：≤ 2h 红、≤ 6h 或以工作日计的截止黄。', 12), 10) +
    col(label('费用与承担 fee_card（shadcn Card + Table）') + fee_card(AFTERSALES[8]) +
        muted('金额三态：≈ 估算（浅色，报备未批或比例为建议）· 已确认（常规）· 已结算（带绿勾）。按三组比例拆：产品成本、快递物流、其他费用（额外赔偿 + 其他）。直接传售后单字典：fee_card(a)。', 12), 10) +
    col(label('多币种金额 money_cur') + card(kv('美元', money_cur(14.70)) + kv('墨西哥站', money_cur(889.00, 'MXN')) + kv('加拿大站', money_cur(25.99, 'CAD')) + kv('已结算（fee_amt）', fee_amt(13.20, 'settled')) + kv('估算（fee_amt）', fee_amt(14.70, 'estimate')), pad='12px 14px', gap=6) +
        label('设置页吸底保存栏 save_bar（position: sticky）', 'margin-top: 8px;') + '<div style="border: 1px solid %s; border-radius: 12px; overflow: hidden;">%s%s</div>' % (T['line'], save_bar(3, '修改阈值需二次确认'), save_bar(0)) +
        muted('设置页有未保存修改时离开，走全局状态 G8 的三按钮确认；回复草稿自动保存，不弹窗。', 12), 10),
    template='minmax(0, 1.25fr) minmax(0, 1fr) minmax(0, 1fr)', gap=20, extra='margin-top: 8px;')

loading = grid(''.join([
    col(label('空状态') + card(empty('inbox', '收件箱已清空', '没有待你处理的工单。新来信会自动出现在这里。', btn('查看全部工单', 'secondary')), pad='0px'), 8),
    col(label('无权限') + card(no_permission('没有访问权限', '「渠道与店铺」只对管理员开放。你当前的角色是坐席，如需开通请联系管理员刘洋。', btn('返回首页', 'secondary', 'md', 'chev_l')), pad='0px'), 8),
    col(label('加载失败') + card(load_error('报表加载失败', '积加接口超时。已显示的数据截止 09-11 09:30。'), pad='0px'), 8),
    col(label('骨架屏（首屏加载 > 300ms 时显示）') + card(skel_rows(4, True), pad='0px') + row(spinner() + muted('局部加载用行内转圈，不遮挡整页'), 8) + progress(62) , 8),
]), 4, 20)

copy_rules = table([('场景', 'left'), ('写法', 'left'), ('示例', 'left')], [
    ['按钮', '动词 + 对象，说清结果', '批准并通知生产厂寄出 / 提交审批 / 录入最终比例'],
    ['状态', '名词短语，与状态机名称完全一致', '待审草稿、待审批、等内部'],
    ['时间', '当天只写时分；其他写 月-日 时:分；跨年写年', '10:20 · 09-10 16:00 · 2025-12-30'],
    ['时长', '小时与分钟，SLA 精确到分钟', '5h 40m · 剩 2 个工作日'],
    ['金额', '币种符号 + 两位小数；比索、加元订单同时显示折算（money_cur）；估算加 ≈', '$14.70 · MX$889.00（≈ $49.39）· ≈ $14.70'],
    ['单号', '固定前缀：T 工单、S 售后单、AP 审批单', 'T-20260910-0192 · S-20260911-0018 · AP-20260911-001'],
    ['错误', '发生了什么 + 怎么处理，不道歉、不含糊', '发送失败：Gmail 接口超时。草稿已保留，1 分钟后自动重试。'],
    ['空状态', '说明为什么空 + 下一步', '没有待你处理的工单。新来信会自动出现在这里。'],
], '120px 320px minmax(0, 1fr)', dense=True)
lock_chip = '<div style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; color: %s; background: %s; border-radius: 6px; padding: 0px 7px; line-height: 18px; white-space: nowrap;">%s硬规则 · 不可改</div>' % (T['ink3'], T['track'], icon('lock', 12, T['ink3'], 2))
retry_chip = '<div style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; color: %s; background: %s; border-radius: 6px; padding: 0px 7px; line-height: 18px; white-space: nowrap;">%s第 2 次重试成功</div>' % (T['ink3'], T['track'], icon('info', 12, T['ink3'], 2))
color_rules = table([('颜色', 'left'), ('含义', 'left'), ('示例', 'left'), ('不要这样用', 'left')], [
    [chip('黄', 'warning', dot=True), '需要关注，但还没超限', row(state('待审批') + sla('5h 40m', 'warning') + chip('建议比例', 'warning', dot=True), 6), '已经超时或失败的事项（用红）'],
    [chip('红', 'danger', dot=True), '失败或超时', row(state('执行失败') + state('已超时') + sla('0h 55m', 'danger'), 6), '只是「重要」或「待处理」'],
    [chip('灰 + 锁', 'neutral', 11, 'lock'), '硬规则，不可改（平台规则、合规、系统计算值）', row(lock_chip, 6), '只读但可申请修改的值（用浅底，不加锁）'],
    [chip('绿', 'success', dot=True), '成功完成', row(state('已执行') + state('已结算') + fee_amt(13.20, 'settled'), 6), '「重试后成功」'],
    [chip('灰 + 信息图标', 'neutral', 11, 'info'), '重试后成功、自动恢复（结果正常，过程有波折）', row(retry_chip, 6), '用绿色（会掩盖曾经失败）或黄色（会误报）'],
], '130px 300px 360px minmax(0, 1fr)', dense=True)

shell_note = grid(''.join([
    card(label('页面外壳') + text('顶部 56px 白色顶栏：品牌标（渐变 F）· 分段导航（浅灰轨道，当前项白底描边，待办数用浅靛蓝计数）· 店铺范围（按授权店铺过滤全站数据）· 搜索（Ctrl K 命令面板）· 密度（舒适 / 紧凑）· 通知（铃铛面板，带未读数，G10）· 当前用户与角色（头像菜单：审计日志、密度、退出登录）。第一期只有浅色，不放主题切换。导航项按角色显示，无权入口不出现。第一阶段不显示店铺范围与全局搜索（prd_b 4.1）。', 13) + text('内容区为浅灰底（#f5f6fa）：列表页「标题区 + 筛选行 + 表格卡片」；详情页「标题区 + 左主右辅两栏（右栏 360–400px）」；收件箱、知识库、设置、工厂工作台用 16px 圆角的浮动面板，面板间距 12px。', 13) + text('收件箱三栏：队列 308 / 处理台（自适应，内容区浅底）/ 上下文 332；上下文分区可折叠。', 13), pad='16px 18px'),
    card(label('交互通则') + text('1. 所有写操作点击后立即进入「处理中」，防重复提交；成功给浮层提示，失败给可重试的提示并保留输入。', 13) +
         text('2. 二次确认只用于不可逆操作：执行退款、终止流程、停用成员、录入最终比例（锁定）、生成结算批次——用确认弹窗（AlertDialog），危险确认默认焦点在「取消」。', 13) +
         text('3. 可逆操作直接执行，不弹确认：关闭工单、驳回、撤回、改派、合并等。执行后弹 5 秒「撤销」浮层（toast(..., undo=5)），5 秒内可一键恢复；需要原因的（驳回、终止）仍用弹窗收集原因，但不再追问「确定吗」。', 13) +
         text('4. 同一工单同一时间只允许一人编辑回复，其他人只读并看到「谁在处理」；审批单同理，审批人打开即加处理锁（R-AP-03）。', 13) + text('5. 列表默认排序写在列表上方；筛选条件在地址栏保留，刷新后不丢。', 13) +
         text('6. 禁用的按钮必须写原因（btn(..., reason=…) 悬停说明，影响下一步时写在按钮旁）。', 13) +
         text('7. 行首色条两种用法，不混用：收件箱队列卡片左侧色条只表示风险（转人工红），选中用浅底 + 描边，不用色条；列表表格行（如 P07 售后单列表）左侧 3px 黄条表示「需我处理」（待确认、协商待升级），属于「需要关注」的黄，不表示风险。', 13), pad='16px 18px'),
    card(label('快捷键与键盘') + text('快捷键只保留顶部搜索：Ctrl K（Mac 为 ⌘K）打开全局搜索与命令面板。其他页面不设快捷键，也不显示按键小标。第一阶段不显示全局搜索（prd_b 4.1）。', 13) +
         text('弹窗沿用浏览器与 shadcn 的默认键盘行为：Esc 关闭即取消；单行输入框里回车提交，多行文本里是换行；危险确认框打开时焦点在「取消」。', 13) +
         text('提交、批准或驳回后自动打开队列里的下一张，并在浮层提示里给「撤销」或「返回上一张」。', 13), pad='16px 18px'),
]), 3, 16)

TOK = [
    ('canvas', '--background', '#f5f6fa', '#0c0e14', '页面底色'),
    ('surface', '--card / --popover', '#ffffff', '#14171f', '卡片、面板、弹层'),
    ('subtle', '--muted', '#f7f8fc', '#1a1e28', '表头、处理台内容区、底栏'),
    ('track', '--secondary / --accent', '#f1f3f9', '#20242f', '分段轨道、徽标浅底、悬停'),
    ('line', '--border', '#e7e9f1', '#272c39', '边框与分隔'),
    ('line_strong', '--input', '#d8dce7', '#333a4a', '输入框、次按钮描边'),
    ('ink', '--foreground', '#0f1320', '#e9ebf2', '标题与正文'),
    ('ink3', '--muted-foreground', T['ink3'], '#a3aab9', '说明、元信息'),
    ('ink4', '--subtle-foreground（自定义）', T['ink4'], '#8a92a4', '时间、表头、计数（白底 5.1:1）'),
    ('ink5', '--placeholder（自定义）', T['ink5'], '#5d6477', '只用于占位符与禁用文字'),
    ('accent', '--primary / --ring', T['accent'], '#6f6bf6', '主操作、选中、焦点环'),
    ('accent_bg', '--primary-soft（自定义）', T['accent_bg'], 'rgba(111,107,246,.15)', '选中底、强调徽标'),
    ('bad_solid', '--destructive', T['bad_solid'], '#f0606b', '实心色：危险按钮、失败点'),
    ('bad', '--destructive-text（自定义）', T['bad'], '#f58a92', '文字色：失败、超时'),
    ('ok_solid', '--success（自定义）', T['ok_solid'], '#3dd68c', '实心色：成功点、完成进度（白字 5.4:1）'),
    ('ok', '--success-text（自定义）', T['ok'], '#5ee0a0', '文字色：已完成、已批准'),
    ('warn_solid', '--warning（自定义）', T['warn_solid'], '#e0a44a', '实心色：warn 按钮、待处理色条（白字 4.9:1）'),
    ('warn', '--warning-text（自定义）', T['warn'], '#f0bd6e', '文字色：需要关注、未超限'),
    ('info', '--info（自定义）', T['info'], '#38bcd4', '信息横幅（偏青）'),
    ('amazon', '--channel-amazon（自定义）', T['amazon'], '#f59e0b', '亚马逊渠道徽标（品牌橙，底 amazon_bg）'),
    ('cyan', '--brand-2（自定义）', T['cyan'], '#22c7e0', '渐变第二色'),
]
tok_rows = [[nowrap(a, 12, T['ink'], 600), nowrap(b, 12, T['accent_ink'], 600),
             row('<div style="width: 14px; height: 14px; border-radius: 4px; background: %s; border: 1px solid %s;"></div>' % (c, T['line']) + nowrap(c, 12, T['ink2']), 6),
             row('<div style="width: 14px; height: 14px; border-radius: 4px; background: %s; border: 1px solid %s;"></div>' % (d, T['line']) + nowrap(d, 12, T['ink2']), 6),
             nowrap(e, 12, T['ink3'])] for a, b, c, d, e in TOK]
tok_table = table([('原型 token（ui.T）', 'left'), ('shadcn 变量', 'left'), ('浅色', 'left'), ('深色（预留，第一期不上线）', 'left'), ('用途', 'left')], tok_rows, '130px 190px 150px 190px minmax(0, 1fr)', dense=True)
CSS = """@import "tailwindcss";
@custom-variant dark (&:is(.dark *));

:root {
  --background: #f5f6fa;  --foreground: #0f1320;
  --card: #ffffff;        --popover: #ffffff;
  --muted: #f7f8fc;       --muted-foreground: #5a6376;
  --secondary: #f1f3f9;   --accent: #f1f3f9;
  --border: #e7e9f1;      --input: #d8dce7;
  --primary: #4f46e5;     --primary-foreground: #ffffff;  --ring: #4f46e5;
  --destructive: #c8313b; --destructive-text: #c8313b;
  --success: #0b7a4d;     --success-text: #0a7a4c;
  --warning: #a65f06;     --warning-text: #94560a;
  --info: #0e7490;        --channel-amazon: #b45309;
  --subtle-foreground: #656e82;  --placeholder: #9099ab;
  --brand-2: #06b6d4;     --radius: 12px;
}
.dark { --background: #0c0e14; --card: #14171f; --primary: #6f6bf6; /* 其余见左表 */ }

@theme inline {
  --color-background: var(--background);  --color-foreground: var(--foreground);
  --color-primary: var(--primary);        --color-success: var(--success);
  --color-warning: var(--warning);        --color-info: var(--info);
  --radius-sm: 6px;  --radius-md: 8px;  --radius-lg: var(--radius);  --radius-xl: 16px;
  --font-sans: "Inter", "PingFang SC", "HarmonyOS Sans SC", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif;
}"""
css_box = '<pre style="margin: 0px; background: #0f1320; color: #e9ebf2; border-radius: 12px; padding: 14px 16px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.6; white-space: pre; overflow: hidden;">%s</pre>' % CSS.replace('<', '&lt;')
CMP = [
    ('btn · icon_btn', 'Button（禁用时包 Tooltip 写原因）', 'variant：default / outline / ghost / destructive / link；新增 warn、soft（accent_outline）；size：sm 28 / default 32 / lg 36；focus-visible:ring-2 ring-offset-2'),
    ('chip · state · cat · pill · channel', 'Badge', '按 STATE_TONE 生成 variant；状态带 5px 圆点'),
    ('ai_badge', 'Badge（variant="ai"）', 'bg-gradient-to-r from-primary to-brand-2 + ✦'),
    ('card · kpi', 'Card', 'rounded-lg（12px）+ border + shadow-xs'),
    ('tabs', 'Tabs（line 样式）', '选中下划线 2px，计数用 Badge'),
    ('seg · ver_tabs · queue_seg · 顶部导航', 'Tabs / ToggleGroup（胶囊样式）', '浅灰轨道，选中白底描边'),
    ('input_box · select_box · textarea_box · field', 'Input · Select · Textarea · Form', 'Form 用 react-hook-form + zod，错误写「哪里错 + 怎么改」'),
    ('checkbox · radio · toggle · radio_card', 'Checkbox · RadioGroup · Switch', 'radio_card 为 RadioGroup 的卡片样式'),
    ('table · group_table', 'Table + TanStack Table', '排序、筛选、列显隐、分页、行选择'),
    ('dialog · scrim', 'Dialog / AlertDialog', '不可撤销操作用 AlertDialog'),
    ('审核抽屉（K12）', 'Sheet', '右侧抽屉'),
    ('menu · tooltip · filter_chip', 'DropdownMenu · Tooltip · Popover + Command', '筛选器为 Popover 内的 Command 列表'),
    ('search_box（Ctrl K）', 'Command（CommandDialog）', '全局搜索与命令面板'),
    ('toast（undo=5 撤销浮层）', 'Sonner（toast 的 action）', '成功 3 秒消失，失败常驻；可逆操作带 5 秒「撤销」'),
    ('kbd', 'Kbd', '只用于顶部搜索的 Ctrl K'),
    ('通知面板（G10）', 'Popover + Tabs + ScrollArea', '宽 360；全部 · 未读；未读圆点 + 浅底；全部已读'),
    ('头像菜单（G10）', 'DropdownMenu', '姓名、角色与部门；审计日志 · 密度 · 退出登录'),
    ('登录卡片（G11、G12）', 'Card', '钉钉扫码二维码（2 分钟过期蒙层 + 刷新）；被拒时换成说明'),
    ('blocker（当前卡点）', 'Alert（自定义布局）', '详情页步骤条上方：在等谁 · 还剩多久 · 你可以做什么'),
    ('fee_card · fee_amt · money_cur', 'Card + Table', '费用与承担；金额三态：估算 ≈ / 已确认 / 已结算 ✓'),
    ('save_bar', '自定义组件（sticky 底栏）+ Button', '设置页未保存修改：放弃 · 保存'),
    ('banner', 'Alert', 'info / success / warning / destructive'),
    ('skel · progress · spinner', 'Skeleton · Progress · lucide Loader2', ''),
    ('rsec（可折叠分区）', 'Collapsible / Accordion', '收件箱右栏'),
    ('avatar · kbd · pagination', 'Avatar · Kbd · Pagination', ''),
    ('三栏面板 · 滚动区', 'ResizablePanelGroup · ScrollArea', '面板宽度可拖动（可选）'),
    ('图表', 'Chart（Recharts）', '颜色取 --chart-1…5'),
    ('日期字段', 'Calendar + Popover（DatePicker）', ''),
    ('stepper · 执行记录', '自定义组件', 'shadcn 无现成组件'),
    ('icon()', 'lucide-react', '同名替换：inbox、ticket、package、square-check、book-open、chart-column、settings 等'),
]
cmp_table = table([('原型组件（ui.py）', 'left'), ('shadcn/ui', 'left'), ('说明', 'left')], [[nowrap(a, 12, T['ink'], 600), nowrap(b, 12, T['accent_ink'], 600), text(c, 12, T['ink3'])] for a, b, c in CMP],
                  '300px 300px minmax(0, 1fr)', dense=True)
dens = table([('密度', 'left'), ('正文', 'left'), ('次要', 'left'), ('徽标', 'left'), ('队列行内边距', 'left'), ('队列行距', 'left'), ('表格行高', 'left'), ('面板内边距', 'left')],
             [[nowrap('舒适（默认）', 12, T['ink'], 600), '13', '12', '11', '9', '4', '40', '14–16'], [nowrap('紧凑', 12, T['ink'], 600), '12', '11', '11', '6', '2', '32', '12']],
             '140px repeat(7, minmax(0, 1fr))', dense=True)
dev_map = grid(col(label('令牌对照') + tok_table, 8) + col(label('Tailwind v4 主题（globals.css 摘要）') + css_box, 8), template='minmax(0, 1.25fr) minmax(0, 1fr)', gap=20) + \
    col(label('组件对照') + cmp_table, 8) + col(label('密度（第一期两档都上线；顶栏「密度」按钮切换，按用户保存；只改字号与间距，不改布局；单位 px）') + dens, 8)

body = col(''.join([
    sec('1 色彩', '中性色表达层级；靛蓝只用于主操作与选中；靛蓝→青色渐变只用于 AI 标识、品牌标与内部成员头像；绿、黄、红、紫只表达状态，不做装饰。', colors),
    sec('2 字体与字号', '7 级字号（11 / 12 / 13 / 14 / 16 / 20 / 24），正文 13px。', type_scale),
    sec('3 间距、圆角、阴影、控件高度', '所有尺寸取自下列刻度。', spacing),
    sec('4 按钮', '每种按钮都有默认、悬停、按下、键盘聚焦、禁用（必须写原因）、处理中六态。', buttons),
    sec('5 表单控件', '标签在上、控件在中、说明或错误在下。', forms),
    sec('6 状态与分类标识', '全站状态颜色唯一映射。', states),
    sec('7 反馈', '横幅用于持续存在的情况，浮层提示用于一次性结果，弹窗用于需要确认或填写原因的操作。', feedback),
    sec('8 数据展示', '表格、键值、指标、步骤条、执行记录；业务共享组件：当前卡点、费用与承担、多币种金额、吸底保存栏。', data_disp),
    sec('9 空、无权限、失败、加载', '每个列表和面板都要设计这四种情况。', loading),
    sec('10 外壳与交互通则', '所有页面共用。参考稿：forcome-support-console.html。', shell_note),
    sec('11 文案与颜色语义', '同一概念全站同一个词，术语以 PRD 第 1.4 节术语表为准；同一种颜色全站只表达一种意思。行首色条：队列卡片红条只表示风险（转人工）；表格行黄条表示需我处理（需要关注），两者不混用。', copy_rules + col(label('颜色语义') + color_rules, 8)),
    sec('12 研发映射 · shadcn/ui + Tailwind CSS v4', '开发用 shadcn/ui 与 Tailwind CSS（v4，研发启动时锁定当时最新稳定小版本）。原型里的每个颜色、圆角、组件都能在下表找到对应的 CSS 变量或 shadcn 组件；第一期只做浅色；舒适（默认）与紧凑两档密度都上线（Q-24 已确认），对照见全局状态 G9；深色令牌预留，不上线。', dev_map),
]), 20)
save('DesignSystem.dc.html', board('设计规范', '视觉 v3：顶栏分段导航 + 浅灰底浮动面板 + 靛蓝主色，AI 用靛蓝→青色渐变标识（参考 forcome-support-console.html）。本板定义色彩、字体、间距、组件、状态与研发映射；所有高保真页面只使用这里的组件，开发用 shadcn/ui + Tailwind CSS v4。', body, 1920, 2400))

# ---------------------------------------------------------------- 全局状态
from data import NOW_LABEL, TICKETS, G7_OCC
_g7_t = next(t for t in TICKETS if t['no'] == 'T-20260902-0071')  # G7 并发示例：陈晨负责的工单
page_skel = app('liting', '收件箱', ['收件箱', '待处理'], '<div style="flex: 1; display: flex; gap: 12px; padding: 10px 14px 12px 14px; min-height: 0px;"><div style="width: 308px; background: #ffffff; border: 1px solid %s; border-radius: 16px; overflow: hidden;">%s</div><div style="flex: 1; padding: 20px 24px; display: flex; flex-direction: column; gap: 12px; background: #ffffff; border-radius: 16px;">%s%s%s%s</div><div style="width: 332px; background: #ffffff; border: 1px solid %s; border-radius: 16px; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px;">%s%s%s%s</div></div>' % (
    T['line'], skel_rows(8), skel('50%', 16), skel('100%', 90, 8), skel('100%', 200, 8), skel('40%', 32, 6), T['line'], skel('40%', 10), skel('80%', 10), skel('100%', 120, 8), skel('100%', 80, 8)), w=1440, h=900)
# G2 无权限：写明哪个角色能看；按钮只有「返回首页」（回到该角色的默认首页，坐席为收件箱），没有「申请权限」（prd_c GlobalStates）
G2_DESC = '「渠道与店铺」只对管理员开放。你当前的角色是坐席，如需开通请联系管理员刘洋。'
# G3 找不到：不写保留策略（D-21 个人信息长期保留）
G3_DESC = '工单 T-20260801-9999 不存在，请检查编号或链接是否完整。'
# G4 集成中断横幅：不可关闭、恢复后自动消失；本图为坐席李婷视角，「查看渠道状态」只对管理员显示，这里不出现
G4_BANNER = ('Gmail 连接中断，来信暂存队列', '09-11 10:05 起未收取。恢复后自动补收，按到达顺序处理，SLA 从原到达时间计算。管理员、客服主管已收到通知。')
page_403 = app('liting', '', ['设置', '渠道与店铺'], '<div style="flex: 1; display: flex; align-items: center; justify-content: center;">%s</div>' % card(no_permission('没有访问权限', G2_DESC, btn('返回首页', 'primary', 'md', 'chev_l')), pad='8px 24px'))
page_404 = app('liting', '工单', ['工单', 'T-20260801-9999'], '<div style="flex: 1; display: flex; align-items: center; justify-content: center;">%s</div>' % card(empty('search', '找不到这张工单', G3_DESC, row(btn('返回工单列表', 'primary') + btn('按订单号搜索', 'secondary', 'md', 'search'), 8)), pad='8px 24px'))
page_offline = app('liting', '收件箱', ['收件箱', '待处理'], '<div style="flex: 1; display: flex; align-items: center; justify-content: center;">%s</div>' % card(load_error('网络连接已断开', '你刚才编辑的回复已保存在本机。恢复连接后会自动同步，不需要重新输入。', row(btn('重新连接', 'primary', 'md', 'refresh'), 8)), pad='8px 24px'),
                   banner_html=banner('danger', *G4_BANNER))


def scaled(inner, w=1440, h=900, s=0.5):
    return '<div style="width: %dpx; height: %dpx; overflow: hidden; position: relative;"><div style="position: absolute; left: 0px; top: 0px; width: %dpx; height: %dpx; transform: scale(%s); transform-origin: 0px 0px;">%s</div></div>' % (int(w * s), int(h * s), w, h, s, inner)


def focus(page, key, w=720, h=450, note='整页缩略图（淡化）+ 关键区域 1:1'):
    """整页缩略图淡化作背景，关键区域按 1:1 叠在中间（G2–G4）。"""
    return '<div style="width: %dpx; height: %dpx; position: relative; overflow: hidden; background: %s;"><div style="position: absolute; inset: 0px; opacity: 0.28;">%s</div><div style="position: absolute; inset: 0px; background: rgba(245,246,250,0.55); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 16px; box-sizing: border-box;">%s</div><div style="position: absolute; left: 12px; bottom: 10px;">%s</div></div>' % (
        w, h, T['canvas'], scaled(page, s=w / 1440.0), key, nowrap(note, 11, T['ink4']))


key_403 = card(no_permission('没有访问权限', G2_DESC, btn('返回首页', 'primary', 'md', 'chev_l')), pad='0px 16px', style='width: 460px; box-shadow: %s;' % SHADOW_LG)
key_404 = card(empty('search', '找不到这张工单', G3_DESC, row(btn('返回工单列表', 'primary') + btn('按订单号搜索', 'secondary', 'md', 'search'), 8)), pad='0px 16px', style='width: 460px; box-shadow: %s;' % SHADOW_LG)
key_offline = col(banner('danger', *G4_BANNER) +
                  card(load_error('网络连接已断开', '回复草稿已保存在本机。恢复连接后自动重试未完成的提交，并用浮层提示结果。', btn('立即重试', 'secondary', 'md', 'refresh')), pad='0px 16px', style='box-shadow: %s;' % SHADOW_LG) +
                  toast('neutral', '网络已恢复 · 已自动重新提交 1 项', '回复 T-20260910-0192 已发出。'), 10, 'width: 560px;')

toasts_frame = mini(col(toast('success', '已提交审批', '周敏会在 4 小时内处理，结果会通知你。') + toast('error', '保存失败：网络不可用', '修改已保存在本机，网络恢复后自动重试并提示结果。', link('立即重试')) + toast('success', '已关闭工单 T-20260910-0192', undo=5, remain=3), 10, 'align-items: flex-end;'), 700, 330, pad='20px')
confirm_frame = mini('<div style="flex: 1; display: flex; align-items: center; justify-content: center; background: rgba(16,24,40,0.45);">%s</div>' % dialog('执行退款 MX$889.00？', muted('退款经 SP-API 立即发给买家 Mateo Rivas，执行后不能撤销。', 13) + kv('订单', '302-8811234-9901122') + kv('金额', money_cur(889.00, 'MXN')), btn('取消', 'secondary', st='focus') + btn('执行退款', 'danger'), 440, 'danger'), 700, 330)
# G7 乐观锁冲突示例：data.G7_OCC（赵倩编辑王磊负责的排查树条目时，王磊 10:18 先保存了一版）


def g7_occ():
    o = G7_OCC
    rec = o['record']
    head = between(row(text('编辑条目 · %s' % rec[0], 13, T['ink'], 700) + cat(rec[1]), 8), nowrap('你：赵倩 · 知识库负责人 · 点「保存」时', 12, T['ink4']))
    bn = banner('warning', '这条记录刚被%s修改（%s）' % (o['by'], o['at']),
                '%s改了：%s。你的修改还没保存，已保留在下方；可先查看最新内容再改，或用你的内容覆盖。' % (o['by'], o['theirs_fields']),
                row(btn('查看最新', 'secondary', 'sm', 'refresh') + btn('覆盖保存', 'danger_outline', 'sm'), 6))
    fld = field(o['field'], textarea_box(o['mine'], st='focus', h=40), hint='你的输入 · 未保存（已保留）')
    top = card(head + bn + fld, pad='12px 14px', gap=10)
    dlg = dialog('覆盖%s的修改？' % o['by'], muted('%s %s 保存的「%s」等 2 项会被你的内容替换，覆盖后记入审计日志。' % (o['by'], o['at'], o['field']), 12),
                 btn('取消', 'secondary', 'sm', st='focus') + btn('覆盖保存', 'danger', 'sm'), 420, 'warning')
    bottom = '<div style="display: flex; align-items: center; justify-content: center; padding: 14px; background: rgba(16,24,40,0.45); border-radius: 12px;">%s</div>' % dlg
    return col(top + bottom, 10)


conflict_frame = mini(col(
    nowrap('编辑锁 · 草稿失效 · 数据范围', 12, T['ink2'], 600) +
    banner('info', '陈晨正在处理这张工单', '09-11 10:12 开始编辑回复。你可以查看会话和上下文，回复框只读。', row(btn('申请接手', 'secondary', 'sm') + btn('刷新', 'ghost', 'sm', 'refresh'), 6)) + banner('warning', '这张工单在你编辑期间收到新来信', '09-11 10:18 %s 又发来 1 封。你的草稿已保留，请阅读新消息后再发送。' % _g7_t['customer'], btn('查看新消息', 'secondary', 'sm')) + banner('info', '这张工单不在你的店铺范围内', '工单属于店铺 forcome.mx。你的数据范围不含该店铺，需要查看请联系管理员刘洋开通。', btn('联系管理员', 'secondary', 'sm')) +
    nowrap('乐观锁冲突 · 保存时发现记录已被他人修改 → 点「覆盖保存」二次确认', 12, T['ink2'], 600, ) + g7_occ(), 10), 700, 800, pad='20px')
unsaved_frame = mini(col(
    nowrap('草稿类（回复框、内部备注）· 自动保存，离开不弹窗', 12, T['ink2'], 600) +
    row(toast('neutral', '草稿已保存', '离开后保留 7 天，下次打开这张工单时恢复。'), 0, justify='flex-end') +
    nowrap('表单类（设置页）· 有未保存修改时离开', 12, T['ink2'], 600) +
    '<div style="flex: 1; display: flex; align-items: center; justify-content: center; background: rgba(16,24,40,0.45); border-radius: 12px; padding: 16px;">%s</div>' % dialog(
        '离开前保存修改？', muted('「规则与阈值」有 3 项未保存的修改。放弃后恢复为上次保存的值。', 13),
        btn('继续编辑', 'secondary', st='focus') + btn('放弃修改', 'danger_outline') + btn('保存并离开', 'primary'), 460, 'warning'), 10), 700, 470, pad='20px')

# G9 密度切换
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pages'))
import inbox_parts as IP


def dens_col(dense):
    rows = ''.join(IP.queue_row(IP.TK[n], n == 'T-20260910-0192', dense=dense) for n in ('T-20260902-0071', 'T-20260910-0176', 'T-20260910-0192', 'T-20260910-0195'))
    q = '<div style="background: #ffffff; border: 1px solid %s; border-radius: 16px; padding: %s; display: flex; flex-direction: column; gap: %dpx;">%s</div>' % (
        T['line'], '6px' if dense else '8px', 2 if dense else 3, rows)
    trs = [[nowrap(a['no'], 13 - (1 if dense else 0), T['ink'], 600), ellipsis(a['customer'], 13 - (1 if dense else 0)), state(a['status'], 11), money(total(a)) if a['product'] is not None else '待报价']
           for a in AFTERSALES[7:11]]
    tb = table([('售后单号', 'left'), ('客户', 'left'), ('状态', 'left'), ('费用', 'right')], trs, '130px minmax(0, 1fr) 80px 70px', py=6 if dense else 10, fs=12 if dense else 13)
    return col(row(text('紧凑' if dense else '舒适（默认）', 13, T['ink'], 600) + nowrap('队列行距 %s · 表格行高 %s' % (('2', '32') if dense else ('4', '40')), 12, T['ink3']), 8) + q + tb, 10, 'flex: 1; min-width: 0px;')


from data import AFTERSALES, total, money
dens_frame = '<div style="width: 1500px; box-sizing: border-box; padding: 20px; background: %s; display: flex; gap: 24px; align-items: flex-start;">%s%s</div>' % (T['canvas'], dens_col(False), dens_col(True))

# ---------------------------------------------------------------- G10 站内通知 + 头像菜单（周敏视角）
import ui as UI
from data import NOTIFICATIONS, STAFF, NAV_BY_ROLE, BADGES
ZM = STAFF['zhoumin']
ZM_NAV = NAV_BY_ROLE[ZM['role']]
ZM_BADGES = {k: v for k, v in BADGES.get('zhoumin', {}).items() if k in ZM_NAV}
UNREAD = sum(1 for n in NOTIFICATIONS if not n[6])


def topbar_crop(w, bell_n=UNREAD):
    """顶栏 1:1 右侧裁切（店铺范围 · 搜索 · 密度 · 铃铛 · 头像）。"""
    return '<div style="width: %dpx; height: 56px; overflow: hidden; position: relative; flex-shrink: 0;"><div style="position: absolute; right: 0px; top: 0px; width: 1440px;">%s</div></div>' % (
        w, UI._topbar(ZM_NAV, '审批', ZM, ZM_BADGES, bell_n=bell_n))


# 周敏（客服主管）能打开哪些对象的目标页：P18 渠道与店铺只对管理员开放（PRD 10.1）。打不开的通知点一条只标为已读、不跳转，
# 对象编号为灰字（同 P27「对象按查看者能否打开目标页决定可不可点」，待办 31 用户确认 10-06）
def zm_can_open(obj):
    return not obj.startswith('P18')


def notif_item(n, can_open=True):
    tm, tone, ic, title, desc, obj, read = n
    fg, bg, _ = TONES[tone]
    ico = '<div style="width: 28px; height: 28px; border-radius: 8px; background: %s; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">%s</div>' % (bg, icon(ic, 15, fg, 2))
    dot = '<div style="width: 7px; height: 7px; border-radius: 999px; background: %s; flex-shrink: 0; margin-top: 6px;"></div>' % (T['accent'] if not read else 'transparent')
    body = col(between(ellipsis(title, 13, T['ink'] if not read else T['ink2'], 600 if not read else 500), nowrap(tm, 11, T['ink4'])) +
               ellipsis(desc, 12, T['ink3']) + (nowrap(obj, 12, T['accent'], 500) if can_open else nowrap(obj, 12, T['ink2'])), 1, 'flex: 1; min-width: 0px;')
    return '<div style="display: flex; gap: 10px; align-items: flex-start; padding: 9px 10px; border-radius: 8px; background: %s;">%s%s%s</div>' % (
        T['subtle'] if not read else '#ffffff', ico, body, dot)


def notif_panel(items, unread, tab='全部', empty_html='', can_open=lambda obj: True):
    """站内通知面板（shadcn Popover + Tabs + ScrollArea），宽 360。can_open：查看者能否打开该对象的目标页。"""
    head = between(text('通知', 14, T['ink'], 700), link('全部已读', 12, 'check') if unread else nowrap('全部已读', 12, T['ink5']))
    tb = tabs([('全部', None), ('未读', unread)], tab)
    lst = ''.join(notif_item(n, can_open(n[5])) for n in items) if items else empty_html
    foot = '<div style="padding: 8px 14px; border-top: 1px solid %s; font-size: 11px; color: %s;">点一条即跳到对应对象并标为已读</div>' % (T['line2'], T['ink4']) if items else ''
    return '<div style="width: 360px; box-sizing: border-box; background: #ffffff; border: 1px solid %s; border-radius: 12px; box-shadow: %s; display: flex; flex-direction: column; overflow: hidden;"><div style="padding: 12px 14px 0px 14px; display: flex; flex-direction: column; gap: 4px;">%s%s</div><div style="padding: 6px; display: flex; flex-direction: column; gap: 2px;">%s</div>%s</div>' % (
        T['line'], SHADOW_MD, head, tb, lst, foot)


def avatar_menu(u):
    """头像菜单（shadcn DropdownMenu）：姓名、角色与部门 · 审计日志 · 密度 · 退出登录。"""
    head = '<div style="display: flex; align-items: center; gap: 10px; padding: 8px 10px 10px 10px;">%s%s</div>' % (
        avatar(u['avatar'], 'grad', 32), col(nowrap(u['name'], 13, T['ink'], 600) + nowrap('%s · %s' % (u['role'], u['dept']), 11, T['ink4']), 1))
    it = lambda t, ic, hint, c=T['ink2']: '<div style="display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 6px; font-size: 13px; color: %s;">%s<div style="flex: 1;">%s</div>%s</div>' % (
        c, icon(ic, 15, c), t, nowrap(hint, 11, T['ink4']) if hint else '')
    sep = '<div style="height: 1px; background: %s; margin: 4px 0px;"></div>' % T['line2']
    return '<div style="width: 248px; box-sizing: border-box; background: #ffffff; border: 1px solid %s; border-radius: 12px; box-shadow: %s; padding: 5px;">%s%s%s%s%s%s</div>' % (
        T['line'], SHADOW_MD, head, sep, it('审计日志', 'history', '所有角色可见'), it('密度', 'rows', '舒适 ›'), sep, it('退出登录', 'arrow_r', ''))


def cap(t):
    return nowrap(t, 12, T['ink2'], 600)


g10_a = col(cap('① 点铃铛 · 全部（周敏，未读 %d）' % UNREAD) +
            '<div style="width: 640px; height: 640px; position: relative; background: %s; border: 1px solid %s; border-radius: 12px; overflow: hidden;">%s<div style="position: absolute; right: 98px; top: 62px;">%s</div></div>' % (
                T['canvas'], T['line'], topbar_crop(640), notif_panel(NOTIFICATIONS, UNREAD, can_open=zm_can_open)), 8)
# 没有通知：第一阶段的说明不写「审批、」（11.4 审批类通知二起，待办 31 用户确认 10-06）；置灰的「全部已读」悬停写原因（协调者决定 10-06）
EMPTY_NOTE_P1 = '渠道异常、未归属店铺来信等需要你知道的事会出现在这里。'
g10_b = col(cap('② 没有通知时 · 悬停置灰的「全部已读」') +
            '<div style="position: relative; padding-top: 40px;"><div style="position: absolute; right: 0px; top: 0px;">%s</div>%s</div>' % (
                tooltip('没有未读通知'), notif_panel([], 0, '全部', empty('bell', '暂无通知', EMPTY_NOTE_P1, compact=True))), 8)
g10_c = col(cap('③ 点头像 · 头像菜单') +
            '<div style="width: 420px; height: 300px; position: relative; background: %s; border: 1px solid %s; border-radius: 12px; overflow: hidden;">%s<div style="position: absolute; right: 12px; top: 62px;">%s</div></div>' % (
                T['canvas'], T['line'], topbar_crop(420), avatar_menu(ZM)) +
            muted('「审计日志」所有角色可见（P27）：客服主管、管理员看全部，其他角色只看自己的操作记录；管理员另可从 P18 页头进入。「密度」与顶栏密度按钮是同一个设置（G9）。', 12, 'width: 420px;'), 8)
# ④ 钉钉同步失败只提醒管理员（11.4、E-32；待办 05，2026-10-06 用户确认）：刘洋视角，连续失败的第 1 次与第 3 次各一条
from data import DINGTALK_NOTIFICATIONS
g10_d = col(cap('④ 钉钉同步失败 · 只提醒管理员（刘洋）') +
            '<div style="width: 360px; box-sizing: border-box; background: #ffffff; border: 1px solid %s; border-radius: 12px; box-shadow: %s; padding: 6px; display: flex; flex-direction: column; gap: 2px;">%s</div>' % (
                T['line'], SHADOW_MD, ''.join(notif_item(n) for n in DINGTALK_NOTIFICATIONS)) +
            muted('通讯录每个整点全量对账一次，失败不重试。连续失败的第 1 次发「钉钉同步失败」，第 3 次（P18 钉钉卡转「连接异常」）发「钉钉连接异常」，之后不重复；恢复后不发。只发站内，不发钉钉工作通知，不出全站横幅（G4）。', 12, 'width: 360px;'), 8)
g10_frame = '<div style="width: 1510px; box-sizing: border-box; padding: 20px; background: %s; display: flex; flex-direction: column; gap: 24px;"><div style="display: flex; gap: 24px; align-items: flex-start;">%s%s%s</div>%s</div>' % (T['canvas'], g10_a, g10_b, g10_c, g10_d)


# ---------------------------------------------------------------- G11 登录 · G12 登录被拒
def qr_svg(size=168, n=25, seed=11):
    """示意二维码：三个定位角 + 伪随机模块（固定种子，生成结果稳定）。"""
    import random
    rnd = random.Random(seed)
    fin = [(0, 0), (n - 7, 0), (0, n - 7)]
    rects = []
    for x0, y0 in fin:
        rects += ['<rect x="%d" y="%d" width="7" height="7"></rect>' % (x0, y0), '<rect x="%d" y="%d" width="5" height="5" fill="#ffffff"></rect>' % (x0 + 1, y0 + 1),
                  '<rect x="%d" y="%d" width="3" height="3"></rect>' % (x0 + 2, y0 + 2)]
    for y in range(n):
        for x in range(n):
            if any(x0 - 1 <= x <= x0 + 7 and y0 - 1 <= y <= y0 + 7 for x0, y0 in fin):
                continue
            if rnd.random() < 0.46:
                rects.append('<rect x="%d" y="%d" width="1" height="1"></rect>' % (x, y))
    return '<svg width="%d" height="%d" viewBox="-1 -1 %d %d" fill="%s" shape-rendering="crispEdges" style="display: block;">%s</svg>' % (size, size, n + 2, n + 2, T['ink'], ''.join(rects))


def qr_box(expired=False):
    ov = ''
    if expired:
        ov = '<div style="position: absolute; inset: 0px; background: rgba(255,255,255,0.93); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;">%s%s</div>' % (
            nowrap('二维码已过期', 13, T['ink'], 600), btn('刷新', 'primary', 'sm', 'refresh'))
    return '<div style="position: relative; padding: 10px; border: 1px solid %s; border-radius: 12px; background: #ffffff;">%s%s</div>' % (T['line'], qr_svg(), ov)


def auth_card(inner, w=360):
    """登录卡片：品牌 + 内容（G11 二维码；G12 换成被拒说明）。"""
    return '<div style="width: %dpx; box-sizing: border-box; background: #ffffff; border: 1px solid %s; border-radius: 16px; box-shadow: %s; padding: 24px 24px 20px 24px; display: flex; flex-direction: column; align-items: center; gap: 14px;">%s%s</div>' % (
        w, T['line'], SHADOW_CARD, UI._brand('Support'), inner)


login_note = '<div style="font-size: 12px; color: %s; line-height: 1.55; text-align: center; border-top: 1px solid %s; padding-top: 12px; align-self: stretch;">成员与部门来自钉钉通讯录，由管理员在本系统分配角色后才能进入</div>' % (T['ink3'], T['line2'])
login_card = auth_card(col(text('用钉钉扫码登录', 16, T['ink'], 700, 'text-align: center;') + muted('打开钉钉，扫一扫下方二维码', 12, 'text-align: center;'), 2) +
                       qr_box() + nowrap('二维码 2 分钟内有效', 12, T['ink4']) + login_note)
g11_frame = mini(row(
    '<div style="flex: 1; align-self: stretch; display: flex; align-items: center; justify-content: center; background: %s; border-radius: 12px;">%s</div>' % (T['canvas'], login_card) +
    col(cap('2 分钟后过期 · 蒙层 +「刷新」') + qr_box(True) + muted('刷新后生成新二维码，重新计时 2 分钟。', 12, 'width: 190px;'), 10, 'width: 210px; flex-shrink: 0;'),
    20, 'center', extra='flex: 1;'), 880, 680, '#ffffff', '20px')


def deny(tag, ic, title, desc, action=None, who=''):
    return col(cap(tag) + auth_card(who + empty(ic, title, desc, action, compact=True), 410), 8)


chengong = STAFF['chengong']
who_cg = row(avatar(chengong['avatar'], 'amber', 24) + nowrap('%s · %s · %s' % (chengong['name'], chengong['dept'], chengong['role']), 12, T['ink3']), 8)
g12_frame = mini(grid(
    deny('未分配角色', 'user', '还没有分配角色', '你的钉钉账号还没有在本系统分配角色，请联系管理员刘洋。', btn('返回登录页', 'secondary', 'md', 'chev_l')) +
    deny('账号已停用', 'lock', '账号已停用', '你的账号已停用（钉钉离职或管理员停用）。', btn('返回登录页', 'secondary', 'md', 'chev_l')) +
    deny('会话过期', 'clock', '已退出登录', '7 天未操作，已退出登录。', btn('重新扫码登录', 'primary', 'md', 'refresh')) +
    deny('第一阶段 · 生产厂对接人', 'factory', '暂时无法进入', '工厂工作台第二阶段上线，目前无法进入。', None, who_cg),
    2, 20), 880, 680, '#ffffff', '20px')


# ---------------------------------------------------------------- G11 · G12 补充小样（第一阶段实现，待办 05，2026-10-06 确认）
def qr_box_loading():
    """二维码还没取到（或取不到）时格子里是骨架。"""
    return '<div style="padding: 10px; border: 1px solid %s; border-radius: 12px; background: #ffffff;">%s</div>' % (T['line'], skel('168px', 168, 6))


login_card_loading = auth_card(col(text('用钉钉扫码登录', 16, T['ink'], 700, 'text-align: center;') + muted('打开钉钉，扫一扫下方二维码', 12, 'text-align: center;'), 2) +
                               qr_box_loading() + nowrap('二维码 2 分钟内有效', 12, T['ink4']) + login_note)
signing_in_card = auth_card(row(icon('spinner', 16, T['ink3'], 2) + nowrap('正在登录…', 13, T['ink3']), 8, extra='padding: 24px 0px;'))
retry_link = link('立即重试')
g1112_frame = '<div style="width: 1792px; box-sizing: border-box; padding: 20px; background: %s; display: flex; gap: 24px; align-items: flex-start;">%s%s%s%s</div>' % (
    T['canvas'],
    col(cap('① 取二维码失败 · 格子保留骨架') + login_card_loading + toast('error', '加载二维码失败：网络不可用', None, retry_link), 10, 'width: 380px;'),
    col(cap('② 钉钉扫码框加载不出来（真实接口）') + login_card_loading + toast('error', '登录失败：暂时连不上钉钉', '请稍后重新扫码；仍不行请联系管理员。', retry_link), 10, 'width: 380px;'),
    col(cap('③ 扫码确认后 · 换会话') + signing_in_card, 10, 'width: 380px;'),
    col(cap('④ 换会话失败 · 回到二维码并弹浮层') +
        toast('error', '登录失败：扫码结果已失效', '请重新扫码。') +
        toast('error', '登录失败：登录已过期', '请重新扫码。') +
        toast('error', '登录失败：暂时连不上钉钉', '请稍后重新扫码；仍不行请联系管理员。'), 10, 'width: 380px;'))

gs_body = col(
    grid(variant('G1 整页加载', '首屏数据超过 300ms 未返回时显示骨架屏，保留外壳与导航；超过 10 秒转为加载失败（第 9 节）。', scaled(page_skel)) +
         variant('G2 无权限（403）', '导航里不显示无权限入口；从链接直接进入无权页面时显示本页，写明哪个角色能看（例「「渠道与店铺」只对管理员开放。你当前的角色是坐席，如需开通请联系管理员刘洋」）。按钮只有「返回首页」，回到该角色的默认首页（4.1，本例坐席为收件箱）；没有「申请权限」。', focus(page_403, key_403)), 2, 32) +
    grid(variant('G3 找不到（404）', '单号不存在或链接不完整时显示（例「工单 T-20260801-9999 不存在，请检查编号或链接是否完整」），提供按订单号搜索的出口；不写保留策略（个人信息长期保留，D-21）。', focus(page_404, key_404)) +
         variant('G4 网络断开 + 集成中断', '浏览器断网：整页提示，未发送的草稿保存在本机；恢复连接后自动重试未完成的提交与同步，并用 G5 浮层提示结果（成功为中性「已自动重新提交 N 项」，仍失败给「立即重试」），与 F7、K6 一致。Gmail、积加、SP-API 或 Shopify 中断：全站顶部红色横幅，写「管理员、客服主管已收到通知」；横幅不可关闭，连接恢复后自动消失并自动补收。「查看渠道状态」按钮只对管理员显示（本图为坐席李婷视角，不显示）。钉钉同步异常不出全站横幅，只在 P18 钉钉卡显示、只给管理员站内提醒（6.9）。', focus(page_offline, key_offline, h=500)), 2, 32) +
    grid(variant('G5 浮层提示', '右上角堆叠，最多 3 条。成功与信息 3 秒消失；失败与警示不自动消失，必须给出重试或下一步；断网导致的失败在恢复后自动重试并再次提示结果（同 G4）。可逆操作（关闭工单、驳回、撤回）直接执行，弹 5 秒「撤销」浮层，倒计时结束前不消失。', toasts_frame, 700) +
         variant('G6 二次确认（只用于不可逆操作）', '执行退款、终止流程、停用成员、录入最终比例（锁定）、生成结算批次前确认；默认焦点在「取消」，Esc 取消。关闭工单、驳回、撤回等可逆操作不确认，改为 G5 的撤销浮层；驳回、终止的原因仍必填。', confirm_frame, 700), 2, 32) +
    grid(variant('G7 并发与数据范围', '同一工单只允许一人编辑回复；编辑期间来新信则草稿失效提醒；访问无权店铺的数据用信息色横幅说明范围（不是错误）。乐观锁冲突（保存时发现记录已被他人修改）：提示「这条记录刚被王磊修改（10:18）」并写明对方改了哪些项，你的输入保留不丢；给出「查看最新」与「覆盖保存」，覆盖需二次确认（默认焦点在「取消」），覆盖记入审计日志。', conflict_frame, 700) +
         variant('G8 未保存离开', '草稿类（回复框、内部备注）自动保存，离开时只弹「草稿已保存」浮层，不拦截。表单类（设置页）有未保存修改时弹窗：继续编辑 · 放弃修改 · 保存并离开，默认焦点在「继续编辑」。', unsaved_frame, 700), 2, 32) +
    variant('G9 密度切换', '第一期提供舒适（默认）与紧凑两档（Q-24）。顶栏「密度」按钮切换，按用户保存；只改字号、行距与内边距，不改布局和信息量。紧凑：正文 12、次要 11（中文最小 11）、队列行内边距 6、行距 2、表格行高 32。两档一致：队列卡片左侧色条只表示风险（转人工红），选中用浅底 + 描边。', dens_frame, 1500,
            trigger='点顶栏「密度」按钮（图标：三条横线）。') +
    variant('G10 站内通知', '顶栏铃铛带未读数（本例 %d）；点开 360px 面板，页签「全部 · 未读」，每条写类型图标、标题、说明、对象编号与时间（当天只写时:分，之前的写「月-日 时:分」，不在今年的写全年份，同 P27），未读带圆点并用浅底；点一条即跳到对象并标为已读——查看者打不开目标页的（如客服主管收到的渠道通知，P18 只对管理员开放）只标为已读、不跳转，对象编号为灰字（同 P27）；右上「全部已读」，没有未读时置灰、悬停写「没有未读通知」；没有通知时显示空状态（第一阶段说明不写「审批、」，第二阶段起写「审批、渠道异常、未归属店铺来信等……」）。头像菜单：姓名、角色与部门（来自钉钉），「审计日志」所有角色可见（P27，按 10.2 过滤），「密度」同 G9，「退出登录」。示例为完整版；第一阶段只有 11.4 中阶段为「一起」的通知类型。④ 钉钉同步失败只提醒管理员（刘洋视角，待办 05，10-06 用户确认）：连续失败的第 1 次「钉钉同步失败」、第 3 次「钉钉连接异常」，对象「P18 · 钉钉」，之后不重复，恢复后不发。' % UNREAD,
            g10_frame, 1510, trigger='点顶栏铃铛；点顶栏头像。示例为周敏 · 客服主管（data.NOTIFICATIONS）；④ 为刘洋 · 管理员（data.DINGTALK_NOTIFICATIONS）。') +
    grid(variant('G11 登录', '居中卡片：产品名、「用钉钉扫码登录」二维码（2 分钟过期，过期后二维码上加蒙层与「刷新」），下方说明「成员与部门来自钉钉通讯录，由管理员在本系统分配角色后才能进入」。在钉钉内打开时免登（第二阶段）。会话 7 天无操作过期（G12）。', g11_frame, 880,
                 trigger='未登录或会话过期后访问任意页面。') +
         variant('G12 登录被拒', '同一张登录卡片换成被拒说明，三种：未分配角色、账号已停用、会话过期（「重新扫码登录」）。第一阶段不分配「生产厂对接人」角色，已分配者扫码后看到「工厂工作台第二阶段上线，目前无法进入」（4.1）。', g12_frame, 880,
                 trigger='扫码成功但不能进入系统；或 7 天未操作。'), 2, 32) +
    variant('G11 · G12 补充小样（第一阶段实现时确认，待办 05，10-06）', '① 取二维码失败：格子保留骨架，右上角失败浮层「加载二维码失败：<原因>」+「立即重试」（例为断网）；② 真实接口时钉钉的扫码框加载不出来：格子保留骨架，浮层「登录失败：暂时连不上钉钉」+ 说明 +「立即重试」；③ 扫码确认后钉钉把浏览器带回本系统，换会话期间卡片里写「正在登录…」；④ 换会话失败时回到二维码并弹失败浮层（不自动消失；下一步是重新扫码，不给重试）：扫码结果已失效、登录已过期（这次扫码登录超过 10 分钟，或在别的页签又开了一次）、暂时连不上钉钉。被拒（G12）不弹浮层，换成被拒说明。', g1112_frame, 1792,
            trigger='取二维码或加载钉钉扫码框失败；扫码确认后换会话；换会话失败。'),
    32)
save('GlobalStates.dc.html', board('全局状态与反馈', '所有页面共用的加载、无权限、找不到、断网、集成中断、提示、确认、并发、未保存、密度切换、站内通知与登录状态（G1–G12）。各模块自己的状态见对应状态板。演示时刻 %s。' % NOW_LABEL, gs_body, 1920, 2400))
print('ok')
