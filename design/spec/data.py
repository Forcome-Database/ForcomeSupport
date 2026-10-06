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
    'liting':   {'name': '李婷', 'avatar': '婷', 'role': '坐席', 'stores': '全部店铺', 'lang': 'EN · ES', 'dept': 'FSH / 客服部', 'email': 'liting@forcome.com', 'last_login': '08:02'},
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

# 钉钉通讯录里新入职、还没在 P20 分配角色的人：P20「从钉钉添加」的成员下拉列出他们（两家生产厂负责人刘厂长、周厂长同样还没有角色，
# 一并列出）；第一期示例数据与 Playwright 用（待办 06，K17 补充小样）
DINGTALK_NEWCOMERS = [
    {'key': 'wutong', 'name': '吴桐', 'avatar': '桐', 'dept': 'FSH / 客服部', 'email': 'wutong@forcome.com'},
]

# ---------------------------------------------------------------- 生产厂（集团内部，两家）
# 配件与整机全部由集团内这两家生产厂生产；售后单按 SKU 归属派发、协商、结算。SKU 清单在 P24「工厂账号」配置，上线前导入（下列为示例）。
FACTORIES = {
    'FQD': {'code': 'FQD', 'scope': '整机及结构件：整机、电池、软管、HEPA 滤芯、集尘杯', 'contact': '陈工', 'head': '刘厂长',
            'mail': ['qc@fqd-forcome.com', 'chen.gong@fqd-forcome.com']},
    'FZJ': {'code': 'FZJ', 'scope': '线材：充电线', 'contact': '张工', 'head': '周厂长', 'mail': ['service@fzj-forcome.com']},
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
# 第一阶段导航（prd_b 4.1「第一阶段」表）：没有收件箱、审批、知识库；售后只有 P13；设置只有 P18、P20；生产厂对接人第一阶段不分配
NAV_BY_ROLE_P1 = {
    '坐席':       ['工单', '售后'],
    '客服主管':   ['工单', '售后', '报表'],
    '售后负责人': ['工单', '售后', '报表'],
    '知识库负责人': ['工单', '报表'],
    '管理员':     ['报表', '设置'],
}

# ---------------------------------------------------------------- 店铺
STORES = [
    # 亚马逊：买家消息走亚马逊官方邮件中转，收发都在该店铺绑定的邮箱（Gmail API）；订单、物流、库存走积加，退款与取消走 SP-API。Shopify：客服邮箱（Gmail API）+ Admin API 写动作。
    {'id': 'amz-direct', 'name': 'Forcome Direct', 'platform': '亚马逊', 'sites': ['US', 'CA', 'MX'], 'mailbox': 'amz-direct@forcome.com', 'api': 'SP-API', 'sid': '卖家 ID A1FD7Q2M9XK3LC', 'signature': 'Forcome Support', 'default_site': 'US'},
    {'id': 'amz-auto',   'name': 'Forcome Auto',   'platform': '亚马逊', 'sites': ['US'],             'mailbox': 'amz-auto@forcome.com',   'api': 'SP-API', 'sid': '卖家 ID A3KA8V1T6RW2NB', 'signature': 'Forcome Auto Care', 'default_site': 'US'},
    {'id': 'shop-com',   'name': 'forcome.com',    'platform': 'Shopify', 'sites': ['US', 'CA'],      'mailbox': 'support@forcome.com',    'api': 'Admin API', 'sid': 'forcome-com.myshopify.com', 'signature': 'Forcome Support', 'default_site': 'US'},
    {'id': 'shop-mx',    'name': 'forcome.mx',     'platform': 'Shopify', 'sites': ['MX'],            'mailbox': 'support@forcome.mx',     'api': 'Admin API', 'sid': 'forcome-mx.myshopify.com', 'signature': 'Forcome México', 'default_site': 'MX'},
]
# 店铺默认站点（来信无订单时用，D-23；P18 站点列加粗、K8）
STORE_DEFAULT_SITE = {s['id']: s['default_site'] for s in STORES}

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
    {'no': '2026-09-FQD-B', 'factory': 'FQD', 'at': '09-30', 'items': ['S-20260908-0015', 'S-20260910-0017'], 'state': '待生成', 'note': '每月末按生产厂自动生成当月批次，可提前生成'},
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
    # P05 订单卡（平台镜像，SP-API 非受限角色：不含买家姓名与地址明细，只有城市、州、国家）
    '204-5566778-9900112': {'customer': 'Oliver Grant', 'item': '车载吸尘器 V2 黑色 ×1', 'amount': 'CA$67.99', 'usd': 49.99, 'date': '08-20',
                            'status': '已签收', 'fulfil': 'MFN（自发货）', 'promise': '08-27', 'ship_to': 'Toronto, ON, CA',
                            'carrier': 'Canada Post', 'tracking': '7316204855219087', 'delivered': '08-26'},
}
# 第一阶段 Shopify 订单镜像的示例（待办 11）：第一阶段工单与台账引用的 Shopify 订单，Fake Shopify 回放它们（经夹具）。
# 下单与最近更新（平台 updated_at）、商品行（名称, 数量）、金额（美元）、付款与履约状态、收件地址（街道, 门牌, 城市, 州, 邮编, 国家）、
# 履约单号（承运商, 单号）；客户邮箱由夹具按客户名推出（同 Fake 来信），写了 email 的照用。#1063 的商品、金额、下单日同 ORDERS。
# #0991 是 Emily Chen 用另一个邮箱下的单：她 P04 那张联系表单工单（问能不能用在 Tesla 上）按邮箱反查零笔、不关联订单，
# 原型 P04 订单号写「—」（待办 14，协调者 2026-10-07 决定）
SHOPIFY_ORDERS_P1 = {
    '#0991': {'store': 'forcome.com', 'customer': 'Emily Chen', 'email': 'emily.c@example.com', 'placed': '08-14 16:05', 'updated': '08-18 11:20',
              'items': [('V2 车载吸尘器 白色', 1)], 'total': 48.99, 'paid': 'PAID', 'fulfilled': 'FULFILLED',
              'ship_to': ('418 SE Morrison St', None, 'Portland', 'OR', '97214', 'US'), 'tracking': ('UPS', '1Z9X4E770312345678')},
    '#1049': {'store': 'forcome.com', 'customer': 'Priya Raman', 'placed': '08-22 20:15', 'updated': '09-02 10:11',
              'items': [('V2 车载吸尘器 黑色', 1)], 'total': 54.99, 'paid': 'PARTIALLY_REFUNDED', 'fulfilled': 'FULFILLED',
              'ship_to': ('2210 Mission St', 'Apt 3', 'San Francisco', 'CA', '94110', 'US'), 'tracking': ('UPS', '1Z9X4E770398765432')},
    '#1052': {'store': 'forcome.com', 'customer': 'David Park', 'placed': '08-26 09:40', 'updated': '08-30 15:02',
              'items': [('V2 车载吸尘器 黑色', 1)], 'total': 54.99, 'paid': 'PAID', 'fulfilled': 'FULFILLED',
              'ship_to': ('1100 Congress Ave', None, 'Austin', 'TX', '78701', 'US'), 'tracking': ('UPS', '1Z9X4E770355501234')},
    '#1057': {'store': 'forcome.com', 'customer': 'Priya Raman', 'placed': '09-09 18:20', 'updated': '09-09 18:21',
              'items': [('V2 车载吸尘器 黑色', 1)], 'total': 54.99, 'paid': 'PAID', 'fulfilled': 'UNFULFILLED',
              'ship_to': ('2210 Mission St', 'Apt 3', 'San Francisco', 'CA', '94110', 'US'), 'tracking': None},
    '#1063': {'store': 'forcome.com', 'customer': 'Olivia Turner', 'placed': '08-05 13:30', 'updated': '08-09 16:45',
              'items': [('V2 车载吸尘器', 1)], 'total': 54.99, 'paid': 'PAID', 'fulfilled': 'FULFILLED',
              'ship_to': ('1550 Larimer St', None, 'Denver', 'CO', '80202', 'US'), 'tracking': ('UPS', '1Z9X4E770377712345')},
}
# 第一阶段亚马逊订单镜像的示例（待办 12）：第一阶段工单与台账引用的亚马逊订单，Fake SP-API 回放它们（经夹具）。
# 店铺、站点、下单与最近更新（平台 lastUpdatedTime）、商品行（名称, 数量）、金额（原币, 币种）、履约状态（SP-API 的 fulfillmentStatus）、
# 履约方（MFN 自发货 / AFN 亚马逊配送）、承诺发货与送达（最晚时刻）、收件地址（城市, 州, 邮编, 国家：非受限角色读不到姓名与街道，美国站也读不到邮编）、
# MFN 包裹单号（承运商, 单号；AFN 没有）。customer 只是给人看的对照（非受限角色读不到买家姓名，不进夹具）。
# 113-4567890-1234567、302-8811234-9901122、114-7788990-2233441、204-5566778-9900112 的商品、金额、下单日、单号同 ORDERS
AMAZON_ORDERS_P1 = {
    '113-4567890-1234567': {'store': 'Forcome Direct', 'site': 'US', 'customer': 'Sarah Mitchell', 'placed': '09-03 08:12', 'updated': '09-05 19:40',
                            'items': [('V2 车载吸尘器 黑色', 1)], 'total': (49.99, 'USD'), 'status': 'SHIPPED', 'fulfil': 'MFN',
                            'ship_by': '09-04 23:59', 'deliver_by': '09-09 23:59', 'ship_to': ('Seattle', 'WA', None, 'US'),
                            'tracking': ('UPS', '1Z4R28830358229017')},
    '302-8811234-9901122': {'store': 'Forcome Direct', 'site': 'MX', 'customer': 'Mateo Rivas', 'placed': '08-20 21:05', 'updated': '08-27 15:30',
                            'items': [('车载吸尘器 V2', 1)], 'total': (889.00, 'MXN'), 'status': 'SHIPPED', 'fulfil': 'MFN',
                            'ship_by': '08-21 23:59', 'deliver_by': '08-28 23:59', 'ship_to': ('Monterrey', 'NL', '64000', 'MX'),
                            'tracking': ('Estafeta', '8055123450001')},
    '114-7788990-2233441': {'store': 'Forcome Direct', 'site': 'US', 'customer': 'Ethan Brooks', 'placed': '08-19 10:22', 'updated': '08-23 09:10',
                            'items': [('V2 车载吸尘器', 1)], 'total': (49.99, 'USD'), 'status': 'SHIPPED', 'fulfil': 'AFN',
                            'ship_by': '08-20 23:59', 'deliver_by': '08-23 23:59', 'ship_to': ('Columbus', 'OH', None, 'US'), 'tracking': None},
    '204-5566778-9900112': {'store': 'Forcome Direct', 'site': 'CA', 'customer': 'Oliver Grant', 'placed': '08-20 09:30', 'updated': '08-26 16:20',
                            'items': [('车载吸尘器 V2 黑色', 1)], 'total': (67.99, 'CAD'), 'status': 'SHIPPED', 'fulfil': 'MFN',
                            'ship_by': '08-21 23:59', 'deliver_by': '08-27 23:59', 'ship_to': ('Toronto', 'ON', 'M5V 2T6', 'CA'),
                            'tracking': ('Canada Post', '7316204855219087')},
    '113-2244668-8800997': {'store': 'Forcome Direct', 'site': 'US', 'customer': 'Marcus Lee', 'placed': '08-28 17:45', 'updated': '09-01 10:20',
                            'items': [('V2 车载吸尘器 黑色', 1)], 'total': (49.99, 'USD'), 'status': 'SHIPPED', 'fulfil': 'MFN',
                            'ship_by': '08-29 23:59', 'deliver_by': '09-03 23:59', 'ship_to': ('Chicago', 'IL', None, 'US'),
                            'tracking': ('UPS', '1Z4R28830355508812')},
    '305-1122334-4455667': {'store': 'Forcome Direct', 'site': 'MX', 'customer': 'Diego Salazar', 'placed': '09-02 12:10', 'updated': '09-06 18:35',
                            'items': [('车载吸尘器 V2', 1)], 'total': (889.00, 'MXN'), 'status': 'SHIPPED', 'fulfil': 'MFN',
                            'ship_by': '09-03 23:59', 'deliver_by': '09-10 23:59', 'ship_to': ('Ciudad de México', 'CDMX', '06600', 'MX'),
                            'tracking': ('Estafeta', '8055123450417')},
    '302-4455667-1122334': {'store': 'Forcome Direct', 'site': 'MX', 'customer': 'Sofía Márquez', 'placed': '08-30 19:20', 'updated': '09-05 12:00',
                            'items': [('车载吸尘器 V2', 1)], 'total': (889.00, 'MXN'), 'status': 'SHIPPED', 'fulfil': 'MFN',
                            'ship_by': '08-31 23:59', 'deliver_by': '09-07 23:59', 'ship_to': ('Guadalajara', 'JAL', '44100', 'MX'),
                            'tracking': ('Estafeta', '8055123450288')},
    '113-3344556-6677889': {'store': 'Forcome Direct', 'site': 'US', 'customer': 'Noah Kim', 'placed': '08-24 11:00', 'updated': '08-29 15:15',
                            'items': [('V2 车载吸尘器', 1)], 'total': (49.99, 'USD'), 'status': 'SHIPPED', 'fulfil': 'AFN',
                            'ship_by': '08-25 23:59', 'deliver_by': '08-28 23:59', 'ship_to': ('Denver', 'CO', None, 'US'), 'tracking': None},
    '113-6677001-2233445': {'store': 'Forcome Direct', 'site': 'US', 'customer': 'Hannah Ross', 'placed': '09-02 08:40', 'updated': '09-05 10:30',
                            'items': [('V2 车载吸尘器 白色', 1)], 'total': (49.99, 'USD'), 'status': 'SHIPPED', 'fulfil': 'MFN',
                            'ship_by': '09-03 23:59', 'deliver_by': '09-08 23:59', 'ship_to': ('Boston', 'MA', None, 'US'),
                            'tracking': ('UPS', '1Z4R28830370012345')},
    '111-2233445-5566778': {'store': 'Forcome Auto', 'site': 'US', 'customer': 'Laura Bennett', 'placed': '09-01 14:30', 'updated': '09-04 11:05',
                            'items': [('V2 车载吸尘器 灰色', 1)], 'total': (59.99, 'USD'), 'status': 'SHIPPED', 'fulfil': 'MFN',
                            'ship_by': '09-02 23:59', 'deliver_by': '09-07 23:59', 'ship_to': ('Atlanta', 'GA', None, 'US'),
                            'tracking': ('UPS', '1Z4R28830361110245')},
    '113-5566112-7788990': {'store': 'Forcome Auto', 'site': 'US', 'customer': 'James Walker', 'placed': '09-06 20:15', 'updated': '09-08 13:40',
                            'items': [('V2 车载吸尘器 灰色', 1)], 'total': (59.99, 'USD'), 'status': 'SHIPPED', 'fulfil': 'MFN',
                            'ship_by': '09-07 23:59', 'deliver_by': '09-12 23:59', 'ship_to': ('Phoenix', 'AZ', None, 'US'),
                            'tracking': ('UPS', '1Z4R28830366677120')},
    '113-9988776-5544332': {'store': 'Forcome Auto', 'site': 'US', 'customer': 'Marcus Lee', 'placed': '09-04 09:55', 'updated': '09-07 16:10',
                            'items': [('V2 车载吸尘器 灰色', 1)], 'total': (59.99, 'USD'), 'status': 'SHIPPED', 'fulfil': 'MFN',
                            'ship_by': '09-05 23:59', 'deliver_by': '09-10 23:59', 'ship_to': ('Chicago', 'IL', None, 'US'),
                            'tracking': ('UPS', '1Z4R28830369981234')},
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
    """R-AS-08：工厂承担逐行四舍五入到分，FSH 承担 = 该行费用合计 − 工厂承担。"""
    return round(total(a) - factory_share(a), 2)


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
     'store': 'Forcome Direct CA', 'basis': '收件地址前缀 amz-、买家历史订单', 'at': '10:02', 'sla': '23h 42m',
     'to': 'amz-ca2@forcome.com', 'to_hdr': 'Delivered-To', 'from_domain': 'marketplace.amazon.ca', 'sla_kind': '亚马逊 24 小时'},
    {'customer': 'Lucía Herrera', 'subject': 'El filtro no encaja en mi aspiradora.', 'source': '邮件 · info@forcome.mx 未登记',
     'store': 'forcome.mx', 'basis': '收件地址域名、买家历史订单', 'at': '09:47', 'sla': '23h 27m · 内部',
     'to': 'info@forcome.mx', 'to_hdr': 'To', 'from_domain': 'gmail.com', 'sla_kind': '内部目标 24 小时'},
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
                '钉钉': '10:00', '易仓': '10:16', '钉钉 延迟': '08:00', '17TRACK': '10:10'}  # 「钉钉 延迟」为 K20 同步延迟示例的最近同步
