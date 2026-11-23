import { useEffect, useRef, type CSSProperties } from 'react';
import { Page } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { fetchGreenBoxPage, type GreenBoxPage as GreenBoxPageData } from '@tubutree/app-core/api/bundle';
import { greenBoxBarText, greenBoxStepper, greenBoxWebCopy, previewGreenBox, readGreenBox, type GreenBoxStepperView } from '@tubutree/app-core/commerce/green-box';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { HomeQuickAddProvider } from '../components/home/home-quick-add';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Chip } from '../components/ui/chip';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { PageHeader } from '../components/ui/page-header';
import { ProductGrid } from '../components/ui/product-grid';
import { ProgressBar } from '../components/ui/progress-bar';
import { ScrollRow } from '../components/ui/scroll-row';
import { StickyActionBar } from '../components/ui/sticky-action-bar';
import { Heading, Text } from '../components/ui/text';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { useSmartNavigate } from '../lib/smart-nav';
import { trackEvent } from '../services/analytics';
import { getLoadErrorMessage } from '../services/api';
import { useCartKey } from '../services/cart-key';
import { coreHttp } from '../services/core-http';
import { getCart } from '../services/shop-api';

const PAGE_STYLE: CSSProperties = { background: 'var(--color-bg-canvas)', paddingBottom: 'calc(var(--sticky-bar-h, 6rem) + var(--space-stack-md))' };
const BODY: CSSProperties = { padding: '0 var(--space-inset-page)' };
/**
 * Hàng chip dính ngay dưới thanh lùi đặc, cùng cách với Bán chạy nhất: trang không dùng lớp `page` (đệm đầu trang do `PageHeader` lo) nên `top` đo từ mép
 * trên vùng cuộn; ghi `--safe-top`, lớp `sticky-below-back` đẩy xuống dưới thanh lùi khi có nút lùi.
 */
const JUMP_BAR: CSSProperties = { position: 'sticky', top: 'var(--safe-top)', zIndex: 2, background: 'var(--color-bg-canvas)', marginTop: 'var(--space-stack-sm)' };
/** Đệm dọc ≥ 4px để vùng chạm 44px của Chip không bị vùng cuộn cắt. */
const JUMP_ROW: CSSProperties = { display: 'flex', gap: 'var(--space-inline-sm)', padding: 'var(--space-stack-xs) var(--space-inset-page)' };
const STEPS_STYLE: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-inline-xs)', marginTop: 'var(--space-stack-xs)' };

/** Cùng khoá với web `/hop-xanh`: danh sách đổi theo tồn kho nên hỏi lại sau một phút. */
const greenBoxPageQuery = { queryKey: ['bundles', 'green-box'] as const, queryFn: () => fetchGreenBoxPage(coreHttp), staleTime: 60_000 };

const groupAnchor = (categoryId: string | undefined) => `green-box-${categoryId ?? 'other'}`;

/**
 * Cuộn mượt tới một danh mục, đầu mục nằm ngay dưới hàng chip dính: khoảng chừa đo từ chính hàng chip (vị trí dính + chiều cao) lúc chạm, nên đúng cả khi
 * có hay không có nút lùi. Người dùng chọn giảm chuyển động thì nhảy thẳng.
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
 * bậc kế. Cùng `GreenBoxStepper` của web `/hop-xanh`.
 */
