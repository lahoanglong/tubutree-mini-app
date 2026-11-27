import { DEFAULT_ORDER_SOURCE_MAP } from './external-order.config';
import {
  censusChannel,
  censusExitCode,
  channelOrders,
  codeLikeValue,
  codePrefix,
  codeShape,
  codesAtPath,
  formatCensusReport,
  liveLookupPredicate,
  maskForm,
  payloadLeaves,
  phoneFieldClassOf,
  phonePrefixClassOf,
  pickCensusSample,
  pickSearchSamples,
  runSearchChecks,
  statusBucketOf,
  type ChannelCensus,
} from './marketplace-field-census';

type Data = Record<string, unknown>;

let seq = 0;
/** Đơn Lazada tự dựng: mã đơn sàn chỉ nằm ở `lazada_info.order_number` (đường dẫn mà extract chưa đọc). */
const lazada = (over: Data = {}): Data => {
  seq++;
  return {
    id: 7000 + seq,
    status: 3,
    marketplace_id: -4,
    bill_phone_number: `09${String(10_000_000 + seq).padStart(8, '0')}`,
    shipping_address: { phone_number: null, full_name: 'Khach Mau', address: '12 Duong Mau' },
    lazada_info: { order_number: `LZORD${String(500_000 + seq)}` },
    shop_id: 'SHOPCODE0001',
    ...over,
  };
};