DINGTALK_LATE_SYNC = CHANNEL_SYNC['钉钉 延迟']
# Gmail 某个邮箱的连接异常与同步延迟示例（K7、K20 补充小样，待办 09 · 10-06 用户确认）：邮箱、连续失败从几点起与次数、最近同步成功
GMAIL_ISSUE = {'mailbox': 'support@forcome.mx', 'since': '10:05', 'failures': 3, 'last': CHANNEL_SYNC['Gmail 异常']}
GMAIL_DELAYED = {'mailbox': 'support@forcome.mx', 'last': '10:05'}  # 演示时刻 10:20，超过 10 分钟没同步成功
# 几个邮箱同时异常、另有一个延迟（E3，协调者 10-06 决定）：(邮箱, 连续失败从几点起, 次数)；延迟的 (邮箱, 最近同步成功)
GMAIL_ISSUES_MIXED = [('amz-auto@forcome.com', '10:12', 3), ('support@forcome.mx', '10:05', 5)]
GMAIL_DELAYED_MIXED = ('support@forcome.com', '10:06')
# G4 集成中断横幅（全站，所有角色；「查看渠道状态」只对管理员显示）。K7 统一用这一写法（待办 09 Q1，10-06 用户确认）
G4_BANNER = ('Gmail 连接中断，来信暂存队列', '09-11 %s 起未收取。恢复后自动补收，按到达顺序处理，SLA 从原到达时间计算。管理员、客服主管已收到通知。' % GMAIL_ISSUE['since'])
# Shopify 订单同步（待办 11 · 协调者 10-06 决定，套用 Gmail 已确认的写法）：某个店铺的连接异常与同步延迟示例（店铺、连续失败从几点起与次数、
# 最近同步成功），全站横幅（Gmail 与 Shopify 同时异常时各一条、Gmail 在上），连接异常与恢复的站内通知、P27 的对象与「补拉」写法
SHOPIFY_ISSUE = {'store': 'forcome.mx', 'since': '10:05', 'failures': 3, 'last': '10:04'}
SHOPIFY_DELAYED = {'store': 'forcome.mx', 'last': '10:05'}
G4_BANNER_SHOPIFY = ('Shopify 订单同步中断', '09-11 %s 起未同步。来信照常收取，恢复后自动补拉订单。管理员、客服主管已收到通知。' % SHOPIFY_ISSUE['since'])
SHOPIFY_NOTICES = [('Shopify 连接异常', '%s 连续 3 次失败，订单暂停同步' % SHOPIFY_ISSUE['store']),
                   ('Shopify 已恢复', '%s 已重新连接，补拉 2 笔订单' % SHOPIFY_ISSUE['store'])]
