# -*- coding: utf-8 -*-
"""
Forcome Support 统一示例数据（原型唯一数据源）

规则：
1. 所有原型页面的客户、订单、工单、售后单、审批单、金额、时间都从这里取，不得在页面里另编。
2. 演示时刻 NOW = 2026-09-11（周五）10:20，北京时间。页面上的「剩余」「已等」都按这个时刻计算。
3. 生产厂两家：FQD、FZJ（集团内部）。工作日为周一至周五 09:00–18:00，不扣节假日。
4. 站点：亚马逊 US / CA / MX，Shopify forcome.com（US、CA）与 forcome.mx（MX）；回复语言英语、西班牙语。
5. 金额：台账与结算统一用 USD；比索、加元订单保留原币，并按演示汇率 1 USD = 18.00 MXN、1 USD = 1.36 CAD 折算。
5. 数字需要合计时调用本文件里的函数，不要手算。
"""

NOW = '2026-09-11 10:20'
NOW_LABEL = '2026-09-11 周五 10:20'
USD_MXN = 18.00
USD_CAD = 1.36

# ---------------------------------------------------------------- 人员与角色
STAFF = {
    # 成员与部门来自钉钉通讯录（集团统一组织），角色、店铺范围在 P20 分配
    'liting':   {'name': '李婷', 'avatar': '婷', 'role': '坐席', 'stores': '全部店铺', 'lang': 'EN · ES', 'dept': 'FSH / 客服部', 'email': 'liting@forcome.com', 'last_login': '10:02'},
    'chenchen': {'name': '陈晨', 'avatar': '晨', 'role': '坐席', 'stores': '全部店铺', 'lang': 'ES · EN', 'dept': 'FSH / 客服部', 'email': 'chenchen@forcome.com', 'last_login': '09:15'},
    'zhoumin':  {'name': '周敏', 'avatar': '敏', 'role': '客服主管', 'stores': '全部店铺', 'dept': 'FSH / 客服部', 'email': 'zhoumin@forcome.com', 'last_login': '10:18'},
    'wanglei':  {'name': '王磊', 'avatar': '磊', 'role': '售后负责人', 'stores': '全部店铺', 'dept': 'FSH / 售后部', 'email': 'wanglei@forcome.com', 'last_login': '10:20'},
    'zhaoqian': {'name': '赵倩', 'avatar': '倩', 'role': '知识库负责人', 'stores': '全部店铺', 'dept': 'FSH / 客服部', 'email': 'zhaoqian@forcome.com', 'last_login': '09-10 18:30'},
    'liuyang':  {'name': '刘洋', 'avatar': '洋', 'role': '管理员', 'stores': '全部店铺', 'dept': 'FSH / 信息部', 'email': 'liuyang@forcome.com', 'last_login': '10:20'},
    'chengong': {'name': '陈工', 'avatar': '陈', 'role': '生产厂对接人', 'factory': 'FQD', 'dept': 'FQD / 品质部', 'last_login': '09:40'},
    'liucz':    {'name': '刘厂长', 'avatar': '刘', 'role': '生产厂负责人', 'factory': 'FQD'},
    'zhanggong': {'name': '张工', 'avatar': '张', 'role': '生产厂对接人', 'factory': 'FZJ', 'dept': 'FZJ / 品质部', 'last_login': '09-10 16:05'},
    'zhoucz':   {'name': '周厂长', 'avatar': '周', 'role': '生产厂负责人', 'factory': 'FZJ'},
}

# ---------------------------------------------------------------- 生产厂（集团内部，两家）
# 配件与整机全部由集团内这两家生产厂生产；售后单按 SKU 归属派发、协商、结算。SKU 清单在 P24「工厂账号」配置，上线前导入（下列为示例）。
FACTORIES = {
    'FQD': {'code': 'FQD', 'scope': '整机及结构件：整机、电池、软管、HEPA 滤芯、集尘杯', 'contact': '陈工', 'head': '刘厂长'},
    'FZJ': {'code': 'FZJ', 'scope': '线材与电源：充电线', 'contact': '张工', 'head': '周厂长'},
}
PART_FACTORY = {'FC-V2-BLK': 'FQD', 'FC-V2-BT01': 'FQD', 'FC-V2-HS02': 'FQD', 'FC-V2-HF01': 'FQD', 'FC-V2-DC01': 'FQD', 'FC-V2-CB01': 'FZJ'}

