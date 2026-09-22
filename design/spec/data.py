# -*- coding: utf-8 -*-
"""
Forcome Support 统一示例数据（原型唯一数据源）

规则：
1. 所有原型页面的客户、订单、工单、售后单、审批单、金额、时间都从这里取，不得在页面里另编。
2. 演示时刻 NOW = 2026-09-11（周五）10:20，北京时间。页面上的「剩余」「已等」都按这个时刻计算。
3. 生产厂两家：FQD、FZJ（集团内部）。工作日为周一至周五 09:00–18:00，不扣节假日。
4. 金额：台账与结算统一用 USD；欧元、英镑订单保留原币，并按演示汇率 1 EUR = 1.10 USD、1 GBP = 1.27 USD 折算。
5. 数字需要合计时调用本文件里的函数，不要手算。
"""

NOW = '2026-09-11 10:20'
NOW_LABEL = '2026-09-11 周五 10:20'
EUR_USD = 1.10
GBP_USD = 1.27

# ---------------------------------------------------------------- 人员与角色
STAFF = {
    'liting':   {'name': '李婷', 'avatar': '婷', 'role': '坐席', 'stores': '全部店铺', 'lang': 'EN'},
    'chenchen': {'name': '陈晨', 'avatar': '晨', 'role': '坐席', 'stores': '全部店铺', 'lang': 'DE · EN'},
    'zhoumin':  {'name': '周敏', 'avatar': '敏', 'role': '客服主管', 'stores': '全部店铺'},
    'wanglei':  {'name': '王磊', 'avatar': '磊', 'role': '售后负责人', 'stores': '全部店铺'},
    'zhaoqian': {'name': '赵倩', 'avatar': '倩', 'role': '知识库负责人', 'stores': '全部店铺'},
    'liuyang':  {'name': '刘洋', 'avatar': '洋', 'role': '管理员', 'stores': '全部店铺'},
    'chengong': {'name': '陈工', 'avatar': '陈', 'role': '生产厂对接人', 'factory': 'FQD'},
    'liucz':    {'name': '刘厂长', 'avatar': '刘', 'role': '生产厂负责人', 'factory': 'FQD'},
    'zhanggong': {'name': '张工', 'avatar': '张', 'role': '生产厂对接人', 'factory': 'FZJ'},
    'zhoucz':   {'name': '周厂长', 'avatar': '周', 'role': '生产厂负责人', 'factory': 'FZJ'},
}

# ---------------------------------------------------------------- 生产厂（集团内部，两家）
# 售后单按配件（或整机）对应的生产厂派发任务、协商比例、按月结算；对应关系在 P20「工厂账号」配置（示例，待确认 Q-22）。
FACTORIES = {
    'FQD': {'code': 'FQD', 'scope': '整机及结构件：整机、电池、软管、HEPA 滤芯、集尘杯', 'contact': '陈工', 'head': '刘厂长'},
    'FZJ': {'code': 'FZJ', 'scope': '线材与电源：充电线', 'contact': '张工', 'head': '周厂长'},
}
PART_FACTORY = {'FC-V2-BLK': 'FQD', 'FC-V2-BT01': 'FQD', 'FC-V2-HS02': 'FQD', 'FC-V2-HF01': 'FQD', 'FC-V2-DC01': 'FQD', 'FC-V2-CB01': 'FZJ'}

# 各角色在左侧导航里能看到的入口（没有权限的入口不显示；直接访问链接显示 403 状态）
NAV_BY_ROLE = {
    '坐席':       ['收件箱', '工单', '售后', '审批', '知识库'],
    '客服主管':   ['收件箱', '工单', '售后', '审批', '知识库', '报表', '设置'],
    '售后负责人': ['收件箱', '工单', '售后', '审批', '知识库', '报表'],
    '知识库负责人': ['工单', '知识库', '报表'],
    '管理员':     ['报表', '设置'],
}
FACTORY_NAV = ['待办', '已完成', '结算']

# ---------------------------------------------------------------- 店铺
STORES = [
    # 亚马逊：买家消息走亚马逊官方邮件中转，收发都在该店铺绑定的邮箱（Gmail API）；订单走 SP-API。Shopify：客服邮箱（Gmail API）+ Admin API。
    {'id': 'amz-direct', 'name': 'Forcome Direct', 'platform': '亚马逊', 'sites': ['US', 'DE', 'UK'], 'mailbox': 'amz-direct@forcome.com', 'api': 'SP-API', 'sid': '卖家 ID A1FD7Q2M9XK3LC', 'signature': 'Forcome Support'},
    {'id': 'amz-auto',   'name': 'Forcome Auto',   'platform': '亚马逊', 'sites': ['US'],             'mailbox': 'amz-auto@forcome.com',   'api': 'SP-API', 'sid': '卖家 ID A3KA8V1T6RW2NB', 'signature': 'Forcome Auto Care'},
    {'id': 'shop-com',   'name': 'forcome.com',    'platform': 'Shopify', 'sites': ['US'],            'mailbox': 'support@forcome.com',    'api': 'Admin API', 'sid': 'forcome-com.myshopify.com', 'signature': 'Forcome Support'},
    {'id': 'shop-eu',    'name': 'forcome.eu',     'platform': 'Shopify', 'sites': ['DE', 'UK'],      'mailbox': 'support@forcome.eu',     'api': 'Admin API', 'sid': 'forcome-eu.myshopify.com', 'signature': 'Forcome Europe'},
]

