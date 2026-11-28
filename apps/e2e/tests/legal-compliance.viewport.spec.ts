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
/** Chân trang (w62-01): sáu lối Bộ Công Thương yêu cầu và điều khoản sử dụng; hướng dẫn mua hàng, kiểm hàng là neo trong trang điều khoản / đổi trả. */
const FOOTER_LINKS = [
  ['Hướng dẫn mua hàng', '/chinh-sach/dieu-khoan#dat-hang'],
  ['Thanh toán', '/chinh-sach/thanh-toan'],
  ['Vận chuyển', '/chinh-sach/van-chuyen'],
  ['Đổi trả', '/chinh-sach/doi-tra'],
  ['Kiểm hàng', '/chinh-sach/doi-tra#kiem-hang'],
  ['Bảo mật thông tin', '/chinh-sach/bao-mat'],
  ['Điều khoản sử dụng', '/chinh-sach/dieu-khoan'],
] as const;
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
  await expect(links).toHaveCount(FOOTER_LINKS.length);
  expect(await links.evaluateAll((as) => as.map((a) => a.getAttribute('href')))).toEqual(FOOTER_LINKS.map(([, href]) => href));
  for (const [label] of FOOTER_LINKS) await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
  // Lưới đều cột: mọi link cùng cột thẳng hàng, không link lẻ rớt dòng giữa chừng.
  const lefts = new Set(await links.evaluateAll((as) => as.map((a) => Math.round(a.getBoundingClientRect().left))));
  expect(lefts.size, 'số cột của lưới chính sách').toBe(wide ? 7 : 2);

  const company = footer.getByTestId('footer-company');
  await expect(company).toContainText(/.+ · MST \d{10} · Cấp ngày \d{2}\/\d{2}\/\d{4} tại .+/);
  await expect(footer.locator('a[href^="tel:"]').first()).toBeVisible();
  await expect(footer.locator('a[href^="mailto:"]').first()).toBeVisible();
  expect(await footer.innerText()).not.toMatch(/lorem|todo|\[[^\]]*\]|undefined|NaN/i);
  // Chưa có đường dẫn xác nhận thật thì không được hiện huy hiệu (phạt 20–40 triệu đồng nếu gắn sai).
  await expect(footer.getByText('Đã thông báo Bộ Công Thương')).toHaveCount(0);
}

for (const p of POLICIES) {
  base(`chính sách ${p.slug}: 200, chữ tiếng Việt thật, chân trang đủ lối chính sách, không cuộn ngang`, async ({ page, request }, testInfo) => {
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

mocked('thanh toán: dòng đồng ý mở tấm năm chính sách (Điều khoản, Chính sách bảo mật và ba chính sách còn lại); không cuộn ngang', async ({ page, api }, testInfo) => {
  const size = sizeOf(testInfo);
  const normal = STATES.find((s) => s.key === 'normal')!;
  await mockWorld(api, page, 'web', normal, Promise.resolve());
  await page.goto('/thanh-toan');
  await normal.ready(page, 'web');

  // tubu-w47-01: một dòng "Đặt đơn nghĩa là bạn đồng ý Điều khoản & Chính sách" là nút mở tấm năm chính sách (cùng Mini App), thay câu năm link.
  const consent = page.locator('[data-testid="order-consent"]:visible');
  await expect(consent).toHaveCount(1);
  await expect(consent).toHaveText('Đặt đơn nghĩa là bạn đồng ý Điều khoản & Chính sách');
  await consent.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const m = await consent.evaluate((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    // Nút có min-height 44px nên hộp nội dung cao hơn một dòng; đếm dòng chữ bằng Range, không bằng hộp nút.
    const range = document.createRange();
    range.selectNodeContents(el);
    const tops = new Set([...range.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top)));
    return { lines: tops.size, height: r.height };
  });
  expect(m.height, 'cả dòng là vùng chạm 44px').toBeGreaterThanOrEqual(44);
  if (size.width < 768) expect(m.lines, `câu đồng ý ${m.lines} dòng ở ${size.width}px: một dòng`).toBe(1);

  const o = await overflow(page);
  expect(o, `cuộn ngang ở /thanh-toan ${size.width}px`).toEqual({ doc: 0, body: 0 });

  await consent.click();
  const sheet = page.getByTestId('order-consent-policies');
  await expect(sheet).toBeVisible();
  const links = sheet.getByRole('link');
  expect(await links.evaluateAll((as) => as.map((a) => a.getAttribute('href')))).toEqual(HREFS);
  await expect(sheet.getByRole('link', { name: 'Điều khoản sử dụng', exact: true })).toBeVisible();
  for (const h of await links.evaluateAll((as) => as.map((a) => a.getBoundingClientRect().height))) {
    expect(h, 'mỗi chính sách chạm được 44px').toBeGreaterThanOrEqual(44);
  }
  await sheet.getByRole('link', { name: 'Chính sách bảo mật', exact: true }).click();
  await expect(page).toHaveURL(/\/chinh-sach\/bao-mat$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chính sách bảo mật');
});
