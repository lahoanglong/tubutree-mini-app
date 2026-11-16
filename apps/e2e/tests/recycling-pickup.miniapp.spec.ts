import type { CheckoutPickupQuote, PickupOptionItem, PickupOptionsResponse, WastePickupQuoteResponse } from '@tubutree/shared-types';
import { test, expect, makeOrder, mockSession, makeUser, publicConfig, reply } from './support/mock-api';
import type { MockApi } from './support/mock-api';
import { CHECKOUT_ADDRESS, CHECKOUT_QUOTE, mockCheckout } from './support/checkout-mocks';
import { mockWasteCustomer, wasteDetail, wastePoint } from './support/waste-mocks';

/**
 * Zalo Mini App E2E — Đổi rác kèm đơn (thu rác gắn vào đơn đổi hàng).
 *
 * UI dưới test:
 *   - apps/miniapp/src/components/checkout/pickup-section.tsx: MỘT thẻ "♻️ Đổi rác kèm đơn" (data-testid=checkout-pickup)
 *     gồm một hàng chữ + công tắc role=checkbox; bật công tắc hoặc bấm hàng mở tấm chọn món/kg với đúng một nút "Xong".
 *     Thẻ chỉ hiện khi `quote.pickup.gateOpen`; cờ `waste.pickup` ở /config/public và GET /waste/me không còn quyết định thẻ.
 *   - Phiếu PICKUP đang mở của khách (`existingRequest` ở GET /checkout/pickup-options) được chọn sẵn trong tấm;
 *     "Đổi món" hoặc chưa có phiếu thì khách chọn món + kg ngay trong tấm (không còn dòng dẫn sang /recycle/new).
 *   - Thân báo giá và POST /checkout/place-order mang `wasteRequestId` HOẶC `inlinePickup`, kèm `returnWeightGrams`.
 *   - apps/miniapp/src/pages/order-detail.tsx: dòng "Yêu cầu thu rác TR-…" dẫn tới trang theo dõi yêu cầu.
 *
 * Báo giá do spec tự trả (checkoutQuote nhận lựa chọn rồi báo miễn phí giao), vì thẻ đọc `pickup` từ báo giá chứ không từ cờ cấu hình.
 */

const PICKUP = wasteDetail({
  id: 'wr-pk-1',
  code: 'TR-PK9MV',
  method: 'PICKUP',
  status: 'OPEN',
  pointName: 'Kho Tubu TP.HCM',
  expiresAt: '2026-10-24T03:00:00.000Z',
});

const PLACE_BTN = /Đặt hàng · [\d.]+đ/;
const CARD_TITLE = '♻️ Đổi rác kèm đơn';
const CARD_ROW = `${CARD_TITLE} — Miễn 100% phí vận chuyển`;
const PICKUP_FIELDS = ['wasteRequestId', 'inlinePickup', 'returnWeightGrams', 'excludeGiftRedemptionIds'] as const;

// Giỏ mock nặng 2 × 600g = 1,2 kg nên trần gửi lại là 1.200g: chip 0,5 kg và 1 kg.
const GATE_OPEN: CheckoutPickupQuote = {
  gateOpen: true,
  eligible: false,
  reason: null,
  mode: null,
  estimatedPoints: 0,
  minPoints: 3000,
  freeShip: false,
  shippingFeeWaived: 0,
  orderWeightGrams: 1200,
  maxReturnWeightGrams: 1200,
  returnWeightGrams: null,
};

const CARTON: PickupOptionItem = {
  id: 'wi-carton',
  code: 'CARTON',
  name: 'Thùng carton cũ',
  unitLabel: 'thùng',
  unitsPerPoint: 1,
  pointsPerGroup: 1000,
  hazardous: false,
  blockedReason: null,
  prepInstructions: null,
};
const BATTERY: PickupOptionItem = {
  id: 'wi-battery',
  code: 'BATTERY',
  name: 'Pin đã dùng',
  unitLabel: 'viên',
  unitsPerPoint: 1,
  pointsPerGroup: 500,
  hazardous: true,
  blockedReason: 'BATTERY_OUT_OF_HCM',
  prepInstructions: null,
};

