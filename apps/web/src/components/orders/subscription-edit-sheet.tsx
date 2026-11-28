'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RESCHEDULE_MAX_DAYS_AHEAD, updateSubscription, type SubscriptionDTO, type SubscriptionPatch, type SubscriptionPaymentMethod } from '@tubutree/app-core/api/subscriptions';
import { dayKeyText, isRescheduleDateAllowed, rescheduleOptions, rescheduleRange, selfServeCopy } from '@tubutree/app-core/subscription-self-serve';
import { addressesQuery } from '@tubutree/app-core/queries/checkout';
import { walletQuery } from '@tubutree/app-core/queries/wallet';
import { Chip } from '@/components/catalog/chip';
import { Sheet } from '@/components/ui/sheet';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { QuantitySelector } from '@/components/ui/quantity-selector';
import { LineItemSkeleton } from '@/components/ui/skeleton';
import { coreHttp } from '@/lib/core-http';
import { isStaleSubscriptionError } from '@/lib/subscription-stale-error';
import { errorCode, errorStatus } from '@tubutree/app-core/api/error-status';
import { ui } from '@/lib/guest-ui';
import { formatVnDate, nextRunAfterIntervalChange, SUBSCRIPTION_INTERVAL_WEEKS, vnDateOf } from '@/lib/subscription-options';
import { AddressPicker, PaymentMethodPicker, SectionLabel } from './subscription-options';
import { actionErrorText, loadErrorText } from '@/lib/error-text';
import { joinVariationLine, variationLabel } from '@/lib/variation-label';

/** Trần ở client chỉ để nút + không chạy vô hạn; còn hàng hay không do API kiểm khi sinh đơn kỳ. */
const MAX_QTY = 99;

/** Chỉ gửi trường đã đổi: PATCH trống không làm gì, và đổi địa chỉ là bước API kiểm trùng gói. Ngày giao kỳ tới chỉ gửi khi nằm trong khoảng API nhận. */
export function subscriptionPatch(
  sub: Pick<SubscriptionDTO, 'quantity' | 'addressId' | 'paymentMethod' | 'intervalWeeks'> & { nextRunAt?: string },
  next: { quantity: number; addressId: string | undefined; paymentMethod: SubscriptionPaymentMethod; intervalWeeks: number; nextRunDate?: string | null },
  canEditInterval = true,
  now: Date = new Date(),
) {
  const patch: SubscriptionPatch = {};
  if (next.quantity !== sub.quantity) patch.quantity = next.quantity;
  if (next.addressId && next.addressId !== sub.addressId) patch.addressId = next.addressId;
  if (next.paymentMethod !== (sub.paymentMethod ?? 'COD')) patch.paymentMethod = next.paymentMethod;
  if (canEditInterval && next.intervalWeeks !== sub.intervalWeeks) patch.intervalWeeks = next.intervalWeeks;
  if (canEditInterval && next.nextRunDate && isRescheduleDateAllowed(next.nextRunDate, now)) {
    patch.nextRunDate = next.nextRunDate;
    patch.expectedNextRunAt = sub.nextRunAt;
  }
  return patch;
}