# ---------------------------------------------------------------- 配件与商品
PARTS = {
    'FC-V2-HF01': 'HEPA 滤芯组件',
    'FC-V2-HS02': '软管',
    'FC-V2-BT01': '电池',
    'FC-V2-CB01': '充电线',
    'FC-V2-DC01': '集尘杯',
    'FC-V2-BLK':  '车载吸尘器 V2 黑色（整机）',
}

# ---------------------------------------------------------------- 工单
# status 取值只能是：分诊中 待审草稿 待审批 转人工 等客户 等内部 等外部 已解决 已关闭 已合并
TICKETS = [
    {'no': 'T-20260902-0071', 'customer': 'Jonas Weber', 'store': 'Forcome Direct', 'channel': '亚马逊', 'site': 'DE',
     'subject': 'Gerät funktioniert nach 2 Wochen nicht mehr', 'intent': '退货与退款', 'sentiment': '负面', 'priority': '紧急',
     'status': '转人工', 'reason': '平台风险 · 差评威胁；重复联系 1 次', 'owner': '陈晨', 'sla_left': '0h 55m', 'sla_level': 'danger',
     'last_in': '09-10 11:15', 'order': '302-8811234-9901122', 'tags': ['差评风险'], 'lang': '德语',
     'aftersales': ['S-20260903-0012', 'S-20260911-0020']},
    {'no': 'T-20260910-0192', 'customer': 'Sarah Mitchell', 'store': 'Forcome Direct', 'channel': '亚马逊', 'site': 'US',
     'subject': "Tracking hasn't updated since Sep 5", 'intent': '未收到与异常', 'sentiment': '负面', 'priority': '高',
     'status': '待审草稿', 'owner': '李婷', 'sla_left': '5h 40m', 'sla_level': 'warning', 'last_in': '09-10 16:00',
     'order': '113-4567890-1234567', 'tags': ['路途急', '物流停滞'], 'lang': '英语'},
    {'no': 'T-20260910-0195', 'customer': 'Marcus Lee', 'store': 'Forcome Auto', 'channel': '亚马逊', 'site': 'US',
     'subject': 'Received the wrong color, ordered black', 'intent': '到货问题', 'sentiment': '负面', 'priority': '高',
     'status': '待审批', 'owner': '李婷', 'sla_left': '11h 10m', 'sla_level': 'normal', 'last_in': '09-10 21:30',
     'order': '113-9988776-5544332', 'tags': [], 'lang': '英语', 'aftersales': ['S-20260911-0021']},
    {'no': 'T-20260910-0176', 'customer': 'Emily Chen', 'store': 'forcome.com', 'channel': 'Shopify', 'site': 'US',
     'subject': 'Does the V2 fit a Tesla Model Y 12V socket?', 'intent': '产品咨询', 'sentiment': '中性', 'priority': '普通',
     'status': '待审草稿', 'owner': '未分配', 'sla_left': '1h 28m', 'sla_level': 'danger', 'sla_kind': '内部目标',
     'last_in': '09-10 11:48', 'order': None, 'tags': [], 'lang': '英语'},
    {'no': 'T-20260911-0031', 'customer': 'Olivia Turner', 'store': 'forcome.com', 'channel': 'Shopify', 'site': 'US',
     'subject': 'Vacuum loses suction after a few weeks', 'intent': '产品故障与使用问题', 'sentiment': '中性', 'priority': '普通',
     'status': '待审草稿', 'owner': '李婷', 'sla_left': '22h 52m', 'sla_level': 'normal', 'sla_kind': '内部目标',
     'last_in': '09-11 09:12', 'order': '#1063', 'tags': [], 'lang': '英语'},
    {'no': 'T-20260910-0170', 'customer': 'Priya Raman', 'store': 'forcome.com', 'channel': 'Shopify', 'site': 'US',
     'subject': 'Can I change my shipping address?', 'intent': '修改订单', 'sentiment': '中性', 'priority': '普通',
     'status': '待审批', 'owner': '李婷', 'sla_left': '已回复', 'sla_level': 'none', 'last_in': '09-10 10:05',
     'order': '#1057', 'tags': [], 'lang': '英语'},
    {'no': 'T-20260911-0035', 'customer': 'Ethan Brooks', 'store': 'Forcome Direct', 'channel': '亚马逊', 'site': 'US',
     'subject': 'Cable does not charge the vacuum', 'intent': '产品故障与使用问题', 'sentiment': '中性', 'priority': '普通',
     'status': '等内部', 'reason': '待售后确认 S-20260911-0022', 'owner': '李婷', 'sla_left': '已回复', 'sla_level': 'none',
     'last_in': '09-11 09:58', 'order': '114-7788990-2233441', 'tags': [], 'lang': '英语', 'aftersales': ['S-20260911-0022']},
    {'no': 'T-20260910-0201', 'customer': 'Laura Bennett', 'store': 'Forcome Auto', 'channel': '亚马逊', 'site': 'US',
     'subject': 'Filter turned yellow and suction dropped', 'intent': '产品故障与使用问题', 'sentiment': '中性', 'priority': '普通',
     'status': '等内部', 'reason': '售后单 S-20260911-0018 进行中', 'owner': '李婷', 'sla_left': '已回复', 'sla_level': 'none',
     'last_in': '09-10 22:10', 'order': '111-2233445-5566778', 'tags': [], 'lang': '英语', 'aftersales': ['S-20260911-0018']},
    {'no': 'T-20260910-0188', 'customer': 'Lukas Braun', 'store': 'Forcome Direct', 'channel': '亚马逊', 'site': 'DE',
     'subject': 'Schlauch ist gerissen', 'intent': '产品故障与使用问题', 'sentiment': '中性', 'priority': '普通',
     'status': '等内部', 'reason': '售后单 S-20260911-0019 等生产厂报价', 'owner': '陈晨', 'sla_left': '已回复', 'sla_level': 'none',
     'last_in': '09-10 13:30', 'order': '305-1122334-4455667', 'tags': [], 'lang': '德语', 'aftersales': ['S-20260911-0019']},
    {'no': 'T-20260909-0142', 'customer': 'Ana Souza', 'store': 'forcome.com', 'channel': '邮件', 'site': 'US',
     'subject': 'Wholesale pricing for 200 units?', 'intent': '批发与合作', 'sentiment': '中性', 'priority': '普通',
     'status': '等内部', 'reason': '已转销售', 'owner': '陈晨', 'sla_left': '已回复', 'sla_level': 'none',
     'last_in': '09-09 14:00', 'order': None, 'tags': ['批发'], 'lang': '英语'},
    {'no': 'T-20260904-0098', 'customer': 'Oliver Grant', 'store': 'Forcome Direct', 'channel': '亚马逊', 'site': 'UK',
     'subject': 'Charger cable not working', 'intent': '产品故障与使用问题', 'sentiment': '正面', 'priority': '普通',
     'status': '已解决', 'reason': '09-17 自动关闭', 'owner': '李婷', 'sla_left': '—', 'sla_level': 'none',
     'last_in': '09-10 09:00', 'order': '204-5566778-9900112', 'tags': [], 'lang': '英语', 'aftersales': ['S-20260905-0014']},
    {'no': 'T-20260909-0131', 'customer': 'Mia Johnson', 'store': 'forcome.eu', 'channel': 'Shopify', 'site': 'UK',
     'subject': 'How often should I replace the filter?', 'intent': '产品咨询', 'sentiment': '中性', 'priority': '普通',
     'status': '已解决', 'owner': '李婷', 'sla_left': '—', 'sla_level': 'none', 'last_in': '09-09 08:40',
     'order': None, 'tags': [], 'lang': '英语'},
    {'no': 'T-20260909-0128', 'customer': 'Felix Wagner', 'store': 'Forcome Direct', 'channel': '亚马逊', 'site': 'DE',
     'subject': 'Rückerstattung für Rücksendung', 'intent': '退货与退款', 'sentiment': '中性', 'priority': '普通',
     'status': '等客户', 'owner': '陈晨', 'sla_left': '—', 'sla_level': 'none', 'last_in': '09-09 17:20',
     'order': '302-4455667-1122334', 'tags': [], 'lang': '德语'},
]