# 各角色在顶栏导航里能看到的入口（没有权限的入口不显示；直接访问链接显示无权限状态 G2）
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
    # 亚马逊：买家消息走亚马逊官方邮件中转，收发都在该店铺绑定的邮箱（Gmail API）；订单、物流、库存走积加，退款与取消走 SP-API。Shopify：客服邮箱（Gmail API）+ Admin API 写动作。
    {'id': 'amz-direct', 'name': 'Forcome Direct', 'platform': '亚马逊', 'sites': ['US', 'CA', 'MX'], 'mailbox': 'amz-direct@forcome.com', 'api': 'SP-API', 'sid': '卖家 ID A1FD7Q2M9XK3LC', 'signature': 'Forcome Support'},
    {'id': 'amz-auto',   'name': 'Forcome Auto',   'platform': '亚马逊', 'sites': ['US'],             'mailbox': 'amz-auto@forcome.com',   'api': 'SP-API', 'sid': '卖家 ID A3KA8V1T6RW2NB', 'signature': 'Forcome Auto Care'},
    {'id': 'shop-com',   'name': 'forcome.com',    'platform': 'Shopify', 'sites': ['US', 'CA'],      'mailbox': 'support@forcome.com',    'api': 'Admin API', 'sid': 'forcome-com.myshopify.com', 'signature': 'Forcome Support'},
    {'id': 'shop-mx',    'name': 'forcome.mx',     'platform': 'Shopify', 'sites': ['MX'],            'mailbox': 'support@forcome.mx',     'api': 'Admin API', 'sid': 'forcome-mx.myshopify.com', 'signature': 'Forcome México'},
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
    {'no': 'T-20260902-0071', 'customer': 'Mateo Rivas', 'store': 'Forcome Direct', 'channel': '亚马逊', 'site': 'MX',
     'subject': 'El aspirador dejó de funcionar en menos de una semana', 'intent': '退货与退款', 'sentiment': '负面', 'priority': '紧急',
     'status': '转人工', 'reason': '平台风险 · 差评威胁；重复联系 1 次', 'owner': '陈晨', 'sla_left': '0h 55m', 'sla_level': 'danger',
     'last_in': '09-10 11:15', 'order': '302-8811234-9901122', 'tags': ['差评风险'], 'lang': '西班牙语',
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
     'last_in': '09-11 10:04', 'order': '114-7788990-2233441', 'tags': [], 'lang': '英语', 'aftersales': ['S-20260911-0022']},
    {'no': 'T-20260910-0201', 'customer': 'Laura Bennett', 'store': 'Forcome Auto', 'channel': '亚马逊', 'site': 'US',
     'subject': 'Filter turned yellow and suction dropped', 'intent': '产品故障与使用问题', 'sentiment': '中性', 'priority': '普通',
     'status': '等内部', 'reason': '售后单 S-20260911-0018 进行中', 'owner': '李婷', 'sla_left': '已回复', 'sla_level': 'none',
     'last_in': '09-11 08:01', 'order': '111-2233445-5566778', 'tags': [], 'lang': '英语', 'aftersales': ['S-20260911-0018']},
    {'no': 'T-20260910-0188', 'customer': 'Diego Salazar', 'store': 'Forcome Direct', 'channel': '亚马逊', 'site': 'MX',
     'subject': 'La manguera está rota', 'intent': '产品故障与使用问题', 'sentiment': '中性', 'priority': '普通',
     'status': '等内部', 'reason': '售后单 S-20260911-0019 等生产厂报价', 'owner': '陈晨', 'sla_left': '已回复', 'sla_level': 'none',
     'last_in': '09-11 07:52', 'order': '305-1122334-4455667', 'tags': [], 'lang': '西班牙语', 'aftersales': ['S-20260911-0019']},
    {'no': 'T-20260909-0142', 'customer': 'Ana Souza', 'store': 'forcome.com', 'channel': '邮件', 'site': 'US',
     'subject': 'Wholesale pricing for 200 units?', 'intent': '批发与合作', 'sentiment': '中性', 'priority': '普通',
     'status': '等内部', 'reason': '已转销售', 'owner': '陈晨', 'sla_left': '已回复', 'sla_level': 'none',
     'last_in': '09-09 14:00', 'order': None, 'tags': ['批发'], 'lang': '英语'},
    {'no': 'T-20260904-0098', 'customer': 'Oliver Grant', 'store': 'Forcome Direct', 'channel': '亚马逊', 'site': 'CA',
     'subject': 'Charger cable not working', 'intent': '产品故障与使用问题', 'sentiment': '正面', 'priority': '普通',
     'status': '已解决', 'reason': '预计 09-17 自动关闭', 'owner': '李婷', 'sla_left': '—', 'sla_level': 'none',
     'last_in': '09-10 09:00', 'order': '204-5566778-9900112', 'tags': [], 'lang': '英语', 'aftersales': ['S-20260905-0014']},
    {'no': 'T-20260909-0131', 'customer': 'Valeria Ríos', 'store': 'forcome.mx', 'channel': 'Shopify', 'site': 'MX',
     'subject': '¿Cada cuánto debo cambiar el filtro?', 'intent': '产品咨询', 'sentiment': '中性', 'priority': '普通',
     'status': '已解决', 'owner': '李婷', 'sla_left': '—', 'sla_level': 'none', 'last_in': '09-09 08:40',
     'order': None, 'tags': [], 'lang': '西班牙语'},
    {'no': 'T-20260909-0128', 'customer': 'Sofía Márquez', 'store': 'Forcome Direct', 'channel': '亚马逊', 'site': 'MX',
     'subject': 'Reembolso de mi devolución', 'intent': '退货与退款', 'sentiment': '中性', 'priority': '普通',
     'status': '等客户', 'owner': '陈晨', 'sla_left': '—', 'sla_level': 'none', 'last_in': '09-09 17:20',
     'order': '302-4455667-1122334', 'tags': [], 'lang': '西班牙语'},
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
# branch：易仓有货 / 易仓无货 / —
# resp（责任类型）：客户使用问题 / 产品质量问题 / 物流问题 / 其他
# filing（报备）：(类型, 状态) 类型为 快递费用 / 额外赔偿；状态为 待审批 已批准 已驳回 已作废；不需要报备写 None
# factory：只在有生产厂参与（询价、寄件或比例协商）时填写；initiator：只有路径 B（坐席提交审批时创建）才有
# ratios：承担比例按三组费用分别记 (FSH%, 工厂%)：product 产品成本 / freight 快递物流 / other 其他费用（额外赔偿 + 其他）
# ratio_state：建议 / 已确认 / 不适用
# nego（协商状态）：不适用 未发起 待工厂答复 工厂还价 待升级 已确认
# settle（结算状态）：不适用 未定 待结算 已结算
# R-AS-02 建议比例：责任类型 → 三组费用各自的 (FSH%, 工厂%)
R_FAC = {'product': (0, 100), 'freight': (0, 100), 'other': (0, 100)}      # 产品质量问题（抱怨索赔）：工厂全额
R_FSH = {'product': (100, 0), 'freight': (100, 0), 'other': (100, 0)}      # 客户使用问题（顾客购买、使用不当）、物流问题：FSH 全额
R_HALF = {'product': (50, 50), 'freight': (50, 50), 'other': (50, 50)}     # 其他（需填写理由）：对半
RATIO_RULE = {'客户使用问题': R_FSH, '产品质量问题': R_FAC, '物流问题': R_FSH, '其他': R_HALF}
RATIO_LABELS = (('产品成本', 'product'), ('快递物流', 'freight'), ('其他费用', 'other'))


def ratio_words(r, sep=' · '):
    """详情与说明里的比例写法（prd_c P13）：三组相同写「三组均 FSH x / 工厂 y」，不同时逐组列出。"""
    v = set(r.values())
    if len(v) == 1:
        f, c = v.pop()
        return '三组均 FSH %d / 工厂 %d' % (f, c)
    return sep.join('%s FSH %d / 工厂 %d' % (lab, r[k][0], r[k][1]) for lab, k in RATIO_LABELS)


