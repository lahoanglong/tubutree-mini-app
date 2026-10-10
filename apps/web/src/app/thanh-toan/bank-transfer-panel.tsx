'use client';

import { useState } from 'react';
import { CheckCircle2, Clock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getBankQr, formatVnd, type OrderDTO } from '@/lib/shop-client';
import { CopyButton } from '@/components/copy-button';
import { ui } from '@/lib/guest-ui';

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
export function BankTransferPanel({ order }: { order: OrderDTO }) {
  const isBankTransfer = order.paymentMethod === 'BANK_TRANSFER';
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['bank-qr', order.code],
    queryFn: () => getBankQr(order.code),
    enabled: isBankTransfer,
    // Pancake/ngân hàng đối soát chuyển khoản → webhook lật PAID; FE tự dò mỗi 4s tới khi thấy tiền về.
    refetchInterval: (q) => (q.state.data?.paymentStatus === 'PAID' ? false : 4000),
  });
  const [checking, setChecking] = useState(false);

  if (!isBankTransfer) return null;

  const handleCheck = async () => {
    setChecking(true);
    try {
      await refetch();
    } finally {
      setChecking(false);
    }
  };

  if (isLoading) {
    return (
      <section className={`mt-4 p-6 text-center ${ui.card}`}>
        <p className="text-sm text-stone-600">Đang tải thông tin chuyển khoản…</p>
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section className={`mt-4 p-6 text-center ${ui.card}`}>
        <p className={ui.error}>Không tải được thông tin thanh toán.</p>
        <button type="button" onClick={() => void refetch()} className={`${ui.btnText} mt-1 text-forest-700`}>
          Thử lại
        </button>
      </section>
    );
  }

  if (data.paymentStatus === 'PAID') {
    return (
      <section role="status" className="mt-4 rounded-card border border-forest-200 bg-forest-50 p-6 text-center">
        <CheckCircle2 className="mx-auto h-9 w-9 text-success-fg" aria-hidden="true" />
        <p className="mt-2 font-semibold text-forest-800">Đã nhận thanh toán!</p>
        <p className="text-sm text-forest-700">Đơn {data.orderCode} đã được xác nhận. Cảm ơn bạn.</p>
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

      <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-stone-600">
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Đang chờ thanh toán… tự cập nhật khi nhận được tiền</span>
      </div>

      <button
        type="button"
        onClick={() => void handleCheck()}
        disabled={checking || isFetching}
        className={`${ui.btnPrimary} mt-4 w-full`}
      >
        {checking || isFetching ? 'Đang kiểm tra…' : 'Tôi đã chuyển khoản, kiểm tra lại'}
      </button>
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
