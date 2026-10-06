# -*- coding: utf-8 -*-
"""第一期参照图：把第一阶段的页面按 1440 × 900 整页生成，并截图到 spec/shots/phase1/。

原型的高保真页面画的是完整版，第一阶段形态只在状态板里缩小呈现；前端严格照原型做（CLAUDE.md「界面严格按原型」），
所以另出这套全尺寸参照图供逐项核对。画面与状态板 I16–I18、S13、K18–K20 同源，口径以 PRD 各页「第一阶段」小节为准。

用法：python shot_phase1.py        （生成 spec/phase1/*.dc.html 与 spec/shots/phase1/*.png，并做溢出与裁切检查）
"""
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, 'pages'))
import ui
import build_tickets as TK
import build_ledger as BL
import build_settings as BS
import build_audit as AU
import build_states_admin as SA
import build_approval_kb_reports as RP
from check import JS
from playwright.sync_api import sync_playwright

OUT_HTML = os.path.join(HERE, 'phase1')
OUT_PNG = os.path.join(HERE, 'shots', 'phase1')

# (文件名, 页面与登录人, 生成函数)
PAGES = [
    ('P04_Tickets', 'P04 工单列表 · 周敏（客服主管）', lambda: TK.p04_p1()),
    ('P04_Tickets_drill', 'P04 工单列表 · 从 P17 下钻（来自报表芯片）', lambda: TK.p04_p1(drill=True)),
    ('P04_Tickets_unassigned', 'P04 工单列表 · 打开未归属店铺队列（I17，待办 15）', lambda: TK.p04_p1(view='unassigned')),
    ('P04_Tickets_unassigned_empty', 'P04 工单列表 · 未归属店铺队列为空（I17 ④）', lambda: TK.p04_p1(view='unassigned_empty')),
    ('P05_TicketDetail', 'P05 工单详情 · 李婷（坐席）', TK.p05_p1),
    ('P13_AfterSalesLog', 'P13 登记台账 · 王磊（售后负责人）', BL.p13_p1),
    ('P13_AfterSalesLog_agent', 'P13 登记台账 · 李婷（坐席，只读、不含金额列）', lambda: BL.p13_p1('liting')),
    ('P17_Reports', 'P17 报表 · 周敏（客服主管）', lambda: SA.p17_p1(RP)),
    ('P18_Settings', 'P18 渠道与店铺 · 刘洋（管理员）', lambda: BS.p18(phase1=True)),
    ('P20_SettingsTeam', 'P20 团队与权限 · 刘洋（管理员）', lambda: BS.p20(phase1=True)),
    ('P27_AuditLog', 'P27 审计日志 · 周敏（客服主管）', lambda: AU.p27(phase1=True)),
]


def main():
    os.makedirs(OUT_HTML, exist_ok=True)
    os.makedirs(OUT_PNG, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(channel='chrome')
        pg = b.new_page(viewport={'width': 1960, 'height': 1200})
        for name, label, fn in PAGES:
            html = ui.HEAD + fn() + ui.TAIL
            io.open(os.path.join(OUT_HTML, name + '.dc.html'), 'w', encoding='utf-8').write(html)
            html = html.replace('<script src="./support.js"></script>', '')
            html = html.replace('<x-dc>', '<x-dc style="display:block">').replace('<helmet>', '<helmet style="display:none">', 1)
            pg.set_content(html, wait_until='networkidle', timeout=30000)
            pg.wait_for_timeout(300)
            r = pg.evaluate(JS)
            root = pg.query_selector('x-dc > div')
            if root:
                root.screenshot(path=os.path.join(OUT_PNG, name + '.png'))
            flag = []
            if r['sh'] > r['h'] + 1:
                flag.append('root 内容高 %d > 画板 %d' % (r['sh'], r['h']))
            if r['sw'] > r['w'] + 1 or r['maxRight'] > r['w'] + 1:
                flag.append('横向溢出 %d > %d' % (max(r['sw'], r['maxRight']), r['w']))
            for c in r['clip']:
                flag.append('裁切 %dpx「%s」' % (c['px'], c['text']))
            print('%-26s %dx%d %s' % (name, r['w'], r['h'], 'OK' if not flag else ' | '.join(flag)))
        b.close()


if __name__ == '__main__':
    main()
