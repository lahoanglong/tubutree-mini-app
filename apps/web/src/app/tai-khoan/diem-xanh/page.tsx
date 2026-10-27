'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronRight, Copy, Gift, Lightbulb, QrCode as QrCodeIcon, Recycle, Sprout } from 'lucide-react';
import type { CouponDTO } from '@tubutree/app-core/api/loyalty';
import { couponsQuery, loyaltyQuery, memberCardQuery, pointsTxnQuery } from '@tubutree/app-core/queries/loyalty';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { wasteRequestsQuery } from '@tubutree/app-core/queries/waste';
import { wasteHistoryMenu } from '@tubutree/app-core/waste-copy';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { isWebRouteReady } from '@/lib/route-map';
import { formatCount, pointsSummary } from '@/lib/checkout-points';
import { pointsReasonLabel } from '@/lib/ledger-labels';
import { formatDate } from '@/lib/format-date';
import { formatVnd } from '@/lib/format-vnd';
import { autoCouponName } from '@/lib/coupon-name';
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
import { GuestTiers } from '@/components/loyalty/guest-tiers';
import { AuthLoading, SessionUnavailable } from '@/components/login-required';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { CouponActions } from '@/components/loyalty/coupon-actions';
import { DailyCheckInCard } from '@/components/loyalty/daily-check-in-card';
import { QrCode } from '@/components/ui/qr-code';
import { miniBtnSecondary, miniCard, miniSectionTitle, miniSurface } from '@/components/loyalty/mini-surface';
import { LedgerShell, SignedAmount } from '../ledger-shell';
import { loadErrorText } from '@/lib/error-text';

const TITLE = 'Hạng thành viên & Điểm Xanh';
const TIER_KEY = 'tubu_last_tier_min_v2';

const TIER_STYLE: Record<string, { emoji: string; bg: string; fg: string }> = {
  'Mầm Xanh': { emoji: '🌱', bg: 'bg-sage-50', fg: 'text-sage-700' },
  'Lộc Biếc': { emoji: '🌿', bg: 'bg-sage-100', fg: 'text-sage-600' },
  'Đại Thụ': { emoji: '🌳', bg: 'bg-forest-50', fg: 'text-forest-700' },
  'Cổ Thụ': { emoji: '🌲', bg: 'bg-stone-100', fg: 'text-forest-900' },
};
const DEFAULT_STYLE = TIER_STYLE['Mầm Xanh']!;

const errText = loadErrorText;

function couponLabel(c: CouponDTO): string {
  if (c.type === 'FREESHIP') return 'Miễn phí giao hàng';
  if (c.type === 'PERCENT') return `Giảm ${c.value}%${c.maxDiscount ? ` (tối đa ${formatVnd(c.maxDiscount)})` : ''}`;
  return `Giảm ${formatVnd(c.value)}`;
}

