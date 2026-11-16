import { describe, expect, it } from 'vitest';
import type { WasteHomePickupDTO, WastePickupQuoteResponse } from '@tubutree/shared-types';
import {
  homePickupCancelCopy,
  homePickupCancelDone,
  homePickupCreateState,
  homePickupDetailRows,
  homePickupListMeta,
  homePickupQuoteView,
  homePickupShortStatus,
  homePickupSubmitLabel,
  homePickupTimelineView,
  homePickupUnavailableText,
} from './recycle-home-pickup-view';
import { HOME_PICKUP_BATTERY_TEXT } from './waste-copy';

const quote = (over: Partial<WastePickupQuoteResponse> = {}): WastePickupQuoteResponse => ({
  shipFeeVnd: 25_000,
  estimated: false,
  estimatedPoints: 6000,
  minPoints: 5000,
  pointsAvailable: 40_000,
  pointsApplicable: 25_000,
  remainingFeeVnd: 0,
  addressOk: true,
  addressMessage: null,
  blocked: null,
  ...over,
});
const view = (q = quote(), batteryBlocked = false) => homePickupQuoteView({ quote: q, batteryBlocked });
const SHORT_SENTENCE = 'Phí shipper lấy rác cần trả bằng Điểm Xanh, bạn còn thiếu 15.000 điểm. Hãy chọn mang tới điểm thu gom hoặc đổi rác kèm đơn mua nhé';

