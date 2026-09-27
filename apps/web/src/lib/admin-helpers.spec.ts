import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiError } from './client-api';
import { memberCodeError, orderTotalError, parseVndInput, posErrorView, receiptIdError } from './loyalty-pos';
import {
  buildGomdonConfigValue,
  configValue,
  parseCheckinPoints,
  parseIntInRange,
  readGomdonForm,
  EMPTY_WAREHOUSE,
} from './admin-config-forms';
import { CLAIM_STATUS_LABEL, claimActions, rejectReasonError } from './dealer-claims';
import { PAYOUT_STATUS_LABEL, payoutActions, rejectPayoutReasonError } from './payout-admin';

describe('POS — kiểm tra input trước khi gọi API (khớp DTO BE)', () => {
  it('mã hoá đơn: bắt buộc, 3–64 ký tự, chỉ [A-Za-z0-9._-/#]', () => {
    expect(receiptIdError('')).toMatch(/Nhập mã hoá đơn/);
    expect(receiptIdError('ab')).toMatch(/3–64/);
    expect(receiptIdError('x'.repeat(65))).toMatch(/3–64/);
    expect(receiptIdError('HD 001')).toMatch(/chỉ gồm/);
    expect(receiptIdError('HD-2026/09#01_a.b')).toBeNull();
  });

  it('mã thành viên: 6–40 ký tự chữ/số/SĐT', () => {
    expect(memberCodeError('')).not.toBeNull();
    expect(memberCodeError('TUBU')).toMatch(/6–40/);
    expect(memberCodeError('TUBU<script>')).toMatch(/chỉ gồm/);
    expect(memberCodeError('TUBUABCD1234')).toBeNull();
    expect(memberCodeError('+84901234567')).toBeNull();
  });

  it('tổng tiền: nhận "1.250.000đ", tối thiểu 1.000đ', () => {
    expect(parseVndInput('1.250.000đ')).toBe(1_250_000);
    expect(parseVndInput('abc')).toBeNull();
    expect(orderTotalError(null)).not.toBeNull();
    expect(orderTotalError(999)).toMatch(/tối thiểu/);
    expect(orderTotalError(1000)).toBeNull();
  });

  it('lỗi 403 "đang tắt" → thông báo rõ cách bật loyalty.pos_credit_enabled', () => {
    const v = posErrorView(new ApiError('Tính năng tích điểm tại quầy (POS) đang tắt. Liên hệ quản trị viên.', 403));
    expect(v.kind).toBe('disabled');
    expect(v.message).toContain('loyalty.pos_credit_enabled');
  });

  it('404/409/trần ngày → hiện NGUYÊN VĂN message của BE', () => {
    expect(posErrorView(new ApiError('Không tìm thấy thành viên với mã này.', 404))).toEqual({
      kind: 'not-found',
      message: 'Không tìm thấy thành viên với mã này.',
    });
    expect(posErrorView(new ApiError('Mã này khớp nhiều hơn 1 thành viên — hãy quét mã QR…', 409)).kind).toBe('ambiguous');
    expect(posErrorView(new ApiError('Hoá đơn HD1 đã được tích điểm trước đó cho thành viên/số tiền khác.', 409)).kind).toBe(
      'duplicate-receipt',
    );
    const cap = 'Vượt trần tích điểm tại quầy trong ngày của nhân viên (đã 2990/3000 điểm). Liên hệ quản trị viên.';
    expect(posErrorView(new ApiError(cap, 400))).toEqual({ kind: 'other', message: cap });
  });
});

