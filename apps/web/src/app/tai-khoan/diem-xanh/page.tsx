'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Check, ChevronRight, Copy, Gift, Leaf, Lightbulb, QrCode as QrCodeIcon } from 'lucide-react';
import { couponsQuery, loyaltyQuery, memberCardQuery, pointsTxnPagesQuery } from '@tubutree/app-core/queries/loyalty';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { wasteMeQuery } from '@tubutree/app-core/queries/waste';
import { pendingPointsBalanceLine } from '@tubutree/app-core/waste-copy';
import { loyaltyOffersRow } from '@tubutree/app-core/loyalty-page';
import { ecoPassportQuery } from '@tubutree/app-core/eco/passport';
import { passportCopy } from '@tubutree/app-core/eco/passport-copy';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { isWebRouteReady } from '@/lib/route-map';
import { formatCount, pointsSummary } from '@/lib/checkout-points';
import { pointsReasonLabel } from '@/lib/ledger-labels';
import { formatDate } from '@/lib/format-date';
import {
  earnRuleLine,
  expiringPointsNote,
  formatMultiplier,
  memberCardHint,
  moneyShort,
  pointExpiryPolicyNote,
  pointsToSpend,
  redeemRuleLine,
  tierProgressPercent,
  tierThresholdLabel,
} from '@/lib/loyalty-copy';
import { ui } from '@/lib/guest-ui';
import { usePressLock } from '@/lib/use-press-lock';
import { GuestTiers } from '@/components/loyalty/guest-tiers';
import { AuthLoading, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { LoyaltyRulesCard } from '@/components/loyalty/loyalty-rules-card';
import { OffersCheckInStrip } from '@/components/offers/offers-check-in-strip';
import { OffersIconTile } from '@/components/offers/offers-icon-tile';
import { QrCode } from '@/components/ui/qr-code';
import { miniBtnSecondary, miniCard, miniSectionTitle, miniSurface } from '@/components/loyalty/mini-surface';
import { LedgerShell, SignedAmount } from '../ledger-shell';
import { loadErrorText } from '@/lib/error-text';
import { tierGraceLine, tierRank } from '@tubutree/app-core/loyalty-tier-copy';
import { tierPerkLabel } from '@tubutree/app-core/number-format';

const TITLE = 'Hạng thành viên & Điểm Xanh';
const TIER_KEY = 'tubu_last_tier_min_v2';

const TIER_STYLES: readonly { emoji: string; bg: string; fg: string }[] = [
  { emoji: '🌱', bg: 'bg-sage-50', fg: 'text-sage-700' },
  { emoji: '🌿', bg: 'bg-sage-100', fg: 'text-sage-600' },
  { emoji: '🌳', bg: 'bg-forest-50', fg: 'text-forest-700' },
  { emoji: '🌲', bg: 'bg-stone-100', fg: 'text-forest-900' },
];
/** Tra theo THỨ HẠNG (không theo tên): đổi tên hạng trong admin vẫn giữ biểu tượng và màu. */
const tierStyleAt = (rank: number) => TIER_STYLES[Math.min(Math.max(rank, 0), TIER_STYLES.length - 1)]!;

const errText = loadErrorText;

export default function LoyaltyPage() {
  const router = useRouter();
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const loyaltyQ = useQuery({ ...loyaltyQuery(coreHttp), enabled: authed, refetchOnWindowFocus: true });
  const couponsQ = useQuery({ ...couponsQuery(coreHttp), enabled: authed });
  const txnQ = useInfiniteQuery({ ...pointsTxnPagesQuery(coreHttp), enabled: authed });
  const configQ = useQuery({ ...publicConfigQuery(coreHttp), enabled: authed });
  const wasteEnabled = configQ.data?.waste?.enabled === true;
  const wasteMeQ = useQuery({ ...wasteMeQuery(coreHttp), enabled: authed && wasteEnabled, retry: false });
  // Chỉ hỏi hộ chiếu khi /config/public báo `ecoPassportEnabled: true` (cùng cách `waste.enabled`): cờ tắt thì trang không phát thêm request 404.
  const passportOn = (configQ.data as { ecoPassportEnabled?: unknown } | undefined)?.ecoPassportEnabled === true;
  const passportQ = useQuery({ ...ecoPassportQuery(coreHttp), enabled: authed && passportOn });

  const loadMore = usePressLock(() => txnQ.fetchNextPage());
  const [showCard, setShowCard] = useState(false);
  // Thẻ thành viên chỉ tải khi khách mở thẻ: bớt một lần gọi mỗi lần vào trang.
  const cardQ = useQuery({ ...memberCardQuery(coreHttp), enabled: authed && showCard });
  const [celebrate, setCelebrate] = useState<string | null>(null);
  const data = loyaltyQ.data;
  const curMin = data?.tiers.find((t) => t.id === data.tier?.id)?.minPoints ?? 0;
  // So hạng hiện tại với lần xem trước: lần đầu chỉ ghi mốc, tránh chúc mừng giả cho khách hạng cao mở trang lần đầu.
  useEffect(() => {
    if (!data?.tier) return;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(TIER_KEY);
    } catch {
      /* không có localStorage: bỏ qua */
    }
    if (raw != null && curMin > Number(raw)) setCelebrate(data.tier.name);
    try {
      localStorage.setItem(TIER_KEY, String(curMin));
    } catch {
      /* không có localStorage: bỏ qua */
    }
  }, [data?.tier, curMin]);

  if (phase === 'loading') {
    return (
      <LedgerShell title={TITLE} wide>
        <AuthLoading />
      </LedgerShell>
    );
  }
  if (phase === 'unavailable') {
    return (
      <LedgerShell title={TITLE} wide>
        <SessionUnavailable />
      </LedgerShell>
    );
  }
  if (phase === 'guest') {
    return (
      <LedgerShell title={TITLE} wide>
        <GuestTiers returnTo="/tai-khoan/diem-xanh" />
      </LedgerShell>
    );
  }
  if (loyaltyQ.isLoading) {
    return (
      <LedgerShell title={TITLE} wide>
        <div className="space-y-3" aria-busy="true">
          <Skeleton height={180} />
          <Skeleton height={80} />
        </div>
      </LedgerShell>
    );
  }
  if (!data) {
    return (
      <LedgerShell title={TITLE} wide>
        <ErrorState message={errText(loyaltyQ.error)} onRetry={() => loyaltyQ.refetch()} />
      </LedgerShell>
    );
  }

  const tierName = data.tier?.name ?? 'Mầm Xanh';
  const tierStyle = tierStyleAt(tierRank(data.tiers, { id: data.tier?.id }));
  const graceLine = tierGraceLine(data.tierGrace, tierName, { money: moneyShort, points: formatCount, date: formatDate });
  const perks = Array.isArray(data.tier?.perks) ? (data.tier.perks as string[]) : [];
  const next = data.nextTier;
  const rates = data.rates;
  const progress = tierProgressPercent(data);
  const lots = pointsSummary(data);
  const pendingWasteLine = pendingPointsBalanceLine(wasteMeQ.data?.pendingPoints);
  const expiring = expiringPointsNote(data.expiringPoints);
  const expiryPolicy = pointExpiryPolicyNote(data.pointExpireMonths);
  const history = txnQ.data?.pages.flat() ?? [];
  const offersRow = loyaltyOffersRow('/uu-dai', couponsQ.data?.length);
  const ruleLines = rates ? [earnRuleLine(rates, data.tier?.multiplier ?? 1), redeemRuleLine(rates)] : [];
  const celebrateStyle = tierStyleAt(celebrate ? tierRank(data.tiers, { name: celebrate }) : 0);

  return (
    <LedgerShell title={TITLE} wide>
      {/* Dòng Hộ chiếu Xanh là một hàng auto nữa ở cột trái: thêm hàng và cho cột phải trải thêm một hàng, để lịch sử vẫn nằm ở hàng 1fr cuối. */}
      <div className={`grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start ${passportQ.isSuccess ? 'lg:grid-rows-[auto_auto_auto_auto_1fr]' : 'lg:grid-rows-[auto_auto_auto_1fr]'}`}>
          <section aria-label="Hạng thành viên" className={`p-5 text-center tabular-nums lg:col-span-2 ${miniSurface} ${tierStyle.bg}`}>
            <div aria-hidden="true" className="text-5xl leading-none max-md:text-[56px]">
              {tierStyle.emoji}
            </div>
            <h2 className={`mt-2 font-display text-xl font-semibold max-md:text-[length:var(--type-title-lg-size)] ${tierStyle.fg}`}>{tierName}</h2>
            <p className="mt-0.5 text-sm text-stone-700">
              Tích điểm ×{formatMultiplier(data.tier?.multiplier ?? 1)} · {formatCount(lots.total)} Điểm Xanh
            </p>
            {lots.convertedNote && <p className="mt-0.5 text-caption text-stone-600">{lots.convertedNote}</p>}
            {pendingWasteLine && <p className="mt-0.5 text-caption tabular-nums text-stone-600">{pendingWasteLine}</p>}
            {expiring && <p className={`mt-1.5 text-caption ${expiring.urgent ? 'font-semibold text-warning-fg' : 'text-stone-600'}`}>{expiring.text}</p>}
            {expiryPolicy && <p className="mt-0.5 text-caption text-stone-600">{expiryPolicy}</p>}

            {next ? (
              <div className="mt-4 text-left">
                <div
                  role="progressbar"
                  aria-label="Tiến độ lên hạng kế"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress}
                  className="h-2.5 overflow-hidden rounded-full bg-stone-0"
                >
                  <div className={`h-full rounded-full bg-current ${tierStyle.fg}`} style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-1.5 text-center text-caption text-stone-700">
                  {next.spendingToGo != null ? (
                    <>
                      Còn <b>{moneyShort(next.spendingToGo)}</b> mua hàng để lên hạng {next.name}
                    </>
                  ) : (
                    <>
                      Còn <b>{formatCount(next.pointsToGo)}</b> điểm tích từ mua hàng
                      {rates && next.pointsToGo > 0 ? ` (tương đương khoảng ${moneyShort(pointsToSpend(next.pointsToGo, rates))} mua hàng)` : ''} để lên hạng{' '}
                      {next.name}
                    </>
                  )}
                </p>
              </div>
            ) : (
              <p className={`mt-3 text-sm ${tierStyle.fg}`}>Bạn đang ở hạng cao nhất 🎉</p>
            )}

            {graceLine && <p className="mt-2 text-caption font-semibold text-warning-fg">{graceLine}</p>}

            <button type="button" onClick={() => setShowCard(true)} className={`${miniBtnSecondary} mt-4 max-w-full gap-2 py-2 text-center`}>
              <QrCodeIcon className="h-4 w-4" aria-hidden="true" />
              Thẻ thành viên số (mã QR)
            </button>
          </section>

          {/* Điểm danh chỉ làm ở Vườn Xanh: trang này chỉ báo hôm nay đã/chưa và mở Vườn Xanh. */}
          {isWebRouteReady('/vuon-xanh') && (
            <OffersCheckInStrip authed={authed} onOpenGarden={() => router.push('/vuon-xanh')} variant="raised" className="lg:col-start-1" />
          )}

          {/* Đổi quà và ví mã nằm ở hub Ưu đãi: một dòng dẫn sang, không lặp danh sách ở đây. */}
          {isWebRouteReady('/uu-dai') && (
            <Link href={offersRow.href} className={`flex min-h-11 items-center gap-3 p-3 hover:bg-stone-50 lg:col-start-1 ${miniCard}`}>
              <OffersIconTile icon={Gift} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-stone-900">{offersRow.title}</span>
                <span className="block text-caption text-stone-600">{offersRow.sub}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-stone-500" aria-hidden="true" />
            </Link>
          )}

          {passportQ.isSuccess && (
            <Link href="/tai-khoan/ho-chieu-xanh" data-testid="eco-passport-entry" className={`flex min-h-11 items-center gap-3 p-3 hover:bg-stone-50 lg:col-start-1 ${miniCard}`}>
              <OffersIconTile icon={Leaf} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-stone-900">{passportCopy('title')}</span>
                <span className="block text-caption text-stone-600">{passportCopy('entrySub')}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-stone-500" aria-hidden="true" />
            </Link>
          )}

          {/* Từ lg: cột trái 2/3 gồm dòng điểm danh, dòng Ưu đãi, lịch sử (xếp tự động nối nhau trong cột 1, nên thẻ nào vắng thì không để lại hàng/khoảng trống; hàng cuối 1fr nhận phần cao dư của cột phải); cột phụ 1/3 bên phải (cách kiếm và dùng, quyền lợi, các hạng) trải qua ba hàng đó; dưới lg thứ tự và khoảng cách như một cột. */}
          <div className={`contents lg:col-start-2 lg:row-start-2 lg:flex lg:min-w-0 lg:flex-col lg:gap-4 ${passportQ.isSuccess ? 'lg:row-span-4' : 'lg:row-span-3'}`}>
          <LoyaltyRulesCard lines={ruleLines} />

          {perks.length > 0 && (
            <Section title="Quyền lợi của bạn">
              <ul className="space-y-2">
                {perks.map((p) => (
                  <li key={p} className="flex items-center gap-2 text-sm text-stone-800">
                    <Check className="h-4 w-4 shrink-0 text-forest-600" aria-hidden="true" />
                    {tierPerkLabel(p)}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <section aria-label="Các hạng" className={`p-4 ${miniCard}`}>
            <h2 className={`mb-3 ${ui.sectionTitle} ${miniSectionTitle}`}>Các hạng</h2>
            <ul className="space-y-1.5">
              {data.tiers.map((t, rank) => {
                const active = data.tier ? t.id === data.tier.id : rank === 0;
                const ts = tierStyleAt(rank);
                return (
                  <li
                    key={t.id}
                    aria-current={active ? 'true' : undefined}
                    className={`flex items-center justify-between gap-2 rounded-control border p-3 ${active ? `${ts.bg} border-forest-600` : 'border-stone-200'}`}
                  >
                    <div className="flex flex-none items-center gap-2">
                      <span aria-hidden="true">{ts.emoji}</span>
                      <span className={`whitespace-nowrap text-sm ${active ? 'font-bold' : ''}`}>{t.name}</span>
                    </div>
                    <span className="min-w-0 text-right text-caption text-stone-700">
                      {tierThresholdLabel(t, rates)} · ×{formatMultiplier(t.multiplier)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
          </div>

          <section aria-label="Lịch sử Điểm Xanh" className={`p-4 tabular-nums lg:col-start-1 ${miniCard}`}>
            <h2 className={`mb-2 ${ui.sectionTitle} ${miniSectionTitle}`}>Lịch sử Điểm Xanh</h2>
            {txnQ.isLoading ? (
              <Skeleton height={64} />
            ) : txnQ.isError && history.length === 0 ? (
              <InlineError message="Không tải được lịch sử Điểm Xanh." onRetry={() => txnQ.refetch()} />
            ) : history.length === 0 ? (
              <p className="py-3 text-center text-sm text-stone-600">Chưa có giao dịch điểm nào.</p>
            ) : (
              <ul className="divide-y divide-stone-200">
                {history.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="break-words text-sm font-medium text-stone-900">{pointsReasonLabel(t.reason)}</div>
                      <div className="text-caption text-stone-600">
                        {formatDate(t.createdAt)}
                        {t.lot === 'CONVERTED' ? ' · Điểm không hết hạn' : ''}
                      </div>
                    </div>
                    <SignedAmount delta={t.delta} text={formatCount(Math.abs(t.delta))} />
                  </li>
                ))}
              </ul>
            )}
            {txnQ.hasNextPage && (
              <button
                type="button"
                aria-busy={txnQ.isFetchingNextPage || loadMore.busy || undefined}
                aria-disabled={txnQ.isFetchingNextPage || loadMore.busy || undefined}
                onClick={() => !txnQ.isFetchingNextPage && loadMore.press()}
                className={`${miniBtnSecondary} mt-3 w-full`}
              >
                {txnQ.isFetchingNextPage ? 'Đang tải…' : txnQ.isFetchNextPageError ? 'Chưa tải được, bấm để thử lại' : 'Xem thêm'}
              </button>
            )}
          </section>
      </div>

      <MemberCardSheet
        open={showCard}
        onClose={() => setShowCard(false)}
        card={cardQ.data}
        loading={cardQ.isLoading}
        error={cardQ.isError ? errText(cardQ.error) : null}
        onRetry={() => cardQ.refetch()}
        tierLabel={`Hạng ${tierName} · ${formatCount(lots.total)} Điểm Xanh`}
        tierEmoji={tierStyle.emoji}
      />

      <Sheet
        open={celebrate !== null}
        onClose={() => setCelebrate(null)}
        title={`Chúc mừng lên hạng ${celebrate ?? ''}!`}
        footer={
          <button type="button" onClick={() => setCelebrate(null)} className={`${ui.btnPrimary} w-full`}>
            Tuyệt vời!
          </button>
        }
      >
        <div className="text-center">
          <div aria-hidden="true" className="text-6xl leading-none">
            {celebrateStyle.emoji}🎉
          </div>
          <p className="mt-2 text-sm text-stone-700">
            Bạn vừa mở khoá quyền lợi mới của hạng {celebrate}. Cảm ơn bạn đã đồng hành sống xanh cùng Tubu 🌿
          </p>
          {perks.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-left">
              {perks.slice(0, 4).map((p) => (
                <li key={p} className="flex items-center gap-2 text-sm text-stone-800">
                  <Check className="h-4 w-4 shrink-0 text-forest-600" aria-hidden="true" />
                  {tierPerkLabel(p)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Sheet>
    </LedgerShell>
  );
}

function MemberCardSheet({
  open,
  onClose,
  card,
  loading,
  error,
  onRetry,
  tierLabel,
  tierEmoji,
}: {
  open: boolean;
  onClose: () => void;
  card: { memberCode: string; posCreditEnabled: boolean } | undefined;
  loading: boolean;
  error: string | null;
  onRetry: () => void | PromiseLike<unknown>;
  tierLabel: string;
  tierEmoji: string;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const copy = async () => {
    if (!card) return;
    try {
      await navigator.clipboard.writeText(card.memberCode);
    } catch {
      setCopyError(true);
      return;
    }
    setCopyError(false);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Thẻ Thành Viên Tubu"
      footer={
        <button type="button" onClick={onClose} className={`${miniBtnSecondary} w-full`}>
          Đóng
        </button>
      }
    >
      <div className="text-center">
        <Badge tone="brand">
          <span aria-hidden="true">{tierEmoji}</span> {tierLabel}
        </Badge>
      </div>
      <div className="mt-4 rounded-card border border-stone-200 bg-stone-50 p-3 text-center">
        {loading ? (
          <div className="flex justify-center">
            <Skeleton width={180} height={180} />
          </div>
        ) : error || !card ? (
          <InlineError message={`Chưa tải được mã thành viên: ${error ?? ''}`} onRetry={onRetry} />
        ) : (
          <>
            <div className="flex justify-center">
              <QrCode value={card.memberCode} size={180} />
            </div>
            <div className="mt-3 flex items-center justify-center gap-2">
              <span className="font-mono text-lg font-bold tracking-widest text-stone-900">{card.memberCode}</span>
              <button type="button" onClick={() => void copy()} className={`${ui.btnText} tubu-press gap-1 text-forest-700 no-underline`}>
                <Copy className="h-4 w-4" aria-hidden="true" />
                {copied ? 'Đã chép' : 'Chép'}
              </button>
            </div>
            <div role="status" className="text-caption">
              {copied && <span className="text-success-fg">Đã sao chép mã thành viên</span>}
              {copyError && <span className="text-danger-fg">Không sao chép được — hãy đọc mã cho nhân viên.</span>}
            </div>
          </>
        )}
      </div>
      {card && (
        <div className="mt-3 flex items-start gap-2 rounded-control bg-stone-100 p-2">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-forest-600" aria-hidden="true" />
          <p className="text-caption text-stone-700">{memberCardHint(card)}</p>
        </div>
      )}
    </Sheet>
  );
}

function Section({ title, action, children, className = '' }: { title: string; action?: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`p-4 ${miniCard} ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className={`${ui.sectionTitle} ${miniSectionTitle}`}>{title}</h2>
        {action && <span className="text-caption text-stone-600">{action}</span>}
      </div>
      {children}
    </section>
  );
}

function InlineError({ message, onRetry }: { message: string; onRetry: () => void | PromiseLike<unknown> }) {
  const retry = usePressLock(onRetry);
  return (
    <div className="text-center">
      <p role="alert" className={ui.error}>
        {message}
      </p>
      <button type="button" aria-busy={retry.busy || undefined} aria-disabled={retry.busy || undefined} onClick={retry.press} className={`${ui.btnText} text-forest-700`}>
        Thử lại
      </button>
    </div>
  );
}