/** Sửa số lượng / chu kỳ / địa chỉ / cách trả của gói đang chạy hoặc tạm dừng. Mount khi mở để state lấy từ gói đang chọn. */
export function SubscriptionEditSheet({
  sub,
  onClose,
  onSaved,
  onRejected,
}: {
  sub: SubscriptionDTO;
  onClose: () => void;
  onSaved: (text: string) => void;
  onRejected?: (text: string) => void;
}) {
  const qc = useQueryClient();
  const [quantity, setQuantity] = useState(sub.quantity);
  const [weeks, setWeeks] = useState(sub.intervalWeeks);
  const [addressId, setAddressId] = useState(sub.addressId);
  const [payment, setPayment] = useState<SubscriptionPaymentMethod>(sub.paymentMethod ?? 'COD');
  // Ngày giao kỳ tới khách chọn ('yyyy-mm-dd' giờ VN), null = giữ lịch. `picking`: đang mở ô chọn ngày.
  const [runDate, setRunDate] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // "Lần kế" lúc mở sheet: +7/+14 và ngày gửi kèm (`expectedNextRunAt`) tính từ đây. `sub` là gói SỐNG của danh sách: tải lại nền qua 03:00
  // (cron vừa ra đơn kỳ đó) mà lấy ngày mới thì máy chủ nhận ngày khách chọn theo lịch cũ thành ngày giao kỳ SAU, thêm một đơn.
  const [shownRunAt] = useState(sub.nextRunAt);
  const addrQ = useQuery(addressesQuery(coreHttp));
  const walletQ = useQuery(walletQuery(coreHttp));
  // Truy vấn lỗi mà chưa có dữ liệu bị react-query đặt về pending lúc tải lại và xoá lỗi; giữ vùng lỗi + nút Thử lại đứng yên
  // (không mất focus) tới khi lượt tải lại có kết quả (isPending hết). Giá trị là câu lỗi cũ để vẫn hiện chữ trong lúc chờ.
  const [addrRetrying, setAddrRetrying] = useState<string | null>(null);
  const addrFailed = addrQ.isError && !addrQ.data;
  const addrWaiting = addrRetrying !== null && addrQ.isPending;

  // API cũ chưa nhận intervalWeeks (400); chỉ API mới mới trả khoá lastOrderAt (kể cả null), dùng làm dấu hiệu hỗ trợ.
  const canEditInterval = 'lastOrderAt' in sub;
  const shownSub = { ...sub, nextRunAt: shownRunAt };
  const patch = subscriptionPatch(shownSub, { quantity, addressId, paymentMethod: payment, intervalWeeks: weeks, nextRunDate: runDate }, canEditInterval);
  const nextRun = canEditInterval ? nextRunAfterIntervalChange(shownSub, weeks) : null;
  const dirty = Object.keys(patch).length > 0;
  // +7/+14 ngày tính từ ngày giao kỳ tới đang thấy (kể cả ngày mới do đổi chu kỳ); ngày chọn thắng ngày do đổi chu kỳ ở máy chủ.
  const steps = canEditInterval && sub.status !== 'CANCELLED' ? rescheduleOptions(nextRun ? nextRun.toISOString() : shownRunAt) : [];
  const range = rescheduleRange();

  const save = useLockedMutation({
    mutationFn: () => updateSubscription(coreHttp, sub.id, patch),
    onSuccess: () => {
      onSaved('Đã cập nhật gói định kỳ');
      void qc.invalidateQueries({ queryKey: ['subscriptions'] });
      onClose();
    },
    // Gói đã huỷ ở máy khác (sheet tự đóng khi gói rời danh sách) hoặc đã có gói trùng: danh sách đang cũ. Không giữ nút Lưu chờ nó
    // để lời lỗi và nút bấm lại hiện ngay.
    onError: (e) => {
      if (!isStaleSubscriptionError(e)) return;
      void qc.invalidateQueries({ queryKey: ['subscriptions'] });
      // Dời ngày bị 409 không mã (lịch vừa đổi, như Mini): "Lần kế" của sheet đã cũ nên lưu lại vẫn 409. Đóng để khách mở lại với lịch mới.
      // 409 trùng gói (SUBSCRIPTION_DUPLICATE) là lỗi ở ô địa chỉ, giữ sheet để đổi. `onClose` xoá lời lỗi của trang nên gọi trước `onRejected`.
      if (patch.expectedNextRunAt !== undefined && errorStatus(e) === 409 && errorCode(e) !== 'SUBSCRIPTION_DUPLICATE') onClose();
      // Gói rời danh sách thì sheet tự đóng và lời lỗi trong footer biến mất cùng nó: báo lên trang để khách còn thấy lý do.
      onRejected?.(actionErrorText(e));
    },
  });

  return (
    <Sheet
      open
      onClose={() => {
        if (!save.isPending) onClose();
      }}
      dismissible={!save.isPending}
      title="Sửa gói định kỳ"
      description={joinVariationLine(sub.productName, variationLabel(sub.variationName))}
      size="full"
      footer={
        <div className="flex flex-col gap-2">
          {save.isError && (
            <p role="alert" className={ui.error}>
              {actionErrorText(save.error)}
            </p>
          )}
          {/* Đang lưu giữ aria-busy/aria-disabled chứ không `disabled`: nút đang giữ focus mà `disabled` thì Chromium thả focus về body; khoá chạm đúp là của useLockedMutation. */}
          <button
            type="button"
            disabled={!dirty}
            aria-busy={save.isPending || undefined}
            aria-disabled={save.isPending || undefined}
            onClick={() => save.mutate()}
            className={`${ui.btnPrimary} w-full`}
          >
            {save.isPending ? 'Đang lưu…' : 'Lưu thay đổi'}
          </button>
        </div>
      }
    >
      <SectionLabel>Số lượng mỗi kỳ</SectionLabel>
      <div className="py-1">
        <QuantitySelector value={quantity} min={1} max={MAX_QTY} disabled={save.isPending} onChange={setQuantity} />
      </div>

      {canEditInterval && (
        <>
        <SectionLabel>Chu kỳ giao</SectionLabel>
        <div role="group" aria-label="Chu kỳ giao" className="flex flex-wrap gap-2 py-1">
          {SUBSCRIPTION_INTERVAL_WEEKS.map((w) => (
            <Chip
              key={w}
              selected={weeks === w}
              disabled={save.isPending}
              onPress={() => {
                setWeeks(w);
                // +7/+14 tính từ ngày của chu kỳ đang chọn: đổi chu kỳ thì bỏ bước đã chọn kẻo PATCH gửi ngày cũ đè ngày mới. Ngày tự chọn giữ nguyên.
                if (!picking) setRunDate(null);
              }}
            >
              {w} tuần
            </Chip>
          ))}
        </div>
        {nextRun && !patch.nextRunDate && <p className="text-xs tabular-nums text-stone-600">Lần giao kế tiếp: {formatVnDate(vnDateOf(nextRun))}</p>}
        {sub.status === 'PAUSED' && weeks !== sub.intervalWeeks && (
          <p className="text-xs text-stone-600">Đang tạm dừng: nếu ngày này đã qua khi bật lại, kỳ giao tính từ ngày bật lại.</p>
        )}
        </>
      )}

      {steps.length > 0 && (
        <>
          <SectionLabel>{selfServeCopy('rescheduleLabel')}</SectionLabel>
          <div role="group" aria-label={selfServeCopy('rescheduleLabel')} className="flex flex-wrap gap-2 py-1" data-testid="subscription-reschedule">
            {steps.map((o) => (
              <Chip
                key={o.days}
                selected={!picking && runDate === o.date}
                disabled={save.isPending || !o.allowed}
                onPress={() => {
                  setPicking(false);
                  setRunDate(!picking && runDate === o.date ? null : o.date);
                }}
              >
                {selfServeCopy('plusDays', { n: o.days })}
              </Chip>
            ))}
            <Chip
              selected={picking}
              disabled={save.isPending}
              onPress={() => {
                setPicking(!picking);
                setRunDate(null);
              }}
            >
              {selfServeCopy('pickDate')}
            </Chip>
          </div>
          {/* Tiêu đề mục ngay trên đã là nhãn nhìn thấy: ô chỉ cần tên cho trình đọc màn hình, không lặp nhãn thứ hai. */}
          {picking && (
            <input
              type="date"
              aria-label={selfServeCopy('rescheduleLabel')}
              value={runDate ?? ''}
              min={range.min}
              max={range.max}
              disabled={save.isPending}
              onChange={(e) => setRunDate(e.target.value || null)}
              className={ui.field}
            />
          )}
          {/* Ô ngày giới hạn min/max; ngày ngoài khoảng không vào PATCH nên câu gợi ý ở lại tới khi chọn được ngày hợp lệ. */}
          {(patch.nextRunDate || picking) && (
            <p className="text-xs tabular-nums text-stone-600">
              {patch.nextRunDate ? selfServeCopy('rescheduleNext', { date: dayKeyText(patch.nextRunDate) }) : selfServeCopy('rescheduleHint', { max: RESCHEDULE_MAX_DAYS_AHEAD })}
            </p>
          )}
        </>
      )}

      <SectionLabel>Thanh toán mỗi kỳ</SectionLabel>
      <PaymentMethodPicker value={payment} onChange={setPayment} walletBalance={walletQ.data?.walletBalance} disabled={save.isPending} />

      <SectionLabel>Giao tới</SectionLabel>
      {addrFailed || addrWaiting ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 py-1">
          <p className={`min-w-0 flex-1 ${ui.error}`}>{addrFailed ? loadErrorText(addrQ.error) : addrRetrying}</p>
          <button
            type="button"
            aria-busy={addrWaiting || undefined}
            onClick={() => {
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
      ) : (
        <AddressPicker addresses={addrQ.data ?? []} value={addressId} onChange={setAddressId} disabled={save.isPending} />
      )}
    </Sheet>
  );
}