SHOPIFY_AUDIT = {'object': 'Shopify · %s' % SHOPIFY_ISSUE['store'], 'summary': '状态：连接异常 → 已连接（补拉 2 笔订单）',
                 'backfilled': '2 笔订单（10:05–10:13 更新）'}
# 亚马逊订单同步（待办 12 · 协调者 10-06 决定 Q1–Q8，套用 Shopify 的写法，按店铺）：某个店铺的连接异常与同步延迟示例、全站横幅
# （几个渠道同时异常时 Gmail → 亚马逊 → Shopify 上下叠放）、连接异常与恢复的站内通知、P27 的对象与「补拉」写法
AMAZON_ISSUE = {'store': 'Forcome Auto', 'since': '10:05', 'failures': 3, 'last': CHANNEL_SYNC['SP-API 异常']}
AMAZON_DELAYED = {'store': 'Forcome Auto', 'last': '10:05'}
G4_BANNER_AMAZON = ('亚马逊订单同步中断', '09-11 %s 起未同步。来信照常收取，恢复后自动补拉订单。管理员、客服主管已收到通知。' % AMAZON_ISSUE['since'])
AMAZON_NOTICES = [('亚马逊 SP-API 连接异常', '%s 连续 3 次失败，订单暂停同步' % AMAZON_ISSUE['store']),
                  ('亚马逊 SP-API 已恢复', '%s 已重新连接，补拉 2 笔订单' % AMAZON_ISSUE['store'])]
AMAZON_AUDIT = {'object': '亚马逊 SP-API · %s' % AMAZON_ISSUE['store'], 'summary': '状态：连接异常 → 已连接（补拉 2 笔订单）',
                'backfilled': '2 笔订单（10:05–10:13 更新）'}
SQS_STATE = ('正常', 0)       # 亚马逊订单通知队列（SQS）：状态, 积压条数（P18、K20）
# SQS 行的四种写法（Q7）：正常（等待拉取的通知少于 10 条，写出条数）、积压（≥ 10 条）、拉取失败（连续 3 次）、未连接（没配置 SQS）；
# 只影响这一行，不改卡片与店铺的连接状态、不出横幅、不发通知
SQS_STATES = [('正常', 0), ('积压', 12), ('拉取失败', None), ('未连接', None)]
AMZ_BACKFILL_DAYS = 90        # 第一阶段亚马逊订单回补天数（K20）
# 订单回补行的四种写法（待办 13 · 协调者 10-06 决定 Q2）：(状态, 天数, 已回补笔数)。只汇总连接上的店铺（未连接的不计）：有进行中的为进行中
# （已回补笔数为各店铺合计，平台不给总数、不写百分比）；否则有还没回补的为未开始（上线后新加的店铺也回到这里，提示管理员再执行一次）；
# 都回补完为已完成；Shopify 没开通 read_all_orders 只回补 60 天，完成后写「未开通 read_all_orders」。天数取各店铺回补窗口中最短的；
# 该平台没有连接上的店铺、卡片连接异常时不显示这一行，部分店铺未连接时照写（协调者 10-06 决定）
BACKFILL_STATES = [('未开始', 90, None), ('进行中', 90, 1284), ('已完成', 90, None), ('未开通', 60, None)]
SLA_HOURS = {'亚马逊': 24, '内部目标': 24}  # K22：亚马逊首次回复时限（平台考核）与 Shopify 与邮件内部目标的全局值
# K24 模板编辑示例：正文含具体时刻「by Friday」，保存时按 R-SL-05 报错
TEMPLATE_DEMO = {'name': '进展回复 · 英语', 'body': 'Hi {客户名}, thanks for your patience. We are checking order {订单号} with the carrier and will update you by Friday.',
                 'bad': 'by Friday'}
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
    ('查订单', '只读', ('SP-API（订单镜像）', 'accent'), ('Admin API（订单镜像）', 'accent')),  # 订单平台直读（D-21）
    ('查物流', '只读', ('17TRACK', 'accent'), ('17TRACK', 'accent')),  # 物流轨迹经 17TRACK（D-21）
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
    ('疑似提示注入', '来信含试图改变系统行为的指令（忽略规则、直接退款、透露内部信息），附原文片段', '高', 'lock'),
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


