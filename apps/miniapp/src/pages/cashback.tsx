import { useState } from 'react';
import { Page, Avatar, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AlertTriangle, Undo2 } from 'lucide-react';
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
import { openAffiliateLink } from '../services/zmp-bridge';
import { useAuthStore } from '../store/auth';
import { formatVnd, formatRatePct } from '../utils/format';
import { haptic } from '../utils/haptic';
import { Badge, type BadgeTone } from '../components/ui/badge';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Button } from '../components/ui/button';
import { ErrorState } from '../components/ui/empty-state';
import { Icon } from '../components/ui/icon';
import { PageHeader } from '../components/ui/page-header';
import { rowKeyboardProps } from '../components/ui/row-keyboard';
import { Skeleton } from '../components/ui/skeleton';
import { Text } from '../components/ui/text';
import { usePublicConfig } from '../hooks/use-public-config';

const TXN_META: Record<CashbackStatus, { label: string; tone: BadgeTone }> = {
  PENDING: { label: 'Chờ duyệt', tone: 'warning' },
  CONFIRMED: { label: 'Đã duyệt', tone: 'success' },
  PAID: { label: 'Đã hoàn vào Ví', tone: 'neutral' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
};

export default function CashbackPage() {
  const { openSnackbar } = useSnackbar();
  // /cashback/transactions & /me/wallet cần auth — fetch trước khi restore() xong sẽ 401 và kẹt
  // vĩnh viễn (queryClient retry:false cho 4xx) dù login thành công ~200ms sau (như wallet.tsx).
  // /cashback/merchants là @Public() nên KHÔNG cần chờ authed.
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const cfg = usePublicConfig();
  const merchantsQ = useQuery({ queryKey: ['cashback-merchants'], queryFn: getMerchants });
  const txnQ = useQuery({ queryKey: ['cashback-txn'], queryFn: getCashbackTransactions, enabled: authed });
  const walletQ = useQuery({ queryKey: ['wallet'], queryFn: getWallet, enabled: authed });
  const [selected, setSelected] = useState<CashbackMerchant | null>(null);

  const clickMut = useMutation({
    mutationFn: (merchantId: string) => createCashbackClick(merchantId),
    onSuccess: (r) => {
      haptic('medium');
      setSelected(null);
      openSnackbar({ text: 'Đã ghi nhận hoàn tiền! Đang chuyển hướng sang sàn...', type: 'success' });
      void openAffiliateLink(r.deeplink);
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title="Hoàn tiền" />

      {/* Số dư hoàn tiền đang chờ */}
      <div style={{ padding: 16 }}>
        {walletQ.isError ? (
          // KHÔNG fallback 0đ khi lỗi tải ví — tránh user nghĩ rằng tiền hoàn đã biến mất.
          <ErrorState message={getErrorMessage(walletQ.error)} onRetry={() => void walletQ.refetch()} />
        ) : (
          <div
            style={{
              padding: 20,
              background: 'linear-gradient(135deg, var(--clay-500), var(--clay-700))',
              borderRadius: 'var(--radius-card)',
              boxShadow: 'var(--elevation-2)',
            }}
          >
            {/* `cashbackPending` chỉ CỘNG khi sàn đã CONFIRMED (cashback.service.ts) — tức là
                tiền đã chắc chắn, đang chờ về Ví. Gọi nó là "đang chờ" khiến nó bị hiểu là
                cùng nghĩa với các giao dịch nhãn "Chờ duyệt" ngay bên dưới, mà hai con số
                không bao giờ khớp (P1-13 audit mạch lạc). */}
            <Text variant="body-sm" tone="inverse" as="div">
              Đã duyệt, chờ về Ví
            </Text>
            <Text
              variant="price-xl"
              tone="inverse"
              as="div"
              style={{ fontSize: 'var(--type-display-lg-size)', lineHeight: 'var(--type-display-lg-lh)', marginTop: 4 }}
            >
              {formatVnd(walletQ.data?.cashbackPending ?? 0)}
            </Text>
            <Text variant="caption" tone="inverse" as="div" style={{ marginTop: 6 }}>
              Sàn đã xác nhận đơn — khoản này sẽ vào Ví Tubu. Đơn sàn chưa duyệt xem ở danh sách bên dưới.
            </Text>
          </div>
        )}
      </div>

      {/* Lưới đối tác */}
      <div style={{ margin: '0 16px 12px' }}>
        <Text variant="body-lg" as="div" style={{ fontWeight: 600, marginBottom: 10 }}>
          Chọn sàn để mua sắm
        </Text>
        {merchantsQ.isLoading ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} height={92} radius="var(--radius-card)" />
            ))}
          </div>
        ) : merchantsQ.isError ? (
          // Phân biệt "lỗi tải sàn" vs "chưa có sàn" — không cho user tưởng feature trống.
          <ErrorState message={getErrorMessage(merchantsQ.error)} onRetry={() => void merchantsQ.refetch()} />
        ) : merchantsQ.data && merchantsQ.data.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {merchantsQ.data.map((m) => (
              <div
                key={m.id}
                role="button"
                {...rowKeyboardProps()}
                className="tubu-press"
                onClick={() => {
                  haptic('light');
                  setSelected(m);
                }}
                style={{
                  padding: 12,
                  background: 'var(--color-bg-surface)',
                  borderRadius: 'var(--radius-card)',
                  textAlign: 'center',
                  boxShadow: 'var(--elevation-1)',
                }}
              >
                <Avatar size={40} src={m.logoUrl} />
                <Text variant="label" as="div" style={{ marginTop: 6 }}>
                  {m.name}
                </Text>
                <Text
                  variant="caption"
                  tone="brand"
                  as="div"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}
                >
                  <Icon icon={Undo2} size="sm" tone="brand" />
                  {formatRatePct(m.baseRate)}
                </Text>
              </div>
            ))}
          </div>
        ) : (
          <Text variant="body-sm" tone="tertiary" as="div">
            Chưa có sàn đối tác nào.
          </Text>
        )}
      </div>

      {/* Giao dịch hoàn tiền */}
      <div
        style={{ margin: '0 16px 12px', padding: 16, background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-card)' }}
      >
        <Text variant="body-lg" as="div" style={{ fontWeight: 600, marginBottom: 10 }}>
          Giao dịch hoàn tiền
        </Text>
        {txnQ.isError ? (
          // Tránh "Chưa có giao dịch hoàn tiền" khi thực ra là API lỗi — gây hiểu lầm mất tiền.
          <ErrorState message={getErrorMessage(txnQ.error)} onRetry={() => void txnQ.refetch()} />
        ) : txnQ.data && txnQ.data.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {txnQ.data.map((t: CashbackTxn) => {
              const m = TXN_META[t.status];
              return (
                <div
                  key={t.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '8px 0',
                    borderBottom: '1px solid var(--color-border-subtle)',
                  }}
                >
                  <div>
                    <Text variant="price-sm" tone="success" as="div">
                      +{formatVnd(t.userReward)}
                    </Text>
                    <Text variant="caption" tone="tertiary" as="div">
                      Đơn {formatVnd(t.orderAmount)}
                      {t.merchantOrderId ? ` · #${t.merchantOrderId.slice(0, 10)}` : ''}
                    </Text>
                  </div>
                  <Badge tone={m.tone}>{m.label}</Badge>
                </div>
              );
            })}
          </div>
        ) : (
          <Text variant="body-sm" tone="tertiary" as="div">
            Chưa có giao dịch hoàn tiền. Bắt đầu mua sắm qua các sàn ở trên.
          </Text>
        )}
      </div>

      {/* Chi tiết đối tác */}
      <BottomSheet
        open={selected != null}
        onClose={() => setSelected(null)}
        title={selected?.name}
        footer={
          selected && (
            <Button fullWidth loading={clickMut.isPending} onPress={() => clickMut.mutate(selected.id)}>
              Mua sắm & nhận hoàn tiền
            </Button>
          )
        }
      >
        {selected && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar size={48} src={selected.logoUrl} />
              <Text variant="body-sm" tone="brand" as="div">
                Hoàn đến {formatRatePct(selected.baseRate)} giá trị đơn
              </Text>
            </div>

            <div style={{ marginTop: 12, padding: 12, background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-control)' }}>
              <Text variant="label" as="div" style={{ marginBottom: 6 }}>
                Cách nhận hoàn tiền
              </Text>
              <Steps
                items={[
                  'Bấm "Mua sắm" để mở sàn qua liên kết Tubu',
                  'Mua hàng & thanh toán như bình thường trên sàn',
                  // Số ngày giữ lấy từ config BE: admin đổi cashback.hold_days mà đây chép cứng
                  // "30 ngày" thì tới ngày thứ 31 khách không thấy tiền và đi khiếu nại.
                  `Sàn xác nhận đơn → hoàn tiền vào Ví Tubu (sau ${cfg.cashbackHoldDays} ngày)`,
                ]}
              />
            </div>

            {selected.terms && (
              <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 10 }}>
                {selected.terms}
              </Text>
            )}

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 10 }}>
              <Icon icon={AlertTriangle} size="sm" style={{ flex: '0 0 auto', marginTop: 2, color: 'var(--color-promo-fg)' }} />
              <Text variant="caption" as="div" style={{ color: 'var(--color-promo-fg)' }}>
                Lưu ý: phải bấm từ đây mỗi lần mua để được ghi nhận hoàn tiền.
              </Text>
            </div>
          </>
        )}
      </BottomSheet>
    </Page>
  );
}

function Steps({ items }: { items: string[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((s, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span
            style={{
              flex: '0 0 auto',
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: 'var(--color-promo-solid-bg)',
              color: 'var(--color-promo-solid-fg)',
              fontSize: 'var(--type-label-size)',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {i + 1}
          </span>
          <Text variant="caption" tone="secondary" as="div">
            {s}
          </Text>
        </div>
      ))}
    </div>
  );
}