describe('homePickupQuoteView', () => {
  it('đủ điểm: dòng trả phí nêu điểm dùng được và điểm sẽ trừ, không còn gì chặn', () => {
    const v = view();
    expect(v.feeText).toBe('25.000đ');
    expect(v.estimated).toBe(false);
    expect(v.pointsUsed).toBe(25_000);
    expect(v.remainingFeeVnd).toBe(0);
    expect(v.payLine).toBe('Điểm Xanh dùng được 40.000 · sẽ trừ 25.000 điểm');
    expect(v.pointsLine).toBe('Điểm tạm tính 6.000 điểm');
    expect(v.belowMin).toBe(false);
    expect(v.notice).toBeNull();
    expect(v.ok).toBe(true);
  });
  it('thiếu điểm: hiện đúng câu chặn của máy chủ, không trừ gì, nút tắt', () => {
    const v = view(quote({ pointsAvailable: 10_000, pointsApplicable: 10_000, remainingFeeVnd: 15_000, blocked: SHORT_SENTENCE }));
    expect(v.pointsUsed).toBe(0);
    expect(v.remainingFeeVnd).toBe(15_000);
    expect(v.payLine).toBe('Điểm Xanh dùng được 10.000');
    expect(v.notice).toBe(SHORT_SENTENCE);
    expect(v.ok).toBe(false);
  });
  it('không còn chữ thu hộ / COD / tiền mặt ở bất kỳ dòng nào', () => {
    const texts = [
      view(),
      view(quote({ pointsAvailable: 0, pointsApplicable: 0, remainingFeeVnd: 25_000, blocked: SHORT_SENTENCE })),
      view(quote({ shipFeeVnd: 0, pointsApplicable: 0 })),
      view(quote({ estimated: true })),
    ].flatMap((v) => [v.payLine, v.pointsLine, v.notice ?? '']);
    expect(texts.join(' ')).not.toMatch(/thu hộ|COD|tiền mặt|khi bưu tá|khi shipper/i);
  });
  it('không có điểm: dòng trả phí nói 0 điểm dùng được, câu chặn của máy chủ hiện', () => {
    const v = view(quote({ pointsAvailable: 0, pointsApplicable: 0, remainingFeeVnd: 25_000, blocked: SHORT_SENTENCE }));
    expect(v.payLine).toBe('Điểm Xanh dùng được 0');
    expect(v.notice).toBe(SHORT_SENTENCE);
    expect(v.ok).toBe(false);
  });
  it('phí ước lượng: đánh dấu, tắt nút, và nói thẳng chưa báo được phí', () => {
    const v = view(quote({ estimated: true }));
    expect(v.estimated).toBe(true);
    expect(v.ok).toBe(false);
    expect(v.notice).toBe('Chưa báo được phí shipper lúc này, bạn thử lại sau ít phút nhé');
  });
  it('phí ước lượng không che lý do chặn thật của máy chủ', () => {
    const v = view(quote({ estimated: true, blocked: 'Bạn đang có 3 yêu cầu chưa xong' }));
    expect(v.notice).toBe('Bạn đang có 3 yêu cầu chưa xong');
    expect(v.ok).toBe(false);
  });
  it('phí 0đ: không có điểm nào bị trừ', () => {
    const v = view(quote({ shipFeeVnd: 0, pointsApplicable: 0 }));
    expect(v.pointsUsed).toBe(0);
    expect(v.payLine).toBe('Phí ship 0đ');
    expect(v.ok).toBe(true);
  });
  it('dưới ngưỡng điểm: dòng "Điểm tạm tính X / Y điểm", chặn, và không lặp câu "cần tối thiểu" của máy chủ', () => {
    const v = view(quote({ estimatedPoints: 3000, blocked: 'Đơn shipper lấy tận nhà cần tối thiểu 5.000 điểm, bạn cần thêm 2.000 điểm nữa' }));
    expect(v.pointsLine).toBe('Điểm tạm tính 3.000 / 5.000 điểm');
    expect(v.belowMin).toBe(true);
    expect(v.ok).toBe(false);
    expect(v.notice).toBeNull();
  });
  it('lý do chặn khác của máy chủ vẫn hiện, một dòng', () => {
    const v = view(quote({ blocked: 'Bạn đang có 3 yêu cầu chưa xong, hãy hoàn tất hoặc huỷ bớt trước khi tạo thêm' }));
    expect(v.notice).toBe('Bạn đang có 3 yêu cầu chưa xong, hãy hoàn tất hoặc huỷ bớt trước khi tạo thêm');
    expect(v.ok).toBe(false);
  });
  it('địa chỉ không giao được: câu của máy chủ đứng trước mọi lý do khác', () => {
    const v = view(quote({ addressOk: false, addressMessage: 'Đơn vị vận chuyển chưa nhận diện được địa chỉ này', blocked: 'Bạn đang có 3 yêu cầu chưa xong' }), true);
    expect(v.notice).toBe('Đơn vị vận chuyển chưa nhận diện được địa chỉ này');
    expect(v.addressOk).toBe(false);
    expect(v.ok).toBe(false);
  });
  it('Pin ngoài TP.HCM: câu cố định, chặn, không lặp câu của máy chủ', () => {
    const v = view(quote({ blocked: HOME_PICKUP_BATTERY_TEXT }), true);
    expect(v.notice).toBe(HOME_PICKUP_BATTERY_TEXT);
    expect(v.ok).toBe(false);
  });
  it('dưới ngưỡng thì thiếu điểm không che lý do chặn khác', () => {
    const v = view(quote({ estimatedPoints: 100, blocked: 'Tháng này bạn chỉ còn 50 Điểm Xanh trong trần đổi rác' }));
    expect(v.notice).toBe('Tháng này bạn chỉ còn 50 Điểm Xanh trong trần đổi rác');
  });

  it('W178 thiếu điểm (NEED_FEE_PAYMENT + feePaths): 4 tổ hợp (ví đủ, ví 0đ ẩn hàng ví, ví thiếu khoá hàng, không gửi kèm được)', () => {
    const baseShort = {
      pointsAvailable: 8_000,
      pointsApplicable: 8_000,
      remainingFeeVnd: 17_000,
      cashDueVnd: 17_000,
      blocked: SHORT_SENTENCE,
      blockedCode: 'NEED_FEE_PAYMENT' as const,
    };

    const enoughWallet = view(
      quote({
        ...baseShort,
        feePaths: {
          wallet: { balance: 40_000, enough: true },
          bankTransfer: { enabled: false },
          attachNextOrder: { available: true, reason: null, existingRequestId: null },
        },
      }),
    );
    expect(enoughWallet).toMatchObject({
      needFeePayment: true,
      ok: true,
      notice: null,
      pointsUsed: 8_000,
      pointsDeductText: '−8.000 điểm',
      cashDueVnd: 17_000,
      cashDueText: '17.000đ',
    });
    expect(enoughWallet.feeOptions).toEqual({
      attachNextOrder: {
        available: true,
        subtitle: 'Miễn phí lấy rác 100%. Shipper giao đơn nhận rác. Giữ 7 ngày.',
        badge: 'Khuyên dùng',
        existingRequestId: null,
      },
      wallet: {
        title: 'Trả 17.000đ bằng Ví Tubu',
        subtitle: 'Số dư 40.000đ · Hoàn về ví nếu huỷ hoặc bưu tá không lấy được',
        enough: true,
      },
      bankTransfer: null,
    });

    const zeroWallet = view(
      quote({
        ...baseShort,
        feePaths: {
          wallet: { balance: 0, enough: false },
          bankTransfer: { enabled: true },
          attachNextOrder: { available: true, reason: null, existingRequestId: null },
        },
      }),
    );
    expect(zeroWallet.feeOptions?.wallet).toBeNull();
    expect(zeroWallet.feeOptions?.bankTransfer).toEqual({
      title: 'Chuyển khoản VietQR 17.000đ',
      subtitle: 'Hoàn về Ví Tubu nếu huỷ hoặc bưu tá không lấy được',
    });

    const shortWalletAndPendingPickup = view(
      quote({
        ...baseShort,
        feePaths: {
          wallet: { balance: 5_000, enough: false },
          bankTransfer: { enabled: false },
          attachNextOrder: { available: false, reason: 'Bạn đang có yêu cầu TR-PEND1 chờ gắn đơn', existingRequestId: 'req-pend-1' },
        },
      }),
    );
    expect(shortWalletAndPendingPickup.feeOptions?.wallet).toEqual({
      title: 'Trả 17.000đ bằng Ví Tubu',
      subtitle: 'Số dư 5.000đ, chưa đủ',
      enough: false,
    });
    expect(shortWalletAndPendingPickup.feeOptions?.attachNextOrder).toEqual({
      available: false,
      subtitle: 'Bạn đang có yêu cầu TR-PEND1 chờ gắn đơn',
      badge: null,
      existingRequestId: 'req-pend-1',
    });
  });
});

