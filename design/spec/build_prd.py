# -*- coding: utf-8 -*-
"""把 spec/prd_a..d.md 合成为 design/forcome-blueprint-guide.html（PRD v2.12）。"""
import io, os, re, hashlib
import markdown

HERE = os.path.dirname(os.path.abspath(__file__))
DESIGN = os.path.dirname(HERE)
CANVAS_URL = 'https://claude.ai/code/artifact/dda6d1a2-41b4-4c97-8ac6-491808a914b5'
DECISION_URL = 'https://claude.ai/code/artifact/0a2277b6-0eb9-424a-8dca-011885168406'

src = ''.join(io.open(os.path.join(HERE, f), encoding='utf-8').read() + '\n\n' for f in ('prd_a.md', 'prd_b.md', 'prd_c.md', 'prd_d.md'))


# ---------------------------------------------------------------- 流程图（替换 ``` 代码块）
def n(t, tone='', sub=''):
    s = '<span class="sub">%s</span>' % sub if sub else ''
    return '<div class="fn %s"><b>%s</b>%s</div>' % (tone, t, s)


def a(label=''):
    return '<div class="fa">%s<span class="ar">→</span></div>' % ('<span class="al">%s</span>' % label if label else '')


def frow(*items):
    return '<div class="fr">%s</div>' % ''.join(items)


def fbox(title, body):
    return '<figure class="flow"><figcaption>%s</figcaption>%s</figure>' % (title, body)


D_BOUNDARY = fbox('系统边界', frow(
    '<div class="fcol">%s%s%s</div>' % (frow(n('客户', 'src', '亚马逊买家消息'), a(), n('亚马逊邮件中转', 'sys', '店铺绑定邮箱')), frow(n('客户', 'src', 'Shopify 邮件'), a(), n('Gmail', 'sys', 'Gmail API 收发')), frow(n('生产厂', 'src', 'FQD、FZJ'), a(), n('工厂工作台', 'sys', '同一系统内'))),
    a(), n('Forcome Support', 'hub', '工单 · 售后单 · 审批单 · 台账'), a(),
    '<div class="fcol">%s%s%s%s</div>' % (frow(n('统一动作接口', 'sys', '订单 · 退款 · 改地址 · 取消'), a(), n('SP-API · Shopify Admin API', 'out', '订单平台直读；写动作审批后执行，人工操作清单兜底')), frow(n('统一动作接口', 'sys', '库存 · 出库单'), a(), n('积加', 'out', '易仓库存 · 售后出库单 · 单号与运费 · 亚马逊收件人')), frow(n('轨迹服务', 'sys', '第二阶段'), a(), n('17TRACK', 'out', '物流轨迹')), frow(n('钉钉', 'sys', '通讯录 · 工作通知 · 登录'), a(), n('审批人 · 生产厂对接人', 'out')))))

D_FIVE = fbox('每封来信的五步处理', frow(n('来信', 'src'), a(), n('① 接收与关联', '', '去重 · 店铺 · 订单 · 归并'), a(), n('② 风险拦截', 'risk', '命中即转人工'), a('未命中'), n('③ 理解与处理', 'hub', '意图 · 规则 · 3 版草稿'), a(), n('④ 回复检查', '', '5 项检查'), a(), n('⑤ 发送方式', '', 'R-SD')) +
                '<div class="fsplit"><div class="fbr">%s</div><div class="fbr"><span class="flab">⑤ 的三种结果</span>%s%s%s</div><div class="fbr"><span class="flab">草稿含审批项时</span>%s</div></div>' % (
                    frow(n('② 命中', 'risk'), a(), n('转人工', 'bad')),
                    n('自动发送', 'ok', '白名单 + 阈值'), n('待审草稿', 'acc', '默认；含审批项时标出'), n('转人工', 'bad', '检查不过且置信度低'),
                    frow(n('待审草稿', 'acc', '标出审批项'), a('坐席审阅'), n('提交审批', 'src'), a(), n('待审批', 'warn', '转人工工单保持转人工'))))

