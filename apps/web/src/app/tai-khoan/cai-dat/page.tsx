'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { fetchNotifyPrefs, saveNotifyPrefs, type NotifyPrefs } from '@tubutree/app-core/api/account';
import { applyFontScale, readFontScale, saveFontScale, type FontScale } from '@/components/account/font-scale';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { TitleBand, mini } from '@/components/order-mobile/mobile-ui';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { ui } from '@/lib/guest-ui';
import { platformBridge } from '@/lib/platform-bridge';

const LOAD_FAILED = 'Chưa tải được cài đặt thông báo. Thử lại sau nhé.';
const SAVE_FAILED = 'Chưa lưu được cài đặt. Kiểm tra mạng rồi thử lại.';

const FONT_OPTIONS: { scale: FontScale; label: string; glyph: string }[] = [
  { scale: 'small', label: 'Nhỏ', glyph: 'text-[13px]' },
  { scale: 'normal', label: 'Vừa', glyph: 'text-[15px]' },
  { scale: 'large', label: 'Lớn', glyph: 'text-lg' },
];

/** Cài đặt (cùng nội dung với `settings.tsx` của Mini App): thông báo lưu trên server, cỡ chữ, liên kết hồ sơ/địa chỉ, đăng xuất. */
export default function SettingsPage() {
  const { logout } = useAuth();
  const phase = useAuthPhase();
  const qc = useQueryClient();
  const prefsQ = useQuery({
    queryKey: ['notify-prefs'],
    queryFn: () => fetchNotifyPrefs(coreHttp),
    enabled: phase === 'authenticated',
  });
  // Hiện giá trị mới ngay khi bấm, hoàn lại về dữ liệu server nếu lưu lỗi.
  const [pending, setPending] = useState<NotifyPrefs | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState(false);
  const [fontScale, setFontScale] = useState<FontScale>('normal');

  useEffect(() => {
    let alive = true;
    void readFontScale().then((s) => {
      if (!alive || !s) return;
      setFontScale(s);
      applyFontScale(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  const notify = pending ?? prefsQ.data ?? null;

  // Khoá công tắc khi đang lưu: hai PATCH ngược chiều về lệch thứ tự sẽ làm màn hình khác server.
  const toggle = async (key: keyof NotifyPrefs) => {
    if (!notify || savingRef.current) return;
    savingRef.current = true;
    const before = notify;
    setSaving(true);
    setSaveError(false);
    setPending({ ...before, [key]: !before[key] });
    try {
      qc.setQueryData(['notify-prefs'], await saveNotifyPrefs(coreHttp, { [key]: !before[key] }));
    } catch {
      setSaveError(true);
    } finally {
      setPending(null);
      savingRef.current = false;
      setSaving(false);
    }
  };

  const chooseFont = (scale: FontScale) => {
    setFontScale(scale);
    applyFontScale(scale);
    void saveFontScale(scale);
  };

  const shell = (body: ReactNode) => (
    <main className="mx-auto max-w-3xl px-4 py-6 max-md:max-w-none max-md:px-0 max-md:py-0">
      <TitleBand title="Cài đặt" backHref="/tai-khoan" backLabel="Quay lại tài khoản" />
      <div className="max-md:px-4">{body}</div>
    </main>
  );

  if (phase === 'loading') return shell(<AuthLoading />);
  if (phase === 'unavailable') return shell(<SessionUnavailable />);
  if (phase === 'guest') return shell(<LoginRequired message="Đăng nhập để chỉnh cài đặt của bạn." returnTo="/tai-khoan/cai-dat" />);

  const switchesLocked = !notify || saving;
  return shell(
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      <Section title="Thông báo">
        {platformBridge.oa.available && <FollowOaRow />}
        <div className="min-h-11 border-b border-stone-200 py-2">
          <p className="text-sm text-stone-900 max-md:font-semibold">Cập nhật đơn hàng</p>
          <p className="text-xs text-stone-600 max-md:text-sm">Luôn bật để bạn không lỡ tin giao hàng, hoàn tiền</p>
        </div>
        {prefsQ.isLoading && <Skeleton height={44} style={{ marginTop: 8 }} />}
        <SwitchRow label="Khuyến mãi & mã giảm giá" on={notify?.notifyPromo ?? false} disabled={switchesLocked} onToggle={() => void toggle('notifyPromo')} />
        <SwitchRow
          label="Nhắc nhở Vườn Xanh & tương tác bài viết"
          on={notify?.notifyGarden ?? false}
          disabled={switchesLocked}
          onToggle={() => void toggle('notifyGarden')}
          last
        />
        {prefsQ.isError && !prefsQ.data && (
          <div role="alert" className="mt-2 flex flex-wrap items-center gap-2">
            <p className={ui.error}>{LOAD_FAILED}</p>
            <button type="button" onClick={() => void prefsQ.refetch()} className={`${ui.btnText} min-h-11`}>
              Thử lại
            </button>
          </div>
        )}
        {saveError && (
          <p role="alert" className={`mt-2 ${ui.error}`}>
            {SAVE_FAILED}
          </p>
        )}
      </Section>

      <Section title="Hiển thị · Cỡ chữ">
        <div role="radiogroup" aria-label="Cỡ chữ" className="flex gap-2">
          {FONT_OPTIONS.map(({ scale, label, glyph }) => {
            const active = fontScale === scale;
            return (
              <button
                key={scale}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => chooseFont(scale)}
                className={`min-h-11 flex-1 rounded-control border-[1.5px] px-2 py-2 text-center transition active:scale-95 ${
                  active ? 'border-forest-600 bg-forest-50' : 'border-stone-200 bg-stone-0'
                }`}
              >
                <span className={`block ${glyph} ${active ? 'font-bold text-forest-700' : 'text-stone-700'}`}>A</span>
                <span className="block text-xs text-stone-600">{label}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Tài khoản">
        <LinkRow href="/tai-khoan/ho-so" label="Chỉnh sửa hồ sơ" />
        <LinkRow href="/tai-khoan/dia-chi" label="Sổ địa chỉ" last />
      </Section>

      <div className="flex flex-col justify-end md:col-span-1">
        <button type="button" onClick={() => void logout()} className={`${ui.btnSecondary} w-full ${mini.secondary}`}>
          Đăng xuất
        </button>
        <p className="mt-3 text-center text-xs text-stone-600 max-md:text-[color:var(--color-text-tertiary)]">Tubu Tree · phiên bản 1.0.0</p>
      </div>
    </div>,
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`${ui.card} p-4 ${mini.card}`}>
      <h2 className="mb-2 font-display text-base font-semibold text-stone-900 max-md:font-ui max-md:text-[15px] max-md:font-bold">{title}</h2>
      {children}
    </section>
  );
}

/** Cả hàng là công tắc (vùng chạm >= 44px), không chỉ viên thuốc bên phải. */
function SwitchRow({ label, on, onToggle, disabled, last }: { label: string; on: boolean; onToggle: () => void; disabled?: boolean; last?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onToggle();
      }}
      className={`flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left ${last ? '' : 'border-b border-stone-200'} ${disabled ? 'cursor-default opacity-60' : ''}`}
    >
      <span className="text-sm text-stone-900">{label}</span>
      {/* Trạng thái tắt dùng stone-450 để thanh trượt đạt 3:1 với nền thẻ (WCAG 1.4.11). */}
      <span aria-hidden="true" className={`relative h-[26px] w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-forest-600' : 'bg-stone-450'}`}>
        <span className={`absolute top-[3px] h-5 w-5 rounded-full bg-stone-0 shadow-card transition-all ${on ? 'left-[21px]' : 'left-[3px]'}`} />
      </span>
    </button>
  );
}

/** Web không đọc được trạng thái theo dõi OA nên chỉ mở trang OA (zalo.me) để khách tự bấm Quan tâm. */
function FollowOaRow() {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 border-b border-stone-200 py-2">
      <span className="text-sm text-stone-900">Theo dõi Zalo OA</span>
      <button type="button" onClick={() => void platformBridge.oa.follow()} className={`${ui.btnPrimary} min-h-11`}>
        Theo dõi
      </button>
    </div>
  );
}

function LinkRow({ href, label, last }: { href: string; label: string; last?: boolean }) {
  return (
    <Link href={href} className={`flex min-h-11 items-center justify-between gap-3 py-2 text-sm text-stone-900 hover:text-forest-700 max-md:font-semibold ${last ? '' : 'border-b border-stone-200'}`}>
      {label}
      <ChevronRight className="h-4 w-4 text-stone-500" aria-hidden="true" />
    </Link>
  );
}
