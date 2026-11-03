import { expect, type Locator } from '@playwright/test';

/**
 * Bộ phiếu giả và các phép đo chiều cao phiếu mã giảm giá ở 375px, dùng chung cho voucher-ticket-height.miniapp.spec.ts và voucher-ticket-height.web.spec.ts (cùng bộ mock: 88/98/138px).
 * Mô tả thiết kế và số đo nằm ở đầu hai spec đó.
 */
const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();

// Nhãn dài nhất của bộ ("Giảm 99%, tối đa 99k") phải còn dư chỗ trong cột nội dung: với "tối đa 999k" nhãn chỉ vừa khít 159,5px trên Mac và gãy dòng trên Linux CI (phiếu 120px), nên bắt nhầm phông chứ không bắt lỗi giao diện.
export const WALLET_TICKETS = [
  { code: 'NHANSHIP', title: 'Miễn phí giao hàng đơn từ 99.000đ', type: 'FREESHIP', value: 0, minOrder: 99_000, maxDiscount: null, endAt: inDays(2) },
  { code: 'NHAN10', title: 'Giảm 10% tối đa 50.000đ', type: 'PERCENT', value: 10, minOrder: 300_000, maxDiscount: 50_000, endAt: inDays(12) },
  { code: 'NHANXANH20K', title: 'Giảm 20.000đ đơn từ 150.000đ', type: 'AMOUNT', value: 20_000, minOrder: 150_000, maxDiscount: null, endAt: inDays(6) },
  { code: 'BEPXANH15', title: 'Chương trình tri ân khách hàng thân thiết mùa thu', type: 'PERCENT', value: 15, minOrder: 250_000, maxDiscount: 45_000, endAt: inDays(30) },
  { code: 'QUAKHACHMOI', title: 'Quà khách mới', type: 'AMOUNT', value: 30_000, minOrder: 0, maxDiscount: null, endAt: inDays(20) },
  { code: 'TUBU99', title: null, type: 'PERCENT', value: 99, minOrder: 999_000, maxDiscount: 99_000, endAt: inDays(40) },
  { code: 'GIAM20', title: 'Giảm 20k cho 3 đơn', type: 'AMOUNT', value: 20_000, minOrder: 100_000, maxDiscount: null, endAt: inDays(14) },
];

// Hàng đáy (hạn dùng · số lượt · mã) là một hàng `flex-wrap`: mã dài thì gãy xuống dòng riêng và phiếu cao thêm đúng một dòng caption (20px).
// Phiếu thường tối đa 96px; phiếu có hàng đáy gãy tối đa 104px (dòng caption 20px, đệm 8px); trong một danh sách chênh nhau không quá 16px.
const NORMAL_MAX = 96;
const FOOT_WRAP_MAX = 104;
const FOOT_LINE = 24; // hàng đáy một dòng cao 20px, hai dòng 40px

export async function expectCompactTickets(groups: Locator, expected: number) {
  await expect(groups).toHaveCount(expected, { timeout: 15_000 });
  const rows = await groups.evaluateAll((els) =>
    els.map((el) => {
      const title = el.querySelector<HTMLElement>('[data-testid="voucher-body"]')!.firstElementChild as HTMLElement;
      const foot = el.querySelector<HTMLElement>('[data-testid="voucher-foot"]');
      const name = el.querySelector<HTMLElement>('[data-testid="voucher-name"]');
      return {
        code: el.querySelector('[data-testid="voucher-code"]')?.textContent ?? '?',
        h: Math.round(el.getBoundingClientRect().height),
        titleH: Math.round(title.getBoundingClientRect().height),
        footH: foot ? Math.round(foot.getBoundingClientRect().height) : 0,
        nameH: name ? Math.round(name.getBoundingClientRect().height) : 0,
        text: el.textContent ?? '',
      };
    }),
  );
  for (const r of rows) {
    const max = r.footH > FOOT_LINE ? FOOT_WRAP_MAX : NORMAL_MAX; // trần cũ cho phần còn lại; hàng tên riêng cộng thêm đúng chiều cao của nó nên trừ ra
    expect(r.h, `${r.code}: phiếu cao ${r.h}px`).toBeGreaterThanOrEqual(88);
    expect(r.h - r.nameH, `${r.code}: phiếu cao ${r.h}px trừ hàng tên ${r.nameH}px (hàng đáy ${r.footH}px)`).toBeLessThanOrEqual(max);
    expect(r.nameH, `${r.code}: tên quá hai dòng (${r.nameH}px)`).toBeLessThanOrEqual(2 * 20 + 1);
    expect(r.titleH, `${r.code}: nhãn gãy dòng (${r.titleH}px)`).toBeLessThanOrEqual(24);
    // Một cách ghi số: phiếu rút gọn "99k", không còn "99.000đ" trên cùng phiếu.
    expect(/\d\.\d{3}đ/.test(r.text), `${r.code}: còn số đầy đủ "${r.text}"`).toBe(false);
  }
  // Phiếu không tên vẫn đều nhau; phiếu có tên cao hơn đúng chiều cao hàng tên (kiểm ở trên).
  const plain = rows.filter((r) => r.nameH === 0).map((r) => r.h);
  expect(plain.length, 'cần ít nhất hai phiếu không tên để so').toBeGreaterThan(1);
  expect(Math.max(...plain) - Math.min(...plain), `chênh cao phiếu tên một dòng: ${plain.join(', ')}`).toBeLessThanOrEqual(16);
}

