'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  MAX_START_DAYS_AHEAD,
  SUBSCRIPTION_PAYMENT_METHODS,
  createSubscription,
  type SubscriptionPaymentMethod,
} from '@tubutree/app-core/api/subscriptions';
import { Sheet } from '@/components/ui/sheet';
import { Field } from '@/components/ui/field';
import { LineItemSkeleton } from '@/components/ui/skeleton';
import { Chip } from '@/components/catalog/chip';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { coreHttp } from '@/lib/core-http';
import { serverRejectedState } from '@/lib/server-rejected-state';
import { settleWithin } from '@/lib/settle-within';
import { getAddresses, getWallet } from '@/lib/shop-client';
import { formatVnd } from '@/lib/format-vnd';
import { bankPaymentHref } from '@/lib/order-view';
import { ui } from '@/lib/guest-ui';
import { usePublicConfig } from '@/lib/use-public-config';
import { addressText, formatVnDate, isStartDateAllowed, startDateRange, subscriptionWalletBlockedReason } from '@/lib/subscription-options';
import { actionErrorText, loadErrorText } from '@/lib/error-text';
import { useRovingGroup } from '@/lib/use-roving-group';

const INTERVALS = [4, 6, 8, 10];

const PAY_LABEL: Record<SubscriptionPaymentMethod, string> = {
  COD: 'Thanh toán khi nhận hàng (COD)',
  WALLET: 'Ví Tubu',
  BANK_TRANSFER: 'Chuyển khoản ngân hàng',
};
const PAY_HINT: Record<SubscriptionPaymentMethod, string> = {
  COD: 'Trả tiền mặt cho shipper mỗi lần giao.',
  WALLET: 'Tự trừ Ví Tubu mỗi kỳ. Ví không đủ tiền thì gói tạm dừng và Tubu báo cho bạn.',
  BANK_TRANSFER: 'Mỗi kỳ Tubu tạo đơn chờ chuyển khoản. Quá hạn chưa chuyển thì đơn tự huỷ.',
};

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1 mt-4 text-sm font-semibold text-stone-900">{children}</div>;
}

