'use client';

import { useState } from 'react';
import { CheckCircle2, Clock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getBankQr, formatVnd, type OrderDTO } from '@/lib/shop-client';
import { CopyButton } from '@/components/copy-button';

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
      <section className="mt-4 rounded-lg border border-neutral-100 bg-white p-6 text-center">
        <p className="text-sm text-neutral-400">Đang tải thông tin chuyển khoản…</p>
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section className="mt-4 rounded-lg border border-neutral-100 bg-white p-6 text-center">
        <p className="text-sm text-red-600">Không tải được thông tin thanh toán.</p>
        <button onClick={() => void refetch()} className="mt-2 text-sm font-medium text-primary-600 underline">
          Thử lại
        </button>
      </section>
    );
  }

  if (data.paymentStatus === 'PAID') {
    return (
      <section role="status" className="mt-4 rounded-lg border border-leaf-200 bg-leaf-50 p-6 text-center">
        <CheckCircle2 className="mx-auto h-9 w-9 text-leaf-600" />
        <p className="mt-2 font-semibold text-leaf-800">Đã nhận thanh toán!</p>
        <p className="text-sm text-leaf-700">Đơn {data.orderCode} đã được xác nhận. Cảm ơn bạn.</p>
      </section>
    );
  }

  return (
    <section className="mt-4 rounded-lg border border-neutral-100 bg-white p-4">
      <h2 className="text-center font-semibold">Quét QR để chuyển khoản</h2>
      <p className="mt-1 text-center text-xs text-neutral-500">
        Mở app ngân hàng / ví bất kỳ để quét mã bên dưới
      </p>

      <div className="mt-3 flex flex-col items-center gap-2 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={data.qrImageUrl}
          alt="VietQR"
          className="h-56 w-56 rounded-lg border border-neutral-100 object-contain"
        />
        <p className="text-xl font-bold text-clay-700">{formatVnd(data.amount)}</p>
      </div>

      <div className="mt-3 space-y-1 text-sm">
        <PanelRow label="Ngân hàng" value={data.bank.name} />
        <div className="flex items-center justify-between py-1">
          <span className="text-neutral-600">Số tài khoản</span>
          <span className="flex items-center gap-2 font-mono font-semibold">
            {data.bank.accountNo}
            <CopyButton text={data.bank.accountNo} label="Sao chép" />
          </span>
        </div>
        <PanelRow label="Chủ tài khoản" value={data.bank.accountName} />
        <div className="flex items-center justify-between py-1">
          <span className="text-neutral-600">Nội dung CK</span>
          <span className="flex items-center gap-2 font-semibold text-leaf-700">
            {data.memo}
            <CopyButton text={data.memo} label="Sao chép" />
          </span>
        </div>
      </div>

      <p className="mt-2 text-center text-xs text-red-600">
        Giữ nguyên nội dung <b>{data.memo}</b> để hệ thống tự xác nhận.
      </p>

      <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-neutral-500">
        <Clock className="h-3.5 w-3.5" />
        <span>Đang chờ thanh toán… tự cập nhật khi nhận được tiền</span>
      </div>

      <button
        onClick={() => void handleCheck()}
        disabled={checking || isFetching}
        className="mt-4 w-full rounded-md bg-primary-600 px-6 py-2.5 font-medium text-white disabled:bg-neutral-300"
      >
        {checking || isFetching ? 'Đang kiểm tra…' : 'Tôi đã chuyển khoản, kiểm tra lại'}
      </button>
    </section>
  );
}

function PanelRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-neutral-600">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
