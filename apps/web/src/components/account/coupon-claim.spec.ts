// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '@/lib/client-api';

const store = vi.hoisted(() => ({ data: {} as Record<string, string>, failSet: false }));
vi.mock('@/lib/platform-bridge', () => ({
  platformBridge: {
    storage: {
      get: async (k: string) => store.data[k] ?? null,
      set: async (k: string, v: string) => {
        if (store.failSet) throw new Error('blocked');
        store.data[k] = v;
      },
    },
  },
}));

import {
  PENDING_CLAIM_KEY,
  claimFailure,
  claimOfferLabel,
  clearPendingClaim,
  needsZaloLogin,
  readClaimParam,
  readPendingClaim,
  savePendingClaim,
  withoutClaimParam,
} from './coupon-claim';

beforeEach(() => {
  store.data = {};
  store.failSet = false;
});

// Chép services/coupon-claim.spec.ts (Mini App): cùng luật đọc mã từ link thẻ QR hộp hàng và cùng câu ưu đãi.
describe('readClaimParam: mã từ link thẻ QR hộp hàng (D2-03)', () => {
  it('đọc ?claim= ở search hoặc hash, chuẩn hoá chữ HOA', () => {
    expect(readClaimParam('?claim=shopee-ab12cd34', '')).toBe('SHOPEE-AB12CD34');
    expect(readClaimParam('', '#/?claim=TIKI10')).toBe('TIKI10');
    expect(readClaimParam('?utm_source=box', '#/product/a?claim=LAZ-X2Y3')).toBe('LAZ-X2Y3');
  });

  it('không có hoặc sai dạng (khoảng trắng, ký tự lạ, quá dài) thì null', () => {
    expect(readClaimParam('?s=shop', '#/')).toBeNull();
    expect(readClaimParam('?claim=', '')).toBeNull();
    expect(readClaimParam('?claim=AB', '')).toBeNull();
    expect(readClaimParam('?claim=A%20B%20C', '')).toBeNull();
    expect(readClaimParam(`?claim=${'A'.repeat(65)}`, '')).toBeNull();
    expect(readClaimParam('?claim=%3Cscript%3E', '')).toBeNull();
  });
});

describe('claimOfferLabel: câu ưu đãi trên sheet', () => {
  it('giảm tiền kèm đơn tối thiểu', () => {
    expect(claimOfferLabel({ type: 'AMOUNT', value: 30000, minOrder: 99000, maxDiscount: null })).toBe('Giảm 30.000đ cho đơn từ 99.000đ');
  });
  it('giảm % kèm trần', () => {
    expect(claimOfferLabel({ type: 'PERCENT', value: 10, minOrder: null, maxDiscount: 50000 })).toBe('Giảm 10% (tối đa 50.000đ)');
  });
  it('freeship', () => {
    expect(claimOfferLabel({ type: 'FREESHIP', value: 0, minOrder: 150000, maxDiscount: null })).toBe('Miễn phí giao hàng cho đơn từ 150.000đ');
  });
});

describe('withoutClaimParam: xoá ?claim= khỏi URL, giữ phần còn lại', () => {
  it('giữ các tham số khác và hash', () => {
    expect(withoutClaimParam('/san-pham/x?claim=AB12&ref=CTV1#gia')).toBe('/san-pham/x?ref=CTV1#gia');
  });
  it('hết tham số thì bỏ luôn dấu ?', () => {
    expect(withoutClaimParam('/?claim=AB12')).toBe('/');
  });
  it('link mã nằm trong hash cũng được xoá, giữ phần hash còn lại', () => {
    expect(withoutClaimParam('/#?claim=SHOPEE-AB12CD34')).toBe('/');
    expect(withoutClaimParam('/san-pham/x#claim=AB12&gia=1')).toBe('/san-pham/x#gia=1');
    expect(withoutClaimParam('/x#/product/a?claim=LAZ-X2Y3&r=1')).toBe('/x#/product/a?r=1');
  });
  it('không có claim thì giữ nguyên', () => {
    expect(withoutClaimParam('/gio-hang?a=1')).toBe('/gio-hang?a=1');
  });
});

describe('mã chờ nhận trên máy', () => {
  it('lưu rồi đọc lại; xoá thì không còn', async () => {
    await savePendingClaim('SHOPEE-AB12CD34');
    expect(store.data[PENDING_CLAIM_KEY]).toBe('SHOPEE-AB12CD34');
    expect(await readPendingClaim()).toBe('SHOPEE-AB12CD34');
    await clearPendingClaim();
    expect(await readPendingClaim()).toBeNull();
  });
  it('giá trị hỏng trong bộ nhớ thì bỏ qua', async () => {
    store.data[PENDING_CLAIM_KEY] = '<script>';
    expect(await readPendingClaim()).toBeNull();
  });
  it('không ghi được bộ nhớ thì không ném lỗi', async () => {
    store.failSet = true;
    await expect(savePendingClaim('SHOPEE-AB12CD34')).resolves.toBeUndefined();
    await expect(clearPendingClaim()).resolves.toBeUndefined();
  });
});

describe('claimFailure: lỗi nghiệp vụ không thử lại, lỗi tạm thì cho thử lại', () => {
  it('4xx: nói đúng lý do của máy chủ, không thử lại', () => {
    expect(claimFailure(new ApiError('Mã giảm giá này đã được tài khoản khác nhận.', 400))).toEqual({
      message: 'Mã giảm giá này đã được tài khoản khác nhận.',
      retryable: false,
    });
  });
  it('429: câu chờ vài giây, cho thử lại', () => {
    expect(claimFailure(new ApiError('ThrottlerException: Too Many Requests', 429))).toEqual({
      message: 'Bạn thao tác hơi nhanh, đợi vài giây rồi thử lại nhé.',
      retryable: true,
    });
  });
  it('5xx: không lộ message kỹ thuật, cho thử lại', () => {
    expect(claimFailure(new ApiError('Internal server error', 502))).toEqual({ message: 'Máy chủ đang bận, thử lại nhé.', retryable: true });
  });
  it('mất mạng hoặc quá thời gian: câu của lớp mạng, cho thử lại', () => {
    const r = claimFailure(new NetworkError(false));
    expect(r.retryable).toBe(true);
    expect(r.message).toBe(new NetworkError(false).message);
  });
  it('lỗi lạ: câu chung, không thử lại', () => {
    expect(claimFailure(new Error('boom'))).toEqual({ message: 'Có chút trục trặc, thử lại nhé', retryable: false });
  });
});

describe('needsZaloLogin', () => {
  it('nhận ra câu máy chủ đòi đăng nhập Zalo', () => {
    expect(needsZaloLogin('Cần đăng nhập Zalo để nhận mã.')).toBe(true);
    expect(needsZaloLogin('Mã đã hết hạn.')).toBe(false);
  });
});
