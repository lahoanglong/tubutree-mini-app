'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  MAX_START_DAYS_AHEAD,
  SUBSCRIPTION_PAYMENT_METHODS,
  createSubscription,
  type SubscriptionPaymentMethod,
} from '@tubutree/app-core/api/subscriptions';
import { Sheet } from '@/components/ui/sheet';
import { Field } from '@/components/ui/field';
import { Chip } from '@/components/catalog/chip';
import { coreHttp } from '@/lib/core-http';
import { getAddresses, getWallet } from '@/lib/shop-client';
import { formatVnd } from '@/lib/format-vnd';
import { bankPaymentHref } from '@/lib/order-view';
import { ui } from '@/lib/guest-ui';
import { usePublicConfig } from '@/lib/use-public-config';
import { addressText, formatVnDate, isStartDateAllowed, startDateRange } from '@/lib/subscription-options';

const INTERVALS = [4, 6, 8, 10];

const PAY_LABEL: Record<SubscriptionPaymentMethod, string> = {
  COD: 'Thanh toán khi nhận hàng (COD)',
  WALLET: 'Ví Tubu',
  BANK_TRANSFER: 'Chuyển khoản ngân hàng',
};
const PAY_HINT: Record<SubscriptionPaymentMethod, string> = {
  COD: 'Trả tiền mặt cho shipper mỗi lần giao.',
  WALLET: 'Tự trừ Ví Tubu mỗi kỳ. Ví không đủ tiền thì gói tạm dừng và Tubu báo cho bạn.',
  BANK_TRANSFER: 'Mỗi kỳ Tubu tạo đơn chờ chuyển khoản. Quá hạn chưa chuyển thì đơn tự hủy.',
};

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1 mt-4 text-sm font-semibold text-stone-900">{children}</div>;
}

function RadioRow({ checked, onSelect, title, hint }: { checked: boolean; onSelect: () => void; title: ReactNode; hint?: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={() => {
        if (!checked) onSelect();
      }}
      className="flex min-h-11 w-full items-center gap-3 py-2 text-left"
    >
      <span
        aria-hidden="true"
        className={`h-5 w-5 shrink-0 rounded-full border-2 ${checked ? 'border-forest-600 bg-forest-600 ring-2 ring-inset ring-stone-0' : 'border-stone-450 bg-stone-0'}`}
      />
      <span className="min-w-0 flex-1">
        <span className={`block text-sm text-stone-900 ${checked ? 'font-semibold' : ''}`}>{title}</span>
        {hint && <span className="block text-xs text-stone-600">{hint}</span>}
      </span>
    </button>
  );
}

/**
 * Đặt định kỳ: cùng endpoint và body với Mini App (POST /me/subscriptions). `onNotice` nhận câu báo kết quả để trang hiện thay
 * cho snackbar của Mini App; lỗi hiện ngay trong sheet và sheet vẫn mở.
 */