# ================================================================ 第一阶段（D-22、D-24）与补充页面
# ---------------------------------------------------------------- 第一阶段工单（P04 第一阶段版 I16、P05 第一阶段版 I18）
# 第一阶段状态只有 待回复 / 等客户 / 已解决 / 已关闭（prd_b 6.1 第一阶段迁移表）；其余字段沿用 TICKETS
P1_STATUS = {
    'T-20260902-0071': '待回复', 'T-20260910-0192': '待回复', 'T-20260910-0195': '待回复', 'T-20260910-0176': '待回复',
    'T-20260911-0031': '待回复', 'T-20260910-0170': '等客户', 'T-20260911-0035': '等客户', 'T-20260910-0201': '等客户',
    'T-20260910-0188': '等客户', 'T-20260909-0142': '等客户', 'T-20260904-0098': '已解决', 'T-20260909-0131': '已解决',
    'T-20260909-0128': '等客户',
}
# 第一阶段才出现的工单：已超时的待回复、来源为生产厂的待回复（不计 SLA 与工单量）、30 天内已关闭
P1_EXTRA_TICKETS = [
    {'no': 'T-20260910-0158', 'customer': 'James Walker', 'store': 'Forcome Auto', 'channel': '亚马逊', 'site': 'US', 'source': '客户',
     'subject': 'Box arrived crushed, the vacuum is cracked', 'status': '待回复', 'sla_left': '已超时 2h 05m', 'sla_level': 'danger',
     'last_in': '09-10 08:15', 'order': '113-5566112-7788990'},
    {'no': 'T-20260911-0036', 'customer': 'FQD 品质部', 'store': 'forcome.com', 'channel': '邮件', 'site': 'US', 'source': '生产厂',
     'subject': '9 月电池批次抽检报告', 'status': '待回复', 'sla_left': '—', 'sla_level': 'none',
     'last_in': '09-11 09:58', 'order': None, 'from': 'qc@fqd-forcome.com'},
    {'no': 'T-20260901-0059', 'customer': 'Priya Raman', 'store': 'forcome.com', 'channel': 'Shopify', 'site': 'US', 'source': '客户',
     'subject': 'My package is 9 days late', 'status': '已关闭', 'close_reason': '客户未回复', 'sla_left': '—', 'sla_level': 'none',
     'last_in': '09-02 10:30', 'order': '#1049'},
]


def p1_tickets():
    """第一阶段工单列表行（按 P04 第一阶段默认排序）：已超时在前，其后按 SLA 剩余升序，再按 待回复 → 等客户 → 已解决 → 已关闭，组内最近来信倒序。"""
    rows = []
    for t in TICKETS:
        st = P1_STATUS[t['no']]
        r = dict(t, status=st, source='客户')
        if st == '等客户':
            r.update(sla_left='已回复', sla_level='none')
        elif st != '待回复':
            r.update(sla_left='—', sla_level='none')
        rows.append(r)
    rows += [dict(t) for t in P1_EXTRA_TICKETS]
    group = {'待回复': 0, '等客户': 1, '已解决': 2, '已关闭': 3}

    def key(r):
        m = _sla_minutes(r)
        last = r['last_in'] if len(r['last_in']) > 5 else NOW[5:10] + ' ' + r['last_in']
        desc = tuple(-ord(c) for c in last)  # 组内按最近来信倒序
        if r['sla_left'].startswith('已超时'):
            return (0, 0, desc)
        if m is not None:
            return (1, m, desc)
        return (2 + group[r['status']], 0, desc)
    return sorted(rows, key=key)


# P17 下钻到 P04 的示例：「每日工单量」09-10 的柱（prd_c P17、AC-P1-14）
P1_DRILL = {'label': '09-10 新建或重开 · 客户来信', 'count': REPORT['daily'][5][1] + REPORT['daily'][5][2]}

# P05 第一阶段（I18）：Oliver Grant 工单，我方回复来自 Gmail「已发送」（对应不到成员），致谢来信由李婷标记无需回复
P1_OLIVER = {
    'ticket': 'T-20260904-0098', 'mailbox': 'amz-direct@forcome.com', 'marked_by': '李婷', 'marked_at': '09-10 09:05',
    'close_at': '09-17 09:00', 'close_reason': '已解决后无来信', 'order_synced': '09:02',  # 画面时刻 09-10 09:05，订单卡最近同步取其之前
    # (日期分隔, 时刻, 类型 in / out / marked, 内容)
    'timeline': [
        ('09-04 周五', '10:12', 'in', "Hi, the charger cable doesn't work. I plug it in and nothing happens, no light on the vacuum at all."),
        ('09-04 周五', '10:40', 'out', "Hi Oliver, sorry about the trouble. Could you try a different 12V socket and check the car's cigarette lighter fuse? If it still won't charge, just reply here and we'll sort it out."),
        ('09-05 周六', '08:58', 'in', 'Tried another socket, still nothing. But it charges fine with my own USB-C cable.'),
        ('09-05 周六', '15:30', 'out', 'Hi Oliver, a replacement charging cable is on its way via UPS, tracking 1Z4R28830358229052. Please keep the old cable, no return needed.'),
        ('09-10 周四', '09:00', 'marked', 'Thanks, the new cable works!'),
    ],
    # 状态流转：(状态, 时间, 触发方 · 事件)
    'flow': [('待回复', '09-04 10:12', '系统 · 新建'), ('等客户', '09-04 10:40', '系统 · 识别到我方回复'), ('待回复', '09-05 08:58', '系统 · 新来信'),
             ('等客户', '09-05 15:30', '系统 · 识别到我方回复'), ('待回复', '09-10 09:00', '系统 · 新来信'), ('已解决', '09-10 09:05', '李婷 · 标记无需回复')],
    # SLA 结果：(来信, 结果, 色调, 说明)
    'sla': [('09-04 10:12', '首次回复 28m', 'success', '达标'), ('09-05 08:58', '首次回复 6h 32m', 'success', '达标'),
            ('09-10 09:00', '无需回复 · 李婷', 'muted', '不计')],
}
# I18 另一张小图：SLA 结果的几种写法，以及生产厂来信、自动回复的显示
P1_SLA_KINDS = [('09-10 16:00', '剩 5h 40m', 'warning', '未到期'), ('09-10 08:15', '已超时 2h 05m', 'danger', '未达标'),
                ('09-08 11:02', '首次回复 3h 10m', 'success', '达标'), ('09-08 14:20', '无需回复 · 陈晨', 'muted', '不计'),
                ('09-11 09:58', '生产厂来信', 'muted', '不计（生产厂）')]
P1_AUTO_REPLY = {'from': 'support@forcome.com', 'at': '09-11 09:59', 'header': 'Auto-Submitted: auto-replied',
                 'body': 'Thanks for contacting Forcome. We have received your email and will reply within 24 hours.'}

