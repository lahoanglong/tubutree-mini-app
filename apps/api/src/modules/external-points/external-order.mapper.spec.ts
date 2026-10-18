import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buyerPhone,
  classifyPancakeOrder,
  deliveredAt,
  externalStatusOf,
  extractTrackingCodes,
  goodsValue,
  normalizeTrackingCode,
  pancakeTime,
  payloadForStorage,
  sourceKeyOf,
} from './external-order.mapper';
import { DEFAULT_ORDER_SOURCE_MAP, orderSourceMapProblem, resolveOrderSourceMap } from './external-order.config';

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(__dirname, '../../../test/fixtures/pancake', name), 'utf-8')) as Record<string, unknown>;
const MAP = DEFAULT_ORDER_SOURCE_MAP;

describe('classifyPancakeOrder', () => {
  it('đơn sàn theo marketplace_id mặc định: -3 shopee, -4 lazada, -9 tiktok', () => {
    expect(classifyPancakeOrder(fixture('synthetic-shopee.json'), MAP)).toEqual({ kind: 'MARKETPLACE', channel: 'shopee' });
    expect(classifyPancakeOrder(fixture('synthetic-lazada.json'), MAP)).toEqual({ kind: 'MARKETPLACE', channel: 'lazada' });
    expect(classifyPancakeOrder(fixture('synthetic-tiktok.json'), MAP)).toEqual({ kind: 'MARKETPLACE', channel: 'tiktok' });
  });

  it('marketplace_id gửi dạng chuỗi vẫn khớp', () => {
    expect(classifyPancakeOrder({ marketplace_id: '-3' }, MAP)).toEqual({ kind: 'MARKETPLACE', channel: 'shopee' });
  });

  it('is_from_ecommerce=true mà marketplace_id lạ: vẫn là đơn sàn nhưng chưa biết sàn nào', () => {
    expect(classifyPancakeOrder({ is_from_ecommerce: true, marketplace_id: -77 }, MAP)).toEqual({ kind: 'MARKETPLACE', channel: null });
  });

  it('đơn app không bao giờ là đơn ngoài: mã Tubu ở custom_id, note, extension, tag chuỗi hoặc tag object', () => {
    const asMarketplace = { marketplace_id: -3, is_from_ecommerce: true };
    for (const app of [
      { custom_id: 'TUBU20261001' },
      { custom_id: 'TUBUSUB20261001' },
      { custom_id: 'DLR20261001' },
      { note: 'khách dặn. Order code: TUBU20261001' },
      { extension: { external_order_id: 'TUBU20261001' } },
      { tags: ['MINIAPP'] },
      { tags: ['WEB', 'RETAIL'] },
      { tags: [{ name: 'MINIAPP' }] },
      { tags: [{ id: 4, name: 'web' }] },
      { tags: 'RETAIL, MINIAPP' },
    ]) {
      expect(classifyPancakeOrder({ ...asMarketplace, ...app }, MAP)).toEqual({ kind: 'APP', channel: null });
    }
    expect(classifyPancakeOrder(fixture('synthetic-app.json'), MAP).kind).toBe('APP');
  });

  it('custom_id không theo mẫu Tubu thì không phải đơn app', () => {
    expect(classifyPancakeOrder({ custom_id: 'SHOP123' }, MAP).kind).toBe('UNKNOWN');
    expect(classifyPancakeOrder({ custom_id: 'TUBU' }, MAP).kind).toBe('UNKNOWN');
  });

  it('đơn chat chỉ khi sourceKey nằm trong chatSources', () => {
    const chat = fixture('synthetic-chat.json');
    expect(classifyPancakeOrder(chat, MAP).kind).toBe('UNKNOWN');
    const map = { ...MAP, chatSources: ['-1|fanpage_mau|'] };
    expect(sourceKeyOf(chat)).toBe('-1|fanpage_mau|');
    expect(classifyPancakeOrder(chat, map)).toEqual({ kind: 'CHAT', channel: null });
  });

  it('đơn sàn thắng đơn chat khi trùng cả hai', () => {
    const data = fixture('synthetic-shopee.json');
    const map = { ...MAP, chatSources: [sourceKeyOf(data)] };
    expect(classifyPancakeOrder(data, map).kind).toBe('MARKETPLACE');
  });

  it('không có dấu hiệu nào: UNKNOWN', () => {
    expect(classifyPancakeOrder({ id: 1 }, MAP)).toEqual({ kind: 'UNKNOWN', channel: null });
  });
});

