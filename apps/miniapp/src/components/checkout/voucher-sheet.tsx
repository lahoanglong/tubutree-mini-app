import { useState } from 'react';
import { Input } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pickerRows } from '@tubutree/app-core/commerce/voucher-picker';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { couponNotAppliedNotice } from '@tubutree/app-core/commerce/coupon-notice';
import { getCoupons } from '../../services/account-api';
import type { CouponPreviewRequest } from '@tubutree/shared-types';
import { applyCoupon, getCouponPreviews, removeCoupon } from '../../services/shop-api';
import { getErrorMessage, getLoadErrorMessage } from '../../services/api';
import { useNotify } from '../../hooks/use-notify';
import { haptic } from '../../utils/haptic';
import { serverNow } from '../../utils/server-clock';
import { PREVIEW_DEBOUNCE_MS, useDebounced } from '../../utils/use-debounced';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { EmptyState, ErrorState } from '../ui/empty-state';
import { Skeleton } from '../ui/skeleton';
import { Text } from '../ui/text';
import { VoucherPicker } from '../ui/voucher-picker';
import { autoCouponName } from '../../utils/coupon-name';
import { cartKey } from '../../services/cart-key';
import { INPUT_LIMITS } from '../../utils/input-limits';

export interface VoucherSheetProps {
  visible: boolean;
  onClose: () => void;
  currentCode?: string | null;
  subtotal: number;
  /** Phí ship hiện tại của đơn (chỉ thanh toán biết); bằng 0 thì mã freeship bị làm mờ vì không giảm thêm được gì. */
  shippingFee?: number;
  /** Sản phẩm của các dòng đang mua — mã chỉ áp cho sản phẩm khác thì báo "Chỉ áp cho ..." và khoá nút dùng. */
  productIds?: string[];
  /**
   * Tham số báo giá của lần đặt đang xem (thanh toán: có addressId; giỏ: không). Có thì hỏi máy chủ mức giảm thật từng mã
   * (`/checkout/coupon-previews`); không có, đang tải hoặc lỗi (API cũ) thì thẻ chỉ ghi điều kiện của mã như trước.
   */
  previewParams?: CouponPreviewRequest;
  /**
   * Dấu vân tay các dòng đang tính (id, số lượng, thành tiền): đổi là số xem trước cũ hết đúng (`itemIds` không đổi khi đổi số
   * lượng hay khi chọn cả giỏ) nên phải hỏi lại.
   */
  previewKey?: string;
  onCouponApplied?: () => void;
  /** Trang chứa đang tự áp hoặc gỡ mã: khoá mọi nút chọn mã để hai lần đổi mã không chồng nhau. */
  busy?: boolean;
}