# ---------------------------------------------------------------- 第一阶段台账（P13 第一阶段版 S13–S15，R-AS-08）
# 手工登记需要、AFTERSALES 里没有的字段：订单号、费用发生日、完成时间、发货方、承运方式、寄出日期、责任理由
# S-20260911-0022（待确认）第一阶段不存在：第一阶段没有待确认状态，示例夹具转换时丢弃
LEDGER_EXTRA = {
    'S-20260901-0010': {'order': '113-3344556-6677889', 'fee_date': '09-01', 'done': '09-03 15:10'},
    'S-20260902-0011': {'order': '#1049', 'fee_date': '09-02', 'done': '09-02 16:40'},
    'S-20260903-0012': {'order': '302-8811234-9901122', 'fee_date': '09-04', 'done': '09-05 11:20', 'shipper': '生产厂', 'carrier': '云途专线', 'ship_date': '09-04'},
    'S-20260904-0013': {'order': '#0991', 'fee_date': '09-04', 'done': '09-07 10:05', 'shipper': '易仓', 'carrier': 'UPS Ground', 'ship_date': '09-04'},
    'S-20260905-0014': {'order': '204-5566778-9900112', 'fee_date': '09-05', 'done': '09-06 09:30', 'shipper': '易仓', 'carrier': 'UPS Standard', 'ship_date': '09-05'},
    'S-20260908-0015': {'order': '113-6677001-2233445', 'fee_date': '09-08', 'done': '09-10 11:00', 'shipper': '生产厂', 'carrier': '云途专线', 'ship_date': '09-09',
                        'reason': '包裹途中受潮，承运商与产品责任都无法确认，双方分摊'},
    'S-20260909-0016': {'order': '#1052', 'fee_date': '09-09', 'done': '09-10 17:20', 'shipper': '易仓', 'carrier': 'UPS Ground', 'ship_date': '09-09'},
    'S-20260910-0017': {'order': '113-2244668-8800997', 'fee_date': '09-10', 'done': '09-11 09:30', 'shipper': '易仓', 'carrier': 'UPS Ground', 'ship_date': '09-10'},
    'S-20260911-0018': {'order': '111-2233445-5566778', 'fee_date': '09-11', 'shipper': '生产厂', 'carrier': '云途专线'},
    'S-20260911-0019': {'order': '305-1122334-4455667', 'fee_date': '09-11', 'shipper': '生产厂'},
    'S-20260911-0020': {'order': '302-8811234-9901122', 'fee_date': '09-10', 'rate_date': '09-10'},
    'S-20260911-0021': {'order': '113-9988776-5544332', 'fee_date': '09-11', 'shipper': '易仓', 'carrier': 'UPS Ground'},
}
# 第一阶段台账里 S-20260909-0016 的快递单号没有登记（第二阶段画面里是积加预填的待回填，LEDGER_BACKFILL）
P1_LEDGER_MISSING_TRACKING = ['S-20260909-0016']


def p1_ledger_rows():
    """第一阶段台账行：AFTERSALES 去掉待确认的单，补上 LEDGER_EXTRA；未发生的金额（None）按 0 计入售后成本，页面显示「—」。"""
    out = []
    for a in AFTERSALES:
        if a['status'] == '待确认':
            continue
        r = dict(a, **LEDGER_EXTRA.get(a['no'], {}))
        if a['no'] in P1_LEDGER_MISSING_TRACKING:
            r['tracking'] = None
        out.append(r)
    return out


def ledger_missing(r):
    """R-AS-08 必填矩阵：返回缺失的适用字段名（费用项为 0 视为已填，None 为未填）。"""
    miss = []
    for k, lab in (('store', '店铺'), ('site', '站点'), ('order', '订单号'), ('customer', '客户'), ('method', '处理方式'), ('resp', '责任类型'),
                   ('owner', '负责人'), ('fee_date', '费用发生日')):
        if not r.get(k):
            miss.append(lab)
    if r['resp'] == '其他' and not r.get('reason'):
        miss.append('责任理由')
    if r['method'] == '寄配件':
        for k, lab in (('part', '配件 × 数量'), ('shipper', '发货方'), ('carrier', '承运方式'), ('ship_date', '寄出日期'), ('tracking', '快递单号')):
            if not r.get(k):
                miss.append(lab)
    for k, lab in (('product', '产品成本'), ('freight', '运费'), ('comp', '额外赔偿'), ('other', '其他')):
        if r.get(k) is None:
            miss.append(lab)
    if r['method'] == '退款或部分补偿' and not (r.get('comp') or 0) > 0 and '额外赔偿' not in miss:
        miss.append('额外赔偿')
    if any(v[1] > 0 for v in r['ratios'].values()) and not r.get('factory'):
        miss.append('生产厂')
    if r['resp'] == '物流问题' and not (r.get('claim') and r.get('claim_state')):
        miss.append('索赔对象与状态')
    return miss


def ledger_completion(month='09'):
    """登记完整率（R-AS-08）：当月（按完成时间）已完成单中适用字段齐全的单数 ÷ 已完成单数；历史导入不计。"""
    done = [r for r in p1_ledger_rows() if r['status'] == '已完成' and r.get('done', '').startswith(month) and r.get('reg') != '历史导入']
    ok = [r for r in done if not ledger_missing(r)]
    pct = ('%.1f%%' % (100.0 * len(ok) / len(done))).replace('.0%', '%') if done else '—'
    return {'ok': len(ok), 'total': len(done), 'pct': pct}


# S14 新建登记示例（寄配件 · Olivia Turner）；S15 设为已完成与取消的示例单
LEDGER_NEW_DEMO = {'store': 'forcome.com', 'site': 'US', 'order': '#1063', 'customer': 'Olivia Turner', 'ticket': 'T-20260911-0031',
                   'owner': '王磊', 'fee_date': '09-11', 'method': '寄配件', 'resp': '产品质量问题', 'factory': 'FQD',
                   'part': 'FC-V2-HF01', 'qty': 1, 'shipper': '易仓', 'carrier': 'UPS Ground', 'product': 3.20, 'freight': 6.80}
LEDGER_DONE_DEMO = 'S-20260911-0018'   # 设为已完成：缺寄出日期、快递单号 2 项
LEDGER_CANCEL_DEMO = 'S-20260911-0021'

# ---------------------------------------------------------------- 报表「更新于」（prd_c P17、AC-P1-11）
REPORT_SOURCES = ('Gmail', 'SP-API', 'Shopify')  # 工单来自 Gmail；站点与订单关联用平台订单；台账为手工登记，不参与


def report_updated():
    """取所用数据源中最旧的一次同步成功时间。"""
    return min(CHANNEL_SYNC[k] for k in REPORT_SOURCES)


SHOPIFY_BACKFILL_DAYS = 60  # 第一阶段示例：未开通 read_all_orders，Shopify 订单只回补 60 天（K19、K20）

# ---------------------------------------------------------------- 审计日志（P27、K18）：(时刻, 操作人, 角色, 对象类型, 对象, 动作, 变更摘要, 来源 IP, 越权)
AUDIT_LOG = [
    ('10:14', '系统', '系统', '渠道', 'Gmail · support@forcome.mx', '恢复连接', '状态：连接异常 → 已连接（补拉 3 封来信）', '—', False),
    ('10:16', '系统', '系统', '售后单', 'S-20260909-0016', '✦ 生成补登建议', '快递单号：— → 1Z4R28830358229088（未写入，等核对）', '—', False),
    ('10:05', '系统', '系统', '渠道', 'Gmail · support@forcome.mx', '连接异常', '状态：已连接 → 连接异常（连续 3 次失败）', '—', False),
    ('09:52', '刘洋', '管理员', '成员', '赵倩', '修改店铺范围', '店铺范围：Forcome Direct → 全部店铺', '10.20.1.12', False),
    ('09:48', '李婷', '坐席', '审批单', 'AP-20260911-004', '提交审批', '动作：Shopify #1057 改收货地址', '10.20.3.27', False),
    ('09:41', '系统', '系统', '审批单', 'AP-20260911-003', '发起报备', '快递费用 $11.50 · S-20260911-0018', '—', False),
    ('09:35', '李婷', '坐席', '审批单', 'AP-20260911-002', '提交审批', '快递费用 $8.40 · 易仓出库单 · S-20260911-0021', '10.20.3.27', False),
    ('09:30', '陈晨', '坐席', '审批单', 'AP-20260911-001', '提交审批', '额外赔偿 MX$889.00（≈ $49.39）· S-20260911-0020', '10.20.3.33', False),
    ('09:12', '王磊', '售后负责人', '导出', '登记台账', '导出 Excel', '筛选：9 月 · 全部店铺 · 12 行', '10.20.2.18', False),
    ('08:31', '张工', '生产厂对接人', '售后单', 'S-20260911-0018', '越权访问被拒', '该单属于生产厂 FQD（R-FT-01）', '58.211.20.6', True),
    ('08:02', '李婷', '坐席', '登录', '钉钉扫码', '登录', '会话有效期 7 天（无操作）', '10.20.3.27', False),
]
# P27 第一行（10:14 Gmail 恢复连接）展开后的完整前后值：(字段, 前, 后)
AUDIT_P27_EXPAND = [('状态', '连接异常', '已连接'), ('最近同步成功', '10:04', '10:14'), ('补拉', '—', '3 封来信（10:05–10:13 到达，SLA 按原到达时间）'),
                    ('触发', '连续 3 次失败', '第 4 次重试成功')]