# 已结束的历史工单（只在客户档案、售后单里被引用）
HISTORY_TICKETS = {
    'T-20260909-0163': ('Marcus Lee', '集尘杯卡扣断裂', '已解决', 'S-20260910-0017'),
    'T-20260907-0122': ('Hannah Ross', '电池续航骤降', '已解决', 'S-20260908-0015'),
    'T-20260908-0140': ('David Park', '软管接口松脱', '已解决', 'S-20260909-0016'),
    'T-20260903-0087': ('Emily Chen', 'HEPA 滤芯发黄', '已关闭', 'S-20260904-0013'),
    'T-20260901-0059': ('Priya Raman', '包裹延误 9 天', '已关闭', 'S-20260902-0011'),
    'T-20260831-0044': ('Noah Kim', '集尘杯装不上', '已关闭', 'S-20260901-0010'),
    'T-20260614-0117': ('Sarah Mitchell', '查询物流进度', '已关闭', None),
}

# ---------------------------------------------------------------- 售后单
# status：待确认 进行中 已完成 已取消
# method（处理方式）：调整安装方式 / 寄配件 / 退款或部分补偿
# branch：良仓有货 / 良仓无货 / —
# resp（责任类型）：客户使用问题 / 产品质量问题 / 物流问题 / 其他
# filing（报备）：(类型, 状态) 类型为 快递费用 / 额外赔偿；状态为 待审批 已批准 已驳回；不需要报备写 None
# ratio：(FSH%, 工厂%)；ratio_state：建议 / 已确认 / 不适用
# nego（协商状态）：不适用 未发起 待工厂答复 工厂还价 待升级 已确认
# settle（结算状态）：不适用 未定 待结算 已结算
AFTERSALES = [
    {'no': 'S-20260901-0010', 'factory': None, 'customer': 'Noah Kim', 'store': 'Forcome Direct', 'site': 'US', 'ticket': 'T-20260831-0044',
     'method': '调整安装方式', 'branch': '—', 'resp': '客户使用问题', 'part': None, 'qty': 0, 'tracking': None,
     'product': 0.0, 'freight': 0.0, 'comp': 0.0, 'other': 0.0, 'filing': None, 'ratio': (100, 0), 'ratio_state': '不适用',
     'nego': '不适用', 'settle': '不适用', 'status': '已完成', 'step': '已完成', 'waiting': '—', 'owner': '王磊', 'initiator': '李婷', 'reg': '自动'},
    {'no': 'S-20260902-0011', 'factory': None, 'customer': 'Priya Raman', 'store': 'forcome.com', 'site': 'US', 'ticket': 'T-20260901-0059',
     'method': '退款或部分补偿', 'branch': '—', 'resp': '物流问题', 'part': None, 'qty': 0, 'tracking': None,
     'product': 0.0, 'freight': 0.0, 'comp': 12.00, 'other': 0.0, 'filing': ('额外赔偿', '已批准'), 'ratio': (100, 0), 'ratio_state': '不适用',
     'nego': '不适用', 'settle': '不适用', 'status': '已完成', 'claim': '向 USPS 索赔', 'claim_state': '索赔中', 'step': '已完成 · 向 USPS 索赔中', 'waiting': '—', 'owner': '王磊', 'initiator': '陈晨', 'reg': '自动'},
    {'no': 'S-20260903-0012', 'factory': 'FQD', 'customer': 'Jonas Weber', 'store': 'Forcome Direct', 'site': 'DE', 'ticket': 'T-20260902-0071',
     'method': '寄配件', 'branch': '良仓无货', 'resp': '产品质量问题', 'part': 'FC-V2-BT01', 'qty': 1, 'tracking': 'YT2625100012340921',
     'product': 9.80, 'freight': 13.60, 'comp': 0.0, 'other': 0.0, 'filing': ('快递费用', '已批准'), 'ratio': (0, 100), 'ratio_state': '建议',
     'counter': (50, 50), 'nego': '待升级', 'settle': '未定', 'status': '已完成', 'step': '比例协商 · 待升级', 'waiting': '双方负责人',
     'waited': '2 天', 'owner': '王磊', 'reg': '王磊手工'},
    {'no': 'S-20260904-0013', 'factory': 'FQD', 'customer': 'Emily Chen', 'store': 'forcome.com', 'site': 'US', 'ticket': 'T-20260903-0087',
     'method': '寄配件', 'branch': '良仓有货', 'resp': '产品质量问题', 'part': 'FC-V2-HF01', 'qty': 2, 'tracking': '1Z4R28830358229041',
     'product': 6.40, 'freight': 6.80, 'comp': 0.0, 'other': 0.0, 'filing': ('快递费用', '已批准'), 'ratio': (0, 100), 'ratio_state': '已确认',
     'nego': '已确认', 'settle': '已结算', 'batch': '2026-09-A', 'status': '已完成', 'step': '已完成 · 已结算', 'waiting': '—', 'owner': '王磊', 'reg': '自动'},
    {'no': 'S-20260905-0014', 'factory': 'FZJ', 'customer': 'Oliver Grant', 'store': 'Forcome Direct', 'site': 'UK', 'ticket': 'T-20260904-0098',
     'method': '寄配件', 'branch': '良仓有货', 'resp': '产品质量问题', 'part': 'FC-V2-CB01', 'qty': 1, 'tracking': '1Z4R28830358229052',
     'product': 1.40, 'freight': 5.90, 'comp': 0.0, 'other': 0.0, 'filing': ('快递费用', '已批准'), 'ratio': (0, 100), 'ratio_state': '已确认',
     'nego': '已确认', 'settle': '已结算', 'batch': '2026-09-A', 'status': '已完成', 'step': '已完成 · 已结算', 'waiting': '—', 'owner': '王磊', 'reg': '自动'},
    {'no': 'S-20260908-0015', 'factory': 'FQD', 'customer': 'Hannah Ross', 'store': 'Forcome Direct', 'site': 'US', 'ticket': 'T-20260907-0122',
     'method': '寄配件', 'branch': '良仓无货', 'resp': '其他', 'part': 'FC-V2-BT01', 'qty': 1, 'tracking': 'YT2625100012345678',
     'product': 9.80, 'freight': 12.30, 'comp': 0.0, 'other': 0.0, 'filing': ('快递费用', '已批准'), 'ratio': (50, 50), 'ratio_state': '已确认',
     'nego': '已确认', 'settle': '待结算', 'status': '已完成', 'step': '待内部结算', 'waiting': '月度结算', 'owner': '王磊', 'reg': '王磊手工'},
    {'no': 'S-20260909-0016', 'factory': 'FQD', 'customer': 'David Park', 'store': 'forcome.com', 'site': 'US', 'ticket': 'T-20260908-0140',
     'method': '寄配件', 'branch': '良仓有货', 'resp': '客户使用问题', 'part': 'FC-V2-HS02', 'qty': 1, 'tracking': '1Z4R28830358229088',
     'product': 2.60, 'freight': 6.80, 'comp': 0.0, 'other': 0.0, 'filing': ('快递费用', '已批准'), 'ratio': (100, 0), 'ratio_state': '不适用',
     'nego': '不适用', 'settle': '不适用', 'status': '已完成', 'step': '已完成', 'waiting': '—', 'owner': '王磊', 'initiator': '李婷', 'reg': '自动'},
    {'no': 'S-20260910-0017', 'factory': 'FQD', 'customer': 'Marcus Lee', 'store': 'Forcome Direct', 'site': 'US', 'ticket': 'T-20260909-0163',
     'method': '寄配件', 'branch': '良仓有货', 'resp': '产品质量问题', 'part': 'FC-V2-DC01', 'qty': 1, 'tracking': '1Z4R28830358229101',
     'product': 4.10, 'freight': 6.80, 'comp': 0.0, 'other': 0.0, 'filing': ('快递费用', '已批准'), 'ratio': (0, 100), 'ratio_state': '已确认',
     'nego': '已确认', 'settle': '待结算', 'status': '已完成', 'step': '待内部结算', 'waiting': '月度结算', 'owner': '王磊', 'reg': '自动'},
    {'no': 'S-20260911-0018', 'factory': 'FQD', 'customer': 'Laura Bennett', 'store': 'Forcome Auto', 'site': 'US', 'ticket': 'T-20260910-0201',
     'method': '寄配件', 'branch': '良仓无货', 'resp': '产品质量问题', 'part': 'FC-V2-HF01', 'qty': 1, 'tracking': None,
     'product': 3.20, 'freight': 11.50, 'comp': 0.0, 'other': 0.0, 'filing': ('快递费用', '待审批'), 'ratio': (0, 100), 'ratio_state': '建议',
     'nego': '未发起', 'settle': '未定', 'status': '进行中', 'step': '报备审批 · 快递费用', 'waiting': '客服主管 周敏', 'waited': '39m',
     'owner': '王磊', 'reg': '自动', 'approval': 'AP-20260911-003'},
    {'no': 'S-20260911-0019', 'factory': 'FQD', 'customer': 'Lukas Braun', 'store': 'Forcome Direct', 'site': 'DE', 'ticket': 'T-20260910-0188',
     'method': '寄配件', 'branch': '良仓无货', 'resp': '产品质量问题', 'part': 'FC-V2-HS02', 'qty': 2, 'tracking': None,
     'product': None, 'freight': None, 'comp': 0.0, 'other': 0.0, 'filing': None, 'ratio': (0, 100), 'ratio_state': '建议',
     'nego': '未发起', 'settle': '未定', 'status': '进行中', 'step': '生产厂报价', 'waiting': '生产厂 FQD', 'waited': '1h 30m · 剩 2 个工作日',
     'owner': '王磊', 'reg': '自动'},
    {'no': 'S-20260911-0020', 'factory': 'FQD', 'customer': 'Jonas Weber', 'store': 'Forcome Direct', 'site': 'DE', 'ticket': 'T-20260902-0071',
     'method': '退款或部分补偿', 'branch': '—', 'resp': '产品质量问题', 'part': None, 'qty': 0, 'tracking': None,
     'product': 0.0, 'freight': 0.0, 'comp': 49.39, 'comp_orig': '€44.90', 'other': 0.0, 'filing': ('额外赔偿', '待审批'), 'ratio': (0, 100), 'ratio_state': '建议',
     'nego': '未发起', 'settle': '未定', 'status': '进行中', 'step': '报备审批 · 额外赔偿', 'waiting': '客服主管 周敏', 'waited': '50m',
     'owner': '王磊', 'initiator': '陈晨', 'reg': '自动', 'approval': 'AP-20260911-001'},
    {'no': 'S-20260911-0021', 'factory': None, 'customer': 'Marcus Lee', 'store': 'Forcome Auto', 'site': 'US', 'ticket': 'T-20260910-0195',
     'method': '寄配件', 'branch': '良仓有货', 'resp': '物流问题', 'part': 'FC-V2-BLK', 'qty': 1, 'tracking': None,
     'product': 18.00, 'freight': 8.40, 'comp': 0.0, 'other': 0.0, 'filing': ('快递费用', '待审批'), 'ratio': (100, 0), 'ratio_state': '不适用',
     'nego': '不适用', 'settle': '不适用', 'claim': '向良仓索赔（错发）', 'claim_state': '待发起', 'status': '进行中', 'step': '报备审批 · 快递费用', 'waiting': '客服主管 周敏',
     'waited': '45m', 'owner': '王磊', 'initiator': '李婷', 'reg': '自动', 'approval': 'AP-20260911-002'},
    {'no': 'S-20260911-0022', 'factory': 'FZJ', 'customer': 'Ethan Brooks', 'store': 'Forcome Direct', 'site': 'US', 'ticket': 'T-20260911-0035',
     'method': '寄配件', 'branch': '良仓有货', 'resp': '产品质量问题', 'part': 'FC-V2-CB01', 'qty': 1, 'tracking': None,
     'product': 1.40, 'freight': 5.90, 'comp': 0.0, 'other': 0.0, 'filing': None, 'ratio': (0, 100), 'ratio_state': '建议',
     'nego': '未发起', 'settle': '未定', 'status': '待确认', 'step': '确认责任与处理方式', 'waiting': '售后负责人 王磊', 'waited': '15m',
     'owner': '王磊', 'reg': '自动'},
]

