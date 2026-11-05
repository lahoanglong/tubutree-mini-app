import fs from 'fs';
import path from 'path';
import { createHmac } from 'crypto';
import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * UAT quản trị 1440x900: đóng vai ADMIN bấm thật qua Sản phẩm + Story Studio, Đơn hàng, Học viện, Giờ vàng, Mã giảm giá, Người dùng và Cộng đồng,
 * với API và DB thật (chạy qua scripts/web-gate.sh, E2E_SCOPE=web). Chỉ /auth/refresh được giả (phiên ADMIN ký bằng đúng JWT_ACCESS_SECRET của API).
 *
 * Hai lỗi của lượt UAT này mang mã trong thông báo của expect bảo vệ chúng: W9-01 (lời báo mã giảm trên 100%) và W9-03 (xoá trắng mô tả khoá học).
 * Ảnh chụp (fullPage) ghi vào W9_SCREENS_DIR nếu đặt, tên `NN-<luồng>-<bước>.png`.
 */

const GATE_DB = /^postgresql:\/\/tubu:tubu@127\.0\.0\.1:\d+\/tubutree$/;
const W9 = 'e2e-w9-';
const ADMIN_ID = `${W9}admin`;
const dbUrl = process.env.DATABASE_URL ?? '';
const secret = process.env.JWT_ACCESS_SECRET ?? '';
const runnable = process.env.E2E_SCOPE === 'web' && GATE_DB.test(dbUrl) && secret.length >= 16;
const SCREENS = process.env.W9_SCREENS_DIR;
const API = `http://localhost:${process.env.E2E_API_PORT ?? '3001'}/api`;

/** Chữ "trống" mà người dùng dán vào được: dấu cách, tab, và ký tự rộng 0 (U+200B, U+FEFF, U+2060) mà String.trim của trình duyệt không bỏ hết. */
const SPACES = '   \t  ';
const ZERO_WIDTH = '​​​';
const INVISIBLE_MIX = '​﻿⁠​';

test.use({ viewport: { width: 1440, height: 900 } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function prismaClient(): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient } = require(path.resolve(__dirname, '../../api/node_modules/@prisma/client'));
  return new PrismaClient({ datasources: { db: { url: dbUrl } } });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function withDb(fn: (prisma: any) => Promise<any>): Promise<any> {
  const prisma = prismaClient();
  try {
    return await fn(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

const b64 = (v: Buffer | string) => Buffer.from(v).toString('base64url');
function adminToken(): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ sub: ADMIN_ID, role: 'ADMIN', zaloId: `${W9}admin-zalo`, iat: now, exp: now + 3600 }));
  return `${head}.${body}.${b64(createHmac('sha256', secret).update(`${head}.${body}`).digest())}`;
}

let shotNo = 0;
/** fullPage, trừ khi đang mở hộp thoại (`modal`): ảnh toàn trang lúc hộp thoại đang mở làm hộp thoại tự đóng nên chụp đúng khung nhìn. */
async function shot(page: Page, flow: string, step: string, modal = false): Promise<void> {
  if (!SCREENS) return;
  fs.mkdirSync(SCREENS, { recursive: true });
  shotNo += 1;
  await page.screenshot({ path: path.join(SCREENS, `${String(shotNo).padStart(2, '0')}-${flow}-${step}.png`), fullPage: !modal });
}

/** Điều thấy được mà chưa phải lỗi: đi vào báo cáo của lần chạy (stdout và phần chú thích của ca test). */
function note(flow: string, text: string): void {
  const line = `[W9 ${flow}] ${text}`;
  test.info().annotations.push({ type: 'quan-sat', description: line });
  console.log(line);
}

interface Watch {
  pageErrors: string[];
  consoleErrors: string[];
  api: { status: number; method: string; path: string; from: string }[];
}

/** Gom lỗi trang, console error (bỏ dòng "Failed to load resource" vì đã có ở phản hồi) và mọi 4xx/5xx của /api/. */
function watch(page: Page): Watch {
  const w: Watch = { pageErrors: [], consoleErrors: [], api: [] };
  page.on('pageerror', (e) => w.pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) w.consoleErrors.push(m.text());
  });
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/') && r.status() >= 400) w.api.push({ status: r.status(), method: r.request().method(), path: u.pathname, from: new URL(page.url()).pathname + new URL(page.url()).search });
  });
  return w;
}

/** 4xx/5xx được phép của cả ca (mỗi dòng một lý do); thứ khác là ngoài dự kiến. */
function expectCleanWatch(flow: string, w: Watch, allowed: { status: number; path: RegExp; why: string }[] = []): void {
  const unexpected = w.api.filter((a) => !allowed.some((x) => x.status === a.status && x.path.test(a.path)));
  expect.soft(unexpected, `${flow}: phản hồi 4xx/5xx ngoài dự kiến`).toEqual([]);
  expect.soft(w.pageErrors, `${flow}: pageerror`).toEqual([]);
  expect.soft(w.consoleErrors, `${flow}: console error`).toEqual([]);
}

/** Dán như người dùng (qua bàn phím trình duyệt): maxLength của ô được tôn trọng, khác với fill() ghi thẳng giá trị. */
async function paste(loc: Locator, text: string): Promise<void> {
  await loc.focus();
  await loc.press('ControlOrMeta+a');
  if (text === '') await loc.press('Backspace');
  else await loc.page().keyboard.insertText(text);
}

async function openAdmin(page: Page, url = '/admin'): Promise<void> {
  await page.route('**/api/auth/refresh', async (route) => {
    const origin = route.request().headers()['origin'] ?? '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
      body: JSON.stringify({
        accessToken: adminToken(),
        refreshToken: '',
        user: { id: ADMIN_ID, role: 'ADMIN', fullName: 'W9 Admin', avatarUrl: null, pointsBalance: 0, walletBalance: 0, referralCode: 'E2EW9AD1' },
      }),
    });
  });
  await page.addInitScript(() => localStorage.setItem('tubu_web_session', '1'));
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Quản trị Tubu Tree' })).toBeVisible();
}

