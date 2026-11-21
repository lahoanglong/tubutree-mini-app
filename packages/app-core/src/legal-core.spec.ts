import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEGAL_SUPPORT,
  DEFAULT_LEGAL_VARS,
  LEGAL_SLUGS,
  TUBU_TREE_MERCHANT,
  isLegalSlug,
  legalSummary,
  legalWebAddress,
  type LegalVars,
} from './legal-core';
import { defaultLegalContent } from './legal';

const WEB = 'https://app.tubutree.com/';
const VARS: LegalVars = { ...DEFAULT_LEGAL_VARS, ...TUBU_TREE_MERCHANT };

describe('legalWebAddress — địa chỉ bản đầy đủ chỉ để đọc, không có giao thức', () => {
  it('bỏ https:// và dấu / cuối', () => {
    expect(legalWebAddress('doi-tra', WEB)).toBe('app.tubutree.com/chinh-sach/doi-tra');
    expect(legalWebAddress('bao-mat', 'http://localhost:3000')).toBe('localhost:3000/chinh-sach/bao-mat');
  });
});

describe('legalSummary — bản tóm tắt Mini App khi chưa có nội dung đã duyệt', () => {
  it.each(LEGAL_SLUGS)('%s: có đơn vị vận hành đủ tên, MST, địa chỉ, hotline, email và địa chỉ bản đầy đủ', (slug) => {
    const text = legalSummary(slug, VARS, DEFAULT_LEGAL_SUPPORT, WEB);
    expect(text).toContain(`Đơn vị vận hành: ${TUBU_TREE_MERCHANT.legalName}`);
    expect(text).toContain(`Mã số thuế: ${TUBU_TREE_MERCHANT.taxCode}`);
    expect(text).toContain(`Địa chỉ: ${TUBU_TREE_MERCHANT.address}`);
    expect(text).toContain(`Hotline: ${DEFAULT_LEGAL_SUPPORT.hotline}`);
    expect(text).toContain(`Email: ${DEFAULT_LEGAL_SUPPORT.email}`);
    expect(text).toContain(`Bản đầy đủ đăng tại app.tubutree.com/chinh-sach/${slug}.`);
    expect(text).not.toMatch(/\[[^\]]*\](?!\()/);
    expect(text).not.toMatch(/undefined|NaN|\[object Object\]/);
  });

  it.each(LEGAL_SLUGS)('%s: mọi liên kết là chính sách khác có thật, không trỏ ra ngoài', (slug) => {
    const links = [...legalSummary(slug, VARS, DEFAULT_LEGAL_SUPPORT, WEB).matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1] ?? '');
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) {
      const target = /^\/chinh-sach\/([a-z-]+)$/.exec(href)?.[1];
      expect(target && isLegalSlug(target) && target !== slug, href).toBe(true);
    }
  });

  it('mỗi bản tóm tắt ngắn hơn bản nháp đầy đủ, cả năm cộng lại chưa tới một nửa (Mini không mang bản đầy đủ)', () => {
    const summary = LEGAL_SLUGS.map((slug) => legalSummary(slug, VARS, DEFAULT_LEGAL_SUPPORT, WEB).length);
    const full = LEGAL_SLUGS.map((slug) => defaultLegalContent(slug, VARS, DEFAULT_LEGAL_SUPPORT).length);
    summary.forEach((n, i) => expect(n, LEGAL_SLUGS[i]).toBeLessThan(full[i]!));
    expect(summary.reduce((a, b) => a + b, 0) * 2).toBeLessThan(full.reduce((a, b) => a + b, 0));
  });

  it('đổi trả đọc số ngày từ vars và nói cùng câu thời hạn báo với bản đầy đủ', () => {
    const vars = { ...VARS, returnWindowDays: 14 };
    const text = legalSummary('doi-tra', vars, DEFAULT_LEGAL_SUPPORT, WEB);
    expect(text).toContain('trong vòng 14 ngày kể từ khi đơn được giao thành công');
    expect(text).toContain('hư hỏng, đổ vỡ');
    expect(text).toContain('Tubu Tree chịu phí vận chuyển đổi trả');
    expect(text).toContain('Ví Tubu hoặc tài khoản ngân hàng bạn chọn, trong 7 ngày làm việc');
    const deadline = /Thời hạn báo: [^\n]+/.exec(text)?.[0];
    expect(deadline).toBeTruthy();
    expect(defaultLegalContent('doi-tra', vars, DEFAULT_LEGAL_SUPPORT)).toContain(deadline!);
  });

  it('đổi trả 0 ngày: không hứa thời hạn đổi trả', () => {
    const text = legalSummary('doi-tra', { ...VARS, returnWindowDays: 0 }, DEFAULT_LEGAL_SUPPORT, WEB);
    expect(text).toContain('chưa nhận yêu cầu đổi trả sau khi giao hàng thành công');
    expect(text).not.toMatch(/trong vòng \d+ ngày/);
  });

  it('vận chuyển: mức miễn phí, phí cố định và lịch giao giống hệt bản đầy đủ', () => {
    const vars: LegalVars = { ...VARS, freeshipThreshold: 249_000, shippingFlatFee: 25_000, delivery: { cutoff: '14:00', workDays: [1, 2, 3, 4, 5], hcmDays: [1, 1], provinceDays: [3, 5] } };
    const text = legalSummary('van-chuyen', vars, DEFAULT_LEGAL_SUPPORT, WEB);
    expect(text).toContain('từ 249.000đ được miễn phí vận chuyển');
    expect(text).toContain('phí cố định 25.000đ');
    expect(text).toContain('Chính sách kiểm hàng khi nhận hàng');
    const full = defaultLegalContent('van-chuyen', vars, DEFAULT_LEGAL_SUPPORT);
    for (const line of text.split('\n').filter((l) => /Nội thành|Tỉnh thành khác|Kho Tubu Tree xuất hàng/.test(l))) expect(full).toContain(line);
    expect(text).toContain('1 ngày làm việc');
    expect(text).toContain('3–5 ngày làm việc');
  });

  it('vận chuyển: ngưỡng 0 thì mọi đơn miễn phí, phí 0 thì không thu phí dưới ngưỡng', () => {
    expect(legalSummary('van-chuyen', { ...VARS, freeshipThreshold: 0 }, DEFAULT_LEGAL_SUPPORT, WEB)).toContain('Mọi phần hàng do Tubu Tree giao đều được miễn phí vận chuyển');
    expect(legalSummary('van-chuyen', { ...VARS, shippingFlatFee: 0 }, DEFAULT_LEGAL_SUPPORT, WEB)).toContain('Chưa đạt mức này cũng không mất phí vận chuyển');
  });

  it('thanh toán nêu COD, VietQR, Ví Tubu; bảo mật nêu căn cứ Nghị định 52/2013', () => {
    const pay = legalSummary('thanh-toan', VARS, DEFAULT_LEGAL_SUPPORT, WEB);
    for (const s of ['Thanh toán khi nhận hàng (COD)', 'VietQR', 'Ví Tubu', 'không lưu số thẻ']) expect(pay).toContain(s);
    expect(legalSummary('bao-mat', VARS, DEFAULT_LEGAL_SUPPORT, WEB)).toContain('52/2013/NĐ-CP');
  });

  it('legal-core.ts không import legal.ts (bản nháp đầy đủ) nên Mini import nó không kéo ~22 KB chữ', () => {
    const src = readFileSync(new URL('./legal-core.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from\s+['"]\.\/legal['"]/);
    expect(src).not.toMatch(/function (dieuKhoan|baoMat|doiTra|vanChuyen|thanhToan)\b/);
  });
});
