import { describe, expect, it } from 'vitest';
import {
  MARKETPLACE_CLAIM_COPY,
  MARKETPLACE_CLAIM_WEB_COPY,
  PHONE_CONFIRM_COPY,
  claimDetail,
  claimResultDetail,
  claimStateView,
  isPastMilestone,
  marketplaceChannelName,
  phoneConfirmErrorText,
  retryDoneView,
} from './marketplace-claim-copy';
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

  it('SĐT tự gõ trên web: không còn câu "CSKH đối chiếu" (W59, khớp SĐT là chờ cộng ngay); vẫn mời xác minh trên Zalo', () => {
    expect('unverifiedNote' in MARKETPLACE_CLAIM_WEB_COPY).toBe(false);
    expect(MARKETPLACE_CLAIM_WEB_COPY.phoneAlt).toContain('xác minh số trên Zalo');
    expect(MARKETPLACE_CLAIM_WEB_COPY.notVerified).toContain('xác minh qua Zalo');
  });

  it('camera trước (W46): hai lối phụ và câu nhắc trong khung đúng chữ đề bài', () => {
    expect(MARKETPLACE_CLAIM_WEB_COPY.photoCta).toBe('Chụp / chọn ảnh');
    expect(MARKETPLACE_CLAIM_WEB_COPY.manualCta).toBe('Nhập mã thủ công');
    expect(MARKETPLACE_CLAIM_WEB_COPY.cameraStart).toBe('Bật camera quét ngay');
    expect(MARKETPLACE_CLAIM_WEB_COPY.viewfinderHint).toBe('Đưa mã vạch/QR trên phiếu giao hàng vào khung');
  });

  it('câu cắt gọn (W46): tối đa 12 từ', () => {
    const words = (t: string) => t.trim().split(/\s+/).length;
    for (const t of [MARKETPLACE_CLAIM_COPY.inputHelp, MARKETPLACE_CLAIM_COPY.scanNoCode, MARKETPLACE_CLAIM_WEB_COPY.notVerified]) {
      expect(words(t)).toBeLessThanOrEqual(12);
    }
  });
});

describe('PHONE_CONFIRM_COPY (W46): xác nhận 4 số cuối SĐT người nhận', () => {
  it('chữ đúng đề bài, tên sàn theo channel', () => {
    expect(PHONE_CONFIRM_COPY.title).toBe('Xác nhận SĐT nhận hàng');
    expect(PHONE_CONFIRM_COPY.label(marketplaceChannelName('shopee'))).toBe('Nhập 4 số cuối SĐT nhận hàng trên đơn Shopee');
    expect(PHONE_CONFIRM_COPY.label(marketplaceChannelName('tiktok'))).toBe('Nhập 4 số cuối SĐT nhận hàng trên đơn TikTok Shop');
    expect(PHONE_CONFIRM_COPY.label(marketplaceChannelName('lazada'))).toBe('Nhập 4 số cuối SĐT nhận hàng trên đơn Lazada');
    expect(PHONE_CONFIRM_COPY.label(marketplaceChannelName(null))).toBe('Nhập 4 số cuối SĐT nhận hàng trên đơn sàn TMĐT');
    expect(PHONE_CONFIRM_COPY.note('Shopee')).toBe(
      'Đây là số người nhận ghi trên đơn Shopee, có thể khác số tài khoản của bạn.',
    );
    expect(PHONE_CONFIRM_COPY.submit).toBe('Xác nhận & Tích điểm');
    expect(PHONE_CONFIRM_COPY.other).toBe('Quét đơn khác');
  });

  it('sàn lạ (không có trong bảng) dùng tên chung, không in nguyên giá trị API', () => {
    expect(marketplaceChannelName('tiki')).toBe('sàn TMĐT');
    expect(marketplaceChannelName(undefined)).toBe('sàn TMĐT');
  });

  it('câu lỗi theo mã: sai kèm lượt còn lại, khoá, lần hỏi đầu không báo lỗi', () => {
    expect(phoneConfirmErrorText('PHONE_CONFIRM_REQUIRED', null)).toBeNull();
    // W59: đúng lời PO 28/11, kèm lượt còn lại khi máy chủ gửi.
    expect(phoneConfirmErrorText('PHONE_CONFIRM_WRONG', 2)).toBe(
      'Số điện thoại nhận hàng chưa khớp — kiểm tra lại 4 số cuối trên phiếu giao hàng rồi thử lại (còn 2 lượt).',
    );
    expect(phoneConfirmErrorText('PHONE_CONFIRM_WRONG', null)).toBe('Số điện thoại nhận hàng chưa khớp — kiểm tra lại 4 số cuối trên phiếu giao hàng rồi thử lại.');
    expect(phoneConfirmErrorText('PHONE_CONFIRM_WRONG', 0)).toBe(PHONE_CONFIRM_COPY.wrongNoCount);
    expect(phoneConfirmErrorText('PHONE_CONFIRM_LOCKED', 0)).toBe(PHONE_CONFIRM_COPY.locked);
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
    // W59: REVIEW chỉ vì SĐT không hiện "Đang kiểm tra" mà mời khách tự nhập 4 số cuối.
    expect(claimStateView({ state: 'REVIEW', expectedCreditAt: null, phoneRetry: true })).toEqual({ label: 'Nhập 4 số cuối', tone: 'warning' });
    expect(claimStateView({ state: 'REVIEW', expectedCreditAt: null })).toEqual({ label: 'Đang kiểm tra', tone: 'warning' });
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

describe('retryDoneView (W59, nhập 4 số từ lịch sử)', () => {
  const base = { claimId: 'c1', channel: 'shopee', maskedCode: 'SPX***001', message: 'ok' };
  const fmt = (iso: string) => iso.slice(0, 10);
  it('đã nhận: có dòng "Đã ghi nhận", dòng phụ là số điểm chờ cộng', () => {
    expect(retryDoneView({ ...base, status: 'CLAIMED', points: 700, expectedCreditAt: null }, fmt)).toEqual({
      recorded: true,
      detail: MARKETPLACE_CLAIM_COPY.resultPoints(700),
    });
  });
  it('máy chủ đưa vào kiểm tra: vẫn ghi nhận nhưng báo đang kiểm tra, không hứa điểm', () => {
    expect(retryDoneView({ ...base, status: 'REVIEW', points: 9000, expectedCreditAt: null }, fmt)).toEqual({
      recorded: true,
      detail: MARKETPLACE_CLAIM_COPY.resultReview,
    });
  });
  it('mã đã có người khác tích: không có dòng "Đã ghi nhận"', () => {
    expect(retryDoneView({ ...base, status: 'CLAIMED_BY_OTHER', points: null, expectedCreditAt: null }, fmt)).toEqual({
      recorded: false,
      detail: MARKETPLACE_CLAIM_COPY.resultClaimedByOther,
    });
  });
});