# ---------------------------------------------------------------- 审批单（动作审批与报备合一）
# status：待审批 已批准 已驳回 已超时 执行中 已执行 执行失败 已撤回
APPROVALS = [
    {'no': 'AP-20260911-001', 'at': '09:30', 'by': '陈晨', 'ticket': 'T-20260902-0071', 'aftersales': 'S-20260911-0020', 'customer': 'Jonas Weber',
     'store': 'Forcome Direct', 'site': 'DE',
     'filings': [('额外赔偿', '€44.90（≈ $49.39）', '免退货全额退款')],
     'actions': [('亚马逊退款 €44.90', '人工操作清单', '亚马逊退款在卖家后台执行（SP-API 退款待确认 Q-23）')],
     'reply': '德语回复，退款执行后自动发出', 'approver': '客服主管', 'deadline': '13:30', 'left': '3h 10m', 'status': '待审批'},
    {'no': 'AP-20260911-002', 'at': '09:35', 'by': '李婷', 'ticket': 'T-20260910-0195', 'aftersales': 'S-20260911-0021', 'customer': 'Marcus Lee',
     'store': 'Forcome Auto', 'site': 'US',
     'filings': [('快递费用', '$8.40', '错发换发，UPS Ground')],
     'actions': [('良仓创建售后出库单：良仓 US · 整机黑色 ×1', '良仓接口', None)],
     'reply': '英语回复，出库单创建成功后自动发出', 'approver': '客服主管', 'deadline': '13:35', 'left': '3h 15m', 'status': '待审批'},
    {'no': 'AP-20260911-003', 'at': '09:41', 'by': '系统', 'ticket': 'T-20260910-0201', 'aftersales': 'S-20260911-0018', 'customer': 'Laura Bennett',
     'store': 'Forcome Auto', 'site': 'US',
     'filings': [('快递费用', '$11.50', '生产厂直寄美国，云途专线')],
     'actions': [('在工厂工作台生成寄件任务', '工厂工作台', None)],
     'reply': None, 'approver': '客服主管', 'deadline': '13:41', 'left': '3h 21m', 'status': '待审批'},
    {'no': 'AP-20260911-004', 'at': '09:48', 'by': '李婷', 'ticket': 'T-20260910-0170', 'aftersales': None, 'customer': 'Priya Raman',
     'store': 'forcome.com', 'site': 'US',
     'filings': [],
     'actions': [('Shopify 订单 #1057 改收货地址', 'Shopify Admin API', None)],
     'reply': '英语回复，地址修改成功后自动发出', 'approver': '客服主管或售后负责人', 'deadline': '13:48', 'left': '3h 28m', 'status': '待审批'},
]
APPROVAL_LOG_TODAY = [
    ('10:12', '查询良仓 US 库存', '良仓接口 · 自动', '失败：良仓接口超时，第 2 次重试成功', 'warning'),
    ('09:41', '生产厂提交报价，写入登记台账', '工厂工作台 · 陈工', 'S-20260911-0018', 'success'),
    ('08:50', '向生产厂派发询价单', '工厂工作台 · 自动', 'S-20260911-0019', 'success'),
    ('08:21', '向生产厂派发询价单', '工厂工作台 · 自动', 'S-20260911-0018', 'success'),
    ('08:02', '亚马逊退款 €29.90 回填完成', '人工操作清单 · 陈晨', 'T-20260909-0128 · AP-20260910-011', 'success'),
]

