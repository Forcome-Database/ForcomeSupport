# -*- coding: utf-8 -*-
"""
渲染检查：用无头 Chromium 打开画板，报告溢出并截图。

用法：
    python check.py Main.dc.html TicketEmail.dc.html          # 检查指定画板
    python check.py --shots Main.dc.html                      # 同时保存截图到 spec/shots/
报告项：
    root   根节点实际高度 / 宽度是否超过设计尺寸（固定页面 1440×900）
    clip   overflow:hidden 的容器里内容被裁掉的高度（>2px 列出）
    wide   是否出现横向溢出
"""
import sys, os, io, re, json
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
DESIGN = os.path.dirname(HERE)
SHOTS = os.path.join(HERE, 'shots')

JS = r"""
() => {
  const root = document.querySelector('x-dc > div') || document.body.firstElementChild;
  const r = root.getBoundingClientRect();
  const clip = [];
  root.querySelectorAll('*').forEach(e => {
    const cs = getComputedStyle(e);
    if ((cs.overflow === 'hidden' || cs.overflowY === 'hidden') && e.scrollHeight > e.clientHeight + 2) {
      // 单行省略号文本不算
      if (cs.whiteSpace === 'nowrap') return;
      clip.push({px: e.scrollHeight - e.clientHeight, text: (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)});
    }
  });
  let maxRight = 0;
  root.querySelectorAll('*').forEach(e => { const b = e.getBoundingClientRect(); if (b.width > 0 && b.right > maxRight) maxRight = b.right; });
  return {w: Math.round(r.width), h: Math.round(r.height), sh: root.scrollHeight, sw: root.scrollWidth, maxRight: Math.round(maxRight), clip: clip.slice(0, 8)};
}
"""


def main(files, shots=False):
    os.makedirs(SHOTS, exist_ok=True)
    out = {}
    with sync_playwright() as p:
        b = p.chromium.launch(channel='chrome')
        pg = b.new_page(viewport={'width': 1960, 'height': 1200})
        for f in files:
            path = os.path.join(DESIGN, f)
            html = io.open(path, encoding='utf-8').read()
            html = html.replace('<script src="./support.js"></script>', '')
            html = html.replace('<x-dc>', '<x-dc style="display:block">').replace('<helmet>', '<helmet style="display:none">', 1)
            pg.set_content(html, wait_until='networkidle', timeout=30000)
            pg.wait_for_timeout(300)
            res = pg.evaluate(JS)
            out[f] = res
            if shots:
                root = pg.query_selector('x-dc > div')
                if root:
                    root.screenshot(path=os.path.join(SHOTS, f.replace('.dc.html', '.png')))
        b.close()
    for f, r in out.items():
        flag = []
        if r['sh'] > r['h'] + 1:
            flag.append('root 内容高 %d > 画板 %d' % (r['sh'], r['h']))
        if r['sw'] > r['w'] + 1 or r['maxRight'] > r['w'] + 1:
            flag.append('横向溢出 %d > %d' % (max(r['sw'], r['maxRight']), r['w']))
        for c in r['clip']:
            flag.append('裁切 %dpx「%s」' % (c['px'], c['text']))
        print('%-30s %dx%d %s' % (f, r['w'], r['h'], 'OK' if not flag else ' | '.join(flag)))


if __name__ == '__main__':
    args = sys.argv[1:]
    shots = '--shots' in args
    args = [a for a in args if a != '--shots']
    main(args, shots)
