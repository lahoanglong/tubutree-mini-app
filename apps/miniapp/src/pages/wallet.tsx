import { useState } from 'react';
import { Box, Page, Text, Header, Button, Input, Sheet, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getWallet, withdraw, type BankInfo } from '../services/account-api';
import { getErrorMessage } from '../services/api';
import { formatVnd } from '../utils/format';
import { Skeleton } from '../components/ui/skeleton';

const MIN_WITHDRAW = 50_000;

export default function WalletPage() {
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const walletQ = useQuery({ queryKey: ['wallet'], queryFn: getWallet });

  const [sheetOpen, setSheetOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [bank, setBank] = useState<BankInfo>({ bankName: '', accountNumber: '', accountName: '' });

  const withdrawMut = useMutation({
    mutationFn: () => withdraw(Number(amount), bank),
    onSuccess: () => {
      openSnackbar({ text: 'Đã gửi yêu cầu rút tiền. Xử lý trong 1-3 ngày làm việc.', type: 'success' });
      setSheetOpen(false);
      setAmount('');
      void qc.invalidateQueries({ queryKey: ['wallet'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const w = walletQ.data;
  const amountNum = Number(amount) || 0;
  const canWithdraw =
    amountNum >= MIN_WITHDRAW &&
    w != null &&
    amountNum <= w.walletBalance &&
    bank.bankName.trim().length > 0 &&
    bank.accountNumber.trim().length >= 6 &&
    bank.accountName.trim().length > 0;

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>
      <Header title="Ví Tubu" />

      {walletQ.isLoading ? (
        <Box p={4} style={{ gap: 12 }} flex flexDirection="column">
          <Skeleton style={{ height: 140, borderRadius: 16 }} />
          <Skeleton style={{ height: 90, borderRadius: 16 }} />
        </Box>
      ) : walletQ.isError ? (
        <Box p={6} style={{ textAlign: 'center' }}>
          <Text style={{ color: 'var(--danger)' }}>{getErrorMessage(walletQ.error)}</Text>
        </Box>
      ) : w ? (
        <>
          {/* Số dư khả dụng */}
          <Box p={4}>
            <Box
              p={5}
              style={{
                background: 'linear-gradient(135deg, var(--leaf-600), var(--leaf-700))',
                borderRadius: 'var(--radius-xl)',
                color: 'var(--neutral-0)',
                boxShadow: 'var(--shadow-md)',
              }}
            >
              <Text size="small" style={{ color: 'rgba(255,255,255,0.85)' }}>
                Số dư khả dụng
              </Text>
              <Text bold style={{ fontSize: 32, lineHeight: '40px', color: '#fff', marginTop: 4 }}>
                {formatVnd(w.walletBalance)}
              </Text>
              <Button
                variant="secondary"
                size="small"
                style={{ marginTop: 16, background: 'rgba(255,255,255,0.95)', color: 'var(--leaf-700)' }}
                disabled={w.walletBalance < MIN_WITHDRAW}
                onClick={() => setSheetOpen(true)}
              >
                Rút tiền về ngân hàng
              </Button>
              {w.walletBalance < MIN_WITHDRAW && (
                <Text size="xSmall" style={{ color: 'rgba(255,255,255,0.8)', marginTop: 6 }}>
                  Rút tối thiểu {formatVnd(MIN_WITHDRAW)}
                </Text>
              )}
            </Box>
          </Box>

          {/* Nguồn tiền chờ */}
          <Box mx={4} mb={3} flex style={{ gap: 10 }}>
            <SourceCard label="Hoa hồng chờ duyệt" value={w.commissionPending} icon="⏳" />
            <SourceCard label="Hoa hồng có thể rút" value={w.commissionApproved} icon="✅" />
          </Box>
          <Box mx={4} mb={3}>
            <SourceCard label="Hoàn tiền sàn ngoài đang chờ" value={w.cashbackPending} icon="🛍️" wide />
          </Box>

          <Box mx={4} p={4} style={{ background: 'var(--clay-50)', borderRadius: 'var(--radius-lg)' }}>
            <Text size="xSmall" style={{ color: 'var(--clay-700)' }}>
              💡 Mẹo: chuyển hoa hồng/hoàn tiền vào Ví Tubu được nhân <b>×1.5</b> giá trị để mua sắm —
              thay vì rút về ngân hàng.
            </Text>
          </Box>
        </>
      ) : null}

      {/* Sheet rút tiền */}
      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)} autoHeight>
        <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
          <Text bold size="large" style={{ marginBottom: 16 }}>
            Rút tiền về ngân hàng
          </Text>
          <Box flex flexDirection="column" style={{ gap: 12 }}>
            <Input
              label="Số tiền rút"
              type="number"
              placeholder={`Tối thiểu ${formatVnd(MIN_WITHDRAW)}`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Input
              label="Tên ngân hàng"
              placeholder="VD: Techcombank"
              value={bank.bankName}
              onChange={(e) => setBank((b) => ({ ...b, bankName: e.target.value }))}
            />
            <Input
              label="Số tài khoản"
              value={bank.accountNumber}
              onChange={(e) => setBank((b) => ({ ...b, accountNumber: e.target.value }))}
            />
            <Input
              label="Chủ tài khoản"
              placeholder="Tên in trên thẻ"
              value={bank.accountName}
              onChange={(e) => setBank((b) => ({ ...b, accountName: e.target.value }))}
            />
          </Box>
          <Button
            fullWidth
            style={{ marginTop: 20, background: 'var(--leaf-600)' }}
            disabled={!canWithdraw || withdrawMut.isPending}
            onClick={() => withdrawMut.mutate()}
          >
            {withdrawMut.isPending ? 'Đang gửi...' : `Rút ${amountNum > 0 ? formatVnd(amountNum) : ''}`}
          </Button>
        </Box>
      </Sheet>
    </Page>
  );
}

function SourceCard({
  label,
  value,
  icon,
  wide,
}: {
  label: string;
  value: number;
  icon: string;
  wide?: boolean;
}) {
  return (
    <Box
      p={3}
      style={{
        flex: 1,
        background: 'var(--neutral-0)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-xs)',
      }}
    >
      <Text style={{ fontSize: 20 }}>{icon}</Text>
      <Text bold size={wide ? 'normal' : 'small'} style={{ color: 'var(--neutral-900)', marginTop: 4 }}>
        {formatVnd(value)}
      </Text>
      <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
        {label}
      </Text>
    </Box>
  );
}
