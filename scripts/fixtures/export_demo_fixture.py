# -*- coding: utf-8 -*-
"""
把原型示例数据 design/spec/data.py 转成 JSON 夹具 packages/fixtures/data/demo.json（待办 02）。

夹具供种子数据、Fake 回放与 Playwright 共用（技术方案 6.4、ADR 0009 修订）。转换规则（第一期）：
- 工单取 p1_tickets()：第一期状态（待回复 / 等客户 / 已解决 / 已关闭）与补充工单，共 16 张；
- 台账取 p1_ledger_rows()：丢弃待确认的单，带 LEDGER_EXTRA 的登记字段；创建路径一律记「手工登记」，
  登记人取负责人（原型的 reg 字段不转换）；
- P05 时间线取 P1_OLIVER；
- Fake 汇率固定为演示汇率 1 USD = 18.00 MXN、1.36 CAD，保证 $188.79 等按原型数据验收的数字可复现；
- 另带被引用的参照数据：成员（钉钉通讯录里的人）、店铺、生产厂、配件与生产厂对应、责任类型默认比例。
时间一律写成带 +08:00 的 ISO 8601（原型的时间都是北京时间）；金额写成两位小数的字符串，未填为 null。
成员与店铺的 id 用 UUIDv5 从 key 派生，重复运行结果不变，各模块的加载步骤与测试可以直接引用。
订单、未归属店铺来信、站内通知等其余数据，由需要它们的待办在这里补充转换规则。

用法（仓库根目录）：pnpm fixtures:generate；pnpm fixtures:verify 检查产物与 data.py 一致。
可直接运行：python scripts/fixtures/export_demo_fixture.py [输出路径]
"""
import json
import os
import re
import sys
import uuid

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO, 'design', 'spec'))

import data as d  # noqa: E402  示例数据唯一来源

DEFAULT_OUT = os.path.join(REPO, 'packages', 'fixtures', 'data', 'demo.json')
YEAR = d.NOW[:4]
# 夹具里实体 id 的命名空间（固定值，改了会让已引用的 id 全部变化）
NAMESPACE = uuid.UUID('7a1c3e52-5b0f-4d8e-9c6a-2f4b8d1e0a93')


def entity_id(kind, key):
    return str(uuid.uuid5(NAMESPACE, '%s:%s' % (kind, key)))


def at(mmdd_hhmm):
    """'09-10 16:00' → '2026-09-10T16:00:00+08:00'；None 原样返回。"""
    if mmdd_hhmm is None:
        return None
    m = re.fullmatch(r'(\d{2})-(\d{2}) (\d{2}):(\d{2})', mmdd_hhmm)
    if not m:
        raise ValueError('无法识别的时间：%r' % mmdd_hhmm)
    return '%s-%s-%sT%s:%s:00+08:00' % ((YEAR,) + m.groups())


def date(mmdd):
    """'09-10' → '2026-09-10'；None 原样返回。"""
    if mmdd is None:
        return None
    if not re.fullmatch(r'\d{2}-\d{2}', mmdd):
        raise ValueError('无法识别的日期：%r' % mmdd)
    return '%s-%s' % (YEAR, mmdd)


def money(x):
    """金额（美元或原币）→ 两位小数字符串；None（未填）原样返回。"""
    if x is None:
        return None
    return '%.2f' % round(x + 0.0, 2)


ROLE_KEYS = {s['name']: k for k, s in d.STAFF.items()}
STORE_KEYS = {s['name']: s['id'] for s in d.STORES}


def member_key(name):
    return ROLE_KEYS[name]


def store_key(name):
    return STORE_KEYS[name]


# ---------------------------------------------------------------- 参照数据
def members():
    """钉钉通讯录里的成员（有部门的人）；生产厂负责人只作为生产厂的联系人出现，不是系统成员。"""
    out = []
    for key, s in d.STAFF.items():
        if 'dept' not in s:
            continue
        out.append({
            'id': entity_id('member', key),
            'key': key,
            'name': s['name'],
            'avatar': s['avatar'],
            'role': s['role'],
            'dept': s['dept'],
            'email': s.get('email'),
            'stores': s.get('stores'),
            'factory': s.get('factory'),
        })
    return out


def stores():
    return [{
        'id': entity_id('store', s['id']),
        'key': s['id'],
        'name': s['name'],
        'platform': s['platform'],
        'sites': list(s['sites']),
        'defaultSite': s['default_site'],
        'mailbox': s['mailbox'],
        # 原型的 sid 是显示写法（亚马逊带「卖家 ID 」前缀），夹具只取标识本身；字段名由店铺表按平台另写
        'platformId': s['sid'].rsplit(' ', 1)[-1],
    } for s in d.STORES]


def factories():
    return [{
        'code': f['code'],
        'scope': f['scope'],
        'contact': f['contact'],
        'head': f['head'],
        'mailboxes': list(f['mail']),
    } for f in d.FACTORIES.values()]


def parts():
    return [{
        'sku': sku,
        'name': name,
        'category': d.PART_CATEGORY[sku],
        'factory': d.PART_FACTORY[sku],
    } for sku, name in d.PARTS.items()]


def ratios(r):
    return {k: {'fsh': r[k][0], 'factory': r[k][1]} for _, k in d.RATIO_LABELS}


def responsibility_ratios():
    return [{'responsibility': resp, 'ratios': ratios(r)} for resp, r in d.RATIO_RULE.items()]


