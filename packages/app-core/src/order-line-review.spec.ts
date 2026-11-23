import { afterEach, describe, expect, it, vi } from 'vitest';
import { orderLineReviewSlot, revealReviewTarget, reviewFocusIndex, type RevealTarget, type ReviewLine } from './order-line-review';
import { wantsReviewFocus, withReviewFocus } from './order-review-cta';

const line = (over: Partial<ReviewLine> = {}): ReviewLine => ({ productSlug: 'sua-tam', quantity: 2, ...over });

describe('orderLineReviewSlot (tubu-w25-02, PO A5)', () => {
  it('món đã nhận chưa đánh giá, chưa trả → "Viết đánh giá" tới trang sản phẩm', () => {
    expect(orderLineReviewSlot('DELIVERED', line({ reviewable: true }))).toEqual({ kind: 'write', slug: 'sua-tam' });
    expect(orderLineReviewSlot('DELIVERED', line())).toEqual({ kind: 'write', slug: 'sua-tam' });
  });

  it('trả hết và tiền đã về → "Đã hoàn tiền", không có lối viết', () => {
    expect(orderLineReviewSlot('DELIVERED', line({ reviewable: false, returnedQty: 2, refundDone: true }))).toEqual({ kind: 'returned', label: 'Đã hoàn tiền' });
  });

  it('trả một phần, tiền đã về → ghi số đã hoàn trên số mua', () => {
    expect(orderLineReviewSlot('DELIVERED', line({ reviewable: false, returnedQty: 1, refundDone: true }))).toEqual({ kind: 'returned', label: 'Đã hoàn tiền 1/2' });
  });

  it('tiền chưa về (chuyển khoản còn chờ, lần trả 0đ, API cũ không gửi cờ) → "Đã duyệt trả n/q", không nói "hoàn tiền"', () => {
    expect(orderLineReviewSlot('DELIVERED', line({ reviewable: false, returnedQty: 2, refundDone: false }))).toEqual({ kind: 'returned', label: 'Đã duyệt trả 2/2' });
    expect(orderLineReviewSlot('DELIVERED', line({ reviewable: false, returnedQty: 1 }))).toEqual({ kind: 'returned', label: 'Đã duyệt trả 1/2' });
  });

  it('API trả reviewable=true nhầm mà dòng đã trả → vẫn không có lối viết (cùng luật thẻ đơn)', () => {
    expect(orderLineReviewSlot('DELIVERED', line({ reviewable: true, returnedQty: 2, refundDone: true }))?.kind).toBe('returned');
  });

  it('đã đánh giá trước khi trả → vẫn "Sửa đánh giá"', () => {
    expect(orderLineReviewSlot('DELIVERED', line({ reviewId: 'r1', reviewable: false, returnedQty: 1, refundDone: true }))).toEqual({ kind: 'edit', slug: 'sua-tam' });
  });

  it('trang sản phẩm đã gỡ → không có lối viết/sửa; đã trả vẫn hiện trạng thái', () => {
    expect(orderLineReviewSlot('DELIVERED', line({ productPublic: false }))).toBeNull();
    expect(orderLineReviewSlot('DELIVERED', line({ productSlug: null, reviewId: 'r1' }))).toBeNull();
    expect(orderLineReviewSlot('DELIVERED', line({ productSlug: null, returnedQty: 2, refundDone: true }))?.kind).toBe('returned');
  });

  it.each(['SHIPPING', 'RETURNED', 'CANCELLED'])('đơn %s → không có gì', (status) => {
    expect(orderLineReviewSlot(status, line({ returnedQty: 2, refundDone: true }))).toBeNull();
    expect(orderLineReviewSlot(status, line({ reviewId: 'r1' }))).toBeNull();
  });

  it('reviewable=false (quà, biến thể khác cùng sản phẩm đã trả) và không có số trả → không có gì', () => {
    expect(orderLineReviewSlot('DELIVERED', line({ reviewable: false }))).toBeNull();
    expect(orderLineReviewSlot('DELIVERED', line({ reviewable: false, returnedQty: 0 }))).toBeNull();
  });
});

describe('reviewFocusIndex', () => {
  it('bỏ món đã hoàn tiền, đã đánh giá, không mở được; trả vị trí món đầu tiên còn lối viết', () => {
    const items = [
      line({ reviewable: false, returnedQty: 2, refundDone: true }),
      line({ reviewId: 'r1', reviewable: false }),
      line({ productPublic: false }),
      line({ productSlug: 'nuoc-giat', reviewable: true }),
      line({ productSlug: 'xa-phong', reviewable: true }),
    ];
    expect(reviewFocusIndex({ status: 'DELIVERED', items })).toBe(3);
  });

  it('không còn món nào hoặc đơn chưa nhận → -1', () => {
    expect(reviewFocusIndex({ status: 'DELIVERED', items: [line({ reviewable: false, returnedQty: 1 })] })).toBe(-1);
    expect(reviewFocusIndex({ status: 'SHIPPING', items: [line()] })).toBe(-1);
  });
});

describe('tham số review=1', () => {
  it('withReviewFocus thêm đúng một tham số; wantsReviewFocus chỉ nhận review=1', () => {
    expect(withReviewFocus('/tai-khoan/don-hang/TT1')).toBe('/tai-khoan/don-hang/TT1?review=1');
    expect(withReviewFocus('/order/TT1?x=2')).toBe('/order/TT1?x=2&review=1');
    expect(wantsReviewFocus('?review=1')).toBe(true);
    expect(wantsReviewFocus('?a=b&review=1')).toBe(true);
    expect(wantsReviewFocus('?review=0')).toBe(false);
    expect(wantsReviewFocus('')).toBe(false);
    expect(wantsReviewFocus(undefined)).toBe(false);
  });
});

describe('revealReviewTarget', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setup(reduce: boolean | null) {
    if (reduce !== null) vi.stubGlobal('window', { matchMedia: (q: string) => ({ matches: reduce && q === '(prefers-reduced-motion: reduce)' }) });
    const scroll = vi.fn();
    const rowFocus = vi.fn();
    const ctaFocus = vi.fn();
    const row: RevealTarget = { scrollIntoView: scroll, focus: rowFocus };
    const cta: RevealTarget = { focus: ctaFocus };
    return { row, cta, scroll, rowFocus, ctaFocus };
  }

  it('cuộn mượt món vào giữa màn, focus nút viết mà không cuộn lần nữa', () => {
    const { row, cta, scroll, ctaFocus, rowFocus } = setup(false);
    revealReviewTarget(row, cta);
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(ctaFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(rowFocus).not.toHaveBeenCalled();
  });

  it('giảm chuyển động → nhảy thẳng (behavior auto)', () => {
    const { row, cta, scroll } = setup(true);
    revealReviewTarget(row, cta);
    expect(scroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
  });

  it('không có nút → focus chính hàng; môi trường không có window vẫn cuộn mượt', () => {
    const { row, scroll, rowFocus } = setup(null);
    revealReviewTarget(row, null);
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(rowFocus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
