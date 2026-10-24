import { describe, expect, it } from 'vitest';
import { extractOrderNumbers, MAX_ORDER_NUMBER_CANDIDATES } from './order-numbers';

/*
 * 订单号抽取（规格 channel「订单号抽取」，PRD 6.0 ①、规格故事 30，待办 14）：纯函数，输入店铺平台与来信的主题、正文，
 * 输出候选订单号（先主题后正文、按出现先后、去重）。候选只是「像订单号」，归并时逐个交 order 在该店铺内校验。
 */

const mail = (subject: string, text: string | null, html: string | null = null) => ({
  subject,
  text,
  html,
});

describe('亚马逊订单号（3-7-7）', () => {
  it('从正文抽出，主题里的排在前面', () => {
    expect(
      extractOrderNumbers(
        'amazon',
        mail(
          'Inquiry from Amazon customer James Walker (Order: 113-5566112-7788990)',
          'Order ID: 111-2233445-5566778\nThe box arrived crushed.',
        ),
      ),
    ).toEqual(['113-5566112-7788990', '111-2233445-5566778']);
  });

  it('同一个号出现几次只算一次；位数不对、连在更长数字串里的不算', () => {
    expect(
      extractOrderNumbers(
        'amazon',
        mail(
          'Re: 113-5566112-7788990',
          [
            'Order 113-5566112-7788990 again: 113-5566112-7788990.',
            // 嵌着的号与上面的不同，才测得出前后的数字边界：前面多一位、后面多一位、两头都多
            'Tracking 9114-0000001-0000001 is not an order',
            'Tracking 114-0000002-00000021 neither',
            'Tracking 1114-0000003-00000031 neither',
            'Phone 555-1234567-123 neither',
          ].join('\n'),
        ),
      ),
    ).toEqual(['113-5566112-7788990']);
  });

  it('亚马逊店铺不按 Shopify 的订单名抽（#1063 不算）', () => {
    expect(extractOrderNumbers('amazon', mail('About #1063', 'order 1063'))).toEqual([]);
  });

  it('没有文本正文时从 HTML 里抽（去掉标签，样式与脚本的内容不算）', () => {
    expect(
      extractOrderNumbers(
        'amazon',
        mail(
          'Question',
          null,
          '<html><head><style>.x{color:#333333}</style></head><body><p>Order ID:<b>302-8811234-9901122</b></p></body></html>',
        ),
      ),
    ).toEqual(['302-8811234-9901122']);
  });
});