# ---------------------------------------------------------------- 工单（P04 第一阶段，I16）
def tickets():
    out = []
    for t in d.p1_tickets():
        out.append({
            'no': t['no'],
            'subject': t['subject'],
            'customer': t['customer'],
            'storeKey': store_key(t['store']),
            'channel': t['channel'],
            'site': t['site'],
            'source': t['source'],
            'status': t['status'],
            'closeReason': t.get('close_reason'),
            'lastInboundAt': at(t['last_in'] if len(t['last_in']) > 5 else d.NOW[5:10] + ' ' + t['last_in']),
            'order': t.get('order'),
            'from': t.get('from'),
            # 原型画面在演示时刻显示的 SLA（剩余或结果）与色调；系统按来信重新计算，这里只作核对用
            'slaDisplay': {'text': t['sla_left'], 'level': t['sla_level'], 'internalTarget': t.get('sla_kind') == '内部目标'},
        })
    return out


# ---------------------------------------------------------------- 台账（P13 第一阶段，S13–S15，R-AS-08）
MONEY_PREFIX = {'MX$': 'MXN', 'CA$': 'CAD', '$': 'USD'}


def parse_original(s):
    """'MX$889.00' → ('MXN', '889.00')。"""
    for prefix, cur in MONEY_PREFIX.items():
        if s.startswith(prefix):
            return cur, '%.2f' % float(s[len(prefix):].replace(',', ''))
    raise ValueError('无法识别的原币金额：%r' % s)


def fee(r, field, orig_field=None):
    """一个费用项：原币金额、币种、冻结的美元金额与汇率日期；未填为 None。"""
    usd = r.get(field)
    if usd is None:
        return None
    orig = r.get(orig_field) if orig_field else None
    if orig:
        cur, amount = parse_original(orig)
        return {'amount': amount, 'currency': cur, 'usd': money(usd), 'rateDate': date(r.get('rate_date') or r['fee_date'])}
    return {'amount': money(usd), 'currency': 'USD', 'usd': money(usd), 'rateDate': None}


def ledger():
    out = []
    for r in d.p1_ledger_rows():
        owner = member_key(r['owner'])
        out.append({
            'no': r['no'],
            'status': r['status'],
            'storeKey': store_key(r['store']),
            'site': r['site'],
            'order': r.get('order'),
            'customer': r['customer'],
            'ticket': r.get('ticket'),
            'method': r['method'],
            'responsibility': r['resp'],
            'responsibilityReason': r.get('reason'),
            'part': {'sku': r['part'], 'qty': r['qty']} if r.get('part') else None,
            'factory': r.get('factory'),
            'shipper': r.get('shipper'),
            'carrier': r.get('carrier'),
            'shipDate': date(r.get('ship_date')),
            'tracking': r.get('tracking'),
            'claim': {'target': r['claim'], 'state': r['claim_state']} if r.get('claim') else None,
            'fees': {
                'product': fee(r, 'product'),
                'freight': fee(r, 'freight'),
                'compensation': fee(r, 'comp', 'comp_orig'),
                'other': fee(r, 'other'),
            },
            'ratios': ratios(r['ratios']),
            'feeDate': date(r['fee_date']),
            'completedAt': at(r.get('done')),
            'ownerKey': owner,
            # 第一期台账一律为手工登记，登记人取负责人（原型的 reg 字段不转换）
            'registeredByKey': owner,
            'createdVia': '手工登记',
        })
    return out


# ---------------------------------------------------------------- P05 时间线（I18）
def ticket_timeline():
    o = d.P1_OLIVER
    entries = []
    for day, hhmm, kind, body in o['timeline']:
        when = at('%s %s' % (day[:5], hhmm))
        # 来信与我方回复都经同一个店铺邮箱（mailbox），P05 写「我方 · 发件邮箱」
        e = {'at': when, 'direction': 'outbound' if kind == 'out' else 'inbound', 'body': body, 'markedNoReply': None}
        if kind == 'marked':
            e['markedNoReply'] = {'byKey': member_key(o['marked_by']), 'at': at(o['marked_at'])}
        entries.append(e)
    flow = []
    for status, when, who_event in o['flow']:
        actor, event = who_event.split(' · ')
        flow.append({'status': status, 'at': at(when), 'actor': actor, 'event': event})
    sla = [{'inboundAt': at(inbound), 'result': result, 'tone': tone, 'note': note} for inbound, result, tone, note in o['sla']]
    return {
        'ticket': o['ticket'],
        'mailbox': o['mailbox'],
        'entries': entries,
        'statusFlow': flow,
        'sla': sla,
        'autoCloseAt': at(o['close_at']),
        'closeReason': o['close_reason'],
        # 画面时刻为 09-10 09:05，订单卡最近同步取其之前
        'orderSyncedAt': at('09-10 ' + o['order_synced']),
    }


def build():
    return {
        'meta': {
            'source': 'design/spec/data.py',
            'generator': 'scripts/fixtures/export_demo_fixture.py',
            'now': at(d.NOW[5:]),
            'timeZone': 'Asia/Shanghai',
        },
        'exchangeRates': {'base': 'USD', 'quotes': {'MXN': money(d.USD_MXN), 'CAD': money(d.USD_CAD)}},
        'members': members(),
        'stores': stores(),
        'factories': factories(),
        'parts': parts(),
        'responsibilityRatios': responsibility_ratios(),
        'tickets': tickets(),
        'ledger': ledger(),
        'ticketTimeline': ticket_timeline(),
    }


def render():
    return json.dumps(build(), ensure_ascii=False, indent=2) + '\n'


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    os.makedirs(os.path.dirname(out), exist_ok=True)
    # 二进制写入：UTF-8 无 BOM、LF 换行，任何平台上产物逐字节相同
    with open(out, 'wb') as f:
        f.write(render().encode('utf-8'))
    print(out)


if __name__ == '__main__':
    main()