describe('homePickupCreateState', () => {
  const ready = view();
  it('thiếu địa chỉ → nhắc chọn địa chỉ', () => {
    expect(homePickupCreateState({ addressId: null, quoteState: 'idle', view: null, consentOk: true })).toEqual({ ok: false, hint: 'Chọn địa chỉ lấy rác để tạo đơn thu gom' });
  });
  it('đang tính phí / lỗi báo phí: nút khoá, câu nằm trong thẻ phí nên thanh đáy không lặp', () => {
    expect(homePickupCreateState({ addressId: 'a', quoteState: 'loading', view: null, consentOk: true })).toEqual({ ok: false, hint: null });
    expect(homePickupCreateState({ addressId: 'a', quoteState: 'error', view: null, consentOk: true })).toEqual({ ok: false, hint: null });
    expect(homePickupCreateState({ addressId: 'a', quoteState: 'idle', view: null, consentOk: true })).toEqual({ ok: false, hint: null });
  });
  it('có lý do chặn thì nút khoá, thanh đáy không lặp lý do (đã ở trong thẻ phí)', () => {
    expect(homePickupCreateState({ addressId: 'a', quoteState: 'ready', view: view(quote({ blocked: 'x' })), consentOk: true })).toEqual({ ok: false, hint: null });
  });
  it('chưa tick đồng ý → nhắc; đủ hết → bấm được', () => {
    expect(homePickupCreateState({ addressId: 'a', quoteState: 'ready', view: ready, consentOk: false })).toEqual({ ok: false, hint: 'Tick ô đồng ý ở trên để tạo đơn thu gom' });
    expect(homePickupCreateState({ addressId: 'a', quoteState: 'ready', view: ready, consentOk: true })).toEqual({ ok: true, hint: null });
  });
  it('khi thiếu điểm (needFeePayment): chưa chọn cách trả thì khoá nút và hiện "Chọn cách trả phí"; chọn Ví/VietQR hợp lệ thì mở', () => {
    const shortView = view(
      quote({
        pointsAvailable: 8_000,
        pointsApplicable: 8_000,
        remainingFeeVnd: 17_000,
        cashDueVnd: 17_000,
        blocked: SHORT_SENTENCE,
        blockedCode: 'NEED_FEE_PAYMENT',
        feePaths: {
          wallet: { balance: 40_000, enough: true },
          bankTransfer: { enabled: true },
          attachNextOrder: { available: true, reason: null, existingRequestId: null },
        },
      }),
    );
    expect(homePickupSubmitLabel(ready, null)).toBe('Tạo đơn thu gom');
    expect(homePickupSubmitLabel(shortView, null)).toBe('Chọn cách trả phí');
    expect(homePickupSubmitLabel(shortView, 'WALLET')).toBe('Trả 17.000đ từ Ví và đặt lấy rác');
    expect(homePickupSubmitLabel(shortView, 'BANK_TRANSFER')).toBe('Tạo yêu cầu và chuyển khoản');
    expect(homePickupCreateState({ addressId: 'a', quoteState: 'ready', view: shortView, consentOk: true, payment: null })).toEqual({ ok: false, hint: null });
    expect(homePickupCreateState({ addressId: 'a', quoteState: 'ready', view: shortView, consentOk: true, payment: 'WALLET' })).toEqual({ ok: true, hint: null });
    expect(homePickupCreateState({ addressId: 'a', quoteState: 'ready', view: shortView, consentOk: true, payment: 'BANK_TRANSFER' })).toEqual({ ok: true, hint: null });
  });
});