AFTERSALES = [
    {'no': 'S-20260901-0010', 'factory': None, 'customer': 'Noah Kim', 'store': 'Forcome Direct', 'site': 'US', 'ticket': 'T-20260831-0044',
     'method': '调整安装方式', 'branch': '—', 'resp': '客户使用问题', 'part': None, 'qty': 0, 'tracking': None,
     'product': 0.0, 'freight': 0.0, 'comp': 0.0, 'other': 0.0, 'filing': None, 'ratios': R_FSH, 'ratio_state': '不适用',
     'nego': '不适用', 'settle': '不适用', 'status': '已完成', 'step': '已完成', 'waiting': '—', 'owner': '王磊', 'reg': '自动'},
    {'no': 'S-20260902-0011', 'factory': None, 'customer': 'Priya Raman', 'store': 'forcome.com', 'site': 'US', 'ticket': 'T-20260901-0059',
     'method': '退款或部分补偿', 'branch': '—', 'resp': '物流问题', 'part': None, 'qty': 0, 'tracking': None,
     'product': 0.0, 'freight': 0.0, 'comp': 12.00, 'other': 0.0, 'filing': ('额外赔偿', '已批准'), 'ratios': R_FSH, 'ratio_state': '不适用',
     'nego': '不适用', 'settle': '不适用', 'status': '已完成', 'claim': '向 USPS 索赔', 'claim_state': '索赔中', 'step': '已完成 · 向 USPS 索赔中', 'waiting': '—', 'owner': '王磊', 'initiator': '陈晨', 'reg': '自动'},
    {'no': 'S-20260903-0012', 'factory': 'FQD', 'customer': 'Mateo Rivas', 'store': 'Forcome Direct', 'site': 'MX', 'ticket': 'T-20260902-0071',
     'method': '寄配件', 'branch': '易仓无货', 'resp': '产品质量问题', 'part': 'FC-V2-BT01', 'qty': 1, 'tracking': 'YT2625100012340921',
     'product': 9.80, 'freight': 13.60, 'comp': 0.0, 'other': 0.0, 'filing': ('快递费用', '已批准'), 'ratios': R_FAC, 'ratio_state': '建议',
     'counter': R_HALF, 'nego': '待升级', 'settle': '未定', 'status': '已完成', 'step': '比例协商 · 待升级', 'waiting': '双方负责人',
     'waited': '2 天', 'owner': '王磊', 'reg': '王磊手工'},
    {'no': 'S-20260904-0013', 'factory': 'FQD', 'customer': 'Emily Chen', 'store': 'forcome.com', 'site': 'US', 'ticket': 'T-20260903-0087',
     'method': '寄配件', 'branch': '易仓有货', 'resp': '产品质量问题', 'part': 'FC-V2-HF01', 'qty': 2, 'tracking': '1Z4R28830358229041',
     'product': 6.40, 'freight': 6.80, 'comp': 0.0, 'other': 0.0, 'filing': ('快递费用', '已批准'), 'ratios': R_FAC, 'ratio_state': '已确认',
     'nego': '已确认', 'settle': '已结算', 'batch': '2026-09-FQD-A', 'status': '已完成', 'step': '已完成 · 已结算', 'waiting': '—', 'owner': '王磊', 'reg': '自动'},
    {'no': 'S-20260905-0014', 'factory': 'FZJ', 'customer': 'Oliver Grant', 'store': 'Forcome Direct', 'site': 'CA', 'ticket': 'T-20260904-0098',
     'method': '寄配件', 'branch': '易仓有货', 'resp': '产品质量问题', 'part': 'FC-V2-CB01', 'qty': 1, 'tracking': '1Z4R28830358229052',
     'product': 1.40, 'freight': 5.90, 'comp': 0.0, 'other': 0.0, 'filing': ('快递费用', '已批准'), 'ratios': R_FAC, 'ratio_state': '已确认',
     'nego': '已确认', 'settle': '已结算', 'batch': '2026-09-FZJ-A', 'status': '已完成', 'step': '已完成 · 已结算', 'waiting': '—', 'owner': '王磊', 'reg': '自动'},
    {'no': 'S-20260908-0015', 'factory': 'FQD', 'customer': 'Hannah Ross', 'store': 'Forcome Direct', 'site': 'US', 'ticket': 'T-20260907-0122',
     'method': '寄配件', 'branch': '易仓无货', 'resp': '其他', 'part': 'FC-V2-BT01', 'qty': 1, 'tracking': 'YT2625100012345678',
     'product': 9.80, 'freight': 12.30, 'comp': 0.0, 'other': 0.0, 'filing': ('快递费用', '已批准'), 'ratios': R_HALF, 'ratio_state': '已确认',
     'nego': '已确认', 'settle': '待结算', 'status': '已完成', 'step': '待内部结算', 'waiting': '月度结算', 'owner': '王磊', 'reg': '王磊手工'},
    {'no': 'S-20260909-0016', 'factory': None, 'customer': 'David Park', 'store': 'forcome.com', 'site': 'US', 'ticket': 'T-20260908-0140',
     'method': '寄配件', 'branch': '易仓有货', 'resp': '客户使用问题', 'part': 'FC-V2-HS02', 'qty': 1, 'tracking': '1Z4R28830358229088',
     'product': 2.60, 'freight': 6.80, 'comp': 0.0, 'other': 0.0, 'filing': ('快递费用', '已批准'), 'ratios': R_FSH, 'ratio_state': '不适用',
     'nego': '不适用', 'settle': '不适用', 'status': '已完成', 'step': '已完成', 'waiting': '—', 'owner': '王磊', 'reg': '自动'},
    {'no': 'S-20260910-0017', 'factory': 'FQD', 'customer': 'Marcus Lee', 'store': 'Forcome Direct', 'site': 'US', 'ticket': 'T-20260909-0163',
     'method': '寄配件', 'branch': '易仓有货', 'resp': '产品质量问题', 'part': 'FC-V2-DC01', 'qty': 1, 'tracking': '1Z4R28830358229101',
     'product': 4.10, 'freight': 6.80, 'comp': 0.0, 'other': 0.0, 'filing': ('快递费用', '已批准'), 'ratios': R_FAC, 'ratio_state': '已确认',
     'nego': '已确认', 'settle': '待结算', 'status': '已完成', 'step': '待内部结算', 'waiting': '月度结算', 'owner': '王磊', 'reg': '自动'},
    {'no': 'S-20260911-0018', 'factory': 'FQD', 'customer': 'Laura Bennett', 'store': 'Forcome Auto', 'site': 'US', 'ticket': 'T-20260910-0201',
     'method': '寄配件', 'branch': '易仓无货', 'resp': '产品质量问题', 'part': 'FC-V2-HF01', 'qty': 1, 'tracking': None,
     'product': 3.20, 'freight': 11.50, 'comp': 0.0, 'other': 0.0, 'filing': ('快递费用', '待审批'), 'ratios': R_FAC, 'ratio_state': '建议',
     'nego': '未发起', 'settle': '未定', 'status': '进行中', 'step': '报备审批 · 快递费用', 'waiting': '客服主管 周敏', 'waited': '39m',
     'owner': '王磊', 'reg': '自动', 'approval': 'AP-20260911-003'},
    {'no': 'S-20260911-0019', 'factory': 'FQD', 'customer': 'Diego Salazar', 'store': 'Forcome Direct', 'site': 'MX', 'ticket': 'T-20260910-0188',
     'method': '寄配件', 'branch': '易仓无货', 'resp': '产品质量问题', 'part': 'FC-V2-HS02', 'qty': 2, 'tracking': None,
     'product': None, 'freight': None, 'comp': 0.0, 'other': 0.0, 'filing': None, 'ratios': R_FAC, 'ratio_state': '建议',
     'nego': '未发起', 'settle': '未定', 'status': '进行中', 'step': '生产厂报价', 'waiting': '生产厂 FQD', 'waited': '1h 30m · 09-15 周二 09:00 截止',
     'owner': '王磊', 'reg': '自动'},
    {'no': 'S-20260911-0020', 'factory': 'FQD', 'customer': 'Mateo Rivas', 'store': 'Forcome Direct', 'site': 'MX', 'ticket': 'T-20260902-0071',
     'method': '退款或部分补偿', 'branch': '—', 'resp': '产品质量问题', 'part': None, 'qty': 0, 'tracking': None,
     'product': 0.0, 'freight': 0.0, 'comp': 49.39, 'comp_orig': 'MX$889.00', 'other': 0.0, 'filing': ('额外赔偿', '待审批'), 'ratios': R_FAC, 'ratio_state': '建议',
     'nego': '未发起', 'settle': '未定', 'status': '进行中', 'step': '报备审批 · 额外赔偿', 'waiting': '客服主管 周敏', 'waited': '50m',
     'owner': '王磊', 'initiator': '陈晨', 'reg': '自动', 'approval': 'AP-20260911-001'},
    {'no': 'S-20260911-0021', 'factory': None, 'customer': 'Marcus Lee', 'store': 'Forcome Auto', 'site': 'US', 'ticket': 'T-20260910-0195',
     'method': '寄配件', 'branch': '易仓有货', 'resp': '物流问题', 'part': 'FC-V2-BLK', 'qty': 1, 'tracking': None,
     'product': 18.00, 'freight': 8.40, 'comp': 0.0, 'other': 0.0, 'filing': ('快递费用', '待审批'), 'ratios': R_FSH, 'ratio_state': '不适用',
     'nego': '不适用', 'settle': '不适用', 'claim': '向易仓索赔（错发）', 'claim_state': '待发起', 'status': '进行中', 'step': '报备审批 · 快递费用', 'waiting': '客服主管 周敏',
     'waited': '45m', 'owner': '王磊', 'initiator': '李婷', 'reg': '自动', 'approval': 'AP-20260911-002'},
    {'no': 'S-20260911-0022', 'factory': 'FZJ', 'customer': 'Ethan Brooks', 'store': 'Forcome Direct', 'site': 'US', 'ticket': 'T-20260911-0035',
     'method': '寄配件', 'branch': '易仓有货', 'resp': '产品质量问题', 'part': 'FC-V2-CB01', 'qty': 1, 'tracking': None,
     'product': 1.40, 'freight': 5.90, 'comp': 0.0, 'other': 0.0, 'filing': None, 'ratios': R_FAC, 'ratio_state': '建议',
     'nego': '未发起', 'settle': '未定', 'status': '待确认', 'step': '确认责任与处理方式', 'waiting': '售后负责人 王磊', 'waited': '15m',
     'owner': '王磊', 'reg': '自动'},
]

