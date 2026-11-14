import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Ô số giảm của hàng mã (`data-testid="coupon-discount"`) KHÔNG được dùng số đều (tabular-nums / tubu-nums / fontVariantNumeric): số đều rộng thêm khoảng 1px
 * trên phông CI Linux và hàng mã ở 320px mất khoảng tới nút "Thay đổi" (còn 11,0px, cần >= 12; `coupon-row-checkout-320.web.spec.ts`). Lỗi đã lặp ở W38A, W71A và W130.
 * Cổng này quét nguồn ở cả web và Mini App; số vị trí tìm thấy được khoá để cổng không đậu rỗng khi ai đó đổi tên hay chuyển ô.
 */
const root = join(__dirname, '../../../..');
const SITES: readonly (readonly [file: string, count: number])[] = [
  ['apps/web/src/components/coupon-box.tsx', 2],
  ['apps/miniapp/src/pages/cart.tsx', 1],
  ['apps/miniapp/src/pages/checkout.tsx', 1],
];
const TESTID = 'data-testid="coupon-discount"';
const FORBIDDEN = /tabular-nums|tubu-nums|fontVariantNumeric|font-variant-numeric/;

/** Thẻ mở chứa testid: từ `<` gần nhất trước nó tới `>` đầu tiên sau nó (thuộc tính style/className của hai app không chứa `>`). */
function openingTags(src: string): string[] {
  const tags: string[] = [];
  for (let i = src.indexOf(TESTID); i !== -1; i = src.indexOf(TESTID, i + 1)) tags.push(src.slice(src.lastIndexOf('<', i), src.indexOf('>', i) + 1));
  return tags;
}

describe('coupon-discount không dùng số đều (tabular-nums) ở web và Mini App', () => {
  it.each(SITES)('%s: đủ %i ô coupon-discount và không ô nào có số đều', (file, count) => {
    const tags = openingTags(readFileSync(join(root, file), 'utf8'));
    expect(tags, `không thấy đủ ô coupon-discount trong ${file}`).toHaveLength(count);
    for (const tag of tags) expect(tag).not.toMatch(FORBIDDEN);
  });

  it('bộ dò bắt được lỗi: tag có tabular-nums hay fontVariantNumeric thì khớp', () => {
    expect(openingTags(`<span ${TESTID} className="shrink-0 tabular-nums">`)[0]).toMatch(FORBIDDEN);
    expect(openingTags(`<Text size="xSmall" ${TESTID} style={{ fontVariantNumeric: 'tabular-nums' }}>`)[0]).toMatch(FORBIDDEN);
    expect(openingTags(`<span ${TESTID} className="tubu-nums">`)[0]).toMatch(FORBIDDEN);
    expect(openingTags(`<span ${TESTID} className="shrink-0 whitespace-nowrap">`)[0]).not.toMatch(FORBIDDEN);
  });
});
