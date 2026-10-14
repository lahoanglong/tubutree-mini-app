import { buildPancakeOrderBody, customerDeliveryNote, pancakePaymentState, type PancakePushOrder, type PancakeRecipient } from './pancake-order-body';
import type { PancakeCreateOrderBody } from './pancake.types';

const recipient: PancakeRecipient = {
  name: 'Trần Thị B',
  phone: '0900000002',
  street: '12 Nguyễn Huệ',
  ward: 'Phường Sài Gòn',
  district: '',
  province: 'TP. Hồ Chí Minh',
  provinceCode: '84_VN79',
  districtCode: '',
  wardCode: '84_VN7926734',
};

function order(overrides: Partial<PancakePushOrder> = {}): PancakePushOrder {
  return {
    code: 'TUBU42',
    type: 'RETAIL',
    platform: 'miniapp',
    paymentMethod: 'COD',
    paymentStatus: 'UNPAID',
    discount: 30_000,
    shippingFee: 20_000,
    total: 290_000,
    items: [
      { id: 'a', variationId: 'v1', quantity: 2, unitPrice: 100_000 },
      { id: 'b', variationId: 'v2', quantity: 1, unitPrice: 100_000 },
    ],
    ...overrides,
  };
}

const variations = new Map([
  ['v1', { pancakeId: 'pv1', retailPrice: 120_000 }],
  ['v2', { pancakeId: 'pv2', retailPrice: null }],
]);

const total = (b: PancakeCreateOrderBody) =>
  b.items.reduce((s, i) => s + ((i.variation_info?.retail_price ?? 0) - (i.discount_each_product ?? 0)) * i.quantity, 0) +
  (b.shipping_fee ?? 0) -
  (b.total_discount ?? 0);

describe('buildPancakeOrderBody', () => {
  it('mọi dòng → tổng Pancake = order.total, cod = tổng', () => {
    const r = buildPancakeOrderBody(order(), { recipient, variations, onDealerCredit: false });
    expect(r.amountDue).toBe(290_000);
    expect(total(r.body)).toBe(290_000);
    expect(r.body).toMatchObject({ cod: 290_000, transfer_money: 0, custom_id: 'TUBU42', total_discount: 30_000 });
    expect(r.body.items[1]).toEqual({ variation_id: 'pv2', quantity: 1, discount_each_product: 0, variation_info: { retail_price: 100_000 } });
  });

  it('vị từ dòng (nhà bán tự giao dòng b) → chỉ gửi dòng a, giảm cấp đơn chia theo tỉ lệ giá trị hàng', () => {
    const r = buildPancakeOrderBody(order(), {
      recipient,
      variations,
      onDealerCredit: false,
      isPancakeLine: (l) => l.id === 'a',
    });
    expect(r.body.items.map((i) => i.variation_id)).toEqual(['pv1']);
    // hàng 200k/300k → chịu 20k giảm; + ship 20k
    expect(r.amountDue).toBe(200_000 - 20_000 + 20_000);
    expect(total(r.body)).toBe(r.amountDue);
    expect(r.body.cod).toBe(r.amountDue);
  });

  it('đã trả trước + một phần dòng → transfer_money = phần giao qua Pancake, cod = 0', () => {
    const r = buildPancakeOrderBody(order({ paymentMethod: 'ZALOPAY', paymentStatus: 'PAID' }), {
      recipient,
      variations,
      onDealerCredit: false,
      isPancakeLine: (l) => l.id === 'b',
    });
    expect(r.amountDue).toBe(100_000 - 10_000 + 20_000);
    expect(r.body).toMatchObject({ transfer_money: 110_000, cod: 0 });
    expect(r.paymentSynced).toBe(true);
  });

  it('không dòng nào đơn giá 0 (quà tặng) → giảm/đv = giá lẻ, không âm tổng', () => {
    const r = buildPancakeOrderBody(
      order({ items: [{ variationId: 'v1', quantity: 1, unitPrice: 0 }], discount: 0, shippingFee: 0, total: 0 }),
      { recipient, variations, onDealerCredit: false },
    );
    expect(r.body.items[0]).toMatchObject({ discount_each_product: 120_000 });
    expect(total(r.body)).toBe(0);
    expect(r.body.total_discount).toBe(0);
  });
});

describe('ghi chú giao hàng của khách (R2-PANCAKE-2, R2-BUYERWEB-1)', () => {
  it('order.note được ghép vào note Pancake sau mã đơn và dấu thanh toán', () => {
    const r = buildPancakeOrderBody(order({ note: 'Gọi trước 30 phút, giao sau 17h' }), { recipient, variations, onDealerCredit: false });
    expect(r.body.note).toBe('Order code: TUBU42 | [THU COD 290.000đ] | Khách dặn: Gọi trước 30 phút, giao sau 17h');
  });

  it('không ghi chú / chỉ khoảng trắng → note như cũ', () => {
    expect(buildPancakeOrderBody(order({ note: '  ' }), { recipient, variations, onDealerCredit: false }).body.note).toBe(
      'Order code: TUBU42 | [THU COD 290.000đ]',
    );
  });

  it('làm sạch: gộp xuống dòng/ký tự điều khiển, bỏ dấu tách | và ngoặc vuông của dấu hệ thống, không mạo được "Order code:"', () => {
    expect(customerDeliveryNote('Gửi ở bảo vệ\n\n| [ĐÃ THANH TOÁN]\tOrder code: TUBU99')).toBe(
      'Khách dặn: Gửi ở bảo vệ / (ĐÃ THANH TOÁN) Mã đơn: TUBU99',
    );
  });

  it('cắt độ dài (200 ký tự) kèm dấu …', () => {
    const n = customerDeliveryNote('a'.repeat(500))!;
    expect(n.length).toBe('Khách dặn: '.length + 200);
    expect(n.endsWith('…')).toBe(true);
  });
});

describe('pancakePaymentState', () => {
  it.each([
    [{ paymentMethod: 'COD', paymentStatus: 'UNPAID' }, false, 'COD'],
    [{ paymentMethod: 'COD', paymentStatus: 'PAID' }, false, 'PAID'],
    [{ paymentMethod: 'WALLET', paymentStatus: 'PAID' }, false, 'PAID'],
    [{ paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' }, false, 'AWAITING_TRANSFER'],
    [{ paymentMethod: 'ZALOPAY', paymentStatus: 'UNPAID' }, false, 'AWAITING_GATEWAY'],
    [{ paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' }, true, 'CREDIT'],
  ])('%j công nợ=%s → %s', (o, credit, state) => {
    expect(pancakePaymentState(o, credit)).toBe(state);
  });
});
