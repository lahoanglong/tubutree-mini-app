// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCtvTouched, updateCtvTouchMark, useStorefrontContext, wasCtvTouched } from './storefront-context';

const ctx = () => useStorefrontContext.getState();

describe('storefront-context: referralEligible (mã giới thiệu có thật sự là của CTV)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    ctx().clear();
  });

  it('mới mở link ?ref=: chưa biết (null), không coi là đã xác nhận', () => {
    ctx().setContext({ slug: null, referralCode: 'KHACH01' });
    expect(ctx().referralEligible).toBeNull();
  });

  it('chạm giới thiệu trả ok:false → false; ok:true → true', () => {
    ctx().setContext({ referralCode: 'KHACH01' });
    ctx().confirmReferral('KHACH01', false);
    expect(ctx().referralEligible).toBe(false);
    ctx().setContext({ referralCode: 'CTV0001' });
    expect(ctx().referralEligible).toBeNull();
    ctx().confirmReferral('ctv0001', true);
    expect(ctx().referralEligible).toBe(true);
  });

  it('kết quả của mã cũ đến muộn không đè mã mới', () => {
    ctx().setContext({ referralCode: 'CU' });
    ctx().setContext({ referralCode: 'MOI' });
    ctx().confirmReferral('CU', false);
    expect(ctx().referralEligible).toBeNull();
  });

  it('đổi sang mã khác thì quên kết quả cũ; giữ nguyên mã (mở lại link) thì giữ kết quả đã biết', () => {
    ctx().setContext({ referralCode: 'CTV0001' });
    ctx().confirmReferral('CTV0001', true);
    ctx().setContext({ referralCode: 'CTV0001' });
    expect(ctx().referralEligible).toBe(true);
    ctx().setContext({ referralCode: 'CTV0002' });
    expect(ctx().referralEligible).toBeNull();
  });

  it('gian hàng CTV báo biết trước là hợp lệ, nhưng kết quả đã biết của chính mã đó (vd chính chủ) thắng', () => {
    ctx().setContext({ slug: 'an', referralCode: 'AN123', kind: 'ctv', referralEligible: true });
    expect(ctx().referralEligible).toBe(true);
    ctx().confirmReferral('AN123', false);
    ctx().setContext({ slug: 'an', referralCode: 'AN123', kind: 'ctv', referralEligible: true });
    expect(ctx().referralEligible).toBe(false);
  });

  it('trang nhãn/đối tác không có mã: không xoá mã và kết quả đang có', () => {
    ctx().setContext({ referralCode: 'CTV0001' });
    ctx().confirmReferral('CTV0001', true);
    ctx().setContext({ slug: 'doi-tac', kind: 'brand' });
    expect(ctx().referralCode).toBe('CTV0001');
    expect(ctx().referralEligible).toBe(true);
  });

  it('không có mã giới thiệu thì không có gì để xác nhận', () => {
    ctx().setContext({ slug: 'an', kind: 'ctv' });
    ctx().confirmReferral('an', true);
    expect(ctx().referralEligible).toBeNull();
  });

  it('bản lưu cũ trong phiên (chưa có trường này) đọc ra null; clear() về null', () => {
    ctx().setContext({ referralCode: 'CTV0001' });
    ctx().confirmReferral('CTV0001', true);
    expect(JSON.parse(sessionStorage.getItem('tubu_sf_ctx')!).referralEligible).toBe(true);
    ctx().clear();
    expect(ctx().referralEligible).toBeNull();
  });
});

describe('storefront-context: lúc bấm link và dấu chạm theo người dùng', () => {
  beforeEach(() => {
    sessionStorage.clear();
    ctx().clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('mở link ghi lúc bấm; điều hướng cùng mã giữ lúc bấm đầu, mở lại từ link (clickedAt tường minh) làm mới, mã mới thì ghi lại', () => {
    ctx().setContext({ referralCode: 'AN123' });
    const first = ctx().clickedAt;
    expect(first).toBe(Date.parse('2026-10-31T10:00:00Z'));
    vi.setSystemTime(new Date('2026-10-31T12:00:00Z'));
    ctx().setContext({ slug: 'an', kind: 'ctv' });
    expect(ctx().clickedAt).toBe(first);
    ctx().setContext({ referralCode: 'AN123', clickedAt: Date.now() });
    expect(ctx().clickedAt).toBe(Date.parse('2026-10-31T12:00:00Z'));
    ctx().setContext({ referralCode: 'BINH9' });
    expect(ctx().clickedAt).toBe(Date.parse('2026-10-31T12:00:00Z'));
  });

  it('không có mã giới thiệu thì không có lúc bấm; clear() về null; bản lưu cũ đọc ra null', () => {
    ctx().setContext({ slug: 'doi-tac', kind: 'brand' });
    expect(ctx().clickedAt).toBeNull();
    ctx().setContext({ referralCode: 'AN123' });
    ctx().clear();
    expect(ctx().clickedAt).toBeNull();
  });

  it('dấu chạm gắn người dùng, dấu dạng cũ (chỉ mã) không còn tính', () => {
    updateCtvTouchMark('u1', 'AN123', 'ctv', true);
    expect(wasCtvTouched('u1', 'AN123')).toBe(true);
    expect(wasCtvTouched('u2', 'AN123')).toBe(false);
    sessionStorage.setItem('tubu_sf_ctv_touched', 'AN123');
    expect(wasCtvTouched('u1', 'AN123')).toBe(false);
  });

  it('dấu đổi theo máy chủ: brand ghi công mã khác xoá dấu; ok:false giữ nguyên; clearCtvTouched xoá hẳn', () => {
    updateCtvTouchMark('u1', 'AN123', 'ctv', true);
    updateCtvTouchMark('u1', 'KHACH', 'brand', false);
    expect(wasCtvTouched('u1', 'AN123')).toBe(true);
    updateCtvTouchMark('u1', 'BINH9', 'brand', true);
    expect(wasCtvTouched('u1', 'AN123')).toBe(false);
    updateCtvTouchMark('u1', 'AN123', 'ctv', true);
    clearCtvTouched();
    expect(wasCtvTouched('u1', 'AN123')).toBe(false);
  });
});
