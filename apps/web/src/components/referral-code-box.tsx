'use client';

import { useState } from 'react';
import { ChevronRight, TriangleAlert, Users } from 'lucide-react';
import { recordReferralTouch } from '@/lib/shop-client';
import { ui } from '@/lib/guest-ui';
import { mini } from '@/components/order-mobile/mobile-ui';

const MISS_MESSAGE = 'Không tìm thấy mã này, hoặc đây là mã của chính bạn. Bạn kiểm tra lại giúp Tubu nhé.';

function Tile() {
  return (
    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-control bg-promo-bg text-promo-fg">
      <Users className="h-5 w-5" aria-hidden="true" />
    </span>
  );
}

function CodeChip({ code }: { code: string }) {
  return (
    <span className="rounded-control border border-dashed border-promo-solid bg-promo-bg px-1.5 py-0.5 text-xs font-bold tracking-wide text-promo-fg">
      {code}
    </span>
  );
}

/**
 * Ô nhập mã giới thiệu CTV ở thanh toán, cùng cách làm với Mini App: caption của CTV dặn "Nhập mã X khi mua" nên
 * thanh toán phải có chỗ nhập. Mã được xác nhận qua /affiliate/touch (server tra mã, loại mã của chính người mua, ghi
 * "chạm" giới thiệu) rồi gửi kèm đơn qua `referralCode`.
 */
export function ReferralCodeBox({
  linkedCode,
  appliedCode,
  onApplied,
  disabled = false,
}: {
  /** Mã gắn sẵn từ link CTV / gian hàng: hiện cố định, không cho nhập đè. */
  linkedCode: string | null;
  /** Mã khách đã nhập và server xác nhận trong phiên thanh toán này. */
  appliedCode: string | null;
  onApplied: (code: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const shell = (children: React.ReactNode) => (
    <section aria-label="Mã giới thiệu" className={`p-4 ${ui.card} ${mini.band}`}>
      {children}
    </section>
  );

  const fixedCode = linkedCode ? linkedCode.trim().toUpperCase() : appliedCode && !open ? appliedCode : null;
  if (fixedCode) {
    return shell(
      <div className="flex min-h-11 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Tile />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-stone-900">Mã giới thiệu</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <CodeChip code={fixedCode} />
              <span className="text-xs text-success-fg">
                {linkedCode ? 'Bạn đang mua qua link giới thiệu' : 'Mã hợp lệ, đơn này ghi nhận cho người giới thiệu'}
              </span>
            </div>
          </div>
        </div>
        {!linkedCode && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setDraft('');
              setError(null);
              setOpen(true);
            }}
            className={`${ui.btnText} text-forest-700`}
          >
            Đổi
          </button>
        )}
      </div>,
    );
  }

  if (!open) {
    return shell(
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-full items-center justify-between gap-3 text-left disabled:opacity-60"
      >
        <span className="flex min-w-0 items-center gap-3">
          <Tile />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-stone-900">Mã giới thiệu</span>
            <span className="block text-xs text-stone-600">Có người giới thiệu Tubu cho bạn? Nhập mã của họ</span>
          </span>
        </span>
        <span className="flex flex-none items-center gap-0.5 text-xs font-bold text-forest-700">
          Nhập mã
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </span>
      </button>,
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
      setOpen(false);
      onApplied(code);
    } catch (e) {
      setError(e instanceof Error ? e.message : MISS_MESSAGE);
    } finally {
      setChecking(false);
    }
  };

  return shell(
    <form
      className="space-y-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void apply();
      }}
    >
      <label htmlFor="referral-code" className="text-sm font-semibold text-stone-900">
        Mã giới thiệu
      </label>
      <input
        id="referral-code"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError(null);
        }}
        maxLength={64}
        autoCapitalize="characters"
        autoComplete="off"
        placeholder="Nhập mã giới thiệu"
        aria-label="Mã giới thiệu"
        aria-invalid={error ? true : undefined}
        className={error ? ui.fieldError : ui.field}
      />
      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-danger-fg">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} disabled={checking} className={ui.btnSecondary}>
          Huỷ
        </button>
        <button type="submit" disabled={checking} className={`${ui.btnPrimary} flex-1`}>
          {checking ? 'Đang kiểm tra…' : 'Áp dụng'}
        </button>
      </div>
    </form>,
  );
}