# K18 管理员视角展开的一条：售后单设为已完成（财务字段对管理员显示「已隐藏」）：(字段, 前, 后, 是否财务字段)。
# 展开列出该单快照里前后任一侧有值的全部字段（状态与完成在前，其后按登记抽屉自上而下，费用之后是承担比例，最后是创建路径与登记人），
# 变化的标出；摘要「等 N 项」的 N 是变化的字段数（P27「第一阶段」，待办 30 用户确认 10-05）
def _same(k, v, fin=False):
    return (k, v, v, fin)


AUDIT_EXPAND_DEMO = {'at': '09-10 17:20', 'who': '王磊', 'obj': 'S-20260909-0016', 'action': '设为已完成',
                     'fields': [('状态', '进行中', '已完成', False), ('完成时间', '—', '09-10 17:20', False),
                                _same('处理方式', '寄配件'), _same('店铺', 'forcome.com'), _same('站点', 'US'), _same('订单号', '#1052'),
                                _same('客户', 'David Park'), _same('来源工单', 'T-20260908-0140'), _same('费用发生日', '2026-09-09'),
                                _same('负责人', '王磊'), _same('责任类型', '客户使用问题'), _same('配件 × 数量', 'FC-V2-HS02 × 1'),
                                _same('发货方', '易仓'), _same('承运方式', 'UPS Ground'), _same('寄出日期', '2026-09-09'),
                                _same('产品成本', '$2.60', True), _same('运费', '$6.80', True), _same('额外赔偿', '$0.00', True),
                                _same('其他', '$0.00', True), _same('承担比例', '三组均 FSH 100 / 工厂 0', True),
                                _same('创建路径', '手工登记'), _same('登记人', '王磊')]}

# K18 补充小样（第一阶段实现，待办 30 用户确认 10-05）：周敏 · 近 7 天看到的几种第一阶段记录。
# (时刻, 操作人, 角色, 对象类型, 对象, 动作, 变更摘要, 来源 IP, 越权, 等 N 项)；本例陈晨的店铺范围只有 Forcome Direct
AUDIT_P1_MORE = [
    ('09-11 10:21', '周敏', '客服主管', '导出', '审计日志', '导出 Excel', '筛选：今天（2026-09-11） · 12 行', '10.20.1.30', False, 0),
    ('09-10 17:20', '王磊', '售后负责人', '售后单', 'S-20260909-0016', '设为已完成', '状态：进行中 → 已完成', '10.20.2.18', False, 2),
    ('09-09 14:02', '王磊', '售后负责人', '售后单', 'S-20260909-0016', '新建登记', '状态：— → 进行中', '10.20.2.18', False, 21),
    ('09-08 16:40', '陈晨', '坐席', '店铺', 'forcome.com', '越权访问被拒', '店铺 forcome.com 不在授权范围内（R-ST-06）', '10.20.3.33', True, 0),
    ('09-07 11:05', '刘洋', '管理员', '店铺', 'forcome.mx', '编辑店铺', '进线邮箱：support@forcome.mx → support@forcome.mx、ventas@forcome.mx', '10.20.1.12', False, 0),
]
# P27 导出的文件名（K5 的写法；今天、近 7 天、自定义分别为「审计日志_今天_0911」「审计日志_近7天_0905-0911」「审计日志_0901-0911」）
AUDIT_EXPORT_FILE = '审计日志_今天_0911.xlsx'

# ---------------------------------------------------------------- 站内通知（G10）：周敏，(时刻, 色调, 图标, 标题, 说明, 对象, 已读)
# 时刻：当天只写时:分，之前的写「月-日 时:分」（同 P27 时间列，待办 31 用户确认 10-06）
NOTIFICATIONS = [
    ('10:14', 'success', 'check_c', 'Gmail 已恢复', 'support@forcome.mx 已重新连接，补拉 3 封来信', 'P18 · Gmail', False),
    ('10:05', 'danger', 'alert', 'Gmail 连接异常', 'support@forcome.mx 连续 3 次失败，来信暂存', 'P18 · Gmail', False),
    ('10:02', 'warning', 'store', '未归属店铺来信', 'Tom Harris · amz-ca2@forcome.com 未登记', 'P04 · 未归属店铺', False),
    ('09:48', 'accent', 'approve', '新审批单', 'AP-20260911-004 · 李婷 · Shopify 改地址', 'AP-20260911-004', True),
    ('09:47', 'warning', 'store', '未归属店铺来信', 'Lucía Herrera · info@forcome.mx 未登记', 'P04 · 未归属店铺', True),
    ('09-10 18:12', 'accent', 'approve', '新审批单', 'AP-20260910-007 · 李婷 · 错发换发', 'AP-20260910-007', True),
]

# G10 补充小样（第一阶段实现，待办 05，2026-10-06 用户确认）：钉钉通讯录同步失败只提醒管理员（11.4、E-32），刘洋视角。
# 通讯录每个整点全量对账一次、失败不重试；连续失败的第 1 次「钉钉同步失败」、第 3 次（P18 钉钉卡转连接异常）「钉钉连接异常」，
# 之后不重复，恢复后不发。今天 08:00 之后的两次（09:00、10:00）都失败，同 K20（最近同步 08:00，同步延迟）；连接异常为 09-08 的一次。
DINGTALK_NOTIFICATIONS = [
    ('09:00', 'danger', 'alert', '钉钉同步失败', '通讯录同步失败，成员与部门保持上次结果，登录与权限不受影响', 'P18 · 钉钉', False),
    ('09-08 13:00', 'danger', 'alert', '钉钉连接异常', '通讯录连续 3 次同步失败，成员与部门保持上次结果，登录与权限不受影响', 'P18 · 钉钉', True),
]

# ---------------------------------------------------------------- P25 模型（技术方案 9.1）：用途, 名称, 阶段, 主模型, 备用模型, 推理强度, 时限, 提示词版本, 状态, 近 24h 调用, 失败率, 成本
MODEL_USES = [
    ('translate', '译文', '二', 'Claude Haiku 4.5', 'GPT-6-Astra', '低', '20s', 'v3', '正常', '1,284', '0.2%', '$1.86'),
    ('summarize', '摘要', '二', 'Claude Sonnet 5.5', 'Claude Haiku 4.5', '中', '30s', 'v2', '已切到备用 · 10:05', '412', '3.4%', '$2.10'),
    ('extract', '抽取', '二', 'Claude Haiku 4.5', 'GPT-6-Astra', '低', '15s', 'v4', '正常', '655', '0.0%', '$0.42'),
    ('assess', '售后评估', '二', 'Claude Opus 5.5', 'Claude Sonnet 5.5', '高', '60s', 'v2', '正常', '38', '0.0%', '$3.05'),
    ('triage', '分诊', '三', 'Claude Sonnet 5.5', 'GPT-6-Astra', '中', '20s', 'v6', '第三阶段启用', '—', '—', '—'),
    ('draft', '草稿', '三', 'Claude Fable 5.1', 'Claude Opus 5.5', '高', '40s', 'v9', '第三阶段启用', '—', '—', '—'),
    ('check', '回复检查', '三', 'Claude Sonnet 5.5', 'GPT-6-Astra', '中', '20s', 'v3', '第三阶段启用', '—', '—', '—'),
    ('knowledge', '知识', '三', 'Claude Sonnet 5.5', 'Claude Haiku 4.5', '中', '60s', 'v2', '第三阶段启用', '—', '—', '—'),
    ('judge', '评测', '三', 'Claude Opus 5.5', 'GPT-6-Astra', '高', '120s', 'v1', '第三阶段启用', '—', '—', '—'),
    ('embed', '嵌入', '三', '嵌入模型（经 NewAPI）', '—', '—', '10s', '—', '第三阶段启用', '—', '—', '—'),
]
MODEL_BREAKER_DEMO = {'use': 'summarize', 'at': '10:05', 'why': '5 分钟内失败 6 次', 'probe': '10:35'}

