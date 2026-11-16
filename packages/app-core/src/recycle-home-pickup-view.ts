import type { WasteCloseReason, WasteFeeCashMethod, WasteHomePickupDTO, WasteMethod, WastePickupQuoteResponse, WasteRequestStatus } from '@tubutree/shared-types';
import { errorStatus } from './api/error-status';
import { formatVnNumber } from './number-format';
import { HOME_PICKUP_BATTERY_TEXT, homePickupCopy } from './waste-copy';
import { homePickupKgLabel } from './recycle-home-pickup-state';
import { timelineFor } from './waste-timeline';

const vnd = (n: number) => `${formatVnNumber(n)}đ`;
const num = (n: number) => formatVnNumber(n);

export interface HomePickupFeeOptionsView {
  attachNextOrder: {
    available: boolean;
    subtitle: string;
    badge: string | null;
    existingRequestId: string | null;
  };
  /** null khi Ví 0đ (không hiện hàng bị khoá cho khách Ví 0đ). */
  wallet: {
    title: string;
    subtitle: string;
    enough: boolean;
  } | null;
  bankTransfer: {
    title: string;
    subtitle: string;
  } | null;
}

export interface HomePickupQuoteView {
  feeText: string;
  /** Phí ước lượng cố định (chưa hỏi được đơn vị vận chuyển): hiện nhãn "Ước tính" cạnh phí và chưa cho đặt. */
  estimated: boolean;
  /** Điểm Xanh sẽ trừ cho phí ship khi đơn đặt được. */
  pointsUsed: number;
  pointsDeductText: string;
  /** Phần phí Điểm Xanh chưa trả đủ. */
  remainingFeeVnd: number;
  cashDueVnd: number;
  cashDueText: string;
  /** Một dòng trả phí: điểm dùng được và điểm sẽ trừ. */
  payLine: string;
  /** Dòng điểm ước tính; dưới ngưỡng thì thành "Dự kiến X / Y điểm". */
  pointsLine: string;
  belowMin: boolean;
  /** Máy chủ nói địa chỉ không giao/lấy được: màn hiện lối "Sửa địa chỉ này" cạnh lý do. */
  addressOk: boolean;
  /** Đúng một lý do đang chặn (địa chỉ, Pin ngoài TP.HCM, máy chủ, phí ước tính), null khi không có hoặc khi hiện khối chọn cách trả phí. */
  notice: string | null;
  /** Bị thiếu Điểm Xanh là lý do duy nhất: hiện khối gửi kèm đơn / trả bằng Ví / VietQR thay vì câu chặn. */
  needFeePayment: boolean;
  feeOptions: HomePickupFeeOptionsView | null;
  /** Không có gì chặn ở phía báo phí (còn cần chọn cách trả nếu needFeePayment, và tick đồng ý). */
  ok: boolean;
}

const BELOW_MIN_MESSAGE = /cần tối thiểu .*[\s\u00A0]điểm/;

/**
 * Chữ và trạng thái của thẻ báo phí.
 * - Đủ Điểm Xanh: như trước (`ok: true`, `needFeePayment: false`).
 * - Lý do duy nhất là thiếu Điểm Xanh (`blockedCode === 'NEED_FEE_PAYMENT'` kèm `feePaths`): bật `needFeePayment = true`,
 *   dựng sẵn `feeOptions` (Gửi kèm đơn / Ví Tubu khi số dư > 0 / VietQR khi bật cờ), không hiện câu `notice` đỏ.
 */
