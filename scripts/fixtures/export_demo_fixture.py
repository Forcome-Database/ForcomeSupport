# -*- coding: utf-8 -*-
"""
把原型示例数据 design/spec/data.py 转成 JSON 夹具 packages/fixtures/data/demo.json（待办 02）。

夹具供种子数据、Fake 回放与 Playwright 共用（技术方案 6.4、ADR 0009 修订）。转换规则（第一期）：
- 工单取 p1_tickets()：第一期状态（待回复 / 等客户 / 已解决 / 已关闭）与补充工单，共 16 张；
- 台账取 p1_ledger_rows()：丢弃待确认的单，带 LEDGER_EXTRA 的登记字段；创建路径一律记「手工登记」，
  登记人取负责人（原型的 reg 字段不转换）；
- P05 时间线取 P1_OLIVER；
- 自动回复取 P1_AUTO_REPLY（I18，待办 16）：我方店铺邮箱对生产厂来信（第一期示例里唯一的生产厂工单）发出的自动回复，头字段拆成名与值；
- Fake 汇率固定为演示汇率 1 USD = 18.00 MXN、1.36 CAD，保证 $188.79 等按原型数据验收的数字可复现；
- 另带被引用的参照数据：成员（钉钉通讯录里的人）、店铺、生产厂、配件与生产厂对应、责任类型默认比例。
时间一律写成带 +08:00 的 ISO 8601（原型的时间都是北京时间）；金额写成两位小数的字符串，未填为 null。
成员与店铺的 id 用 UUIDv5 从 key 派生，重复运行结果不变，各模块的加载步骤与测试可以直接引用。
- 站内通知取 NOTIFICATIONS（G10，周敏的面板）：只转第一期的类型（11.4 阶段「一起」，按原型的图标对上通知类型），
  第二期的「新审批单」不转换；只写时:分的落在演示当天。
- Shopify 订单取 SHOPIFY_ORDERS_P1（待办 11，Fake Shopify 回放）：时间按北京时间，金额两位小数的美元，
  状态保留 Admin API 的枚举写法（PAID、FULFILLED 等）；客户邮箱写了 email 的照写，没写的为 null（由回放按客户名推出，同 Fake 来信）。
- 亚马逊订单取 AMAZON_ORDERS_P1（待办 12，Fake SP-API 回放）：时间按北京时间，金额两位小数的原币与币种，状态保留 SP-API 的枚举写法
  （SHIPPED 等），履约方写 MFN / AFN；收件地址只有非受限角色能读到的城市、州、邮编（美国站为 null）、国家；买家姓名不进夹具。
未归属店铺来信等其余数据，由需要它们的待办在这里补充转换规则。

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
            # 最近登录（P20）：只写时:分的落在演示当天
            'lastLogin': at(s['last_login'] if len(s['last_login']) > 5 else '%s %s' % (d.NOW[5:10], s['last_login'])),
        })
    return out


def directory_newcomers():
    """钉钉通讯录里新入职、还没分配角色的人（P20「从钉钉添加」的候选，待办 06）：Fake 钉钉回放时放进通讯录。"""
    return [{
        'key': n['key'],
        'name': n['name'],
        'dept': n['dept'],
        'email': n['email'],
    } for n in d.DINGTALK_NEWCOMERS]


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
            # 来信的正文（直邮的两张，待办 17）；没有的回放时正文即主题
            'body': d.P1_LETTER_BODIES.get(t['no']),
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


def claim_target(text):
    """原型的索赔对象写成一句话（「向 USPS 索赔」「向易仓索赔（错发）」）；R-AS-08 的取值只有承运商与易仓"""
    return '易仓' if '易仓' in text else '承运商'


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
            'claim': {'target': claim_target(r['claim']), 'state': r['claim_state']} if r.get('claim') else None,
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


# ---------------------------------------------------------------- Shopify 订单（待办 11）
def shopify_orders():
    out = []
    for name, o in d.SHOPIFY_ORDERS_P1.items():
        street, unit, city, province, zip_, country = o['ship_to']
        out.append({
            'name': name,
            'storeKey': store_key(o['store']),
            'customer': o['customer'],
            'email': o.get('email'),
            'placedAt': at(o['placed']),
            'updatedAt': at(o['updated']),
            'lineItems': [{'title': t, 'quantity': q} for t, q in o['items']],
            'total': {'amount': money(o['total']), 'currency': 'USD'},
            'financialStatus': o['paid'],
            'fulfillmentStatus': o['fulfilled'],
            'shipTo': {'address1': street, 'address2': unit, 'city': city, 'province': province,
                       'zip': zip_, 'country': country},
            'tracking': {'company': o['tracking'][0], 'number': o['tracking'][1]} if o['tracking'] else None,
        })
    return out


# ---------------------------------------------------------------- 亚马逊订单（待办 12）
def amazon_orders():
    out = []
    for order_id, o in d.AMAZON_ORDERS_P1.items():
        city, state, zip_, country = o['ship_to']
        amount, currency = o['total']
        out.append({
            'orderId': order_id,
            'storeKey': store_key(o['store']),
            'site': o['site'],
            'placedAt': at(o['placed']),
            'updatedAt': at(o['updated']),
            'lineItems': [{'title': t, 'quantity': q} for t, q in o['items']],
            'total': {'amount': money(amount), 'currency': currency},
            'status': o['status'],
            'fulfillmentChannel': o['fulfil'],
            'shipBy': at(o['ship_by']),
            'deliverBy': at(o['deliver_by']),
            'shipTo': {'city': city, 'stateOrRegion': state, 'postalCode': zip_, 'countryCode': country},
            'tracking': {'carrier': o['tracking'][0], 'number': o['tracking'][1]} if o['tracking'] else None,
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


# ---------------------------------------------------------------- 标记无需回复（I18，待办 17）
def no_reply_marks():
    """被「标记无需回复」的示例来信：P05 时间线那张（P1_OLIVER）与已解决的其余示例工单（P1_EXTRA_MARKS）。
    回放后由 ticket 按来信到达时刻找到这封信，以标记人的身份在标记时刻标记（整天平移时跟着平移）。"""
    o = d.P1_OLIVER
    out = [{'ticket': o['ticket'], 'inboundAt': at('%s %s' % (day[:5], hhmm)), 'byKey': member_key(o['marked_by']), 'at': at(o['marked_at'])}
           for day, hhmm, kind, _ in o['timeline'] if kind == 'marked']
    p1 = {t['no']: t for t in d.p1_tickets()}
    for no, (inbound, by, when) in d.P1_EXTRA_MARKS.items():
        # 其余示例工单只回放一封来信（最近来信），标记的就是它
        if p1[no]['last_in'] != inbound or d.P1_STATUS.get(no) != '已解决':
            raise ValueError('P1_EXTRA_MARKS 的 %s 要是已解决工单的最近来信' % no)
        out.append({'ticket': no, 'inboundAt': at(inbound), 'byKey': member_key(by), 'at': at(when)})
    return out


# ---------------------------------------------------------------- 自动回复（I18）
def auto_reply():
    a = d.P1_AUTO_REPLY
    producer = [t for t in d.p1_tickets() if t['source'] == '生产厂']
    if len(producer) != 1:
        raise ValueError('自动回复的示例要对上唯一一张生产厂工单，实际有 %d 张' % len(producer))
    name, value = a['header'].split(': ', 1)
    return {'ticket': producer[0]['no'], 'from': a['from'], 'at': at(a['at']), 'headers': {name: value}, 'body': a['body']}


# ---------------------------------------------------------------- 未归属店铺来信（I17，待办 15）
def unassigned_mail():
    """Fake Gmail 回放的未归属店铺来信：落在哪个同步的店铺邮箱、收件地址与它所在的头字段、发件域、到达时刻（演示当天）。"""
    return [{
        'customer': m['customer'],
        'subject': m['subject'],
        'mailbox': m['mailbox'],
        'to': m['to'],
        'toHeader': m['to_hdr'],
        'fromDomain': m['from_domain'],
        'at': at('%s %s' % (d.NOW[5:10], m['at'])),
    } for m in d.UNASSIGNED_MAIL]


# ---------------------------------------------------------------- 站内通知（G10）
# 原型的图标 → 第一期的通知类型（contracts 的 notificationTypes）；不在表里的不转换：新审批单（approve）是第二期的；
# 未归属店铺来信（store）由回放的未归属来信进队列时真的发出（待办 15），不再预置
NOTIFICATION_TYPES = {'check_c': 'channel_recovered', 'alert': 'channel_disconnected'}
# 原型的对象写法 → 关联对象（类型与 id）
NOTIFICATION_OBJECTS = {'P18 · Gmail': ('channel', 'gmail')}
NOTIFICATION_RECIPIENT = 'zhoumin'  # data.py：周敏 · 客服主管的面板


def notifications():
    out = []
    for hhmm, _tone, icon_name, title, desc, obj, read in d.NOTIFICATIONS:
        kind = NOTIFICATION_TYPES.get(icon_name)
        if kind is None:
            continue
        object_type, object_id = NOTIFICATION_OBJECTS[obj]
        out.append({
            'id': entity_id('notification', '%s %s %s' % (hhmm, title, desc)),
            'recipientKey': NOTIFICATION_RECIPIENT,
            'type': kind,
            'title': title,
            'body': desc,
            'object': {'type': object_type, 'id': object_id, 'label': obj},
            # 当天的只写时:分，之前的写「月-日 时:分」（G10）
            'at': at(hhmm if len(hhmm) > 5 else '%s %s' % (d.NOW[5:10], hhmm)),
            'read': read,
        })
    return out


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
        'directoryNewcomers': directory_newcomers(),
        'stores': stores(),
        'factories': factories(),
        'parts': parts(),
        'responsibilityRatios': responsibility_ratios(),
        'tickets': tickets(),
        'ledger': ledger(),
        # 原型用过的最大售后单序号（含第一期丢弃的待确认单 S-20260911-0022）：加载示例台账后新单号接在它之后，不与原型撞号
        'aftersalesLastSequence': max(int(a['no'][-4:]) for a in d.AFTERSALES),
        'ticketTimeline': ticket_timeline(),
        'autoReply': auto_reply(),
        'noReplyMarks': no_reply_marks(),
        'shopifyOrders': shopify_orders(),
        # 示例 Shopify 应用没开通 read_all_orders 时订单只回补 60 天（K19、K20，待办 13）
        'shopifyReadAllOrders': d.SHOPIFY_BACKFILL_DAYS >= d.AMZ_BACKFILL_DAYS,
        'amazonOrders': amazon_orders(),
        'unassignedMail': unassigned_mail(),
        'notifications': notifications(),
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