# ---------------------------------------------------------------- 审批单（动作审批与报备合一）
# status：待审批 执行中 已执行 执行失败 已驳回 已撤回（「已超时」是标记，「已批准」是审批项状态，都不是审批单状态）
APPROVALS = [
    {'no': 'AP-20260911-001', 'at': '09:30', 'by': '陈晨', 'ticket': 'T-20260902-0071', 'aftersales': 'S-20260911-0020', 'customer': 'Mateo Rivas',
     'store': 'Forcome Direct', 'site': 'MX',
     'filings': [('额外赔偿', 'MX$889.00（≈ $49.39）', '免退货全额退款')],
     'actions': [('亚马逊退款 MX$889.00', 'SP-API', None)],
     'reply': '西班牙语回复，退款成功后自动发出', 'approver': '客服主管', 'deadline': '13:30', 'left': '3h 10m', 'status': '待审批'},
    {'no': 'AP-20260911-002', 'at': '09:35', 'by': '李婷', 'ticket': 'T-20260910-0195', 'aftersales': 'S-20260911-0021', 'customer': 'Marcus Lee',
     'store': 'Forcome Auto', 'site': 'US',
     'filings': [('快递费用', '$8.40', '错发换发，UPS Ground')],
     'actions': [('易仓创建售后出库单：易仓 US · 整机黑色 ×1', '积加（易仓）', None)],
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
    ('10:12', '查询易仓 US 库存', '积加 · 自动', '失败：积加接口超时，第 2 次重试成功', 'warning'),
    ('09:41', '发起报备 AP-20260911-003 · 快递费用 $11.50', '系统 · 自动', 'S-20260911-0018', 'success'),
    ('09:40', '生产厂提交报价，写入登记台账', '工厂工作台 · 陈工', 'S-20260911-0018', 'success'),
    ('08:50', '向生产厂 FQD 派发询价单', '系统 · 自动', 'S-20260911-0019', 'success'),
    ('08:21', '向生产厂 FQD 派发询价单', '系统 · 自动', 'S-20260911-0018', 'success'),
    ('08:02', '亚马逊退款 MX$539.00 执行成功', 'SP-API · 自动', 'T-20260909-0128 · AP-20260910-011', 'success'),
]
# P15 执行日志的显示口径：「失败后重试成功」按中性灰 + 信息图标显示（不是失败，也不需要关注）。时刻 → (色调, 说明)
APPROVAL_LOG_OVERRIDE = {'10:12': ('neutral', '重试后成功（首次积加接口超时）')}
# AP-20260911-004 改收货地址（Shopify #1057，同在旧金山）：(字段, 原值, 新值)，P15 逐字段对比
PRIYA_ADDRESS_DIFF = [('街道', '2210 Mission St', '1450 Market St'), ('门牌', 'Apt 3', 'Apt 1104'), ('城市', 'San Francisco', 'San Francisco'),
                      ('州', 'CA', 'CA'), ('邮编', '94110', '94103')]
# StatesApproval A10：AP-20260911-001 剩 1 小时提醒（remind）→ 周敏视角截图（view）→ 周敏打开加锁（lock）→ 王磊从提醒进入（backup）
APPROVAL_LOCK_DEMO = {'remind': '12:30', 'view': '12:32', 'lock': '12:33', 'backup': '12:35'}

# StatesInbox I11 合并工单：演示时刻 NOW 之后到达的新来信（不在 TICKETS 里，P03 的 10:20 画面仍「没有其他未关闭工单」）
MERGE_DEMO = {'no': 'T-20260911-0038', 'at': '10:31', 'subject': '¿Dónde está mi reembolso?'}

# ---------------------------------------------------------------- 工厂任务（factory：FQD / FZJ）
FACTORY_TASKS = [
    # 当天的时间只写时分；以工作日计的时限同时写截止时刻（R-CL-02）
    {'factory': 'FQD', 'type': '询价', 'aftersales': 'S-20260911-0019', 'item': '软管 FC-V2-HS02 ×2 · 寄往墨西哥', 'state': '待处理', 'due': '剩 2 个工作日 · 09-15 周二 09:00 截止', 'at': '08:50'},
    {'factory': 'FQD', 'type': '比例协商', 'aftersales': 'S-20260903-0012', 'item': '电池 ×1 · 费用 $23.40 · FSH 提议' + ratio_words(R_FAC), 'state': '已提交', 'note': '已还价' + ratio_words(R_HALF) + '，双方负责人处理中', 'at': '09-05 10:30'},
    {'factory': 'FQD', 'type': '询价', 'aftersales': 'S-20260911-0018', 'item': 'HEPA 滤芯组件 FC-V2-HF01 ×1 · 寄往美国', 'state': '已提交', 'note': '已报价 $14.70，等 FSH 报备', 'at': '09:40'},
    {'factory': 'FQD', 'type': '比例协商', 'aftersales': 'S-20260910-0017', 'item': '集尘杯 ×1 · 费用 $10.90', 'state': '已完成', 'note': '已接受' + ratio_words(R_FAC), 'at': '09-10 17:10'},
    {'factory': 'FQD', 'type': '结算确认', 'aftersales': '批次 2026-09-FQD-A', 'item': '1 单 · 工厂承担 $13.20', 'state': '已完成', 'note': '已确认', 'at': '09-10 15:30'},
    {'factory': 'FQD', 'type': '寄件', 'aftersales': 'S-20260908-0015', 'item': '电池 FC-V2-BT01 ×1 · 寄往美国', 'state': '已完成', 'note': '已回填 YT2625100012345678', 'at': '09-09 15:30'},
    {'factory': 'FQD', 'type': '比例协商', 'aftersales': 'S-20260908-0015', 'item': '电池 ×1 · 费用 $22.10', 'state': '已完成', 'note': '已接受' + ratio_words(R_HALF), 'at': '09-09 11:20'},
    {'factory': 'FQD', 'type': '询价', 'aftersales': 'S-20260908-0015', 'item': '电池 FC-V2-BT01 ×1 · 寄往美国', 'state': '已完成', 'note': '已报价 $22.10', 'at': '09-08 10:40'},
    {'factory': 'FQD', 'type': '比例协商', 'aftersales': 'S-20260904-0013', 'item': 'HEPA 滤芯组件 ×2 · 费用 $13.20', 'state': '已完成', 'note': '已接受' + ratio_words(R_FAC), 'at': '09-05 16:40'},
    {'factory': 'FQD', 'type': '寄件', 'aftersales': 'S-20260903-0012', 'item': '电池 FC-V2-BT01 ×1 · 寄往墨西哥', 'state': '已完成', 'note': '已回填 YT2625100012340921', 'at': '09-04 16:10'},
    {'factory': 'FQD', 'type': '询价', 'aftersales': 'S-20260903-0012', 'item': '电池 FC-V2-BT01 ×1 · 寄往墨西哥', 'state': '已完成', 'note': '已报价 $23.40', 'at': '09-03 11:30'},
    {'factory': 'FZJ', 'type': '结算确认', 'aftersales': '批次 2026-09-FZJ-A', 'item': '1 单 · 工厂承担 $7.30', 'state': '已完成', 'note': '已确认', 'at': '09-10 16:05'},
    {'factory': 'FZJ', 'type': '比例协商', 'aftersales': 'S-20260905-0014', 'item': '充电线 ×1 · 费用 $7.30', 'state': '已完成', 'note': '已接受' + ratio_words(R_FAC), 'at': '09-06 10:05'},
]

# ---------------------------------------------------------------- 结算
SETTLE_BATCHES = [
    {'no': '2026-09-FQD-A', 'factory': 'FQD', 'at': '09-08', 'items': ['S-20260904-0013'], 'state': '已结算', 'note': '提前生成；陈工 09-10 15:30 确认、王磊 09-10 确认'},
    {'no': '2026-09-FZJ-A', 'factory': 'FZJ', 'at': '09-08', 'items': ['S-20260905-0014'], 'state': '已结算', 'note': '提前生成；张工 09-10 16:05 确认、王磊 09-10 确认'},
    {'no': '2026-09-FQD-B', 'factory': 'FQD', 'at': '10-05', 'items': ['S-20260908-0015', 'S-20260910-0017'], 'state': '待生成', 'note': '每月 5 日按生产厂自动生成上月批次，可提前生成'},
]
BATCH = {b['no']: b for b in SETTLE_BATCHES}


# ---------------------------------------------------------------- 订单、库存、历史审批单（页面上引用的补充事实）
ORDERS = {
    '113-4567890-1234567': {'customer': 'Sarah Mitchell', 'item': 'V2 黑色 ×1', 'amount': '$49.99', 'date': '09-03',
                            'resend_freight': 12.40,  # A 版补发：易仓运费试算 UPS Next Day Air
                            'carrier': 'UPS', 'tracking': '1Z4R28830358229017'},
    '#1063': {'customer': 'Olivia Turner', 'item': 'V2 车载吸尘器 ×1', 'amount': '$54.99', 'date': '08-05', 'age': '37 天'},
    '302-8811234-9901122': {'customer': 'Mateo Rivas', 'item': '车载吸尘器 V2 ×1', 'amount': 'MX$889.00', 'usd': 49.39, 'delivered': '08-27'},
    '114-7788990-2233441': {'customer': 'Ethan Brooks', 'amount': '$49.99', 'date': '08-19', 'age': '23 天'},
    '111-2233445-5566778': {'customer': 'Laura Bennett', 'phone': '+1 404-555-0182', 'address': '1180 Peachtree St NE, Atlanta, GA 30309',
                            'address_new': '455 Ponce De Leon Ave NE, Atlanta, GA 30308',
                            'tracking': 'YT2625100012351234', 'freight_actual': 13.20},  # 寄件、改地址为报备通过后的后续画面
    '113-2244668-8800997': {'customer': 'Marcus Lee', 'aftersales': 'S-20260910-0017'},
    '#1049': {'customer': 'Priya Raman', 'aftersales': 'S-20260902-0011', 'refund_no': 'RF-1049-01'},
    '305-1122334-4455667': {'customer': 'Diego Salazar', 'country': '墨西哥', 'zip': '06600'},  # 询价阶段生产厂只见目的国与邮编
}
# 生产厂报价（StatesFactory F3、F7、F9 用的「提交后」画面；S-20260911-0019 在演示时刻 NOW 仍为待报价）
QUOTES = {
    'S-20260911-0019': {'product': 5.20, 'freight': 12.80, 'carrier': '云途专线', 'ship_date': '2026-09-14', 'at': '10:22',
                        'memo': '批次号 HS-2608，现货。'},
}
# 报价参考（P21 ✦ 参考行，仅参考，仍由对接人填写）：该配件近 3 次报价（每根，USD）与寄往各国的运费区间
QUOTE_REF = {'FC-V2-HS02': {'unit': (2.40, 2.70), 'freight': {'MX': (11.90, 13.60)}}}
INVENTORY = {  # 易仓 US 库存（经积加查询时刻）
    ('FC-V2-CB01', '09-11 10:05'): 12,
    ('FC-V2-DC01', '09-10 09:20'): 8,
}
AI_CONFIDENCE = {'S-20260911-0022': '88%'}  # P08 责任建议置信度
# AI 内容的「生成时间 · 依据」（R-AI-01），均早于演示时刻 NOW；键为页面位置
AI_MADE = {
    'P08_preselect': '10:06 生成 · 依据来信、积加订单与「充电线不充电排查」',    # S-20260911-0022 10:05 创建后
    'P12_basis': '09-11 09:02 生成 · 依据本单沟通与 S-20260908-0015',  # S-20260903-0012 升级后商定依据
    'P21_quote_ref': '08:50 生成 · 依据近 3 次报价与运费记录',                  # 询价单 08:50 派发时
    'P13_backfill': '10:16 生成 · 依据积加易仓出库单',                           # 积加最近同步 10:16（CHANNEL_SYNC）
    'K13_draft': '10:08 生成 · 依据 2 条缺口来信与「FBM 补发标准」',              # K13 第一簇点「✦ AI 起草条目」后
}
HISTORY_APPROVALS = {'S-20260905-0014': 'AP-20260905-002', 'S-20260910-0017': 'AP-20260910-003', 'S-20260902-0011': 'AP-20260902-004'}
# P07「已等」离时限远近：未列出的为常规；S-20260903-0012 升级后商定时限 09-14 周一 09:00，剩不到 1 个工作日（黄）
AS_WAIT_LEVEL = {'S-20260903-0012': 'warning'}
# P12 商定依据的 AI 草稿（依据本单沟通 + 相近单据的协商结论）
NEGO_AI_BASIS = {'S-20260903-0012': '保修期内失效，但电池出厂到签收已 9 个月，有库存老化因素；参照 S-20260908-0015（同为电池寄配件，责任「其他」，按三组均 FSH 50 / 工厂 50 结案），建议三组均 FSH 50 / 工厂 50。'}
# P13「待回填」预填：这些单的快递单号没有自动回写（易仓回传延迟），积加出库单里已有单号（即 AFTERSALES 的 tracking），台账给出核对补登建议
LEDGER_BACKFILL = ['S-20260909-0016']


# ---------------------------------------------------------------- 计算函数
def total(a):
    return round(sum(x or 0 for x in (a['product'], a['freight'], a['comp'], a['other'])), 2)


def _parts(a):
    """三组费用：产品成本 / 快递物流 / 其他费用（额外赔偿 + 其他）。"""
    return {'product': a['product'] or 0, 'freight': a['freight'] or 0, 'other': (a['comp'] or 0) + (a['other'] or 0)}


def factory_share(a):
    p, r = _parts(a), a['ratios']
    return round(sum(p[k] * r[k][1] / 100.0 for k in p), 2)


def fsh_share(a):
    p, r = _parts(a), a['ratios']
    return round(sum(p[k] * r[k][0] / 100.0 for k in p), 2)


def ratio_uniform(r):
    """三组费用比例相同时返回该比例，否则返回 None（台账、卡片按「按费用项」显示）。"""
    v = set(r.values())
    return v.pop() if len(v) == 1 else None


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


def settle_counts():
    """内部结算（P14）各组单数：有生产厂承担的单按结算状态计数。"""
    rows = [a for a in AFTERSALES if a['status'] != '待确认' and a['settle'] != '不适用']
    c = lambda st: sum(1 for a in rows if a['settle'] == st)
    return {'all': len(rows), 'settled': c('已结算'), 'pending': c('待结算'), 'undecided': c('未定')}


CLOSED = ('已关闭', '已合并')


def merge_candidates(no):
    """R-TK-04：同店铺、同客户的其他未关闭工单（合并候选）。为空时「合并」按钮置灰。"""
    t = [x for x in TICKETS if x['no'] == no][0]
    return [x['no'] for x in TICKETS if x['no'] != no and x['store'] == t['store'] and x['customer'] == t['customer'] and x['status'] not in CLOSED]


def _sla_minutes(t):
    import re
    m = re.match(r'(\d+)h (\d+)m', t.get('sla_left', ''))
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def ticket_counts():
    """P04 指标卡：未关闭、待审草稿（其中未分配）、2 小时内到期（按渠道 / 内部目标）、转人工（按风险信号）。"""
    open_ = [t for t in TICKETS if t['status'] not in ('已解决',) + CLOSED]
    drafts = [t for t in TICKETS if t['status'] == '待审草稿']
    due = [t for t in open_ if _sla_minutes(t) is not None and _sla_minutes(t) <= 120]
    esc = [t for t in TICKETS if t['status'] == '转人工']
    return {'open': len(open_), 'drafts': len(drafts), 'drafts_unassigned': sum(1 for t in drafts if t['owner'] == '未分配'),
            'due2h': len(due), 'due2h_amazon': sum(1 for t in due if t['channel'] == '亚马逊' and not t.get('sla_kind')),
            'due2h_internal': sum(1 for t in due if t.get('sla_kind') == '内部目标'),
            'escalated': len(esc), 'esc_platform': sum(1 for t in esc if t.get('reason', '').startswith('平台风险'))}


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

# ---------------------------------------------------------------- 收件箱队列与工单列表顺序
# 收件箱左栏「全部」分段的行顺序（prd_c P01：按 SLA 剩余升序，无 SLA 的按到达时间）
INBOX_QUEUE_ORDER = ['T-20260902-0071', 'T-20260910-0176', 'T-20260910-0192', 'T-20260910-0195', 'T-20260911-0031',
                     'T-20260910-0170', 'T-20260911-0035', 'T-20260910-0201', 'T-20260910-0188', 'T-20260909-0142',
                     'T-20260909-0128']
# 默认分段「需处理」= 待审草稿 + 转人工（按 SLA 升序）；计数由 QUEUE_COUNTS 推出
INBOX_NEED_ORDER = [n for n in INBOX_QUEUE_ORDER if {t['no']: t for t in TICKETS}[n]['status'] in ('待审草稿', '转人工')]
INBOX_SEG_COUNTS = dict(QUEUE_COUNTS, 需处理=QUEUE_COUNTS['待审草稿'] + QUEUE_COUNTS['转人工'])
# P04 工单列表：按 SLA 剩余升序；已解决的排在最后（按最近来信倒序）
TICKET_LIST_ORDER = INBOX_QUEUE_ORDER + ['T-20260904-0098', 'T-20260909-0131']


def owner_load():
    """P04「推荐负责人」：各负责人当前负载（未关闭、已分配的工单数），按 TICKETS 顺序计。"""
    out = {}
    for t in TICKETS:
        if t['status'] not in ('已解决',) + CLOSED and t['owner'] != '未分配':
            out[t['owner']] = out.get(t['owner'], 0) + 1
    return out

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
    'mateo_in_es': ("El aspirador dejó de funcionar en menos de una semana. Me prometieron una batería de repuesto y lleva más de una "
                    "semana sin llegar. Quiero que me devuelvan mi dinero; si no, voy a dejar una reseña negativa."),
    'mateo_in_zh': '机器用了不到一周就不工作了。之前答应给我补发电池，一个多星期了还没到。我要退款，否则我会留差评。',
    'mateo_progress_zh': 'Rivas 先生您好，您的退款申请我们已经受理，会尽快给您明确答复。补发的电池仍在运输途中。',
    'mateo_progress_es': ('Estimado Sr. Rivas: hemos recibido su solicitud de reembolso y le daremos una respuesta definitiva lo antes '
                          'posible. La batería de repuesto sigue en camino.'),
    'mateo_bound_es': ('Estimado Sr. Rivas: lamentamos mucho lo ocurrido. Hoy le hemos reembolsado el importe completo de MX$889.00. '
                       'Puede quedarse con la batería de repuesto, no es necesario devolverla.'),
    'mateo_bound_zh': 'Rivas 先生您好，非常抱歉。我们今天已为您全额退款 MX$889.00。补发的电池您可以留用，无需退回。',
    'marcus_bound': ("Hi Marcus, sorry about the wrong color. We're sending the black V2 today via UPS Ground, arriving in 3-5 business days. "
                     "Please keep the grey unit, no return needed."),
    'priya_address_old': '2210 Mission St, Apt 3, San Francisco, CA 94110',  # 与 PRIYA_ADDRESS_DIFF 一致
    'priya_address_new': '1450 Market St, Apt 1104, San Francisco, CA 94103',
    # StatesInbox I7 草稿失效：旧稿（A 版）承诺句、坐席在旧稿里加的一句、新来信后重新生成的新稿
    'sarah_A_stale': ("Since you need it before Tuesday, we won't wait on the carrier: a replacement ships Friday, Sep 11 via UPS Next Day Air "
                      "and arrives Monday, Sep 14."),
    'sarah_edit': "You'll get the new tracking number by email tonight.",
    'sarah_new': 'Thanks for checking in, Sarah. Your replacement ships today via UPS Next Day Air and arrives Monday, Sep 14, before your Tuesday trip.',
}