# ---------------------------------------------------------------- 工厂任务（factory：FQD / FZJ）
FACTORY_TASKS = [
    {'factory': 'FQD', 'type': '询价', 'aftersales': 'S-20260911-0019', 'item': '软管 FC-V2-HS02 ×2 · 寄往德国', 'state': '待处理', 'due': '剩 2 个工作日', 'at': '09-11 08:50'},
    {'factory': 'FQD', 'type': '比例协商', 'aftersales': 'S-20260903-0012', 'item': '电池 ×1 · 费用 $23.40 · FSH 提议工厂 100%', 'state': '已提交', 'note': '已还价 50%，双方负责人处理中', 'at': '09-05 10:30'},
    {'factory': 'FQD', 'type': '询价', 'aftersales': 'S-20260911-0018', 'item': 'HEPA 滤芯组件 FC-V2-HF01 ×1 · 寄往美国', 'state': '已提交', 'note': '已报价 $14.70，等 FSH 报备', 'at': '09-11 09:40'},
    {'factory': 'FQD', 'type': '比例协商', 'aftersales': 'S-20260910-0017', 'item': '集尘杯 ×1 · 费用 $10.90', 'state': '已完成', 'note': '已接受 100%', 'at': '09-10 17:10'},
    {'factory': 'FQD', 'type': '结算确认', 'aftersales': '批次 2026-09-FQD-A', 'item': '1 单 · 工厂承担 $13.20', 'state': '已完成', 'note': '已确认', 'at': '09-10 15:30'},
    {'factory': 'FQD', 'type': '比例协商', 'aftersales': 'S-20260908-0015', 'item': '电池 ×1 · 费用 $22.10', 'state': '已完成', 'note': '已接受 50 / 50', 'at': '09-09 11:20'},
    {'factory': 'FQD', 'type': '比例协商', 'aftersales': 'S-20260904-0013', 'item': 'HEPA 滤芯组件 ×2 · 费用 $13.20', 'state': '已完成', 'note': '已接受 100%', 'at': '09-05 16:40'},
    {'factory': 'FZJ', 'type': '结算确认', 'aftersales': '批次 2026-09-FZJ-A', 'item': '1 单 · 工厂承担 $7.30', 'state': '已完成', 'note': '已确认', 'at': '09-10 16:05'},
    {'factory': 'FZJ', 'type': '比例协商', 'aftersales': 'S-20260905-0014', 'item': '充电线 ×1 · 费用 $7.30', 'state': '已完成', 'note': '已接受 100%', 'at': '09-06 10:05'},
]

