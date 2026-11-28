import type { ExternalClaimRejectCode, ExternalClaimState, MyExternalClaimItem, SubmitExternalClaimResponse } from '@tubutree/shared-types';
import { formatVnNumber } from './number-format';

/**
 * Chữ khách thấy khi gửi mã vận đơn đơn sàn và xem lịch sử tích điểm đơn sàn (W44): Mini `/points/scan` (`i18n/vi-external-points.ts` trải
 * khối này) và web `/quet-ma` đọc cùng một nguồn để hai bên nói giống nhau. Chữ riêng của từng bên (cách xin SĐT, camera, thẻ trong hộp, OA)
 * nằm ở từng app; chữ hướng dẫn 3 bước và nút sau khi quét nằm ở `marketplace-scan-guide.ts`.
 */
export const MARKETPLACE_CLAIM_COPY = {
  inputLabel: 'Hoặc nhập mã vận đơn',
  inputPlaceholder: 'Ví dụ: SPXVN0123456789',
  // W46: chữ phụ dưới ô và câu nhắc giữ trong khoảng 12 tiếng (PO 27/11): khách đọc lướt khi tay đang cầm hộp hàng.
  inputHelp: 'Mã in trên phiếu giao hàng hoặc chi tiết đơn sàn.',
  submit: 'Tích điểm',
  emptyCode: 'Bạn nhập mã vận đơn trước nhé.',
  scanCardLink: 'Đây là mã thẻ Tubu. Hãy quét mã vạch trên nhãn dán ngoài hộp nhé.',
  scanNoCode: 'Mã vừa quét không phải mã vận đơn. Bạn quét lại nhé.',
  codeLinkInvalid: 'Mã vận đơn trên link chưa đúng dạng nên chưa điền sẵn. Bạn nhập hoặc quét lại mã nhé.',
  resultClaimed: (channel: string | null, code: string) => `Đã ghi nhận đơn${channel ? ` ${channel}` : ''} ${code}`,
  resultPoints: (points: number) => `${formatVnNumber(points)} Điểm Xanh đang chờ cộng`,
  resultCreditAt: (date: string) => `Dự kiến cộng từ ${date}`,
  resultAfterDelivery: 'Điểm được cộng sau khi đơn giao thành công và qua thời gian đối soát.',
  resultReview: 'Tubu đang kiểm tra đơn này, có kết quả bạn sẽ nhận thông báo.',
  resultSearching: 'Chưa thấy đơn này. Tubu sẽ tìm lại trong vài ngày và báo bạn.',
  resultClaimedByOther: 'Mã này đang tích điểm cho tài khoản khác. Nếu là đơn của bạn, liên hệ CSKH nhé.',
  searchingTitle: 'Đang tìm đơn',
  listTitle: 'Đơn sàn của bạn',
  listEmpty: 'Bạn chưa tích điểm đơn sàn nào.',
  listLoadFailed: 'Chưa tải được danh sách đơn.',
  pointsPending: 'Điểm chưa tính được',
  prev: 'Trước',
  next: 'Sau',
  pageOf: (page: number, pages: number) => `Trang ${page}/${pages}`,
  channelFallback: 'Đơn sàn',
  state: {
    waitDelivery: 'Chờ giao hàng',
    waitCredit: 'Chờ cộng điểm',
    review: 'Đang kiểm tra',
    // W59: claim REVIEW chỉ vì SĐT, khách tự gỡ bằng 4 số cuối (chạm dòng).
    needPhone: 'Nhập 4 số cuối',
    credited: 'Đã cộng',
    voided: 'Đã huỷ',
    reversed: 'Đã thu hồi',
    lapsed: 'Hết hạn',
  },
  creditedOn: (date: string) => `Đã cộng ${date}`,
  expectedOn: (date: string) => `Dự kiến ${date}`,
  reject: {
    DISABLED: 'Tính năng này chưa mở. Bạn quay lại sau nhé.',
    NOT_ELIGIBLE_USER: 'Đăng nhập Zalo và cho phép xem số điện thoại để tích điểm đơn sàn.',
    INVALID_CODE: 'Mã chưa đúng: mã vận đơn hoặc mã đơn gồm 8 đến 30 chữ và số.',
    LOCKED: 'Bạn đã nhập mã chưa tìm thấy nhiều lần. Thử lại sau 24 giờ hoặc liên hệ Tubu nhé.',
    DAILY_ATTEMPTS: 'Hôm nay bạn đã nhập mã nhiều lần. Mai thử lại nhé.',
    APP_ORDER: 'Đơn mua trong Mini App được tích điểm tự động khi giao thành công.',
    CHAT_ORDER: 'Đơn đặt qua tư vấn viên tự cộng điểm, bạn không cần nhập mã.',
    TOO_OLD: 'Đơn này đã quá thời hạn được tích điểm.',
    BEFORE_SINCE: 'Đơn đặt trước ngày bắt đầu chương trình nên chưa tích điểm được.',
    CLOSED: 'Đơn này đã huỷ hoặc hoàn nên không tích điểm được.',
    ALREADY_CLAIMED: 'Mã này đã tích điểm trước đó. Cần hỗ trợ, liên hệ Tubu nhé.',
    DAILY_MAX: 'Hôm nay bạn đã tích đủ số đơn cho phép. Mai quay lại nhé.',
    MONTHLY_CAP: 'Bạn đã đạt mức điểm tối đa từ đơn sàn trong tháng này.',
    ZERO_POINTS: 'Giá trị đơn nhỏ quá nên chưa quy ra được Điểm Xanh.',
    PHONE_MISMATCH:
      'Số điện thoại đơn sàn không khớp số Zalo của bạn. Đăng nhập đúng Zalo đã đặt đơn hoặc liên hệ Tubu.',
    PHONE_CONFIRM_REQUIRED: 'Bạn xác nhận 4 số cuối SĐT nhận hàng để tích điểm đơn này.',
    PHONE_CONFIRM_WRONG: '4 số cuối SĐT nhận hàng chưa khớp.',
    PHONE_CONFIRM_LOCKED: 'Bạn đã nhập sai 3 lần. Thử lại đơn này sau 24 giờ hoặc nhắn Tubu nhé.',
  } satisfies Record<ExternalClaimRejectCode, string>,
} as const;