D_APPROVAL = fbox('审批单流程（动作与报备合一）', frow(n('坐席提交或系统发起', 'src'), a(), n('待审批', 'warn', '4 小时时限'), a('批准'), n('执行中', 'acc', 'SP-API · Shopify Admin API · 积加（易仓出库单）/ 工厂工作台（人工操作清单仅兜底）'), a('全部成功'), n('已执行', 'ok'), a(), n('发出绑定回复', 'ok')) +
                    '<div class="fsplit"><div class="fbr">%s</div><div class="fbr">%s</div><div class="fbr">%s</div></div>' % (
                        frow(n('待审批', 'warn'), a('驳回 · 原因必填'), n('已驳回', 'bad', '回复不发出；工单回到提交前状态')),
                        frow(n('待审批', 'warn'), a('发起人撤回'), n('已撤回', 'mut', '与驳回同样处理（R-AP-07）')),
                        frow(n('执行中', 'acc'), a('重试 3 次仍失败'), n('执行失败', 'bad', '重试或转人工操作清单'))))

D_NEGO = fbox('比例协商与内部结算', frow(n('报备通过', 'src'), a(), n('需要协商？', 'q', '质量或其他'), a('是'), n('待工厂答复', 'acc', '3 个工作日'), a('接受'), n('已确认', 'ok'), a(), n('结算批次', 'acc', '每厂每月月末，可提前'), a('双方确认'), n('已结算', 'ok')) +
                '<div class="fsplit"><div class="fbr">%s</div><div class="fbr">%s</div><div class="fbr">%s</div></div>' % (
                    frow(n('需要协商？', 'q'), a('否'), n('不适用', 'mut', '物流、客户使用')),
                    frow(n('待工厂答复', 'acc'), a('还价'), n('工厂还价', 'warn', '接受 / 再次提案 / 升级')),
                    frow(n('拒绝 · 超时 · 满 3 轮 · 主动升级', 'bad'), a(), n('待升级', 'bad'), a('双方负责人商定'), n('录入最终比例', 'ok'))))

DIAGRAMS = [D_BOUNDARY, D_FIVE, D_APPROVAL, D_NEGO]
blocks = re.findall(r'```.*?```', src, flags=re.S)
assert len(blocks) == len(DIAGRAMS), len(blocks)
for i, b in enumerate(blocks):
    src = src.replace(b, '@@DIAGRAM%d@@' % i, 1)

html = markdown.markdown(src, extensions=['tables', 'sane_lists'])
for i, d in enumerate(DIAGRAMS):
    html = html.replace('<p>@@DIAGRAM%d@@</p>' % i, d).replace('@@DIAGRAM%d@@' % i, d)

# 标题加 id，生成目录
toc = []


def hid(m):
    level, inner = m.group(1), m.group(2)
    text = re.sub('<[^>]+>', '', inner)
    num = re.match(r'([0-9]+(?:\.[0-9]+)?|P[0-9]+|[A-Z][0-9]*A?)\s', text)
    if num:
        ident = 's-' + num.group(1).replace('.', '-')
    else:
        ident = 'h-' + hashlib.md5(text.encode('utf-8')).hexdigest()[:6]
    if level == '2':
        toc.append((ident, text))
    return '<h%s id="%s">%s</h%s>' % (level, ident, inner, level)


html = re.sub(r'<h([23])>(.*?)</h\1>', hid, html)
html = re.sub(r'<table>', '<div class="tw"><table>', html)
html = html.replace('</table>', '</table></div>')

# 状态词着色（只在表格单元里、完整匹配时）
TONE = {
    'P0': 'bad', 'P1': 'warn', 'P2': 'mut', '阻塞': 'bad', '待确认': 'warn', '待提供': 'warn', '默认值已设': 'mut',
    '可用': 'ok', '设计已定': 'ok', '第三阶段': 'mut',
}
for w, t in TONE.items():
    html = html.replace('<td>%s</td>' % w, '<td><span class="tag %s">%s</span></td>' % (t, w))

# 标题块单独处理：第一个 h1 与其后的信息表
h1 = re.search(r'<h1>(.*?)</h1>', html)
title = h1.group(1)
html = html.replace(h1.group(0), '', 1)

nav = ''.join('<a href="#%s">%s</a>' % (i, t) for i, t in toc)