# ---------------------------------------------------------------- P26 系统状态（技术方案第 10 节）
HEALTH = {
    'checked': '10:20', 'heartbeat': '10:20:05', 'backup': '03:10', 'wal': '10:19', 'drill': '07-15',
    # 数据源：(名称, 最近同步, 阈值, 状态)
    'sources': [('Gmail · 4 个邮箱', CHANNEL_SYNC['Gmail'], '10 分钟', '已连接'), ('亚马逊订单 · SQS', CHANNEL_SYNC['SP-API'], '10 分钟', '已连接'),
                ('Shopify 订单', CHANNEL_SYNC['Shopify'], '10 分钟', '已连接'), ('积加', CHANNEL_SYNC['积加'], '10 分钟', '已连接'),
                ('17TRACK', '10:10', '5 小时', '已连接'), ('钉钉通讯录', CHANNEL_SYNC['钉钉'], '2 小时', '已连接'), ('汇率', '09-11 06:00', '1 天', '已连接')],
    # 队列：(任务, 等待, 进行中, 近 24h 失败, 最久等待)
    'queues': [('来信归并', 0, 1, 0, '—'), ('回复识别', 0, 0, 0, '—'), ('订单同步', 2, 1, 1, '40s'), ('动作执行', 1, 1, 3, '6m'),
               ('通知发送', 0, 0, 0, '—'), ('时限扫描', 0, 1, 0, '—')],
    # 外部调用（近 1 小时）：(系统 · 接口, 调用, 错误率, P95, 配额)
    'calls': [('SP-API · searchOrders', '64', '0.0%', '420ms', '令牌桶剩余 18 / 20'), ('Shopify · orders', '58', '0.0%', '310ms', '调用额度 92%'),
              ('积加 · 出库单', '22', '4.5%', '1.8s', '—'), ('Gmail · history.list', '24', '0.0%', '260ms', '—'),
              ('钉钉 · 工作通知', '17', '0.0%', '180ms', '本月 1,240 / 5,000'), ('17TRACK · 查询', '30', '0.0%', '650ms', '本月 3,100 / 10,000')],
}

# ---------------------------------------------------------------- P19「处理说明」页签（K21）：「未收到与异常」
INTENT_GUIDE = {
    'intent': '未收到与异常', 'published': 'v4 · 09-08 周敏', 'draft': 'v5（未发布）', 'regress': (18, 20),
    # (段落, 正文, 店铺覆盖说明或 None)
    'sections': [
        ('处理步骤', '先按订单号查平台订单与物流轨迹；轨迹停滞满 5 天或超过预计送达视为异常；签收但客户说没收到时先要投递证明。', None),
        ('何时给哪种方案', '客户写明截止日期且查件来不及时先补发（报备快递费用）；否则先查件并承诺 2 个工作日内答复；高价值订单可提部分补偿。', 'Forcome Direct 覆盖：MX 站补发电池前先确认清关限制'),
        ('3 版草稿如何区分', 'A 先补发 · B 先查件再定 · C 部分补偿或部分退款；只有一种合理方案时只给 1 版并说明原因。', None),
        ('语气与禁忌', '先致歉再给方案；不写具体送达时刻；亚马逊渠道不留站外联系方式。', None),
    ],
    'structured': [('需要的信息', '订单号；签收未收到需投递证明'), ('预取', '平台订单、物流轨迹（17TRACK）、易仓库存（积加）'),
                   ('允许的动作', '查件 · 补发（报备快递费用）· 部分补偿（额外赔偿）· 部分退款'), ('默认发送方式', '待审草稿'), ('置信度阈值', '80%')],
    # 未通过的回归样例：(样例来源工单, 情形, 期望, 实际)
    'failed': [('T-20260905-0110', '客户写明 09-08 前要用，轨迹停滞 6 天', '先补发', '先查件'),
               ('T-20260902-0063', '签收但客户说没收到，未附投递证明', '先要投递证明', '直接补发')],
}
INTENT_GUIDE_LIST = [(i, 'v4' if i == '未收到与异常' else 'v%d' % (2 + n % 3), i == '未收到与异常') for n, i in enumerate(
    ['产品咨询', '购买咨询', '批发与合作', '订单查询', '未收到与异常', '修改订单', '到货问题', '产品故障与使用问题', '退货与退款', '保修与配件购买', '发票与收据', '评价与反馈'])]

# ---------------------------------------------------------------- 设置「SLA」「标签库」「模板」（K22–K24）
SLA_OVERRIDES = {'amz-direct': None, 'amz-auto': None, 'shop-com': None, 'shop-mx': 12}  # None 为继承全局 24 小时
TAG_LIBRARY = [('路途急', '客户写明了出行或使用期限', 38, '已启用'), ('物流停滞', '轨迹停滞满 5 天或超预计送达', 52, '已启用'),
               ('差评风险', '来信提到差评、feedback 或投诉', 17, '已启用'), ('批发', '批量采购与合作询价', 6, '已启用')]
# (模板, 用途, 语言, 渠道, 适用店铺, 更新)
TEMPLATES = [('进展回复 · 英语', '进展回复', '英语', '全部', '全部店铺', '09-02'), ('进展回复 · 西班牙语', '进展回复', '西班牙语', '全部', 'Forcome Direct、forcome.mx', '09-02'),
             ('签名 · Forcome Support', '签名', '英语', '邮件', 'forcome.com', '08-20'), ('签名 · Forcome México', '签名', '西班牙语', '邮件', 'forcome.mx', '08-20'),
             ('补发已寄出通知', '通知', '英语', '全部', '全部店铺', '09-05')]


# ---------------------------------------------------------------- P15 / A11 / G7 演示
# A11（D-23，6.3、R-AP-06）：AP-20260911-002（09:35 李婷提交）提交后客户又来信。时刻在演示时刻 10:20 之后，
# 所以 P15（10:20）不出现提示，TICKETS 也不变；审批卡上的非阻断提示「提交后客户又来信 N 封」只在 StatesApproval A11 演示
AP_NEW_MAIL = {
    'AP-20260911-002': [{'at': '10:22', 'from': 'Marcus Lee',
                         'en': "Do I need to send the grey one back? There's no return label in the box.",
                         'zh': '灰色那台需要寄回吗？箱子里没有退货标签。'}],
}
# A11 时间线：① 周敏看到提示 → ② 批准、出库单创建成功并暂停（审批单已执行，子状态暂停待确认）、李婷视角 → ③ 李婷选择
A11_DEMO = {'view1': '10:23', 'approve': '10:24', 'outbound': '10:25', 'paused': '10:25', 'view': '10:26', 'choice': '照常发送', 'chosen': '10:27'}
# GlobalStates G7 乐观锁冲突：赵倩（知识库负责人）编辑王磊负责的排查树条目时，王磊 10:18 先保存了一版
G7_OCC = {'record': next(k for k in KB if k[0] == '吸力下降排查'), 'by': '王磊', 'at': '10:18', 'field': '第 2 步',
          'mine': '取下 HEPA 滤芯，轻拍除尘后用冷水冲洗，晾干 24 小时再装回；滤芯发黄或破损直接更换。',
          'theirs_fields': '第 2 步、适用型号'}
# StatesInbox I18 第二张小图：生产厂来信正文（工单 T-20260911-0036，主题取 P1_EXTRA_TICKETS）
P1_FACTORY_MAIL = '附件为 9 月电池批次抽检报告，请查收。若有客诉涉及该批次，请回复本邮件告知订单号，我们安排追溯。'


