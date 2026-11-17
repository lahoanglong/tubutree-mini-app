'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { ecoPassportQuery, passportShareText, passportView, type PassportView } from '@tubutree/app-core/eco/passport';
import { passportCopy } from '@tubutree/app-core/eco/passport-copy';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { trackWebEvent } from '@/lib/analytics';
import { useAuthPhase } from '@/lib/auth-phase';
import { ApiError } from '@/lib/client-api';
import { coreHttp } from '@/lib/core-http';
import { loadErrorText } from '@/lib/error-text';
import { ui } from '@/lib/guest-ui';
import { platformBridge } from '@/lib/platform-bridge';
import { LedgerShell } from '../ledger-shell';

const TITLE = passportCopy('title');
const RETURN_TO = '/tai-khoan/ho-chieu-xanh';

/**
 * Hộ chiếu Xanh (cờ `eco.passport_enabled`, chỉ web: xem `gaps` trong route-map.json). Số do `GET /me/eco-passport` tính lúc đọc từ đơn đã giao,
 * Đổi rác đã xong và cây đã cam kết; trang không ghi gì, không phát điểm. Cờ tắt thì API trả 404 và trang báo "chưa mở".
 */
export default function EcoPassportPage() {
  const router = useRouter();
  const phase = useAuthPhase();
  const q = useQuery({ ...ecoPassportQuery(coreHttp), enabled: phase === 'authenticated' });
  const view = q.data ? passportView(q.data) : null;
  const viewed = useRef(false);

  useEffect(() => {
    if (!view || viewed.current) return;
    viewed.current = true;
    trackWebEvent('eco_passport_viewed', { hasData: !view.empty });
  }, [view]);

  if (phase === 'loading') return <Shell><AuthLoading /></Shell>;
  if (phase === 'unavailable') return <Shell><SessionUnavailable /></Shell>;
  if (phase === 'guest') return <Shell><LoginRequired message={passportCopy('login')} returnTo={RETURN_TO} /></Shell>;
  if (q.isPending) {
    return (
      <Shell>
        <div className="space-y-3" aria-busy="true">
          <Skeleton height={128} />
          <Skeleton height={144} />
        </div>
      </Shell>
    );
  }
  if (q.isError || !q.data || !view) {
    const off = q.error instanceof ApiError && q.error.status === 404;
    return (
      <Shell>
        {off ? (
          <ErrorState title={passportCopy('off')} message={passportCopy('offText')} onHome={() => router.push('/')} />
        ) : (
          <ErrorState title={passportCopy('loadError')} message={loadErrorText(q.error)} retryLabel={passportCopy('retry')} onRetry={() => q.refetch()} />
        )}
      </Shell>
    );
  }
  return <Shell>{view.empty ? <PassportEmpty /> : <PassportBody view={view} shareText={passportShareText(q.data)} />}</Shell>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <LedgerShell title={TITLE}>{children}</LedgerShell>;
}

function PassportEmpty() {
  return (
    <div data-testid="eco-passport-empty" className="flex flex-col items-center gap-4 py-12 text-center">
      <p className="max-w-sm text-sm text-[var(--color-text-secondary)]">{passportCopy('emptyText')}</p>
      <Link href="/san-pham?q=refill" className={ui.btnPrimary}>
        {passportCopy('emptyCta')}
      </Link>
    </div>
  );
}