describe('Form cấu hình Gomdon — chỉ sửa kho + cân nặng, giữ nguyên field khác', () => {
  it('đọc giá trị hiện có; thiếu thì rỗng + 500g', () => {
    expect(readGomdonForm(null)).toEqual({ warehouse: EMPTY_WAREHOUSE, weight: '500' });
    const r = readGomdonForm({ defaultWarehouse: { name: 'Kho', phone: '0900000000' }, defaultWeightFallback: 800 });
    expect(r.warehouse.name).toBe('Kho');
    expect(r.weight).toBe('800');
  });

  it('ghi: giữ field khác (kể cả chuỗi che) và chỉ thay defaultWarehouse/defaultWeightFallback', () => {
    const wh = { name: ' Kho HCM ', phone: '0965573541', address: '1 Đường 2', ward: 'P. Long Bình', district: '', province: 'HCM' };
    const out = buildGomdonConfigValue({ phone: 'legacy', password: '••••••••', defaultWeightFallback: 500 }, wh, '700');
    expect(out.error).toBeUndefined();
    expect(out.value).toEqual({
      phone: 'legacy',
      password: '••••••••',
      defaultWarehouse: { ...wh, name: 'Kho HCM' },
      defaultWeightFallback: 700,
    });
  });

  it('thiếu trường bắt buộc / SĐT sai / cân nặng sai → báo lỗi, không tạo giá trị', () => {
    const wh = { name: 'Kho', phone: '0965573541', address: 'a', ward: 'w', district: '', province: 'p' };
    expect(buildGomdonConfigValue({}, { ...wh, name: ' ' }, '500').error).toMatch(/tên kho/i);
    expect(buildGomdonConfigValue({}, { ...wh, phone: '123' }, '500').error).toMatch(/SĐT/);
    expect(buildGomdonConfigValue({}, wh, '0').error).toMatch(/gram/);
    expect(buildGomdonConfigValue({}, wh, '12.5').error).toMatch(/gram/);
  });
});

describe('Form tích điểm', () => {
  it('check-in: đúng 7 số nguyên 0..100', () => {
    expect(parseCheckinPoints(['1', '1', '1', '1', '1', '1', '2'])).toEqual({ value: [1, 1, 1, 1, 1, 1, 2] });
    expect(parseCheckinPoints(['1', '1', '1', '1', '1', '1']).error).toBeDefined();
    expect(parseCheckinPoints(['1', '1', '1', '1', '1', '1', '101']).error).toMatch(/Ngày 7/);
    expect(parseCheckinPoints(['1', '', '1', '1', '1', '1', '1']).error).toMatch(/Ngày 2/);
    expect(parseCheckinPoints(['1', '1.5', '1', '1', '1', '1', '1']).error).toMatch(/Ngày 2/);
  });

  it('trần POS: số nguyên trong biên, nhận dấu chấm nghìn', () => {
    expect(parseIntInRange('5.000.000', 1000, 1_000_000_000, 'Trần hoá đơn')).toEqual({ value: 5_000_000 });
    expect(parseIntInRange('0', 1, 10, 'X').error).toMatch(/X/);
    expect(parseIntInRange('', 1, 10, 'X').error).toBeDefined();
  });

  it('configValue lấy giá trị theo khoá, thiếu thì mặc định', () => {
    const rows = [{ key: 'loyalty.pos_credit_enabled', value: true, description: null, category: 'loyalty' }];
    expect(configValue(rows, 'loyalty.pos_credit_enabled', false)).toBe(true);
    expect(configValue(rows, 'loyalty.pos_max_order_total', 5_000_000)).toBe(5_000_000);
  });
});

describe('Yêu cầu nhận thưởng đại lý', () => {
  it('nhãn tiếng Việt đúng yêu cầu', () => {
    expect(CLAIM_STATUS_LABEL).toEqual({
      PENDING: 'Đang chờ duyệt',
      APPROVED: 'Đã duyệt, chờ trao thưởng',
      REJECTED: 'Bị từ chối',
      PAID: 'Đã trao thưởng',
    });
  });

  it('thao tác theo trạng thái: PENDING duyệt/từ chối; APPROVED đánh dấu đã trao; còn lại không', () => {
    expect(claimActions('PENDING')).toEqual({ approve: true, reject: true, markPaid: false });
    expect(claimActions('APPROVED')).toEqual({ approve: false, reject: false, markPaid: true });
    expect(claimActions('PAID')).toEqual({ approve: false, reject: false, markPaid: false });
    expect(claimActions('REJECTED')).toEqual({ approve: false, reject: false, markPaid: false });
  });

  it('lý do từ chối bắt buộc, tối đa 500 ký tự', () => {
    expect(rejectReasonError('  ')).not.toBeNull();
    expect(rejectReasonError('x'.repeat(501))).toMatch(/500/);
    expect(rejectReasonError('Doanh số đã chốt chưa đủ mốc')).toBeNull();
  });
});

