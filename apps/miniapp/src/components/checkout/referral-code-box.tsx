import { useState } from 'react';
import { Input } from 'zmp-ui';
import { ChevronRight, TriangleAlert, Users } from 'lucide-react';
import { recordReferralTouch } from '../../services/affiliate-api';
import { getErrorMessage } from '../../services/api';
import { haptic } from '../../utils/haptic';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
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
    <div
      style={{
        width: 36,
        height: 36,
        borderRadius: 'var(--radius-control)',
        background: 'var(--color-promo-bg)',
        display: 'grid',
        placeItems: 'center',
        flex: '0 0 auto',
      }}
    >
      <Users size={20} color="var(--color-promo-fg)" aria-hidden />
    </div>
  );
}

function CodeChip({ code }: { code: string }) {
  return (
    <span
      style={{
        background: 'var(--color-promo-bg)',
        border: '1px dashed var(--color-promo-solid-bg)',
        borderRadius: 'var(--radius-control)',
        padding: '2px 6px',
        color: 'var(--color-promo-fg)',
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
    <div style={{ padding: 16, marginTop: 8, background: 'var(--color-bg-surface)' }}>{children}</div>
  );

  const fixedCode = linkedCode ? linkedCode.trim().toUpperCase() : appliedCode && !open ? appliedCode : null;
  if (fixedCode) {
    return shell(
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Tile />
          <div>
            <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
              Mã người giới thiệu
            </Text>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <CodeChip code={fixedCode} />
              <Text variant="caption" tone="success">
                {linkedCode ? 'Bạn đang mua qua link giới thiệu' : 'Mã hợp lệ, đơn này ghi nhận cho người giới thiệu'}
              </Text>
            </div>
          </div>
        </div>
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
      </div>,
    );
  }

  if (!open) {
    return shell(
      <button
        type="button"
        className="tubu-press"
        onClick={() => {
          haptic('light');
          setOpen(true);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          minHeight: 44,
          padding: 0,
          border: 'none',
          background: 'none',
          color: 'inherit',
          font: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Tile />
          <span style={{ display: 'block', minWidth: 0 }}>
            <Text variant="body-sm" as="span" style={{ display: 'block', fontWeight: 600 }}>
              Mã người giới thiệu
            </Text>
            <Text variant="caption" tone="tertiary" as="span" style={{ display: 'block', marginTop: 2 }}>
              Có người giới thiệu Tubu cho bạn? Nhập mã của họ
            </Text>
          </span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginLeft: 8 }}>
          <Text variant="caption" tone="brand" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
            Nhập mã
          </Text>
          <ChevronRight size={16} color="var(--color-text-brand)" aria-hidden />
        </span>
      </button>,
    );
  }

  const apply = async () => {
    const code = draft.replace(/\s+/g, '').toUpperCase();
    if (!code) {
      setError('Bạn nhập mã người giới thiệu giúp Tubu nhé');
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
        Mã người giới thiệu
      </Text>
      <Input
        aria-label="Mã người giới thiệu"
        placeholder="Nhập mã người giới thiệu"
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
        <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <span aria-hidden="true" style={{ display: 'inline-flex', marginTop: 2 }}>
            <Icon icon={TriangleAlert} size="sm" tone="danger" />
          </span>
          <Text variant="caption" tone="danger" as="div">
            {error}
          </Text>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="secondary" onPress={() => setOpen(false)}>
          Huỷ
        </Button>
        <Button fullWidth loading={checking} onPress={() => void apply()}>
          Áp dụng
        </Button>
      </div>
    </div>,
  );
}