describe('sourceKeyOf', () => {
  it('ghép order_sources|account|marketplace_id, thiếu thì để trống', () => {
    expect(sourceKeyOf({ order_sources: -3, account: 'abc', marketplace_id: -3 })).toBe('-3|abc|-3');
    expect(sourceKeyOf({})).toBe('||');
  });
});

describe('normalizeTrackingCode / extractTrackingCodes', () => {
  it('chữ hoa, bỏ khoảng trắng và gạch; chỉ giữ A-Z0-9 dài 8–30', () => {
    expect(normalizeTrackingCode(' spx vn-0123 456789 ')).toBe('SPXVN0123456789');
    expect(normalizeTrackingCode('ABC123')).toBeNull();
    expect(normalizeTrackingCode('A'.repeat(31))).toBeNull();
    expect(normalizeTrackingCode('ABCD1234!@')).toBeNull();
    expect(normalizeTrackingCode(12345678901)).toBe('12345678901');
    expect(normalizeTrackingCode(null)).toBeNull();
    expect(normalizeTrackingCode({})).toBeNull();
  });

  it('gom mã từ mọi field, không trùng, đúng thứ tự ưu tiên', () => {
    const codes = extractTrackingCodes({
      partner: { extend_code: 'spx-00001', extend_update: [{ tracking_id: 'SPX00001' }, { tracking_id: 'spx00002 x' }, {}] },
      order_number_vtp: 'VTP00012345',
      invoice_info_list: [{ order_sn: '2410101ABCDEF' }, { order_sn: '' }],
      tracking_number: 'TN-9999-8888',
    });
    expect(codes).toEqual(['SPX00001', 'SPX00002X', 'VTP00012345', '2410101ABCDEF', 'TN99998888']);
  });

  it('mã 7 ký tự bị loại (dưới 8)', () => {
    expect(extractTrackingCodes({ partner: { extend_code: 'SPX0001' } })).toEqual([]);
  });

  it('fixture Shopee: mã vận đơn và mã đơn sàn', () => {
    expect(extractTrackingCodes(fixture('synthetic-shopee.json'))).toEqual(['SPXVN0123456789', '2410101ABCDEF']);
  });

  it('payload không có gì thì mảng rỗng, field sai kiểu không ném', () => {
    expect(extractTrackingCodes({})).toEqual([]);
    expect(extractTrackingCodes({ partner: 'x', invoice_info_list: 5, tracking_number: {} })).toEqual([]);
  });
});

describe('goodsValue', () => {
  it('Σ qty × (retail − giảm/món) − total_discount, không cộng ship', () => {
    expect(goodsValue(fixture('synthetic-shopee.json'))).toBe(320_000);
    expect(goodsValue(fixture('synthetic-chat.json'))).toBe(300_000);
  });

  it('lệch quá 1% so với total_price − total_discount thì null', () => {
    const data = { ...fixture('synthetic-shopee.json'), total_price: 400_000 };
    expect(goodsValue(data)).toBeNull();
  });

  it('lệch trong 1% thì chấp nhận', () => {
    const data = { ...fixture('synthetic-shopee.json'), total_price: 340_900 };
    expect(goodsValue(data)).toBe(320_000);
  });

  it('thiếu total_price, thiếu dòng hàng, số lượng hay giá hỏng: null', () => {
    const base = fixture('synthetic-chat.json');
    expect(goodsValue({ ...base, total_price: undefined })).toBeNull();
    expect(goodsValue({ ...base, items: [] })).toBeNull();
    expect(goodsValue({ ...base, items: undefined })).toBeNull();
    expect(goodsValue({ ...base, items: [{ quantity: 0, variation_info: { retail_price: 100 } }] })).toBeNull();
    expect(goodsValue({ ...base, items: [{ quantity: 1 }] })).toBeNull();
  });

  it('total_discount thiếu coi là 0; giá trị không dương: null', () => {
    const base = fixture('synthetic-chat.json');
    expect(goodsValue({ ...base, total_discount: undefined })).toBe(300_000);
    expect(goodsValue({ ...base, total_discount: 300_000, total_price: 300_000 })).toBeNull();
  });
});