export function homePickupQuoteView(args: { quote: WastePickupQuoteResponse; batteryBlocked: boolean }): HomePickupQuoteView {
  const { quote, batteryBlocked } = args;
  const fee = Math.max(0, quote.shipFeeVnd);
  const belowMin = quote.estimatedPoints < quote.minPoints;
  const covered = quote.remainingFeeVnd <= 0;
  const needFeePayment =
    quote.addressOk &&
    !batteryBlocked &&
    !belowMin &&
    !quote.estimated &&
    quote.blockedCode === 'NEED_FEE_PAYMENT' &&
    Boolean(quote.feePaths) &&
    (quote.cashDueVnd ?? quote.remainingFeeVnd) > 0;
  const cashDueVnd = needFeePayment ? Math.max(0, quote.cashDueVnd ?? quote.remainingFeeVnd) : Math.max(0, quote.remainingFeeVnd);
  const cashDueText = vnd(cashDueVnd);
  const pointsUsed = covered || needFeePayment ? Math.min(quote.pointsApplicable, fee) : 0;

  let payLine: string;
  if (fee <= 0) payLine = homePickupCopy.payFree;
  else if (covered) payLine = homePickupCopy.payCovered(num(quote.pointsAvailable), num(pointsUsed));
  else payLine = homePickupCopy.payShort(num(quote.pointsAvailable));

  let notice: string | null = null;
  if (!quote.addressOk) notice = quote.addressMessage ?? homePickupCopy.addressNotOk;
  else if (batteryBlocked) notice = HOME_PICKUP_BATTERY_TEXT;
  else if (needFeePayment) notice = null;
  else if (quote.blocked && !(belowMin && BELOW_MIN_MESSAGE.test(quote.blocked))) notice = quote.blocked;
  else if (quote.estimated) notice = homePickupCopy.feeUnavailable;

  let feeOptions: HomePickupFeeOptionsView | null = null;
  if (needFeePayment && quote.feePaths) {
    const fs = homePickupCopy.feeShort;
    const { wallet, bankTransfer, attachNextOrder } = quote.feePaths;
    feeOptions = {
      attachNextOrder: {
        available: attachNextOrder.available,
        subtitle: attachNextOrder.available ? fs.attachSub : (attachNextOrder.reason ?? fs.attachSub),
        badge: attachNextOrder.available ? fs.attachBadge : null,
        existingRequestId: attachNextOrder.existingRequestId,
      },
      wallet:
        wallet.balance > 0
          ? {
              title: fs.walletTitle(cashDueText),
              subtitle: wallet.enough ? fs.walletEnoughSub(vnd(wallet.balance)) : fs.walletShortSub(vnd(wallet.balance)),
              enough: wallet.enough,
            }
          : null,
      bankTransfer: bankTransfer.enabled
        ? {
            title: fs.bankTitle(cashDueText),
            subtitle: fs.bankSub,
          }
        : null,
    };
  }

  return {
    feeText: vnd(fee),
    estimated: quote.estimated,
    pointsUsed,
    pointsDeductText: homePickupCopy.feeShort.pointsDeductValue(num(pointsUsed)),
    remainingFeeVnd: quote.remainingFeeVnd,
    cashDueVnd,
    cashDueText,
    payLine,
    pointsLine: belowMin ? homePickupCopy.progress(num(quote.estimatedPoints), num(quote.minPoints)) : homePickupCopy.estimate(num(quote.estimatedPoints)),
    belowMin,
    addressOk: quote.addressOk,
    notice,
    needFeePayment,
    feeOptions,
    ok: quote.addressOk && !batteryBlocked && (needFeePayment || !quote.blocked) && !belowMin && !quote.estimated,
  };
}

/**
 * 503 của thu gom tận nhà (chưa báo được phí, chưa gửi được lệnh huỷ tới đơn vị vận chuyển) mang câu tiếng Việt viết cho khách.
 * Câu chung của Mini App và web cho mọi 5xx là "Máy chủ đang bận" nên bên gọi dùng câu này trước; null khi không phải 503 hoặc câu không đọc được.
 */
export function homePickupUnavailableText(error: unknown): string | null {
  if (errorStatus(error) !== 503) return null;
  const e = error as { message?: unknown; response?: { data?: { message?: unknown } } };
  const raw = e.response?.data?.message ?? e.message;
  const text = (Array.isArray(raw) ? raw[0] : raw);
  return typeof text === 'string' && /[^\x00-\x7F]/.test(text) ? text.trim() : null;
}

export type HomePickupQuoteState = 'idle' | 'loading' | 'error' | 'ready';

export function isHomePickupPaymentUsable(
  view: Pick<HomePickupQuoteView, 'needFeePayment' | 'feeOptions'> | null,
  payment?: WasteFeeCashMethod | null,
): boolean {
  if (!view?.needFeePayment) return true;
  if (payment === 'WALLET') return view.feeOptions?.wallet?.enough === true;
  if (payment === 'BANK_TRANSFER') return Boolean(view.feeOptions?.bankTransfer);
  return false;
}

/** Nhãn nút gửi duy nhất ở thanh đáy theo trạng thái thiếu phí và cách trả khách chọn. */
export function homePickupSubmitLabel(
  view: Pick<HomePickupQuoteView, 'needFeePayment' | 'cashDueText'> | null,
  payment?: WasteFeeCashMethod | null,
): string {
  if (!view?.needFeePayment) return homePickupCopy.createButton;
  if (payment === 'WALLET') return homePickupCopy.feeShort.ctaWallet(view.cashDueText);
  if (payment === 'BANK_TRANSFER') return homePickupCopy.feeShort.ctaBank;
  return homePickupCopy.feeShort.ctaPick;
}

