import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { vi } from './vi';

/**
 * D6-17: một khái niệm một cách gọi. Giỏ, trang sản phẩm, Trang chủ và kho mã cùng nói "Miễn phí giao hàng"
 * (khớp coupon-claim.ts), không xen "ship" hay "vận chuyển". Quét chuỗi chữ (không quét comment) của các file hiển thị.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..');
const FILES = [
  'i18n/vi.ts',
  'pages/cart.tsx',
  'pages/product-detail.tsx',
  'pages/loyalty.tsx',
  'components/home/new-customer-gift.tsx',
  'components/checkout/voucher-sheet.tsx',
];
const BAD = /miễn phí (?:ship|vận chuyển|giao(?! hàng))|chưa gồm ship|đã miễn phí ship/i;

function stringsOf(file: string): { line: number; text: string }[] {
  const src = fs.readFileSync(path.join(SRC, file), 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: { line: number; text: string }[] = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n) ||
      ts.isJsxText(n)
    ) {
      out.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, text: n.text ?? '' });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('"Miễn phí giao hàng" một cách ghi (D6-17)', () => {
  it.each(FILES)('%s: không còn "miễn phí ship / vận chuyển / giao" trong chữ hiển thị', (file) => {
    const bad = stringsOf(file)
      .filter((s) => BAD.test(s.text))
      .map((s) => `${file}:${s.line} ${s.text}`);
    expect(bad).toEqual([]);
  });

  it('giỏ hàng', () => {
    expect(vi.cart.freeshipReached).toContain('miễn phí giao hàng');
    expect(vi.cart.freeshipProgress('50.000đ')).toBe('Mua thêm 50.000đ để được miễn phí giao hàng');
    expect(vi.cart.subtotalAfterDiscount).not.toMatch(/ship/i);
  });

  it('Trang chủ khách mới', () => {
    const g = vi.home.newGift;
    expect(g.freeShipFirst).toBe('Miễn phí giao hàng cho đơn đầu tiên');
    expect(g.freeShipFirstFrom('199.000đ')).toBe('Miễn phí giao hàng cho đơn đầu tiên từ 199.000đ');
    expect(g.freeShipFrom('200.000đ')).toBe('Miễn phí giao hàng cho đơn từ 200.000đ');
  });
});
