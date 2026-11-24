import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession } from './support/mock-api';

/**
 * Zalo Mini App (W177): tám màn quản trị, đối tác và nhân sự đã rời gói Mini App. Mỗi đường dẫn giữ nguyên và hiện cùng một thẻ chuyển sang website
 * (apps/miniapp/src/pages/web-portal-redirect.tsx); riêng /dealer chỉ cho chép link sang trình duyệt (PO A3). Spec không mock API nào của tám màn cũ: nếu thẻ còn gọi API quản trị/đối tác, fixture `api`
 * báo lời gọi chưa mock và spec đỏ.
 */
const SCREENS = [
  { route: '/admin', title: 'Quản trị Tubu Tree', url: 'https://tubutree.com/admin' },
  { route: '/admin/community', title: 'Kiểm duyệt cộng đồng', url: 'https://tubutree.com/admin?tab=community' },
  { route: '/storefront', title: 'Gian hàng của tôi', url: 'https://tubutree.com/ctv/gian-hang' },
  { route: '/recycle/desk', title: 'Nhận hàng tại điểm', url: 'https://tubutree.com/doi-rac/quay' },
  { route: '/staff', title: 'Ca làm của tôi', url: 'https://tubutree.com/nhan-vien' },
  { route: '/brand-owner', title: 'Quản lý thương hiệu', url: 'https://tubutree.com/chu-thuong-hieu' },
  { route: '/my-payroll', title: 'Lương của tôi', url: 'https://tubutree.com/nhan-vien/bang-luong' },
] as const;

const WIDTHS = [375, 360, 320] as const;
const DEALER_NOTE = 'Đăng ký đại lý, đặt hàng sỉ và thanh toán đơn sỉ trên trình duyệt (Chrome, Safari) tại tubutree.com/dai-ly. Mini App chỉ nhận đơn lẻ.';

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const scroller = document.querySelector('.zaui-page') as HTMLElement | null;
    return Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, scroller ? scroller.scrollWidth - scroller.clientWidth : 0);
  });
}

for (const width of WIDTHS) {
  test.describe(`Thẻ chuyển sang website — ${width}px`, () => {
    test.use({ viewport: { width, height: 700 } });

    for (const { route, title, url } of SCREENS) {
      test(`${route}: tiêu đề, link web, nút chính ≥44px, nút Sao chép, nút Quay lại nổi, không tràn ngang`, async ({ page, api }) => {
        mockSession(api, makeUser({ id: 'u-portal', fullName: 'Nhân sự thử' }));
        await page.goto(route);

        await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText(/thao tác đầy đủ trên website/)).toBeVisible();
        await expect(page.getByText(url, { exact: true })).toBeVisible();

        const open = page.getByRole('button', { name: 'Mở trên website' });
        const copy = page.getByRole('button', { name: 'Sao chép liên kết' });
        await expect(open).toBeVisible();
        await expect(copy).toBeVisible();
        for (const button of [open, copy]) {
          const box = (await button.boundingBox())!;
          expect(box.height, `${route}: nút cao ${box.height}px`).toBeGreaterThanOrEqual(44);
          expect(box.x, `${route}: nút lệch trái`).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width, `${route}: nút tràn phải`).toBeLessThanOrEqual(width);
        }

        // Một nút Quay lại duy nhất: nút nổi của vỏ app (thẻ không vẽ thêm nút thứ hai).
        const back = page.getByRole('button', { name: 'Quay lại' });
        await expect(back).toHaveCount(1);
        const backBox = (await back.boundingBox())!;
        expect(backBox.width).toBeGreaterThanOrEqual(44);
        expect(backBox.height).toBeGreaterThanOrEqual(44);

        expect(await horizontalOverflow(page), `${route} tràn ngang ở ${width}px`).toBeLessThanOrEqual(0);
      });
    }

    // PO A3: web /dai-ly có thanh toán đơn sỉ, Mini App chỉ cho chép link sang trình duyệt (không mở webview Zalo).
    test('/dealer: chỉ mở bằng trình duyệt, không có nút Mở trên website, Sao chép liên kết là nút chính ≥44px, không tràn ngang', async ({ page, api }) => {
      mockSession(api, makeUser({ id: 'u-portal', fullName: 'Đại lý thử' }));
      await page.goto('/dealer');

      await expect(page.getByRole('heading', { level: 1, name: 'Kênh đại lý' })).toBeVisible({ timeout: 15_000 });
      const note = page.getByText(DEALER_NOTE, { exact: true });
      await expect(note).toBeVisible();
      await expect(page.getByText('https://tubutree.com/dai-ly', { exact: true })).toBeVisible();
      await expect(page.getByText(/thao tác đầy đủ trên website/)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Mở trên website' })).toHaveCount(0);

      const copy = page.getByRole('button', { name: 'Sao chép liên kết' });
      await expect(copy).toBeVisible();
      await expect(copy).toHaveClass(/zaui-btn-primary/);
      const box = (await copy.boundingBox())!;
      expect(box.height, `nút cao ${box.height}px`).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, 'nút tràn phải').toBeLessThanOrEqual(width);
      const noteBox = (await note.boundingBox())!;
      expect(noteBox.x + noteBox.width, 'câu hướng dẫn tràn phải').toBeLessThanOrEqual(width);

      await expect(page.getByRole('button', { name: 'Quay lại' })).toHaveCount(1);
      expect(await horizontalOverflow(page), `/dealer tràn ngang ở ${width}px`).toBeLessThanOrEqual(0);
    });
  });
}

