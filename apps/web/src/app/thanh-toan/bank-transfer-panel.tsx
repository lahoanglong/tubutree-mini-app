'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Download, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getBankQr, formatVnd, type OrderDTO } from '@/lib/shop-client';
import { CopyButton } from '@/components/copy-button';
import { ui } from '@/lib/guest-ui';
import { formatDateTime } from '@/lib/format-date';
import { saveImage, type SaveImageResult } from '@/lib/download-image';

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
export function BankTransferPanel({ order, onPaid }: { order: OrderDTO; onPaid?: () => void }) {
  const isBankTransfer = order.paymentMethod === 'BANK_TRANSFER';
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['bank-qr', order.code],
    queryFn: () => getBankQr(order.code),
    enabled: isBankTransfer,
    // Pancake/ngân hàng đối soát chuyển khoản → webhook lật PAID; FE tự dò mỗi 4s tới khi thấy tiền về.
    refetchInterval: (q) => (q.state.data?.paymentStatus === 'PAID' ? false : 4000),
  });
  // Cờ riêng cho lần khách bấm tay: `isFetching` còn bật theo nhịp dò nền 4s, gắn vào nút thì nút khoá/nhấp nháy đúng lúc khách chạm.
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<'unpaid' | 'error' | null>(null);
  const [qrSaved, setQrSaved] = useState<SaveImageResult | null>(null);

  // Trang chứa khung này (chi tiết đơn) cần tải lại trạng thái đơn khi tiền về, nếu không thì
  // khung báo "Đã nhận thanh toán" còn nhãn đơn vẫn là "Chờ thanh toán".
  const paid = data?.paymentStatus === 'PAID';
  useEffect(() => {
    if (paid) onPaid?.();
  }, [paid, onPaid]);

  if (!isBankTransfer) return null;

  const handleCheck = async () => {
    setChecking(true);
    setCheckResult(null);
    try {
      const res = await refetch({ throwOnError: true });
      setCheckResult(res.data?.paymentStatus === 'PAID' ? null : 'unpaid');
    } catch {
      setCheckResult('error');
    } finally {
      setChecking(false);
    }
  };

  const handleSaveQr = async (url: string, orderCode: string) => {
    setQrSaved(await saveImage(url, `tubu-qr-${orderCode}.png`));
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
      </section>
    );
  }

  // Một lần dò nền lỗi (mất mạng chớp nhoáng) không được thay khung QR đang hiện: React Query giữ `data` cũ,
  // khách vẫn quét/chuyển được. Chỉ báo lỗi cả khung khi chưa từng có dữ liệu.
  if (!data) {
    return (
      <section className={`mt-4 p-6 text-center ${ui.card}`}>
        <p className={ui.error}>Không tải được thông tin thanh toán.</p>
        <button type="button" onClick={() => void refetch()} className={`${ui.btnText} mt-1 text-forest-700`}>
          Thử lại
        </button>
      </section>
    );
  }

  return (
    <section className={`mt-4 p-4 ${ui.card}`}>
      <h2 className={`text-center ${ui.sectionTitle}`}>Quét QR để chuyển khoản</h2>
      <p className="mt-1 text-center text-xs text-stone-600">
        Mở app ngân hàng / ví bất kỳ để quét mã bên dưới
      </p>

      <div className="mt-3 flex flex-col items-center gap-2 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={data.qrImageUrl}
          alt="VietQR"
          className="h-56 w-56 rounded-card border border-stone-200 bg-stone-0 object-contain"
        />
        <p className="text-xl font-bold text-stone-900">{formatVnd(data.amount)}</p>
        <button
          type="button"
          onClick={() => void handleSaveQr(data.qrImageUrl, data.orderCode)}
          className={`${ui.btnSecondary} gap-2`}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Lưu mã QR
        </button>
        {qrSaved && (
          <p role="status" data-testid="bank-qr-saved" className="text-xs text-stone-700">
            {qrSaved === 'saved'
              ? 'Đã lưu ảnh QR vào máy.'
              : 'Chưa lưu được. Bạn nhấn giữ vào ảnh QR để lưu, hoặc chụp màn hình nhé.'}
          </p>
        )}
      </div>

      <div className="mt-3 space-y-1 text-sm">
        <PanelRow label="Ngân hàng" value={data.bank.name} />
        <div className="flex items-center justify-between py-1">
          <span className="text-stone-600">Số tài khoản</span>
          <span className="flex items-center gap-2 font-mono font-semibold text-stone-900">
            {data.bank.accountNo}
            <CopyButton text={data.bank.accountNo} label="Sao chép" />
          </span>
        </div>
        <PanelRow label="Chủ tài khoản" value={data.bank.accountName} />
        <div className="flex items-center justify-between py-1">
          <span className="text-stone-600">Nội dung CK</span>
          <span className="flex items-center gap-2 font-semibold text-forest-700">
            {data.memo}
            <CopyButton text={data.memo} label="Sao chép" />
          </span>
        </div>
      </div>

      <p className="mt-2 text-center text-xs text-danger-fg">
        Giữ nguyên nội dung <b>{data.memo}</b> để hệ thống tự xác nhận.
      </p>
      {data.paymentDeadline && (
        <p role="note" className="mt-1 text-center text-xs font-medium text-warning-fg">
          Chuyển khoản trước <b>{formatDateTime(data.paymentDeadline)}</b> — quá hạn đơn sẽ tự huỷ.
        </p>
      )}

      {/* Dòng trạng thái dò nền: không phải vùng đọc-to (role=status) vì đổi chữ mỗi 4 giây. */}
      <div data-testid="bank-poll-status" className="mt-3 flex items-center justify-center gap-1.5 text-xs text-stone-600">
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
        className={`${ui.btnPrimary} mt-4 w-full`}
      >
        {checking ? 'Đang kiểm tra…' : 'Tôi đã chuyển khoản, kiểm tra lại'}
      </button>
      {checkResult && (
        <p
          role="status"
          data-testid="bank-check-result"
          className={`mt-2 text-center text-xs ${checkResult === 'error' ? 'text-danger-fg' : 'text-stone-700'}`}
        >
          {checkResult === 'error'
            ? 'Không kết nối được tới Tubu Tree. Bạn kiểm tra mạng rồi bấm lại nhé.'
            : 'Chưa thấy tiền về. Ngân hàng thường xử lý trong 30 giây đến 1 phút sau khi chuyển.'}
        </p>
      )}
    </section>
  );
}

function PanelRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-stone-600">{label}</span>
      <span className="font-medium text-stone-900">{value}</span>
    </div>
  );
}