/** Nút gửi bấm được hay không và câu nhắc ở thanh đáy (null khi lý do đã hiện ngay trong thẻ báo phí). */
export function homePickupCreateState(args: {
  addressId: string | null;
  quoteState: HomePickupQuoteState;
  view: HomePickupQuoteView | null;
  consentOk: boolean;
  payment?: WasteFeeCashMethod | null;
}): { ok: boolean; hint: string | null } {
  const { addressId, quoteState, view, consentOk, payment } = args;
  if (!addressId) return { ok: false, hint: homePickupCopy.needAddress };
  // Đang tính phí, báo phí lỗi hay có lý do chặn: câu đã hiện ngay trong thẻ phí, thanh đáy không lặp lại.
  if (quoteState !== 'ready' || !view || !view.ok) return { ok: false, hint: null };
  if (!isHomePickupPaymentUsable(view, payment)) return { ok: false, hint: null };
  if (!consentOk) return { ok: false, hint: homePickupCopy.needConsent };
  return { ok: true, hint: null };
}

type StatusFacts = {
  method: WasteMethod;
  status: WasteRequestStatus;
  closeReason?: WasteCloseReason | null;
  pointsAwarded?: number | null;
  homePickup?: {
    gomdonStatus: string | null;
    shipFeeCashMethod?: WasteHomePickupDTO['shipFeeCashMethod'];
    shipFeeCashPaid?: boolean;
  };
};

/** Trạng thái vận đơn ngắn gọn (vừa một huy hiệu 375px) của đơn đang chạy; null khi trạng thái phiếu đã đủ nghĩa (hoàn tất, huỷ...). */
export function homePickupShortStatus(r: StatusFacts): string | null {
  const g = r.homePickup?.gomdonStatus ?? null;
  if (r.status === 'EXPIRED') {
    if (r.closeReason === 'FEE_UNPAID') return 'Quá hạn chuyển khoản phí';
    return g === '10' ? 'Bưu tá chưa lấy được rác' : null;
  }
  if (r.status !== 'OPEN' && r.status !== 'IN_TRANSIT') return null;
  if (r.status === 'OPEN' && r.homePickup?.shipFeeCashMethod === 'BANK_TRANSFER' && r.homePickup.shipFeeCashPaid === false) {
    return 'Chờ chuyển khoản phí';
  }
  switch (g) {
    case '3':
      return 'Bưu tá đã lấy rác';
    case '4':
    case '5':
      return 'Đang về kho Tubu';
    case '7':
      return 'Đã giao tới kho Tubu';
    case '10':
      return 'Bưu tá chưa lấy được rác';
    case '6':
    case '8':
    case '9':
    case '11':
    case '12':
    case 'NEEDS_MANUAL_CHECK':
      return 'Tubu đang xử lý vận đơn';
    default:
      return r.status === 'IN_TRANSIT' ? 'Đang về kho Tubu' : 'Chờ bưu tá tới lấy rác';
  }
}

export interface HomePickupDetailRow {
  label: string;
  value: string;
}

/** Các dòng tóm tắt phí ở chi tiết phiếu: địa chỉ, cân nặng, phí shipper, điểm đã trừ/hoàn, và phần phí trả bằng Ví / VietQR. */
export function homePickupDetailRows(h: WasteHomePickupDTO): HomePickupDetailRow[] {
  const d = homePickupCopy.detail;
  const rows: HomePickupDetailRow[] = [];
  if (h.pickupAddressText) rows.push({ label: d.address, value: h.pickupAddressText });
  if (h.declaredWeightGrams > 0) rows.push({ label: d.weight, value: `${homePickupKgLabel(h.declaredWeightGrams)} kg` });
  rows.push({ label: d.fee, value: vnd(h.shipFeeVnd) });
  if (h.shipFeePointsUsed > 0) rows.push({ label: d.pointsUsed, value: `${num(h.shipFeePointsUsed)}\u00A0điểm` });
  const cashVnd = h.shipFeeCashVnd ?? 0;
  if (cashVnd > 0) {
    if (h.shipFeeCashMethod === 'WALLET' && h.shipFeeCashPaid) rows.push({ label: d.cashPaidWallet, value: vnd(cashVnd) });
    else if (h.shipFeeCashMethod === 'BANK_TRANSFER' && h.shipFeeCashPaid) rows.push({ label: d.cashPaidBank, value: vnd(cashVnd) });
    else if (h.shipFeeCashMethod === 'BANK_TRANSFER' && !h.shipFeeCashPaid) rows.push({ label: d.cashAwaitingBank, value: vnd(cashVnd) });
  }
  if (h.shipFeePointsRefunded > 0) rows.push({ label: d.pointsRefunded, value: `${num(h.shipFeePointsRefunded)}\u00A0điểm` });
  const cashRefunded = h.shipFeeCashRefundedVnd ?? 0;
  if (cashRefunded > 0) rows.push({ label: d.cashRefunded, value: vnd(cashRefunded) });
  return rows;
}

