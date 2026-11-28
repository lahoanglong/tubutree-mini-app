import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import type { ExternalClaimFunnel } from '@tubutree/shared-types';
import { test, expect, type MockApi } from './support/mock-api';
import type { AdminExternalAttemptRow, AdminExternalClaimRow } from '../../web/src/lib/admin-client';

/**
 * Web Admin — tab "Tích điểm đơn sàn" (external-claims-tab.tsx): duyệt claim REVIEW và khối "người khác cùng gửi".
 *
 * Mock đúng dạng API thật (external-claims-admin.controller): GET /admin/external-claims và
 * GET /admin/external-claims/attempts trả `{ data, meta }`; POST /admin/external-claims/:id/approve trả `{ id, state }`.
 * Tab luôn gọi cả hai danh sách (AttemptsSection render cùng tab), nên mọi test đều phải mock cả hai.
 *
 * Mở thẳng `/admin?tab=externalClaims` (readUrlState trong app/admin/page.tsx đọc `?tab=`); tab mặc định lọc REVIEW.
 */

const ADMIN_LOGIN = {
  accessToken: 'mock-admin-access-token',
  refreshToken: 'mock-admin-refresh-token',
  user: {
    id: 'admin-1',
    role: 'ADMIN',
    fullName: 'Test Admin',
    avatarUrl: null,
    pointsBalance: 0,
    walletBalance: 0,
    referralCode: 'ADMIN1',
  },
};

/** Phiên admin giả — cùng cơ chế `mockAdminSession` của admin.spec.ts (không import chéo giữa các file test). */
function mockAdminSession(api: MockApi) {
  api.post('/auth/refresh', ADMIN_LOGIN);
  api.get('/cart', {
    items: [],
    couponCode: null,
    subtotal: 0,
    discount: 0,
    freeship: false,
    freeshipThreshold: 0,
    itemCount: 0,
  });
  api.get('/admin/customer-refunds', { data: [], meta: { page: 1, limit: 1, total: 0 } });
  // GET /admin/config?category= trả object {khoá: giá trị}; băng "tính năng đang tắt" đọc cờ từ đây.
  api.get('/admin/config', { 'loyalty.marketplace_claim_enabled': true });
}

function claim(over: Partial<AdminExternalClaimRow> & Pick<AdminExternalClaimRow, 'id' | 'maskedCode'>): AdminExternalClaimRow {
  return {
    externalOrderId: 'ext-1',
    pancakeOrderId: '90001',
    channel: null,
    source: 'CHAT',
    userId: 'user-1',
    userName: 'Trần Văn Bình',
    userPhoneMasked: '090****567',
    orderPhoneMasked: '090****567',
    goodsValue: 250_000,
    points: 250,
    kind: 'PHONE',
    state: 'REVIEW',
    holdUntil: null,
    orderStatus: 'DELIVERED',
    reviewReason: null,
    voidReason: null,
    decidedById: null,
    deliveredAt: null,
    creditedAt: null,
    createdAt: '2026-10-05T00:04:00.000Z',
    memberPhoneVerifiedAt: '2026-10-01T00:00:00.000Z',
    memberPhoneStale: false,
    memberCreatedAt: '2026-01-01T00:00:00.000Z',
    memberDeliveredAppOrders: 2,
    ...over,
  };
}

function attempt(over: Partial<AdminExternalAttemptRow> & Pick<AdminExternalAttemptRow, 'id' | 'maskedCode'>): AdminExternalAttemptRow {
  return {
    userId: 'user-9',
    userName: 'Lê Thị Cúc',
    userPhoneMasked: '098****321',
    result: 'NOT_FOUND',
    externalOrderId: null,
    note: null,
    createdAt: '2026-10-05T00:04:00.000Z',
    ...over,
  };
}

/** GET /admin/external-claims: bỏ các dòng đã duyệt (lọc theo trạng thái như API thật) và trả `{ data, meta }`. */
function mockClaimLists(api: MockApi, opts: { claims: () => AdminExternalClaimRow[]; attempts?: AdminExternalAttemptRow[] }) {
  api.get('/admin/external-claims', ({ call }) => {
    const state = call.query.get('state');
    const rows = opts.claims().filter((c) => !state || c.state === state);
    return { data: rows, meta: { page: 1, limit: 20, total: rows.length } };
  });
  const attempts = opts.attempts ?? [];
  api.get('/admin/external-claims/attempts', { data: attempts, meta: { page: 1, limit: 20, total: attempts.length } });
}

