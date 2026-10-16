import { useState } from 'react';
import { Input, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ticket, TriangleAlert } from 'lucide-react';
import { getCoupons, type CouponDTO } from '../../services/account-api';
import type { CouponPreviewRequest } from '@tubutree/shared-types';
import { applyCoupon, getCouponPreviews, removeCoupon } from '../../services/shop-api';
import { getErrorMessage } from '../../services/api';
import { formatDate, formatVnd } from '../../utils/format';
import { haptic } from '../../utils/haptic';
import { Badge } from '../ui/badge';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { EmptyState, ErrorState } from '../ui/empty-state';
import { Skeleton } from '../ui/skeleton';
import { Text } from '../ui/text';
import { autoCouponName } from '../../utils/coupon-name';

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
  onCouponApplied?: () => void;
}

export function VoucherSheet({
  visible,
  onClose,
  currentCode,
  subtotal,
  shippingFee,
  productIds,
  previewParams,
  onCouponApplied,
}: VoucherSheetProps) {
  const queryClient = useQueryClient();
  const { openSnackbar } = useSnackbar();
  const [customCode, setCustomCode] = useState('');

  const couponsQ = useQuery({
    queryKey: ['coupons'],
    queryFn: getCoupons,
    enabled: visible,
  });
  const previewsQ = useQuery({
    queryKey: ['coupon-previews', previewParams ?? null],
    queryFn: () => getCouponPreviews(previewParams!),
    enabled: visible && !!previewParams,
    retry: false,
  });
  const previews = new Map((previewsQ.data ?? []).map((p) => [p.code.toUpperCase(), p]));

  const applyMut = useMutation({
    mutationFn: (code: string) => applyCoupon(code.trim().toUpperCase()),
    onSuccess: (cart) => {
      queryClient.setQueryData(['cart'], cart);
      void queryClient.invalidateQueries({ queryKey: ['quote'] });
      haptic('medium');
      setCustomCode('');
      openSnackbar({ text: `Đã áp dụng mã ${cart.couponCode ?? ''}`, type: 'success', duration: 2000 });
      onCouponApplied?.();
      onClose();
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const removeMut = useMutation({
    mutationFn: removeCoupon,
    onSuccess: (cart) => {
      queryClient.setQueryData(['cart'], cart);
      void queryClient.invalidateQueries({ queryKey: ['quote'] });
      haptic('light');
      openSnackbar({ text: 'Đã bỏ mã giảm giá', type: 'success', duration: 2000 });
      onCouponApplied?.();
    },
    onError: (e: unknown) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const isAnyMutating = applyMut.isPending || removeMut.isPending;
  // Spinner của "Áp dụng" chỉ quay khi chính mã tay đang được áp; mã bấm từ danh sách thì khoá nút này.
  const applyingCustom = applyMut.isPending && applyMut.variables === customCode.trim().toUpperCase();

  const formatCouponDesc = (coupon: CouponDTO) => {
    if (coupon.type === 'PERCENT') {
      const maxText = coupon.maxDiscount ? ` (tối đa ${formatVnd(coupon.maxDiscount)})` : '';
      return `Giảm ${coupon.value}%${maxText}`;
    }
    if (coupon.type === 'FREESHIP') {
      const maxText = coupon.value > 0 ? ` (tối đa ${formatVnd(coupon.value)})` : '';
      return `Miễn phí ship${maxText}`;
    }
    return `Giảm ${formatVnd(coupon.value)}`;
  };

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
      title="Chọn mã giảm giá"
      description="Mỗi đơn hàng chỉ áp dụng 1 mã giảm giá"
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
          <Text variant="label" tone="secondary" as="h3" style={{ marginBottom: 8 }}>
            Nhập mã giảm giá khác
          </Text>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <Input
                aria-label="Nhập mã giảm giá khác"
                placeholder="Ví dụ: WELCOME, TUBUSALE..."
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
              disabled={!customCode.trim() || removeMut.isPending || (applyMut.isPending && !applyingCustom)}
              loading={applyingCustom}
              onPress={handleApplyCustom}
            >
              Áp dụng
            </Button>
          </div>
        </div>

        {/* Section 2: Mã giảm giá có sẵn (Phía dưới) */}
        <div>
          <Text variant="label" tone="secondary" as="h3" style={{ marginBottom: 10 }}>
            Mã giảm giá của bạn
          </Text>

          {couponsQ.isLoading ? (
            <div role="status" aria-label="Đang tải danh sách mã" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Skeleton height={72} radius="var(--radius-card)" />
              <Skeleton height={72} radius="var(--radius-card)" />
            </div>
          ) : couponsQ.isError ? (
            <ErrorState
              variant="inline"
              message={`Không thể tải danh sách mã giảm giá: ${getErrorMessage(couponsQ.error)}`}
              onRetry={() => void couponsQ.refetch()}
            />
          ) : couponsQ.data && couponsQ.data.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {couponsQ.data.map((coupon) => {
                const isApplied = currentCode?.toUpperCase() === coupon.code.toUpperCase();
                const scope = coupon.products?.length ? coupon.products : null;
                const preview = previews.get(coupon.code.toUpperCase());
                // Có số của máy chủ thì theo số đó; các phép đoán dưới đây chỉ dùng khi chưa có (API cũ, đang tải, lỗi).
                const wrongProducts = !preview && !!scope && !!productIds && !scope.some((x) => productIds.includes(x.id));
                const belowMin = !preview && coupon.minOrder != null && subtotal < coupon.minOrder;
                const shipAlreadyFree = !preview && coupon.type === 'FREESHIP' && shippingFee === 0 && !isApplied;
                const serverBlocked = !!preview && !preview.eligible && !isApplied;
                const notEligible = wrongProducts || belowMin || shipAlreadyFree || serverBlocked;
                const savingText = !preview
                  ? null
                  : preview.discount > 0
                    ? `Giảm ${formatVnd(preview.discount)} cho đơn này`
                    : (preview.freeshipSaving ?? 0) > 0
                      ? `Miễn phí ship ${formatVnd(preview.freeshipSaving)} cho đơn này`
                      : null;
                const endAtDate = coupon.endAt ? new Date(coupon.endAt) : null;
                const endAtText = endAtDate && !isNaN(endAtDate.getTime()) ? formatDate(endAtDate) : 'Không thời hạn';
                const applyingThis = applyMut.isPending && applyMut.variables === coupon.code;

                return (
                  <div
                    key={coupon.code}
                    style={{
                      padding: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      background: isApplied ? 'var(--color-promo-bg)' : 'var(--color-bg-surface)',
                      border: `1px ${isApplied ? 'solid' : 'dashed'} ${isApplied ? 'var(--color-promo-solid-bg)' : 'var(--color-border-default)'}`,
                      borderRadius: 'var(--radius-card)',
                      opacity: notEligible ? 0.55 : 1,
                    }}
                  >
                    <div
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 'var(--radius-control)',
                        background: 'var(--color-promo-bg)',
                        display: 'grid',
                        placeItems: 'center',
                        flex: '0 0 auto',
                      }}
                    >
                      <Ticket size={22} color="var(--color-promo-fg)" aria-hidden />
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Text variant="body-sm" style={{ fontWeight: 600 }}>
                          {autoCouponName(coupon.code) ?? coupon.code}
                        </Text>
                        {isApplied && (
                          <Badge size="sm" style={{ background: 'var(--color-promo-solid-bg)', color: 'var(--color-promo-solid-fg)' }}>
                            Đang dùng
                          </Badge>
                        )}
                      </div>
                      <Text variant="caption" tone="secondary" as="div" style={{ marginTop: 2 }}>
                        {formatCouponDesc(coupon)}
                      </Text>
                      {savingText && (
                        <Text variant="caption" tone="success" as="div" style={{ marginTop: 2, fontWeight: 600 }}>
                          {savingText}
                        </Text>
                      )}
                      {serverBlocked && preview?.reason && (
                        <Text variant="caption" tone="warning" as="div" style={{ marginTop: 2 }}>
                          <TriangleAlert size={12} aria-hidden style={{ verticalAlign: -2, marginRight: 4 }} />
                          {preview.reason}
                        </Text>
                      )}
                      {shipAlreadyFree && (
                        <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 2 }}>
                          Đơn này đã miễn phí ship
                        </Text>
                      )}
                      {scope && (
                        <Text variant="caption" tone={wrongProducts ? 'warning' : 'tertiary'} as="div" style={{ marginTop: 2 }}>
                          {wrongProducts && <TriangleAlert size={12} aria-hidden style={{ verticalAlign: -2, marginRight: 4 }} />}
                          {`Chỉ áp cho ${scope.map((x) => x.name).join(', ')}`}
                        </Text>
                      )}
                      {coupon.minOrder != null && (
                        <Text variant="caption" tone={belowMin ? 'warning' : 'tertiary'} as="div" style={{ marginTop: 2 }}>
                          {belowMin && <TriangleAlert size={12} aria-hidden style={{ verticalAlign: -2, marginRight: 4 }} />}
                          {belowMin
                            ? `Cần đơn tối thiểu ${formatVnd(coupon.minOrder)}`
                            : `Đơn tối thiểu ${formatVnd(coupon.minOrder)}`}
                        </Text>
                      )}
                      <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 2 }}>
                        HSD: {endAtText}
                      </Text>
                    </div>

                    <div style={{ flex: '0 0 auto' }}>
                      {isApplied ? (
                        <Button
                          variant="secondary"
                          disabled={applyMut.isPending}
                          loading={removeMut.isPending}
                          onPress={() => removeMut.mutate()}
                          style={{ minWidth: 0 }}
                        >
                          Bỏ dùng
                        </Button>
                      ) : (
                        <Button
                          disabled={notEligible || removeMut.isPending || (applyMut.isPending && !applyingThis)}
                          loading={applyingThis}
                          onPress={() => applyMut.mutate(coupon.code)}
                          style={{ minWidth: 0 }}
                        >
                          {wrongProducts || serverBlocked ? 'Không áp dụng' : belowMin ? 'Chưa đủ' : shipAlreadyFree ? 'Không cần dùng' : 'Dùng mã'}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              variant="inline"
              art="leaf"
              heading="Bạn chưa có mã giảm giá trong ví"
              body="Nhập mã giảm giá thủ công ở phía trên để áp dụng."
            />
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