describe('Shopify 订单名（规范写法 #数字）', () => {
  it('#1063、# 1063 都抽成 #1063', () => {
    expect(extractOrderNumbers('shopify', mail('Where is my order #1063?', 'Ref # 1057'))).toEqual([
      '#1063',
      '#1057',
    ]);
  });

  it('英文与西班牙语的「订单」后面跟数字也算（order 1063、Order No. 1063、order number: 1063、pedido 1063、número de pedido: 1063）', () => {
    const cases: [string, string][] = [
      ['My order 1063 is late', '#1063'],
      ['Order No. 1064 arrived', '#1064'],
      ['order number: 1065', '#1065'],
      ['Order #: 1066', '#1066'],
      ['Order ID 1067', '#1067'],
      ['Mi pedido 1068 no llegó', '#1068'],
      ['mi orden 1071 llegó rota', '#1071'],
      ['Número de orden: 1072', '#1072'],
      ['Número de pedido: 1069', '#1069'],
      ['numero de pedido #1070', '#1070'],
    ];
    for (const [text, expected] of cases) {
      expect(extractOrderNumbers('shopify', mail('', text)), text).toEqual([expected]);
    }
  });

  it('联系表单通知的各栏（电话、国家代码）不当订单号', () => {
    const form = [
      "You received a new message from your online store's contact form.",
      'Country Code: US',
      'Name: Olivia Turner',
      'Email: olivia.turner@example.com',
      'Phone Number: 3035550142',
      'Body:',
      'Vacuum loses suction after a few weeks',
      '',
      'Order: #1063',
    ].join('\n');
    expect(extractOrderNumbers('shopify', mail('New customer message', form))).toEqual(['#1063']);
  });

  it('不到 4 位的数字不算（Apt #305、#1、order 12、pedido 999；Shopify 的订单名从 #1001 起），Shopify 店铺不抽亚马逊订单号', () => {
    expect(
      extractOrderNumbers(
        'shopify',
        mail('#1 fan', 'Apt #305, order 12 times, pedido 999; 113-5566112-7788990'),
      ),
    ).toEqual([]);
  });

  it('带「order / pedido / orden」字样的候选排在只写 # 的前面（不论在主题还是正文）', () => {
    expect(
      extractOrderNumbers('shopify', mail('Ticket #4521', 'About my order 1063, see #2001')),
    ).toEqual(['#1063', '#4521', '#2001']);
  });

  it('店铺改了订单名前缀（#Y22283）：数字前带 1–3 个字母（可带连字符）也算，候选写成 #订单号；后缀不用管', () => {
    const cases: [string, string][] = [
      ['Hi, my order #Y22283 arrived yesterday', '#22283'],
      ['Ref #y22284', '#22284'],
      ['About #YE-22285', '#22285'],
      ['My order Y22286 is late', '#22286'],
      ['Order No. #Y22287', '#22287'],
      ['Mi pedido Y22288 no llegó', '#22288'],
      ['Where is #1001-US?', '#1001'],
    ];
    for (const [text, expected] of cases) {
      expect(extractOrderNumbers('shopify', mail('', text)), text).toEqual([expected]);
    }
  });

  it('不带 # 也没有「订单」字样的字母加数字不算（型号、SKU）；字母超过 3 个的不算', () => {
    expect(
      extractOrderNumbers('shopify', mail('Y22283 not working', 'Model V12345, SKU #ABCD12345')),
    ).toEqual([]);
  });

  it('同一订单的几种写法只算一次', () => {
    expect(extractOrderNumbers('shopify', mail('#1063', 'order 1063, pedido #1063'))).toEqual([
      '#1063',
    ]);
  });
});

describe('HTML 正文里的 # 写成字符实体', () => {
  it('其他数字字符实体（&#8217; 等）解码成字符，不当订单名', () => {
    expect(
      extractOrderNumbers(
        'shopify',
        mail('', null, '<p>I&#8217;m writing about #1063 &#x201C;soon&#x201D;</p>'),
      ),
    ).toEqual(['#1063']);
  });

  it('没解码的字符实体（双重转义的 &amp;#8217;、不带分号的 &#8217）不当订单名', () => {
    expect(
      extractOrderNumbers('shopify', mail('', null, '<p>I&amp;#8217;m &#8217m about #1063</p>')),
    ).toEqual(['#1063']);
    expect(extractOrderNumbers('shopify', mail('', 'I&#8217m about #1063', null))).toEqual([
      '#1063',
    ]);
  });

  it('&#35;、&#x23; 还原成 #', () => {
    expect(
      extractOrderNumbers('shopify', mail('', null, '<p>Order &#35;1063</p><p>and &#x23;1064</p>')),
    ).toEqual(['#1063', '#1064']);
  });
});

describe('候选个数有上限', () => {
  it(`最多取前 ${MAX_ORDER_NUMBER_CANDIDATES} 个（每个候选都可能要去平台补拉）`, () => {
    const text = Array.from({ length: 12 }, (_, i) => `#${2000 + i}`).join(' ');
    const found = extractOrderNumbers('shopify', mail('', text));
    expect(found).toHaveLength(MAX_ORDER_NUMBER_CANDIDATES);
    expect(found[0]).toBe('#2000');
  });

  it('没有主题与正文时为空', () => {
    expect(extractOrderNumbers('amazon', mail('', null))).toEqual([]);
  });
});
