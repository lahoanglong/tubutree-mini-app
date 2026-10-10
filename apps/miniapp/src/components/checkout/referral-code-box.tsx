import { useState } from 'react';
import { Box, Input } from 'zmp-ui';
import { ChevronRight, Users } from 'lucide-react';
import { recordReferralTouch } from '../../services/affiliate-api';
import { getErrorMessage } from '../../services/api';
import { haptic } from '../../utils/haptic';
import { Button } from '../ui/button';
import { Text } from '../ui/text';

/** Mã gửi kèm đơn: mã khách vừa nhập ở checkout thắng mã còn trong phiên từ link giới thiệu. */
export function effectiveReferralCode(
  applied: string | null,
  contextReferral: string | null | undefined,
): string | undefined {
  return applied ?? contextReferral ?? undefined;
}

export interface ReferralCodeBoxProps {
  /** Mã đã gắn sẵn từ link CTV / gian hàng — hiện cố định, không cho nhập đè. */
  linkedCode: string | null;
  /** Mã khách đã nhập và server xác nhận trong phiên checkout này. */
  appliedCode: string | null;
  onApplied: (code: string) => void;
}

const MISS_MESSAGE = 'Không tìm thấy mã này, hoặc đây là mã của chính bạn. Bạn kiểm tra lại giúp Tubu nhé.';

function Tile() {
  return (
    <Box
      style={{
        width: 36,
        height: 36,
        borderRadius: 'var(--radius-control)',
        background: 'var(--clay-50)',
        display: 'grid',
        placeItems: 'center',
        flex: '0 0 auto',
      }}
    >
      <Users size={20} color="var(--clay-700)" aria-hidden />
    </Box>
  );
}

function CodeChip({ code }: { code: string }) {
  return (
    <span
      style={{
        background: 'var(--clay-50)',
        border: '1px dashed var(--clay-500)',
        borderRadius: 'var(--radius-control)',
        padding: '2px 6px',
        color: 'var(--clay-700)',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.5,
      }}
    >
      {code}
    </span>
  );
}

/**
 * Ô nhập mã giới thiệu CTV ở checkout (C-020): caption của CTV dặn "Nhập mã X khi mua" nên checkout
 * phải có chỗ để nhập. Mã được xác nhận qua /affiliate/touch (cơ chế attribution sẵn có: server tra
 * mã, loại mã của chính người mua, ghi "chạm" giới thiệu) rồi gửi kèm đơn qua `referralCode`.
 */
export function ReferralCodeBox({ linkedCode, appliedCode, onApplied }: ReferralCodeBoxProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const shell = (children: React.ReactNode) => (
    <Box p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
      {children}
    </Box>
  );

  const fixedCode = linkedCode ? linkedCode.trim().toUpperCase() : appliedCode && !open ? appliedCode : null;
  if (fixedCode) {
    return shell(
      <Box flex alignItems="center" justifyContent="space-between" style={{ minHeight: 44, gap: 10 }}>
        <Box flex alignItems="center" style={{ gap: 10, minWidth: 0 }}>
          <Tile />
          <Box>
            <Text variant="label" as="div">
              Mã giới thiệu
            </Text>
            <Box flex alignItems="center" style={{ gap: 8, marginTop: 2 }}>
              <CodeChip code={fixedCode} />
              <Text variant="caption" tone="success">
                {linkedCode ? 'Bạn đang mua qua link giới thiệu' : 'Mã hợp lệ, đơn này ghi nhận cho người giới thiệu'}
              </Text>
            </Box>
          </Box>
        </Box>
        {!linkedCode && (
          <Button
            variant="ghost"
            onPress={() => {
              haptic('light');
              setDraft('');
              setError(null);
              setOpen(true);
            }}
          >
            Đổi
          </Button>
        )}
      </Box>,
    );
  }

  if (!open) {
    return shell(
      <Box
        role="button"
        className="tubu-press"
        onClick={() => {
          haptic('light');
          setOpen(true);
        }}
        flex
        alignItems="center"
        justifyContent="space-between"
        style={{ minHeight: 44, cursor: 'pointer' }}
      >
        <Box flex alignItems="center" style={{ gap: 10 }}>
          <Tile />
          <Box>
            <Text variant="label" as="div">
              Mã giới thiệu
            </Text>
            <Text variant="caption" tone="tertiary" as="div" style={{ marginTop: 2 }}>
              Có người giới thiệu Tubu cho bạn? Nhập mã của họ
            </Text>
          </Box>
        </Box>
        <Box flex alignItems="center" style={{ gap: 4 }}>
          <Text variant="caption" tone="brand" style={{ fontWeight: 700 }}>
            Nhập mã
          </Text>
          <ChevronRight size={16} color="var(--color-text-brand)" aria-hidden />
        </Box>
      </Box>,
    );
  }

  const apply = async () => {
    const code = draft.replace(/\s+/g, '').toUpperCase();
    if (!code) {
      setError('Bạn nhập mã giới thiệu giúp Tubu nhé');
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const res = await recordReferralTouch({ referralCode: code, kind: 'ctv' });
      if (!res.ok) {
        setError(MISS_MESSAGE);
        return;
      }
      haptic('medium');
      setOpen(false);
      onApplied(code);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setChecking(false);
    }
  };

  return shell(
    <Box flex flexDirection="column" style={{ gap: 10 }}>
      <Text variant="label" as="div">
        Mã giới thiệu
      </Text>
      <Input
        aria-label="Mã giới thiệu"
        placeholder="Nhập mã giới thiệu"
        value={draft}
        maxLength={64}
        autoCapitalize="characters"
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError(null);
        }}
        status={error ? 'error' : undefined}
      />
      {error && (
        <div role="alert">
          <Text variant="caption" tone="danger" as="div">
            <span aria-hidden="true">⚠ </span>
            {error}
          </Text>
        </div>
      )}
      <Box flex style={{ gap: 8 }}>
        <Button variant="secondary" onPress={() => setOpen(false)}>
          Huỷ
        </Button>
        <Button fullWidth loading={checking} onPress={() => void apply()}>
          Áp dụng
        </Button>
      </Box>
    </Box>,
  );
}