const OPTIONS: PickupOptionsResponse = {
  gateOpen: true,
  minPoints: 3000,
  orderWeightGrams: 1200,
  maxReturnWeightGrams: 1200,
  items: [BATTERY, CARTON],
  existingRequest: null,
};
const OPTIONS_WITH_REQUEST: PickupOptionsResponse = {
  ...OPTIONS,
  existingRequest: {
    id: 'wr-pk-1',
    code: 'TR-PK9MV',
    estimatedPoints: 3000,
    lines: [{ itemId: 'wi-carton', itemName: 'Thùng carton cũ', unitLabel: 'thùng', declaredQty: 3 }],
  },
};

interface SetupOpts {
  /** `pickup` của báo giá khi khách chưa chọn gì; null = máy chủ không trả phần thu rác. */
  gate?: CheckoutPickupQuote | null;
  options?: PickupOptionsResponse;
}

function setup(api: MockApi, { gate = GATE_OPEN, options = OPTIONS_WITH_REQUEST }: SetupOpts = {}): void {
  mockSession(api, makeUser({ id: 'user-checkout' }));
  mockCheckout(api);
  // Chọn đủ điều kiện thì máy chủ miễn phí giao 19.000đ, như checkout.service.ts.
  api.post('/checkout/quote', ({ call }) => {
    const body = (call.body ?? {}) as Record<string, unknown>;
    const chosen = !!(body.wasteRequestId || body.inlinePickup) && gate?.gateOpen === true && gate.reason === null;
    if (!chosen) return { ...CHECKOUT_QUOTE, pickup: gate };
    return {
      ...CHECKOUT_QUOTE,
      shippingFee: 0,
      total: CHECKOUT_QUOTE.total - CHECKOUT_QUOTE.shippingFee,
      shippingFeeWaived: CHECKOUT_QUOTE.shippingFee,
      shippingFeeWaivedReason: 'RECYCLE_PICKUP',
      pickup: {
        ...gate,
        mode: body.wasteRequestId ? 'REQUEST' : 'INLINE',
        eligible: true,
        freeShip: true,
        shippingFeeWaived: CHECKOUT_QUOTE.shippingFee,
        estimatedPoints: 3000,
        returnWeightGrams: body.returnWeightGrams ?? null,
      },
    };
  });
  api.get('/checkout/pickup-options', options);
  // Màn thanh toán gửi sự kiện phân tích theo lô; test chạy đủ lâu thì lô được đẩy đi.
  api.post('/events', { accepted: 1 });
}

