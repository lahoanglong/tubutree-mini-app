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
  inputHelp: 'Mã vận đơn in trên phiếu giao hàng dán ngoài hộp. Không còn phiếu thì xem trong chi tiết đơn trên Shopee, Lazada hoặc TikTok Shop.',
  submit: 'Tích điểm',
  emptyCode: 'Bạn nhập mã vận đơn trước nhé.',
  scanCardLink: 'Đây là mã trên thẻ Tubu. Bạn quét mã vạch trên nhãn dán ngoài hộp nhé.',
  scanNoCode: 'Chưa tìm thấy mã vận đơn trong nội dung vừa quét. Bạn kiểm tra mã trong ô bên dưới hoặc quét lại nhé.',
  codeLinkInvalid: 'Link bạn mở có mã vận đơn không đúng dạng nên chưa điền sẵn. Bạn nhập hoặc quét lại mã trên nhãn nhé.',
  resultClaimed: (channel: string | null, code: string) => `Đã ghi nhận đơn${channel ? ` ${channel}` : ''} ${code}`,
  resultPoints: (points: number) => `${formatVnNumber(points)} Điểm Xanh đang chờ cộng`,
  resultCreditAt: (date: string) => `Dự kiến cộng từ ${date}`,
  resultAfterDelivery: 'Điểm được cộng sau khi đơn giao thành công và qua thời gian đối soát.',
  resultReview: 'Tubu đang kiểm tra đơn này, có kết quả bạn sẽ nhận thông báo.',
  resultSearching: 'Chưa thấy đơn này. Tubu sẽ tìm lại trong vài ngày tới và báo cho bạn khi có.',
  resultClaimedByOther: 'Mã này đang được một tài khoản khác dùng để tích điểm. Nếu đây là đơn của bạn, liên hệ CSKH.',
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
    credited: 'Đã cộng',
    voided: 'Đã huỷ',
    reversed: 'Đã thu hồi',
    lapsed: 'Hết hạn',
  },
  creditedOn: (date: string) => `Đã cộng ${date}`,
  expectedOn: (date: string) => `Dự kiến ${date}`,
  reject: {
    DISABLED: 'Tính năng này chưa mở. Bạn quay lại sau nhé.',
    NOT_ELIGIBLE_USER: 'Bạn cần đăng nhập Zalo và cho phép Tubu xem số điện thoại để tích điểm đơn sàn.',
    INVALID_CODE: 'Mã chưa đúng. Mã vận đơn hoặc mã đơn gồm 8 đến 30 chữ và số, bạn kiểm tra lại nhé.',
    LOCKED: 'Bạn đã nhập mã chưa tìm thấy nhiều lần. Bạn thử lại sau 24 giờ hoặc liên hệ Tubu nhé.',
    DAILY_ATTEMPTS: 'Hôm nay bạn đã nhập mã nhiều lần rồi. Bạn thử lại vào ngày mai nhé.',
    APP_ORDER: 'Đây là đơn bạn mua trong Mini App nên điểm đã được tích tự động khi đơn giao thành công.',
    CHAT_ORDER: 'Đơn đặt qua tư vấn viên được cộng điểm tự động, bạn không cần nhập mã.',
    TOO_OLD: 'Đơn này đã quá thời hạn được tích điểm.',
    BEFORE_SINCE: 'Đơn này được đặt trước ngày bắt đầu chương trình nên chưa tích điểm được.',
    CLOSED: 'Đơn này đã huỷ hoặc hoàn nên không tích điểm được.',
    ALREADY_CLAIMED: 'Mã này đã được dùng để tích điểm trước đó. Cần hỗ trợ, bạn liên hệ Tubu nhé.',
    DAILY_MAX: 'Hôm nay bạn đã tích đủ số đơn cho phép. Bạn quay lại vào ngày mai nhé.',
    MONTHLY_CAP: 'Bạn đã đạt mức điểm tối đa từ đơn sàn trong tháng này.',
    ZERO_POINTS: 'Giá trị đơn nhỏ quá nên chưa quy ra được Điểm Xanh.',
    PHONE_MISMATCH:
      'Số điện thoại trên đơn sàn không khớp số Zalo bạn đang đăng nhập. Bạn đăng nhập đúng tài khoản Zalo dùng số đã đặt đơn, hoặc liên hệ Tubu nếu bạn đã đổi số nhé.',
  } satisfies Record<ExternalClaimRejectCode, string>,
} as const;

