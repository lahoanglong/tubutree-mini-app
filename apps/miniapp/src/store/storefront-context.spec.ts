// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useStorefrontContext } from './storefront-context';

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