function RadioRow({ checked, onSelect, title, hint, disabled = false }: { checked: boolean; onSelect: () => void; title: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        if (!checked) onSelect();
      }}
      className={`flex min-h-11 w-full items-center gap-3 py-2 text-left ${disabled ? 'cursor-not-allowed' : ''}`}
    >
      <span
        aria-hidden="true"
        className={`h-5 w-5 shrink-0 rounded-full border-2 ${checked ? 'border-forest-600 bg-forest-600 ring-2 ring-inset ring-stone-0' : 'border-stone-450 bg-stone-0'}`}
      />
      <span className="min-w-0 flex-1 tabular-nums">
        <span className={`block text-sm ${disabled ? 'text-stone-500' : 'text-stone-900'} ${checked ? 'font-semibold' : ''}`}>{title}</span>
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
  const payGroup = useRovingGroup();
  const addrGroup = useRovingGroup();
  const [weeks, setWeeks] = useState(4);
  const [startMode, setStartMode] = useState<'now' | 'date'>('now');
  const [startDate, setStartDate] = useState('');
  const [payment, setPayment] = useState<SubscriptionPaymentMethod>('COD');
  const [addressId, setAddressId] = useState<string | undefined>();
  const discountPct = Math.round(usePublicConfig().subscribeDiscountPct * 100);
  const addrQ = useQuery({ queryKey: ['addresses'], queryFn: getAddresses, enabled: visible });
  const walletQ = useQuery({ queryKey: ['wallet'], queryFn: getWallet, enabled: visible });
  // Truy vấn lỗi mà chưa có dữ liệu bị react-query đặt về pending lúc tải lại và xoá lỗi; giữ vùng lỗi + nút Thử lại đứng yên
  // (không mất focus) tới khi lượt tải lại có kết quả (isPending hết). Giá trị là câu lỗi cũ để vẫn hiện chữ trong lúc chờ.
  const [addrRetrying, setAddrRetrying] = useState<string | null>(null);
  const addrFailed = addrQ.isError && !addrQ.data;
  const addrWaiting = addrRetrying !== null && addrQ.isPending;
  const walletBlocked = subscriptionWalletBlockedReason(walletQ.data?.walletBalance);
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

  // Lời lỗi ở state riêng: `create.isError` chỉ bật sau khi `onError` (tải lại, tới 4 giây) xong, mà lời báo phải hiện ngay.
  const [createError, setCreateError] = useState<{ value: unknown } | null>(null);
  const create = useLockedMutation({
    mutationFn: () =>
      createSubscription(coreHttp, {
        variationId,
        quantity,
        intervalWeeks: weeks,
        addressId: addressId!,
        paymentMethod: payment,
        ...(startMode === 'date' ? { startDate } : {}),
      }),
    onMutate: () => setCreateError(null),
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
    // Máy khác vừa tạo gói trùng (409), địa chỉ không còn (400/404), Ví vừa hết tiền (400): gói, địa chỉ và số dư Ví trên sheet đang cũ, bấm lại chỉ nhận đúng lỗi đó.
    // Trả Promise từ onError (không phải onSettled, nơi nhả khoá) để nút giữ bận tới khi dữ liệu mới về (tối đa `settleWithin`), như Mini App (apps/miniapp/src/components/subscribe-sheet.tsx:102-110); web tải thêm Ví (Mini chỉ tải gói và địa chỉ) và tính cả 422. Mạng/401/403/5xx nhả ngay.
    // Không có ô nhập chữ: chu kỳ, cách trả là lựa chọn cố định, ngày bắt đầu đã bị `isStartDateAllowed` chặn, nên 400 là trạng thái.
    onError: (e) => {
      setCreateError({ value: e });
      if (!serverRejectedState(e)) return undefined;
      return settleWithin(
        Promise.all([
          qc.invalidateQueries({ queryKey: ['subscriptions'] }),
          qc.invalidateQueries({ queryKey: ['addresses'] }),
          qc.invalidateQueries({ queryKey: ['wallet'] }),
        ]),
      );
    },
  });

  // Sheet luôn gắn sẵn: lỗi của lần tạo trước không được nằm lại khi khách đóng, nạp Ví rồi mở lại.
  // Chỉ xoá khi sheet đang đóng: xoá cả lúc đang mở thì lời lỗi bị xoá ngay khi request thất bại (isPending hết).
  // Đang gửi thì giữ nguyên, nếu không nút mở khoá giữa chừng và khách bấm ra POST thứ hai.
  const resetCreate = create.reset;
  const creating = create.isPending;
  useEffect(() => {
    if (!visible && !creating) {
      resetCreate();
      setCreateError(null);
    }
  }, [visible, creating, resetCreate]);

  const noAddress = addrQ.isSuccess && addresses.length === 0;
  const busy = create.isPending;

  return (
    <Sheet
      open={visible}
      onClose={() => {
        if (!busy) onClose();
      }}
      dismissible={!busy}
      title={`Đặt định kỳ — tiết kiệm ${discountPct}%`}
      numericTitle
      description="Tự động giao lại theo chu kỳ bạn chọn. Tạm dừng, sửa hoặc huỷ bất kỳ lúc nào."
      size="full"
      footer={
        noAddress || addrFailed || addrWaiting ? undefined : (
          <div>
            {createError && (
              <p role="alert" className={`mb-2 ${ui.error}`}>
                {actionErrorText(createError.value)}
              </p>
            )}
            {/* Đang gửi giữ aria-busy/aria-disabled chứ không `disabled` DOM: Chromium thả focus về body khi nút đang giữ focus bị disabled. */}
            <button
              type="button"
              className={`${ui.btnPrimary} w-full`}
              disabled={!addressId || !dateOk || (payment === 'WALLET' && walletBlocked !== null)}
              aria-busy={busy || undefined}
              aria-disabled={busy || undefined}
              onClick={() => {
                if (busy || !addressId || !dateOk) return;
                create.mutate();
              }}
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
          <Chip key={w} selected={weeks === w} disabled={busy} onPress={() => setWeeks(w)}>
            {w} tuần
          </Chip>
        ))}
      </div>

      <SectionLabel>Đơn đầu tiên</SectionLabel>
      <div role="group" aria-label="Đơn đầu tiên" className="flex gap-2 py-1">
        <Chip selected={startMode === 'now'} disabled={busy} onPress={() => setStartMode('now')}>
          Giao ngay
        </Chip>
        <Chip
          selected={startMode === 'date'}
          disabled={busy}
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
              disabled={busy}
              onChange={(e) => setStartDate(e.target.value)}
              className={dateError ? ui.fieldError : ui.field}
            />
          </Field>
          {!dateError && <p className="mt-1 text-xs tabular-nums text-stone-600">Chọn một ngày trong vòng {MAX_START_DAYS_AHEAD} ngày tới.</p>}
        </div>
      )}

      <SectionLabel>Thanh toán mỗi kỳ</SectionLabel>
      <div ref={payGroup.ref} onKeyDown={payGroup.onKeyDown} role="radiogroup" aria-label="Thanh toán mỗi kỳ">
        {SUBSCRIPTION_PAYMENT_METHODS.map((m) => (
          <RadioRow
            key={m}
            checked={payment === m}
            disabled={busy || (m === 'WALLET' && walletBlocked !== null)}
            onSelect={() => setPayment(m)}
            title={m === 'WALLET' && walletQ.data ? `Ví Tubu (${formatVnd(walletQ.data.walletBalance)})` : PAY_LABEL[m]}
            hint={m === 'WALLET' && walletBlocked ? walletBlocked : payment === m ? PAY_HINT[m] : undefined}
          />
        ))}
      </div>

      <SectionLabel>Giao tới</SectionLabel>
      {addrFailed || addrWaiting ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 py-1">
          <p className={`min-w-0 flex-1 ${ui.error}`}>{addrFailed ? loadErrorText(addrQ.error) : addrRetrying}</p>
          <button
            type="button"
            aria-busy={addrWaiting || undefined}
            onClick={() => {
              if (addrWaiting) return;
              setAddrRetrying(loadErrorText(addrQ.error));
              void addrQ.refetch();
            }}
            className={ui.btnSecondary}
          >
            Thử lại
          </button>
        </div>
      ) : addrQ.isLoading ? (
        <LineItemSkeleton />
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
        <div ref={addrGroup.ref} onKeyDown={addrGroup.onKeyDown} role="radiogroup" aria-label="Giao tới">
          {addresses.map((a) => (
            <RadioRow
              key={a.id}
              checked={addressId === a.id}
              disabled={busy}
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