describe('pancakeTime / deliveredAt', () => {
  it('chuỗi không múi giờ đọc theo +07:00', () => {
    expect(pancakeTime('2026-10-13T15:30:00')?.toISOString()).toBe('2026-10-13T08:30:00.000Z');
    expect(pancakeTime('2026-10-13T08:30:00Z')?.toISOString()).toBe('2026-10-13T08:30:00.000Z');
    expect(pancakeTime('2026-10-13 15:30:00')?.toISOString()).toBe('2026-10-13T08:30:00.000Z');
    expect(pancakeTime('rác')).toBeNull();
    expect(pancakeTime(undefined)).toBeNull();
  });

  it('mốc đầu tiên có status 3 hoặc 16', () => {
    expect(deliveredAt(fixture('synthetic-shopee.json'))?.toISOString()).toBe('2026-10-13T08:30:00.000Z');
    expect(deliveredAt(fixture('synthetic-chat.json'))?.toISOString()).toBe('2026-10-14T03:00:00.000Z');
    const both = {
      status_history: [
        { status: 16, updated_at: '2026-10-15T10:00:00' },
        { status: 3, updated_at: '2026-10-14T10:00:00' },
      ],
    };
    expect(deliveredAt(both)?.toISOString()).toBe('2026-10-14T03:00:00.000Z');
  });

  it('không có lịch sử giao thì null', () => {
    expect(deliveredAt({ status_history: [{ status: 2, updated_at: '2026-10-11T09:00:00' }] })).toBeNull();
    expect(deliveredAt({})).toBeNull();
  });
});

describe('buyerPhone', () => {
  it('bill_phone_number trước, rồi shipping_address.phone_number; chuẩn hoá về 0xxxxxxxxx', () => {
    expect(buyerPhone({ bill_phone_number: '+84 912 345 678' })).toBe('0912345678');
    expect(buyerPhone({ shipping_address: { phone_number: '0912-345-678' } })).toBe('0912345678');
    expect(buyerPhone({ bill_phone_number: '0911000222', shipping_address: { phone_number: '0912345678' } })).toBe('0911000222');
  });

  it('số bị che (sàn ẩn SĐT) thì null, không lấy số che làm khoá', () => {
    expect(buyerPhone({ bill_phone_number: '09******78', shipping_address: { phone_number: '*******678' } })).toBeNull();
    expect(buyerPhone({ bill_phone_number: '09******78', shipping_address: { phone_number: '0912345678' } })).toBe('0912345678');
    expect(buyerPhone({})).toBeNull();
    expect(buyerPhone({ bill_phone_number: 123 })).toBeNull();
  });
});

describe('externalStatusOf', () => {
  it.each([
    [0, 'OPEN'],
    [2, 'OPEN'],
    [3, 'DELIVERED'],
    [16, 'DELIVERED'],
    [4, 'RETURNING'],
    [5, 'RETURNED'],
    [6, 'CANCELLED'],
    [7, 'DELETED'],
    [15, 'PARTIAL_RETURN'],
    ['3', 'DELIVERED'],
  ])('status %p -> %s', (status, expected) => {
    expect(externalStatusOf({ status })).toEqual({ pancakeStatus: Number(status), status: expected });
  });

  it('thiếu hoặc không phải số: giữ OPEN, pancakeStatus null', () => {
    expect(externalStatusOf({})).toEqual({ pancakeStatus: null, status: 'OPEN' });
    expect(externalStatusOf({ status: 'abc' })).toEqual({ pancakeStatus: null, status: 'OPEN' });
  });
});

