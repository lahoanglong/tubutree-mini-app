import { useState } from 'react';
import { Box, Text, Button, Sheet, useSnackbar, useNavigate } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAddresses } from '../services/shop-api';
import { createSubscription } from '../services/subscriptions-api';
import { getErrorMessage } from '../services/api';
import { haptic } from '../utils/haptic';

const INTERVALS = [4, 6, 8, 10];

export function SubscribeSheet({
  visible,
  onClose,
  variationId,
  quantity,
}: {
  visible: boolean;
  onClose: () => void;
  variationId: string;
  quantity: number;
}) {
  const { openSnackbar } = useSnackbar();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [weeks, setWeeks] = useState(4);
  const addrQ = useQuery({ queryKey: ['addresses'], queryFn: getAddresses, enabled: visible });
  const defaultAddr = addrQ.data?.find((a) => a.isDefault) ?? addrQ.data?.[0];

  const create = useMutation({
    mutationFn: () =>
      createSubscription({ variationId, quantity, intervalWeeks: weeks, addressId: defaultAddr!.id }),
    onSuccess: () => {
      haptic('medium');
      openSnackbar({ text: 'Đã tạo lịch đặt định kỳ! Tiết kiệm 12% mỗi đơn 🌿', type: 'success' });
      void qc.invalidateQueries({ queryKey: ['subscriptions'] });
      onClose();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <Sheet visible={visible} onClose={onClose} autoHeight>
      <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
        <Text bold size="large">
          Đặt định kỳ — tiết kiệm 12%
        </Text>
        <Text size="small" style={{ color: 'var(--neutral-600)', marginTop: 4 }}>
          Tự động giao lại theo chu kỳ bạn chọn. Tạm dừng/hủy bất kỳ lúc nào.
        </Text>

        <Text size="small" bold style={{ marginTop: 16, marginBottom: 8 }}>
          Chu kỳ giao
        </Text>
        <Box flex style={{ gap: 8 }}>
          {INTERVALS.map((w) => (
            <Box
              key={w}
              className="tubu-press"
              onClick={() => setWeeks(w)}
              style={{
                flex: 1,
                textAlign: 'center',
                padding: '12px 0',
                borderRadius: 'var(--radius-md)',
                border: `1.5px solid ${weeks === w ? 'var(--leaf-600)' : 'var(--neutral-200)'}`,
                background: weeks === w ? 'var(--leaf-50)' : 'var(--neutral-0)',
              }}
            >
              <Text bold={weeks === w} style={{ color: weeks === w ? 'var(--leaf-700)' : 'var(--neutral-900)' }}>
                {w} tuần
              </Text>
            </Box>
          ))}
        </Box>

        {addrQ.data && !defaultAddr ? (
          <Box mt={4}>
            <Text size="small" style={{ color: 'var(--clay-700)' }}>
              Bạn cần thêm địa chỉ giao hàng trước.
            </Text>
            <Button fullWidth variant="secondary" style={{ marginTop: 8 }} onClick={() => { onClose(); navigate('/addresses'); }}>
              Thêm địa chỉ
            </Button>
          </Box>
        ) : (
          <>
            {defaultAddr && (
              <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 12 }}>
                Giao tới: {defaultAddr.recipient} · {defaultAddr.street}, {defaultAddr.ward}
              </Text>
            )}
            <Button
              fullWidth
              loading={create.isPending}
              disabled={!defaultAddr}
              onClick={() => create.mutate()}
              style={{ marginTop: 16, background: 'var(--leaf-600)' }}
            >
              Bắt đầu đặt định kỳ
            </Button>
          </>
        )}
      </Box>
    </Sheet>
  );
}