/** Nút chính nằm trọn trong phiếu và các nút cùng nhãn ("Lưu mã", "Dùng ngay") cùng bề rộng: tên dài (hai dòng) không đẩy hay ép nút. */
export async function expectButtonsStable(groups: Locator) {
  const m = await groups.evaluateAll((els) =>
    els.map((el) => {
      const box = el.getBoundingClientRect();
      const b = el.querySelector('button')!.getBoundingClientRect();
      return { code: el.querySelector('[data-testid="voucher-code"]')?.textContent ?? '?', label: el.querySelector('button')!.textContent ?? '', w: Math.round(b.width), inside: b.left >= box.left && b.right <= box.right && b.top >= box.top && b.bottom <= box.bottom, over: el.scrollWidth - el.clientWidth };
    }),
  );
  for (const r of m) {
    expect(r.inside, `${r.code}: nút ra ngoài phiếu`).toBe(true);
    expect(r.over, `${r.code}: phiếu tràn ngang`).toBeLessThanOrEqual(0);
  }
  for (const label of new Set(m.map((r) => r.label))) {
    const widths = m.filter((r) => r.label === label).map((r) => r.w);
    expect(Math.max(...widths) - Math.min(...widths), `bề rộng nút "${label}": ${widths.join(', ')}`).toBeLessThanOrEqual(1);
  }
}

// Kho "Nhận mã": một phiếu có tên admin, mã dài và "Còn 3 lượt" (mọi thứ cùng lúc), một phiếu trơn, một Miễn phí giao hàng có tên lặp số.
export const COLLECT_TICKETS = [
  { code: 'NHANLOCXANH2026', title: 'Quà tri ân khách hàng thân thiết mùa thu', type: 'AMOUNT', value: 50_000, minOrder: 300_000, maxDiscount: null, startAt: inDays(-1), endAt: inDays(5), newCustomerOnly: false, claimedCount: 7, usageLimit: 10 },
  { code: 'NHAN10', title: null, type: 'PERCENT', value: 10, minOrder: 200_000, maxDiscount: 40_000, startAt: inDays(-1), endAt: inDays(20), newCustomerOnly: false, claimedCount: 0, usageLimit: null },
  { code: 'FS99', title: 'Miễn phí giao hàng đơn từ 99.000đ', type: 'FREESHIP', value: 0, minOrder: 99_000, maxDiscount: null, startAt: inDays(-1), endAt: inDays(2), newCustomerOnly: false, claimedCount: 0, usageLimit: null },
  { code: 'GIAM20', title: 'Giảm 20k cho 3 đơn', type: 'AMOUNT', value: 20_000, minOrder: 100_000, maxDiscount: null, startAt: inDays(-1), endAt: inDays(14), newCustomerOnly: false, claimedCount: 0, usageLimit: null },
];

// "3 đơn" là thông tin mà phiếu không có chỗ nào khác để nói: hàng tên (riêng, dưới nhãn, trước điều kiện) phải hiện trọn phần mới, không "…".
export async function expectNameVisibleWhole(groups: Locator) {
  const name = groups.getByTestId('voucher-name').filter({ hasText: 'cho 3 đơn' });
  await expect(name).toBeVisible({ timeout: 15_000 });
  await expect(name).toHaveText('cho 3 đơn');
  const whole = await name.evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(whole, 'tên "cho 3 đơn" bị cắt bằng "…"').toBe(true);
}

export const LONG_NAME = 'Quà tri ân khách hàng thân thiết mùa thu'; // 40 ký tự

/** 320px (máy nhỏ nhất của Zalo): mã dài không bị cắt, tên không quá hai dòng và không đẩy nút ra ngoài phiếu. `panel` là khung "Nhận mã". */
export async function expectNarrowTickets(panel: Locator) {
  const code = panel.getByTestId('voucher-code').filter({ hasText: 'NHANLOCXANH2026' });
  await expect(code).toBeVisible({ timeout: 15_000 });
  const fits = await code.evaluate((el) => {
    const c = el.getBoundingClientRect();
    const t = el.closest('[role="group"]')!.getBoundingClientRect();
    return c.left >= t.left && c.right <= t.right && el.scrollWidth <= el.clientWidth + 1;
  });
  expect(fits, 'mã tràn ra ngoài phiếu').toBe(true);
  const groups = panel.getByRole('group');
  const name = panel.getByTestId('voucher-name').filter({ hasText: LONG_NAME }).first();
  expect((await name.boundingBox())!.height).toBeLessThanOrEqual(41);
  await expectButtonsStable(groups);
}