describe('pancake.order_source_map', () => {
  it('mặc định và giá trị hợp lệ', () => {
    expect(orderSourceMapProblem(DEFAULT_ORDER_SOURCE_MAP)).toBeNull();
    expect(orderSourceMapProblem({ marketplaceIds: { '-3': 'shopee', '12': 'sendo' }, chatSources: ['-1|fb|'] })).toBeNull();
  });

  it.each([
    ['không phải object', 'x'],
    ['mảng', []],
    ['thiếu marketplaceIds', { chatSources: [] }],
    ['khoá không phải số', { marketplaceIds: { shopee: 'shopee' }, chatSources: [] }],
    ['tên sàn sai', { marketplaceIds: { '-3': 'Shopee VN' }, chatSources: [] }],
    ['thiếu chatSources', { marketplaceIds: {} }],
    ['chatSources có chuỗi rỗng', { marketplaceIds: {}, chatSources: [''] }],
    ['chatSources có số', { marketplaceIds: {}, chatSources: [1] }],
    ['chatSources khoá toàn dấu |', { marketplaceIds: {}, chatSources: ['||'] }],
    ['chatSources khoá rỗng chữ', { marketplaceIds: {}, chatSources: ['|  |'] }],
    ['marketplaceIds khoá 03', { marketplaceIds: { '03': 'shopee' }, chatSources: [] }],
    ['marketplaceIds khoá -0', { marketplaceIds: { '-0': 'shopee' }, chatSources: [] }],
    ['marketplaceIds khoá +3', { marketplaceIds: { '+3': 'shopee' }, chatSources: [] }],
  ])('từ chối: %s', (_label, value) => {
    expect(orderSourceMapProblem(value)).not.toBeNull();
  });

  it('resolve: hỏng thì mặc định, hợp lệ thì lấy bản sao', () => {
    expect(resolveOrderSourceMap('rác')).toBe(DEFAULT_ORDER_SOURCE_MAP);
    const ok = { marketplaceIds: { '-5': 'sendo' }, chatSources: ['a|b|c'] };
    expect(resolveOrderSourceMap(ok)).toEqual(ok);
    expect(resolveOrderSourceMap(ok)).not.toBe(ok);
  });
});

describe('giá trị vượt cột Int', () => {
  it('goodsValue lớn hơn 2^31-1 là null, không để Prisma ném', () => {
    const data = {
      items: [{ quantity: 1, discount_each_product: 0, variation_info: { retail_price: 3_000_000_000 } }],
      total_price: 3_000_000_000,
      total_discount: 0,
    };
    expect(goodsValue(data)).toBeNull();
  });

  it('status ngoài miền Int hoặc âm: pancakeStatus null, trạng thái OPEN', () => {
    expect(externalStatusOf({ status: 1e12 })).toEqual({ pancakeStatus: null, status: 'OPEN' });
    expect(externalStatusOf({ status: -5 })).toEqual({ pancakeStatus: null, status: 'OPEN' });
    expect(externalStatusOf({ status: 2_147_483_647 }).pancakeStatus).toBe(2_147_483_647);
  });
});

describe('payloadForStorage', () => {
  it('giữ field phân loại/tiền/trạng thái/mã vận đơn, bỏ PII và ghi chú; kết quả vẫn phân loại và tính tiền như bản gốc', () => {
    const raw = {
      ...fixture('synthetic-shopee.json'),
      bill_full_name: 'Nguyen Van A',
      bill_phone_number: '0912345678',
      note: 'ghi chú tự do',
      shipping_address: { phone_number: '0912345678', full_name: 'A', address: 'x' },
      tags: [{ id: 1, name: 'WEB', color: 'red' }, 'VIP'],
      items: [{ quantity: 2, discount_each_product: 10000, product_name: 'Tên', variation_info: { retail_price: 150000, name: 'Biến thể' } }],
    };
    const kept = payloadForStorage(raw);
    const text = JSON.stringify(kept);
    for (const pii of ['Nguyen Van A', '0912345678', 'ghi chú', 'shipping_address', 'bill_', 'Tên', 'Biến thể', 'color']) expect(text).not.toContain(pii);
    expect(kept['tags']).toEqual([{ name: 'WEB' }, 'VIP']);
    const shopee = fixture('synthetic-shopee.json');
    const keptShopee = payloadForStorage(shopee);
    expect(classifyPancakeOrder(keptShopee, MAP)).toEqual(classifyPancakeOrder(shopee, MAP));
    expect(goodsValue(keptShopee)).toBe(goodsValue(shopee));
    expect(extractTrackingCodes(keptShopee)).toEqual(extractTrackingCodes(shopee));
    expect(deliveredAt(keptShopee)).toEqual(deliveredAt(shopee));
    expect(sourceKeyOf(keptShopee)).toBe(sourceKeyOf(shopee));
  });
});
