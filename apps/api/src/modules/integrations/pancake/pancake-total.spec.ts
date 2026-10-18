import { buildPancakeOrderBody, type PancakePushOrder, type PancakeRecipient } from './pancake-order-body';
import { pancakeTotalMismatch, pancakeTotalReadings } from './pancake-total';

/**
 * Payload `order` rút gọn theo schema "Đơn hàng" của Pancake POS Open API (api-docs.pancake.vn): tổng tiền hàng
 * `total_price`, tổng sau giảm đơn `total_price_after_sub_discount`, `total_discount`, `shipping_fee`, `cod`, `prepaid`.
 * Số liệu khớp đơn Tubu TUBU20260001: 2 × 150.000 (giảm dòng 10.000/cái) − giảm đơn 30.000 + ship 19.000 = 269.000.
 */
const SAMPLE = {
  id: 7001,
  status: 1,
  custom_id: 'TUBU20260001',
  items: [{ variation_id: 'pv1', quantity: 2, discount_each_product: 10_000, variation_info: { retail_price: 150_000 } }],
  total_price: 280_000,
  total_price_after_sub_discount: 250_000,
  total_discount: 30_000,
  shipping_fee: 19_000,
  cod: 269_000,
  prepaid: 0,
};

/** Đơn Tubu TUBU20260001: tổng 269.000 gồm ship 19.000. */
const TUBU = { total: 269_000, shippingFee: 19_000 };

describe('pancakeTotalReadings', () => {
  it('payload mẫu cho ra đúng số khách phải trả (cách đọc chính đứng đầu)', () => {
    expect(pancakeTotalReadings(SAMPLE, 19_000)).toEqual([269_000, 250_000]);
  });

  it('số dạng chuỗi vẫn đọc được; ô thiếu/không phải số thì bỏ qua; không có ô tổng nào → rỗng', () => {
    expect(pancakeTotalReadings({ total_price_after_sub_discount: '250000', shipping_fee: '19000' }, 19_000)).toEqual([269_000, 250_000]);
    expect(pancakeTotalReadings({ total_price: 'abc', total_price_after_sub_discount: null }, 0)).toEqual([]);
    expect(pancakeTotalReadings({ status: 1, cod: 269_000 }, 0)).toEqual([]);
    expect(pancakeTotalReadings({}, 0)).toEqual([]);
  });

  it('chỉ có total_price và total_discount: tính total_price − total_discount + ship', () => {
    expect(pancakeTotalReadings({ total_price: 280_000, total_discount: 30_000, shipping_fee: 19_000 }, 19_000)).toEqual([269_000]);
  });

  it('không có phí ship thì hai cách đọc trùng nhau, chỉ trả một số', () => {
    expect(pancakeTotalReadings({ total_price_after_sub_discount: 250_000 }, 19_000)).toEqual([250_000]);
  });

  it('số âm hoặc không hữu hạn không được coi là tổng tiền', () => {
    expect(pancakeTotalReadings({ total_price_after_sub_discount: -5, shipping_fee: 0 }, 0)).toEqual([]);
    expect(pancakeTotalReadings({ total_price_after_sub_discount: Infinity }, 0)).toEqual([]);
  });
});

describe('pancakeTotalMismatch', () => {
  it('đơn đúng như Tubu đã đẩy → không lệch', () => {
    expect(pancakeTotalMismatch(SAMPLE, TUBU)).toBeNull();
  });

  it('nhân viên thêm một món 50.000 trên Pancake → lệch +50.000 so với đơn Tubu', () => {
    const edited = { ...SAMPLE, total_price: 330_000, total_price_after_sub_discount: 300_000, cod: 319_000 };
    expect(pancakeTotalMismatch(edited, TUBU)).toEqual({ pancakeTotal: 319_000, diff: 50_000 });
  });

  it('bớt món → lệch âm', () => {
    const edited = { ...SAMPLE, total_price: 130_000, total_price_after_sub_discount: 100_000, cod: 119_000 };
    expect(pancakeTotalMismatch(edited, TUBU)).toEqual({ pancakeTotal: 119_000, diff: -150_000 });
  });

  it('Pancake đã gộp ship vào total_price_after_sub_discount thì vẫn khớp, không báo nhầm', () => {
    expect(pancakeTotalMismatch({ total_price_after_sub_discount: 269_000, shipping_fee: 19_000 }, TUBU)).toBeNull();
  });

  it('đơn Tubu freeship 269.000, nhân viên thêm ship 30.000 trên Pancake: vẫn phải báo lệch +30.000 (cách đọc không cộng ship không được che)', () => {
    const freeship = { total: 269_000, shippingFee: 0 };
    const edited = { total_price: 299_000, total_price_after_sub_discount: 269_000, total_discount: 30_000, shipping_fee: 30_000 };
    expect(pancakeTotalReadings(edited, 0)).toEqual([299_000]);
    expect(pancakeTotalMismatch(edited, freeship)).toEqual({ pancakeTotal: 299_000, diff: 30_000 });
  });

  it('Pancake đổi phí ship khác phí ship của đơn Tubu (cả hai khác 0) cũng báo lệch', () => {
    const edited = { total_price_after_sub_discount: 250_000, shipping_fee: 40_000 };
    expect(pancakeTotalMismatch(edited, TUBU)).toEqual({ pancakeTotal: 290_000, diff: 21_000 });
  });

  it('payload không có ô phí ship: chấp nhận cách đọc không cộng ship (Pancake có thể đã gộp ship vào tổng)', () => {
    expect(pancakeTotalMismatch({ total_price_after_sub_discount: 269_000 }, TUBU)).toBeNull();
  });

  it('payload không mang số tổng nào → không kết luận lệch', () => {
    expect(pancakeTotalMismatch({ id: 1, status: 2, partner: { partner_name: 'GHN' } }, TUBU)).toBeNull();
  });
});

describe('khớp với body Tubu đẩy lên Pancake (buildPancakeOrderBody)', () => {
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
  const variations = new Map([
    ['v1', { pancakeId: 'pv1', retailPrice: 120_000 }],
    ['v2', { pancakeId: 'pv2', retailPrice: null }],
  ]);
  const order = (over: Partial<PancakePushOrder> = {}): PancakePushOrder => ({
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
    ...over,
  });

  /** Pancake tính lại tổng từ body nhận được, như khi trả webhook đơn. */
  const echo = (b: ReturnType<typeof buildPancakeOrderBody>['body']) => {
    const totalPrice = b.items.reduce((s, i) => s + ((i.variation_info?.retail_price ?? 0) - (i.discount_each_product ?? 0)) * i.quantity, 0);
    return {
      total_price: totalPrice,
      total_discount: b.total_discount,
      total_price_after_sub_discount: totalPrice - (b.total_discount ?? 0),
      shipping_fee: b.shipping_fee,
      cod: b.cod,
      prepaid: b.transfer_money,
    };
  };

  it('đơn nguyên vẹn: tổng Pancake dựng lại từ body luôn khớp order.total (không báo lệch ngay sau khi đẩy)', () => {
    const o = order();
    const { body } = buildPancakeOrderBody(o, { recipient, variations, onDealerCredit: false });
    expect(pancakeTotalMismatch(echo(body), o)).toBeNull();
  });

  it('đơn đã trả trước (prepaid = tổng) cũng khớp', () => {
    const o = order({ paymentMethod: 'ZALOPAY', paymentStatus: 'PAID' });
    const { body } = buildPancakeOrderBody(o, { recipient, variations, onDealerCredit: false });
    expect(pancakeTotalMismatch(echo(body), o)).toBeNull();
  });
});