# ---------------------------------------------------------------- 客户来信正文（收件箱中栏）
MSG_IN = {
    'sarah_en': ("Hi, I ordered the car vacuum on Sep 3 and tracking hasn't updated since Sep 5. It was due yesterday. "
                 "Is the package lost? I need it before my road trip next Tuesday. Order 113-4567890-1234567."),
    'sarah_zh': '你好，我 9 月 3 日买了车载吸尘器，物流从 9 月 5 日起就没更新，本应昨天送到。包裹丢了吗？下周二自驾出行前我一定要用上。订单 113-4567890-1234567。',
    'sarah_followup': 'Any update on this? I leave Tuesday morning and really need it before then.',  # 10:18 新来信（StatesInbox I7）
    'olivia_en': ("Hi, my V2 worked great at first, but after a few weeks the suction got really weak. I empty the dust cup after "
                  "every use. Is something broken? Order #1063."),
}

# ---------------------------------------------------------------- AI 草稿头部：推荐理由与置信度（置信度 ⓘ 悬停说明依据齐全度与同类历史采纳率）
DRAFT_AI = {
    'T-20260910-0192': {'reason': '客户 9 月 15 日（周二）前要用，UPS 已 6 天无扫描，查件来不及，先补发', 'basis': '物流停滞流程 · FBM 补发标准',
                        'conf': '82%', 'conf_why': '依据齐全 3 / 3 · 同类历史采纳率 91%（示例值）'},
    'T-20260911-0031': {'reason': '症状是「几周后吸力变弱」，排查树首步即清洁滤芯，多数可自行解决；不行再寄滤芯',
                        'conf': '86%', 'conf_why': '依据齐全 3 / 3 · 同类历史采纳率 88%（示例值）'},
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
    'summary': '3 笔订单，2 张工单。6 月问过一次物流进度，此前无投诉、无退款。这次是第一次负面来信，原因是包裹停滞且有明确用车期限。',
    'summary_short': '3 笔订单、2 张工单。6 月问过一次物流进度，此前无投诉、无退款。这次是第一次负面来信。',  # 收件箱右栏用的短版
    'summary_basis': '09-10 16:01 生成 · 依据 3 笔订单与 2 张工单',
}
# 订单 → 关联工单（P06 订单卡；06-10 那笔对应 06-14 的物流查询工单；Shopify #0988 无工单）
ORDER_TICKET = {'113-4567890-1234567': 'T-20260910-0192', '112-7788001-3344556': 'T-20260614-0117'}