export default function LoyaltyPage() {
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const loyaltyQ = useQuery({ ...loyaltyQuery(coreHttp), enabled: authed, refetchOnWindowFocus: true });
  const couponsQ = useQuery({ ...couponsQuery(coreHttp), enabled: authed });
  const txnQ = useQuery({ ...pointsTxnQuery(coreHttp), enabled: authed });
  const cardQ = useQuery({ ...memberCardQuery(coreHttp), enabled: authed });
  const configQ = useQuery({ ...publicConfigQuery(coreHttp), enabled: authed });
  // Chương trình tắt mà khách từng có yêu cầu thì vẫn cho xem lại (không tạo mới được).
  const wasteOff = configQ.data != null && configQ.data.waste?.enabled !== true;
  const wasteHistoryQ = useQuery({ ...wasteRequestsQuery(coreHttp), enabled: authed && wasteOff, retry: false });
  const hasWasteHistory = (wasteHistoryQ.data?.length ?? 0) > 0;

  const [showCard, setShowCard] = useState(false);
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
        <div className="space-y-3">
          <Skeleton height={180} />
          <Skeleton height={80} />
        </div>
      </LedgerShell>
    );
  }
  if (!data) {
    return (
      <LedgerShell title={TITLE} wide>
        <ErrorState message={errText(loyaltyQ.error)} onRetry={() => void loyaltyQ.refetch()} />
      </LedgerShell>
    );
  }

  const tierName = data.tier?.name ?? 'Mầm Xanh';
  const tierStyle = data.tier ? (TIER_STYLE[data.tier.name] ?? DEFAULT_STYLE) : DEFAULT_STYLE;
  const perks = Array.isArray(data.tier?.perks) ? (data.tier.perks as string[]) : [];
  const next = data.nextTier;
  const rates = data.rates;
  const progress = tierProgressPercent(data);
  const lots = pointsSummary(data);
  const expiring = expiringPointsNote(data.expiringPoints);
  const expiryPolicy = pointExpiryPolicyNote(data.pointExpireMonths);
  const wasteOn = configQ.data?.waste?.enabled === true;
  const shortcuts = [
    { href: '/vuon-xanh', icon: Sprout, title: 'Vườn Xanh', sub: 'Chăm cây nhận quà', show: isWebRouteReady('/vuon-xanh') },
    { href: '/doi-rac', icon: Recycle, title: 'Đổi rác lấy quà', sub: 'Đổi bao bì lấy Điểm Xanh', show: wasteOn && isWebRouteReady('/doi-rac') },
    { href: '/doi-rac/yeu-cau', icon: Recycle, title: wasteHistoryMenu.label, sub: wasteHistoryMenu.hint, show: wasteOff && hasWasteHistory && isWebRouteReady('/doi-rac/yeu-cau') },
    { href: '/kho-qua', icon: Gift, title: 'Kho quà', sub: 'Đổi Điểm Xanh lấy mã giảm giá và quà', show: isWebRouteReady('/kho-qua') },
  ].filter((s) => s.show);
  const celebrateStyle = celebrate ? (TIER_STYLE[celebrate] ?? DEFAULT_STYLE) : DEFAULT_STYLE;

  return (
    <LedgerShell title={TITLE} wide>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:grid-rows-[auto_auto_auto_1fr] lg:items-start">
          <section aria-label="Hạng thành viên" className={`p-5 text-center lg:col-span-2 ${miniSurface} ${tierStyle.bg}`}>
            <div aria-hidden="true" className="text-5xl leading-none max-md:text-[56px]">
              {tierStyle.emoji}
            </div>
            <h2 className={`mt-2 font-display text-xl font-semibold max-md:text-[length:var(--type-title-lg-size)] ${tierStyle.fg}`}>{tierName}</h2>
            <p className="mt-0.5 text-sm text-stone-700">
              Tích điểm ×{formatMultiplier(data.tier?.multiplier ?? 1)} · {formatCount(lots.total)} Điểm Xanh
            </p>
            {lots.convertedNote && <p className="mt-0.5 text-caption text-stone-600">{lots.convertedNote}</p>}
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

            {rates && (
              <div className="mt-3 space-y-0.5 text-caption text-stone-600">
                <p>{earnRuleLine(rates, data.tier?.multiplier ?? 1)}</p>
                <p>{redeemRuleLine(rates)}</p>
              </div>
            )}

            <button type="button" onClick={() => setShowCard(true)} className={`${miniBtnSecondary} mt-4 max-w-full gap-2 py-2 text-center`}>
              <QrCodeIcon className="h-4 w-4" aria-hidden="true" />
              Thẻ thành viên số (mã QR)
            </button>
          </section>

          <Section className="lg:col-start-1" title="Mã giảm giá của tôi" action={couponsQ.data && couponsQ.data.length > 0 ? `${couponsQ.data.length} mã` : undefined}>
            {couponsQ.isLoading ? (
              <Skeleton height={64} />
            ) : couponsQ.isError ? (
              <InlineError message={`Chưa tải được mã giảm giá: ${errText(couponsQ.error)}`} onRetry={() => void couponsQ.refetch()} />
            ) : couponsQ.data && couponsQ.data.length > 0 ? (
              <ul className="space-y-2">
                {couponsQ.data.map((c) => (
                  <li key={c.code} className="rounded-control border border-dashed border-stone-450 bg-promo-bg p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-promo-fg">{couponLabel(c)}</div>
                        <div className="break-words text-caption text-stone-700">
                          {autoCouponName(c.code) ?? `Mã ${c.code}`}
                          {c.minOrder ? ` · đơn từ ${formatVnd(c.minOrder)}` : ''}
                        </div>
                      </div>
                      <div className="shrink-0 text-caption text-stone-600">HSD {formatDate(c.endAt)}</div>
                    </div>
                    <div className="mt-2.5">
                      <CouponActions code={c.code} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-3 text-center text-sm text-stone-600">
                <span className="block font-semibold text-stone-800">Chưa có mã giảm giá khả dụng</span>
                Đổi Điểm Xanh ở mục bên dưới để nhận mã.
              </p>
            )}
          </Section>

          <div className="contents empty:hidden lg:col-start-1 lg:block">
            <DailyCheckInCard authed={authed} />
          </div>

          {/* Từ lg: cột trái 2/3 gồm mã giảm giá, điểm danh, lịch sử (xếp tự động nối nhau trong cột 1, nên thẻ nào vắng thì không để lại hàng/khoảng trống; hàng cuối 1fr nhận phần cao dư của cột phải); cột phụ 1/3 bên phải (lối tắt, quyền lợi, các hạng) trải qua ba hàng đó; dưới lg thứ tự và khoảng cách như một cột. */}
          <div className="contents lg:col-start-2 lg:row-span-3 lg:row-start-2 lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
          {shortcuts.length > 0 && (
            <ul className={`divide-y divide-stone-200 ${miniCard}`}>
              {shortcuts.map((s) => (
                <li key={s.href}>
                  <Link href={s.href} className="flex min-h-11 items-center gap-3 p-3 hover:bg-stone-50">
                    <IconTile>
                      <s.icon className="h-4 w-4 text-forest-600" aria-hidden="true" />
                    </IconTile>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-stone-900">{s.title}</span>
                      <span className="block text-caption text-stone-600">{s.sub}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-stone-500" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {perks.length > 0 && (
            <Section title="Quyền lợi của bạn">
              <ul className="space-y-2">
                {perks.map((p) => (
                  <li key={p} className="flex items-center gap-2 text-sm text-stone-800">
                    <Check className="h-4 w-4 shrink-0 text-forest-600" aria-hidden="true" />
                    {p}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <section aria-label="Các hạng" className={`p-4 ${miniCard}`}>
            <h2 className={`mb-3 ${ui.sectionTitle} ${miniSectionTitle}`}>Các hạng</h2>
            <ul className="space-y-1.5">
              {data.tiers.map((t) => {
                const active = t.name === tierName;
                const ts = TIER_STYLE[t.name] ?? DEFAULT_STYLE;
                return (
                  <li
                    key={t.id}
                    aria-current={active ? 'true' : undefined}
                    className={`flex items-center justify-between gap-2 rounded-control border p-3 ${active ? `${ts.bg} border-forest-600` : 'border-stone-200'}`}
                  >
                    <div className="flex items-center gap-2">
                      <span aria-hidden="true">{ts.emoji}</span>
                      <span className={`text-sm ${active ? 'font-bold' : ''}`}>{t.name}</span>
                    </div>
                    <span className="text-right text-caption text-stone-700">
                      {tierThresholdLabel(t, rates)} · ×{formatMultiplier(t.multiplier)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
          </div>

          <section aria-label="Lịch sử Điểm Xanh" className={`p-4 lg:col-start-1 ${miniCard}`}>
            <h2 className={`mb-2 ${ui.sectionTitle} ${miniSectionTitle}`}>Lịch sử Điểm Xanh</h2>
            {txnQ.isLoading ? (
              <Skeleton height={64} />
            ) : txnQ.isError ? (
              <InlineError message="Không tải được lịch sử Điểm Xanh." onRetry={() => void txnQ.refetch()} />
            ) : !txnQ.data || txnQ.data.length === 0 ? (
              <p className="py-3 text-center text-sm text-stone-600">Chưa có giao dịch điểm nào.</p>
            ) : (
              <ul className="divide-y divide-stone-200">
                {txnQ.data.slice(0, 20).map((t) => (
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
          </section>
      </div>

      <div className="mt-6 flex justify-center">
        <Link href={isWebRouteReady('/san-pham') ? '/san-pham' : '/'} className={miniBtnSecondary}>
          Mua sắm để tích thêm Điểm Xanh →
        </Link>
      </div>

      <MemberCardSheet
        open={showCard}
        onClose={() => setShowCard(false)}
        card={cardQ.data}
        loading={cardQ.isLoading}
        error={cardQ.isError ? errText(cardQ.error) : null}
        onRetry={() => void cardQ.refetch()}
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
                  {p}
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
  onRetry: () => void;
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
              <button type="button" onClick={() => void copy()} className={`${ui.btnText} gap-1 text-forest-700 no-underline`}>
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

function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="text-center">
      <p className={ui.error}>{message}</p>
      <button type="button" onClick={onRetry} className={`${ui.btnText} text-forest-700`}>
        Thử lại
      </button>
    </div>
  );
}

function IconTile({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-stone-100">{children}</span>;
}