# ---------------------------------------------------------------- 结算
SETTLE_BATCHES = [
    {'no': '2026-09-FQD-A', 'factory': 'FQD', 'at': '09-08', 'items': ['S-20260904-0013'], 'state': '已结算', 'note': '提前生成；陈工 09-10 15:30 确认、王磊 09-10 确认'},
    {'no': '2026-09-FZJ-A', 'factory': 'FZJ', 'at': '09-08', 'items': ['S-20260905-0014'], 'state': '已结算', 'note': '提前生成；张工 09-10 16:05 确认、王磊 09-10 确认'},
    {'no': '2026-09-FQD-B', 'factory': 'FQD', 'at': '10-05', 'items': ['S-20260908-0015', 'S-20260910-0017'], 'state': '待生成', 'note': '每月 5 日按生产厂自动生成上月批次，可提前生成'},
]
BATCH = {b['no']: b for b in SETTLE_BATCHES}


# ---------------------------------------------------------------- 计算函数
def total(a):
    return round(sum(x or 0 for x in (a['product'], a['freight'], a['comp'], a['other'])), 2)


def factory_share(a):
    return round(total(a) * a['ratio'][1] / 100.0, 2)


def fsh_share(a):
    return round(total(a) * a['ratio'][0] / 100.0, 2)