const homePickup = (over: Partial<WasteHomePickupDTO> = {}): WasteHomePickupDTO => ({
  gomdonStatus: '1',
  statusText: 'Đã tạo đơn, chờ bưu tá tới lấy rác',
  shipFeeVnd: 25_000,
  shipFeePointsUsed: 20_000,
  shipFeeCodVnd: 0,
  shipFeePointsRefunded: 0,
  shipFeeCashVnd: 0,
  shipFeeCashMethod: null,
  shipFeeCashPaid: false,
  shipFeeCashRefundedVnd: 0,
  declaredWeightGrams: 2000,
  pickupAddressText: '12 Lê Lợi, Phường Bến Nghé, Thành phố Hồ Chí Minh',
  timeline: [{ at: '2026-11-15T02:00:00.000Z', text: 'Đã tạo đơn thu gom' }],
  ...over,
});

describe('homePickupShortStatus', () => {
  const s = (status: 'OPEN' | 'IN_TRANSIT' | 'RECEIVED' | 'COMPLETED' | 'EXPIRED', g: string | null) => homePickupShortStatus({ method: 'HOME_PICKUP', status, homePickup: { gomdonStatus: g } });
  it.each([
    ['OPEN', null, 'Chờ bưu tá tới lấy rác'],
    ['OPEN', '1', 'Chờ bưu tá tới lấy rác'],
    ['OPEN', 'CREATING', 'Chờ bưu tá tới lấy rác'],
    ['OPEN', '3', 'Bưu tá đã lấy rác'],
    ['IN_TRANSIT', '3', 'Bưu tá đã lấy rác'],
    ['IN_TRANSIT', '4', 'Đang về kho Tubu'],
    ['IN_TRANSIT', '5', 'Đang về kho Tubu'],
    ['IN_TRANSIT', null, 'Đang về kho Tubu'],
    ['IN_TRANSIT', '7', 'Đã giao tới kho Tubu'],
    ['OPEN', '6', 'Tubu đang xử lý vận đơn'],
    ['OPEN', 'NEEDS_MANUAL_CHECK', 'Tubu đang xử lý vận đơn'],
    ['EXPIRED', '10', 'Bưu tá chưa lấy được rác'],
    ['RECEIVED', '7', null],
    ['COMPLETED', '7', null],
    ['EXPIRED', null, null],
  ] as const)('%s / %s → %s', (status, g, text) => {
    expect(s(status, g)).toBe(text);
  });
});

