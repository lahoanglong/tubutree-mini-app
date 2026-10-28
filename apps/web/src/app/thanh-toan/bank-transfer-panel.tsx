'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { CheckCircle2, Check, Clock, Copy, Download, Loader2, TriangleAlert } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getBankQr, formatVnd, type OrderDTO } from '@/lib/shop-client';
import { CopyButton } from '@/components/copy-button';
import { ui } from '@/lib/guest-ui';
import { formatDateTime } from '@/lib/format-date';
import { BANK_QR_HINT, BANK_QR_SAVED, BANK_QR_SAVE_FAILED } from '@tubutree/app-core/bank-payment-copy';
import type { SaveImageResult } from '@tubutree/app-core/bridge';
import { platformBridge } from '@/lib/platform-bridge';
import { StickyActionBar } from '@/components/sticky-action-bar';
import { mini } from '@/components/order-mobile/mobile-ui';
import { useRemaining } from '@/lib/use-remaining';
import { copyText } from '@/lib/copy-text';
import { ApiError, NetworkError } from '@/lib/client-api';
import { isBusinessMessage, loadErrorText } from '@/lib/error-text';
import { SupportHotline } from '@/components/support-hotline';

export type BankPanelState = 'loading' | 'error' | 'ready' | 'paid' | 'closed';

// Chỉ các mã cho biết đơn không còn chờ tiền: dò lại hay bấm Thử lại không ra kết quả khác. 401/403 là phiên hết hạn khi refresh
// chưa xong (đơn vẫn chờ, phiên khôi phục xong dò lại là ra), 408/429 tạm thời, mạng/5xx khách vẫn đang chờ tiền về: QR phải còn đó.
const FINAL_REJECTION_STATUSES = new Set([400, 404, 409, 410, 422]);
const isFinalRejection = (e: unknown) => e instanceof ApiError && FINAL_REJECTION_STATUSES.has(e.status);

// 401/403 ở nút Kiểm tra: phiên đã hết và refresh bị từ chối. Không phải lỗi mạng nên không được báo "kiểm tra kết nối";
// đơn vẫn chờ tiền, khách chỉ cần đăng nhập lại rồi bấm lại.
const SESSION_EXPIRED_MESSAGE = 'Phiên đăng nhập đã hết hạn. Bạn đăng nhập lại rồi bấm Kiểm tra nhé.';
const isSessionExpired = (e: unknown) => e instanceof ApiError && (e.status === 401 || e.status === 403);
// Mã SESSION_EXPIRED của máy chủ: luôn câu của màn này. Lý do khác bằng tiếng Việt (vd. "Tài khoản đã bị khoá.") đáng hiện hơn câu chung về phiên.
const sessionExpiredText = (e: ApiError) =>
  e.code !== 'SESSION_EXPIRED' && isBusinessMessage(e.message) ? e.message : SESSION_EXPIRED_MESSAGE;

const EXPIRED_MESSAGE = 'Đơn đã quá hạn chuyển khoản. Nếu bạn đã chuyển tiền, Tubu sẽ hoàn lại cho bạn.';
// 503 kèm lý do (vd. chưa cấu hình tài khoản nhận tiền): lý do ấy là thứ khách cần đọc, như Mini App; lỗi khác theo loadErrorText.
const errorMessage = (e: unknown) =>
  (e instanceof ApiError && e.status === 503 && isBusinessMessage(e.message)) || e instanceof NetworkError ? (e as Error).message : loadErrorText(e);

/**
 * A2-02 = A6-01 (docs/audit-2026-09): web cho chọn "Chuyển khoản ngân hàng" nhưng trước đây sau
 * khi đặt đơn KHÔNG BAO GIỜ hiện QR/STK/nội dung CK ở đâu — khách không có cách nào trả tiền.
 * Mirror apps/miniapp/src/pages/bank-payment.tsx: cùng contract GET /payments/bank-qr/:code, cùng
 * cách dò trạng thái (poll 4s + nút kiểm tra tay). Không render gì cho phương thức khác.
 *
 * Tách riêng khỏi page.tsx (không gộp vào component nội bộ của trang) vì Next.js App Router chỉ
 * cho phép page.tsx export đúng tập tên dành riêng (default, metadata, generateStaticParams...);
 * export thêm một component thường sẽ FAIL tsc (kiểm tra kiểu sinh ra trong .next/types/app cho
 * từng trang).
 */