// P0 A5-08=A6-05: hàng đợi xử lý Payout (rút hoa hồng CTV / Ví Tubu về ngân hàng).
describe('Duyệt yêu cầu rút tiền (Payout)', () => {
  it('nhãn tiếng Việt đúng yêu cầu', () => {
    expect(PAYOUT_STATUS_LABEL).toEqual({
      REQUESTED: 'Đang chờ duyệt',
      APPROVED: 'Đã duyệt, chờ chuyển khoản',
      PAID: 'Đã chuyển khoản',
      REJECTED: 'Bị từ chối (đã hoàn)',
    });
  });

  it('thao tác theo trạng thái: REQUESTED duyệt/từ chối; APPROVED đánh dấu đã chuyển khoản; còn lại không', () => {
    expect(payoutActions('REQUESTED')).toEqual({ approve: true, reject: true, markPaid: false });
    expect(payoutActions('APPROVED')).toEqual({ approve: false, reject: false, markPaid: true });
    expect(payoutActions('PAID')).toEqual({ approve: false, reject: false, markPaid: false });
    expect(payoutActions('REJECTED')).toEqual({ approve: false, reject: false, markPaid: false });
  });

  it('lý do từ chối bắt buộc, tối đa 500 ký tự', () => {
    expect(rejectPayoutReasonError('  ')).not.toBeNull();
    expect(rejectPayoutReasonError('x'.repeat(501))).toMatch(/500/);
    expect(rejectPayoutReasonError('Sai số tài khoản')).toBeNull();
  });
});

