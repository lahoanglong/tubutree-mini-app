import { useState } from 'react';
import { Box, Sheet, Text, Input, Button, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ticket, Check, X } from 'lucide-react';
import { getCoupons, type CouponDTO } from '../../services/account-api';
import { applyCoupon, removeCoupon } from '../../services/shop-api';
import { getErrorMessage } from '../../services/api';
import { formatVnd } from '../../utils/format';
import { haptic } from '../../utils/haptic';

export interface VoucherSheetProps {
  visible: boolean;
  onClose: () => void;
  currentCode?: string | null;
  subtotal: number;
  onCouponApplied?: () => void;
}

export function VoucherSheet({
  visible,
  onClose,
  currentCode,
  subtotal,
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
    <Sheet visible={visible} onClose={onClose} autoHeight mask style={{ zIndex: 1000 }}>
      <Box p={4} style={{ paddingBottom: 'calc(20px + var(--safe-bottom))', maxHeight: '80vh', overflowY: 'auto' }}>
        {/* Header */}
        <Box flex alignItems="center" justifyContent="space-between" mb={3}>
          <Box>
            <Text bold size="normal" style={{ color: 'var(--neutral-900)' }}>
              Chọn mã giảm giá
            </Text>
            <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 2 }}>
              Mỗi đơn hàng chỉ áp dụng 1 mã ưu đãi
            </Text>
          </Box>
          <button
            type="button"
            aria-label="Đóng"
            className="tubu-press"
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: 'none',
              background: 'var(--neutral-100)',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
            }}
          >
            <X size={18} color="var(--neutral-600)" />
          </button>
        </Box>

        {/* Section 1: Nhập mã thủ công (Phía trên) */}
        <Box
          p={3}
          style={{
            background: 'var(--neutral-50)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--neutral-200)',
            marginBottom: 16,
          }}
        >
          <Text size="xSmall" bold style={{ color: 'var(--neutral-600)', marginBottom: 8, display: 'block' }}>
            Nhập mã ưu đãi khác
          </Text>
          <Box flex style={{ gap: 8 }}>
            <Box style={{ flex: 1 }}>
              <Input
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
            </Box>
            <Button
              size="small"
              disabled={!customCode.trim() || isAnyMutating}
              loading={applyMut.isPending}
              onClick={handleApplyCustom}
              style={{
                background: customCode.trim() && !isAnyMutating ? 'var(--primary-600)' : undefined,
                minHeight: 44,
                fontWeight: 600,
              }}
            >
              Áp dụng
            </Button>
          </Box>
        </Box>

        {/* Section 2: Mã giảm giá có sẵn (Phía dưới) */}
        <Box>
          <Text size="xSmall" bold style={{ color: 'var(--neutral-600)', marginBottom: 10, display: 'block' }}>
            Mã ưu đãi của bạn
          </Text>

          {couponsQ.isLoading ? (
            <Text size="small" style={{ color: 'var(--neutral-400)', textAlign: 'center', padding: '16px 0' }}>
              Đang tải danh sách mã...
            </Text>
          ) : couponsQ.isError ? (
            <Box style={{ textAlign: 'center', padding: '20px 16px', background: 'var(--neutral-50)', borderRadius: 'var(--radius-lg)' }}>
              <Text size="small" style={{ color: 'var(--danger)', marginBottom: 8, display: 'block' }}>
                ⚠ Không thể tải danh sách mã giảm giá: {getErrorMessage(couponsQ.error)}
              </Text>
              <Button size="small" variant="secondary" onClick={() => void couponsQ.refetch()}>
                Thử lại
              </Button>
            </Box>
          ) : couponsQ.data && couponsQ.data.length > 0 ? (
            <Box flex flexDirection="column" style={{ gap: 10 }}>
              {couponsQ.data.map((coupon) => {
                const isApplied = currentCode?.toUpperCase() === coupon.code.toUpperCase();
                const notEligible = coupon.minOrder != null && subtotal < coupon.minOrder;
                const endAtDate = coupon.endAt ? new Date(coupon.endAt) : null;
                const endAtText = endAtDate && !isNaN(endAtDate.getTime()) ? endAtDate.toLocaleDateString('vi-VN') : 'Không thời hạn';

                return (
                  <Box
                    key={coupon.code}
                    p={3}
                    flex
                    alignItems="center"
                    style={{
                      gap: 12,
                      background: isApplied ? 'var(--clay-50)' : 'var(--neutral-0)',
                      border: `1px ${isApplied ? 'solid' : 'dashed'} ${isApplied ? 'var(--clay-500)' : 'var(--neutral-300)'}`,
                      borderRadius: 'var(--radius-lg)',
                      opacity: notEligible ? 0.55 : 1,
                    }}
                  >
                    <Box
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--clay-50)',
                        display: 'grid',
                        placeItems: 'center',
                        flex: '0 0 auto',
                      }}
                    >
                      <Ticket size={22} color="var(--clay-700)" />
                    </Box>

                    <Box style={{ flex: 1, minWidth: 0 }}>
                      <Box flex alignItems="center" style={{ gap: 6 }}>
                        <Text size="small" bold style={{ color: 'var(--neutral-900)' }}>
                          {coupon.code}
                        </Text>
                        {isApplied && (
                          <span
                            style={{
                              background: 'var(--clay-500)',
                              color: '#fff',
                              borderRadius: 'var(--radius-full)',
                              padding: '1px 6px',
                              fontSize: 10,
                              fontWeight: 700,
                            }}
                          >
                            Đang dùng
                          </span>
                        )}
                      </Box>
                      <Text size="xSmall" style={{ color: 'var(--neutral-700)', marginTop: 2 }}>
                        {formatCouponDesc(coupon)}
                      </Text>
                      {coupon.minOrder != null && (
                        <Text size="xSmall" style={{ color: notEligible ? 'var(--warning)' : 'var(--neutral-400)', marginTop: 2 }}>
                          {notEligible
                            ? `⚠ Cần đơn tối thiểu ${formatVnd(coupon.minOrder)}`
                            : `Đơn tối thiểu ${formatVnd(coupon.minOrder)}`}
                        </Text>
                      )}
                      <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 2 }}>
                        HSD: {endAtText}
                      </Text>
                    </Box>

                    <Box style={{ flex: '0 0 auto' }}>
                      {isApplied ? (
                        <Button
                          size="small"
                          variant="secondary"
                          disabled={isAnyMutating}
                          loading={removeMut.isPending}
                          onClick={() => removeMut.mutate()}
                          style={{ minHeight: 36, fontSize: 12, borderColor: 'var(--neutral-300)' }}
                        >
                          Bỏ dùng
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          disabled={notEligible || isAnyMutating}
                          loading={applyMut.isPending && applyMut.variables === coupon.code}
                          onClick={() => applyMut.mutate(coupon.code)}
                          style={{
                            background: notEligible || isAnyMutating ? undefined : 'var(--primary-600)',
                            minHeight: 36,
                            fontSize: 12,
                            fontWeight: 600,
                          }}
                        >
                          {notEligible ? 'Chưa đủ' : 'Dùng mã'}
                        </Button>
                      )}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          ) : (
            <Box style={{ textAlign: 'center', padding: '24px 16px', background: 'var(--neutral-50)', borderRadius: 'var(--radius-lg)' }}>
              <Ticket size={32} color="var(--neutral-400)" style={{ margin: '0 auto 8px' }} />
              <Text size="small" style={{ color: 'var(--neutral-600)' }}>
                Bạn chưa có mã giảm giá trong ví
              </Text>
              <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 4 }}>
                Nhập mã ưu đãi thủ công ở phía trên để áp dụng.
              </Text>
            </Box>
          )}
        </Box>
      </Box>
    </Sheet>
  );
}
