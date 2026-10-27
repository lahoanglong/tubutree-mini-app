import fs from 'fs';
import path from 'path';
import { createHmac } from 'crypto';
import { test, expect, type Page } from '@playwright/test';

/**
 * Mở lần lượt MỌI mục của menu quản trị bằng tài khoản ADMIN thật, với API và DB thật (chạy qua scripts/web-gate.sh, E2E_SCOPE=web).
 * Chốt chặn cho lỗi kiểu QT-01 (spec mock sai dạng API nên test xanh trong khi tab thật sập): không tab nào được hiện màn lỗi
 * hoặc ném TypeError trong console.
 *
 * Chỉ /auth/refresh được giả (phiên ADMIN ký bằng đúng JWT_ACCESS_SECRET của API); mọi lệnh gọi khác đi tới API thật.
 */

const GATE_DB = /^postgresql:\/\/tubu:tubu@127\.0\.0\.1:\d+\/tubutree$/;
const ADMIN_ID = 'e2e-admin-all-tabs';
const dbUrl = process.env.DATABASE_URL ?? '';
const secret = process.env.JWT_ACCESS_SECRET ?? '';
const runnable = process.env.E2E_SCOPE === 'web' && GATE_DB.test(dbUrl) && secret.length >= 16;
const SCREENS = process.env.A1_SCREENS_DIR;

/** Mục menu ADMIN phải thấy: đếm thẳng từ NAV_GROUPS trong mã trang (trang Next không export được), để thêm hay bớt mục mà test không biết thì đỏ. */
function navLabelsFromSource(): string[] {
  const src = fs.readFileSync(path.resolve(__dirname, '../../web/src/app/admin/page.tsx'), 'utf8');
  const start = src.indexOf('const NAV_GROUPS');
  const end = src.indexOf('const TABS = NAV_GROUPS', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return [...src.slice(start, end).matchAll(/\{ k: '[A-Za-z]+', label: '([^']+)' \}/g)].map((m) => m[1]!);
}

/** Phản hồi 4xx/5xx của /api/admin/* được chấp nhận khi mở tab. Mỗi dòng phải có lý do; để trống = mọi lỗi đều làm test đỏ. */
const EXPECTED_ADMIN_ERRORS: { urlPart: string; status: number; reason: string }[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function prismaClient(): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient } = require(path.resolve(__dirname, '../../api/node_modules/@prisma/client'));
  return new PrismaClient({ datasources: { db: { url: dbUrl } } });
}

const b64 = (v: Buffer | string) => Buffer.from(v).toString('base64url');
function adminToken(): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ sub: ADMIN_ID, role: 'ADMIN', zaloId: 'e2e-admin-zalo', iat: now, exp: now + 3600 }));
  return `${head}.${body}.${b64(createHmac('sha256', secret).update(`${head}.${body}`).digest())}`;
}