test.describe('Checkout — Đổi rác kèm đơn', () => {
  test('cổng thu kèm mở: một thẻ Đổi rác kèm đơn với công tắc tắt, danh sách món chưa tải; không còn mục Thu kèm rác cũ', async ({ page, api }) => {
    setup(api);
    await page.goto('/checkout');
    await expect(page.getByRole('button', { name: PLACE_BTN })).toBeEnabled({ timeout: 15_000 });

    const card = page.getByTestId('checkout-pickup');
    await expect(card).toBeVisible();
    await expect(card.getByText(CARD_TITLE, { exact: true })).toBeVisible();
    await expect(card.getByText('Miễn 100% phí vận chuyển')).toBeVisible();
    await expect(card.getByText('-19.000đ phí giao')).toBeVisible();
    await expect(card.getByRole('checkbox', { name: CARD_TITLE })).not.toBeChecked();
    await expect(page.getByText(CARD_TITLE, { exact: true })).toHaveCount(1);
    await expect(page.getByText('Thu kèm rác', { exact: true })).toHaveCount(0);
    await expect(page.locator('#checkout-waste-pickup')).toHaveCount(0);
    expect(api.callsTo('GET', '/checkout/pickup-options')).toHaveLength(0);
  });

  test('phiếu thu kèm đang mở được chọn sẵn trong tấm; chọn kg rồi Xong thì đơn mang wasteRequestId + returnWeightGrams', async ({ page, api }) => {
    setup(api);
    await page.goto('/checkout');
    await expect(page.getByRole('button', { name: PLACE_BTN })).toBeEnabled({ timeout: 15_000 });

    await page.getByRole('button', { name: CARD_ROW }).click();
    const sheet = page.getByTestId('checkout-pickup-sheet');
    await expect(sheet.getByText('Phiếu TR-PK9MV · Thùng carton cũ ×3 · 3.000 điểm')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Đổi món' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Tăng số lượng Thùng carton cũ' })).toHaveCount(0);

    await page.getByRole('button', { name: '1 kg', exact: true }).click();
    await page.getByRole('button', { name: 'Xong', exact: true }).click();
    await expect(page.getByTestId('checkout-pickup-sheet')).toHaveCount(0);
    await expect(page.getByText('Gửi lại ~1 kg · +3.000 điểm sau khi kho nhận')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: CARD_TITLE })).toBeChecked();
    const placeBtn = page.getByRole('button', { name: 'Đặt hàng · 130.000đ' });
    await expect(placeBtn).toBeEnabled();

    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeBtn.click();
    const call = await placed;
    expect(call.body).toMatchObject({ wasteRequestId: 'wr-pk-1', returnWeightGrams: 1000 });
    expect(call.body).not.toHaveProperty('inlinePickup');
    expect(call.body).not.toHaveProperty('hasRecyclingPickup');
    expect(call.body).not.toHaveProperty('recyclingNote');
  });

  test('chưa có phiếu: chọn món + kg ngay trong tấm; Xong chỉ bấm được khi đủ điểm, đơn mang inlinePickup + returnWeightGrams', async ({ page, api }) => {
    setup(api, { options: OPTIONS });
    await page.goto('/checkout');
    await expect(page.getByRole('button', { name: PLACE_BTN })).toBeEnabled({ timeout: 15_000 });

    await page.getByRole('button', { name: CARD_ROW }).click();
    const sheet = page.getByTestId('checkout-pickup-sheet');
    await expect(sheet.getByText('1 thùng = 1.000 điểm')).toBeVisible();
    await expect(sheet.getByText(/Pin cũ cần xử lý an toàn riêng/)).toHaveCount(1);
    const done = page.getByRole('button', { name: 'Xong', exact: true });
    await expect(page.getByText('Chọn ít nhất một món rác')).toBeVisible();
    await expect(done).toBeDisabled();

    const plus = sheet.getByRole('button', { name: 'Tăng số lượng Thùng carton cũ' });
    for (let i = 0; i < 3; i++) await plus.click();
    await expect(sheet.getByRole('progressbar', { name: 'Dự kiến 3.000 / 3.000 điểm' })).toBeVisible();
    await expect(done).toBeEnabled();
    await page.getByRole('button', { name: '1 kg', exact: true }).click();
    await done.click();

    await expect(page.getByText('Gửi lại ~1 kg · +3.000 điểm sau khi kho nhận')).toBeVisible();
    const placeBtn = page.getByRole('button', { name: 'Đặt hàng · 130.000đ' });
    await expect(placeBtn).toBeEnabled();
    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeBtn.click();
    const call = await placed;
    expect(call.body).toMatchObject({ inlinePickup: { lines: [{ itemId: 'wi-carton', qty: 3 }] }, returnWeightGrams: 1000 });
    expect(call.body).not.toHaveProperty('wasteRequestId');
  });

  test('công tắc mặc định tắt: đơn không có trường thu rác', async ({ page, api }) => {
    setup(api);
    await page.goto('/checkout');
    const placeBtn = page.getByRole('button', { name: PLACE_BTN });
    await expect(placeBtn).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByRole('checkbox', { name: CARD_TITLE })).toBeVisible();

    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeBtn.click();
    const call = await placed;
    for (const k of PICKUP_FIELDS) expect(call.body).not.toHaveProperty(k);
  });

  for (const [name, gate] of [
    ['báo giá không có phần thu rác', null],
    ['cổng thu kèm đóng', { ...GATE_OPEN, gateOpen: false, reason: 'Thu kèm rác hiện chưa mở, bạn tắt công tắc hoặc tải lại trang nhé.' }],
  ] as const) {
    test(`${name}: không có thẻ, đơn không có trường thu rác`, async ({ page, api }) => {
      setup(api, { gate });
      await page.goto('/checkout');
      const placeBtn = page.getByRole('button', { name: PLACE_BTN });
      await expect(placeBtn).toBeEnabled({ timeout: 15_000 });
      await expect(page.getByTestId('checkout-pickup')).toHaveCount(0);
      await expect(page.getByText(CARD_TITLE, { exact: true })).toHaveCount(0);
      expect(api.callsTo('GET', '/checkout/pickup-options')).toHaveLength(0);

      const placed = api.waitForCall('POST', '/checkout/place-order');
      await placeBtn.click();
      const call = await placed;
      for (const k of PICKUP_FIELDS) expect(call.body).not.toHaveProperty(k);
    });
  }

  test('khách bị khoá gửi rác: thẻ chỉ đọc kèm lý do của máy chủ, công tắc khoá, bấm không mở tấm', async ({ page, api }) => {
    const reason = 'Thu kèm rác đang tạm dừng với tài khoản của bạn, hãy tắt công tắc để đặt đơn';
    setup(api, { gate: { ...GATE_OPEN, reason } });
    await page.goto('/checkout');
    const placeBtn = page.getByRole('button', { name: PLACE_BTN });
    await expect(placeBtn).toBeEnabled({ timeout: 15_000 });

    const card = page.getByTestId('checkout-pickup');
    await expect(card.getByText(reason)).toBeVisible();
    await expect(card.getByRole('checkbox', { name: CARD_TITLE })).toBeDisabled();
    // Hàng chỉ đọc (aria-disabled) nên Playwright coi là không bấm được; ép bấm để chứng minh bấm không mở tấm.
    await card.getByRole('button', { name: `${CARD_TITLE} — ${reason}` }).click({ force: true });
    await expect(page.getByTestId('checkout-pickup-sheet')).toHaveCount(0);
    expect(api.callsTo('GET', '/checkout/pickup-options')).toHaveLength(0);

    const placed = api.waitForCall('POST', '/checkout/place-order');
    await placeBtn.click();
    const call = await placed;
    for (const k of PICKUP_FIELDS) expect(call.body).not.toHaveProperty(k);
  });

  test('server báo phiếu thu rác đã hết hạn (409): hiện câu cập nhật của Tubu, tải lại danh sách món, không sang màn đơn thành công', async ({ page, api }) => {
    setup(api);
    api.post('/checkout/place-order', () => reply(409, { statusCode: 409, message: 'Yêu cầu thu rác đã hết hạn hoặc đã huỷ' }));
    await page.goto('/checkout');
    await expect(page.getByRole('button', { name: PLACE_BTN })).toBeEnabled({ timeout: 15_000 });

    await page.getByRole('button', { name: CARD_ROW }).click();
    await page.getByRole('button', { name: 'Xong', exact: true }).click();
    const placeBtn = page.getByRole('button', { name: 'Đặt hàng · 130.000đ' });
    await expect(placeBtn).toBeEnabled();
    const optionCalls = api.callsTo('GET', '/checkout/pickup-options').length;
    await placeBtn.click();
    // 409 không mã kèm câu "thu rác": màn tự tải lại báo giá + danh sách món và báo bằng câu của Tubu thay cho câu thô của máy chủ.
    await expect(page.getByText('Phần đổi rác kèm đơn vừa thay đổi, Tubu đã cập nhật lại giá')).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => api.callsTo('GET', '/checkout/pickup-options').length).toBeGreaterThan(optionCalls);
    await expect(page.getByText('Cảm ơn bạn đã chọn Tubu')).not.toBeVisible();
  });
});