def ledger_totals():
    rows = [a for a in AFTERSALES if a['status'] != '待确认']
    return {
        'count': len(rows),
        'product': round(sum(a['product'] or 0 for a in rows), 2),
        'freight': round(sum(a['freight'] or 0 for a in rows), 2),
        'comp': round(sum(a['comp'] or 0 for a in rows), 2),
        'other': round(sum(a['other'] or 0 for a in rows), 2),
        'fsh': round(sum(fsh_share(a) for a in rows), 2),
        'factory': round(sum(factory_share(a) for a in rows), 2),
        'settled': round(sum(factory_share(a) for a in rows if a['settle'] == '已结算'), 2),
        'pending': round(sum(factory_share(a) for a in rows if a['settle'] == '待结算'), 2),
        'undecided': round(sum(factory_share(a) for a in rows if a['settle'] == '未定'), 2),
    }


def factory_totals(code):
    """某生产厂的工厂承担：已结算 / 待结算 / 未定。"""
    rows = [a for a in AFTERSALES if a['status'] != '待确认' and a.get('factory') == code]
    f = lambda st: round(sum(factory_share(a) for a in rows if a['settle'] == st), 2)
    return {'factory': round(sum(factory_share(a) for a in rows), 2), 'settled': f('已结算'), 'pending': f('待结算'), 'undecided': f('未定'), 'count': len(rows)}


def money(x):
    if x is None:
        return '待报价'
    return '$%s' % format(x, ',.2f')


# ---------------------------------------------------------------- 导航角标（只统计需要该用户处理的）
# 收件箱 = 当前店铺范围内团队队列的待审草稿 + 转人工，只对坐席、客服主管显示；
# 审批 = 待我审批（售后负责人只计只含动作的单）+ 待我执行的人工操作清单。
BADGES = {
    'liting':   {'收件箱': 4},
    'chenchen': {'收件箱': 4},
    'zhoumin':  {'收件箱': 4, '审批': 4},
    'wanglei':  {'售后': 2, '审批': 1},
    'zhaoqian': {},
    'liuyang':  {},
}
# 收件箱队列计数（团队队列，全部店铺）
QUEUE_COUNTS = {'待审草稿': 3, '转人工': 1, '待审批': 2, '等待中': 5, '全部': 11}

# ---------------------------------------------------------------- 草稿与回复正文
DRAFTS = {
    'sarah_A': ("Hi Sarah,\n\nI'm sorry the tracking has been stuck. UPS shows order 113-4567890-1234567 left the Louisville hub on Sep 5 "
                "with no scan since, which usually means a delay rather than a loss.\n\nSince you need it before Tuesday, we won't wait on the "
                "carrier: a replacement ships Friday, Sep 11 via UPS Next Day Air at no cost to you and arrives Monday, Sep 14. I've also "
                "opened a trace with UPS on the original package.\n\nBest regards,\nForcome Support"),
    'sarah_B': ("Hi Sarah,\n\nI'm sorry the tracking has been stuck. I've opened a trace with UPS on order 113-4567890-1234567 "
                "and we'll get back to you with the next step.\n\nBest regards,\nForcome Support"),
    'sarah_C': ("Hi Sarah,\n\nI'm sorry for the delay. While we trace the package with UPS, we'd like to refund your shipping cost. "
                "If the package doesn't arrive by Tuesday, just let us know and we'll arrange a full refund.\n\nBest regards,\nForcome Support"),
    'olivia_A': ("Hi Olivia,\n\nThanks for the details. A drop in suction after a few weeks is almost always a clogged filter rather than a fault, "
                 "so let's try this first:"),
    'olivia_steps': ['Twist the dust cup off and pull the HEPA filter straight out.',
                     'Tap out the dust, rinse under cold water, and let it dry for 24 hours.',
                     'Check that the rubber seal on the cup sits flat, then reassemble.'],
    'olivia_end': ("If suction is still weak after the filter is fully dry, reply to this email and we'll send a replacement filter under warranty."
                   "\n\nBest regards,\nForcome Support"),
    'jonas_in_de': ("Das Gerät funktioniert nach 2 Wochen nicht mehr. Mir wurde ein Ersatzakku versprochen, der seit über einer Woche nicht "
                    "angekommen ist. Ich möchte mein Geld zurück, sonst werde ich eine schlechte Bewertung hinterlassen."),
    'jonas_in_zh': '机器用了两周就不工作了。之前答应给我补发电池，一个多星期了还没到。我要退款，否则我会留差评。',
    'jonas_progress_zh': 'Weber 先生您好，您的退款申请我们已经受理，会尽快给您明确答复。补发的电池仍在运输途中。',
    'jonas_progress_de': ('Sehr geehrter Herr Weber, wir haben Ihren Erstattungsantrag erhalten und melden uns so schnell wie möglich '
                          'mit einer verbindlichen Antwort. Der Ersatzakku ist noch unterwegs.'),
    'jonas_bound_de': ('Sehr geehrter Herr Weber, es tut uns sehr leid. Wir haben Ihnen heute den vollen Betrag von 44,90 € erstattet. '
                       'Den Ersatzakku dürfen Sie behalten, eine Rücksendung ist nicht nötig.'),
    'jonas_bound_zh': 'Weber 先生您好，非常抱歉。我们今天已为您全额退款 €44.90。补发的电池您可以留用，无需退回。',
    'marcus_bound': ("Hi Marcus, sorry about the wrong color. We're sending the black V2 today via UPS Ground, arriving in 3-5 business days. "
                     "Please keep the grey unit, no return needed."),
    'priya_address_old': '88 Pine St, Seattle, WA 98101',
    'priya_address_new': '1450 Market St, Apt 1104, San Francisco, CA 94103',
}

