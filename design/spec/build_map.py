# -*- coding: utf-8 -*-
"""生成 PageMap.dc.html：按角色分泳道的页面地图、跳转关系与关键路径 SC-01～SC-08。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *

# 页面：名称、跳转 [(目标, 触发操作, 所属关键路径)]；与 PRD 4.4 一致
PAGES = {
    'P01': ('收件箱 · 亚马逊工单', [('P06', '点客户名', ''), ('P09', '点关联售后单', ''), ('P15', '提交审批后主管处理', 'SC-01')]),
    'P02': ('收件箱 · 邮件工单', [('P06', '点客户名', ''), ('P09', '点关联售后单（按分支到 P09–P11）', '')]),
    'P03': ('收件箱 · 转人工工单', [('P09', '点 S-0012（易仓无货）', ''), ('P11', '点 S-0020（退款）', ''), ('P15', '查看审批单', 'SC-03')]),
    'P04': ('工单列表', [('P01', '点未关闭工单', ''), ('P05', '点已解决或已关闭工单', '')]),
    'P05': ('工单详情 · 全程记录', [('P10', '点售后单', ''), ('P06', '点客户名', ''), ('P01', '重新打开后', '')]),
    'P06': ('客户档案', [('P01', '点未关闭工单', ''), ('P05', '点历史工单', ''), ('P04', '新建工单（预填客户）', '')]),
    'P07': ('售后单列表', [('P08', '点待确认行', 'SC-02'), ('P08', '新建售后单', ''), ('P09', '点易仓无货行', ''), ('P10', '点易仓有货行', ''), ('P11', '点退款或补偿行', ''),
                          ('P12', '快捷筛选 待协商后点行', ''), ('P13', '页签 登记台账', ''), ('P14', '页签 内部结算', 'SC-06')]),
    'P08': ('确认责任与处理方式', [('P09', '确认后（无货）', 'SC-04'), ('P10', '确认后（有货）', 'SC-02'), ('P01', '查看原工单', ''), ('P07', '退回继续排查后', '')]),
    'P09': ('售后单详情 · 易仓无货', [('P12', '查看协商', 'SC-05'), ('P01', '查看原工单', ''), ('P15', '查看报备', 'SC-04')]),
    'P10': ('售后单详情 · 易仓有货', [('P12', '查看协商', ''), ('P05', '查看原工单', ''), ('P14', '查看结算', '')]),
    'P11': ('售后单详情 · 部分补偿', [('P05', '查看原工单', ''), ('P15', '查看审批单', '')]),
    'P12': ('承担比例协商', [('P09', '查看售后单', ''), ('P14', '录入最终比例后进结算', 'SC-05')]),
    'P13': ('登记台账', [('P09', '点售后单号', ''), ('P14', '页签 内部结算', '')]),
    'P14': ('内部结算', [('P10', '点易仓有货的售后单号', ''), ('P09', '点易仓无货的售后单号', ''), ('P11', '点退款单的售后单号', '')]),
    'P15': ('审批', [('P01', '点关联工单', ''), ('P09–P11', '点关联售后单', 'SC-01')]),
    'P16': ('知识库', [('P05', '知识缺口来源工单', '')]),
    'P17': ('报表', [('P04', '点工单指标或下钻', ''), ('P13', '点成本指标或下钻', '')]),
    'P18': ('设置 · 渠道与店铺', [('P22 · P24', '设置菜单', ''), ('P20', '设置菜单 · 授权成员', 'SC-08')]),
    'P19': ('设置 · 处理规则', [('P23', '设置菜单', '')]),
    'P20': ('设置 · 团队与权限', [('P18 · P22 · P24', '设置菜单', '')]),
    'P21': ('工厂工作台', [('P21', '只在工作台内跳转', '')]),
    'P22': ('设置 · 动作映射', [('P18 · P20 · P24', '设置菜单', '')]),
    'P23': ('设置 · 售后规则', [('P19', '设置菜单', '')]),
    'P24': ('设置 · 工厂账号', [('P18 · P20 · P22', '设置菜单', '')]),
}

# 泳道：角色、示例人员、默认首页、主要页面、也会进入的页面
LANES = [
    ('坐席', '李婷、陈晨', 'P01', ['P01', 'P02', 'P03', 'P05', 'P06'], 'P15 我发起的 · P07 只读'),
    ('客服主管', '周敏', 'P01', ['P04', 'P15', 'P17', 'P19', 'P23'], 'P01–P03 收件箱'),
    ('售后负责人', '王磊', 'P07', ['P07', 'P08', 'P09', 'P10', 'P11', 'P12', 'P13', 'P14'], 'P15 只含动作的单 · 备用审批人'),
    ('知识库负责人', '赵倩', 'P16', ['P16'], 'P04 · P05 只读'),
    ('管理员', '刘洋', 'P17', ['P18', 'P22', 'P20', 'P24'], ''),  # 默认首页即 P17 报表，不再重复列出
    ('生产厂对接人', '陈工（FQD）、张工（FZJ）', 'P21', ['P21'], '独立入口，看不到客服系统'),
]
ROLE_OF = {p: lane[0] for lane in LANES for p in lane[3]}

# 关键路径（PRD 2.2）：步骤 = (页面或「系统」, 做什么)
FLOWS = [
    ('SC-01', '亚马逊补发', [('P01', '审草稿 · 提交审批（I8）'), ('P15', '主管批准（A2）'), ('系统', '经积加建易仓出库单 · 回复自动发出'), ('P10', '查看售后单')]),
    ('SC-02', '邮件排查转售后', [('P02', '发送排查草稿'), ('系统', '客户仍未解决 · 建待确认售后单'), ('P07', '点待确认行'), ('P08', '确认责任与处理方式'), ('P10', '易仓有货执行')]),
    ('SC-03', '风险工单退款', [('P03', '转人工 · 提交退款审批 · 先发进展回复'), ('P15', '批准（A2）'), ('系统', '经 SP-API 退款 · 回复自动发出')]),
    ('SC-04', '易仓无货配件', [('P08', '确认'), ('P21', '生产厂报价'), ('P15', '报备审批'), ('P21', '寄件回填单号'), ('P09', '单号回复客户')]),
    ('SC-05', '比例协商', [('P21', '生产厂还价'), ('P12', '升级 · 录入最终比例（S8、S12）')]),
    ('SC-06', '月底结算', [('P14', '生成批次（S9）'), ('P21', '生产厂确认')]),
    ('SC-07', '放开自动发送', [('P17', '看采纳率'), ('P19', '切换发送方式（K9）')]),
    ('SC-08', '新增店铺', [('P18', '新增店铺（K8）'), ('P20', '授权成员')]),
]
ON_PATH = {}
for code, _, steps in FLOWS:
    for p, _ in steps:
        if p.startswith('P') and code not in ON_PATH.setdefault(p, []):
            ON_PATH[p].append(code)


def sc_chip(code):
    return chip(code, 'accent', 11)


def page_card(pid):
    name, jumps = PAGES[pid]
    j = ''.join('<div style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: %s;">%s<span style="font-weight: 700; color: %s; white-space: nowrap;">%s</span><span>%s</span>%s</div>' % (
        T['ink3'], icon('arrow_r', 12, T['ink4']), T['accent_ink'], t, why, sc_chip(sc) if sc else '') for t, why, sc in jumps)
    paths = ON_PATH.get(pid, [])
    foot = row(nowrap('关键路径', 11, T['ink4']) + ''.join(chip(c, 'neutral', 11) for c in paths), 4) if paths else ''
    return card(row(chip(pid, 'accent', 11) + nowrap(name, 13, T['ink'], 600), 8) + col(j, 4) + foot, pad='12px 14px', gap=8, style='min-width: 0px;')


def lane(role, who, home, ids, also):
    head = col(nowrap(role, 15, T['ink'], 700) + nowrap(who, 12, T['ink3']) +
               row(nowrap('默认首页', 11, T['ink4']) + chip(home, 'accent', 11), 6) +
               (text('也会进入：' + also, 11, T['ink4']) if also else ''), 6, 'width: 190px; flex-shrink: 0; padding-top: 4px;')
    cards = grid(''.join(page_card(i) for i in ids), 5, 12, template='repeat(5, 262px)')
    return '<div style="display: flex; gap: 20px; align-items: flex-start; padding: 16px 0px; border-top: 1px solid %s;">%s%s</div>' % (T['line'], head, cards)


def flow_row(code, name, steps):
    boxes = []
    for p, what in steps:
        if p == '系统':
            top = row(chip('系统', 'neutral', 11) + nowrap('自动', 11, T['ink4']), 6)
        else:
            top = row(chip(p, 'accent', 11) + nowrap(ROLE_OF.get(p, ''), 11, T['ink3']), 6)
        boxes.append('<div style="display: flex; flex-direction: column; gap: 4px; background: #ffffff; border: 1px solid %s; border-radius: 10px; padding: 7px 10px; flex-shrink: 0;">%s%s</div>' % (
            T['line'], top, nowrap(what, 12, T['ink2'])))
    arrow = '<div style="flex-shrink: 0; display: flex; align-items: center;">%s</div>' % icon('arrow_r', 14, T['ink4'])
    return '<div style="display: flex; align-items: center; gap: 14px; padding: 8px 0px; border-top: 1px solid %s;">%s%s</div>' % (
        T['line2'], row(sc_chip(code) + nowrap(name, 13, T['ink'], 600), 8, extra='width: 190px; flex-shrink: 0;'), row(arrow.join(boxes), 8, wrap=True))


lanes_html = card(label('按角色的页面与跳转（每张卡列出可跳转的页面与触发操作；带 SC 编号的跳转属于关键路径）') + ''.join(lane(*l) for l in LANES), pad='16px 20px', gap=4)
flows_html = card(label('关键用户路径（PRD 2.2 · 页面编号后为执行角色）') + ''.join(flow_row(*f) for f in FLOWS), pad='16px 20px', gap=4)

legend = row(chip('Pxx', 'accent') + muted('页面编号（PRD 第 4、8 节）', 12) + icon('arrow_r', 12, T['ink4']) + muted('可跳转到的页面', 12) + sc_chip('SC-xx') + muted('关键路径编号（PRD 2.2）', 12), 8)
body = col(lanes_html + flows_html, 20)
save('PageMap.dc.html', board('页面地图', '24 个页面按主要使用角色分为 6 条泳道，泳道左侧写默认首页与也会进入的页面；每张卡列出可跳转的页面与触发操作，与 PRD 4.4 一致，页内弹窗（如 P02 的素材库选择器 K14）不算跳转。全局搜索可从任意页到达工单、售后单、客户档案；导航入口按角色显示（PRD 4.1）。', body, 1920, 1400, legend))
print('ok')