function GreenBoxStepper({ view }: { view: GreenBoxStepperView }) {
  return (
    <div data-testid="green-box-stepper" data-done={view.done ? 'true' : 'false'} style={{ marginTop: 'var(--space-stack-sm)' }}>
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
 * Trang ghép Hộp Xanh của Mini App (lối vào: "Ghép thêm" ở dải Hộp Xanh của giỏ), cùng dữ liệu và luật với web `/hop-xanh`: món đủ điều kiện nhóm theo danh mục,
 * nút ＋ trên thẻ thêm vào giỏ thường (giỏ nhanh của Trang chủ, mời đăng nhập khi cần). Thanh đáy đọc tiến độ máy chủ trả trong giỏ. Một nút chính: "Xem giỏ".
 */
export default function GreenBoxPage() {
  const goSmart = useSmartNavigate();
  const q = useQuery(greenBoxPageQuery);
  const page = q.data;
  const enabled = page?.enabled === true && page.tiers.length > 0;

  const viewed = useRef(false);
  useEffect(() => {
    if (!enabled || viewed.current) return;
    viewed.current = true;
    trackEvent('green_box_page_viewed', 'miniapp', {});
  }, [enabled]);

  const title = greenBoxWebCopy('pageTitle');
  if (q.isLoading) {
    return (
      <Page style={PAGE_STYLE}>
        <PageHeader title={title} />
        <div style={{ ...BODY, paddingTop: 'var(--space-stack-sm)' }}>
          <ProductGrid items={[]} variant="grid" loading skeletonCount={6} />
        </div>
      </Page>
    );
  }
  if (q.isError && !page) {
    return (
      <Page style={PAGE_STYLE}>
        <PageHeader title={title} />
        <div style={BODY}>
          <ErrorState variant="inline" message={getLoadErrorMessage(q.error)} onRetry={() => q.refetch()} />
        </div>
      </Page>
    );
  }
  if (!page || !enabled) {
    return (
      <Page style={PAGE_STYLE}>
        <PageHeader title={title} />
        <div style={BODY}>
          <EmptyState variant="inline" art="basket" heading={greenBoxWebCopy('pageClosed')} ctaLabel={fillCopy('flash.emptyCta')} onCta={() => goSmart('/browse')} />
        </div>
      </Page>
    );
  }
  return <GreenBoxBody page={page} title={title} onViewCart={() => goSmart('/cart')} onBrowse={() => goSmart('/browse')} />;
}

function GreenBoxBody({ page, title, onViewCart, onBrowse }: { page: GreenBoxPageData; title: string; onViewCart: () => void; onBrowse: () => void }) {
  const authed = useAuthPhase() === 'authenticated';
  const cartQ = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: authed });
  // Số món và mức giảm do máy chủ tính trên giỏ thật; chưa đăng nhập (hay giỏ chưa về) thì thanh bậc vẽ từ bảng bậc của trang với 0 món.
  const server = readGreenBox(cartQ.data);
  const barText = greenBoxBarText(server);
  const stepper = greenBoxStepper(server ?? previewGreenBox(page.tiers, 0));
  const groups = page.groups.filter((g) => g.products.length > 0);
  const jumpRef = useRef<HTMLDivElement>(null);

  return (
    <HomeQuickAddProvider>
      <Page style={PAGE_STYLE}>
        <PageHeader title={title} />
        <div style={BODY}>
          <Text variant="caption" tone="secondary" as="p" style={{ paddingTop: 'var(--space-stack-xs)' }}>
            {greenBoxWebCopy('pageRule')}
          </Text>
          {stepper && <GreenBoxStepper view={stepper} />}
        </div>
        {groups.length > 1 && (
          <div ref={jumpRef} className="sticky-below-back" style={JUMP_BAR}>
            <ScrollRow label={greenBoxWebCopy('jumpLabel')} style={JUMP_ROW} data-testid="green-box-jump">
              {groups.map((g) => {
                const id = groupAnchor(g.category?.id);
                return (
                  <Chip key={id} count={g.products.length} onPress={() => jumpTo(`${id}-section`, jumpRef.current)}>
                    {g.category?.name ?? greenBoxWebCopy('otherGroup')}
                  </Chip>
                );
              })}
            </ScrollRow>
          </div>
        )}
        <div style={BODY}>
          {groups.length === 0 ? (
            <EmptyState variant="inline" art="basket" heading={greenBoxWebCopy('pageEmpty')} ctaLabel={fillCopy('flash.emptyCta')} onCta={onBrowse} />
          ) : (
            groups.map((g) => {
              const id = groupAnchor(g.category?.id);
              return (
                <section key={id} id={`${id}-section`} aria-labelledby={id} style={{ paddingTop: 'var(--space-stack-md)' }}>
                  <Heading variant="title-sm" font="ui" as="h2" id={id} style={{ paddingBottom: 'var(--space-stack-xs)' }}>
                    {g.category?.name ?? greenBoxWebCopy('otherGroup')}
                  </Heading>
                  <ProductGrid items={g.products} variant="grid" />
                </section>
              );
            })
          )}
        </div>
        <StickyActionBar
          label={title}
          lead={
            <div role="status" data-testid="green-box-bar-text">
              <Text variant="body-sm" as="p" numeric style={{ fontWeight: 600 }}>
                {barText}
              </Text>
            </div>
          }
          primary={
            <Button onPress={onViewCart} data-testid="green-box-view-cart">
              {greenBoxWebCopy('viewCart')}
            </Button>
          }
        />
      </Page>
    </HomeQuickAddProvider>
  );
}
