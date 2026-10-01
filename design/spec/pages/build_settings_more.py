# -*- coding: utf-8 -*-
"""设置补充页：P25 模型（SettingsModels）、P26 系统状态（SettingsHealth），刘洋 · 管理员，第二阶段起（D-21）。
沿用 build_settings.spage 外壳与左侧设置菜单（当前项高亮）；数据取 data.MODEL_USES、MODEL_BREAKER_DEMO、HEALTH。
只用 ui.py 组件与 T 色板组合。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
from data import *
import build_settings as BS

STAGE = {'二': '第二阶段', '三': '第三阶段'}
USES = {u[0]: u for u in MODEL_USES}


# ================================================================ P25 模型
def table_bg(cols, rows, template, row_bg=None, row_tones=None, py=8):
    """样式同 ui.table，另支持整行底色（row_bg: {下标: 颜色}），用于熔断行黄底。"""
    head = ''.join('<div style="text-align: %s; min-width: 0px;">%s</div>' % (a, c) for c, a in cols)
    out = '<div style="display: grid; grid-template-columns: %s; gap: 12px; padding: 9px 16px; background: %s; border-bottom: 1px solid %s; font-size: 11px; font-weight: 600; color: %s; letter-spacing: 0.02em; white-space: nowrap;">%s</div>' % (
        template, T['subtle'], T['line'], T['ink4'], head)
    for i, r in enumerate(rows):
        tone = (row_tones or {}).get(i)
        bar = 'box-shadow: inset 3px 0 0 %s;' % {'warning': T['warn_solid'], 'danger': T['bad_solid'], 'accent': T['accent']}[tone] if tone else ''
        cells = ''.join('<div style="text-align: %s; min-width: 0px;">%s</div>' % (cols[j][1], c) for j, c in enumerate(r))
        out += '<div style="display: grid; grid-template-columns: %s; gap: 12px; padding: %dpx 16px; background: %s; border-bottom: 1px solid %s; font-size: 13px; color: %s; align-items: center; font-variant-numeric: tabular-nums; %s">%s</div>' % (
            template, py, (row_bg or {}).get(i, '#ffffff'), T['line2'], T['ink'], bar, cells)
    return '<div style="background: #ffffff; border: 1px solid %s; border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; box-shadow: %s;">%s</div>' % (T['line'], SHADOW_XS, out)


def model_state(st):
    """用途状态：正常 / 已切到备用（熔断）/ 第三阶段启用。"""
    if st == '正常':
        return chip('正常', 'success', 11, dot=True)
    if st.startswith('已切到备用'):
        return chip(st, 'warning', 11, dot=True)
    return chip(st, 'muted', 11)


def p25_table():
    cols = [('用途', 'left'), ('阶段', 'left'), ('主模型', 'left'), ('备用模型', 'left'), ('推理强度', 'left'), ('时限', 'right'), ('提示词', 'left'),
            ('状态', 'left'), ('近 24h 调用', 'right'), ('失败率', 'right'), ('成本', 'right'), ('', 'right')]
    rows, bg, tones = [], {}, {}
    brk = MODEL_BREAKER_DEMO['use']
    for i, (code, name, stage, main, backup, effort, tmo, pv, st, calls, fail, cost) in enumerate(MODEL_USES):
        later = stage == '三'
        c = T['ink4'] if later else T['ink']
        c2 = T['ink4'] if later else T['ink2']
        use = row(nowrap(name, 13, c, 600) + nowrap(code, 12, T['ink4']), 6)
        main_html = nowrap(main, 13, c)
        back_html = nowrap(backup, 13, c2)
        if code == brk:
            main_html = row(nowrap(main, 13, T['ink3']) + chip('熔断', 'danger', 11), 6)
            back_html = row(nowrap(backup, 13, T['ink']) + chip('使用中', 'accent', 11), 6)
            bg[i], tones[i] = T['warn_bg'], 'warning'
        fail_c = T['warn'] if code == brk else c2
        rows.append([use, chip(STAGE[stage], 'muted' if later else 'neutral', 11), main_html, back_html, nowrap(effort, 13, c2), nowrap(tmo, 13, c2), nowrap(pv, 13, c2),
                     model_state(st), nowrap(calls, 13, c2), nowrap(fail, 13, fail_c, 600 if code == brk else 400), nowrap(cost, 13, c2), link('编辑', 12)])
    return table_bg(cols, rows, '140px 68px 160px minmax(0, 1fr) 56px 44px 44px 128px 64px 52px 52px 28px', bg, tones, py=8)


def p25():
    b = MODEL_BREAKER_DEMO
    u = USES[b['use']]
    brk = banner('warning', '%s %s 主模型 %s 已熔断，%s 起切到备用 %s' % (u[1], u[0], u[3], b['at'], u[4]),
                 '%s；%s 自动试探恢复，成功后切回主模型。熔断按「用途 × 模型」统计；渠道切换由 NewAPI 网关负责，模型切换在这里。' % (b['why'], b['probe']),
                 link('查看失败记录', 12, 'chev_r'))
    n2 = sum(1 for x in MODEL_USES if x[2] == '二')
    head = between(row(label('用途') + nowrap('%d 个 · 第二阶段启用 %d 个，第三阶段的用途灰显' % (len(MODEL_USES), n2), 12, T['ink3']), 8),
                   row(icon('edit', 13, T['ink4']) + nowrap('「编辑」打开右侧抽屉：主备模型、推理强度、输出上限、时限、提示词版本、模式版本', 12, T['ink4']), 4))
    notes = col(row(icon('info', 14, T['ink4']) + muted('60 秒总时限只管分诊与草稿（E-03），其他用途各自时限；备用也失败时，同步用途走 E-03 降级。', 12), 6) +
                row(icon('lock', 14, T['ink4']) + muted('triage、draft、check 与意图相关：改动后须重新通过回归样例，才能用于自动发送（R-SD-06），抽屉内写明。', 12), 6), 6)
    inner = brk + col(head + p25_table(), 10) + notes
    return BS.spage('liuyang', '模型', '模型', '按用途配置主备模型，业务代码不写模型名；经 NewAPI 网关调用，渠道切换由网关负责，模型切换在这里。',
                    btn('查看调用记录', 'secondary', 'md', 'history'), inner, save_bar(0, '修改模型配置后在这里统一保存，并记入审计日志'))


# ================================================================ P26 系统状态
def minutes(t):
    """「6m」「40s」→ 分钟；「—」为 0。"""
    if t.endswith('m'):
        return float(t[:-1])
    if t.endswith('s'):
        return float(t[:-1]) / 60.0
    return 0.0


def block(title, sub, body, extra=''):
    return col(between(row(label(title) + nowrap(sub, 12, T['ink3']), 8), extra) + body, 8, 'min-width: 0px;')


def p26_sources():
    rows = [[nowrap(n, 13, T['ink'], 600), nowrap(t, 13, T['ink2']), nowrap(th, 13, T['ink3']), '<div style="display: flex;">%s</div>' % state(st),
             icon('chev_r', 14, T['ink4'], 2) if st != '已连接' else ''] for n, t, th, st in HEALTH['sources']]
    t = table([('数据源', 'left'), ('最近同步', 'left'), ('阈值', 'left'), ('状态', 'left'), ('', 'right')], rows, 'minmax(0, 1fr) 96px 72px 84px 14px', dense=True)
    return block('数据源同步', '%d 个 · 超过阈值为同步延迟（6.9）' % len(HEALTH['sources']), t, nowrap('异常行点开到渠道与店铺对应卡', 12, T['ink4']))


def p26_queues():
    rows, tones = [], {}
    for i, (n, wait, run, fail, oldest) in enumerate(HEALTH['queues']):
        late = minutes(oldest) > 5
        if late:
            tones[i] = 'warning'
        rows.append([nowrap(n, 13, T['ink'], 600), nowrap(str(wait), 13, T['ink2']), nowrap(str(run), 13, T['ink2']),
                     nowrap(str(fail), 13, T['ink'] if fail else T['ink4'], 600 if fail else 400),
                     chip(oldest, 'warning', 11, 'clock') if late else nowrap(oldest, 13, T['ink3'] if oldest != '—' else T['ink4'])])
    t = table([('任务', 'left'), ('等待', 'right'), ('进行中', 'right'), ('近 24h 失败', 'right'), ('最久等待', 'right')], rows,
              'minmax(0, 1fr) 56px 56px 84px 96px', dense=True, row_tones=tones)
    return block('后台任务队列', '%d 类任务 · 最久等待超过 5 分钟标黄' % len(HEALTH['queues']), t)


def p26_calls():
    rows = []
    for name, n, err, p95, quota in HEALTH['calls']:
        sys_, api = name.split(' · ', 1)
        bad = float(err.rstrip('%')) > 0
        rows.append([nowrap(sys_, 13, T['ink'], 600), nowrap(api, 13, T['ink2']), nowrap(n, 13, T['ink2']), nowrap(err, 13, T['warn'] if bad else T['ink2'], 600 if bad else 400),
                     nowrap(p95, 13, T['ink2']), nowrap(quota, 12, T['ink3'] if quota != '—' else T['ink4'])])
    t = table([('系统', 'left'), ('接口', 'left'), ('调用', 'right'), ('错误率', 'right'), ('P95', 'right'), ('配额', 'left')], rows,
              '72px minmax(0, 1fr) 44px 56px 56px 140px', dense=True)
    return block('外部调用', '近 1 小时 · 按系统 × 接口', t)


def p26_models():
    """模型熔断：第二阶段启用的用途 × 主模型，当前熔断与近 24 小时切换次数（MODEL_BREAKER_DEMO 为当天唯一一次熔断）。"""
    b = MODEL_BREAKER_DEMO
    rows, tones = [], {}
    live = [u for u in MODEL_USES if u[2] == '二']
    for i, (code, name, _, main, backup, *_rest) in enumerate(live):
        hit = code == b['use']
        if hit:
            tones[i] = 'warning'
        st = col('<div style="display: flex;">%s</div>' % chip('熔断 · %s 起' % b['at'], 'danger', 11, dot=True) +
                 nowrap('已切到 %s · %s 试探恢复' % (backup, b['probe']), 11, T['ink3']), 2) if hit else '<div style="display: flex;">%s</div>' % chip('正常', 'success', 11, dot=True)
        rows.append([row(nowrap(name, 13, T['ink'], 600) + nowrap(code, 12, T['ink4']), 6), nowrap(main, 13, T['ink2']), st,
                     nowrap('1' if hit else '0', 13, T['ink'] if hit else T['ink4'], 600 if hit else 400)])
    t = table([('用途', 'left'), ('主模型', 'left'), ('当前', 'left'), ('近 24h 切换', 'right')], rows, '150px 140px minmax(0, 1fr) 80px', dense=True, row_tones=tones)
    later = len(MODEL_USES) - len(live)
    return block('模型熔断', '按用途 × 模型 · 第三阶段的 %d 个用途未启用' % later, t, link('去模型设置', 12, 'chev_r'))


def p26():
    H = HEALTH
    actions = row(row(icon('check_c', 14, T['ok'], 2) + nowrap('最近自检 %s' % H['checked'], 12, T['ink3']), 5) + btn('刷新', 'secondary', 'md', 'refresh'), 10)
    grid_ = '<div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px 16px; align-items: start;">%s%s%s%s</div>' % (
        p26_sources(), p26_queues(), p26_calls(), p26_models())
    item = lambda k, v: row(nowrap(k, 12, T['ink3']) + nowrap(v, 12, T['ink'], 600), 6)
    foot = '<div style="display: flex; align-items: center; gap: 16px; background: #ffffff; border: 1px solid %s; border-radius: 8px; padding: 9px 14px; margin-top: auto;">%s</div>' % (T['line'], ''.join([
        row(icon('check_c', 14, T['ok'], 2) + item('worker 心跳', H['heartbeat']), 6), divider(True, 14), nowrap('宿主机存活检查通过', 12, T['ink3']), divider(True, 14),
        item('每日备份', H['backup']), divider(True, 14), item('WAL 归档', H['wal']), divider(True, 14), item('最近恢复演练', H['drill'])]))
    return BS.spage('liuyang', '系统状态', '系统状态', '后台每分钟自检，异常同时发钉钉群机器人。', actions, grid_ + foot)


if __name__ == '__main__':
    save('SettingsModels.dc.html', p25())
    save('SettingsHealth.dc.html', p26())
    print('ok')
