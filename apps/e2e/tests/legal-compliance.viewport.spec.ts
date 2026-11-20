import { expect, test as base, type Page, type TestInfo } from '@playwright/test';
import { test as mocked } from './support/mock-api';
import { STATES, mockWorld } from './support/checkout-states';

/**
 * Hồ sơ thông báo website TMĐT với Bộ Công Thương (docs/launch/bo-cong-thuong-submission-pack-2026-11-15.md), ở hai khổ chuẩn 390×844
 * ("Web Core 390") và 1440×900 ("Web Core 1440"):
 * - năm trang chính sách trả 200, có chữ tiếng Việt thật (không Lorem/TODO, không chỗ giữ [ ] trong nội dung), không cuộn ngang;
 * - chân trang (đầy đủ ở máy tính, gọn ở điện thoại) có đủ năm link chính sách bấm được, thông tin thương nhân, hotline và email;
 * - trang thanh toán có dòng đồng ý dẫn tới Điều khoản, Chính sách bảo mật và ba chính sách còn lại, mỗi link có vùng chạm 44px riêng;
 * - HTML Trang chủ dưới 235 KB.
 * Trang chính sách và Trang chủ do máy chủ Next dựng từ API thật trên DB tạm của web-gate.sh; trang thanh toán mock API ở trình duyệt.
 */
const SIZES: Record<string, { width: number; height: number }> = {
  'Web Core 390': { width: 390, height: 844 },
  'Web Core 1440': { width: 1440, height: 900 },
};

const POLICIES = [
  { slug: 'dieu-khoan', title: 'Điều khoản sử dụng', label: 'Điều khoản' },
  { slug: 'bao-mat', title: 'Chính sách bảo mật', label: 'Bảo mật' },
  { slug: 'doi-tra', title: 'Chính sách đổi trả', label: 'Đổi trả' },
  { slug: 'van-chuyen', title: 'Chính sách vận chuyển', label: 'Vận chuyển' },
  { slug: 'thanh-toan', title: 'Chính sách và hình thức thanh toán', label: 'Thanh toán' },
] as const;
const HREFS = POLICIES.map((p) => `/chinh-sach/${p.slug}`);
const HOME_HTML_MAX = 235_000;

const sizeOf = (testInfo: TestInfo) => {
  const size = SIZES[testInfo.project.name];
  testInfo.skip(!size, 'chỉ chạy ở hai project khổ chuẩn Web Core 390 / Web Core 1440');
  return size!;
};

async function overflow(page: Page): Promise<{ doc: number; body: number }> {
  return page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
}

/** Chân trang đang hiện ở khổ này: máy tính là chân trang đầy đủ (nav "Chính sách"), điện thoại là chân trang gọn. */
function visibleFooter(page: Page, wide: boolean) {
  return wide ? page.locator('footer:not([data-compact-footer])') : page.locator('footer[data-compact-footer]');
}

async function expectFooterCompliant(page: Page, wide: boolean): Promise<void> {
  const footer = visibleFooter(page, wide);
  await expect(footer).toBeVisible();
  const nav = footer.getByRole('navigation', { name: wide ? 'Chính sách' : 'Chính sách (điện thoại)', exact: true });
  const links = nav.getByRole('link');
  await expect(links).toHaveCount(5);
  expect(await links.evaluateAll((as) => as.map((a) => a.getAttribute('href')))).toEqual(HREFS);
  for (const p of POLICIES) await expect(nav.getByRole('link', { name: p.label, exact: true })).toBeVisible();

  const company = footer.getByTestId('footer-company');
  await expect(company).toContainText(/Đơn vị vận hành: .+ · MST \d{10}/);
  await expect(company).toContainText(/Giấy chứng nhận đăng ký doanh nghiệp số \d{10}/);
  await expect(footer.locator('a[href^="tel:"]').first()).toBeVisible();
  await expect(footer.locator('a[href^="mailto:"]').first()).toBeVisible();
  expect(await footer.innerText()).not.toMatch(/lorem|todo|\[[^\]]*\]|undefined|NaN/i);
  // Chưa có đường dẫn xác nhận thật thì không được hiện huy hiệu (phạt 20–40 triệu đồng nếu gắn sai).
  await expect(footer.getByText('Đã thông báo Bộ Công Thương')).toHaveCount(0);
}

for (const p of POLICIES) {
  base(`chính sách ${p.slug}: 200, chữ tiếng Việt thật, chân trang đủ năm link, không cuộn ngang`, async ({ page, request }, testInfo) => {
    const size = sizeOf(testInfo);
    expect(page.viewportSize(), 'khổ của project').toEqual(size);
    const wide = size.width >= 768;

    const res = await page.goto(`/chinh-sach/${p.slug}`);
    expect(res?.status(), `/chinh-sach/${p.slug}`).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(p.title);

    const main = page.locator('main');
    const body = (await main.innerText()).replace(/\s+/g, ' ');
    const draftNote = (await page.getByTestId('legal-draft-banner').allInnerTexts()).join(' ').replace(/\s+/g, ' ');
    const content = body.replace(draftNote, '');
    expect(content.length, 'nội dung chính sách đủ dài').toBeGreaterThan(1500);
    expect(content).toMatch(/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i);
    expect(content).not.toMatch(/lorem|todo|undefined|NaN|\[[^\]]*\]/i);
    expect(content).toContain('0984 606 774');

    await expectFooterCompliant(page, wide);
    const o = await overflow(page);
    expect(o, `cuộn ngang ở /chinh-sach/${p.slug}`).toEqual({ doc: 0, body: 0 });

    // Cả năm link đều mở được (200), không chỉ trang đang đứng.
    for (const href of HREFS) expect((await request.get(href)).status(), href).toBe(200);
  });
}