# ---------------------------------------------------------------- 客户卡：Olivia Turner（P02）、Mateo Rivas（P03）
OLIVIA = {'email': 'olivia.turner@example.com',
          'summary': 'forcome.com 客户，1 笔订单 #1063（08-05，$54.99，保修期内）。首次来信，无投诉、无退款记录。',
          'summary_basis': '09-11 09:13 生成 · 依据 1 笔订单与 1 张工单'}
MATEO = {'email': 'mateo.r.8k3p@marketplace.amazon.com.mx',
         'summary': '亚马逊 MX 客户，1 笔订单 MX$889.00（≈ $49.39）。09-02 首次来信反映机器不工作，已补发电池；本次在我方答应补发后再次来信，要求退款并威胁差评。',
         'summary_basis': '09-10 11:16 生成 · 依据 1 笔订单与 2 封来信'}

# ---------------------------------------------------------------- 未归属店铺队列（StatesInbox I14）：收件地址或卖家 ID 未登记的来信与 AI 推荐店铺
UNASSIGNED_MAIL = [
    {'customer': 'Tom Harris', 'subject': 'Where is my order? Tracking says delivered.', 'source': '买家消息 · amz-ca2@forcome.com 未登记',
     'store': 'Forcome Direct CA', 'basis': '收件地址前缀 amz-、买家历史订单', 'at': '10:02', 'sla': '23h 42m'},
    {'customer': 'Lucía Herrera', 'subject': 'El filtro no encaja en mi aspiradora.', 'source': '邮件 · info@forcome.mx 未登记',
     'store': 'forcome.mx', 'basis': '收件地址域名、买家历史订单', 'at': '09:47', 'sla': '23h 27m · 内部'},
]

