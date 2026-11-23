'use client';

import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { fetchGreenBoxPage, type GreenBoxPage } from '@tubutree/app-core/api/bundle';
import { greenBoxBarText, greenBoxStepper, greenBoxWebCopy, previewGreenBox, readGreenBox, type GreenBoxStepperView } from '@tubutree/app-core/commerce/green-box';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { HomeQuickAddProvider } from '@/components/home/home-quick-add';
import { EmptyState } from '@/components/empty-state';
import { Badge, Card, Chip, ProductGrid, ProgressBar, ScrollRow, Text } from '@/components/mini';
import { StickyActionBar } from '@/components/sticky-action-bar';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { trackWebEvent } from '@/lib/analytics';
import { useAuthPhase } from '@/lib/auth-phase';
import { useCartKey } from '@/lib/cart-key';
import { coreHttp } from '@/lib/core-http';
import { loadErrorText } from '@/lib/error-text';
import { useGuestCartLines } from '@/lib/guest-cart/use-guest-cart';
import { uiBar } from '@/lib/guest-ui';
import { getCart } from '@/lib/shop-client';

const GRID = 'grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-5';
const STEPS_STYLE: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-inline-xs)', marginTop: 'var(--space-stack-xs)' };

const groupAnchor = (categoryId: string | undefined) => `hop-xanh-${categoryId ?? 'other'}`;

/**
 * Cuộn mượt tới một danh mục, đầu mục nằm ngay dưới hàng chip dính: khoảng chừa đo từ chính khối dính (vị trí dính + chiều cao) lúc chạm, nên đúng ở cả
 * điện thoại (dưới nút lùi) lẫn từ md (dưới thanh đầu trang, kèm thanh đếm). Người dùng chọn giảm chuyển động thì nhảy thẳng. Cùng `jumpTo` của Mini App.
 */