describe('homePickupDetailRows', () => {
  it('đủ dòng: địa chỉ, kg, phí, điểm đã trừ; không có dòng thu hộ', () => {
    expect(homePickupDetailRows(homePickup())).toEqual([
      { label: 'Địa chỉ lấy rác', value: '12 Lê Lợi, Phường Bến Nghé, Thành phố Hồ Chí Minh' },
      { label: 'Cân nặng ước tính', value: '2 kg' },
      { label: 'Phí shipper', value: '25.000đ' },
      { label: 'Đã trừ Điểm Xanh', value: '20.000\u00A0điểm' },
    ]);
  });
  it('thiếu địa chỉ / chưa trừ điểm thì bỏ dòng tương ứng', () => {
    const rows = homePickupDetailRows(homePickup({ shipFeePointsUsed: 0, declaredWeightGrams: 500, pickupAddressText: '' }));
    expect(rows.map((r) => r.label)).toEqual(['Cân nặng ước tính', 'Phí shipper']);
    expect(rows[0]!.value).toBe('0,5 kg');
  });
  it('đã huỷ và hoàn điểm / hoàn Ví: có dòng trả từ Ví và dòng hoàn về Ví', () => {
    const rows = homePickupDetailRows(homePickup({ shipFeePointsRefunded: 20_000 }));
    expect(rows.map((r) => r.label)).toEqual(['Địa chỉ lấy rác', 'Cân nặng ước tính', 'Phí shipper', 'Đã trừ Điểm Xanh', 'Đã hoàn Điểm Xanh']);
    expect(rows.at(-1)?.value).toBe('20.000\u00A0điểm');

    const cashRows = homePickupDetailRows(
      homePickup({
        shipFeePointsUsed: 8_000,
        shipFeePointsRefunded: 8_000,
        shipFeeCashVnd: 17_000,
        shipFeeCashMethod: 'WALLET',
        shipFeeCashPaid: true,
        shipFeeCashRefundedVnd: 17_000,
      }),
    );
    expect(cashRows.map((r) => [r.label, r.value])).toContainEqual(['Đã trả từ Ví', '17.000đ']);
    expect(cashRows.map((r) => [r.label, r.value])).toContainEqual(['Đã hoàn về Ví', '17.000đ']);
  });
});

describe('huỷ đơn thu gom', () => {
  it('hộp xác nhận nêu điểm sẽ hoàn khi đã trừ điểm', () => {
    const c = homePickupCancelCopy('TR-8K2M9', { shipFeePointsUsed: 20_000 });
    expect(c.title).toBe('Huỷ đơn thu gom?');
    expect(c.body).toBe('Bưu tá sẽ không tới lấy rác của đơn TR-8K2M9 nữa. 20.000 điểm đã trừ phí ship sẽ được hoàn lại.');
    expect(c.confirm).toBe('Xác nhận huỷ');
  });
  it('không trừ điểm thì không nhắc hoàn điểm', () => {
    expect(homePickupCancelCopy('TR-8K2M9', { shipFeePointsUsed: 0 }).body).toBe('Bưu tá sẽ không tới lấy rác của đơn TR-8K2M9 nữa.');
    expect(homePickupCancelCopy('TR-8K2M9', undefined).body).not.toMatch(/hoàn/);
  });
  it('thông báo sau khi huỷ nói số điểm và/hoặc khoản phí hoàn về Ví', () => {
    expect(homePickupCancelDone({ shipFeePointsRefunded: 20_000 })).toBe('Đã huỷ đơn thu gom, hoàn 20.000 điểm');
    expect(homePickupCancelDone({ shipFeePointsRefunded: 8_000, shipFeeCashRefundedVnd: 17_000 })).toBe(
      'Đã huỷ đơn thu gom, hoàn 8.000 điểm và 17.000đ về Ví',
    );
    expect(homePickupCancelDone({ shipFeePointsRefunded: 0, shipFeeCashRefundedVnd: 17_000 })).toBe('Đã huỷ đơn thu gom, hoàn 17.000đ về Ví');
    expect(homePickupCancelDone({ shipFeePointsRefunded: 0 })).toBe('Đã huỷ đơn thu gom');
    expect(homePickupCancelDone(undefined)).toBe('Đã huỷ đơn thu gom');
  });
});

describe('homePickupListMeta', () => {
  it('điểm đã dùng, rồi đã hoàn; phương thức khác hoặc không dùng điểm thì null', () => {
    expect(homePickupListMeta({ method: 'HOME_PICKUP', homePickup: homePickup() })).toBe('Đã dùng 20.000 điểm trừ phí ship');
    expect(homePickupListMeta({ method: 'HOME_PICKUP', homePickup: homePickup({ shipFeePointsRefunded: 20_000 }) })).toBe('Đã hoàn 20.000 điểm phí ship');
    expect(homePickupListMeta({ method: 'HOME_PICKUP', homePickup: homePickup({ shipFeePointsUsed: 0 }) })).toBeNull();
    expect(homePickupListMeta({ method: 'DROP_OFF' })).toBeNull();
    expect(homePickupListMeta({ method: 'HOME_PICKUP' })).toBeNull();
  });
});