# ---------------------------------------------------------------- 客户档案：Sarah Mitchell
SARAH = {
    'identities': [('亚马逊 US · Forcome Direct', 's.mitchell.4h2k@marketplace.amazon.com', '主身份'),
                   ('Shopify · forcome.com', 'sarah.m@example.com', '2026-06-18 李婷确认合并：同名、同收货地址')],
    'orders': [('113-4567890-1234567', '亚马逊 US · Forcome Direct', '2026-09-03', 'V2 黑色 ×1', 49.99, '已发货 · 超预计送达'),
               ('112-7788001-3344556', '亚马逊 US · Forcome Direct', '2026-06-10', 'V2 黑色 ×1', 49.99, '已签收'),
               ('#0988', 'Shopify · forcome.com', '2026-05-02', 'V2 白色 ×1', 48.99, '已签收')],
    'spend': 148.97,
    'tickets': [('T-20260910-0192', '未收到与异常', '待审草稿', '09-10'), ('T-20260614-0117', '订单查询', '已关闭', '06-14')],
    'summary': '3 笔订单，2 张工单。6 月问过一次物流进度，8 月前无投诉、无退款。这次是第一次负面来信，原因是包裹停滞且有明确用车期限。',
}

# ---------------------------------------------------------------- 知识库示例
KB = [
    ('物流停滞或超预计送达处理流程', '政策规则', '全部店铺', '英 · 德', '全部', '周敏', '2026-12-31', 64, '有效'),
    ('FBM 补发标准', '政策规则', '亚马逊店铺', '英 · 德', '亚马逊', '周敏', '2026-12-31', 41, '有效'),
    ('延误补偿规则', '政策规则', 'forcome.com（覆盖）', '英', '邮件', '周敏', '2026-10-31', 12, '有效'),
    ('吸力下降排查', '故障排查树', '全部店铺', '英 · 德', '全部', '王磊', '2027-03-31', 88, '有效'),
    ('充电线不充电排查', '故障排查树', '全部店铺', '英 · 德', '全部', '王磊', '2027-03-31', 23, '有效'),
    ('V2 规格与兼容车型', '产品事实表', '全部店铺', '英 · 德', '全部', '赵倩', '2027-06-30', 57, '有效'),
    ('进展回复模板 · 德语', '模板与素材', 'Forcome Direct', '德', '亚马逊', '赵倩', '2026-12-31', 19, '有效'),
    ('拆下并清洗 HEPA 滤芯（图）', '模板与素材', '全部店铺', '英 · 德', '邮件', '赵倩', '2027-03-31', 15, '有效'),
    ('Q3 促销运费政策', '政策规则', '全部店铺', '英', '全部', '周敏', '2026-09-15', 9, '即将过期'),
]
KB_COUNTS = {'产品事实表': 42, '政策规则': 36, '故障排查树': 12, '模板与素材': 118, '沉淀问答': 64, '待审核沉淀': 3, '知识缺口': 5}

# ---------------------------------------------------------------- 报表示例（本周，标注为示例数据）
REPORT = {
    'tickets_week': 357, 'tickets_delta': '较上周 +8%', 'daily_series': ('亚马逊', 'Shopify 与邮件'),
    'frt_median': '2h 14m', 'frt_delta': '较上周 -35m',
    'sla_rate': '96.4%', 'sla_miss': 11,
    'adopt_rate': '41%', 'adopt_split': '未修改直接发送；另有修改后发送 27%',
    'auto_rate': '12%', 'auto_note': '订单查询、发票与收据',
    'daily': [('09-05', 38, 14), ('09-06', 41, 17), ('09-07', 29, 9), ('09-08', 22, 8), ('09-09', 45, 19), ('09-10', 52, 21), ('09-11', 30, 12)],
    'intents': [('订单查询', 31), ('退货与退款', 18), ('产品故障与使用问题', 16), ('产品咨询', 14), ('未收到与异常', 9), ('其他', 12)],
}


def cost_by_resp():
    out = {}
    for a in AFTERSALES:
        if a['status'] == '待确认':
            continue
        out[a['resp']] = round(out.get(a['resp'], 0) + total(a), 2)
    return out


if __name__ == '__main__':
    t = ledger_totals()
    for k, v in t.items():
        print(k, v)
    for a in AFTERSALES:
        print(a['no'], total(a), fsh_share(a), factory_share(a), a['settle'])
    print(cost_by_resp())