export function SubscribeSheet({
  visible,
  onClose,
  onNotice,
  variationId,
  quantity,
}: {
  visible: boolean;
  onClose: () => void;
  onNotice: (text: string) => void;
  variationId: string;
  quantity: number;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [weeks, setWeeks] = useState(4);
  const [startMode, setStartMode] = useState<'now' | 'date'>('now');
  const [startDate, setStartDate] = useState('');
  const [payment, setPayment] = useState<SubscriptionPaymentMethod>('COD');
  const [addressId, setAddressId] = useState<string | undefined>();
  const discountPct = Math.round(usePublicConfig().subscribeDiscountPct * 100);
  const addrQ = useQuery({ queryKey: ['addresses'], queryFn: getAddresses, enabled: visible });
  const walletQ = useQuery({ queryKey: ['wallet'], queryFn: getWallet, enabled: visible });
  const addresses = addrQ.data ?? [];
  const defaultAddr = addresses.find((a) => a.isDefault) ?? addresses[0];

  useEffect(() => {
    if (!addressId && defaultAddr) setAddressId(defaultAddr.id);
  }, [addressId, defaultAddr]);

  const range = startDateRange();
  const dateOk = startMode === 'now' || isStartDateAllowed(startDate);
  const dateError =
    startMode === 'date' && startDate !== '' && !dateOk
      ? `Ngày bắt đầu phải từ ngày mai tới ${MAX_START_DAYS_AHEAD} ngày tới.`
      : undefined;

  const create = useMutation({
    mutationFn: () =>
      createSubscription(coreHttp, {
        variationId,
        quantity,
        intervalWeeks: weeks,
        addressId: addressId!,
        paymentMethod: payment,
        ...(startMode === 'date' ? { startDate } : {}),
      }),
    onSuccess: (sub) => {
      void qc.invalidateQueries({ queryKey: ['subscriptions'] });
      const first = sub.firstOrder;
      if (first) {
        void qc.invalidateQueries({ queryKey: ['orders'] });
        if (first.paymentMethod === 'WALLET') void qc.invalidateQueries({ queryKey: ['wallet'] });
      }
      onClose();
      if (first?.paymentMethod === 'BANK_TRANSFER' && first.status === 'PENDING_PAYMENT') {
        onNotice(`Đã tạo đơn đầu ${first.code}, bạn chuyển khoản để Tubu giao nhé`);
        router.push(bankPaymentHref(first.code));
        return;
      }
      // Giao ngay mà không có đơn đầu nghĩa là API trả lại gói y hệt đã có (bấm đúp/thử lại).
      onNotice(
        first
          ? `Đã tạo lịch định kỳ và đơn đầu ${first.code} 🌿`
          : startMode === 'now'
            ? 'Bạn đã có lịch định kỳ này rồi, xem ở mục Định kỳ trong Đơn hàng 🌿'
            : `Đã tạo lịch định kỳ, đơn đầu giao từ ${formatVnDate(startDate)} 🌿`,
      );
    },
  });

  // Sheet luôn gắn sẵn: lỗi của lần tạo trước không được nằm lại khi khách đóng, nạp Ví rồi mở lại.
  // Đang gửi thì giữ nguyên, nếu không nút mở khoá giữa chừng và khách bấm ra POST thứ hai.
  const resetCreate = create.reset;
  const creating = create.isPending;
  useEffect(() => {
    if (!creating) resetCreate();
  }, [visible, creating, resetCreate]);

  const noAddress = addrQ.isSuccess && addresses.length === 0;

  return (
    <Sheet
      open={visible}
      onClose={onClose}
      title={`Đặt định kỳ — tiết kiệm ${discountPct}%`}
      description="Tự động giao lại theo chu kỳ bạn chọn. Tạm dừng, sửa hoặc hủy bất kỳ lúc nào."
      size="full"
      footer={
        noAddress ? undefined : (
          <div>
            {create.isError && (
              <p role="alert" className={`mb-2 ${ui.error}`}>
                {create.error instanceof Error ? create.error.message : 'Không tạo được lịch định kỳ.'}
              </p>
            )}
            <button
              type="button"
              className={`${ui.btnPrimary} w-full`}
              disabled={!addressId || !dateOk || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? 'Đang tạo…' : 'Bắt đầu đặt định kỳ'}
            </button>
          </div>
        )
      }
    >
      <SectionLabel>Chu kỳ giao</SectionLabel>
      <div role="group" aria-label="Chu kỳ giao" className="flex flex-wrap gap-2 py-1">
        {INTERVALS.map((w) => (
          <Chip key={w} selected={weeks === w} onPress={() => setWeeks(w)}>
            {w} tuần
          </Chip>
        ))}
      </div>

      <SectionLabel>Đơn đầu tiên</SectionLabel>
      <div role="group" aria-label="Đơn đầu tiên" className="flex gap-2 py-1">
        <Chip selected={startMode === 'now'} onPress={() => setStartMode('now')}>
          Giao ngay
        </Chip>
        <Chip
          selected={startMode === 'date'}
          onPress={() => {
            setStartMode('date');
            if (!startDate) setStartDate(range.min);
          }}
        >
          Chọn ngày
        </Chip>
      </div>
      {startMode === 'now' ? (
        <p className="mt-1 text-xs text-stone-600">Tubu tạo đơn đầu ngay khi bạn xác nhận.</p>
      ) : (
        <div className="mt-2">
          <Field label="Ngày bắt đầu giao" error={dateError}>
            <input
              type="date"
              value={startDate}
              min={range.min}
              max={range.max}
              onChange={(e) => setStartDate(e.target.value)}
              className={dateError ? ui.fieldError : ui.field}
            />
          </Field>
          {!dateError && <p className="mt-1 text-xs text-stone-600">Chọn một ngày trong vòng {MAX_START_DAYS_AHEAD} ngày tới.</p>}
        </div>
      )}

      <SectionLabel>Thanh toán mỗi kỳ</SectionLabel>
      <div role="radiogroup" aria-label="Thanh toán mỗi kỳ">
        {SUBSCRIPTION_PAYMENT_METHODS.map((m) => (
          <RadioRow
            key={m}
            checked={payment === m}
            onSelect={() => setPayment(m)}
            title={m === 'WALLET' && walletQ.data ? `Ví Tubu (${formatVnd(walletQ.data.walletBalance)})` : PAY_LABEL[m]}
            hint={payment === m ? PAY_HINT[m] : undefined}
          />
        ))}
      </div>

      <SectionLabel>Giao tới</SectionLabel>
      {addrQ.isError ? (
        <p role="alert" className={ui.error}>
          Không tải được địa chỉ. Bạn đóng rồi mở lại để thử nhé.
        </p>
      ) : noAddress ? (
        <div>
          <p className={ui.error}>Bạn cần thêm địa chỉ giao hàng trước.</p>
          <button
            type="button"
            className={`${ui.btnSecondary} mt-2 w-full`}
            onClick={() => {
              onClose();
              router.push('/tai-khoan/dia-chi');
            }}
          >
            Thêm địa chỉ
          </button>
        </div>
      ) : (
        <div role="radiogroup" aria-label="Giao tới">
          {addresses.map((a) => (
            <RadioRow
              key={a.id}
              checked={addressId === a.id}
              onSelect={() => setAddressId(a.id)}
              title={`${a.recipient} · ${a.phone}`}
              hint={addressText(a)}
            />
          ))}
        </div>
      )}
    </Sheet>
  );
}