test.describe('Web Admin - Tích điểm đơn sàn', () => {
  test.beforeEach(async ({ page: p, api }) => {
    mockAdminSession(api);
    // Cờ `tubu_web_session` là thứ auth-context.tsx nhìn để quyết định gọi /auth/refresh; đặt trước script của trang.
    await p.addInitScript(() => {
      window.localStorage.setItem('tubu_web_session', '1');
    });
  });

  test('Duyệt claim SĐT xác minh cũ: bắt ghi chú, gửi { note }, danh sách tải lại', async ({ page: p, api }) => {
    let approved = false;
    const stale = claim({
      id: 'claim-stale',
      maskedCode: 'VN12****89',
      reviewReason: 'SĐT xác minh đã cũ',
      memberPhoneVerifiedAt: '2026-01-01T00:00:00.000Z',
      memberPhoneStale: true,
    });
    mockClaimLists(api, { claims: () => (approved ? [] : [stale]) });
    api.post('/admin/external-claims/:id/approve', () => {
      approved = true;
      return { id: 'claim-stale', state: 'PENDING' };
    });

    await p.goto('/admin?tab=externalClaims');

    const row = p.locator('[data-external-claim="claim-stale"]');
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText('SĐT xác minh đã cũ, kiểm người nhận')).toBeVisible();
    const listCallsBefore = api.callsTo('GET', '/admin/external-claims').length;

    // Tab bar có nút "Duyệt SP đối tác": chỉ bấm nút trong dòng claim.
    await row.getByRole('button', { name: 'Duyệt', exact: true }).click();
    const dialog = p.getByRole('alertdialog', { name: 'Duyệt yêu cầu: SĐT xác minh đã cũ' });
    await expect(dialog).toBeVisible();
    const accept = dialog.getByRole('button', { name: 'Duyệt', exact: true });
    await expect(accept).toBeDisabled();

    // Khoảng trắng không tính: "a b" chỉ có 2 ký tự thật.
    const note = dialog.getByLabel(/Ghi chú \(đã xác nhận người nhận/);
    await note.fill('  a b  ');
    await expect(dialog.getByText('Ghi chú cần ít nhất 3 ký tự')).toBeVisible();
    await expect(accept).toBeDisabled();
    expect(api.callsTo('POST', '/admin/external-claims/:id/approve')).toHaveLength(0);

    await note.fill('Đã gọi xác nhận đúng người nhận');
    await expect(accept).toBeEnabled();
    const approveCall = api.waitForCall('POST', '/admin/external-claims/:id/approve');
    await accept.click();
    const call = await approveCall;
    expect(call.path).toBe('/admin/external-claims/claim-stale/approve');
    expect(call.body).toEqual({ note: 'Đã gọi xác nhận đúng người nhận' });

    await expect(p.getByText('Không có yêu cầu nào khớp.')).toBeVisible();
    expect(api.callsTo('GET', '/admin/external-claims').length).toBeGreaterThan(listCallsBefore);
  });

  test('Duyệt claim SĐT xác minh còn mới: hộp xác nhận thường, không gửi body', async ({ page: p, api }) => {
    let approved = false;
    const fresh = claim({ id: 'claim-fresh', maskedCode: 'VN55****01', reviewReason: 'Đơn vượt ngưỡng' });
    mockClaimLists(api, { claims: () => (approved ? [] : [fresh]) });
    api.post('/admin/external-claims/:id/approve', () => {
      approved = true;
      return { id: 'claim-fresh', state: 'PENDING' };
    });

    await p.goto('/admin?tab=externalClaims');

    const row = p.locator('[data-external-claim="claim-fresh"]');
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText('SĐT xác minh đã cũ, kiểm người nhận')).toHaveCount(0);

    await row.getByRole('button', { name: 'Duyệt', exact: true }).click();
    const dialog = p.getByRole('alertdialog', { name: 'Duyệt yêu cầu tích điểm' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox')).toHaveCount(0);

    const approveCall = api.waitForCall('POST', '/admin/external-claims/:id/approve');
    await dialog.getByRole('button', { name: 'Duyệt', exact: true }).click();
    const call = await approveCall;
    expect(call.path).toBe('/admin/external-claims/claim-fresh/approve');
    expect(call.body).toBeUndefined();

    await expect(p.getByText('Không có yêu cầu nào khớp.')).toBeVisible();
  });

  test('Lần gửi mã có người khác cùng gửi: hiện số người và danh sách; không có thì không có khối', async ({ page: p, api }) => {
    mockClaimLists(api, {
      claims: () => [],
      attempts: [
        attempt({
          id: 'att-shared',
          maskedCode: 'VN77****42',
          otherSubmittersCount: 2,
          otherSubmitters: [
            { userId: 'user-a', userName: 'Phạm Minh Dũng', userPhoneMasked: '091****111', createdAt: '2026-10-05T00:04:00.000Z' },
            { userId: 'user-b', userName: null, userPhoneMasked: null, createdAt: '2026-10-04T16:30:00.000Z' },
          ],
        }),
        attempt({ id: 'att-alone', maskedCode: 'VN88****43', otherSubmittersCount: 0, otherSubmitters: [] }),
        attempt({ id: 'att-legacy', maskedCode: 'VN99****44' }),
      ],
    });

    await p.goto('/admin?tab=externalClaims');

    const shared = p.locator('[data-external-attempt="att-shared"]');
    await expect(shared).toBeVisible({ timeout: 15_000 });
    const block = shared.locator('[data-other-submitters]');
    await expect(block.getByText('2 người khác cùng gửi mã này')).toBeVisible();
    // createdAt UTC được đổi sang giờ VN (UTC+7): 00:04Z → 07:04, 16:30Z hôm trước → 23:30.
    await expect(block.getByText('Phạm Minh Dũng · 091****111 · gửi lúc 07:04 05/10/2026')).toBeVisible();
    await expect(block.getByText('— · không có SĐT · gửi lúc 23:30 04/10/2026')).toBeVisible();

    await expect(p.locator('[data-external-attempt="att-alone"]')).toBeVisible();
    await expect(p.locator('[data-external-attempt="att-legacy"]')).toBeVisible();
    await expect(p.locator('[data-external-attempt="att-alone"] [data-other-submitters]')).toHaveCount(0);
    await expect(p.locator('[data-external-attempt="att-legacy"] [data-other-submitters]')).toHaveCount(0);
    await expect(p.locator('[data-other-submitters]')).toHaveCount(1);
  });
  test('W43: phễu theo kỳ; khối "Cài đặt và mã QR bỏ hộp" đóng sẵn, mở mới đọc cấu hình; lưu có hộp xác nhận; tải mã QR', async ({ page: p, api }, testInfo) => {
    mockClaimLists(api, { claims: () => [] });
    const funnel: ExternalClaimFunnel = {
      period: '30d',
      from: '2026-10-28T03:00:00.000Z',
      to: '2026-11-27T03:00:00.000Z',
      submissions: { total: 1_250, scan: 900, typed: 350 },
      matchedOrders: 820,
      phoneMismatch: { rejected: 12, review: 7 },
      noPhoneReview: { review: 31, waiting: 9 },
      unmatched: 95,
      pending: { claims: 140, points: 210_000 },
      credited: { claims: 600, points: 905_000, users: 480 },
      converted: { users: 96, orders: 130, gmv: 41_500_000, rate: 0.2 },
    };
    api.get('/admin/external-claims/funnel', ({ call }) => ({ ...funnel, period: call.query.get('period') ?? '30d' }));
    // Băng "tính năng đang tắt" hỏi theo category (object); thẻ cài đặt hỏi cả bảng (mảng dòng) như API thật.
    const rows = [
      { key: 'loyalty.marketplace_claim_enabled', value: true, description: null, category: 'loyalty' },
      { key: 'loyalty.marketplace_earn_pct', value: 5, description: null, category: 'loyalty' },
    ];
    api.get('/admin/config', ({ call }) => (call.query.get('category') ? { 'loyalty.marketplace_claim_enabled': true } : rows));
    api.put('/admin/config', () => ({ ok: true }));
    const wholeConfigCalls = () => api.callsTo('GET', '/admin/config').filter((c) => !c.query.get('category')).length;

    // Hộp thoại in thật không chạy được trong headless: thay `print` của khung in ẩn bằng hàm ghi lại HTML khung đang có, để bắt đúng lần bấm nút.
    await p.addInitScript(() => {
      const w = window as unknown as { __printed?: string[] };
      const append = Node.prototype.appendChild;
      Node.prototype.appendChild = function <T extends Node>(this: Node, node: T): T {
        const out = append.call(this, node) as T;
        if (node instanceof HTMLIFrameElement && node.contentWindow) {
          const frame = node;
          frame.contentWindow!.print = () => {
            (w.__printed ??= []).push(frame.contentDocument!.documentElement.outerHTML);
          };
        }
        return out;
      };
    });
    await p.goto('/admin?tab=externalClaims');

    const card = p.locator('[data-external-funnel]');
    await expect(card.getByRole('heading', { name: 'Phễu tích điểm đơn sàn' })).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText('1.250 (quét 900, gõ tay 350)')).toBeVisible();
    await expect(card.locator('[data-funnel-no-phone]')).toHaveText('31 yêu cầu phải duyệt, 9 còn đang chờ');
    await expect(p.locator('h2')).toHaveCount(1);
    const week = api.waitForCall('GET', '/admin/external-claims/funnel');
    await card.getByRole('button', { name: '7 ngày' }).click();
    expect((await week).query.get('period')).toBe('7d');
    await expect(card.getByRole('button', { name: '7 ngày' })).toHaveAttribute('aria-pressed', 'true');

    const setup = p.locator('details[data-external-setup]');
    await expect(setup).not.toHaveAttribute('open', '');
    expect(wholeConfigCalls()).toBe(0);
    const configLoad = api.waitForCall('GET', '/admin/config');
    await setup.locator('summary').click();
    await configLoad;
    await expect(setup.getByRole('heading', { name: 'Cài đặt tích điểm đơn sàn' })).toBeVisible();
    expect(wholeConfigCalls()).toBe(1);

    await setup.getByLabel('Tỉ lệ tích điểm đơn sàn (%)').fill('6');
    await setup.getByRole('button', { name: 'Lưu cài đặt' }).click();
    const dialog = p.getByRole('alertdialog', { name: 'Lưu cài đặt tích điểm đơn sàn?' });
    await expect(dialog).toContainText('5% → 6%');
    const put = api.waitForCall('PUT', '/admin/config');
    await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click();
    expect((await put).body).toEqual({ key: 'loyalty.marketplace_earn_pct', value: 6 });
    await expect(setup.getByText('Đã lưu 1 mục.')).toBeVisible();

    const qr = setup.locator('[data-external-insert-qr]');
    await qr.getByRole('button', { name: 'TikTok Shop' }).click();
    await qr.getByLabel('Tên đợt thẻ (không bắt buộc)').fill('box-2026-11');
    await expect(qr.locator('code')).toHaveText(/\/quet-ma\?utm_source=tiktok&card=box-2026-11$/);

    const svgDl = p.waitForEvent('download');
    await qr.getByRole('button', { name: 'Tải SVG', exact: true }).click();
    const svg = await svgDl;
    expect(svg.suggestedFilename()).toBe('tubu-qr-tiktok-box-2026-11.svg');
    expect(await readFile((await svg.path())!, 'utf8')).toContain('shape-rendering="crispEdges"');

    const pngDl = p.waitForEvent('download');
    await qr.getByRole('button', { name: 'Tải PNG', exact: true }).click();
    const png = await pngDl;
    expect(png.suggestedFilename()).toBe('tubu-qr-tiktok-box-2026-11.png');
    const bytes = await readFile((await png.path())!);
    expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
    // IHDR: rộng ở byte 16, cao ở byte 20 (big-endian).
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1024, 1024]);
    // Giữ tệp tải về và link trong mã làm bằng chứng để đối chiếu ma trận QR ngoài trình duyệt.
    await png.saveAs(testInfo.outputPath('insert-qr.png'));
    await svg.saveAs(testInfo.outputPath('insert-qr.svg'));
    await testInfo.attach('insert-qr-link', { body: (await qr.locator('code').innerText()).trim(), contentType: 'text/plain' });

    // W49-02: thẻ A6 sẵn in. PNG vẽ thật trong Chromium: đúng 1240×1748 (A6, 300 DPI) và có khối pHYs 11811 điểm ảnh/mét.
    await expect(qr.getByRole('img', { name: /^Thẻ A6 TikTok Shop, mã QR dẫn tới / })).toBeVisible();
    const a6Dl = p.waitForEvent('download');
    await qr.getByRole('button', { name: 'Tải PNG thẻ A6 sẵn in (300 DPI)' }).click();
    const a6 = await a6Dl;
    expect(a6.suggestedFilename()).toBe('tubu-the-a6-tiktok-box-2026-11.png');
    const a6Bytes = await readFile((await a6.path())!);
    expect(a6Bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect([a6Bytes.readUInt32BE(16), a6Bytes.readUInt32BE(20)]).toEqual([1240, 1748]);
    expect(a6Bytes.subarray(37, 41).toString('latin1')).toBe('pHYs');
    expect([a6Bytes.readUInt32BE(41), a6Bytes.readUInt32BE(45), a6Bytes[49]]).toEqual([11811, 11811, 1]);
    await a6.saveAs(process.env.E2E_EVIDENCE_DIR ? `${process.env.E2E_EVIDENCE_DIR}/insert-qr-card-a6-tiktok-box-2026-11.png` : testInfo.outputPath('insert-qr-card-a6.png'));

    // Thẻ ghi đúng tỉ lệ cấu hình (5%), và hiện dòng nói rõ điều đó.
    await expect(qr.locator('[data-card-earn-pct]')).toContainText('Nhận 5% Điểm Xanh');

    // In / Lưu PDF: bấm nút thì khung in ẩn được dựng và `print` gọi đúng một lần với trang A6 chứa thẻ SVG cỡ mm; mở đúng HTML đó ra PDF thì ra một trang A6 (≈ 297,6 × 419,5 pt).
    await qr.getByRole('button', { name: 'In / Lưu PDF thẻ A6 (10×15cm)' }).click();
    const printed = () => p.evaluate(() => (window as unknown as { __printed?: string[] }).__printed ?? []);
    await expect.poll(async () => (await printed()).length, { timeout: 5_000 }).toBe(1);
    const printHtml = (await printed())[0]!;
    expect(printHtml).toContain('@page{size:105mm 148mm;margin:0}');
    expect(printHtml).toContain('width="105mm" height="148mm"');
    expect(printHtml).toContain('Mua trên TikTok Shop');
    expect(printHtml).toContain('Nhận 5%');
    const pdfPage = await p.context().newPage();
    await pdfPage.setContent(printHtml);
    const pdf = (await pdfPage.pdf({ preferCSSPageSize: true, printBackground: true })).toString('latin1');
    await pdfPage.close();
    const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf);
    expect(box, 'PDF có MediaBox').not.toBeNull();
    // Chromium làm tròn MediaBox về điểm nguyên: A6 = 297,64 × 419,53 pt, sai lệch dưới 1 pt.
    expect(Math.abs(Number(box![1]) - 297.64)).toBeLessThan(1);
    expect(Math.abs(Number(box![2]) - 419.53)).toBeLessThan(1);
    expect(pdf.match(/\/Type\s*\/Page\b(?!s)/g)).toHaveLength(1);
    expect(api.unexpectedUnmocked()).toEqual([]);
  });

  for (const width of [360, 375]) {
    test(`W49-02: thẻ A6 bỏ hộp ở ${width}px nằm gọn trong khung, hai nút thẻ A6 đủ 44px và không lòi qua mép`, async ({ page: p, api }, testInfo) => {
      mockClaimLists(api, { claims: () => [] });
      api.get('/admin/external-claims/funnel', () => ({
        period: '30d',
        from: '2026-10-28T03:00:00.000Z',
        to: '2026-11-27T03:00:00.000Z',
        submissions: { total: 0, scan: 0, typed: 0 },
        matchedOrders: 0,
        phoneMismatch: { rejected: 0, review: 0 },
        noPhoneReview: { review: 0, waiting: 0 },
        unmatched: 0,
        pending: { claims: 0, points: 0 },
        credited: { claims: 0, points: 0, users: 0 },
        converted: { users: 0, orders: 0, gmv: 0, rate: 0 },
      } satisfies ExternalClaimFunnel));
      api.get('/admin/config', ({ call }) =>
        call.query.get('category')
          ? { 'loyalty.marketplace_claim_enabled': true }
          : [
              { key: 'loyalty.marketplace_claim_enabled', value: true, description: null, category: 'loyalty' },
              { key: 'loyalty.marketplace_earn_pct', value: 5, description: null, category: 'loyalty' },
            ],
      );
      await p.setViewportSize({ width, height: 900 });
      await p.goto('/admin?tab=externalClaims');
      const setup = p.locator('details[data-external-setup]');
      await expect(setup.locator('summary')).toBeVisible({ timeout: 15_000 });
      await setup.locator('summary').click();
      const qr = setup.locator('[data-external-insert-qr]');
      await expect(qr).toBeVisible();
      await qr.scrollIntoViewIfNeeded();

      const frame = (await qr.boundingBox())!;
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.width).toBeLessThanOrEqual(width);
      expect(await qr.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      for (const name of ['Tải PNG thẻ A6 sẵn in (300 DPI)', 'In / Lưu PDF thẻ A6 (10×15cm)']) {
        const b = (await qr.getByRole('button', { name }).boundingBox())!;
        expect(b.height, name).toBeGreaterThanOrEqual(44);
        expect(b.x, name).toBeGreaterThanOrEqual(frame.x);
        expect(b.x + b.width, name).toBeLessThanOrEqual(frame.x + frame.width + 1);
      }
      const preview = (await qr.locator('[data-a6-card-preview]').boundingBox())!;
      expect(preview.height / preview.width).toBeCloseTo(148 / 105, 1);
      expect(preview.x + preview.width).toBeLessThanOrEqual(width);
      const dir = process.env.E2E_EVIDENCE_DIR;
      await qr.screenshot({ path: dir ? `${dir}/admin-insert-qr-a6-${width}.png` : testInfo.outputPath(`admin-insert-qr-a6-${width}.png`) });
      expect(api.unexpectedUnmocked()).toEqual([]);
    });
  }

  test.describe('W58-03: in hàng loạt thẻ A6 trên tờ A4', () => {
    async function openBulk(p: Page, api: MockApi) {
      mockClaimLists(api, { claims: () => [] });
      api.get('/admin/external-claims/funnel', () => ({
        period: '30d',
        from: '2026-10-28T03:00:00.000Z',
        to: '2026-11-27T03:00:00.000Z',
        submissions: { total: 0, scan: 0, typed: 0 },
        matchedOrders: 0,
        phoneMismatch: { rejected: 0, review: 0 },
        noPhoneReview: { review: 0, waiting: 0 },
        unmatched: 0,
        pending: { claims: 0, points: 0 },
        credited: { claims: 0, points: 0, users: 0 },
        converted: { users: 0, orders: 0, gmv: 0, rate: 0 },
      } satisfies ExternalClaimFunnel));
      api.get('/admin/config', ({ call }) =>
        call.query.get('category')
          ? { 'loyalty.marketplace_claim_enabled': true }
          : [
              { key: 'loyalty.marketplace_claim_enabled', value: true, description: null, category: 'loyalty' },
              { key: 'loyalty.marketplace_earn_pct', value: 5, description: null, category: 'loyalty' },
            ],
      );
      // Hộp thoại in thật không chạy được trong headless: thay `print` của khung in ẩn bằng hàm ghi lại HTML khung đang có.
      await p.addInitScript(() => {
        const w = window as unknown as { __printed?: string[] };
        const append = Node.prototype.appendChild;
        Node.prototype.appendChild = function <T extends Node>(this: Node, node: T): T {
          const out = append.call(this, node) as T;
          if (node instanceof HTMLIFrameElement && node.contentWindow) {
            const frame = node;
            frame.contentWindow!.print = () => {
              (w.__printed ??= []).push(frame.contentDocument!.documentElement.outerHTML);
            };
          }
          return out;
        };
      });
      await p.goto('/admin?tab=externalClaims');
      const setup = p.locator('details[data-external-setup]');
      await expect(setup.locator('summary')).toBeVisible({ timeout: 15_000 });
      await setup.locator('summary').click();
      const qr = setup.locator('[data-external-insert-qr]');
      await expect(qr).toBeVisible();
      return qr;
    }

    for (const width of [320, 360, 375]) {
      test(`khối in hàng loạt ở ${width}px nằm gọn, ô nhập và nút đủ 44px, đúng một nút`, async ({ page: p, api }, testInfo) => {
        await p.setViewportSize({ width, height: 900 });
        const qr = await openBulk(p, api);
        const bulk = qr.locator('[data-insert-qr-bulk]');
        await qr.getByLabel('Tên đợt thẻ (không bắt buộc)').fill('box-2026-11');
        await bulk.getByLabel('Số thẻ (1 tới 200)').fill('25');
        await expect(bulk.locator('[data-bulk-summary]')).toHaveText('25 thẻ, số 001 tới 025, 7 tờ A4 (4 thẻ mỗi tờ).');
        await bulk.scrollIntoViewIfNeeded();

        expect(await bulk.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
        expect(await bulk.getByRole('button').count()).toBe(1);
        const frame = (await bulk.boundingBox())!;
        expect(frame.x).toBeGreaterThanOrEqual(0);
        expect(frame.x + frame.width).toBeLessThanOrEqual(width);
        const targets = [
          ['Số thẻ', bulk.getByLabel('Số thẻ (1 tới 200)')],
          ['Bắt đầu từ số', bulk.getByLabel('Bắt đầu từ số')],
          ['nút in', bulk.getByRole('button', { name: 'In 25 thẻ (7 tờ A4)' })],
        ] as const;
        for (const [name, target] of targets) {
          const b = (await target.boundingBox())!;
          expect(b.height, name).toBeGreaterThanOrEqual(44);
          expect(b.x, name).toBeGreaterThanOrEqual(frame.x);
          expect(b.x + b.width, name).toBeLessThanOrEqual(frame.x + frame.width + 1);
        }
        const dir = process.env.E2E_EVIDENCE_DIR;
        await bulk.screenshot({ path: dir ? `${dir}/admin-insert-qr-bulk-${width}.png` : testInfo.outputPath(`admin-insert-qr-bulk-${width}.png`) });
        expect(api.unexpectedUnmocked()).toEqual([]);
      });
    }

    test('bấm in: khung in A4 chứa đúng số tờ, số thẻ; mở HTML đó ra PDF thì ra đúng số trang A4, không thừa tờ trắng', async ({ page: p, api }, testInfo) => {
      const qr = await openBulk(p, api);
      const bulk = qr.locator('[data-insert-qr-bulk]');
      await qr.getByLabel('Tên đợt thẻ (không bắt buộc)').fill('box-2026-11');
      const host = new URL((await qr.locator('code').textContent())!).host;
      const printed = () => p.evaluate(() => (window as unknown as { __printed?: string[] }).__printed ?? []);
      let seen = 0;
      for (const [count, sheets] of [[4, 1], [5, 2], [8, 2]] as const) {
        await bulk.getByLabel('Số thẻ (1 tới 200)').fill(String(count));
        await bulk.getByRole('button', { name: `In ${count} thẻ (${sheets} tờ A4)` }).click();
        seen += 1;
        await expect.poll(async () => (await printed()).length, { timeout: 5_000 }).toBe(seen);
        const html = (await printed())[seen - 1]!;
        expect(html).toContain('@page{size:210mm 297mm;margin:0}');
        expect(html.match(/<section class="sheet"/g)).toHaveLength(sheets);
        expect(html.match(/data-serial="1"/g)).toHaveLength(count);
        expect(html.match(/data-crop-marks="1"/g)).toHaveLength(sheets);
        expect(html.match(new RegExp(`${host.replace(/\./g, '\\.')}/quet-ma`, 'g'))).toHaveLength(count);

        const pdfPage = await p.context().newPage();
        await pdfPage.setContent(html);
        const pdf = (await pdfPage.pdf({ preferCSSPageSize: true, printBackground: true })).toString('latin1');
        if (count === 8) {
          await pdfPage.setViewportSize({ width: 794, height: 1123 });
          const dir = process.env.E2E_EVIDENCE_DIR;
          await pdfPage.screenshot({ path: dir ? `${dir}/admin-insert-qr-bulk-a4-8cards.png` : testInfo.outputPath('admin-insert-qr-bulk-a4-8cards.png'), fullPage: true });
        }
        await pdfPage.close();
        const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf);
        expect(box, 'PDF có MediaBox').not.toBeNull();
        // A4 = 595,28 × 841,89 pt; Chromium làm tròn MediaBox về điểm nguyên.
        expect(Math.abs(Number(box![1]) - 595.28)).toBeLessThan(1);
        expect(Math.abs(Number(box![2]) - 841.89)).toBeLessThan(1);
        expect(pdf.match(/\/Type\s*\/Page\b(?!s)/g), `${count} thẻ`).toHaveLength(sheets);
      }
      expect(api.unexpectedUnmocked()).toEqual([]);
    });
  });
});