CSS = r'''
:root {
  --bg: #f4f6f9; --surface: #ffffff; --subtle: #f8f9fb; --line: #e4e8ef; --line2: #f1f3f7; --strong: #d0d5dd;
  --ink: #101828; --ink2: #344054; --ink3: #667085; --ink4: #98a2b3;
  --acc: #4f46e5; --acc-ink: #4338ca; --acc-bg: #f0effd; --acc-line: #d3d1f9;
  --ok: #047857; --ok-bg: #ecfdf5; --ok-line: #a7f3d0; --warn: #b45309; --warn-bg: #fffbeb; --warn-line: #fde68a;
  --bad: #b91c1c; --bad-bg: #fef2f2; --bad-line: #fecaca; --flow: #6d28d9; --flow-bg: #f5f3ff;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0f131a; --surface: #161b24; --subtle: #1b212c; --line: #283041; --line2: #212836; --strong: #36405a;
    --ink: #e8ecf3; --ink2: #c3cad8; --ink3: #93a0b5; --ink4: #6b7890;
    --acc: #8b8cf8; --acc-ink: #c7c8ff; --acc-bg: #23244a; --acc-line: #3b3d7a;
    --ok: #6ee7b7; --ok-bg: #0f2a22; --ok-line: #1f5b48; --warn: #fbbf24; --warn-bg: #2d2410; --warn-line: #5c4715;
    --bad: #fca5a5; --bad-bg: #2e1616; --bad-line: #6b2a2a; --flow: #c4b5fd; --flow-bg: #221a3d;
  }
}
:root[data-theme="dark"] {
  --bg: #0f131a; --surface: #161b24; --subtle: #1b212c; --line: #283041; --line2: #212836; --strong: #36405a;
  --ink: #e8ecf3; --ink2: #c3cad8; --ink3: #93a0b5; --ink4: #6b7890;
  --acc: #8b8cf8; --acc-ink: #c7c8ff; --acc-bg: #23244a; --acc-line: #3b3d7a;
  --ok: #6ee7b7; --ok-bg: #0f2a22; --ok-line: #1f5b48; --warn: #fbbf24; --warn-bg: #2d2410; --warn-line: #5c4715;
  --bad: #fca5a5; --bad-bg: #2e1616; --bad-line: #6b2a2a; --flow: #c4b5fd; --flow-bg: #221a3d;
}
* { box-sizing: border-box; }
html { scroll-padding-top: 20px; }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: "Inter", "PingFang SC", "HarmonyOS Sans SC", "Noto Sans SC", "Microsoft YaHei", sans-serif; font-size: 14.5px; line-height: 1.65; -webkit-font-smoothing: antialiased; padding-inline: 20px; padding-block: 0 80px; }
a { color: var(--acc); text-decoration: none; } a:hover { text-decoration: underline; }
a:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; border-radius: 3px; }
.layout { max-width: 1320px; margin: 0 auto; display: grid; grid-template-columns: 232px minmax(0, 1fr); gap: 40px; }
aside { position: sticky; top: 0; align-self: start; max-height: 100vh; overflow-y: auto; padding-block: 32px 24px; }
aside .brand { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; color: var(--ink3); margin-bottom: 10px; }
aside nav { display: flex; flex-direction: column; gap: 1px; }
aside nav a { color: var(--ink2); font-size: 13px; padding: 5px 10px; border-radius: 6px; line-height: 1.4; }
aside nav a:hover { background: var(--surface); text-decoration: none; color: var(--acc-ink); }
aside .links { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
main { min-width: 0; padding-block: 32px 0; }
header.doc { display: flex; flex-direction: column; gap: 10px; padding-bottom: 8px; }
.eyebrow { font-size: 12px; font-weight: 700; letter-spacing: 0.08em; color: var(--acc-ink); }
h1 { margin: 0; font-size: 30px; line-height: 1.2; letter-spacing: -0.015em; text-wrap: balance; }
h2 { font-size: 21px; letter-spacing: -0.01em; margin: 44px 0 12px 0; padding-top: 16px; border-top: 1px solid var(--line); text-wrap: balance; }
h3 { font-size: 15.5px; margin: 26px 0 8px 0; }
p { margin: 8px 0; max-width: 78ch; color: var(--ink2); }
strong { color: var(--ink); }
ul, ol { margin: 6px 0 10px 0; padding-left: 22px; color: var(--ink2); max-width: 86ch; }
li { margin: 3px 0; }
li > ul { margin: 2px 0; }
code { font-family: "JetBrains Mono", Consolas, monospace; font-size: 12.5px; background: var(--subtle); border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; }
.tw { overflow-x: auto; margin: 10px 0 14px 0; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; vertical-align: top; padding: 8px 12px; border-bottom: 1px solid var(--line2); line-height: 1.55; }
th { background: var(--subtle); color: var(--ink3); font-size: 12px; font-weight: 700; white-space: nowrap; border-bottom: 1px solid var(--line); }
tr:last-child td { border-bottom: none; }
td:first-child { font-weight: 600; color: var(--ink); white-space: nowrap; }
.tag { display: inline-block; font-size: 11.5px; font-weight: 700; border-radius: 4px; padding: 1px 7px; white-space: nowrap; border: 1px solid transparent; }
.tag.ok { color: var(--ok); background: var(--ok-bg); border-color: var(--ok-line); }
.tag.warn { color: var(--warn); background: var(--warn-bg); border-color: var(--warn-line); }
.tag.bad { color: var(--bad); background: var(--bad-bg); border-color: var(--bad-line); }
.tag.mut { color: var(--ink3); background: var(--subtle); border-color: var(--line); }
figure.flow { margin: 12px 0 16px 0; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px 16px 16px; overflow-x: auto; }
figure.flow figcaption { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; color: var(--ink3); margin-bottom: 10px; }
.fr { display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; }
.fcol { display: flex; flex-direction: column; gap: 8px; }
.fn { display: flex; flex-direction: column; gap: 1px; border: 1px solid var(--line); background: var(--subtle); border-radius: 8px; padding: 7px 10px; min-width: 88px; flex-shrink: 0; }
.fn b { font-size: 12.5px; font-weight: 700; white-space: nowrap; color: var(--ink); }
.fn .sub { font-size: 11px; color: var(--ink3); white-space: nowrap; }
.fn.src { background: var(--ink); border-color: var(--ink); } .fn.src b { color: var(--surface); } .fn.src .sub { color: var(--ink4); }
.fn.hub { background: var(--acc-bg); border-color: var(--acc-line); } .fn.hub b { color: var(--acc-ink); }
.fn.acc { background: var(--acc-bg); border-color: var(--acc-line); } .fn.acc b { color: var(--acc-ink); }
.fn.ok { background: var(--ok-bg); border-color: var(--ok-line); } .fn.ok b { color: var(--ok); }
.fn.warn { background: var(--warn-bg); border-color: var(--warn-line); } .fn.warn b { color: var(--warn); }
.fn.bad, .fn.risk { background: var(--bad-bg); border-color: var(--bad-line); } .fn.bad b, .fn.risk b { color: var(--bad); }
.fn.mut { background: var(--surface); border-style: dashed; }
.fn.q { background: var(--surface); border: 1.5px solid var(--acc); } .fn.q b { color: var(--acc-ink); }
.fn.sys { background: var(--surface); }
.fn.out { background: var(--surface); border-style: dashed; }
.fa { display: flex; flex-direction: column; align-items: center; color: var(--ink4); flex-shrink: 0; }
.fa .al { font-size: 10.5px; color: var(--ink3); white-space: nowrap; }
.fa .ar { font-size: 16px; line-height: 1; }
.fsplit { display: flex; flex-wrap: wrap; gap: 10px 24px; margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--line); }
.fbr { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.flab { font-size: 11.5px; font-weight: 700; color: var(--ink3); margin-right: 4px; }
.meta-note { font-size: 13px; color: var(--ink3); }
@media (max-width: 960px) {
  .layout { grid-template-columns: 1fr; gap: 0; }
  aside { position: static; max-height: none; padding-block: 20px 0; }
  aside nav { flex-direction: row; flex-wrap: wrap; gap: 4px; }
  h1 { font-size: 25px; }
}
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
'''

page = '''<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Forcome Support 产品蓝图</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400..700&amp;family=Noto+Sans+SC:wght@400;500;700&amp;display=swap">
<style>%s</style>
</head>
<body>
<div class="layout">
  <aside>
    <div class="brand">PRD v2.12 · 目录</div>
    <nav>%s</nav>
    <div class="links">
      <a href="%s">设计画布（规范、页面、状态板、流程图）</a>
      <a href="%s">决策记录</a>
    </div>
  </aside>
  <main>
    <header class="doc">
      <div class="eyebrow">产品需求文档 · 定稿评审稿</div>
      <h1>%s</h1>
    </header>
    %s
  </main>
</div>
</body>
</html>
''' % (CSS, nav, CANVAS_URL, DECISION_URL, title, html)

out = os.path.join(DESIGN, 'forcome-blueprint-guide.html')
io.open(out, 'w', encoding='utf-8').write(page)
print('PRD written', len(page), 'toc', len(toc))