function PassportBody({ view, shareText }: { view: PassportView; shareText: string | null }) {
  const [howOpen, setHowOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const sharing = useRef(false);

  const share = async () => {
    if (!shareText || sharing.current) return;
    sharing.current = true;
    setNote(null);
    try {
      const result = await platformBridge.share({ title: passportCopy('shareTitle'), text: shareText, path: '/' });
      if (result === 'shared' || result === 'copied') trackWebEvent('eco_passport_shared', {});
      if (result === 'copied') setNote(passportCopy('shareCopied'));
      else if (result === 'failed') setNote(passportCopy('shareFailed'));
    } finally {
      sharing.current = false;
    }
  };

  return (
    <div data-testid="eco-passport" className="space-y-4">
      {view.since && <p className="text-xs text-[var(--color-text-secondary)]">{view.since}</p>}

      {view.tiles.length > 0 && (
        <ul className="grid grid-cols-2 gap-2">
          {view.tiles.map((t) => (
            <li key={t.metric} data-metric={t.metric} className="rounded-card bg-[var(--color-bg-surface)] p-3 shadow-card">
              <p className="text-xl font-bold text-[var(--color-text-brand)] tabular-nums">{t.value}</p>
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{t.label}</p>
              {t.sub && <p className="text-xs text-[var(--color-text-tertiary)]">{t.sub}</p>}
            </li>
          ))}
        </ul>
      )}
      {view.none && <p className="text-xs text-[var(--color-text-tertiary)]">{view.none}</p>}

      {view.bars && (
        <section aria-labelledby="eco-chart-title" className="rounded-card bg-[var(--color-bg-surface)] p-3 shadow-card">
          <h2 id="eco-chart-title" className="text-sm font-semibold text-[var(--color-text-primary)]">
            {passportCopy('chartTitle')}
          </h2>
          <div aria-hidden="true" data-testid="eco-chart" className="mt-3 flex h-24 items-end gap-2">
            {view.bars.map((b) => (
              <div key={b.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                <div className="w-full rounded-t bg-[var(--color-action-primary-bg)]" style={{ height: `${b.value > 0 ? Math.max(b.pct, 4) : 0}%` }} />
                <span className="text-xs text-[var(--color-text-tertiary)] tabular-nums">{b.label}</span>
              </div>
            ))}
          </div>
          <table className="sr-only">
            <caption>{passportCopy('chartTitle')}</caption>
            <thead>
              <tr>
                <th scope="col">{passportCopy('chartMonthCol')}</th>
                <th scope="col">{passportCopy('chartCountCol')}</th>
              </tr>
            </thead>
            <tbody>
              {view.bars.map((b) => (
                <tr key={b.month}>
                  <th scope="row">{`${b.month.slice(5)}/${b.month.slice(0, 4)}`}</th>
                  <td>{b.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section aria-labelledby="eco-stamps-title">
        <h2 id="eco-stamps-title" className="text-sm font-semibold text-[var(--color-text-primary)]">
          {passportCopy('stampsTitle')}
        </h2>
        <ul className="mt-2 flex flex-wrap gap-2">
          {view.stamps.map((s) => (
            <li
              key={s.id}
              data-stamp={s.id}
              data-reached={s.reached}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${
                s.reached
                  ? 'bg-[var(--color-status-success-bg)] text-[var(--color-status-success-fg)]'
                  : 'border border-dashed border-[var(--color-border-default)] text-[var(--color-text-tertiary)]'
              }`}
            >
              {s.reached && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
              {s.label}
              <span className="sr-only">, {passportCopy(s.reached ? 'stampDone' : 'stampTodo')}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {shareText && (
          <button type="button" data-testid="eco-passport-share" className={ui.btnSecondary} onClick={() => void share()}>
            {passportCopy('share')}
          </button>
        )}
        <button type="button" data-testid="eco-passport-how" className={`${ui.btnText} text-[var(--color-text-link)]`} onClick={() => setHowOpen(true)}>
          {passportCopy('howOpen')}
        </button>
      </div>
      <p role="status" className="text-xs text-[var(--color-text-secondary)]">
        {note}
      </p>

      <Sheet open={howOpen} onClose={() => setHowOpen(false)} title={passportCopy('howOpen')}>
        <ul className="list-disc space-y-2 pl-5 text-sm text-[var(--color-text-secondary)]">
          {view.how.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      </Sheet>
    </div>
  );
}