/**
 * Chữ riêng của web `/quet-ma` (W44, PO 27/11: quét và tích điểm làm được ngay trên web). Web không xin SĐT Zalo như Mini App. Từ W45 khách chỉ
 * có SĐT liên hệ tự gõ trên web (chưa xác minh qua Zalo) vẫn gửi mã được: đơn khớp số đó, hoặc khách đã có đơn app giao thành công, vào hàng
 * CSKH đối chiếu trước khi cộng; chưa có SĐT thì nhập ngay trên màn quét. Xác minh trên Zalo vẫn là lối cộng tự động, nên vẫn được mời.
 * Camera: mọi máy đều có nút quét (iPhone đọc bằng bộ đọc JS) và lối chụp/chọn ảnh khi trình duyệt chặn camera.
 */
export const MARKETPLACE_CLAIM_WEB_COPY = {
  loginCta: 'Đăng nhập để tích điểm',
  loginWhy: 'Đăng nhập bằng Zalo để Tubu ghép đúng đơn sàn với số điện thoại của bạn.',
  openMiniAlt: 'Hoặc quét trong Tubu Tree trên Zalo',
  scanCta: 'Quét mã trên nhãn',
  scanSheetTitle: 'Quét mã vận đơn',
  scanSheetHint: 'Đưa mã vạch hoặc mã QR trên phiếu giao hàng vào khung hình',
  scanClose: 'Đóng',
  cameraLabel: 'Camera quét mã vận đơn',
  scanFailed: 'Chưa quét được. Bạn thử lại, chụp/chọn ảnh mã vận đơn hoặc nhập mã vào ô bên dưới nhé.',
  cameraDenied: 'Chưa mở được camera. Bạn cho phép camera, chụp/chọn ảnh mã vận đơn hoặc nhập mã vào ô bên dưới nhé.',
  photoCta: 'Chụp/chọn ảnh mã vận đơn',
  photoReading: 'Đang đọc ảnh…',
  photoUnreadable: 'Chưa đọc được mã trong ảnh. Bạn chụp gần và rõ nét cả mã vạch, hoặc nhập mã vào ô bên dưới nhé.',
  phoneTitle: 'Thêm số điện thoại để tích điểm',
  phoneBody: 'Tubu ghép đơn sàn theo số điện thoại đặt hàng. Bạn nhập số di động đã dùng khi mua trên Shopee, TikTok Shop, Lazada nhé.',
  phoneLabel: 'Số điện thoại đặt hàng',
  phonePlaceholder: '0912 345 678',
  phoneEmpty: 'Nhập số điện thoại di động 10 số.',
  phoneInvalid: 'Số điện thoại di động chưa đúng định dạng (đầu 03, 05, 07, 08, 09).',
  phoneSave: 'Lưu số và tích điểm',
  phoneAlt: 'Hoặc xác minh số trên Zalo để cộng điểm tự động',
  phoneCta: 'Xác minh số trên Zalo',
  unverifiedNote: 'Số điện thoại của bạn chưa xác minh qua Zalo: đơn tích trên web sẽ được CSKH đối chiếu trước khi cộng điểm.',
  notVerified:
    'Tubu chưa đối chiếu được đơn này với số điện thoại bạn nhập trên web (số chưa xác minh qua Zalo). Bạn mở Tubu Tree trên Zalo, cho phép chia sẻ số điện thoại một lần rồi tích điểm lại nhé. Đã xác minh mà vẫn gặp lỗi này thì bạn liên hệ CSKH Tubu.',
  rateLimited: 'Bạn gửi mã hơi nhanh. Bạn chờ một phút rồi thử lại nhé.',
  historyTitle: 'Lịch sử tích điểm đơn sàn',
} as const;

/** Tông nhãn trạng thái; cả Badge của Mini và web đều có các tông này. */
export type ClaimStateTone = 'info' | 'warning' | 'success' | 'danger' | 'neutral';

/** Claim đã huỷ, thu hồi, hết hạn: điểm hiện nhạt và gạch ngang. */
export const DEAD_CLAIM_STATES: readonly ExternalClaimState[] = ['VOIDED', 'REVERSED', 'LAPSED'];

const S = MARKETPLACE_CLAIM_COPY.state;

/** Nhãn + tông của một dòng lịch sử. PENDING chưa có mốc cộng là đơn chưa giao xong. */
export function claimStateView(item: Pick<MyExternalClaimItem, 'state' | 'expectedCreditAt'>): { label: string; tone: ClaimStateTone } {
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