/**
 * Màn "Xác nhận SĐT nhận hàng" (W46, PO A1 27/11): SĐT tài khoản khác SĐT trên đơn sàn thì khách nhập 4 số cuối SĐT người nhận. Mini `/points/scan`
 * và web `/quet-ma` cùng đọc ở đây. Tên sàn theo `channel` của API (`marketplaceChannelName`).
 */
export const PHONE_CONFIRM_COPY = {
  title: 'Xác nhận SĐT nhận hàng',
  label: (channelName: string) => `Nhập 4 số cuối SĐT nhận hàng trên đơn ${channelName}`,
  note: (channelName: string) => `Đây là số người nhận ghi trên đơn ${channelName}, có thể khác số tài khoản của bạn.`,
  placeholder: '4 số cuối',
  submit: 'Xác nhận & Tích điểm',
  other: 'Quét đơn khác',
  empty: 'Bạn nhập đủ 4 chữ số nhé.',
  // W59: lời PO 28/11. Sai 4 số không tạo claim nào, mã vẫn chờ khách nhập đúng.
  wrong: (remaining: number) => `Số điện thoại nhận hàng chưa khớp — kiểm tra lại 4 số cuối trên phiếu giao hàng rồi thử lại (còn ${remaining} lượt).`,
  wrongNoCount: 'Số điện thoại nhận hàng chưa khớp — kiểm tra lại 4 số cuối trên phiếu giao hàng rồi thử lại.',
  locked: 'Bạn đã nhập sai 3 lần. Thử lại đơn này sau 24 giờ hoặc nhắn CSKH.',
  support: 'Nhắn CSKH Tubu',
  /** W59: khách đóng hộp mà chưa xác nhận: mã chưa tích, nằm ở lịch sử chờ nhập lại. */
  later: 'Đơn này chưa tích điểm. Có phiếu giao thì chạm đơn ở lịch sử để nhập 4 số cuối.',
  /** W59: nhóm dòng lịch sử chờ khách nhập 4 số cuối (lượt quét dừng ở hộp xác nhận). */
  retryTitle: 'Chờ bạn nhập 4 số cuối',
  retryRow: (channelName: string, code: string) => `Nhập 4 số cuối SĐT nhận hàng cho đơn ${channelName} ${code}`,
  retryDone: (channelName: string, code: string) => `Đã ghi nhận đơn ${channelName} ${code}`,
} as const;