describe('homePickupTimelineView', () => {
  const at = (h: number) => `2026-11-15T0${h}:00:00.000Z`;
  it('đang chờ bưu tá: bước 2 đang diễn ra, chỉ bước 1 có mốc', () => {
    const t = homePickupTimelineView({ method: 'HOME_PICKUP', status: 'OPEN', orderCode: null, homePickup: homePickup() });
    expect(t?.steps).toEqual(['Đã tạo đơn', 'Bưu tá lấy rác', 'Về kho Tubu', 'Cộng điểm']);
    expect(t?.current).toBe(1);
    expect(t?.hints).toEqual({ 0: { at: '2026-11-15T02:00:00.000Z', extra: null } });
  });
  it('đủ mốc: mốc nào nói thêm (kho nhận, số điểm đã cộng) thì kèm câu của máy chủ', () => {
    const t = homePickupTimelineView({
      method: 'HOME_PICKUP',
      status: 'COMPLETED',
      orderCode: null,
      homePickup: homePickup({
        timeline: [
          { at: at(1), text: 'Đã tạo đơn thu gom' },
          { at: at(2), text: 'Bưu tá đã lấy rác' },
          { at: at(3), text: 'Đang về kho Tubu' },
          { at: at(4), text: 'Kho Tubu đã nhận rác, đang kiểm đếm' },
          { at: at(5), text: 'Kho đã kiểm nhận và cộng 5.000 Điểm Xanh' },
        ],
      }),
    });
    expect(t?.current).toBe(4);
    expect(t?.hints).toEqual({
      0: { at: at(1), extra: null },
      1: { at: at(2), extra: null },
      2: { at: at(3), extra: null },
      3: { at: at(5), extra: 'Kho đã kiểm nhận và cộng 5.000 Điểm Xanh' },
    });
  });
  it('câu lạ của vận đơn trục trặc không gắn vào bước nào', () => {
    const t = homePickupTimelineView({
      method: 'HOME_PICKUP',
      status: 'OPEN',
      orderCode: null,
      homePickup: homePickup({ timeline: [{ at: at(1), text: 'Đã tạo đơn thu gom' }, { at: at(2), text: 'Đơn đang được đơn vị vận chuyển xử lý, Tubu sẽ liên hệ bạn' }] }),
    });
    expect(Object.keys(t?.hints ?? {})).toEqual(['0']);
  });
  it('phiếu đã đóng không có dải tiến độ', () => {
    for (const status of ['CANCELLED', 'EXPIRED', 'REJECTED', 'REVERSED'] as const) {
      expect(homePickupTimelineView({ method: 'HOME_PICKUP', status, orderCode: null, homePickup: homePickup() })).toBeNull();
    }
  });
});

describe('homePickupUnavailableText', () => {
  const SENTENCE = 'Chưa báo được phí shipper lúc này, bạn thử lại sau ít phút nhé';
  it('503 của web (ApiError) và của Mini App (axios) mang câu tiếng Việt thì giữ nguyên', () => {
    expect(homePickupUnavailableText(Object.assign(new Error(SENTENCE), { status: 503 }))).toBe(SENTENCE);
    expect(homePickupUnavailableText({ response: { status: 503, data: { message: SENTENCE } }, message: 'Request failed with status code 503' })).toBe(SENTENCE);
  });
  it('mảng message của Nest: lấy câu đầu', () => {
    expect(homePickupUnavailableText({ response: { status: 503, data: { message: [SENTENCE, 'khác'] } } })).toBe(SENTENCE);
  });
  it('không phải 503, câu tiếng Anh của proxy hoặc không có câu thì null để bên gọi dùng câu chung', () => {
    expect(homePickupUnavailableText(Object.assign(new Error(SENTENCE), { status: 409 }))).toBeNull();
    expect(homePickupUnavailableText(Object.assign(new Error('Service Unavailable'), { status: 503 }))).toBeNull();
    expect(homePickupUnavailableText({ response: { status: 503, data: {} } })).toBeNull();
    expect(homePickupUnavailableText(new Error(SENTENCE))).toBeNull();
    expect(homePickupUnavailableText(null)).toBeNull();
  });
});