describe('admin-client — endpoint mới gọi đúng đường dẫn/body', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(json: unknown) {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => json });
    vi.stubGlobal('fetch', f);
    return f;
  }

  it('listOrders gửi recycling=attention; countRecyclingAttention đọc meta.total', async () => {
    const { listOrders, countRecyclingAttention } = await import('./admin-client');
    const f = stubFetch({ data: [], meta: { page: 1, limit: 1, total: 7 } });
    await listOrders(1, undefined, undefined, 'attention');
    expect(f.mock.calls[0]![0]).toContain('/admin/orders?page=1&limit=20&recycling=attention');
    await expect(countRecyclingAttention()).resolves.toBe(7);
    expect(f.mock.calls[1]![0]).toContain('limit=1&recycling=attention');
  });

  it('retryGomdon chỉ gửi confirmedNoWaybill khi đã tick; cancel-waybill POST', async () => {
    const { retryGomdon, cancelGomdonWaybill } = await import('./admin-client');
    const f = stubFetch({ message: 'ok' });
    await retryGomdon('o1', true);
    expect(f.mock.calls[0]![0]).toContain('/admin/orders/o1/gomdon/retry');
    expect(f.mock.calls[0]![1]).toEqual(expect.objectContaining({ method: 'POST', body: JSON.stringify({ confirmedNoWaybill: true }) }));
    await retryGomdon('o1', false);
    expect(f.mock.calls[1]![1]).toEqual(expect.objectContaining({ body: '{}' }));
    await cancelGomdonWaybill('o1');
    expect(f.mock.calls[2]![0]).toContain('/admin/orders/o1/gomdon/cancel-waybill');
    expect(f.mock.calls[2]![1]).toEqual(expect.objectContaining({ method: 'POST' }));
  });

  it('markGomdonHandled (chuyển từ recycling-panel sang admin-client): trim + cắt 500 ký tự, rỗng → body {}', async () => {
    const { markGomdonHandled } = await import('./admin-client');
    const f = stubFetch({ result: 'MANUAL_HANDLED', message: 'ok' });
    await markGomdonHandled('o 1', '  đã tạo vận đơn GHN tay  ');
    expect(f.mock.calls[0]![0]).toContain('/admin/orders/o%201/gomdon/mark-handled');
    expect(f.mock.calls[0]![1]).toEqual(expect.objectContaining({ method: 'POST', body: JSON.stringify({ note: 'đã tạo vận đơn GHN tay' }) }));
    await markGomdonHandled('o1', '   ');
    expect(f.mock.calls[1]![1]).toEqual(expect.objectContaining({ body: '{}' }));
    await markGomdonHandled('o1', 'x'.repeat(600));
    expect(JSON.parse(f.mock.calls[2]![1].body as string).note).toHaveLength(500);
  });

  it('confirmDealerOrderPayment: POST /admin/dealer-orders/:id/confirm-payment, chỉ gửi trường có nội dung (đã trim, cắt theo MaxLength DTO)', async () => {
    const { confirmDealerOrderPayment } = await import('./admin-client');
    const f = stubFetch({ ok: true, alreadyPaid: false, message: 'Đã xác nhận thanh toán đơn TB-1.', order: {} });
    await confirmDealerOrderPayment('o1', { bankRef: ' FT2627 ', note: ' đã đối soát sao kê ' });
    expect(f.mock.calls[0]![0]).toContain('/admin/dealer-orders/o1/confirm-payment');
    expect(f.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ bankRef: 'FT2627', note: 'đã đối soát sao kê' }) }),
    );
    await confirmDealerOrderPayment('o1', { bankRef: '  ', note: '' });
    expect(f.mock.calls[1]![1]).toEqual(expect.objectContaining({ body: '{}' }));
    await confirmDealerOrderPayment('o1', { bankRef: 'B'.repeat(150), note: 'n'.repeat(700) });
    const body = JSON.parse(f.mock.calls[2]![1].body as string);
    expect(body.bankRef).toHaveLength(100);
    expect(body.note).toHaveLength(500);
  });

  it('dealer reward claims: list/approve/reject/mark-paid', async () => {
    const m = await import('./admin-client');
    const f = stubFetch({ data: [], meta: { page: 1, limit: 20, total: 0 } });
    await m.listDealerRewardClaims('PENDING', 2);
    expect(f.mock.calls[0]![0]).toContain('/admin/dealer-reward-claims?page=2&limit=20&status=PENDING');
    await m.approveDealerRewardClaim('c1', ' ok ');
    expect(f.mock.calls[1]![0]).toContain('/admin/dealer-reward-claims/c1/approve');
    expect(f.mock.calls[1]![1]).toEqual(expect.objectContaining({ body: JSON.stringify({ note: 'ok' }) }));
    await m.rejectDealerRewardClaim('c1', ' thiếu doanh số ');
    expect(f.mock.calls[2]![1]).toEqual(expect.objectContaining({ body: JSON.stringify({ reason: 'thiếu doanh số' }) }));
    await m.markDealerRewardClaimPaid('c1');
    expect(f.mock.calls[3]![0]).toContain('/mark-paid');
    expect(f.mock.calls[3]![1]).toEqual(expect.objectContaining({ body: '{}' }));
  });

  it('payouts (P0 A5-08=A6-05): list/approve/reject/mark-paid gọi đúng đường dẫn/body', async () => {
    const m = await import('./admin-client');
    const f = stubFetch({ data: [], meta: { page: 1, limit: 20, total: 0 } });
    await m.listPayouts('REQUESTED', 2);
    expect(f.mock.calls[0]![0]).toContain('/admin/payouts?page=2&limit=20&status=REQUESTED');
    await m.approvePayout('p1', ' ok ');
    expect(f.mock.calls[1]![0]).toContain('/admin/payouts/p1/approve');
    expect(f.mock.calls[1]![1]).toEqual(expect.objectContaining({ method: 'POST', body: JSON.stringify({ note: 'ok' }) }));
    await m.rejectPayout('p1', ' sai STK ');
    expect(f.mock.calls[2]![0]).toContain('/admin/payouts/p1/reject');
    expect(f.mock.calls[2]![1]).toEqual(expect.objectContaining({ body: JSON.stringify({ reason: 'sai STK' }) }));
    await m.markPayoutPaid('p1', ' FT2627 ', ' đã đối soát ');
    expect(f.mock.calls[3]![0]).toContain('/admin/payouts/p1/mark-paid');
    expect(f.mock.calls[3]![1]).toEqual(
      expect.objectContaining({ body: JSON.stringify({ bankRef: 'FT2627', note: 'đã đối soát' }) }),
    );
    await m.markPayoutPaid('p1');
    expect(f.mock.calls[4]![1]).toEqual(expect.objectContaining({ body: '{}' }));
  });

  it('listPendingMerchantProducts (P0 A6-07): gọi kèm page/limit, chuẩn hoá {data,meta} lẫn mảng trần cũ về Page<T>', async () => {
    const m = await import('./admin-client');
    let f = stubFetch({ data: [{ id: 'p1' }], meta: { page: 1, limit: 100, total: 1 } });
    await expect(m.listPendingMerchantProducts()).resolves.toEqual({
      data: [{ id: 'p1' }],
      meta: { page: 1, limit: 100, total: 1 },
    });
    expect(f.mock.calls[0]![0]).toContain('/admin/merchant-products/pending?page=1&limit=100');

    // BE cũ (hoặc bản build khác) trả mảng trần — vẫn phải ra Page<T> hợp lệ, không .map thẳng lên mảng lỗi kiểu.
    f = stubFetch([{ id: 'p2' }]);
    await expect(m.listPendingMerchantProducts(1, 100)).resolves.toEqual({
      data: [{ id: 'p2' }],
      meta: { page: 1, limit: 100, total: 1 },
    });
  });

  it('POS: scan-member, pos-credit, sổ pos-credits có lọc', async () => {
    const m = await import('./admin-client');
    const f = stubFetch([]);
    await m.scanMember('TUBUABCD1234');
    expect(f.mock.calls[0]![0]).toContain('/loyalty/staff/scan-member');
    await m.posCredit({ memberCode: 'TUBUABCD1234', orderTotal: 250000, receiptId: 'HD-1' });
    expect(f.mock.calls[1]![1]).toEqual(
      expect.objectContaining({ body: JSON.stringify({ memberCode: 'TUBUABCD1234', orderTotal: 250000, receiptId: 'HD-1' }) }),
    );
    await m.listPosCredits({ day: '2026-09-27', staffUserId: ' s1 ' });
    expect(f.mock.calls[2]![0]).toContain('/admin/loyalty/pos-credits?day=2026-09-27&staffUserId=s1');
  });

  it('hồ sơ đại lý / đổi trả: GIỮ meta phân trang (trước đây unwrapList bỏ meta → cắt cụt im lặng)', async () => {
    const m = await import('./admin-client');
    let f = stubFetch({ data: [{ id: 'd1' }], meta: { page: 2, limit: 100, total: 180 } });
    await expect(m.listDealerApps('PENDING', 2)).resolves.toEqual({
      data: [{ id: 'd1' }],
      meta: { page: 2, limit: 100, total: 180 },
    });
    expect(f.mock.calls[0]![0]).toContain('/admin/dealer-applications?page=2&limit=100&status=PENDING');
    f = stubFetch({ data: [{ id: 'r1' }], meta: { page: 1, limit: 100, total: 1 } });
    await expect(m.listReturnRequests('REQUESTED')).resolves.toEqual({
      data: [{ id: 'r1' }],
      meta: { page: 1, limit: 100, total: 1 },
    });
    expect(f.mock.calls[0]![0]).toContain('/admin/return-requests?page=1&limit=100&status=REQUESTED');
  });

  it('BE cũ trả mảng trần → vẫn thành Page (total = số dòng, không còn trang sau)', async () => {
    const m = await import('./admin-client');
    stubFetch([{ id: 'd1' }, { id: 'd2' }]);
    await expect(m.listDealerApps()).resolves.toEqual({
      data: [{ id: 'd1' }, { id: 'd2' }],
      meta: { page: 1, limit: 100, total: 2 },
    });
    expect(m.asPage(null, 1, 20)).toEqual({ data: [], meta: { page: 1, limit: 20, total: 0 } });
  });
});