/** Bấm một mục của menu trái bằng ô "Tìm mục quản trị" (không phải mở từng nhóm), như admin thật hay làm. */
async function gotoNav(page: Page, label: string): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Mục quản trị' });
  await nav.getByRole('searchbox', { name: 'Tìm mục quản trị' }).fill(label);
  await nav.getByRole('button', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(,|$)`) }).first().click();
}

async function adminGet(request: import('@playwright/test').APIRequestContext, urlPath: string) {
  return request.get(`${API}${urlPath}`, { headers: { authorization: `Bearer ${adminToken()}` } });
}

/** Gọi thẳng API như admin (không qua giao diện) để biết phía server còn chặn chuỗi rác khi giao diện đã khoá nút. */
async function adminPost(request: import('@playwright/test').APIRequestContext, urlPath: string, data: unknown): Promise<{ status: number; body: string }> {
  const r = await request.post(`${API}${urlPath}`, { headers: { authorization: `Bearer ${adminToken()}` }, data });
  return { status: r.status(), body: (await r.text()).slice(0, 300) };
}


/** Bấm một nút và đọc phản hồi của lệnh API mà nó gửi đi (trạng thái và thân ngắn). */
async function submitAndRead(page: Page, trigger: () => Promise<void>, urlPath: RegExp, method = 'POST'): Promise<{ status: number; body: string }> {
  const wait = page.waitForResponse((r) => urlPath.test(new URL(r.url()).pathname) && r.request().method() === method);
  await trigger();
  const r = await wait;
  return { status: r.status(), body: (await r.text()).slice(0, 300) };
}

const PRODUCT = {
  id: `${W9}prod-1`,
  slug: 'e2e-w9-sua-hat-dieu',
  name: 'W9 Sữa hạt điều thử',
  variations: [
    { id: `${W9}var-1`, sku: 'E2EW9-SKU-1', name: 'Hộp 200ml', price: 25_000 },
    { id: `${W9}var-2`, sku: 'E2EW9-SKU-2', name: 'Lốc 6 hộp', price: 140_000 },
  ],
};
const CUSTOMER = { id: `${W9}cust`, name: 'W9 Khách Hàng', phone: '0900009001' };
const VICTIM = { id: `${W9}victim`, name: 'W9 Khách Bị Khoá', phone: '0900009002' };

/** Đơn seed: mã E2EW9-* để lọc và dọn. Mỗi lần huỷ làm đơn mất trạng thái cũ nên mỗi kiểu lý do huỷ có một đơn riêng. */
const ORDERS = {
  pending: { code: 'E2EW9-PEND', status: 'PENDING_PAYMENT', method: 'BANK_TRANSFER', pay: 'UNPAID' },
  confirmed: { code: 'E2EW9-CONF', status: 'CONFIRMED', method: 'COD', pay: 'UNPAID' },
  shipping: { code: 'E2EW9-SHIP', status: 'SHIPPING', method: 'COD', pay: 'UNPAID' },
  delivered: { code: 'E2EW9-DONE', status: 'DELIVERED', method: 'COD', pay: 'PAID' },
  cancelled: { code: 'E2EW9-CNLD', status: 'CANCELLED', method: 'COD', pay: 'UNPAID' },
  cancelEmpty: { code: 'E2EW9-CAN-EMPTY', status: 'CONFIRMED', method: 'COD', pay: 'UNPAID' },
  cancelSpaces: { code: 'E2EW9-CAN-SPACE', status: 'CONFIRMED', method: 'COD', pay: 'UNPAID' },
  cancelInvisible: { code: 'E2EW9-CAN-INVIS', status: 'CONFIRMED', method: 'COD', pay: 'UNPAID' },
  cancelLong: { code: 'E2EW9-CAN-LONG', status: 'CONFIRMED', method: 'COD', pay: 'UNPAID' },
  cancelValid: { code: 'E2EW9-CAN-VALID', status: 'CONFIRMED', method: 'COD', pay: 'UNPAID' },
} as const;

async function seedAll(): Promise<void> {
  await withDb(async (prisma) => {
    const orderIds: string[] = (await prisma.order.findMany({ where: { code: { startsWith: 'E2EW9-' } }, select: { id: true } })).map((o: { id: string }) => o.id);
    if (orderIds.length) await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { code: { startsWith: 'E2EW9-' } } });
    await prisma.flashSale.deleteMany({ where: { title: { startsWith: 'W9 ' } } });
    await prisma.coupon.deleteMany({ where: { createdById: ADMIN_ID } });
    await prisma.course.deleteMany({ where: { title: { startsWith: 'W9 ' } } });
    await prisma.communityEvent.deleteMany({ where: { title: { startsWith: 'W9 ' } } });
    await prisma.feedPost.deleteMany({ where: { id: { startsWith: W9 } } });
    await prisma.product.deleteMany({ where: { id: { startsWith: W9 } } });

    const user = (id: string, zalo: string, fullName: string, phone: string | null, refCode: string, role = 'CUSTOMER') =>
      prisma.user.upsert({
        where: { id },
        update: { role, isBlocked: false, blockedReason: null, fullName, phone },
        create: { id, zaloId: zalo, role, fullName, phone, referralCode: refCode },
      });
    await user(ADMIN_ID, `${W9}admin-zalo`, 'W9 Admin', null, 'E2EW9AD1', 'ADMIN');
    await user(CUSTOMER.id, `${W9}cust-zalo`, CUSTOMER.name, CUSTOMER.phone, 'E2EW9CU1');
    await user(VICTIM.id, `${W9}victim-zalo`, VICTIM.name, VICTIM.phone, 'E2EW9VI1');

    for (const n of [1, 2, 3]) {
      await prisma.feedPost.create({ data: { id: `${W9}post-${n}`, userId: CUSTOMER.id, kind: 'MANUAL', status: 'PENDING', title: `W9 Bài chờ duyệt ${n}`, body: `Nội dung bài chờ duyệt số ${n} của W9`, images: [] } });
    }
    await prisma.product.create({
      data: {
        id: PRODUCT.id,
        slug: PRODUCT.slug,
        name: PRODUCT.name,
        brand: 'W9 Brand',
        description: 'Sữa hạt điều nấu từ hạt điều rang, không đường, dùng cho bữa sáng.',
        shortDesc: 'Sữa hạt điều không đường',
        images: [],
        tags: [],
        forSegment: [],
        certifications: [],
        categoryIds: [],
        basePrice: 25_000,
        isActive: true,
        ingredients: [
          { name: 'Hạt điều', benefit: 'Giàu chất béo tốt cho tim', percentage: '60%' },
          { name: 'Nước tinh khiết' },
          { name: 'Muối hồng', percentage: '1%' },
        ],
        variations: { create: PRODUCT.variations.map((v) => ({ id: v.id, sku: v.sku, name: v.name, attributes: {}, retailPrice: v.price, stock: 40 })) },
      },
    });

    for (const o of Object.values(ORDERS)) {
      await prisma.order.create({
        data: {
          code: o.code,
          userId: CUSTOMER.id,
          type: 'RETAIL',
          status: o.status,
          subtotal: 140_000,
          total: 140_000,
          paymentMethod: o.method,
          paymentStatus: o.pay,
          shippingAddress: { recipient: CUSTOMER.name, phone: CUSTOMER.phone, line1: '12 Đường Thử, Quận 1', ward: 'Bến Nghé', district: 'Quận 1', province: 'TP.HCM' },
          items: { create: [{ variationId: PRODUCT.variations[1]!.id, productName: PRODUCT.name, variationName: PRODUCT.variations[1]!.name, unitPrice: 140_000, quantity: 1, total: 140_000 }] },
        },
      });
    }
  });
}

test.describe('Admin UAT 1440x900 với API và DB thật', () => {
  test.skip(!runnable, 'Cần web-gate.sh (API + DB tạm thật)');
  // Mọi ca dùng chung dữ liệu seed `e2e-w9-*` (beforeAll xoá rồi tạo lại): chạy nhiều worker thì các lần seed đạp lên nhau.
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    await seedAll();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  test('1. Sản phẩm + Story Studio: tìm, sửa, tự sinh, AI, lưu, trang web hiện dải câu chuyện', async ({ page, request }) => {
    test.setTimeout(180_000);
    const w = watch(page);
    await openAdmin(page);
    await gotoNav(page, 'Sản phẩm');
    await expect(page.getByRole('heading', { name: 'Sản phẩm', exact: true })).toBeVisible();

    const search = page.getByRole('searchbox', { name: 'Tìm theo tên, thương hiệu hoặc SKU' });
    await search.fill(PRODUCT.name);
    const edit = page.getByRole('button', { name: `Sửa ${PRODUCT.name}` });
    await expect(edit).toBeVisible();
    await shot(page, 'san-pham', 'tim-kiem');
    await edit.click();

    const drawer = page.getByRole('dialog', { name: PRODUCT.name });
    await expect(drawer).toBeVisible();
    const studio = drawer.getByRole('group', { name: 'Câu chuyện sản phẩm' });
    await expect(studio).toBeVisible();
    await shot(page, 'san-pham', 'mo-sua');

    // Ô gõ chữ của drawer chặn đúng trần của API (6000/400/500).
    await expect(drawer.getByLabel('Mô tả ngắn')).toHaveAttribute('maxlength', '400');
    await expect(drawer.getByRole('textbox', { name: 'Mô tả', exact: true })).toHaveAttribute('maxlength', '6000');
    await expect(drawer.getByLabel('Ghi chú cho AI (tuỳ chọn)')).toHaveAttribute('maxlength', '500');

    // Tự sinh Story từ Thành phần và Mô tả.
    const luu = drawer.getByRole('button', { name: 'Lưu', exact: true });
    await expect(luu).toBeDisabled();
    await studio.getByRole('button', { name: /Tự sinh Story từ Thành phần/ }).click();
    await expect(studio.getByLabel('Tiêu đề bước 1')).toBeVisible();
    const stepCount = await studio.getByLabel(/^Tiêu đề bước \d+$/).count();
    expect(stepCount, 'tự sinh phải ra ít nhất 3 bước từ 3 thành phần').toBeGreaterThanOrEqual(3);
    await expect(luu).toBeEnabled();
    await shot(page, 'san-pham', 'tu-sinh');

    // AI Tạo kịch bản: gate không có khoá AI nên API trả lỗi; giao diện phải nói rõ, không treo, không vỡ.
    const aiResponse = page.waitForResponse((r) => /\/admin\/products\/[^/]+\/story-config\/generate$/.test(new URL(r.url()).pathname));
    await studio.getByTestId('story-ai-generate').click();
    const ai = await aiResponse;
    const aiBody = await ai.text();
    const alert = studio.getByTestId('story-ai').getByRole('alert');
    await expect(alert).toBeVisible();
    const aiText = (await alert.innerText()).trim();
    note('san-pham', `AI Tạo kịch bản không có khoá: HTTP ${ai.status()}, thân phản hồi ${aiBody.slice(0, 200)}, chữ hiện ra: "${aiText}"`);
    expect(ai.status()).toBe(503);
    expect(aiText, 'thông báo AI phải là tiếng Việt, nói rõ chưa cấu hình AI').toMatch(/AI/);
    expect(aiText).not.toMatch(/Service Unavailable|Internal|undefined|\[object/);
    await expect(studio.getByTestId('story-ai-generate')).toBeEnabled();
    await expect(studio.getByTestId('story-ai-generate')).toHaveText(/AI Tạo kịch bản câu chuyện/);
    await expect(studio.getByLabel('Tiêu đề bước 1')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Quản trị Tubu Tree' })).toBeVisible();
    await shot(page, 'san-pham', 'ai-loi');

    // Dùng kịch bản mẫu: bỏ cấu hình riêng, nút Lưu khoá lại vì không còn gì đổi.
    await studio.getByRole('button', { name: 'Dùng kịch bản mẫu' }).click();
    await expect(studio.getByText('Đang dùng kịch bản mẫu hoặc tự sinh, chưa lưu cấu hình riêng.')).toBeVisible();
    await expect(luu).toBeDisabled();

    // Tự sinh lại, đổi chữ bước 1 rồi Lưu.
    await studio.getByRole('button', { name: /Tự sinh Story từ Thành phần/ }).click();
    const title1 = studio.getByLabel('Tiêu đề bước 1');
    await title1.fill('W9 Bước đầu tiên');
    await luu.click();
    await expect(drawer.getByRole('status').filter({ hasText: 'Đã lưu.' })).toBeVisible();
    await shot(page, 'san-pham', 'da-luu');

    const saved = await withDb((prisma) => prisma.product.findUnique({ where: { id: PRODUCT.id }, select: { storyConfig: true } }));
    const cfg = saved.storyConfig as { version: number; enabled: boolean; scenes: { kind: string; steps?: { title: string }[] }[] } | null;
    expect(cfg, 'DB phải có storyConfig sau khi Lưu').not.toBeNull();
    expect(cfg!.enabled).toBe(true);
    const assembly = cfg!.scenes.find((s) => s.kind === 'ingredient_assembly');
    expect(assembly?.steps?.[0]?.title).toBe('W9 Bước đầu tiên');
    const viaApi = await adminGet(request, `/admin/catalog-products/${PRODUCT.id}`);
    expect(viaApi.ok()).toBe(true);
    expect(JSON.stringify((await viaApi.json()).storyConfig)).toContain('W9 Bước đầu tiên');

    await drawer.locator('form').getByRole('button', { name: 'Đóng', exact: true }).click();
    await expect(drawer).toHaveCount(0);

    // Trang sản phẩm web hiện dải câu chuyện với chữ vừa lưu.
    const pdp = await page.context().newPage();
    const pdpErrors = watch(pdp);
    await pdp.goto(`/san-pham/${PRODUCT.slug}`);
    const story = pdp.locator('[data-section="pdp-story"]').locator('visible=true');
    await expect(story).toHaveCount(1);
    await story.scrollIntoViewIfNeeded();
    await expect(story).toContainText('W9 Bước đầu tiên');
    await shot(pdp, 'san-pham', 'trang-web');
    expect(pdpErrors.pageErrors).toEqual([]);
    await pdp.close();

    // 503 của AI và 404 của ảnh/đo lường là dự kiến.
    expectCleanWatch('san-pham', w, [{ status: 503, path: /\/admin\/products\/[^/]+\/story-config\/generate$/, why: 'gate không có khoá AI' }]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  test('2. Đơn hàng: lọc, chi tiết, đổi trạng thái, huỷ với các kiểu lý do', async ({ page, request }) => {
    test.setTimeout(240_000);
    const w = watch(page);
    await openAdmin(page);
    await gotoNav(page, 'Đơn hàng');

    const searchBox = page.getByRole('textbox', { name: /^Tìm đơn theo mã đơn/ });
    const row = (code: string) => page.getByRole('row').filter({ hasText: code });
    const search = async (text: string) => {
      await searchBox.fill(text);
      await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
    };
    const statusFilter = page.getByRole('combobox', { name: 'Lọc đơn theo trạng thái' });

    await search('E2EW9-');
    await expect(row(ORDERS.pending.code)).toBeVisible();
    await expect(row(ORDERS.delivered.code)).toBeVisible();
    await shot(page, 'don-hang', 'danh-sach');

    // Lọc theo trạng thái: mỗi trạng thái chỉ ra đúng đơn của nó.
    await statusFilter.selectOption('PENDING_PAYMENT');
    await expect(row(ORDERS.pending.code)).toBeVisible();
    await expect(row(ORDERS.confirmed.code)).toHaveCount(0);
    await statusFilter.selectOption('CONFIRMED');
    await expect(row(ORDERS.confirmed.code)).toBeVisible();
    await expect(row(ORDERS.pending.code)).toHaveCount(0);
    await expect(row(ORDERS.delivered.code)).toHaveCount(0);
    await statusFilter.selectOption('CANCELLED');
    await expect(row(ORDERS.cancelled.code)).toBeVisible();
    await expect(row(ORDERS.confirmed.code)).toHaveCount(0);
    await shot(page, 'don-hang', 'loc-da-huy');
    await statusFilter.selectOption('');
    await expect(row(ORDERS.confirmed.code)).toBeVisible();

    const dbOrder = (code: string) => withDb((prisma) => prisma.order.findUnique({ where: { code }, select: { id: true, status: true } }));
    const openOrder = async (code: string) => {
      await search(code);
      const r = row(code).first();
      await expect(r).toBeVisible();
      const toggle = r.getByRole('button', { name: /Xem & Sửa|Đóng/ });
      if (/Xem/.test(await toggle.innerText())) await toggle.click();
      await expect(page.getByText('Sản phẩm trong đơn:')).toBeVisible();
    };

    // Chi tiết + đổi trạng thái hợp lệ: Đã xác nhận → Đã đóng gói.
    await openOrder(ORDERS.confirmed.code);
    await expect(page.getByText(PRODUCT.name).first()).toBeVisible();
    await expect(page.getByText(CUSTOMER.name).first()).toBeVisible();
    await shot(page, 'don-hang', 'chi-tiet');
    await page.getByRole('button', { name: 'Đã đóng gói', exact: true }).click();
    await expect.poll(async () => (await dbOrder(ORDERS.confirmed.code)).status).toBe('PACKED');
    await expect(row(ORDERS.confirmed.code).first()).toContainText('Đã đóng gói');
    await shot(page, 'don-hang', 'da-dong-goi');

    // Huỷ đơn với từng kiểu lý do. Mỗi lần trả về giá trị ô nhập sau khi gõ, maxlength, và ghi chú lưu trong lịch sử đơn.
    const cancelWith = async (code: string, typed: string | null) => {
      await openOrder(code);
      await page.getByRole('button', { name: 'Huỷ đơn', exact: true }).click();
      const dialog = page.getByRole('alertdialog', { name: 'Huỷ đơn hàng' });
      await expect(dialog).toBeVisible();
      const box = dialog.getByRole('textbox');
      if (typed !== null) await paste(box, typed);
      const out = { value: await box.inputValue(), maxlength: await box.getAttribute('maxlength'), label: await dialog.locator('label').innerText() };
      await shot(page, 'don-hang', `huy-${code.replace('E2EW9-CAN-', '').toLowerCase()}`, true);
      await dialog.getByRole('button', { name: 'Huỷ đơn', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect.poll(async () => (await dbOrder(code)).status, { timeout: 15_000 }).toBe('CANCELLED');
      const o = await dbOrder(code);
      const hist = await withDb((prisma) => prisma.orderStatusHistory.findFirst({ where: { orderId: o.id, toStatus: 'CANCELLED' }, select: { note: true } }));
      return { ...out, note: (hist?.note ?? null) as string | null };
    };

    // Rỗng và chỉ dấu cách: lý do là tuỳ chọn, huỷ được, không ghi lý do.
    const empty = await cancelWith(ORDERS.cancelEmpty.code, null);
    note('don-hang', `huỷ lý do trống: nhãn ô "${empty.label}", maxlength=${empty.maxlength}, ghi chú lưu=${JSON.stringify(empty.note)}`);
    expect(empty.note, 'huỷ không lý do: không có ghi chú').toBeNull();
    const spaces = await cancelWith(ORDERS.cancelSpaces.code, SPACES);
    note('don-hang', `huỷ lý do toàn dấu cách: ghi chú lưu=${JSON.stringify(spaces.note)}`);
    expect(spaces.note, 'huỷ lý do toàn dấu cách: coi như không có lý do').toBeNull();
    // Chỉ ký tự vô hình: API cắt hai đầu nên không được lưu thành lý do hiển thị ra rỗng cho khách.
    const invisible = await cancelWith(ORDERS.cancelInvisible.code, INVISIBLE_MIX);
    note('don-hang', `huỷ lý do chỉ ký tự vô hình: ô nhập giữ ${JSON.stringify(invisible.value)}, ghi chú lưu=${JSON.stringify(invisible.note)}`);
    expect(invisible.note ?? '', 'huỷ lý do chỉ ký tự vô hình: không lưu ký tự vô hình làm lý do').not.toMatch(/[​-‏⁠-⁤﻿]/);
    // 501 ký tự: ô chặn ở 300 (maxlength), phần dư bị cắt, không báo gì.
    const long = await cancelWith(ORDERS.cancelLong.code, 'Ơ'.repeat(501));
    note('don-hang', `huỷ lý do 501 ký tự: maxlength=${long.maxlength}, ô giữ ${long.value.length} ký tự, ghi chú lưu dài ${long.note?.length}`);
    expect(long.maxlength).toBe('300');
    expect(long.value.length).toBe(300);
    const valid = await cancelWith(ORDERS.cancelValid.code, 'Hết hàng nhà cung cấp');
    expect(valid.note ?? '').toContain('Hết hàng nhà cung cấp');

    // API là chốt cuối: lý do 501 ký tự bị từ chối bằng lời tiếng Việt, đơn không đổi.
    const pend = await dbOrder(ORDERS.pending.code);
    const over = await request.put(`${API}/admin/orders/${pend.id}/status`, { headers: { authorization: `Bearer ${adminToken()}` }, data: { status: 'CANCELLED', note: 'x'.repeat(501) } });
    note('don-hang', `API huỷ đơn với lý do 501 ký tự: HTTP ${over.status()} ${(await over.text()).slice(0, 200)}`);
    expect(over.status()).toBe(400);
    expect((await dbOrder(ORDERS.pending.code)).status).toBe('PENDING_PAYMENT');

    await search('E2EW9-CAN');
    await shot(page, 'don-hang', 'sau-huy');
    expectCleanWatch('don-hang', w);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  test('3. Mã giảm giá: tạo mã với ô trống, ký tự vô hình, quá dài, số sai, hợp lệ, trùng mã', async ({ page, request }) => {
    test.setTimeout(180_000);
    const w = watch(page);
    await openAdmin(page);
    await gotoNav(page, 'Mã giảm giá');
    await page.getByRole('button', { name: 'Tạo mã mới', exact: true }).click();
    const form = page.getByTestId('coupon-create-form');
    const code = form.getByRole('textbox', { name: 'Mã giảm giá', exact: true });
    const submit = form.getByRole('button', { name: 'Tạo mã giảm giá', exact: true });
    const type = form.getByRole('combobox', { name: 'Loại mã giảm giá' });
    const value = form.getByPlaceholder('Giá trị', { exact: true });
    const mine = () => withDb((prisma) => prisma.coupon.findMany({ where: { createdById: ADMIN_ID }, select: { code: true, type: true, value: true } }));
    const post = (trigger = () => submit.click()) => submitAndRead(page, trigger, /\/admin\/coupons$/);
    const message = () => form.locator('p.text-danger-fg, p.text-success-fg').filter({ hasNotText: /^Ngày/ }).last();
    await shot(page, 'ma-giam-gia', 'form-trong');

    // (a) bỏ trống / chỉ khoảng trắng: nút Tạo khoá.
    await expect(submit).toBeDisabled();
    await paste(code, SPACES);
    await expect(code).toHaveValue('');
    await expect(submit).toBeDisabled();

    // (b) chỉ ký tự rộng 0: ô giữ nguyên chúng nhưng nút Tạo phải khoá; gọi thẳng API vẫn bị chặn.
    await paste(code, ZERO_WIDTH);
    await expect(submit, 'mã chỉ có ký tự vô hình giữ nút Tạo mã giảm giá khoá').toBeDisabled();
    await shot(page, 'ma-giam-gia', 'ma-vo-hinh-khoa');
    const directCoupon = await adminPost(request, '/admin/coupons', { code: ZERO_WIDTH, type: 'PERCENT', value: 10, startAt: '2030-12-01T00:00:00.000Z', endAt: '2030-12-31T00:00:00.000Z', scope: 'PUBLIC' });
    note('ma-giam-gia', `gọi thẳng API với mã ký tự rộng 0: HTTP ${directCoupon.status} ${directCoupon.body}`);
    expect(directCoupon.status).toBe(400);
    expect(directCoupon.body).toContain('Mã không được để trống.');
    expect(await mine(), 'chưa có mã nào được ghi sau các lần gửi rác').toEqual([]);

    // (c) quá dài: ô cắt ở 64 ký tự.
    await paste(code, 'A'.repeat(70));
    await expect(code).toHaveAttribute('maxlength', '64');
    expect((await code.inputValue()).length).toBe(64);

    // Giá trị sai: 0, âm, trên 100%.
    await paste(code, 'W9GIATRI');
    for (const [v, label] of [['0', 'bằng 0'], ['-5', 'âm'], ['150', 'trên 100%']] as const) {
      await value.fill(v);
      const r = await post();
      await expect(message()).toBeVisible();
      note('ma-giam-gia', `mã % giảm ${label} (${v}): HTTP ${r.status} ${r.body}; chữ hiện ra: "${(await message().innerText()).trim()}"`);
      expect(r.status, `giá trị ${v} phải bị API chặn`).toBe(400);
      if (v === '150') {
        expect((await message().innerText()).trim(), 'W9-01: lời báo "giảm trên 100%" là câu tiếng Việt cho admin, không lộ tên trường kỹ thuật').toBe('Mã giảm theo % chỉ được giảm tối đa 100%.');
      }
    }
    expect(await mine(), 'không mã nào được ghi từ các giá trị sai').toEqual([]);
    await shot(page, 'ma-giam-gia', 'gia-tri-sai');

    // (d) hợp lệ.
    await paste(code, 'W9OK10');
    await type.selectOption('PERCENT');
    await value.fill('10');
    await form.getByPlaceholder('Giảm tối đa (đ)').fill('50000');
    await form.getByPlaceholder('Đơn tối thiểu (đ)').fill('100000');
    await form.getByPlaceholder('Tổng lượt dùng').fill('100');
    await form.getByRole('textbox', { name: 'Mã giảm giá bắt đầu từ ngày' }).fill('01/12/2026');
    await form.getByRole('textbox', { name: 'Mã giảm giá hết hạn ngày' }).fill('31/12/2030');
    const ok = await post();
    expect(ok.status).toBe(201);
    await expect(message()).toHaveText('Đã tạo mã giảm giá!');
    const saved = await withDb((prisma) => prisma.coupon.findUnique({ where: { code: 'W9OK10' } }));
    expect(saved).toMatchObject({ code: 'W9OK10', type: 'PERCENT', value: 10, maxDiscount: 50000, minOrder: 100000, usageLimit: 100, createdById: ADMIN_ID });
    await shot(page, 'ma-giam-gia', 'tao-xong');

    // Gửi lại đúng mã vừa tạo: báo trùng bằng lời rõ ràng, không tạo thêm dòng.
    const dup = await post();
    await expect(message()).toBeVisible();
    note('ma-giam-gia', `tạo trùng mã W9OK10: HTTP ${dup.status} ${dup.body}; chữ hiện ra: "${(await message().innerText()).trim()}"`);
    expect(dup.status).toBeGreaterThanOrEqual(400);
    expect(dup.status).toBeLessThan(500);
    expect((await mine()).filter((c: { code: string }) => c.code === 'W9OK10')).toHaveLength(1);

    // Mã vừa tạo xuất hiện ở danh sách.
    await page.getByRole('button', { name: 'Mã đã tạo', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Mã đã tạo' }).getByText('W9OK10').first()).toBeVisible();
    await shot(page, 'ma-giam-gia', 'danh-sach');
    expectCleanWatch('ma-giam-gia', w, [{ status: 400, path: /\/api\/admin\/coupons$/, why: 'các lần gửi giá trị sai bị API chặn' }, { status: 409, path: /\/api\/admin\/coupons$/, why: 'mã trùng' }, { status: 422, path: /\/api\/admin\/coupons$/, why: 'mã trùng' }]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  test('4. Giờ vàng: tạo đợt với ô trống, ký tự vô hình, quá dài, giờ ngược, hợp lệ', async ({ page, request }) => {
    test.setTimeout(180_000);
    const w = watch(page);
    await openAdmin(page);
    await gotoNav(page, 'Giờ vàng');
    await expect(page.getByRole('heading', { name: 'Tạo đợt giờ vàng' })).toBeVisible();
    const title = page.getByLabel('Tên đợt');
    const create = page.getByRole('button', { name: 'Tạo đợt', exact: true });
    const mine = () => withDb((prisma) => prisma.flashSale.findMany({ where: { createdBy: ADMIN_ID }, select: { title: true } }));
    const setDate = async (which: 'bắt đầu' | 'kết thúc', day: string, hour: string) => {
      const base = `Giờ vàng ${which} lúc`;
      await page.getByRole('textbox', { name: `${base}: ngày` }).fill(day);
      await page.getByRole('combobox', { name: `${base}: giờ` }).selectOption(hour);
    };
    const post = () => submitAndRead(page, () => create.click(), /\/admin\/flash-sales$/);
    const msg = () => page.locator('p.text-danger-fg, p.text-success-fg').filter({ hasText: /./ }).last();
    await shot(page, 'gio-vang', 'form-trong');

    // (a) trống
    await expect(create).toBeDisabled();
    await paste(title, SPACES);
    await setDate('bắt đầu', '01/12/2030', '10');
    await setDate('kết thúc', '01/12/2030', '12');
    await expect(create).toBeDisabled();

    // (b) chỉ ký tự rộng 0: nút Tạo khoá; gọi thẳng API vẫn bị chặn.
    await paste(title, ZERO_WIDTH);
    await expect(create, 'tên đợt chỉ có ký tự vô hình giữ nút Tạo đợt khoá').toBeDisabled();
    await shot(page, 'gio-vang', 'ten-vo-hinh-khoa');
    const directFlash = await adminPost(request, '/admin/flash-sales', { title: ZERO_WIDTH, startAt: '2030-12-01T03:00:00.000Z', endAt: '2030-12-01T05:00:00.000Z' });
    note('gio-vang', `gọi thẳng API với tên ký tự rộng 0: HTTP ${directFlash.status} ${directFlash.body}`);
    expect(directFlash.status).toBe(400);
    expect(directFlash.body).toContain('Tiêu đề không được để trống.');
    expect(await mine(), 'không có đợt nào được ghi từ lần gửi rác').toEqual([]);

    // (c) quá dài
    await paste(title, 'Đ'.repeat(210));
    await expect(title).toHaveAttribute('maxlength', '200');
    expect((await title.inputValue()).length).toBe(200);

    // Giờ kết thúc trước giờ bắt đầu.
    await paste(title, 'W9 Giờ ngược');
    await setDate('bắt đầu', '02/12/2030', '12');
    await setDate('kết thúc', '01/12/2030', '10');
    const backwards = await post();
    await expect(msg()).toBeVisible();
    note('gio-vang', `giờ kết thúc trước giờ bắt đầu: HTTP ${backwards.status} ${backwards.body}; chữ hiện ra: "${(await msg().innerText()).trim()}"`);
    const rowsAfterBackwards = await mine();
    expect(rowsAfterBackwards.filter((x: { title: string }) => x.title === 'W9 Giờ ngược'), 'đợt có giờ kết thúc trước giờ bắt đầu không được tạo').toEqual([]);
    if (rowsAfterBackwards.length) await withDb((prisma) => prisma.flashSale.deleteMany({ where: { createdBy: ADMIN_ID } }));

    // (d) hợp lệ
    await paste(title, 'W9 Giờ vàng thử');
    await setDate('bắt đầu', '01/12/2030', '10');
    await setDate('kết thúc', '01/12/2030', '12');
    const ok = await post();
    expect(ok.status).toBe(201);
    await expect(msg()).toHaveText('Đã tạo đợt giờ vàng!');
    const rows = await mine();
    expect(rows.map((x: { title: string }) => x.title)).toContain('W9 Giờ vàng thử');
    await page.getByRole('button', { name: 'Tất cả', exact: true }).click();
    await expect(page.locator('[data-flash-sale-row]').filter({ hasText: 'W9 Giờ vàng thử' })).toBeVisible();
    await shot(page, 'gio-vang', 'tao-xong');
    expectCleanWatch('gio-vang', w, [{ status: 400, path: /\/api\/admin\/flash-sales$/, why: 'lần gửi rác bị API chặn' }]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  test('5. Học viện CTV: tạo khoá, sửa khoá, thêm bài với ô trống, ký tự vô hình, quá dài, hợp lệ', async ({ page, request }) => {
    test.setTimeout(180_000);
    const w = watch(page);
    await openAdmin(page);
    await gotoNav(page, 'Học viện CTV');
    await expect(page.getByRole('heading', { name: 'Tạo khoá học mới' })).toBeVisible();
    const title = page.getByLabel('Tiêu đề khoá học').first();
    const description = page.getByPlaceholder('Mô tả').first();
    const create = page.getByRole('button', { name: 'Tạo khoá học', exact: true });
    const courses = () => withDb((prisma) => prisma.course.findMany({ where: { title: { startsWith: 'W9 ' } }, select: { id: true, title: true, description: true } }));
    const allCourses = () => withDb((prisma) => prisma.course.count());
    const msg = () => page.locator('p.text-danger-fg, p.text-success-fg').filter({ hasText: /./ }).first();
    await shot(page, 'hoc-vien', 'form-trong');

    // (a) trống
    await expect(create).toBeDisabled();
    await paste(title, SPACES);
    await expect(create).toBeDisabled();

    // (b) chỉ ký tự rộng 0: nút Tạo khoá; gọi thẳng API vẫn bị chặn.
    const total0 = await allCourses();
    await paste(title, ZERO_WIDTH);
    await expect(create, 'tiêu đề khoá chỉ có ký tự vô hình giữ nút Tạo khoá học khoá').toBeDisabled();
    await shot(page, 'hoc-vien', 'tieu-de-vo-hinh-khoa');
    const directCourse = await adminPost(request, '/admin/academy/courses', { title: ZERO_WIDTH });
    note('hoc-vien', `gọi thẳng API với tiêu đề ký tự rộng 0: HTTP ${directCourse.status} ${directCourse.body}`);
    expect(directCourse.status).toBe(400);
    expect(directCourse.body).toContain('Tiêu đề không được để trống.');
    expect(await allCourses(), 'không có khoá nào được ghi từ lần gửi rác').toBe(total0);

    // (c) quá dài
    await paste(title, 'K'.repeat(210));
    await expect(title).toHaveAttribute('maxlength', '200');
    expect((await title.inputValue()).length).toBe(200);
    await paste(description, 'M'.repeat(5100));
    await expect(description).toHaveAttribute('maxlength', '5000');
    expect((await description.inputValue()).length).toBe(5000);

    // (d) hợp lệ
    await paste(title, 'W9 Khoá học thử');
    await paste(description, 'Mô tả khoá học thử của W9');
    const ok = await submitAndRead(page, () => create.click(), /\/admin\/academy\/courses$/);
    expect(ok.status).toBe(201);
    await expect(msg()).toHaveText('Đã tạo khoá học!');
    const made = (await courses()).find((c: { title: string }) => c.title === 'W9 Khoá học thử');
    expect(made?.description).toBe('Mô tả khoá học thử của W9');
    await expect(title, 'form phải về trống sau khi tạo').toHaveValue('');
    await shot(page, 'hoc-vien', 'tao-xong');

    // Sửa khoá: xoá hết mô tả rồi lưu.
    const card = page.locator('.rounded-card').filter({ hasText: 'W9 Khoá học thử' }).filter({ has: page.getByRole('button', { name: /^(Quản lý|Thu gọn)$/ }) }).last();
    await card.getByRole('button', { name: 'Quản lý', exact: true }).click();
    const info = card.locator('.rounded-card').filter({ hasText: 'Thông tin khoá học' });
    const infoDescription = info.getByPlaceholder('Mô tả');
    await expect(infoDescription).toHaveValue('Mô tả khoá học thử của W9');
    await paste(infoDescription, '');
    await info.getByRole('button', { name: 'Lưu thông tin' }).click();
    await expect(info.getByText('Đã lưu')).toBeVisible();
    const afterClear = (await courses()).find((c: { title: string }) => c.title === 'W9 Khoá học thử');
    note('hoc-vien', `xoá hết mô tả khoá rồi Lưu thông tin: giao diện báo "Đã lưu", DB description=${JSON.stringify(afterClear?.description)}`);
    expect(afterClear?.description, 'W9-03: xoá hết mô tả khoá học rồi Lưu phải xoá mô tả trong DB').toBeNull();
    await shot(page, 'hoc-vien', 'sua-xoa-mo-ta');
    // Sửa khoá: tiêu đề chỉ có ký tự vô hình thì nút Lưu thông tin khoá.
    const infoTitle = info.getByPlaceholder('Tiêu đề', { exact: true });
    await paste(infoTitle, ZERO_WIDTH);
    await expect(info.getByRole('button', { name: 'Lưu thông tin' }), 'tiêu đề khoá chỉ có ký tự vô hình giữ nút Lưu thông tin khoá').toBeDisabled();
    await paste(infoTitle, 'W9 Khoá học thử');
    await expect(info.getByRole('button', { name: 'Lưu thông tin' })).toBeEnabled();

    // Thêm bài học.
    const lessonTitle = card.getByPlaceholder('Tiêu đề bài học').last();
    const addLesson = card.getByRole('button', { name: 'Thêm bài học' });
    const lessons = () => withDb((prisma) => prisma.lesson.findMany({ where: { courseId: made!.id }, select: { title: true, body: true } }));
    await expect(addLesson).toBeDisabled();
    await paste(lessonTitle, SPACES);
    await expect(addLesson).toBeDisabled();
    await paste(lessonTitle, ZERO_WIDTH);
    await expect(addLesson, 'tiêu đề bài học chỉ có ký tự vô hình giữ nút Thêm bài học khoá').toBeDisabled();
    const directLesson = await adminPost(request, `/admin/academy/courses/${made!.id}/lessons`, { title: ZERO_WIDTH, contentType: 'ARTICLE' });
    note('hoc-vien', `gọi thẳng API với tiêu đề bài ký tự rộng 0: HTTP ${directLesson.status} ${directLesson.body}`);
    expect(directLesson.status).toBe(400);
    expect(directLesson.body).toContain('Tiêu đề không được để trống.');
    expect(await lessons()).toEqual([]);
    await paste(lessonTitle, 'B'.repeat(210));
    await expect(lessonTitle).toHaveAttribute('maxlength', '200');
    await paste(lessonTitle, 'W9 Bài học đầu');
    await card.getByPlaceholder('Nội dung bài viết').fill('Nội dung bài học đầu tiên của W9');
    const okLesson = await submitAndRead(page, () => addLesson.click(), /\/admin\/academy\/courses\/[^/]+\/lessons$/);
    expect(okLesson.status).toBe(201);
    await expect.poll(async () => (await lessons()).map((l: { title: string }) => l.title)).toEqual(['W9 Bài học đầu']);
    await expect(card.getByText('W9 Bài học đầu').first()).toBeVisible();
    await shot(page, 'hoc-vien', 'them-bai');
    expectCleanWatch('hoc-vien', w, [
      { status: 400, path: /\/api\/admin\/academy\/courses(\/[^/]+\/lessons)?$/, why: 'các lần gửi rác bị API chặn' },
    ]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  test('6. Người dùng: khoá/mở khoá với lý do trống, ký tự vô hình, quá dài, hợp lệ; cấp vai trò theo SĐT', async ({ page, request }) => {
    test.setTimeout(240_000);
    const w = watch(page);
    await openAdmin(page);
    await gotoNav(page, 'Người dùng');
    await expect(page.getByRole('heading', { name: /Quản lý người dùng/ })).toBeVisible();
    const searchBox = page.getByRole('searchbox', { name: 'Tìm theo SĐT, tên hoặc mã người dùng' });
    await searchBox.fill(VICTIM.phone);
    await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
    const row = page.getByRole('row').filter({ hasText: VICTIM.name });
    await expect(row).toBeVisible();
    await shot(page, 'nguoi-dung', 'tim-theo-sdt');
    const victim = () => withDb((prisma) => prisma.user.findUnique({ where: { id: VICTIM.id }, select: { isBlocked: true, blockedReason: true, role: true } }));
    const dialog = page.getByRole('alertdialog', { name: 'Khoá tài khoản' });
    const openBlock = async () => {
      await row.getByRole('button', { name: `Khoá ${VICTIM.name}` }).click();
      await expect(dialog).toBeVisible();
    };
    const accept = () => dialog.getByRole('button', { name: 'Khoá tài khoản', exact: true });
    const status = () => page.locator('p[role="status"]').first();

    // (a) trống / chỉ dấu cách
    await openBlock();
    await expect(accept()).toBeDisabled();
    await paste(dialog.getByRole('textbox'), SPACES);
    await expect(accept()).toBeDisabled();

    // (b) chỉ ký tự rộng 0: nút Khoá tài khoản khoá; gọi thẳng API vẫn bị chặn.
    await paste(dialog.getByRole('textbox'), ZERO_WIDTH);
    await expect(accept(), 'lý do khoá chỉ có ký tự vô hình giữ nút Khoá tài khoản khoá').toBeDisabled();
    await shot(page, 'nguoi-dung', 'ly-do-vo-hinh-khoa', true);
    await dialog.getByRole('button', { name: 'Huỷ', exact: true }).click();
    const directBlock = await adminPost(request, `/admin/users/${VICTIM.id}/block`, { reason: ZERO_WIDTH });
    note('nguoi-dung', `gọi thẳng API khoá với lý do ký tự rộng 0: HTTP ${directBlock.status} ${directBlock.body}`);
    expect(directBlock.status).toBe(400);
    expect(directBlock.body).toContain('Lý do phải có ít nhất 3 ký tự.');
    expect((await victim()).isBlocked, 'người dùng chưa bị khoá bởi lý do rác').toBe(false);

    // (c) quá dài: ô cắt ở 500
    await openBlock();
    const reasonBox = dialog.getByRole('textbox');
    await paste(reasonBox, 'L'.repeat(520));
    await expect(reasonBox).toHaveAttribute('maxlength', '500');
    expect((await reasonBox.inputValue()).length).toBe(500);
    await shot(page, 'nguoi-dung', 'ly-do-dai', true);

    // (d) hợp lệ
    await paste(reasonBox, 'Săn mã giảm giá nhiều tài khoản (W9)');
    const blocked = await submitAndRead(page, () => accept().click(), /\/admin\/users\/[^/]+\/block$/);
    expect(blocked.status).toBe(200);
    await expect(status()).toContainText(`Đã khoá ${VICTIM.name}`);
    expect(await victim()).toMatchObject({ isBlocked: true, blockedReason: 'Săn mã giảm giá nhiều tài khoản (W9)' });
    // Sau khi khoá, dòng phải đổi sang "Đã khoá" + nút "Mở khoá" mà không cần tải lại trang.
    const unblockBtn = row.getByRole('button', { name: `Mở khoá ${VICTIM.name}` });
    await expect(unblockBtn, 'sau khi khoá thành công, dòng người dùng phải đổi ngay sang nút "Mở khoá"').toBeVisible({ timeout: 5000 });
    await shot(page, 'nguoi-dung', 'da-khoa');

    // Tải lại danh sách rồi mở khoá.
    await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
    await expect(row.getByRole('button', { name: `Mở khoá ${VICTIM.name}` })).toBeVisible();
    await row.getByRole('button', { name: `Mở khoá ${VICTIM.name}` }).click();
    const unblockDialog = page.getByRole('alertdialog', { name: 'Mở khoá tài khoản' });
    await paste(unblockDialog.getByRole('textbox'), 'Đã xác minh không vi phạm (W9)');
    await submitAndRead(page, () => unblockDialog.getByRole('button', { name: 'Mở khoá', exact: true }).click(), /\/admin\/users\/[^/]+\/unblock$/);
    expect((await victim()).isBlocked).toBe(false);

    // Cấp vai trò theo SĐT.
    await page.getByText('Cấp hoặc đổi vai trò theo SĐT').click();
    const phone = page.getByPlaceholder('SĐT, vd 0912345678');
    const role = page.getByRole('combobox', { name: 'Vai trò cần cấp' });
    const grant = page.getByRole('button', { name: 'Cấp quyền', exact: true });
    const roles = () => withDb((prisma) => prisma.user.findMany({ where: { id: { startsWith: W9 } }, select: { id: true, role: true }, orderBy: { id: 'asc' } }));
    const rolesBefore = await roles();
    await expect(grant).toBeDisabled();
    await paste(phone, SPACES);
    await role.selectOption('AFFILIATE');
    await expect(grant).toBeDisabled();
    await paste(phone, 'Số'.repeat(12));
    await expect(phone).toHaveAttribute('maxlength', '20');
    expect((await phone.inputValue()).length).toBe(20);
    await shot(page, 'nguoi-dung', 'cap-vai-tro-sdt-dai');
    // SĐT chỉ ký tự rộng 0 hoặc không có chữ số: nút Cấp quyền khoá; gọi thẳng API báo 400 tiếng Việt.
    for (const junk of [ZERO_WIDTH, INVISIBLE_MIX, 'abc']) {
      await paste(phone, junk);
      await expect(grant, `SĐT ${JSON.stringify(junk)} không có chữ số giữ nút Cấp quyền khoá`).toBeDisabled();
    }
    await shot(page, 'nguoi-dung', 'sdt-vo-hinh-khoa');
    const roleBody = (phoneValue: string) => ({ phone: phoneValue, role: 'AFFILIATE', reason: 'Thử SĐT rác (W9)' });
    const directEmpty = await adminPost(request, '/admin/users/role', roleBody(ZERO_WIDTH));
    note('nguoi-dung', `gọi thẳng API cấp vai trò với SĐT ký tự rộng 0: HTTP ${directEmpty.status} ${directEmpty.body}`);
    expect(directEmpty.status).toBe(400);
    expect(directEmpty.body).toContain('Số điện thoại không hợp lệ: ô đang trống.');
    const directLetters = await adminPost(request, '/admin/users/role', roleBody('abc'));
    expect(directLetters.status).toBe(400);
    expect(directLetters.body).toContain('Số điện thoại không hợp lệ: chỉ nhập chữ số, ví dụ 0912345678.');
    // SĐT hợp lệ nhưng chưa có ai dùng: 404 và lời báo nêu đúng số đã chuẩn hoá.
    await paste(phone, '+84 900 000 777');
    await grant.click();
    const unknownDialog = page.getByRole('alertdialog');
    await expect(unknownDialog).toBeVisible();
    await paste(unknownDialog.getByRole('textbox'), 'Thử SĐT chưa có người dùng (W9)');
    const unknown = await submitAndRead(page, () => unknownDialog.getByRole('button', { name: 'Đổi vai trò', exact: true }).click(), /\/admin\/users\/role$/);
    note('nguoi-dung', `cấp vai trò cho SĐT chưa có người dùng: HTTP ${unknown.status} ${unknown.body}`);
    expect(unknown.status).toBe(404);
    const grantMsg = page.locator('div.rounded-card').filter({ has: page.getByRole('heading', { name: 'Cấp / đổi vai trò theo SĐT' }) }).locator('p.text-danger-fg').last();
    await expect(grantMsg).toBeVisible();
    expect((await grantMsg.innerText()).trim(), 'lời báo 404 nêu đúng SĐT đã chuẩn hoá').toBe('Không tìm thấy người dùng có SĐT 0900000777 (cần mở Mini App Zalo ≥1 lần).');
    await shot(page, 'nguoi-dung', 'sdt-chua-co-nguoi-dung');
    expect(await roles(), 'không có vai trò nào bị đổi bởi SĐT rác').toEqual(rolesBefore);
    // Hợp lệ
    await paste(phone, VICTIM.phone);
    await grant.click();
    const roleDialog = page.getByRole('alertdialog');
    await paste(roleDialog.getByRole('textbox'), 'Đã ký hợp đồng cộng tác viên (W9)');
    await roleDialog.getByRole('button', { name: 'Đổi vai trò', exact: true }).click();
    await expect(page.locator('p.text-success-fg').filter({ hasText: 'Đã đổi' })).toBeVisible();
    expect((await victim()).role).toBe('AFFILIATE');
    await shot(page, 'nguoi-dung', 'da-cap-vai-tro');
    await withDb((prisma) => prisma.user.update({ where: { id: VICTIM.id }, data: { role: 'CUSTOMER' } }));
    expectCleanWatch('nguoi-dung', w, [
      { status: 400, path: /\/api\/admin\/users\//, why: 'lý do/SĐT rác bị API chặn' },
      { status: 404, path: /\/api\/admin\/users\//, why: 'SĐT rác không tìm thấy' },
    ]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  test('7. Cộng đồng: tạo sự kiện (trống, vô hình, quá dài, giờ ngược, quà sai, hợp lệ) và từ chối bài chờ duyệt', async ({ page, request }) => {
    test.setTimeout(240_000);
    const w = watch(page);
    await openAdmin(page);
    await gotoNav(page, 'Cộng đồng');
    await expect(page.getByRole('heading', { name: 'Cộng đồng', exact: true })).toBeVisible();

    // Bài chờ duyệt: từ chối với lý do ký tự rộng 0, quá dài, hợp lệ.
    const postRow = (n: number) => page.locator(`[data-post="${W9}post-${n}"]`);
    await expect(postRow(1)).toBeVisible();
    await shot(page, 'cong-dong', 'bai-cho-duyet');
    const postStatus = (n: number) => withDb((prisma) => prisma.feedPost.findUnique({ where: { id: `${W9}post-${n}` }, select: { status: true } })).then((x: { status: string }) => x.status);
    const rejectDialog = page.getByRole('alertdialog', { name: 'Từ chối bài này?' });
    const rejectWith = async (n: number, reason: string) => {
      await postRow(n).getByRole('button', { name: 'Từ chối', exact: true }).click();
      await expect(rejectDialog).toBeVisible();
      const box = rejectDialog.getByRole('textbox');
      await expect(box).toHaveAttribute('maxlength', '200');
      await paste(box, reason);
      return { box, send: () => submitAndRead(page, () => rejectDialog.getByRole('button', { name: 'Từ chối', exact: true }).click(), /\/feed\/admin\/[^/]+\/reject$/) };
    };
    // (b) ký tự rộng 0
    const zw = await rejectWith(1, ZERO_WIDTH);
    note('cong-dong', `từ chối bài với lý do chỉ ký tự rộng 0: nút "Từ chối" ${(await rejectDialog.getByRole('button', { name: 'Từ chối', exact: true }).isEnabled()) ? 'MỞ' : 'khoá'}`);
    const zwRes = await zw.send();
    note('cong-dong', `từ chối bài lý do ký tự rộng 0: HTTP ${zwRes.status} ${zwRes.body}`);
    expect(zwRes.status).toBe(201);
    await expect.poll(() => postStatus(1)).toBe('REMOVED');
    // (c) quá dài: ô cắt ở 200
    const long = await rejectWith(2, 'D'.repeat(260));
    expect((await long.box.inputValue()).length).toBe(200);
    await shot(page, 'cong-dong', 'tu-choi-ly-do-dai', true);
    const longRes = await long.send();
    expect(longRes.status).toBe(201);
    // (d) hợp lệ
    const ok = await rejectWith(3, 'Có link bán hàng ngoài (W9)');
    expect((await ok.send()).status).toBe(201);
    await expect.poll(async () => [await postStatus(2), await postStatus(3)]).toEqual(['REMOVED', 'REMOVED']);

    // Sự kiện.
    await page.getByRole('group', { name: 'Mục kiểm duyệt cộng đồng' }).getByRole('button', { name: 'Sự kiện', exact: true }).click();
    const form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Tạo sự kiện' }) });
    const name = form.getByRole('textbox', { name: 'Tên sự kiện' });
    const desc = form.getByRole('textbox', { name: 'Mô tả (không bắt buộc)' });
    const start = form.getByLabel('Bắt đầu (giờ Việt Nam)');
    const end = form.getByLabel('Kết thúc (giờ Việt Nam)');
    const reward = form.getByRole('spinbutton', { name: /Thưởng Điểm Xanh/ });
    const create = form.getByRole('button', { name: 'Tạo sự kiện', exact: true });
    const events = () => withDb((prisma) => prisma.communityEvent.findMany({ where: { title: { startsWith: 'W9 ' } }, select: { title: true, description: true, rewardPoints: true } }));
    const total = () => withDb((prisma) => prisma.communityEvent.count());
    const total0 = await total();
    const post = () => submitAndRead(page, () => create.click(), /\/feed\/events$/);
    await shot(page, 'cong-dong', 'su-kien-form-trong');

    // (a) trống
    await expect(create).toBeDisabled();
    await paste(name, SPACES);
    await start.fill('2030-12-01T10:00');
    await end.fill('2030-12-01T12:00');
    await expect(create).toBeDisabled();

    // (b) ký tự rộng 0: nút Tạo sự kiện khoá; gọi thẳng API vẫn bị chặn.
    await paste(name, ZERO_WIDTH);
    await expect(create, 'tên sự kiện chỉ có ký tự vô hình giữ nút Tạo sự kiện khoá').toBeDisabled();
    await shot(page, 'cong-dong', 'su-kien-ten-vo-hinh-khoa');
    const directEvent = await adminPost(request, '/feed/events', { title: ZERO_WIDTH, startAt: '2030-12-01T03:00:00.000Z', endAt: '2030-12-01T05:00:00.000Z' });
    note('cong-dong', `gọi thẳng API với tên sự kiện ký tự rộng 0: HTTP ${directEvent.status} ${directEvent.body}`);
    expect(directEvent.status).toBe(400);
    expect(directEvent.body).toContain('Tiêu đề sự kiện không được để trống.');
    expect(await total(), 'không sự kiện nào được ghi từ lần gửi rác').toBe(total0);

    // (c) quá dài
    await paste(name, 'S'.repeat(180));
    await expect(name).toHaveAttribute('maxlength', '160');
    expect((await name.inputValue()).length).toBe(160);
    await paste(desc, 'M'.repeat(2100));
    await expect(desc).toHaveAttribute('maxlength', '2000');
    expect((await desc.inputValue()).length).toBe(2000);
    await paste(desc, '');

    // Giờ ngược: lời báo cạnh ô và nút khoá.
    await paste(name, 'W9 Sự kiện giờ ngược');
    await end.fill('2030-12-01T09:00');
    await expect(form.getByText('Giờ kết thúc phải sau giờ bắt đầu.')).toBeVisible();
    await expect(create).toBeDisabled();
    await shot(page, 'cong-dong', 'su-kien-gio-nguoc');
    await end.fill('2030-12-01T12:00');

    // Quà sai: 1 điểm, và giá trị âm.
    await reward.fill('1');
    await expect(create).toBeEnabled();
    const lowReward = await post();
    const alertLow = form.getByRole('alert');
    await expect(alertLow).toBeVisible();
    note('cong-dong', `quà 1 Điểm Xanh: HTTP ${lowReward.status} ${lowReward.body}; chữ hiện ra: "${(await alertLow.innerText()).trim()}"`);
    expect(lowReward.status).toBe(400);
    await reward.fill('-5');
    await expect(create, 'quà âm phải bị khoá ngay ở nút Tạo').toBeDisabled();
    expect(await events(), 'chưa sự kiện W9 nào được ghi').toEqual([]);

    // (d) hợp lệ
    await reward.fill('20000');
    await paste(desc, 'Mô tả sự kiện thử của W9');
    const created = await post();
    expect(created.status).toBe(201);
    await expect(page.getByText('Đã tạo sự kiện.')).toBeVisible();
    const rows = await events();
    expect(rows).toEqual([{ title: 'W9 Sự kiện giờ ngược', description: 'Mô tả sự kiện thử của W9', rewardPoints: 20000 }]);
    await expect(page.locator('li[data-event]').filter({ hasText: 'W9 Sự kiện giờ ngược' })).toBeVisible();
    await shot(page, 'cong-dong', 'su-kien-tao-xong');
    expectCleanWatch('cong-dong', w, [{ status: 400, path: /\/api\/feed\/events$/, why: 'các lần gửi rác bị API chặn' }]);
  });
});