function jumpTo(id: string, bar: HTMLElement | null) {
  const el = document.getElementById(id);
  if (!el) return;
  if (bar) el.style.scrollMarginTop = `${Math.ceil((Number.parseFloat(getComputedStyle(bar).top) || 0) + bar.offsetHeight)}px`;
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

/**
 * Thanh nhiều bậc: mỗi bậc của bảng máy chủ là một đoạn đầy dần theo số món, dưới đoạn là "3 món · -3%". Dòng trên: số món còn thiếu và nhãn mức giảm của
 * bậc kế. Cùng `GreenBoxStepper` của Mini App `/green-box`.
 */
function GreenBoxStepper({ view }: { view: GreenBoxStepperView }) {
  return (
    <div data-testid="green-box-stepper" data-done={view.done ? 'true' : 'false'} className="mt-3 md:max-w-xl">
      <Card variant="flat" padding={12} style={{ background: 'var(--color-bg-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-inline-sm)' }}>
          <Text variant="body-sm" as="p" numeric style={{ fontWeight: 600, minWidth: 0 }} data-testid="green-box-stepper-text">
            {view.text}
          </Text>
          <span style={{ flex: '0 0 auto', display: 'inline-flex' }}>
            <Badge tone={view.done ? 'success' : 'promo'} size="sm">
              {view.badge}
            </Badge>
          </span>
        </div>
        <ol aria-label={greenBoxWebCopy('stepperLabel')} style={{ ...STEPS_STYLE, gridTemplateColumns: `repeat(${view.steps.length}, minmax(0, 1fr))` }}>
          {view.steps.map((s) => (
            <li key={s.minItems} data-testid="green-box-step" data-reached={s.reached ? 'true' : 'false'} style={{ minWidth: 0 }}>
              <ProgressBar value={s.fill} max={100} ariaLabel={s.spoken} />
              <Text
                variant="caption"
                tone={s.reached ? 'brand' : 'secondary'}
                as="p"
                numeric
                style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-inline-xs)', marginTop: 'var(--space-stack-xs)', whiteSpace: 'nowrap', overflow: 'hidden' }}
              >
                <span aria-hidden="true">{s.itemsText}</span>
                <span aria-hidden="true" style={{ fontWeight: 700 }}>
                  {s.pctText}
                </span>
              </Text>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

/**
 * Trang ghép Hộp Xanh của web: món đủ điều kiện nhóm theo danh mục, nút ＋ thêm vào giỏ thường (khách chưa đăng nhập dùng giỏ khách khi cờ bật, như
 * Trang chủ). Thanh đáy và thanh bậc đọc tiến độ máy chủ trả trong giỏ; giỏ khách chưa được máy chủ tính nên bậc là bản xem trước tự tính từ số món
 * ("dự kiến giảm", không hứa số tiền). Một nút chính: "Xem giỏ".
 */
export default function GreenBoxView({ initial }: { initial?: GreenBoxPage }) {
  const q = useQuery({
    queryKey: ['bundles', 'green-box'],
    queryFn: () => fetchGreenBoxPage(coreHttp),
    staleTime: 60_000,
    // Bản máy chủ (ISR 5 phút) vẽ ngay rồi hỏi lại một lần khi mở: danh sách đổi theo tồn kho.
    ...(initial ? { initialData: initial, initialDataUpdatedAt: 0 } : {}),
  });
  const page = q.data;
  const enabled = page?.enabled === true && page.tiers.length > 0;

  const viewed = useRef(false);
  useEffect(() => {
    if (!enabled || viewed.current) return;
    viewed.current = true;
    trackWebEvent('green_box_page_viewed', {});
  }, [enabled]);

  const title = greenBoxWebCopy('pageTitle');
  if (q.isLoading) {
    return (
      <>
        <PageHeader title={title} backHref="/" />
        <ProductGrid items={[]} variant="grid" loading skeletonCount={8} className={`${GRID} pt-3`} />
      </>
    );
  }
  if (q.isError && !page) {
    return (
      <>
        <PageHeader title={title} backHref="/" />
        <ErrorState message={loadErrorText(q.error)} onRetry={() => q.refetch()} />
      </>
    );
  }
  if (!page || !enabled) {
    return (
      <>
        <PageHeader title={title} backHref="/" />
        <EmptyState title={greenBoxWebCopy('pageClosed')} actionHref="/san-pham" actionLabel={fillCopy('flash.emptyCta')} />
      </>
    );
  }
  return <GreenBoxBody page={page} title={title} />;
}

function GreenBoxBody({ page, title }: { page: GreenBoxPage; title: string }) {
  const authed = useAuthPhase() === 'authenticated';
  const cartQ = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: authed });
  const guestLines = useGuestCartLines();
  const slugs = useMemo(() => new Set(page.groups.flatMap((g) => g.products.map((p) => p.slug))), [page.groups]);
  // Khách đã đăng nhập: số món và mức giảm máy chủ tính trên giỏ thật (giỏ chưa về thì 0 món). Khách chưa đăng nhập: bậc xem trước từ số sản phẩm khác
  // nhau của trang đã có trong giỏ khách (hai phân loại một sản phẩm tính 1, như máy chủ), theo bảng bậc của trang.
  const server = authed ? readGreenBox(cartQ.data) : null;
  const guestItems = authed ? 0 : new Set(guestLines.filter((l) => slugs.has(l.slug)).map((l) => l.slug)).size;
  const state = server ?? previewGreenBox(page.tiers, guestItems);
  const barText = greenBoxBarText(state, { preview: !server });
  const stepper = greenBoxStepper(state);
  const groups = page.groups.filter((g) => g.products.length > 0);
  const jumpRef = useRef<HTMLDivElement>(null);

  const bar = (
    <>
      <p data-testid="green-box-bar-text" role="status" className="min-w-0 flex-[1000_1_0%] text-sm font-semibold tabular-nums text-[color:var(--color-text-primary)]">
        {barText}
      </p>
      <Link href="/gio-hang" className={`${uiBar.primary} flex-[1_0_9.25rem]`}>
        {greenBoxWebCopy('viewCart')}
      </Link>
    </>
  );

  return (
    <HomeQuickAddProvider>
      <PageHeader title={title} backHref="/" />
      <p className="pt-2 text-caption text-[color:var(--color-text-secondary)]">{greenBoxWebCopy('pageRule')}</p>
      {stepper && <GreenBoxStepper view={stepper} />}
      {/* Một khối dính: ở điện thoại là hàng chip danh mục (dưới nút lùi), từ md thêm thanh đếm phía trên (thanh đáy chỉ có ở điện thoại). */}
      <div
        ref={jumpRef}
        className={`tubu-bleed sticky-below-back sticky top-[var(--safe-top)] z-[2] mt-3 bg-[var(--color-bg-canvas)] md:top-[var(--header-h)] md:-mx-6 md:px-6 ${groups.length > 1 ? '' : 'hidden md:block'}`}
      >
        <div className="hidden items-center gap-3 py-2 md:flex">{bar}</div>
        {groups.length > 1 && (
          <ScrollRow label={greenBoxWebCopy('jumpLabel')} className="flex gap-2 px-4 py-1 md:px-0" data-testid="green-box-jump">
            {groups.map((g) => {
              const id = groupAnchor(g.category?.id);
              return (
                <Chip key={id} count={g.products.length} onPress={() => jumpTo(`${id}-section`, jumpRef.current)}>
                  {g.category?.name ?? greenBoxWebCopy('otherGroup')}
                </Chip>
              );
            })}
          </ScrollRow>
        )}
      </div>
      {groups.length === 0 ? (
        <EmptyState title={greenBoxWebCopy('pageEmpty')} actionHref="/san-pham" actionLabel={fillCopy('flash.emptyCta')} />
      ) : (
        groups.map((g) => {
          const id = groupAnchor(g.category?.id);
          return (
            <section key={id} id={`${id}-section`} aria-labelledby={id} className="pt-4">
              <h2 id={id} className="pb-2 font-display text-base font-semibold text-[color:var(--color-text-primary)]">
                {g.category?.name ?? greenBoxWebCopy('otherGroup')}
              </h2>
              <ProductGrid items={g.products} variant="grid" className={GRID} />
            </section>
          );
        })
      )}
      <StickyActionBar label={greenBoxWebCopy('pageTitle')}>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">{bar}</div>
      </StickyActionBar>
    </HomeQuickAddProvider>
  );
}