base('Trang chủ: chân trang có đủ năm link chính sách và thông tin thương nhân, HTML dưới 235 KB, không cuộn ngang', async ({ page, request }, testInfo) => {
  const size = sizeOf(testInfo);
  const wide = size.width >= 768;
  const html = await (await request.get('/')).text();
  const bytes = Buffer.byteLength(html, 'utf8');
  console.log(`HOME_HTML ${testInfo.project.name} ${bytes} B`);
  expect(bytes, 'HTML Trang chủ').toBeLessThan(HOME_HTML_MAX);

  await page.goto('/');
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await expectFooterCompliant(page, wide);
  await visibleFooter(page, wide).getByRole('link', { name: 'Bảo mật', exact: true }).click();
  await expect(page).toHaveURL(/\/chinh-sach\/bao-mat$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chính sách bảo mật');
  const o = await overflow(page);
  expect(o).toEqual({ doc: 0, body: 0 });
});

mocked('thanh toán: dòng đồng ý dẫn tới Điều khoản, Chính sách bảo mật và ba chính sách còn lại; không cuộn ngang', async ({ page, api }, testInfo) => {
  const size = sizeOf(testInfo);
  const normal = STATES.find((s) => s.key === 'normal')!;
  await mockWorld(api, page, 'web', normal, Promise.resolve());
  await page.goto('/thanh-toan');
  await normal.ready(page, 'web');

  const consent = page.locator('[data-testid="order-consent"]:visible');
  await expect(consent).toHaveCount(1);
  await expect(consent).toHaveText('Bằng việc đặt hàng, bạn đồng ý với: Điều khoản, Bảo mật, Đổi trả, Vận chuyển, Thanh toán.');
  const links = consent.getByRole('link');
  expect(await links.evaluateAll((as) => as.map((a) => a.getAttribute('href')))).toEqual(HREFS);
  await expect(consent.getByRole('link', { name: 'Điều khoản', exact: true })).toBeVisible();
  await expect(consent.getByRole('link', { name: 'Chính sách bảo mật', exact: true })).toBeVisible();
  // Link không bị cắt giữa chữ, và điểm cách tâm link 20px phía trên/dưới vẫn trúng chính link đó: vùng chạm 44px không bị link dòng khác
  // (cột tóm tắt 326px ở máy tính làm "Thanh toán" xuống dòng) hay nút Đặt hàng giành mất.
  await consent.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const hits = await links.evaluateAll((as) =>
    as.map((a) => {
      const b = a.getBoundingClientRect();
      const x = b.left + b.width / 2;
      const at = (y: number) => {
        const el = document.elementFromPoint(x, y);
        return el?.closest('a') === a ? 'self' : `${el?.tagName ?? 'none'}.${String(el?.className ?? '').slice(0, 40)}`;
      };
      const box = a.closest('[data-testid="order-consent"]')!.getBoundingClientRect();
      return {
        href: a.getAttribute('href'),
        fragments: a.getClientRects().length,
        above: at(b.top + b.height / 2 - 20),
        below: at(b.top + b.height / 2 + 20),
        geometry: `link ${b.left.toFixed(1)}–${b.right.toFixed(1)} × ${b.height.toFixed(1)}, dòng ${box.left.toFixed(1)}–${box.right.toFixed(1)}`,
      };
    }),
  );
  for (const h of hits) expect({ fragments: h.fragments, above: h.above, below: h.below }, `${h.href} ${h.geometry}`).toEqual({ fragments: 1, above: 'self', below: 'self' });
  if (size.width < 768) {
    // Điện thoại: như Mini App, câu và năm link vừa hai dòng chữ (dòng link 44px không làm khối cao thêm).
    const m = await consent.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { height: el.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom), lineHeight: parseFloat(cs.lineHeight) };
    });
    expect(m.height, `cao ${m.height}px, dòng ${m.lineHeight}px`).toBeLessThanOrEqual(m.lineHeight * 2 + 1);
  }

  const o = await overflow(page);
  expect(o, `cuộn ngang ở /thanh-toan ${size.width}px`).toEqual({ doc: 0, body: 0 });

  await consent.getByRole('link', { name: 'Chính sách bảo mật', exact: true }).click();
  await expect(page).toHaveURL(/\/chinh-sach\/bao-mat$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chính sách bảo mật');
});