test.describe('Thẻ chuyển sang website — hành vi nút', () => {
  test.use({ viewport: { width: 375, height: 700 } });

  // W180: query của link cũ đi theo qua router thật, khoá nhạy cảm bị lọc trước khi link hiện trên màn.
  test('giữ query vô hại của link cũ, bỏ token/code/session', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'u-portal' }));
    await page.goto('/storefront?khoi=gian-hang-moi&token=abc123&code=zz&session=s1');
    await expect(page.getByRole('heading', { level: 1, name: 'Gian hàng của tôi' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('https://tubutree.com/ctv/gian-hang?khoi=gian-hang-moi', { exact: true })).toBeVisible();
  });

  test('/admin/community giữ tab=community, tab ngoài không ghi đè', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'u-portal' }));
    await page.goto('/admin/community?tab=orders&khoi=x');
    await expect(page.getByText('https://tubutree.com/admin?tab=community&khoi=x', { exact: true })).toBeVisible({ timeout: 15_000 });
  });

  test('/dealer Sao chép liên kết: chép link /dai-ly, báo đã chép, ở nguyên trang Mini App', async ({ page, api, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
    mockSession(api, makeUser({ id: 'u-portal' }));
    await page.goto('/dealer');
    await expect(page.getByRole('heading', { level: 1, name: 'Kênh đại lý' })).toBeVisible({ timeout: 15_000 });
    const before = page.url();
    await page.getByRole('button', { name: 'Sao chép liên kết' }).click();
    await expect(page.getByText('Đã sao chép liên kết')).toBeVisible();
    expect(page.url()).toBe(before);
    const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
    if (copied !== null) expect(copied).toBe('https://tubutree.com/dai-ly');
  });

  test('Sao chép liên kết: chép đúng link vào clipboard và báo "Đã sao chép liên kết"', async ({ page, api, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
    mockSession(api, makeUser({ id: 'u-portal' }));
    await page.goto('/admin');
    await expect(page.getByRole('heading', { level: 1, name: 'Quản trị Tubu Tree' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Sao chép liên kết' }).click();
    await expect(page.getByText('Đã sao chép liên kết')).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
    if (copied !== null) expect(copied).toBe('https://tubutree.com/admin');
  });

  // Lời báo "Chưa mở được website" khi SDK từ chối được kiểm ở web-portal-redirect.spec.tsx; ở đây SDK của dev server (mpWeb) nhận lệnh.
  test('Mở trên website: giao lệnh cho SDK, không đổi location của app và không hiện lời báo lỗi', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'u-portal' }));
    await page.goto('/admin');
    await expect(page.getByRole('heading', { level: 1, name: 'Quản trị Tubu Tree' })).toBeVisible({ timeout: 15_000 });
    const before = page.url();
    await page.getByRole('button', { name: 'Mở trên website' }).click();
    await expect(page.getByRole('button', { name: 'Mở trên website' })).toBeEnabled();
    expect(page.url()).toBe(before);
    await expect(page.getByText(/Chưa mở được website/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sao chép liên kết' })).toBeEnabled();
  });
});

// Web chỉ xem được trạng thái chấm công (vào/ra ca cần token vị trí Zalo) nên /staff giữ thẻ chấm công của nhân viên trong Mini App.
test.describe('/staff — chấm công vẫn làm trong Mini App', () => {
  for (const width of WIDTHS) {
    test.describe(`${width}px`, () => {
      test.use({ viewport: { width, height: 700 } });

      test('nhân viên có ca đã duyệt: thẻ Chấm công hôm nay với nút Vào ca ≥44px, hai nút chuyển web vẫn đủ, không tràn ngang', async ({ page, api }) => {
        mockSession(api, makeUser({ id: 'u-staff', role: 'STAFF' }));
        api.get('/staff/attendance/status', {
          shifts: [{ id: 'shift-1', startAt: '2026-11-16T01:00:00.000Z', endAt: '2026-11-16T05:00:00.000Z', approvedStart: null, approvedEnd: null }],
          openSession: null,
        });
        await page.goto('/staff');
        await expect(page.getByRole('heading', { level: 1, name: 'Ca làm của tôi' })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('heading', { level: 2, name: 'Chấm công hôm nay' })).toBeVisible();
        const checkin = page.getByRole('button', { name: 'Vào ca' });
        await expect(checkin).toBeVisible();
        for (const name of ['Vào ca', 'Mở trên website', 'Sao chép liên kết']) {
          const box = (await page.getByRole('button', { name }).boundingBox())!;
          expect(box.height, `${name}: cao ${box.height}px`).toBeGreaterThanOrEqual(44);
          expect(box.x + box.width, `${name}: tràn phải`).toBeLessThanOrEqual(width);
        }
        const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, 0));
        expect(overflow).toBeLessThanOrEqual(0);
      });
    });
  }

  test('khách thường vào /staff: chỉ thẻ chuyển web, không có thẻ chấm công và không gọi API chấm công', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'u-portal' }));
    await page.goto('/staff');
    await expect(page.getByRole('heading', { level: 1, name: 'Ca làm của tôi' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Chấm công hôm nay' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mở trên website' })).toBeVisible();
  });
});
