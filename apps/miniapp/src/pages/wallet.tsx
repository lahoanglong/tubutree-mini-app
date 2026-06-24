import { useState } from 'react';
import { Box, Page, Text, Button, Input, Sheet, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, CheckCircle2, ShoppingBag, Coins, Gift, ArrowRightLeft, Landmark, type LucideIcon } from 'lucide-react';
import { getWallet, withdraw, getCoins, convertToXu, type BankInfo } from '../services/account-api';
import { getErrorMessage } from '../services/api';
import { shareLink } from '../services/zmp-bridge';
import { formatVnd } from '../utils/format';
import { Skeleton } from '../components/ui/skeleton';

const formatXu = (n: number) => `${n.toLocaleString('vi-VN')} xu`;

export default function WalletPage() {
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const walletQ = useQuery({ queryKey: ['wallet'], queryFn: getWallet });
  const coinsQ = useQuery({ queryKey: ['coins'], queryFn: getCoins });

  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [convertAmount, setConvertAmount] = useState('');
  const [bank, setBank] = useState<BankInfo>({ bankName: '', accountNumber: '', accountName: '' });

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ['wallet'] });
    void qc.invalidateQueries({ queryKey: ['coins'] });
  };

  const withdrawMut = useMutation({
    mutationFn: () => withdraw(Number(amount), bank),
    onSuccess: (r) => {
      openSnackbar({ text: `Đã gửi yêu cầu rút. Thực nhận ${formatVnd(r.net)} trong 1-3 ngày làm việc.`, type: 'success' });
      setWithdrawOpen(false);
      setAmount('');
      refreshAll();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const convertMut = useMutation({
    mutationFn: () => convertToXu(Number(convertAmount)),
    onSuccess: (r) => {
      openSnackbar({ text: `Đã đổi ${formatVnd(r.spent)} → ${formatXu(r.received)} 🎉`, type: 'success' });
      setConvertOpen(false);
      setConvertAmount('');
      refreshAll();
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  const w = walletQ.data;
  const coins = coinsQ.data;
  const amountNum = Number(amount) || 0;
  const convertNum = Number(convertAmount) || 0;
  const fee = w?.withdrawFee ?? 3000;
  const min = w?.withdrawMin ?? 100000;
  const multiplier = w?.xuConvertMultiplier ?? 1.2;

  const canWithdraw =
    amountNum >= min &&
    w != null &&
    amountNum <= w.walletBalance &&
    bank.bankName.trim().length > 0 &&
    bank.accountNumber.trim().length >= 6 &&
    bank.accountName.trim().length > 0;
  const canConvert = w != null && convertNum > 0 && convertNum <= w.walletBalance;

  const shareReferral = async () => {
    if (!coins) return;
    try {
      await shareLink({
        title: 'Tubu Tree — Trồng cây, nhận quà 🌳',
        description: `Dùng mã ${coins.referralCode} vào Tubu Tree, cả hai cùng nhận TubuXu khi bạn hoàn tiền đơn đầu!`,
        path: `/?ref=${coins.referralCode}`,
      });
    } catch {
      openSnackbar({ text: `Mã giới thiệu của bạn: ${coins.referralCode}`, type: 'info' });
    }
  };

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>
      {walletQ.isLoading ? (
        <Box p={4} style={{ gap: 12 }} flex flexDirection="column">
          <Skeleton style={{ height: 140, borderRadius: 16 }} />
          <Skeleton style={{ height: 110, borderRadius: 16 }} />
          <Skeleton style={{ height: 90, borderRadius: 16 }} />
        </Box>
      ) : walletQ.isError ? (
        <Box p={6} style={{ textAlign: 'center' }}>
          <Text style={{ color: 'var(--danger)' }}>{getErrorMessage(walletQ.error)}</Text>
        </Box>
      ) : w ? (
        <>
          {/* Ví Tubu (tiền thật) */}
          <Box p={4} pb={2}>
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
                Ví Tubu (số dư khả dụng)
              </Text>
              <Text bold style={{ fontSize: 32, lineHeight: '40px', color: '#fff', marginTop: 4 }}>
                {formatVnd(w.walletBalance)}
              </Text>
              <Box flex style={{ gap: 8, marginTop: 16 }}>
                <Button
                  variant="secondary"
                  size="small"
                  style={{ flex: 1, background: 'rgba(255,255,255,0.95)', color: 'var(--leaf-700)' }}
                  prefixIcon={<ArrowRightLeft size={15} strokeWidth={2} />}
                  disabled={w.walletBalance <= 0}
                  onClick={() => setConvertOpen(true)}
                >
                  Đổi sang TubuXu
                </Button>
                <Button
                  variant="secondary"
                  size="small"
                  style={{ flex: 1, background: 'rgba(255,255,255,0.18)', color: '#fff' }}
                  prefixIcon={<Landmark size={15} strokeWidth={2} />}
                  disabled={w.walletBalance < min}
                  onClick={() => setWithdrawOpen(true)}
                >
                  Rút ngân hàng
                </Button>
              </Box>
            </Box>
          </Box>

          {/* TubuXu */}
          <Box px={4} pb={2}>
            <Box
              p={4}
              flex
              style={{
                alignItems: 'center',
                gap: 12,
                background: 'linear-gradient(135deg, var(--clay-500, #d98b3a), var(--clay-700, #b46a1f))',
                borderRadius: 'var(--radius-xl)',
                color: '#fff',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <Box style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
                <Coins size={24} color="#fff" strokeWidth={2} />
              </Box>
              <Box style={{ flex: 1 }}>
                <Text size="small" style={{ color: 'rgba(255,255,255,0.85)' }}>
                  TubuXu (tiêu trong app)
                </Text>
                <Text bold style={{ fontSize: 24, color: '#fff', lineHeight: '30px' }}>
                  {formatXu(coins?.coinsBalance ?? w.coinsBalance)}
                </Text>
              </Box>
            </Box>
            <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 6, paddingLeft: 4 }}>
              Dùng TubuXu để mua hàng, mua nước 💧 và mua cây 🌳 trong app.
            </Text>
          </Box>

          {/* Giới thiệu bạn bè */}
          {coins && (
            <Box px={4} pb={2}>
              <Box p={4} style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xs)' }}>
                <Box flex style={{ alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Gift size={18} color="var(--leaf-700)" strokeWidth={1.9} />
                  <Text bold>Mời bạn — cả hai nhận TubuXu</Text>
                </Box>
                <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
                  Bạn bè vào app bằng mã của bạn và hoàn tiền đơn đầu tiên → cả hai cùng được thưởng xu.
                </Text>
                <Box flex style={{ gap: 16, marginTop: 12, marginBottom: 12 }}>
                  <Box>
                    <Text bold size="large" style={{ color: 'var(--leaf-700)' }}>{coins.referralSuccessCount}</Text>
                    <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>bạn thành công</Text>
                  </Box>
                  <Box>
                    <Text bold size="large" style={{ color: 'var(--clay-700, #b46a1f)' }}>{formatXu(coins.referralEarned)}</Text>
                    <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>đã nhận từ giới thiệu</Text>
                  </Box>
                </Box>
                <Box flex style={{ alignItems: 'center', gap: 8 }}>
                  <Box p={2} style={{ flex: 1, background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                    <Text bold style={{ letterSpacing: 1.5, color: 'var(--neutral-900)' }}>{coins.referralCode}</Text>
                  </Box>
                  <Button size="small" style={{ background: 'var(--leaf-600)' }} onClick={() => void shareReferral()}>
                    Chia sẻ
                  </Button>
                </Box>
              </Box>
            </Box>
          )}

          {/* Nguồn tiền chờ */}
          <Box mx={4} mb={3} flex style={{ gap: 10 }}>
            <SourceCard label="Hoa hồng chờ duyệt" value={w.commissionPending} Icon={Clock} />
            <SourceCard label="Hoa hồng có thể rút" value={w.commissionApproved} Icon={CheckCircle2} />
          </Box>
          <Box mx={4} mb={3}>
            <SourceCard label="Hoàn tiền sàn ngoài đang chờ" value={w.cashbackPending} Icon={ShoppingBag} wide />
          </Box>

          <Box mx={4} mb={4} p={4} flex style={{ background: 'var(--clay-50)', borderRadius: 'var(--radius-lg)', gap: 8 }}>
            <Coins size={18} color="var(--clay-700, #b46a1f)" strokeWidth={1.9} style={{ flex: '0 0 auto', marginTop: 1 }} />
            <Text size="xSmall" style={{ color: 'var(--clay-700, #b46a1f)' }}>
              Mẹo: đổi tiền Ví sang <b>TubuXu (×{multiplier})</b> để được thêm{' '}
              {Math.round((multiplier - 1) * 100)}% giá trị mua sắm — và <b>miễn phí</b>, thay vì rút về
              ngân hàng (phí chuyển khoản {formatVnd(fee)}/lần).
            </Text>
          </Box>
        </>
      ) : null}

      {/* Sheet đổi Ví → TubuXu */}
      <Sheet visible={convertOpen} onClose={() => setConvertOpen(false)} autoHeight>
        <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
          <Text bold size="large" style={{ marginBottom: 4 }}>Đổi Ví → TubuXu</Text>
          <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginBottom: 16 }}>
            Nhận thêm {Math.round((multiplier - 1) * 100)}% — hoàn toàn miễn phí.
          </Text>
          <Input
            label="Số tiền muốn đổi (đ)"
            type="number"
            placeholder="VD: 100.000"
            value={convertAmount}
            onChange={(e) => setConvertAmount(e.target.value)}
          />
          {convertNum > 0 && (
            <Box mt={2} p={3} style={{ background: 'var(--clay-50)', borderRadius: 'var(--radius-md)' }}>
              <Text size="small" style={{ color: 'var(--clay-700, #b46a1f)' }}>
                Nhận ≈ <b>{formatXu(Math.floor(convertNum * multiplier))}</b>
              </Text>
            </Box>
          )}
          <Button
            fullWidth
            style={{ marginTop: 20, background: 'var(--leaf-600)' }}
            disabled={!canConvert || convertMut.isPending}
            onClick={() => convertMut.mutate()}
          >
            {convertMut.isPending ? 'Đang đổi...' : 'Đổi ngay'}
          </Button>
        </Box>
      </Sheet>

      {/* Sheet rút tiền */}
      <Sheet visible={withdrawOpen} onClose={() => setWithdrawOpen(false)} autoHeight>
        <Box p={4} style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}>
          <Text bold size="large" style={{ marginBottom: 16 }}>Rút tiền về ngân hàng</Text>
          <Box flex flexDirection="column" style={{ gap: 12 }}>
            <Input
              label="Số tiền rút"
              type="number"
              placeholder={`Tối thiểu ${formatVnd(min)}`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Input label="Tên ngân hàng" placeholder="VD: Techcombank" value={bank.bankName} onChange={(e) => setBank((b) => ({ ...b, bankName: e.target.value }))} />
            <Input label="Số tài khoản" value={bank.accountNumber} onChange={(e) => setBank((b) => ({ ...b, accountNumber: e.target.value }))} />
            <Input label="Chủ tài khoản" placeholder="Tên in trên thẻ" value={bank.accountName} onChange={(e) => setBank((b) => ({ ...b, accountName: e.target.value }))} />
          </Box>
          {amountNum >= min && (
            <Box mt={2} p={3} style={{ background: 'var(--neutral-50)', borderRadius: 'var(--radius-md)' }}>
              <Text size="xSmall" style={{ color: 'var(--neutral-500)' }}>
                Phí chuyển khoản ngân hàng: {formatVnd(fee)} • Thực nhận: <b>{formatVnd(Math.max(0, amountNum - fee))}</b>
              </Text>
            </Box>
          )}
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

function SourceCard({ label, value, Icon, wide }: { label: string; value: number; Icon: LucideIcon; wide?: boolean }) {
  return (
    <Box p={3} style={{ flex: 1, background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xs)' }}>
      <Box style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--leaf-50)', display: 'grid', placeItems: 'center' }}>
        <Icon size={17} color="var(--leaf-700)" strokeWidth={1.9} />
      </Box>
      <Text bold size={wide ? 'normal' : 'small'} style={{ color: 'var(--neutral-900)', marginTop: 4 }}>
        {formatVnd(value)}
      </Text>
      <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
        {label}
      </Text>
    </Box>
  );
}