test.describe('Chi tiết đơn — yêu cầu thu rác gắn kèm', () => {
  test.beforeEach(async ({ api }) => {
    mockSession(api, makeUser({ id: 'user-recycle' }));
    api.get('/orders/me/returns', []);
  });

  test('chi tiết đơn có yêu cầu gắn kèm: dòng dẫn tới trang theo dõi yêu cầu', async ({ page, api }) => {
    api.get('/orders/:code', makeOrder({ code: 'TUBU-PK-1', id: 'ord-pk-1', status: 'CONFIRMED', hasRecyclingPickup: true }));
    api.get('/waste/requests/by-order/:orderId', { ...PICKUP, orderId: 'ord-pk-1', orderCode: 'TUBU-PK-1' });
    await page.goto('/order/TUBU-PK-1');
    await page.getByRole('button', { name: /Yêu cầu thu rác TR-PK9MV/ }).click();
    await expect(page).toHaveURL(/\/recycle\/r\/wr-pk-1/);
  });

  test('chi tiết đơn không gắn yêu cầu: không có dòng thu kèm', async ({ page, api }) => {
    api.get('/orders/:code', makeOrder({ code: 'TUBU-PK-2', id: 'ord-pk-2', status: 'CONFIRMED', hasRecyclingPickup: true }));
    api.get('/waste/requests/by-order/:orderId', () => reply(404, { statusCode: 404, message: 'Không tìm thấy mã' }));
    await page.goto('/order/TUBU-PK-2');
    await expect(page.getByText('Đã xác nhận').first()).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => api.callsTo('GET', '/waste/requests/by-order/:orderId').length).toBeGreaterThan(0);
    await expect(page.getByText(/Yêu cầu thu rác/)).toHaveCount(0);
    await expect(page.getByText(/Không tìm thấy mã/)).toHaveCount(0);
  });
});

