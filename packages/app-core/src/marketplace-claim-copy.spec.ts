import { describe, expect, it } from 'vitest';
import { MARKETPLACE_CLAIM_COPY, MARKETPLACE_CLAIM_WEB_COPY, claimDetail, claimResultDetail, claimStateView, isPastMilestone } from './marketplace-claim-copy';
import { EXTERNAL_CLAIM_REJECT_CODES } from './api/external-points';

describe('MARKETPLACE_CLAIM_COPY', () => {
  it('mỗi mã từ chối của API có đúng một câu tiếng Việt cho khách', () => {
    expect(Object.keys(MARKETPLACE_CLAIM_COPY.reject).sort()).toEqual([...EXTERNAL_CLAIM_REJECT_CODES].sort());
    for (const text of Object.values(MARKETPLACE_CLAIM_COPY.reject)) expect(text.trim().length).toBeGreaterThan(10);
  });

  it('điểm chờ cộng dùng số kiểu Việt; kết quả có hay không có tên sàn', () => {
    expect(MARKETPLACE_CLAIM_COPY.resultPoints(1250)).toBe('1.250 Điểm Xanh đang chờ cộng');
    expect(MARKETPLACE_CLAIM_COPY.resultClaimed('Shopee', 'SPX***789')).toBe('Đã ghi nhận đơn Shopee SPX***789');
    expect(MARKETPLACE_CLAIM_COPY.resultClaimed(null, 'SPX***789')).toBe('Đã ghi nhận đơn SPX***789');
  });
});

describe('MARKETPLACE_CLAIM_WEB_COPY', () => {
  it('nút đăng nhập đúng chữ PO duyệt', () => {
    expect(MARKETPLACE_CLAIM_WEB_COPY.loginCta).toBe('Đăng nhập để tích điểm');
  });

  it('nói thật điều kiện SĐT đã xác minh qua Zalo, không hứa thêm số ở Hồ sơ là đủ', () => {
    expect(MARKETPLACE_CLAIM_WEB_COPY.phoneBody).toContain('đã xác minh');
    expect(MARKETPLACE_CLAIM_WEB_COPY.notVerified).toContain('xác minh qua Zalo');
  });
});

describe('claimStateView / claimDetail / claimResultDetail (Mini và web cùng luật)', () => {
  const fmt = (iso: string) => iso.slice(0, 10);
  it('PENDING có mốc là chờ cộng, chưa có mốc là chờ giao; REVERSED, LAPSED có nhãn riêng', () => {
    expect(claimStateView({ state: 'PENDING', expectedCreditAt: '2026-12-01' })).toEqual({ label: 'Chờ cộng điểm', tone: 'info' });
    expect(claimStateView({ state: 'PENDING', expectedCreditAt: null })).toEqual({ label: 'Chờ giao hàng', tone: 'warning' });
    expect(claimStateView({ state: 'HELD_NO_MEMBER', expectedCreditAt: null }).label).toBe('Đang kiểm tra');
    expect(claimStateView({ state: 'REVERSED', expectedCreditAt: null }).label).toBe('Đã thu hồi');
    expect(claimStateView({ state: 'LAPSED', expectedCreditAt: null }).label).toBe('Hết hạn');
    expect(claimStateView({ state: 'VOIDED', expectedCreditAt: null })).toEqual({ label: 'Đã huỷ', tone: 'danger' });
  });
  it('dòng phụ: ngày cộng hoặc ngày dự kiến', () => {
    expect(claimDetail({ state: 'CREDITED', creditedAt: '2026-11-05T01:00:00Z', expectedCreditAt: null }, fmt)).toBe('Đã cộng 2026-11-05');
    expect(claimDetail({ state: 'PENDING', creditedAt: null, expectedCreditAt: '2026-12-01T00:00:00Z' }, fmt)).toBe('Dự kiến 2026-12-01');
    expect(claimDetail({ state: 'REVIEW', creditedAt: null, expectedCreditAt: null }, fmt)).toBeNull();
  });
  it('thẻ kết quả: tìm đơn, người khác dùng, kiểm tra, mốc đã qua dùng câu API, chưa giao xong', () => {
    const now = Date.parse('2026-11-27T00:00:00Z');
    const r = { claimId: 'c', channel: 'Shopee', maskedCode: 'SPX***789', points: 10, message: 'Đã cộng rồi' };
    expect(claimResultDetail({ ...r, status: 'SEARCHING', expectedCreditAt: null }, fmt, now)).toBe(MARKETPLACE_CLAIM_COPY.resultSearching);
    expect(claimResultDetail({ ...r, status: 'CLAIMED_BY_OTHER', expectedCreditAt: null }, fmt, now)).toBe(MARKETPLACE_CLAIM_COPY.resultClaimedByOther);
    expect(claimResultDetail({ ...r, status: 'REVIEW', expectedCreditAt: null }, fmt, now)).toBe(MARKETPLACE_CLAIM_COPY.resultReview);
    expect(claimResultDetail({ ...r, status: 'CLAIMED', expectedCreditAt: '2026-11-20T00:00:00Z' }, fmt, now)).toBe('Đã cộng rồi');
    expect(claimResultDetail({ ...r, status: 'CLAIMED', expectedCreditAt: '2026-12-01T00:00:00Z' }, fmt, now)).toBe('Dự kiến cộng từ 2026-12-01');
    expect(claimResultDetail({ ...r, status: 'CLAIMED', expectedCreditAt: null }, fmt, now)).toBe(MARKETPLACE_CLAIM_COPY.resultAfterDelivery);
    expect(isPastMilestone({ status: 'REVIEW', expectedCreditAt: '2026-11-20T00:00:00Z' }, now)).toBe(false);
  });
});