export function BankTransferPanel({
  order,
  onPaid,
  paidFooter,
  showHeading = true,
  onState,
  orderHref,
  stickyCheck = false,
}: {
  order: Pick<OrderDTO, 'code' | 'paymentMethod'>;
  onPaid?: () => void;
  /** Lối đi tiếp ở khung "Đã nhận thanh toán" (trang chuyển khoản cho nút tới đơn); trang chi tiết đơn không cần. */
  paidFooter?: ReactNode;
  /** Trang riêng của đơn đã có tiêu đề "Quét QR để chuyển khoản" ở đầu trang (như PageHeader của Mini App) nên tắt tiêu đề trong khung. */
  showHeading?: boolean;
  /** Trang chứa chỉ ghi "Quét QR" khi thật sự có QR để quét (như bank-payment.tsx của Mini App). */
  onState?: (state: BankPanelState) => void;
  /** Có thì khối lỗi và khối "không còn chờ chuyển khoản" dẫn về đơn (trang riêng của đơn); trang chi tiết đơn đã ở đó nên không truyền. */
  orderHref?: string;
  /** Trang riêng của đơn: ở điện thoại nút Kiểm tra dính đáy như StickyActionBar của Mini App; từ md vẫn nằm trong dòng chảy. */
  stickyCheck?: boolean;
}) {
  const isBankTransfer = order.paymentMethod === 'BANK_TRANSFER';
  const { data, isLoading, refetch, isFetching, error } = useQuery({
    queryKey: ['bank-qr', order.code],
    queryFn: () => getBankQr(order.code),
    enabled: isBankTransfer,
    // Pancake/ngân hàng đối soát chuyển khoản → webhook lật PAID; FE tự dò mỗi 4s tới khi thấy tiền về.
    refetchInterval: (q) => (q.state.data?.paymentStatus === 'PAID' || isFinalRejection(q.state.error) ? false : 4000),
  });
  // Cờ riêng cho lần khách bấm tay: `isFetching` còn bật theo nhịp dò nền 4s, gắn vào nút thì nút khoá/nhấp nháy đúng lúc khách chạm.
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<'unpaid' | 'failed' | 'error' | null>(null);
  const [checkError, setCheckError] = useState(NETWORK_CHECK_MESSAGE);
  const [qrSaved, setQrSaved] = useState<SaveImageResult | null>(null);
  const [savingQr, setSavingQr] = useState(false);
  // Ref: hai lần chạm liền nhau chưa kịp vẽ lại thì state `savingQr` còn cũ.
  const savingQrNow = useRef(false);

  // Trang chứa khung này (chi tiết đơn) cần tải lại trạng thái đơn khi tiền về, nếu không thì
  // khung báo "Đã nhận thanh toán" còn nhãn đơn vẫn là "Chờ thanh toán".
  const remaining = useRemaining(data?.paymentDeadline);
  const paid = data?.paymentStatus === 'PAID';
  useEffect(() => {
    if (paid) onPaid?.();
  }, [paid, onPaid]);

  const closedMessage = paid ? null : isFinalRejection(error) ? errorMessage(error) : remaining.expired ? EXPIRED_MESSAGE : null;
  const panelState: BankPanelState = isLoading ? 'loading' : paid ? 'paid' : closedMessage ? 'closed' : data ? 'ready' : 'error';
  useEffect(() => {
    if (isBankTransfer) onState?.(panelState);
  }, [isBankTransfer, panelState, onState]);

  if (!isBankTransfer) return null;

  const handleCheck = async () => {
    setChecking(true);
    setCheckResult(null);
    try {
      const res = await refetch({ throwOnError: true });
      const status = res.data?.paymentStatus;
      setCheckResult(status === 'PAID' ? null : status === 'FAILED' || status === 'REFUNDED' ? 'failed' : 'unpaid');
    } catch (e) {
      setCheckError(isFinalRejection(e) ? errorMessage(e) : isSessionExpired(e) ? sessionExpiredText(e as ApiError) : NETWORK_CHECK_MESSAGE);
      setCheckResult('error');
    } finally {
      setChecking(false);
    }
  };

  const handleSaveQr = async (url: string, orderCode: string) => {
    if (savingQrNow.current) return;
    savingQrNow.current = true;
    setSavingQr(true);
    try {
      setQrSaved(await platformBridge.saveImage(url, `tubu-qr-${orderCode}.png`));
    } finally {
      savingQrNow.current = false;
      setSavingQr(false);
    }
  };

  if (isLoading) {
    return (
      <section className={`mt-4 p-6 text-center ${ui.card}`}>
        <p className="text-sm text-stone-600">Đang tải thông tin chuyển khoản…</p>
      </section>
    );
  }

  // PAID xét trước lỗi: khung xác nhận tiền là điều khách đã thấy, một lần dò lại hỏng (mất mạng, đơn sau đó bị hủy nên
  // API từ chối QR) không được thay nó bằng báo lỗi. React Query giữ `data` cũ khi refetch lỗi.
  if (data?.paymentStatus === 'PAID') {
    return (
      <section role="status" className="mt-4 rounded-card border border-forest-200 bg-forest-50 p-6 text-center">
        <CheckCircle2 className="mx-auto h-9 w-9 text-success-fg" aria-hidden="true" />
        <p className="mt-2 font-semibold text-forest-800">Đã nhận thanh toán!</p>
        <p className="text-sm text-forest-700">Đơn {data.orderCode} đã được xác nhận. Cảm ơn bạn.</p>
        {paidFooter}
      </section>
    );
  }

  if (closedMessage) {
    return (
      <section role="status" className="mt-4 px-6 py-10 text-center">
        <TriangleAlert className="mx-auto h-9 w-9 text-danger-fg" aria-hidden="true" />
        <p className="mt-3 text-base font-semibold text-stone-900">Đơn không còn chờ chuyển khoản</p>
        <p className="mt-1 text-sm text-stone-600">{closedMessage}</p>
        {orderHref && (
          <Link href={orderHref} className={`${ui.btnPrimary} mt-6 w-full`}>
            Xem đơn hàng
          </Link>
        )}
      </section>
    );
  }

  // Một lần dò nền lỗi (mất mạng chớp nhoáng) không được thay khung QR đang hiện: React Query giữ `data` cũ,
  // khách vẫn quét/chuyển được. Chỉ báo lỗi cả khung khi chưa từng có dữ liệu.
  if (!data) {
    return (
      <section role="alert" className="mt-4 flex flex-col items-center gap-2.5 px-6 py-10 text-center">
        <span aria-hidden="true" className="grid h-14 w-14 place-items-center rounded-full bg-warning-bg">
          <TriangleAlert className="h-7 w-7 text-warning-fg" />
        </span>
        <p className="text-base font-semibold text-stone-900">Chưa tải được thông tin thanh toán</p>
        <p className="max-w-xs text-sm text-stone-600">{errorMessage(error)}</p>
        <button type="button" disabled={isFetching} aria-busy={isFetching || undefined} onClick={() => void refetch()} className={ui.btnSecondary}>
          Thử lại
        </button>
        {orderHref && (
          <Link href={orderHref} className={ui.btnSecondary}>
            Xem đơn hàng
          </Link>
        )}
        <SupportHotline />
      </section>
    );
  }

  return (
    <section className={`mt-4 p-4 ${ui.card} max-md:contents`}>
      {showHeading && (
        <>
          <h2 className={`text-center ${ui.sectionTitle}`}>Quét QR để chuyển khoản</h2>
          <p className="mt-1 text-center text-xs text-stone-600 md:hidden">{BANK_QR_HINT}</p>
        </>
      )}

      <div
        data-bank-card
        className="max-md:mx-2 max-md:mt-2 max-md:rounded-card max-md:bg-[var(--color-bg-surface)] max-md:p-3 max-md:text-center max-md:shadow-[var(--elevation-1)]"
      >
        <div className="mt-3 flex flex-col items-center gap-2 text-center max-md:mt-0 max-md:gap-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.qrImageUrl}
            alt="VietQR"
            className="h-56 w-56 rounded-card border border-stone-200 bg-stone-0 object-contain max-md:h-60 max-md:w-60 max-md:max-w-[70%] max-md:rounded-none max-md:border-0"
          />
          <div className="flex items-center justify-center gap-1.5 max-md:mt-2 max-md:py-1.5">
            <p className="text-xl font-bold text-stone-900 max-md:text-lg max-md:font-semibold max-md:text-success-fg">{formatVnd(data.amount)}</p>
            <span className="md:hidden">
              <CopyControls text={String(data.amount)} name="số tiền" iconOnly />
            </span>
          </div>
          {!!data.paidSoFar && data.paidSoFar > 0 && (
            <p data-testid="paid-so-far" className="text-xs text-warning-fg max-md:mt-1 max-md:text-sm">
              Đã nhận {formatVnd(data.paidSoFar)}, còn thiếu {formatVnd(data.amount)}. Mã QR đã trừ phần này.
            </p>
          )}
          <button
            type="button"
            onClick={() => void handleSaveQr(data.qrImageUrl, data.orderCode)}
            disabled={savingQr}
            className={`${ui.btnSecondary} ${mini.secondary} gap-2 max-md:mt-2 max-md:w-full`}
          >
            <Download className="h-4 w-4 max-md:hidden" aria-hidden="true" />
            Lưu mã QR
          </button>
          {qrSaved && (
            <p role="status" data-testid="bank-qr-saved" className="text-xs text-stone-700">
              {qrSaved === 'saved'
                ? BANK_QR_SAVED
                : BANK_QR_SAVE_FAILED}
            </p>
          )}
        </div>

        <div className="mt-3 space-y-1 text-sm max-md:mt-2 max-md:space-y-0 max-md:text-left">
          <PanelRow label="Ngân hàng" value={data.bank.name} stacked />
          <div data-bank-row className={ROW}>
            <span className={LABEL}>Số tài khoản</span>
            <span className="flex items-center gap-2 font-mono font-semibold text-stone-900 max-md:gap-1.5 max-md:font-ui">
              {data.bank.accountNo}
              <CopyControls text={data.bank.accountNo} name="số tài khoản" />
            </span>
          </div>
          <PanelRow label="Chủ tài khoản" value={data.bank.accountName} stacked />
          {/* Điện thoại: số tiền đã ở giữa thẻ kèm nút chép (như Mini App) nên bỏ dòng lặp. */}
          <div data-bank-row className={`${ROW} max-md:hidden`}>
            <span className={LABEL}>Số tiền</span>
            <span className="flex items-center gap-2 font-semibold text-stone-900 max-md:gap-1.5">
              {formatVnd(data.amount)}
              <CopyControls text={String(data.amount)} name="số tiền" />
            </span>
          </div>
          <div data-bank-row className={ROW}>
            <span className={LABEL}>Nội dung CK</span>
            <span className="flex items-center gap-2 font-semibold text-forest-700 max-md:gap-1.5 max-md:text-success-fg">
              {data.memo}
              <CopyControls text={data.memo} name="nội dung chuyển khoản" />
            </span>
          </div>
        </div>

        {/* Hướng dẫn trước khi chuyển, chưa phải lỗi: khối lưu ý cùng màu với khung hạn thay cho chữ đỏ nhỏ. */}
        <p data-testid="memo-note" className="mt-2 rounded-control bg-warning-bg p-3 text-left text-sm text-warning-fg">
          <TriangleAlert className="mr-1 inline h-4 w-4 align-text-bottom" aria-hidden="true" />
          Giữ nguyên nội dung <b>{data.memo}</b> để hệ thống tự xác nhận.
        </p>
      </div>
      {data.paymentDeadline && (
        <div className={DEADLINE_BOX}>
          <p role="note" className="mt-1 text-center text-xs font-medium text-warning-fg max-md:mt-0 max-md:text-left max-md:text-sm max-md:text-[color:var(--color-status-warning-fg)]">
            Chuyển khoản trước <b>{formatDateTime(data.paymentDeadline)}</b> — quá hạn đơn sẽ tự huỷ.
          </p>
          {/* Không phải vùng đọc tự động: đồng hồ đổi mỗi 15 giây, đọc lại liên tục sẽ làm phiền người dùng trình đọc màn hình. */}
          {remaining.text && (
            <p
              data-testid="payment-countdown"
              className="mt-1 text-center text-xs font-semibold text-warning-fg max-md:mt-1.5 max-md:text-left max-md:text-sm"
            >
              {`${remaining.text} để chuyển khoản`}
            </p>
          )}
        </div>
      )}

      {/* Dòng trạng thái dò nền: không phải vùng đọc-to (role=status) vì đổi chữ mỗi 4 giây. */}
      <div data-testid="bank-poll-status" className="mt-3 flex items-center justify-center gap-1.5 text-xs text-stone-600 max-md:mx-2 max-md:mt-3.5 max-md:text-sm max-md:text-[color:var(--color-text-tertiary)]">
        {isFetching ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        <span>{isFetching ? 'Đang kiểm tra…' : 'Đang chờ thanh toán… tự cập nhật khi nhận được tiền'}</span>
      </div>

      <button
        type="button"
        onClick={() => void handleCheck()}
        disabled={checking}
        className={`${ui.btnPrimary} mt-4 w-full max-md:mx-2 max-md:mt-3 max-md:w-[calc(100%-16px)] ${stickyCheck ? 'max-md:hidden' : ''}`}
      >
        {checking ? 'Đang kiểm tra…' : 'Tôi đã chuyển khoản — Kiểm tra'}
      </button>
      {checkResult && (
        <p
          role="status"
          data-testid="bank-check-result"
          className={`mt-2 text-center text-xs ${checkResult === 'error' || checkResult === 'failed' ? 'text-danger-fg' : 'text-stone-700'}`}
        >
          {checkResult === 'error'
            ? checkError
            : checkResult === 'failed'
              ? 'Giao dịch không thành công hoặc đã được hoàn lại. Vui lòng liên hệ bộ phận hỗ trợ.'
              : 'Chưa thấy tiền về. Ngân hàng thường xử lý trong 30 giây đến 1 phút sau khi chuyển.'}
        </p>
      )}
      {stickyCheck && (
        <StickyActionBar label="Kiểm tra thanh toán">
          <button type="button" onClick={() => void handleCheck()} disabled={checking} className={`${ui.btnPrimary} w-full`}>
            {checking ? 'Đang kiểm tra…' : 'Tôi đã chuyển khoản — Kiểm tra'}
          </button>
        </StickyActionBar>
      )}
    </section>
  );
}

const NETWORK_CHECK_MESSAGE = 'Không kết nối được tới Tubu Tree. Bạn kiểm tra mạng rồi bấm lại nhé.';

// Dòng thông tin ngân hàng: từ md khoảng đệm trơn; ở điện thoại có đường kẻ phía trên như Row của bank-payment.tsx.
const ROW = 'flex items-center justify-between py-1 max-md:border-t max-md:border-[var(--color-border-subtle)] max-md:py-1.5';
const LABEL = 'text-stone-600 max-md:text-[color:var(--color-text-tertiary)]';
// Mini App: hạn chuyển khoản là hộp nền cảnh báo ngoài thẻ QR.
const DEADLINE_BOX = 'max-md:mx-2 max-md:mt-2 max-md:rounded-control max-md:bg-[var(--color-status-warning-bg)] max-md:p-3';

/** Sao chép: nút chữ có viền từ md; ở điện thoại chỉ là icon không viền (IconButton sm của Mini App). */
function CopyControls({ text, name, iconOnly = false }: { text: string; name: string; iconOnly?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = async () => {
    // Chỉ báo "Đã sao chép" khi thật sự vào clipboard: báo sai thì khách dán số tài khoản cũ vào app ngân hàng.
    const ok = await copyText(text);
    setFailed(!ok);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2000);
  };
  return (
    <>
      {!iconOnly && (
        <span className="max-md:hidden">
          <CopyButton text={text} label="Sao chép" />
        </span>
      )}
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Sao chép ${name}`}
        className="-my-1.5 -mr-2.5 inline-flex h-11 w-11 items-center justify-center rounded-full text-[color:var(--color-text-primary)] md:hidden"
      >
        {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
      </button>
      {copied && (
        <span role="status" className="sr-only md:hidden">
          Đã sao chép {name}
        </span>
      )}
      {failed && (
        <span role="alert" className="basis-full text-xs text-danger-fg md:hidden">
          Không thể sao chép {name}. Vui lòng sao chép thủ công.
        </span>
      )}
    </>
  );
}

function PanelRow({ label, value, stacked = false }: { label: string; value: string; stacked?: boolean }) {
  return (
    <div data-bank-row className={`${ROW}${stacked ? ' max-md:flex-col max-md:items-start' : ''}`}>
      <span className={LABEL}>{label}</span>
      <span className="font-medium text-stone-900 max-md:font-semibold">{value}</span>
    </div>
  );
}