const CHANNEL_NAMES: Record<string, string> = { shopee: 'Shopee', tiktok: 'TikTok Shop', lazada: 'Lazada' };

/** Tên sàn khách đọc được từ `channel` của API (`shopee`, `tiktok`, `lazada`); sàn khác hay không rõ thì "sàn TMĐT". */
export function marketplaceChannelName(channel: string | null | undefined): string {
  return (channel && CHANNEL_NAMES[channel]) || 'sàn TMĐT';
}

/** Câu báo lỗi trong màn xác nhận theo mã API; null khi không có lỗi để báo (lần hỏi đầu). */
export function phoneConfirmErrorText(code: 'PHONE_CONFIRM_REQUIRED' | 'PHONE_CONFIRM_WRONG' | 'PHONE_CONFIRM_LOCKED', remaining: number | null): string | null {
  if (code === 'PHONE_CONFIRM_LOCKED') return PHONE_CONFIRM_COPY.locked;
  if (code === 'PHONE_CONFIRM_WRONG') return remaining != null && remaining > 0 ? PHONE_CONFIRM_COPY.wrong(remaining) : PHONE_CONFIRM_COPY.wrongNoCount;
  return null;
}

/**
 * Chữ riêng của web `/quet-ma` (W44, PO 27/11: quét và tích điểm làm được ngay trên web). Web không xin SĐT Zalo như Mini App. Khách chỉ có SĐT
 * liên hệ tự gõ trên web vẫn gửi mã được (W45); từ W59 đơn khớp số đó hoặc khách nhập đúng 4 số cuối thì chờ cộng như SĐT Zalo, chưa có SĐT thì
 * nhập ngay trên màn quét.
 * Camera: mọi máy đều có nút quét (iPhone đọc bằng bộ đọc JS) và lối chụp/chọn ảnh khi trình duyệt chặn camera.
 */
export const MARKETPLACE_CLAIM_WEB_COPY = {
  loginCta: 'Đăng nhập để tích điểm',
  loginWhy: 'Đăng nhập để ghép đơn sàn theo số điện thoại của bạn.',
  openMiniAlt: 'Hoặc quét trong Tubu Tree trên Zalo',
  // W46 camera trước: khung quét nằm ngay đầu thẻ, hai lối phụ dạng viên thuốc bên dưới.
  scanSheetTitle: 'Quét mã vận đơn',
  viewfinderHint: 'Đưa mã vạch/QR trên phiếu giao hàng vào khung',
  cameraStart: 'Bật camera quét ngay',
  cameraLabel: 'Camera quét mã vận đơn',
  torchOn: 'Bật đèn pin',
  torchOff: 'Tắt đèn pin',
  manualCta: 'Nhập mã thủ công',
  sending: 'Đang tích điểm…',
  scanFailed: 'Chưa quét được. Bạn thử lại, chụp ảnh hoặc nhập mã nhé.',
  cameraDenied: 'Chưa có quyền camera. Bạn cho phép camera hoặc chụp ảnh mã.',
  cameraUnavailable: 'Máy chưa mở được camera. Bạn chụp ảnh hoặc nhập mã.',
  photoCta: 'Chụp / chọn ảnh',
  photoReading: 'Đang đọc ảnh…',
  photoUnreadable: 'Chưa đọc được mã trong ảnh. Bạn chụp gần và rõ hơn.',
  phoneTitle: 'Thêm số điện thoại để tích điểm',
  phoneBody: 'Số di động bạn dùng khi mua trên Shopee, TikTok Shop, Lazada.',
  phoneLabel: 'Số điện thoại đặt hàng',
  phonePlaceholder: '0912 345 678',
  phoneEmpty: 'Nhập số điện thoại di động 10 số.',
  phoneInvalid: 'Số điện thoại di động chưa đúng định dạng (đầu 03, 05, 07, 08, 09).',
  phoneSave: 'Lưu số và tích điểm',
  phoneAlt: 'Hoặc xác minh số trên Zalo để cộng điểm tự động',
  phoneCta: 'Xác minh số trên Zalo',
  notVerified: 'Đơn này cần SĐT đã xác minh qua Zalo để ghép.',
  rateLimited: 'Bạn gửi hơi nhanh. Chờ 1 phút rồi thử lại nhé.',
  historyTitle: 'Lịch sử tích điểm đơn sàn',
} as const;