test.describe('Admin: mở mọi mục menu với API thật', () => {
  test.skip(!runnable, 'Cần web-gate.sh (API + DB tạm thật)');

  test.beforeAll(async () => {
    const prisma = prismaClient();
    try {
      await prisma.user.upsert({
        where: { id: ADMIN_ID },
        update: { role: 'ADMIN', isBlocked: false },
        create: { id: ADMIN_ID, zaloId: 'e2e-admin-zalo', role: 'ADMIN', fullName: 'E2E Admin', referralCode: 'E2EADM01' },
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  async function openAdmin(page: Page, url = '/admin') {
    await page.route('**/api/auth/refresh', async (route) => {
      const origin = route.request().headers()['origin'] ?? '';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
        body: JSON.stringify({
          accessToken: adminToken(),
          refreshToken: '',
          user: { id: ADMIN_ID, role: 'ADMIN', fullName: 'E2E Admin', avatarUrl: null, pointsBalance: 0, walletBalance: 0, referralCode: 'E2EADM01' },
        }),
      });
    });
    await page.addInitScript(() => localStorage.setItem('tubu_web_session', '1'));
    await page.goto(url);
    await expect(page.getByRole('heading', { name: 'Quản trị Tubu Tree' })).toBeVisible();
  }

  test('không mục nào hiện màn lỗi hoặc ném TypeError', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    const apiErrors: string[] = [];
    page.on('response', (r) => {
      const url = r.url();
      if (!url.includes('/api/admin/') || r.status() < 400) return;
      if (EXPECTED_ADMIN_ERRORS.some((e) => url.includes(e.urlPart) && r.status() === e.status)) return;
      apiErrors.push(`${r.status()} ${new URL(url).pathname}`);
    });
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && /TypeError|is not a function|Cannot read prop|undefined \(reading/.test(m.text())) consoleErrors.push(m.text());
    });

    await openAdmin(page);
    const nav = page.getByRole('navigation', { name: 'Mục quản trị' });
    // Mặc định menu chỉ mở nhóm đầu: mở hết các nhóm trước khi đếm và bấm từng mục.
    const collapsed = nav.locator('button[aria-expanded="false"]');
    while ((await collapsed.count()) > 0) await collapsed.first().click();
    const labels = await nav.locator('button:not([aria-expanded])').allInnerTexts();
    const expectedLabels = navLabelsFromSource();
    expect(expectedLabels.length).toBeGreaterThan(30);
    expect(labels.map((l) => l.trim()).sort()).toEqual([...expectedLabels].sort());

    const failures: string[] = [];
    for (const raw of labels) {
      const label = raw.trim();
      pageErrors.length = 0;
      consoleErrors.length = 0;
      apiErrors.length = 0;
      await nav.locator('button:not([aria-expanded])', { hasText: label }).first().click();
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(250);
      const boundary = await page.locator('[data-tab-error]').count();
      const rootError = await page.getByText('Có chút trục trặc').count();
      const navStill = await nav.count();
      const loadError = (await page.getByText(/Không tải được|Không lưu được/).count()) + (await page.getByRole('button', { name: 'Thử lại', exact: true }).count());
      if (boundary || rootError || !navStill || loadError || apiErrors.length || pageErrors.length || consoleErrors.length) {
        failures.push(`${label}: boundary=${boundary} root=${rootError} nav=${navStill} loadError=${loadError} api=${apiErrors.join(',')} pageErrors=${pageErrors.join('|')} console=${consoleErrors.join('|')}`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  test('điện thoại 375px: đầu trang gọn, mọi mục mở được mà trang không cuộn ngang', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 375, height: 812 });
    await openAdmin(page);
    await expect(page.locator('header')).toBeVisible();
    // Đầu trang + tiêu đề + nút thu ngân + nút "Đổi mục" phải nằm gọn trong khoảng 220px đầu (trước đây ~490px).
    const mainTop = await page.getByRole('button', { name: /Đổi mục|Chọn mục/ }).evaluate((el) => el.getBoundingClientRect().bottom);
    expect(mainTop).toBeLessThan(220);
    const labels = navLabelsFromSource();
    const wide: string[] = [];
    for (const label of labels) {
      await page.getByRole('button', { name: /Đổi mục/ }).click();
      const drawer = page.getByRole('dialog', { name: 'Mục quản trị' });
      await drawer.getByRole('searchbox', { name: 'Tìm mục quản trị' }).fill(label);
      // Nút đầu nhóm (aria-expanded) có thể trùng tên mục ("Đổi rác" và "Đổi rác và game"), nên chỉ lấy nút mục.
      await drawer.locator('button:not([aria-expanded])').filter({ hasText: new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first().click();
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(200);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 1) wide.push(`${label}: tràn ${over}px`);
    }
    expect(wide, wide.join('\n')).toEqual([]);
  });

  test('điện thoại hẹp 320px: đầu trang quản trị và cổng đối tác không tràn ngang, nút đủ 44px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    // ADMIN vào được cả cổng đối tác (app/merchant/page.tsx), nên cùng một phiên đo được nút Đăng xuất ở cả hai cổng.
    for (const url of ['/admin', '/merchant']) {
      await openAdmin(page);
      if (url === '/merchant') await page.goto(url);
      const header = page.locator('header');
      await expect(header.getByRole('button', { name: 'Đăng xuất' })).toBeVisible();
      for (const target of [header.getByRole('button', { name: 'Đăng xuất' }), header.getByRole('link', { name: 'Về cửa hàng' })]) {
        const box = (await target.boundingBox())!;
        expect(box.width, `${url}: rộng`).toBeGreaterThanOrEqual(43.5);
        expect(box.height, `${url}: cao`).toBeGreaterThanOrEqual(43.5);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${url}: tràn ngang`).toBeLessThanOrEqual(1);
    }
  });

  test('tab Đổi rác mở được; công tắc Đổi rác tạo được dòng khi khoá chưa có trong DB', async ({ page }) => {
    const prisma = prismaClient();
    // DB gate dùng chung cho cả bộ: trả công tắc Đổi rác về đúng trạng thái cũ, kẻo spec khác (Trang chủ khách) chạy sau thấy cờ bật.
    let before: { value: unknown; category: string | null; description: string | null } | null = null;
    try {
      before = await prisma.systemConfig.findUnique({ where: { key: 'waste.enabled' }, select: { value: true, category: true, description: true } });
      await prisma.systemConfig.deleteMany({ where: { key: 'waste.enabled' } });
    } finally {
      await prisma.$disconnect();
    }
    try {
      await openAdmin(page, '/admin?tab=waste');
      await expect(page.getByRole('heading', { name: 'Đổi rác lấy quà' })).toBeVisible();
      await expect(page.locator('[data-tab-error]')).toHaveCount(0);
      await expect(page.getByText('Chương trình đang tắt với khách')).toBeVisible();

      await page.goto('/admin?tab=config');
      const sw = page.getByRole('switch', { name: 'Đổi rác lấy quà' });
      await expect(sw).toHaveAttribute('aria-checked', 'false');
      await sw.click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Bật', exact: true }).click();
      await expect(page.locator('[data-flag="waste.enabled"]').getByText('Đã lưu.')).toBeVisible();
      await expect(sw).toHaveAttribute('aria-checked', 'true');
      await page.reload();
      await expect(page.getByRole('switch', { name: 'Đổi rác lấy quà' })).toHaveAttribute('aria-checked', 'true');
    } finally {
      const restore = prismaClient();
      try {
        await restore.systemConfig.deleteMany({ where: { key: 'waste.enabled' } });
        if (before) await restore.systemConfig.create({ data: { key: 'waste.enabled', ...before, value: before.value as never } });
      } finally {
        await restore.$disconnect();
      }
    }
  });

  test('Thông tin cửa hàng lưu chuỗi thường và chính sách xem trước được', async ({ page }) => {
    await openAdmin(page, '/admin?tab=config');
    const card = page.locator('[data-shop-info]');
    await card.getByLabel('Tên công ty').fill('Công ty TNHH Tubu Tree');
    await card.getByRole('button', { name: 'Lưu thông tin cửa hàng' }).click();
    await expect(card.getByText('Đã lưu.').first()).toBeVisible();
    const legal = card.locator('[data-legal="doi-tra"]');
    await legal.getByRole('textbox').fill('# Đổi trả\n\n- 7 ngày');
    await legal.getByRole('button', { name: 'Xem trước' }).click();
    await expect(legal.locator('[data-legal-preview] li')).toContainText('7 ngày');
    await legal.getByRole('button', { name: 'Quay lại soạn' }).click();
    await legal.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(legal.getByText('Đã lưu.')).toBeVisible();
  });

  test('tab lỗi giữ nguyên menu, Thử lại và Về Việc cần xử lý', async ({ page }) => {
    await page.route('**/api/admin/faqs**', async (route) => {
      const origin = route.request().headers()['origin'] ?? '';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
        body: '{}',
      });
    });
    await openAdmin(page, '/admin?tab=faqs');
    const err = page.locator('[data-tab-error]');
    await expect(err.getByText('Mục này đang gặp lỗi')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Mục quản trị' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Quản trị Tubu Tree' })).toBeVisible();
    await err.getByRole('button', { name: 'Về Việc cần xử lý' }).click();
    await expect(err).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Mục quản trị' }).locator('[aria-current="page"]')).toHaveText(/Việc cần xử lý/);
  });

  test('ảnh chụp (chỉ khi có A1_SCREENS_DIR)', async ({ page }) => {
    test.skip(!SCREENS, 'đặt A1_SCREENS_DIR để chụp');
    test.setTimeout(180_000);
    for (const [w, h] of [[1280, 900], [375, 812]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await openAdmin(page, '/admin?tab=waste');
      await expect(page.getByRole('heading', { name: 'Đổi rác lấy quà' })).toBeVisible();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `${SCREENS}/doi-rac-${w}.png`, fullPage: true });

      await page.goto('/admin?tab=config');
      await expect(page.locator('[data-feature-flags]')).toBeVisible();
      await page.waitForLoadState('networkidle');
      await page.locator('[data-feature-flags]').screenshot({ path: `${SCREENS}/bat-tat-tinh-nang-${w}.png` });
      await page.locator('[data-shop-info]').screenshot({ path: `${SCREENS}/thong-tin-cua-hang-${w}.png` });

      await page.route('**/api/admin/faqs**', async (route) => {
        const origin = route.request().headers()['origin'] ?? '';
        await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' }, body: '{}' });
      });
      await page.goto('/admin?tab=faqs');
      await expect(page.locator('[data-tab-error]')).toBeVisible();
      await page.screenshot({ path: `${SCREENS}/tab-loi-${w}.png`, fullPage: false });
      await page.unroute('**/api/admin/faqs**');
    }
  });
});