/** Chữ hộp xác nhận huỷ: nêu điểm và/hoặc khoản tiền đã trả sẽ được hoàn về Ví Tubu. */
export function homePickupCancelCopy(
  code: string,
  h: { shipFeePointsUsed: number; shipFeeCashVnd?: number; shipFeeCashPaid?: boolean } | undefined,
) {
  const used = h?.shipFeePointsUsed ?? 0;
  const cashPaid = h?.shipFeeCashPaid && (h.shipFeeCashVnd ?? 0) > 0 ? vnd(h.shipFeeCashVnd!) : null;
  return {
    title: homePickupCopy.detail.cancelTitle,
    body: homePickupCopy.detail.cancelBody(code, used > 0 ? num(used) : null, cashPaid),
    confirm: homePickupCopy.detail.cancelConfirm,
  };
}

/** Thông báo sau khi huỷ xong: nói số điểm và/hoặc khoản phí hoàn về Ví nếu có. */
export function homePickupCancelDone(
  h: { shipFeePointsRefunded: number; shipFeeCashRefundedVnd?: number } | undefined,
): string {
  const refunded = h?.shipFeePointsRefunded ?? 0;
  const cashRefunded = h?.shipFeeCashRefundedVnd ?? 0;
  if (cashRefunded > 0) {
    return homePickupCopy.detail.cancelDoneRefundCash(refunded > 0 ? num(refunded) : null, vnd(cashRefunded));
  }
  return refunded > 0 ? homePickupCopy.detail.cancelDoneRefund(num(refunded)) : homePickupCopy.detail.cancelDone;
}

/** Điểm đã dùng trừ phí ship / đã hoàn, một dòng phụ ở danh sách yêu cầu; null khi không dùng điểm. */
export function homePickupListMeta(r: Pick<StatusFacts, 'method'> & { homePickup?: Pick<WasteHomePickupDTO, 'shipFeePointsUsed' | 'shipFeePointsRefunded'> }): string | null {
  if (r.method !== 'HOME_PICKUP' || !r.homePickup) return null;
  const { shipFeePointsUsed: used, shipFeePointsRefunded: refunded } = r.homePickup;
  if (refunded > 0) return homePickupCopy.list.pointsRefunded(num(refunded));
  if (used > 0) return homePickupCopy.list.pointsUsed(num(used));
  return null;
}

/**
 * Mỗi mốc của lịch sử vận đơn (máy chủ gửi `{at, text}`) thuộc bước nào của dải 4 bước (chỉ số theo TIMELINE_STEPS.HOME_PICKUP).
 * Nhận theo đầu câu của máy chủ (`waste-home-pickup-text.ts`); câu lạ (vận đơn trục trặc) không thuộc bước nào nên bỏ,
 * trạng thái hiện hành đã nằm ở dòng trạng thái phía trên dải.
 */
const TIMELINE_ENTRY_STEPS: readonly (readonly [prefix: string, step: number, addsInfo: boolean])[] = [
  ['Đã tạo đơn', 0, false],
  ['Bưu tá đã lấy rác', 1, false],
  ['Đang về kho Tubu', 2, false],
  ['Đã giao tới kho Tubu', 2, true],
  ['Kho Tubu đã nhận rác', 3, true],
  ['Kho đã kiểm nhận', 3, true],
];

export interface HomePickupTimelineView {
  steps: readonly string[];
  current: number;
  /** Mốc thời gian (ISO) theo chỉ số bước đã có mốc; `extra` là câu của máy chủ khi nó nói thêm điều tên bước chưa nói (số điểm đã cộng, kho đã nhận...). */
  hints: Readonly<Record<number, { at: string; extra: string | null }>>;
}

export function homePickupTimelineView(r: {
  method: WasteMethod;
  status: WasteRequestStatus;
  orderCode: string | null;
  homePickup?: Pick<WasteHomePickupDTO, 'timeline'>;
}): HomePickupTimelineView | null {
  const t = timelineFor(r);
  if (!t) return null;
  const hints: Record<number, { at: string; extra: string | null }> = {};
  for (const e of r.homePickup?.timeline ?? []) {
    const hit = TIMELINE_ENTRY_STEPS.find(([prefix]) => e.text.startsWith(prefix));
    if (hit) hints[hit[1]] = { at: e.at, extra: hit[2] ? e.text : null };
  }
  return { steps: t.steps, current: t.current, hints };
}
