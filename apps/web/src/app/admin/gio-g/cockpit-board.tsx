'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { loadErrorText } from '@/lib/admin-error-text';
import { formatDateTime } from '@/lib/format-date';
import { ADMIN_TABULAR } from '@/components/admin/tabular-nums';
import { BTN_SECONDARY, ListSkeleton, LoadError, Notice, ToneBadge } from '@/components/admin/ui';
import { cardFixLinks, getCockpit, rowFixLink, type CheckStatus, type CockpitCard, type CockpitRow, type GoLiveCockpit } from './golive-api';
import { HandoverCard } from './handover-card';

export const COCKPIT_KEY = ['admin', 'golive', 'cockpit'] as const;

const STATUS_TONE = { PASS: 'success', WARN: 'warning', FAIL: 'danger' } as const satisfies Record<CheckStatus, 'success' | 'warning' | 'danger'>;
const STATUS_LABEL: Record<CheckStatus, string> = { PASS: 'Đạt', WARN: 'Cần xem', FAIL: 'Chặn mở bán' };
const CARD_BORDER: Record<CheckStatus, string> = { PASS: 'border-success-fg', WARN: 'border-warning-fg', FAIL: 'border-danger-fg' };

/** Bảng 6 thẻ xanh/vàng/đỏ. Máy chủ giữ kết quả 15 giây; "Kiểm lại" bỏ qua bộ nhớ đó và chạy lại cả bộ kiểm. */
export function CockpitBoard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: COCKPIT_KEY, queryFn: () => getCockpit() });
  const recheck = useMutation({
    mutationFn: () => getCockpit(true),
    onSuccess: (data) => qc.setQueryData<GoLiveCockpit>(COCKPIT_KEY, data),
  });

  if (q.isPending) return <ListSkeleton label="Đang chạy bảng kiểm Giờ G" rows={6} className="h-40" />;
  if (q.isError) return <LoadError message={loadErrorText(q.error)} onRetry={() => q.refetch()} retrying={q.isFetching} />;

  const { summary, cards, generatedAt } = q.data;
  const busy = recheck.isPending || q.isFetching;
  return (
    <section aria-labelledby="gio-g-board" className={ADMIN_TABULAR}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="gio-g-board" className="font-display text-base font-semibold">
          Sẵn sàng mở bán
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-xs text-stone-600">
          <span>Kiểm lúc {formatDateTime(generatedAt)}</span>
          <button type="button" className={BTN_SECONDARY} disabled={busy} aria-busy={busy || undefined} onClick={() => recheck.mutate()}>
            {busy ? 'Đang kiểm…' : 'Kiểm lại'}
          </button>
        </div>
      </div>
      <div className="mt-2" data-testid="gio-g-summary">
        <Overall summary={summary} />
      </div>
      {recheck.isError ? (
        <div className="mt-2">
          <Notice tone="danger" role="alert">
            Kiểm lại không chạy được: {loadErrorText(recheck.error)}
          </Notice>
        </div>
      ) : null}
      {q.data.handover ? (
        <div className="mt-3">
          <HandoverCard board={q.data.handover} />
        </div>
      ) : null}
      <ul className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <li key={c.key}>
            <Card card={c} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Overall({ summary }: { summary: GoLiveCockpit['summary'] }) {
  const counts = `${summary.fail} đỏ, ${summary.warn} vàng, ${summary.pass} xanh`;
  if (summary.fail > 0)
    return (
      <Notice tone="danger" role="status">
        Chưa mở bán được: còn {summary.fail} mục đỏ. ({counts})
      </Notice>
    );
  if (summary.warn > 0)
    return (
      <Notice tone="warning" role="status">
        Mở bán được, còn {summary.warn} mục vàng cần người phụ trách xác nhận. ({counts})
      </Notice>
    );
  return (
    <Notice tone="success" role="status">
      Mọi mục đều xanh. ({counts})
    </Notice>
  );
}

function Card({ card }: { card: CockpitCard }) {
  const links = cardFixLinks(card.key);
  const open = card.rows.filter((r) => r.status !== 'PASS');
  const passed = card.rows.filter((r) => r.status === 'PASS');
  return (
    <article data-testid={`gio-g-card-${card.key}`} data-status={card.status} className={`h-full rounded-card border-l-4 bg-stone-0 p-3 shadow-card ${CARD_BORDER[card.status]}`}>
      <header className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 break-words text-sm font-semibold text-stone-900">{card.title}</h3>
        <ToneBadge tone={STATUS_TONE[card.status]}>{STATUS_LABEL[card.status]}</ToneBadge>
      </header>
      <p className="mt-1 text-xs text-stone-600">
        <span className="text-danger-fg">{card.counts.FAIL} đỏ</span> · <span className="text-warning-fg">{card.counts.WARN} vàng</span> ·{' '}
        <span className="text-success-fg">{card.counts.PASS} xanh</span>
      </p>
      {card.metrics.length > 0 ? (
        <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 text-xs">
          {card.metrics.map((m) => (
            <div key={m.label} className="contents">
              <dt className="min-w-0 break-words text-stone-600">{m.label}</dt>
              <dd className="text-right font-medium text-stone-900">{m.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {open.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {open.map((r) => (
            <OpenRow key={r.id} row={r} card={card} />
          ))}
        </ul>
      ) : null}
      {passed.length > 0 ? (
        <details className="mt-2 text-xs text-stone-600">
          <summary className="min-h-[44px] cursor-pointer py-2 sm:min-h-0 sm:py-1">{passed.length} mục đạt</summary>
          <ul className="mt-1 space-y-0.5">
            {passed.map((r) => (
              <li key={r.id} className="break-words">
                {r.title}: {r.detail}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-x-4">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="inline-flex min-h-[44px] items-center text-xs font-medium text-forest-700 underline sm:min-h-0">
            Mở {l.label}
          </Link>
        ))}
      </div>
    </article>
  );
}

function OpenRow({ row, card }: { row: CockpitRow; card: CockpitCard }) {
  const fix = rowFixLink(row, card.key);
  return (
    <li data-testid="gio-g-row" data-check={row.id} className="rounded-control bg-stone-50 px-2 py-1.5 text-xs">
      <div className="flex items-start gap-1.5">
        <ToneBadge tone={STATUS_TONE[row.status]}>{row.status === 'FAIL' ? 'Đỏ' : 'Vàng'}</ToneBadge>
        <span className="min-w-0 break-words font-medium text-stone-900">{row.title}</span>
      </div>
      <p className="mt-0.5 break-words text-stone-700">{row.detail}</p>
      {row.hint ? <p className="mt-0.5 break-words text-stone-600">{row.hint}</p> : null}
      {fix ? (
        <Link href={fix.href} className="mt-0.5 inline-flex min-h-[44px] items-center font-medium text-forest-700 underline sm:min-h-0">
          Sửa ở {fix.label}
        </Link>
      ) : (
        <p className="mt-0.5 text-stone-500">Sửa trên máy chủ (biến môi trường, Redis, backup hoặc migration).</p>
      )}
    </li>
  );
}
