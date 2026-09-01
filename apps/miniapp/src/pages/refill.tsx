import { useState } from 'react';
import { Box, Page, Text, Button, Spinner, useSnackbar } from 'zmp-ui';
import { Recycle, Droplets, Minus, Plus } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRefillSummary, returnBottles } from '../services/refill-api';
import { useAuthStore } from '../store/auth';
import { ErrorState } from '../components/ui/empty-state';
import { haptic } from '../utils/haptic';

function msg(e: unknown): string {
  const ax = e as { response?: { data?: { message?: string } }; message?: string };
  return ax?.response?.data?.message ?? ax?.message ?? 'Có lỗi xảy ra';
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
  } catch {
    return '';
  }
}

export default function RefillPage() {
  const { openSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const authed = useAuthStore((s) => s.status) === 'authenticated';
  const [qty, setQty] = useState(1);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['refill'],
    queryFn: getRefillSummary,
    enabled: authed,
  });

  const returnM = useMutation({
    mutationFn: () => returnBottles(qty),
    onSuccess: () => {
      haptic('heavy');
      openSnackbar({ text: '📋 Đã gửi yêu cầu đổi vỏ chai! Vui lòng chờ quản lý duyệt.', type: 'success' });
      setQty(1);
      void queryClient.invalidateQueries({ queryKey: ['refill'] });
      void queryClient.invalidateQueries({ queryKey: ['garden'] });
      void queryClient.invalidateQueries({ queryKey: ['game'] });
    },
    onError: (e: unknown) => openSnackbar({ text: msg(e), type: 'error' }),
  });

  const remaining = data?.monthlyRemaining ?? 0;
  const maxQty = Math.max(1, remaining);
  const canSubmit = authed && remaining > 0 && qty >= 1 && qty <= remaining && !returnM.isPending;

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 80 }}>
      <Box p={3} style={{ background: 'var(--neutral-0)' }}>
        <Box flex alignItems="center" style={{ gap: 8 }}>
          <Recycle size={22} color="var(--leaf-600)" />
          <Text bold size="large">Đổi vỏ chai — Nhận nước</Text>
        </Box>
        <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 4 }}>
          Mang vỏ chai rỗng đến cửa hàng đổi lấy 💧 tưới Vườn Xanh. Tái chế vỏ → nuôi cây thật 🌳
        </Text>
      </Box>

      {isLoading ? (
        <Box flex justifyContent="center" p={6}><Spinner /></Box>
      ) : isError ? (
        <ErrorState message={msg(error)} onRetry={() => void refetch()} />
      ) : (
        <Box p={2}>
          {/* Tổng quan dấu chân xanh */}
          <Box flex style={{ gap: 8 }}>
            <Box style={{ flex: 1, background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)', padding: 14, textAlign: 'center' }}>
              <Text bold size="large" style={{ color: 'var(--leaf-700)' }}>{data?.totalRecycled ?? 0}</Text>
              <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>vỏ đã tái chế</Text>
            </Box>
            <Box style={{ flex: 1, background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)', padding: 14, textAlign: 'center' }}>
              <Text bold size="large" style={{ color: 'var(--leaf-700)' }}>{remaining}</Text>
              <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>còn đổi được tháng này</Text>
            </Box>
          </Box>

          {/* Bộ đổi vỏ */}
          <Box mt={2} p={3} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }}>
            <Text size="small" bold>Bạn đang đổi mấy vỏ chai?</Text>
            <Box flex alignItems="center" justifyContent="center" style={{ gap: 16, margin: '14px 0' }}>
              <Button
                size="small"
                variant="secondary"
                disabled={qty <= 1}
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                style={{ minWidth: 40 }}
              >
                <Minus size={16} />
              </Button>
              <Text bold style={{ fontSize: 28, minWidth: 40, textAlign: 'center' }}>{qty}</Text>
              <Button
                size="small"
                variant="secondary"
                disabled={qty >= maxQty}
                onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                style={{ minWidth: 40 }}
              >
                <Plus size={16} />
              </Button>
            </Box>
            <Box flex alignItems="center" justifyContent="center" style={{ gap: 6 }}>
              <Droplets size={16} color="var(--sky-600, #0284c7)" />
              <Text size="small" style={{ color: 'var(--neutral-600)' }}>
                Nhận <b>{qty * (data?.perBottle ?? 0)}💧</b> ({data?.perBottle ?? 0}💧 / vỏ)
              </Text>
            </Box>
            <Button
              fullWidth
              loading={returnM.isPending}
              disabled={!canSubmit}
              onClick={() => returnM.mutate()}
              style={{ marginTop: 14, background: canSubmit ? 'var(--leaf-600)' : 'var(--neutral-300)' }}
            >
              {remaining > 0 ? 'Gửi yêu cầu đổi vỏ' : 'Đã hết lượt đổi tháng này'}
            </Button>
            {!authed && (
              <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 8, textAlign: 'center' }}>
                Đăng nhập để đổi vỏ lấy nước.
              </Text>
            )}
          </Box>

          {/* Lịch sử */}
          {data && data.history.length > 0 && (
            <Box mt={2} p={3} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }}>
              <Text size="small" bold style={{ marginBottom: 8 }}>Lịch sử đổi vỏ</Text>
              {data.history.map((h) => {
                const statusKey = h.status ?? 'PENDING';
                const statusMeta = {
                  PENDING: { label: 'Chờ duyệt', color: '#e65100', bg: '#fff3e0' },
                  APPROVED: { label: `+${h.seedsAwarded}💧`, color: 'var(--leaf-700)', bg: '#e8f5e9' },
                  REJECTED: { label: 'Từ chối', color: '#c62828', bg: '#ffebee' },
                }[statusKey];

                return (
                  <Box key={h.id} flex justifyContent="space-between" alignItems="center" style={{ padding: '6px 0', borderBottom: '1px solid var(--neutral-100)' }}>
                    <Text size="small" style={{ color: 'var(--neutral-600)' }}>{h.quantity} vỏ · {fmtDate(h.createdAt)}</Text>
                    <Text
                      size="xSmall"
                      bold
                      style={{
                        color: statusMeta.color,
                        background: statusMeta.bg,
                        padding: '2px 8px',
                        borderRadius: 12,
                      }}
                    >
                      {statusMeta.label}
                    </Text>
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>
      )}
    </Page>
  );
}