# ---------------------------------------------------------------- 知识库示例
KB = [
    ('物流停滞或超预计送达处理流程', '政策规则', '全部店铺', '英 · 西', '全部', '周敏', '2026-12-31', 64, '有效'),
    ('FBM 补发标准', '政策规则', '亚马逊店铺', '英 · 西', '亚马逊', '周敏', '2026-12-31', 41, '有效'),
    ('延误补偿规则', '政策规则', 'forcome.com（覆盖）', '英', '邮件', '周敏', '2026-10-31', 12, '有效'),
    ('吸力下降排查', '故障排查树', '全部店铺', '英 · 西', '全部', '王磊', '2027-03-31', 88, '有效'),
    ('充电线不充电排查', '故障排查树', '全部店铺', '英 · 西', '全部', '王磊', '2027-03-31', 23, '有效'),
    ('V2 规格与兼容车型', '产品事实表', '全部店铺', '英 · 西', '全部', '赵倩', '2027-06-30', 57, '有效'),
    ('进展回复模板 · 西班牙语', '模板与素材', 'Forcome Direct', '西', '亚马逊', '赵倩', '2026-12-31', 19, '有效'),
    ('拆下并清洗 HEPA 滤芯（图）', '模板与素材', '全部店铺', '英 · 西', '邮件', '赵倩', '2027-03-31', 15, '有效'),
    ('Q3 促销运费政策', '政策规则', '全部店铺', '英', '全部', '周敏', '2026-09-15', 9, '即将过期'),
]
KB_COUNTS = {'产品事实表': 42, '政策规则': 36, '故障排查树': 12, '模板与素材': 118, '沉淀问答': 64, '待审核沉淀': 3, '知识缺口': 5}
# 待审核沉淀（P16 摘要卡与 StatesAdmin K12 共用）：(问题, 来源工单, 提交人 · 日期)
KB_REVIEW = [('充电线不充电：先换插座、查保险丝，再换线测试', 'T-20260904-0098', '李婷 · 09-10'),
             ('HEPA 滤芯多久更换一次', 'T-20260909-0131', '李婷 · 09-09'),
             ('软管接口松脱的重新安装方法', 'T-20260908-0140', '陈晨 · 09-08')]
# 知识缺口按问题聚类（4 个缺口聚成 3 簇，页签计数 KB_COUNTS['知识缺口'] 由此推出；P16 摘要卡与 StatesAdmin K13 共用）：(簇名, 站点, 语言, [(问题, 来源工单, 原因, 最近)])
KB_GAP_CLUSTERS = [
    ('墨西哥站电池运输限制', 'MX', '西语', [
        ('¿Por qué la batería de repuesto tarda tanto en llegar?', 'T-20260902-0071', '转人工', '09-10'),
        ('La batería quedó retenida en aduana, ¿qué hago?', 'T-20260909-0150', '置信度低于 60%', '09-09')]),
    ('V2 与 Model Y 12V 插座兼容', 'US', '英语', [
        ('Does the V2 fit the 12V socket in a Tesla Model Y?', 'T-20260910-0176', '置信度低于 60%', '09-10')]),
    ('墨西哥站亚马逊退货退款到账时间', 'MX', '西语', [
        ('¿Cuándo recibo el reembolso después de la devolución?', 'T-20260909-0128', '拒绝原因：知识错误', '09-09')]),
]
KB_COUNTS['知识缺口'] = sum(len(c[3]) for c in KB_GAP_CLUSTERS)
# 素材库（StatesAdmin K11、K14）：(名称, 编号, 近 30 天引用次数, 纯文字版步骤)；图文版与纯文字版成对保存
KB_ASSETS = [('拆下并清洗 HEPA 滤芯', 'IMG-V2-014', 15, ['Twist the dust cup counterclockwise and lift it off.', 'Pull the HEPA filter straight out.',
                                                    'Rinse it under cold water. No soap.', 'Air-dry for 24 hours before refitting.']),
             ('点烟器保险丝检查', 'IMG-V2-009', 11, ['Unscrew the silver tip of the 12V plug.', 'Check the glass fuse for a broken wire.',
                                                 'Fit a new 10A fuse and screw the tip back on.']),
             ('集尘杯卡扣安装', 'IMG-V2-017', 8, ['Line up the arrow on the cup with the arrow on the body.', 'Push the cup in until it clicks.',
                                                'Tug it gently to check it is locked.']),
             ('软管接口重新安装', 'IMG-V2-021', 6, ['Press the release button and pull the hose off.', 'Push the hose back in until the latch clicks.'])]

# ---------------------------------------------------------------- 报表示例（近 7 天 09-05 至 09-11，标注为示例数据）
REPORT = {
    'tickets_week': 357, 'tickets_delta': '较前 7 天 +8%', 'daily_series': ('亚马逊', 'Shopify 与邮件'),
    'frt_median': '2h 14m', 'frt_delta': '较前 7 天 -35m',
    'sla_rate': '96.4%', 'sla_miss': 11,
    'adopt_rate': '41%', 'adopt_split': '未修改直接发送；另有修改后发送 27%',
    'auto_rate': '12%', 'auto_note': '订单查询、发票与收据',
    'daily': [('09-05', 38, 14), ('09-06', 41, 17), ('09-07', 29, 9), ('09-08', 22, 8), ('09-09', 45, 19), ('09-10', 52, 21), ('09-11', 30, 12)],
    'intents': [('订单查询', 31), ('退货与退款', 18), ('产品故障与使用问题', 16), ('产品咨询', 14), ('未收到与异常', 9), ('其他', 12)],
}


