import { useState } from 'react';
import { Box, Page, Text, Button, Sheet, Avatar, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  getMerchants,
  createCashbackClick,
  getCashbackTransactions,
  type CashbackMerchant,
  type CashbackStatus,
  type CashbackTxn,
} from '../services/cashback-api';
import { getWallet } from '../services/account-api';
import { getErrorMessage } from '../services/api';
import { openExternal } from '../services/zmp-bridge';
import { formatVnd } from '../utils/format';
import { haptic } from '../utils/haptic';
import { Skeleton } from '../components/ui/skeleton';

const TXN_META: Record<CashbackStatus, { label: string; color: string; bg: string }> = {
  PENDING: { label: 'Chờ duyệt', color: 'var(--clay-700)', bg: 'var(--clay-50)' },
  CONFIRMED: { label: 'Đã duyệt', color: 'var(--leaf-700)', bg: 'var(--leaf-50)' },
  PAID: { label: 'Đã hoàn vào Ví', color: 'var(--neutral-600)', bg: 'var(--neutral-100)' },
  REJECTED: { label: 'Từ chối', color: 'var(--danger)', bg: '#fbe9e9' },
};

export default function CashbackPage() {
  const { openSnackbar } = useSnackbar();
  const merchantsQ = useQuery({ queryKey: ['cashback-merchants'], queryFn: getMerchants });
  const txnQ = useQuery({ queryKey: ['cashback-txn'], queryFn: getCashbackTransactions });
  const walletQ = useQuery({ queryKey: ['wallet'], queryFn: getWallet });
  const [selected, setSelected] = useState<CashbackMerchant | null>(null);

  const clickMut = useMutation({
    mutationFn: (merchantId: string) => createCashbackClick(merchantId),
    onSuccess: (r) => {
      haptic('medium');
      setSelected(null);
      void openExternal(r.deeplink).catch(() =>
        openSnackbar({ text: 'Không mở được liên kết sàn.', type: 'error' }),
      );
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>

      {/* Số dư hoàn tiền đang chờ */}
      <Box p={4}>
        <Box
          p={5}
          style={{
            background: 'linear-gradient(135deg, var(--clay-500), var(--clay-700))',
            borderRadius: 'var(--radius-xl)',
            color: '#fff',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <Text size="small" style={{ color: 'rgba(255,255,255,0.85)' }}>
            Hoàn tiền đang chờ
          </Text>
          <Text bold style={{ fontSize: 30, lineHeight: '38px', color: '#fff', marginTop: 4 }}>
            {formatVnd(walletQ.data?.cashbackPending ?? 0)}
          </Text>
          <Text size="xSmall" style={{ color: 'rgba(255,255,255,0.85)', marginTop: 6 }}>
            Mua qua Tubu — nhận hoàn tiền vào Ví sau khi sàn xác nhận đơn.
          </Text>
        </Box>
      </Box>

      {/* Lưới đối tác */}
      <Box mx={4} mb={3}>
        <Text bold style={{ marginBottom: 10 }}>
          Chọn sàn để mua sắm
        </Text>
        {merchantsQ.isLoading ? (
          <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} style={{ height: 92, borderRadius: 12 }} />
            ))}
          </Box>
        ) : merchantsQ.data && merchantsQ.data.length > 0 ? (
          <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {merchantsQ.data.map((m) => (
              <Box
                key={m.id}
                className="tubu-press"
                p={3}
                onClick={() => {
                  haptic('light');
                  setSelected(m);
                }}
                style={{
                  background: 'var(--neutral-0)',
                  borderRadius: 'var(--radius-lg)',
                  textAlign: 'center',
                  boxShadow: 'var(--shadow-xs)',
                }}
              >
                <Avatar size={40} src={m.logoUrl} />
                <Text size="xSmall" bold style={{ marginTop: 6 }}>
                  {m.name}
                </Text>
                <Text size="xSmall" style={{ color: 'var(--leaf-700)' }}>
                  ↩ {Number(m.baseRate)}%
                </Text>
              </Box>
            ))}
          </Box>
        ) : (
          <Text size="small" style={{ color: 'var(--neutral-400)' }}>
            Chưa có sàn đối tác nào.
          </Text>
        )}
      </Box>

      {/* Giao dịch hoàn tiền */}
      <Box mx={4} mb={3} p={4} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)' }}>
        <Text bold style={{ marginBottom: 10 }}>
          Giao dịch hoàn tiền
        </Text>
        {txnQ.data && txnQ.data.length > 0 ? (
          <Box flex flexDirection="column" style={{ gap: 2 }}>
            {txnQ.data.map((t: CashbackTxn) => {
              const m = TXN_META[t.status];
              return (
                <Box
                  key={t.id}
                  flex
                  alignItems="center"
                  justifyContent="space-between"
                  py={2}
                  style={{ borderBottom: '1px solid var(--neutral-100)' }}
                >
                  <Box>
                    <Text size="small" bold style={{ color: 'var(--leaf-700)' }}>
                      +{formatVnd(t.userReward)}
                    </Text>
                    <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
                      Đơn {formatVnd(t.orderAmount)}
                      {t.merchantOrderId ? ` · #${t.merchantOrderId.slice(0, 10)}` : ''}
                    </Text>
                  </Box>
                  <Text
                    size="xSmall"
                    style={{ color: m.color, background: m.bg, padding: '2px 8px', borderRadius: 'var(--radius-full)' }}
                  >
                    {m.label}
                  </Text>
                </Box>
              );
            })}
          </Box>
        ) : (
          <Text size="small" style={{ color: 'var(--neutral-400)' }}>
            Chưa có giao dịch hoàn tiền. Bắt đầu mua sắm qua các sàn ở trên.
          </Text>
        )}
      </Box>

      {/* Chi tiết đối tác */}
      <Sheet visible={selected != null} onClose={() => setSelected(null)} autoHeight>
        {selected && (
          <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
            <Box flex alignItems="center" style={{ gap: 12 }}>
              <Avatar size={48} src={selected.logoUrl} />
              <Box>
                <Text bold size="large">
                  {selected.name}
                </Text>
                <Text size="small" style={{ color: 'var(--leaf-700)' }}>
                  Hoàn đến {Number(selected.baseRate)}% giá trị đơn
                </Text>
              </Box>
            </Box>

            <Box mt={3} p={3} style={{ background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)' }}>
              <Text size="xSmall" bold style={{ marginBottom: 6 }}>
                Cách nhận hoàn tiền
              </Text>
              <Steps
                items={[
                  'Bấm "Mua sắm" để mở sàn qua liên kết Tubu',
                  'Mua hàng & thanh toán như bình thường trên sàn',
                  'Sàn xác nhận đơn → hoàn tiền vào Ví Tubu (sau 30 ngày)',
                ]}
              />
            </Box>

            {selected.terms && (
              <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 10 }}>
                {selected.terms}
              </Text>
            )}

            <Text size="xSmall" style={{ color: 'var(--clay-700)', marginTop: 10 }}>
              ⚠ Lưu ý: phải bấm từ đây mỗi lần mua để được ghi nhận hoàn tiền.
            </Text>

            <Button
              fullWidth
              loading={clickMut.isPending}
              disabled={clickMut.isPending}
              onClick={() => clickMut.mutate(selected.id)}
              style={{ marginTop: 16, background: 'var(--clay-500)' }}
            >
              Mua sắm & nhận hoàn tiền
            </Button>
          </Box>
        )}
      </Sheet>
    </Page>
  );
}

function Steps({ items }: { items: string[] }) {
  return (
    <Box flex flexDirection="column" style={{ gap: 8 }}>
      {items.map((s, i) => (
        <Box key={i} flex alignItems="flex-start" style={{ gap: 8 }}>
          <span
            style={{
              flex: '0 0 auto',
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: 'var(--clay-500)',
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {i + 1}
          </span>
          <Text size="xSmall" style={{ color: 'var(--neutral-600)' }}>
            {s}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