describe('Hàng đợi chờ duyệt (hồ sơ đại lý / đổi trả) — "Tải thêm" + cũ nhất lên đầu', () => {
  const row = (id: string, createdAt: string) => ({ id, createdAt });
  const page = <T,>(data: T[], p: number, limit: number, total: number) => ({ data, meta: { page: p, limit, total } });

  it('nextPageParam: còn dòng chưa tải → trang kế; hết → undefined', async () => {
    const { nextPageParam } = await import('./admin-client');
    expect(nextPageParam({ page: 1, limit: 100, total: 101 })).toBe(2);
    expect(nextPageParam({ page: 2, limit: 100, total: 200 })).toBeUndefined();
    expect(nextPageParam({ page: 1, limit: 100, total: 0 })).toBeUndefined();
  });

  it('gộp các trang đã tải, bỏ trùng id (offset lệch khi đơn vừa được duyệt), hàng chờ xếp CŨ NHẤT trước', async () => {
    const { mergeQueuePages } = await import('./admin-client');
    // API xếp mới nhất trước (createdAt desc) — trang 2 là các hồ sơ cũ hơn.
    const pages = [
      page([row('c', '2026-09-25T00:00:00Z'), row('b', '2026-09-20T00:00:00Z')], 1, 2, 5),
      page([row('b', '2026-09-20T00:00:00Z'), row('a', '2026-09-01T00:00:00Z')], 2, 2, 5),
    ];
    const v = mergeQueuePages(pages, true);
    expect(v.items.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(v.total).toBe(5);
    expect(v.hasMore).toBe(true);
    expect(v.label).toBe('Hiển thị 3/5');
  });

  it('không phải hàng chờ (Đã duyệt / Tất cả) → giữ thứ tự API (mới nhất trước)', async () => {
    const { mergeQueuePages } = await import('./admin-client');
    const v = mergeQueuePages([page([row('c', '2026-09-25T00:00:00Z'), row('a', '2026-09-01T00:00:00Z')], 1, 100, 2)], false);
    expect(v.items.map((r) => r.id)).toEqual(['c', 'a']);
    expect(v.hasMore).toBe(false);
    expect(v.label).toBe('Hiển thị 2/2');
  });

  it('chưa có dữ liệu → rỗng', async () => {
    const { mergeQueuePages } = await import('./admin-client');
    expect(mergeQueuePages(undefined, true)).toEqual({ items: [], total: 0, hasMore: false, label: 'Hiển thị 0/0' });
  });
});

describe('vnDayKey — ngày theo giờ Việt Nam (khớp dayKey của sổ POS)', () => {
  it('23:30 UTC ngày 26/9 = 06:30 sáng 27/9 giờ VN', async () => {
    const { vnDayKey } = await import('./loyalty-pos');
    expect(vnDayKey(new Date('2026-09-26T23:30:00Z'))).toBe('2026-09-27');
    expect(vnDayKey(new Date('2026-09-26T16:59:00Z'))).toBe('2026-09-26');
  });
});