export function VoucherSheet({
  visible,
  onClose,
  currentCode,
  subtotal,
  shippingFee,
  productIds,
  previewParams,
  previewKey,
  onCouponApplied,
  busy = false,
}: VoucherSheetProps) {
  const queryClient = useQueryClient();
  const { notify } = useNotify();
  const [customCode, setCustomCode] = useState('');

  const couponsQ = useQuery({
    queryKey: ['coupons'],
    queryFn: getCoupons,
    enabled: visible,
  });
  const previewSig = previewParams ? JSON.stringify([previewParams, previewKey ?? '']) : null;
  const settledSig = useDebounced(previewSig, PREVIEW_DEBOUNCE_MS);
  const previewsQ = useQuery({
    queryKey: ['coupon-previews', settledSig],
    queryFn: () => getCouponPreviews((JSON.parse(settledSig!) as [CouponPreviewRequest, string])[0]),
    enabled: visible && !!settledSig,
    retry: false,
  });
  // Số chỉ đúng cho đúng giỏ đã hỏi: giỏ vừa đổi (chưa hỏi lại) hoặc đang tải lại thì quay về phép đoán phía máy, không hiện số cũ.
  const previewTrusted = !!previewSig && settledSig === previewSig && previewsQ.isSuccess && !previewsQ.isFetching;
  const previews = new Map((previewTrusted ? (previewsQ.data ?? []) : []).map((p) => [p.code.toUpperCase(), p]));

  const applyMut = useMutation({
    mutationFn: (code: string) => applyCoupon(code.trim().toUpperCase()),
    onSuccess: (cart, code) => {
      queryClient.setQueryData(cartKey(), cart);
      void queryClient.invalidateQueries({ queryKey: ['quote'] });
      haptic('medium');
      setCustomCode('');
      // Mã được giữ nhưng chưa giảm cho giỏ này (vd combo kéo phần hàng dưới đơn tối thiểu): nói lý do, không báo "đã áp dụng".
      // Lời báo là của CẢ giỏ: nếu xem trước cho phần đang chọn (mua một phần) nói mã dùng được thì mã được áp cho đơn này.
      const preview = previews.get(code.trim().toUpperCase());
      const eligibleHere = preview?.eligible === true;
      const heldOnly = !!cart.couponNotice && cart.discount === 0 && !cart.freeship && !eligibleHere;
      // Mã freeship giỏ coi là hợp lệ (freeship: true) nhưng xem trước của máy chủ nói không miễn được gì (đơn đầu đã miễn phí giao):
      // nói đúng câu thanh toán sẽ nói, không báo "đã áp dụng" rồi thanh toán báo ngược lại.
      const previewBlocked = preview && !preview.eligible && preview.reason && cart.discount === 0 ? preview.reason : null;
      notify(
        heldOnly
          ? { text: cart.couponNotice!, type: 'warning', duration: 5000 }
          : previewBlocked
            ? { text: couponNotAppliedNotice(previewBlocked), type: 'warning', duration: 5000 }
            : { text: `Đã áp dụng mã ${cart.couponCode ?? ''}`, type: 'success', duration: 2000 },
      );
      onCouponApplied?.();
      onClose();
    },
    onError: (e: unknown) => notify({ text: getErrorMessage(e), type: 'error' }),
  });

  const removeMut = useMutation({
    mutationFn: removeCoupon,
    onSuccess: (cart) => {
      queryClient.setQueryData(cartKey(), cart);
      void queryClient.invalidateQueries({ queryKey: ['quote'] });
      haptic('light');
      notify({ text: 'Đã bỏ mã giảm giá', type: 'success', duration: 2000 });
      onCouponApplied?.();
    },
    onError: (e: unknown) => notify({ text: getErrorMessage(e), type: 'error' }),
  });

  const isAnyMutating = applyMut.isPending || removeMut.isPending || busy;
  // Spinner của "Áp dụng" chỉ quay khi chính mã tay đang được áp; mã bấm từ danh sách thì khoá nút này.
  const applyingCustom = applyMut.isPending && applyMut.variables === customCode.trim().toUpperCase();

  const rows = pickerRows(couponsQ.data ?? [], { currentCode, subtotal, shippingFee, productIds, previews, now: serverNow(), displayCode: autoCouponName });
  // Nút đang quay: mã đang áp (mã tay thì không có hàng nào khớp), hoặc mã đang gỡ là hàng đang dùng.
  const pendingCode = applyMut.isPending ? (applyMut.variables ?? null) : removeMut.isPending ? (rows.find((r) => r.applied)?.coupon.code ?? null) : null;

  const handleApplyCustom = () => {
    const trimmed = customCode.trim().toUpperCase();
    if (trimmed && !isAnyMutating) {
      applyMut.mutate(trimmed);
    }
  };

  return (
    <BottomSheet
      open={visible}
      onClose={onClose}
      title={fillCopy('coupon.pickTitle')}
      description={fillCopy('coupon.oneCodeHint')}
    >
      <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
        {/* Section 1: Nhập mã thủ công (Phía trên) */}
        <div
          style={{
            padding: 12,
            background: 'var(--color-bg-canvas)',
            borderRadius: 'var(--radius-card)',
            border: '1px solid var(--color-border-subtle)',
            marginBottom: 16,
          }}
        >
          <Text variant="label" tone="secondary" as="p" style={{ marginBottom: 8 }}>
            {fillCopy('coupon.pickManual')}
          </Text>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="tubu-field-44" style={{ flex: 1 }}>
              <Input maxLength={INPUT_LIMITS.voucherCode}
                aria-label={fillCopy('coupon.pickManual')}
                placeholder={fillCopy('coupon.pickPlaceholder')}
                value={customCode}
                onChange={(e) => setCustomCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleApplyCustom();
                  }
                }}
              />
            </div>
            <Button
              className="tubu-btn-44"
              disabled={!customCode.trim() || busy || removeMut.isPending || (applyMut.isPending && !applyingCustom)}
              loading={applyingCustom}
              onPress={handleApplyCustom}
            >
              {fillCopy('coupon.pickApply')}
            </Button>
          </div>
        </div>

        {/* Section 2: Mã giảm giá có sẵn (Phía dưới) */}
        <div>
          <Text variant="label" tone="secondary" as="p" style={{ marginBottom: 10 }}>
            {fillCopy('coupon.pickMine')}
          </Text>

          {couponsQ.isLoading ? (
            <div role="status" aria-label={fillCopy('coupon.pickLoading')} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Skeleton height={72} radius="var(--radius-card)" />
              <Skeleton height={72} radius="var(--radius-card)" />
            </div>
          ) : couponsQ.isError ? (
            <ErrorState
              variant="inline"
              message={fillCopy('coupon.pickLoadError', { reason: getLoadErrorMessage(couponsQ.error) })}
              onRetry={() => void couponsQ.refetch()}
            />
          ) : couponsQ.data && couponsQ.data.length > 0 ? (
            <VoucherPicker rows={rows} onUse={(code) => applyMut.mutate(code)} onRemove={() => removeMut.mutate()} busy={isAnyMutating} pendingCode={pendingCode} />
          ) : (
            <EmptyState
              variant="inline"
              art="leaf"
              heading={fillCopy('coupon.pickEmptyTitle')}
              body={fillCopy('coupon.pickEmptyBody')}
            />
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
