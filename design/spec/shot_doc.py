# -*- coding: utf-8 -*-
"""截取 HTML 文档的若干区域：python shot_doc.py 文件名 [选择器 ...]"""
import sys, os
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
DESIGN = os.path.dirname(HERE)
f = sys.argv[1]
sels = sys.argv[2:] or ['main']
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    pg = b.new_page(viewport={'width': 1440, 'height': 1000})
    pg.goto('file:///' + os.path.join(DESIGN, f).replace('\\', '/'), wait_until='networkidle')
    for i, s in enumerate(sels):
        el = pg.query_selector(s)
        if el:
            el.screenshot(path=os.path.join(HERE, 'shots', 'doc_%d.png' % i))
            print('shot', s)
        else:
            print('missing', s)
    over = pg.evaluate("() => document.documentElement.scrollWidth > window.innerWidth")
    print('horizontal overflow:', over)
    b.close()