# ---- 第二阶段（D-25）演示
# ---------------------------------------------------------------- 第二阶段收件箱（StatesInbox I19）
# 第二阶段没有 AI 分诊与草稿，「分诊中」「待审草稿」「待审批」不出现（prd_b 6.1「第二阶段」）。演示时刻的工单映射为：
# 原待审草稿、待审批、转人工的都记为转人工（原因「人工处理」），其余沿用 TICKETS
P2_STATUS = {t['no']: ('转人工' if t['status'] in ('待审草稿', '待审批', '转人工') else t['status']) for t in TICKETS}
P2_REASON = '人工处理'
# 没有 AI 判定的紧急度：优先级默认「普通」，只按重复联系升级（R-TK-03，次数为 1 升一级）；Mateo Rivas 重复联系 1 次
P2_PRIORITY = {'T-20260902-0071': '高'}
# 挂在工单上的未结束审批单（工单号 → 审批单号）；系统发起的报备（AP-20260911-003）挂在售后单上，不算（prd_b 6.1 补充说明 2）
P2_OPEN_APPROVAL = {a['ticket']: a['no'] for a in APPROVALS if a['status'] == '待审批' and a['by'] != '系统'}


def p2_ticket(no):
    """第二阶段的工单视图：状态、优先级按上方映射，其余字段沿用 TICKETS。"""
    t = next(x for x in TICKETS if x['no'] == no)
    return dict(t, status=P2_STATUS[no], priority=P2_PRIORITY.get(no, '普通'))


def p2_segments():
    """I19 左栏四个分段的行（顺序同 INBOX_QUEUE_ORDER，按 SLA 剩余升序）：
    需处理 = 有未回复来信的未关闭工单（D-25；示例数据中未回复来信都在 SLA 计时中）；审批中 = 挂着未结束审批单；等待中 = 等客户 / 等内部 / 等外部；全部 = 未关闭。
    需处理与审批中可以重叠：已提交审批、来信还没回复的工单（Mateo Rivas、Marcus Lee）两个分段都列出。"""
    tk = {t['no']: t for t in TICKETS}
    allq = list(INBOX_QUEUE_ORDER)
    return {'需处理': [n for n in allq if P2_STATUS[n] not in ('已解决', '已关闭', '已合并') and _sla_minutes(tk[n]) is not None],  # 有未回复来信的未关闭工单
            '审批中': [n for n in allq if n in P2_OPEN_APPROVAL],
            '等待中': [n for n in allq if P2_STATUS[n] in ('等客户', '等内部', '等外部')],
            '全部': allq}


def p2_queue_counts():
    """I19 分段计数；收件箱导航角标 = 需处理（prd_b 4.1「第二阶段」）。"""
    return {k: len(v) for k, v in p2_segments().items()}


# I19 中栏：✦ 对话摘要（第二阶段的 AI 只有摘要与翻译，没有意图、情绪与风险判断）；回复框里李婷正在写的中文、英语译文与回译（R-LG-03）
P2_SARAH = {
    'summary': '9 月 3 日下单 V2 黑色，UPS 自 9 月 5 日无扫描，已超预计送达（9 月 9 日）。客户 9 月 15 日（周二）前要用，问包裹是否丢失。首次来信。',
    'reply_zh': 'Sarah 您好，很抱歉包裹一直没有更新。',
    'reply_en': "Hi Sarah, I'm sorry the tracking still hasn't updated.",
    'reply_back': 'Sarah 您好，很抱歉物流信息一直没有更新。',
}
# I19 右栏订单卡：亚马逊订单的平台镜像（SP-API 非受限角色，只有城市、州、国家）+ 积加补充的收件人（prd_c「收件箱第二阶段」）
P2_SHIP_TO = {'113-4567890-1234567': {'city': 'Evanston, IL, US', 'name': 'Sarah Mitchell', 'address': '1847 Maple Ave, Evanston, IL 60201',
                                      'phone': '+1 847-555-0193'}}

# ---------------------------------------------------------------- 人工提交审批（StatesInbox I20）：李婷在 Sarah Mitchell 工单上组织补发
INVENTORY[('FC-V2-BLK', '09-11 10:05')] = 12  # 易仓 US · V2 黑色整机（经积加查询）
P2_SUBMIT = {
    'ticket': 'T-20260910-0192', 'order': '113-4567890-1234567', 'warehouse': '易仓 US', 'sku': 'FC-V2-BLK', 'qty': 1,
    'carrier': 'UPS Next Day Air', 'stock_at': '09-11 10:05', 'approver': '周敏', 'limit_h': 4,
    'deadline': '%02d:%s' % (int(NOW[11:13]) + 4, NOW[14:16]),  # 演示时刻 + 4 小时（R-AP-03）
    # 绑定回复：从回复框带入（P2_SARAH 的首句）后写完，回复类型「结论性回复」
    'bound_zh': 'Sarah 您好，很抱歉包裹一直没有更新。我们会免费为您补发一台 V2，走 UPS 次日达，预计 9 月 14 日（周一）送到，赶得上您周二出行；原包裹我们也已向 UPS 发起查件。',
    'bound_en': ("Hi Sarah, I'm sorry the tracking still hasn't updated. We're sending you a free replacement V2 via UPS Next Day Air, "
                 "arriving Monday, Sep 14, in time for your Tuesday trip. We've also opened a trace with UPS on the original package."),
    'err_refund': 59.99,  # 校验态：另加的「亚马逊部分退款」误填 $59.99，超过订单金额 $49.99（E-25）
}

# ---------------------------------------------------------------- 转售后确认（StatesInbox I21）
# 演示时刻之后：Olivia Turner 15:46 回信说滤芯早已清洗晾干、吸力仍弱，附照片与视频；李婷 15:52 转售后确认。
# 时刻在 NOW 之后，不改 TICKETS（P02 的 10:20 画面不变）；售后单号接在当天最后一张之后
P2_OLIVIA_FOLLOWUP = {
    'at': '15:46',
    'en': ("I'd already washed the filter on Wednesday and let it dry for a full day before I wrote to you. "
           "Suction is still weak, see the video. The photo is the filter after drying."),
    'zh': '我周三就把滤芯洗过并晾了一整天，然后才给你们写信的。吸力还是很弱，见视频。照片是晾干后的滤芯。',
    # (文件名, 类型, 说明)
    'attachments': [('IMG_4127.jpg', '照片', '晾干后的 HEPA 滤芯'), ('suction_test.mov', '视频 · 0:18', '吸口吸力测试')],
}
P2_ESCALATE = {
    'ticket': 'T-20260911-0031', 'at': '15:52', 'by': '李婷',
    'no': 'S-20260911-%04d' % (max(int(a['no'][-4:]) for a in AFTERSALES if a['no'][2:10] == '20260911') + 1),
    'desc': '使用约 5 周后吸力明显下降。客户每次用后都清空集尘杯；滤芯清洗并晾干 24 小时后吸力仍弱，视频可见吸口吸力不足。',
    'checked': '已按排查树清洁滤芯并晾干 24 小时，吸力仍弱',
    'part': 'FC-V2-HF01',
    'sla_left': '23h 54m',  # 15:46 来信的内部目标 24 小时，15:52 时剩余
}


# ---------------------------------------------------------------- 第二阶段的手工登记单（StatesAfterSales S16，prd_b 6.5「第一阶段手工登记的单在第二阶段」边界）
# 第一行是第一阶段台账里真实的进行中单（S-20260911-0018，工厂承担按登记比例）；后两行为边界示例（单号按全局递增序号取在 0011 之前）。
# (售后单号, 客户, 店铺与站点, 状态, 当前环节, 在等谁, 生产厂, 协商, 结算, 结算色调)
P2_MANUAL_ROWS = [
    ('S-20260911-0018', 'Laura Bennett', 'Forcome Auto · US', '进行中', '手工登记 · 待补登', '王磊', 'FQD', '已确认 · 按登记值', '待结算 · 进 9 月月末批次（工厂 $14.70）', 'normal'),
    ('S-20260901-0007', 'Liam Foster', 'forcome.com · US', '已完成', '已完成', '—', '—', '已确认 · 按登记值', '未定 · 待补生产厂', 'warning'),
    ('S-20260728-0002', 'Grace Kim', 'Forcome Auto · US', '已完成', '已完成', '—', 'FQD', '不适用', '不适用 · 历史导入', 'muted'),
]


if __name__ == '__main__':
    t = ledger_totals()
    for k, v in t.items():
        print(k, v)
    for a in AFTERSALES:
        print(a['no'], total(a), fsh_share(a), factory_share(a), a['settle'])
    print(cost_by_resp())