/** Tông nhãn trạng thái; cả Badge của Mini và web đều có các tông này. */
export type ClaimStateTone = 'info' | 'warning' | 'success' | 'danger' | 'neutral';

/** Claim đã huỷ, thu hồi, hết hạn: điểm hiện nhạt và gạch ngang. */
export const DEAD_CLAIM_STATES: readonly ExternalClaimState[] = ['VOIDED', 'REVERSED', 'LAPSED'];

const S = MARKETPLACE_CLAIM_COPY.state;

/** Nhãn + tông của một dòng lịch sử. PENDING chưa có mốc cộng là đơn chưa giao xong. */
export function claimStateView(item: Pick<MyExternalClaimItem, 'state' | 'expectedCreditAt' | 'phoneRetry'>): { label: string; tone: ClaimStateTone } {
  if (item.state === 'REVIEW' && item.phoneRetry) return { label: S.needPhone, tone: 'warning' };
  switch (item.state) {
    case 'PENDING':
      return item.expectedCreditAt ? { label: S.waitCredit, tone: 'info' } : { label: S.waitDelivery, tone: 'warning' };
    case 'REVIEW':
    case 'HELD_NO_MEMBER':
      return { label: S.review, tone: 'warning' };
    case 'CREDITED':
      return { label: S.credited, tone: 'success' };
    case 'REVERSED':
      return { label: S.reversed, tone: 'danger' };
    case 'LAPSED':
      return { label: S.lapsed, tone: 'neutral' };
    default:
      return { label: S.voided, tone: 'danger' };
  }
}

/** Dòng phụ của một dòng lịch sử ("Đã cộng 05/11/2026", "Dự kiến 12/11/2026"); `fmtDate` là hàm định dạng ngày của từng app. */
export function claimDetail(item: Pick<MyExternalClaimItem, 'state' | 'expectedCreditAt' | 'creditedAt'>, fmtDate: (iso: string) => string): string | null {
  if (item.state === 'CREDITED') return item.creditedAt ? MARKETPLACE_CLAIM_COPY.creditedOn(fmtDate(item.creditedAt)) : null;
  if (item.state === 'PENDING' && item.expectedCreditAt) return MARKETPLACE_CLAIM_COPY.expectedOn(fmtDate(item.expectedCreditAt));
  return null;
}

/** Mốc dự kiến đã qua mà API vẫn trả CLAIMED: khách gửi lại mã đã được cộng hoặc sắp cộng, dùng câu của API thay vì hứa "sẽ cộng". */
export function isPastMilestone(r: Pick<SubmitExternalClaimResponse, 'status' | 'expectedCreditAt'>, now: number = Date.now()): boolean {
  return r.status === 'CLAIMED' && r.expectedCreditAt != null && Date.parse(r.expectedCreditAt) <= now;
}

/** Câu chính của thẻ kết quả sau khi gửi mã, theo trạng thái API trả. */
export function claimResultDetail(r: SubmitExternalClaimResponse, fmtDate: (iso: string) => string, now: number = Date.now()): string {
  if (r.status === 'SEARCHING') return MARKETPLACE_CLAIM_COPY.resultSearching;
  if (r.status === 'CLAIMED_BY_OTHER') return MARKETPLACE_CLAIM_COPY.resultClaimedByOther;
  if (r.status === 'REVIEW') return MARKETPLACE_CLAIM_COPY.resultReview;
  if (isPastMilestone(r, now)) return r.message;
  return r.expectedCreditAt ? MARKETPLACE_CLAIM_COPY.resultCreditAt(fmtDate(r.expectedCreditAt)) : MARKETPLACE_CLAIM_COPY.resultAfterDelivery;
}