test.describe('W178 — Shipper lấy tận nhà khi thiếu Điểm Xanh', () => {
  test('thiếu Điểm Xanh: 1 chạm chuyển sang Gửi kèm đơn mua (PICKUP) giữ nguyên món, và trả phần thiếu bằng Ví Tubu', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    mockSession(api, makeUser({ id: 'user-w178' }));
    const createdHome = wasteDetail({
      id: 'wr-hp-1',
      code: 'TR-HP178',
      method: 'HOME_PICKUP',
      status: 'OPEN',
      pointName: 'Kho Tubu TP.HCM',
      homePickup: {
        gomdonStatus: '1',
        statusText: 'Đã tạo đơn, chờ bưu tá tới lấy rác',
        shipFeeVnd: 25_000,
        shipFeePointsUsed: 8_000,
        shipFeeCodVnd: 0,
        shipFeePointsRefunded: 0,
        shipFeeCashVnd: 17_000,
        shipFeeCashMethod: 'WALLET',
        shipFeeCashPaid: true,
        shipFeeCashRefundedVnd: 0,
        declaredWeightGrams: 2000,
        pickupAddressText: '123 Lê Lợi, Phường Sài Gòn, TP. Hồ Chí Minh',
        timeline: [{ at: '2026-11-16T03:00:00.000Z', text: 'Đã tạo đơn thu gom' }],
      },
    });
    mockWasteCustomer(api, {
      me: {
        laneFlags: { dropoff: true, mailin: true, pickup: true },
        balance: { pointsBalance: 8_000, pointsConvertedBalance: 0, redeemablePoints: 8_000 },
      },
      points: [wastePoint({ id: 'wp-q1' })],
      requests: [createdHome],
    });
    api.get('/config/public', publicConfig({ waste: { enabled: true, dropoff: true, mailin: true, pickup: true } }));
    api.get('/me/addresses', [CHECKOUT_ADDRESS]);
    api.post('/events', { accepted: 1 });
    const quote: WastePickupQuoteResponse = {
      shipFeeVnd: 25_000,
      estimated: false,
      estimatedPoints: 5_000,
      minPoints: 3_000,
      pointsAvailable: 8_000,
      pointsApplicable: 8_000,
      remainingFeeVnd: 17_000,
      addressOk: true,
      addressMessage: null,
      blocked: 'Phí shipper lấy rác cần trả bằng Điểm Xanh, bạn còn thiếu 17.000 điểm. Hãy chọn mang tới điểm thu gom hoặc đổi rác kèm đơn mua nhé',
      blockedCode: 'NEED_FEE_PAYMENT',
      cashDueVnd: 17_000,
      feePaths: {
        wallet: { balance: 40_000, enough: true },
        bankTransfer: { enabled: false },
        attachNextOrder: { available: true, reason: null, existingRequestId: null },
      },
    };
    api.post('/waste/pickup-quote', () => quote);
    api.post('/waste/requests', () => createdHome);
    api.get('/waste/requests/:id', () => createdHome);

    await page.goto('/recycle/new');
    const card = page.locator('[data-item]').filter({ hasText: 'Thùng carton cũ' });
    for (let i = 0; i < 5; i++) await card.getByRole('button', { name: 'Tăng số lượng' }).click();
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    await page.getByRole('radio', { name: /Shipper lấy tận nhà/ }).click();

    await expect(page.getByTestId('home-pickup-fee-short')).toBeVisible();
    await expect(page.getByText('Miễn phí lấy rác 100%')).toBeVisible();

    // Path 1: 1 chạm chuyển sang Gửi kèm đơn mua kế tiếp
    await page.getByTestId('fee-path-attach').click();
    await expect(page.getByRole('radio', { name: /Thu kèm đơn mua/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('home-pickup-fee-short')).toHaveCount(0);

    // Path 2: quay lại Shipper lấy tận nhà, trả 17.000đ bằng Ví Tubu
    await page.getByRole('radio', { name: /Shipper lấy tận nhà/ }).click();
    await page.getByText('Tôi đồng ý với Thể lệ Đổi rác và để Tubu Tree xử lý yêu cầu này').click();
    await page.getByTestId('fee-path-wallet').click();
    await page.getByRole('button', { name: 'Trả 17.000đ từ Ví và đặt lấy rác' }).click();
    await expect(page.getByText('TR-HP178').first()).toBeVisible();
    const [created] = api.callsTo('POST', '/waste/requests');
    expect(created?.body).toMatchObject({
      method: 'HOME_PICKUP',
      usePointsForShipFee: true,
      shipFeePayment: 'WALLET',
      expectedCashVnd: 17_000,
    });
  });

  test('W179-B trần 2 yêu cầu đang mở: chặn sớm ở /recycle/new với nút "Xem yêu cầu đang mở", và xử lý WASTE_MAX_OPEN ở thanh toán', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    mockSession(api, makeUser({ id: 'user-w179' }));
    const openA = wasteDetail({ id: 'wr-1', code: 'TR-OPEN1', method: 'DROP_OFF', status: 'OPEN' });
    const openB = wasteDetail({ id: 'wr-2', code: 'TR-OPEN2', method: 'MAIL_IN', status: 'IN_TRANSIT' });
    mockWasteCustomer(api, {
      me: {
        thresholds: { mailinMinPoints: 15_000, pickupMinPoints: 3_000, maxOpenRequests: 2 },
        pendingPoints: 6_000,
        openRequests: [openA, openB],
      },
      requests: [openA, openB],
    });
    api.get('/config/public', publicConfig({ waste: { enabled: true, dropoff: true, mailin: true, pickup: true } }));

    await page.goto('/recycle/new');
    await expect(page.getByTestId('waste-max-open-notice')).toHaveText(
      'Bạn đang có 2 yêu cầu đổi rác chưa xong. Hãy hoàn tất hoặc huỷ bớt rồi tạo yêu cầu mới.',
    );
    await page.getByRole('button', { name: 'Xem yêu cầu đang mở' }).click();
    await expect(page).toHaveURL(/\/recycle\/requests/);
  });
});