def intent_counts(total_n, intents):
    """P17 意图分布单数：按百分比把工单总量分到各意图（最大余数法，保证单数之和 = 总量）。"""
    raw = [(n, p, total_n * p / 100.0) for n, p in intents]
    base = [int(x) for _, _, x in raw]
    rest = total_n - sum(base)
    order = sorted(range(len(raw)), key=lambda i: -(raw[i][2] - base[i]))
    for i in order[:rest]:
        base[i] += 1
    return {raw[i][0]: base[i] for i in range(len(raw))}


# ---------------------------------------------------------------- 设置示例（P18–P20 与 StatesAdmin）
# 渠道卡「最近同步」时刻（P18）；「异常」为 K7 连接异常画面里的最后一次成功同步
CHANNEL_SYNC = {'SP-API': '10:12', 'SP-API 异常': '10:02', 'Shopify': '10:15', '积加': '10:16', 'Gmail': '10:18', 'Gmail 异常': '10:04',
                '钉钉': '10:00', '易仓': '10:16'}
# 关闭风险信号的影响（P19 二次确认提示）：近 30 天约少转人工的封数
RISK_OFF_IMPACT = {'重复联系': 23, '高价值': 14}
# 发送方式与阈值（P19、StatesAdmin K6/K9）
# 放开条件：('ok', 文字) 已放开或满足；('hard', 文字) 硬规则，灰锁不可改；('wait', [(指标, 当前, 要求, 进度%)]) 暂不满足，黄色 + 进度
SEND_RULES = [
    # 意图, 发送方式, 阈值, 采纳率, 样本, 放开条件, 开关: on / off / disabled
    ('订单查询', '自动发送', '85%', '96%', '212', ('ok', '已放开 · 09-01'), 'on'),
    ('发票与收据', '自动发送', '90%', '98%', '64', ('ok', '已放开 · 09-01'), 'on'),
    ('产品咨询', '待审草稿', '80%', '91%', '57', ('ok', '满足，可放开'), 'off'),
    ('购买咨询', '待审草稿', '80%', '84%', '38', ('wait', [('样本', '38', '50', 76)]), 'disabled'),
    ('未收到与异常', '待审草稿', '80%', '78%', '61', ('wait', [('采纳率', '78%', '90%', 87)]), 'disabled'),
    ('修改订单', '待审草稿', '—', '88%', '22', ('hard', '含高风险动作'), 'disabled'),
    ('到货问题', '待审草稿', '—', '83%', '31', ('hard', '含高风险动作'), 'disabled'),
    ('产品故障与使用问题', '待审草稿', '80%', '72%', '96', ('wait', [('采纳率', '72%', '90%', 80)]), 'disabled'),
    ('退货与退款', '待审草稿', '80%', '81%', '45', ('wait', [('采纳率', '81%', '90%', 90), ('样本', '45', '50', 90)]), 'disabled'),
    ('保修与配件购买', '待审草稿', '80%', '86%', '18', ('wait', [('样本', '18', '50', 36)]), 'disabled'),
    ('批发与合作', '转人工', '—', '—', '—', ('hard', '规则为转人工'), 'disabled'),
    ('评价与反馈', '转人工', '—', '—', '—', ('hard', '规则为转人工'), 'disabled'),
]
SEND_RULE_EDITS = {'产品咨询': ('80%', '85%')}  # P19 示例：1 项未保存修改（阈值 旧 → 新）

# 店铺覆盖项（P18 店铺表「覆盖项」列）：店铺 id → 已覆盖的配置
STORE_OVERRIDES = {'amz-direct': ['模板 1'], 'amz-auto': ['签名'], 'shop-com': ['政策口径 1'], 'shop-mx': ['签名']}

# 动作映射（P22）：统一动作, 分级, 亚马逊店铺 (接口, 色调) 或 None（平台不支持）, Shopify 店铺 (接口, 色调)
# 分级：只读 / 低风险 / 高风险 / 按发送方式；易仓出库单与库存经积加对接
ACTION_MAP = [
    ('查订单', '只读', ('积加', 'accent'), ('积加', 'accent')),
    ('查物流', '只读', ('积加', 'accent'), ('积加', 'accent')),
    ('查库存', '只读', ('积加（易仓）', 'accent'), ('积加（易仓）', 'accent')),
    ('回复客户', '按发送方式', ('Gmail 中转', 'accent'), ('Gmail', 'accent')),
    ('创建售后出库单', '高风险', ('积加（易仓）', 'accent'), ('积加（易仓）', 'accent')),
    ('订单备注', '低风险', ('系统内备注', 'neutral'), ('Admin API', 'accent')),
    ('退款', '高风险', ('SP-API', 'accent'), ('Admin API', 'accent')),
    ('改地址', '高风险', None, ('Admin API', 'accent')),
    ('取消', '高风险', ('SP-API', 'accent'), ('Admin API', 'accent')),
]
ACTION_UNSUPPORTED = {'改地址': '亚马逊不允许卖家改地址：草稿引导买家取消后重新下单'}

# 风险信号（P19「风险信号」页签，StatesAdmin K15）：名称, 命中条件, 优先级, 开关 lock（硬规则）/ on, 关闭影响（RISK_OFF_IMPACT）
RISK_SIGNALS = [
    ('安全事故', '起火、冒烟、过热、烫伤、电池鼓包', '紧急', 'lock'),
    ('平台风险', 'A-to-Z、拒付、差评威胁、投诉到平台、律师', '紧急', 'lock'),
    ('重复联系', '重复联系 2 次（1 次只升优先级）', '高', 'on'),
    ('高价值', '订单或累计消费超过 $300', '高', 'on'),
    ('要求真人', '客户明确要求与人沟通', '高', 'on'),
    ('无法处理的内容', '不支持的语言、乱码、只有附件', '普通', 'on'),
]

# 渠道内容能力（P19「渠道内容能力」页签，StatesAdmin K16）
LINK_WHITELIST = ['forcome.com', 'forcome.mx', 'youtube.com', 'ups.com', 'yuntrack.com']

# 售后规则（P23）：责任类型说明（是否协商、含义）与报备规则
RESP_NOTES = {'客户使用问题': ('不协商', '含顾客购买、使用不当'), '产品质量问题': ('需协商', '抱怨索赔'),
              '物流问题': ('不协商', '向承运商或易仓索赔'), '其他': ('需协商', '需填写理由；默认值')}
FILING_RULES = [('报备类型', '快递费用 · 额外赔偿'), ('审批人', '客服主管'), ('时限', '4 小时，剩 1 小时提醒'), ('金额门槛', '无'),
                ('超额补充报备', '实际金额超出报备 10% 以上')]

# SKU 类别（P24 工厂账号「负责的 SKU」表）；SKU 归属见 PART_FACTORY，名称见 PARTS
PART_CATEGORY = {'FC-V2-BLK': '整机', 'FC-V2-BT01': '电源', 'FC-V2-HS02': '结构件', 'FC-V2-HF01': '滤材', 'FC-V2-DC01': '结构件', 'FC-V2-CB01': '线材'}


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