describe('marketplace-field-census (W44, chỉ GET)', () => {
  beforeEach(() => {
    seq = 0;
  });

  it('nhóm trạng thái: DELIVERED 3/16, SHIPPED 2, CLOSED 4/5/6/7/15, còn lại OPEN', () => {
    expect([3, 16, 2, 4, 5, 6, 7, 15, 0, 1, 8, 11, null].map((status) => statusBucketOf({ status }))).toEqual([
      'DELIVERED', 'DELIVERED', 'SHIPPED', 'CLOSED', 'CLOSED', 'CLOSED', 'CLOSED', 'CLOSED', 'OPEN', 'OPEN', 'OPEN', 'OPEN', 'OPEN',
    ]);
  });

  it('lá payload: sâu tối đa 3 tầng object, chỉ số mảng thành [], khoá có ≥ 4 chữ số thành #', () => {
    const paths = payloadLeaves({
      a: 1,
      b: { c: { d: 'x', e: { tooDeep: 'y' } } },
      list: [{ code: 'A' }, { code: 'B' }],
      byId: { '12345678': { v: 1 }, k123: 2 },
    }).map((l) => l.path);
    expect(paths).toEqual(['a', 'b.c.d', 'list[].code', 'list[].code', 'byId.#.v', 'byId.k123']);
    expect(paths.some((p) => p.includes('tooDeep'))).toBe(false);
  });

  it('giá trị dạng mã: chuẩn hoá được, không khoảng trắng giữa, không giống SĐT', () => {
    expect(codeLikeValue('SPXVN0123456789')).toBe('SPXVN0123456789');
    expect(codeLikeValue(' LEX-VN-55512345 ')).toBe('LEXVN55512345');
    expect(codeLikeValue(551234567890123)).toBe('551234567890123');
    expect(codeLikeValue('Giao hang nhanh')).toBeNull();
    expect(codeLikeValue('0912345678')).toBeNull();
    expect(codeLikeValue('84912345678')).toBeNull();
    expect(codeLikeValue('ABC')).toBeNull();
    expect(codeLikeValue(true)).toBeNull();
  });

  it('hình dạng và tiền tố mã không mang giá trị', () => {
    expect(codeShape('SPXVN0123456789B')).toBe('A5D10A1');
    expect(codeShape('551234567890123')).toBe('D15');
    expect(codePrefix('LEXVN55512345')).toBe('LEX');
    expect(codePrefix('862123456599')).toBeNull();
  });

  it('dạng trường SĐT và lớp tiền tố', () => {
    expect(phoneFieldClassOf('0912345678')).toBe('FULL');
    expect(phoneFieldClassOf('091*****78')).toBe('MASK_LEAD_TAIL');
    expect(phoneFieldClassOf('******78')).toBe('MASK_TAIL_ONLY');
    expect(phoneFieldClassOf('+8*******78')).toBe('MASK_UNPARSED');
    expect(phoneFieldClassOf('*********')).toBe('MASK_UNPARSED');
    expect(phoneFieldClassOf('Liên hệ shop')).toBe('TEXT');
    expect(phoneFieldClassOf({ n: 1 })).toBe('TEXT');
    expect(phoneFieldClassOf('')).toBe('EMPTY');
    expect(phoneFieldClassOf(null)).toBe('EMPTY');
    expect(['0912345678', '84912345678', '+84912345678', '0084*****789', '*****78', 'abc', ''].map(phonePrefixClassOf)).toEqual([
      '0', '84', '+84', '0084', '*', 'other', null,
    ]);
    expect(maskForm('+8*******78')).toBe('+d*******dd');
  });

  it('mẫu ưu tiên DELIVERED rồi SHIPPED rồi OPEN rồi CLOSED, giữ thứ tự trong nhóm', () => {
    const orders = [{ id: 1, status: 6 }, { id: 2, status: 1 }, { id: 3, status: 2 }, { id: 4, status: 3 }, { id: 5, status: 16 }];
    expect(pickCensusSample(orders, 4).map((o) => o['id'])).toEqual([4, 5, 3, 2]);
    expect(pickSearchSamples(orders, 10).map((o) => o['id'])).toEqual([4, 5, 3]);
  });

  it('chỉ đơn sàn đúng kênh, đơn app không tính', () => {
    const orders = [lazada(), { id: 1, marketplace_id: -3 }, { id: 2, tags: ['MINIAPP'], marketplace_id: -4 }];
    expect(channelOrders(orders, 'lazada', DEFAULT_ORDER_SOURCE_MAP)).toHaveLength(1);
  });

  it('đếm: 5 đường dẫn extract luôn có dòng, đường dẫn mã mới ≥ 80% nhóm nhận thành ứng viên, mã dùng chung thì không', () => {
    const orders = [...Array.from({ length: 8 }, () => lazada()), lazada({ status: 2 }), lazada({ status: 1, lazada_info: {} })];
    const c = censusChannel({ channel: 'lazada', orders }, 50);
    expect(c.fetched).toEqual({ DELIVERED: 8, SHIPPED: 1, OPEN: 1, CLOSED: 0 });
    expect(c.claimSample).toBe(9);
    expect(c.anyCodeRate).toBe(0);
    expect(c.codePaths.slice(0, 5).map((r) => r.path)).toEqual([
      'partner.extend_code',
      'partner.extend_update[].tracking_id',
      'order_number_vtp',
      'invoice_info_list[].order_sn',
      'tracking_number',
    ]);
    const lz = c.codePaths.find((r) => r.path === 'lazada_info.order_number')!;
    expect(lz).toMatchObject({ coverageClaim: 1, distinctRatio: 1, inExtractRatio: 0, prefixes: ['LZO×9'], shapes: ['A5D6×9'] });
    expect(lz.coverage).toEqual({ DELIVERED: 1, SHIPPED: 1, OPEN: 0, CLOSED: null });
    expect(c.codePaths.find((r) => r.path === 'shop_id')!.distinctRatio).toBe(0.1);
    expect(c.candidatePaths).toEqual(['lazada_info.order_number']);
  });

  it('SĐT: số FULL khác nhau đếm bằng băm, số dùng chung bị nghi trung gian', () => {
    const relay = Array.from({ length: 6 }, () => lazada({ bill_phone_number: '0900000001' }));
    const c = censusChannel({ channel: 'lazada', orders: relay }, 50);
    expect(c.buyerShapes.FULL).toBe(6);
    expect(c.buyerFullDistinctRatio).toBe(0.17);
    expect(c.relaySuspect).toBe(true);
    const bill = c.phonePaths.find((p) => p.path === 'bill_phone_number')!;
    expect(bill).toMatchObject({ present: 6, fullDistinctRatio: 0.17, betterDigitsRate: null });
    expect(bill.classes.FULL).toBe(6);
    expect(c.phonePaths.find((p) => p.path === 'shipping_address.phone_number')!.classes.EMPTY).toBe(6);

    const distinct = censusChannel({ channel: 'lazada', orders: Array.from({ length: 6 }, () => lazada()) }, 50);
    expect(distinct.buyerFullDistinctRatio).toBe(1);
    expect(distinct.relaySuspect).toBe(false);
  });

  it('SĐT: đường dẫn khác thấy nhiều chữ số hơn khi SĐT người mua bị che', () => {
    const orders = Array.from({ length: 4 }, (_, i) => lazada({ bill_phone_number: '******78', customer: { phone_numbers: i < 3 ? ['0912345678'] : [] } }));
    const c = censusChannel({ channel: 'lazada', orders }, 50);
    expect(c.buyerShapes.MASK_TAIL_ONLY).toBe(4);
    expect(c.phonePaths.find((p) => p.path === 'customer.phone_numbers[]')!.betterDigitsRate).toBe(0.75);
    expect(c.claimableRate).toBe(0);
  });

  it('tra lại theo vị từ lookup, không theo id; mã mới tra theo cùng đường dẫn', async () => {
    const orders = [
      lazada({ tracking_number: 'LEXVN00000001' }),
      lazada({ tracking_number: 'LEXVN00000002', invoice_info_list: [{ order_sn: 'SN000000002' }] }),
      lazada({ tracking_number: 'LEXVN00000003' }),
    ];
    const census = censusChannel({ channel: 'lazada', orders }, 50);
    const queries: string[] = [];
    const search = async (text: string): Promise<Data[]> => {
      queries.push(text);
      if (text === 'LEXVN00000001') return [{ id: 999, tracking_number: 'LEXVN00000001' }];
      if (text === 'LEXVN00000003') return [{ id: 1, note: 'LEXVN00000003 trong ghi chú' }];
      if (text.startsWith('LZORD')) return orders.filter((o) => codesAtPath(o, 'lazada_info.order_number').includes(text));
      return [];
    };
    const out = await runSearchChecks(census, pickSearchSamples(orders, 10), search, liveLookupPredicate);
    expect(out.searches.map((s) => [s.trackingHit, s.orderSnHit, s.candidateHits['lazada_info.order_number'], s.sameOrder])).toEqual([
      [true, null, true, true],
      [false, false, true, true],
      [false, null, true, true],
    ]);
    expect(out.lookupRate).toBe(0.33);
    expect(out.lookupReady).toBe(false);
    expect(queries).toHaveLength(7);
    expect(censusExitCode([out])).toBe(1);
  });

  it('mã thoát: 0 khi mọi kênh có đơn nhóm nhận đều sẵn sàng, 2 khi không kênh nào có', () => {
    const base = censusChannel({ channel: 'x', orders: [lazada()] }, 50);
    const ready: ChannelCensus = { ...base, lookupReady: true };
    const empty: ChannelCensus = { ...base, claimSample: 0, lookupReady: false };
    expect(censusExitCode([ready, empty])).toBe(0);
    expect(censusExitCode([empty])).toBe(2);
  });

  it('báo cáo đã che: không chữ số SĐT, không giá trị mã, không chuỗi ≥ 9 chữ số, không tên hay địa chỉ', async () => {
    const orders = [
      lazada({ tracking_number: 'LEXVN123456789012', bill_phone_number: '0987654321' }),
      lazada({ status: 2, bill_phone_number: '098*****21', tracking_number: 'LEXVN123456789013' }),
      lazada({ status: 1, bill_phone_number: '+8*******21' }),
    ];
    const census = censusChannel({ channel: 'lazada', orders }, 50);
    const out = await runSearchChecks(census, pickSearchSamples(orders, 10), async () => orders, liveLookupPredicate);
    const db = [{ channel: 'lazada', status: 'DELIVERED', n: 5, noCode: 5, noPhone: 0, withOrderSn: 0 }];
    const text = formatCensusReport({ days: 30, perChannel: 50, getCalls: 9, channels: [out], db });
    const json = JSON.stringify({ channels: [out], db });
    for (const s of [text, json]) {
      expect(s).not.toMatch(/\d{9,}/);
      expect(s).not.toMatch(/0987654321|987654321|LEXVN1234|LZORD5/);
      expect(s).not.toMatch(/Khach Mau|Duong Mau/);
    }
    expect(text).toContain('LEX***********012');
    expect(text).toContain('khuôn che lạ: +d*******dd×1');
    expect(text).toContain('## external_orders');
    expect(text).toContain('LOOKUP_READY có');
  });
});
