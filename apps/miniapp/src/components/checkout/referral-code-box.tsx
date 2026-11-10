import { useEffect, useRef, useState } from 'react';
import type { ElementRef } from 'react';
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
  /** Khoá mọi nút và ô nhập khi đơn đang gửi. */
  disabled?: boolean;
}

const MISS_MESSAGE = 'Không tìm thấy mã này, hoặc đây là mã của chính bạn. Bạn kiểm tra lại giúp Tubu nhé.';
const ERROR_ID = 'referral-code-error';

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
export function ReferralCodeBox({ linkedCode, appliedCode, onApplied, disabled = false }: ReferralCodeBoxProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<ElementRef<typeof Input>>(null);
  const refocus = useRef(false);
  // Khoá ref đồng bộ: `checking` chỉ đúng sau lần vẽ kế tiếp, nên hai cú bấm "Áp dụng" hoặc Enter sát nhau vẫn đều gọi /affiliate/touch.
  const applyingRef = useRef(false);

  // Ô nhập bị disabled lúc kiểm tra nên trình duyệt thả focus về body; lỗi thì ô còn mở, trả focus để gõ lại ngay.
  useEffect(() => {
    if (checking || !refocus.current) return;
    refocus.current = false;
    inputRef.current?.focus();
  }, [checking]);

  const shell =(children: React.ReactNode) => (
    <section
      aria-label="Mã người giới thiệu"
      style={{ padding: 16, marginTop: 8, background: 'var(--color-bg-surface)' }}
    >
      {children}
    </section>
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
            disabled={disabled}
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
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
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
          opacity: disabled ? 0.6 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
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
    if (applyingRef.current || disabled) return;
    const code = draft.replace(/\s+/g, '').toUpperCase();
    if (!code) {
      setError('Bạn nhập mã người giới thiệu giúp Tubu nhé');
      return;
    }
    applyingRef.current = true;
    refocus.current = true;
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
      applyingRef.current = false;
      setChecking(false);
    }
  };

  return shell(
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
        Mã người giới thiệu
      </Text>
      <Input
        ref={inputRef}
        aria-label="Mã người giới thiệu"
        placeholder="Nhập mã người giới thiệu"
        value={draft}
        maxLength={64}
        autoCapitalize="characters"
        disabled={checking || disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? ERROR_ID : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          // Bộ gõ đang ghép chữ (isComposing, hoặc keyCode 229 trên WKWebView) thì Enter chỉ chốt chữ, không gửi mã.
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          void apply();
        }}
        status={error ? 'error' : undefined}
      />
      {error && (
        <div id={ERROR_ID} role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <span aria-hidden="true" style={{ display: 'inline-flex', marginTop: 2 }}>
            <Icon icon={TriangleAlert} size="sm" tone="danger" />
          </span>
          <Text variant="caption" tone="danger" as="div">
            {error}
          </Text>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          variant="secondary"
          disabled={checking || disabled}
          onPress={() => {
            if (checking || disabled) return;
            setOpen(false);
          }}
        >
          Huỷ
        </Button>
        <Button fullWidth disabled={disabled} loading={checking} onPress={() => void apply()}>
          Áp dụng
        </Button>
      </div>
    </div>,
  );
}
