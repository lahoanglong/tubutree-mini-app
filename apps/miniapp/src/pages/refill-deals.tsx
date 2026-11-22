import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Page, useNavigate } from 'zmp-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { refillLandingBottleCaption, refillLandingCopy, refillLandingFaq, refillLandingIntro, refillLandingQuery, refillLandingRows } from '@tubutree/app-core/refill/refill-landing';
import type { PdpRefillOfferView } from '@tubutree/app-core/refill/refill-saving';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { PdpRefillOffer } from '../components/product/pdp-refill-offer';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { PageHeader } from '../components/ui/page-header';
import { Skeleton } from '../components/ui/skeleton';
import { SR_ONLY } from '../components/ui/sr-only';
import { Heading, Text } from '../components/ui/text';
import { useLoginWithNotice } from '../hooks/use-login-notice';
import { useNotify } from '../hooks/use-notify';
import { vi } from '../i18n/vi';
import { useSmartNavigate } from '../lib/smart-nav';
import { trackEvent } from '../services/analytics';
import { getErrorMessage, getLoadErrorMessage, isStaleStateError } from '../services/api';
import { cartKey } from '../services/cart-key';
import { coreHttp } from '../services/core-http';
import { addToCart } from '../services/shop-api';
import { useAuthStore } from '../store/auth';
import { playCartFeedback } from '../utils/cart-feedback';
import { haptic } from '../utils/haptic';
import { settleWithin } from '../utils/settle-within';

const PAGE_STYLE: CSSProperties = { background: 'var(--color-bg-canvas)', paddingBottom: 'var(--space-stack-xl)' };
const BODY: CSSProperties = { padding: '0 var(--space-inset-page)' };
const STACK: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-inline-md)' };
const LIST: CSSProperties = { ...STACK, listStyle: 'none', margin: 0, padding: 0, fontVariantNumeric: 'tabular-nums' };
const FAQ_BUTTON: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-inline-sm)', width: '100%', padding: 'var(--space-stack-sm) 0',
  background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'var(--color-text-primary)',
};

const addButtonOf = (i: number) => document.querySelector(`[data-refill-row="${i}"] [data-testid="pdp-refill-add"]`);

interface AddVars {
  view: PdpRefillOfferView;
  origin: Element | null;
}

/**
 * "+ Thêm" của các thẻ trên trang: một gói, số lượng 1, một lệnh mỗi lúc cho cả trang (khoá ref đồng bộ, giữ cả lúc mời đăng nhập). Chưa đăng nhập thì mời đăng nhập
 * trước như nút Thêm vào giỏ. Máy chủ từ chối vì trạng thái đã đổi (gói hết hàng, đổi giá) thì giữ khoá tới khi danh sách mới về, kẻo chạm lại nhận đúng lời đó.
 */
function useRefillDealAdd(staleKey: readonly unknown[]) {
  const qc = useQueryClient();
  const { notify } = useNotify();
  const loginWithNotice = useLoginWithNotice();
  const inflight = useRef(false);
  const mutation = useMutation({
    mutationFn: ({ view }: AddVars) => addToCart(view.variationId, 1),
    onSuccess: (cart, { origin }) => {
      qc.setQueryData(cartKey(), cart);
      haptic('medium');
      playCartFeedback(origin?.isConnected ? origin : null);
      notify({ text: vi.product.added, type: 'success', duration: 2000, position: 'top' });
      trackEvent('refill_swap_applied', 'miniapp', { surface: 'landing' });
    },
    onError: (e) => {
      notify({ text: getErrorMessage(e), type: 'error' });
      return isStaleStateError(e) ? settleWithin(qc.invalidateQueries({ queryKey: staleKey })) : undefined;
    },
    onSettled: () => {
      inflight.current = false;
    },
  });
  const add = async (vars: AddVars) => {
    if (inflight.current) return;
    const status = useAuthStore.getState().status;
    if (status === 'loading') return;
    inflight.current = true;
    if (status !== 'authenticated') {
      try {
        await loginWithNotice();
      } catch {
        // Lời báo đã do useLoginWithNotice hiện; chỉ nhả khoá.
      }
      if (useAuthStore.getState().status !== 'authenticated') {
        inflight.current = false;
        return;
      }
    }
    haptic('light');
    mutation.mutate(vars);
  };
  return { add, busyVariationId: mutation.isPending ? (mutation.variables?.view.variationId ?? null) : null };
}

/** Câu hỏi thường gặp, cùng mảng với FAQ trên web (FAQPage): hàng chạm mở/đóng như trang Giới thiệu. */
function RefillDealsFaq() {
  const [open, setOpen] = useState<number | null>(null);
  const items = refillLandingFaq();
  return (
    <section aria-labelledby="refill-faq-title" data-testid="refill-landing-faq" style={{ marginTop: 'var(--space-section)' }}>
      <Heading variant="title-sm" font="ui" as="h2" id="refill-faq-title">
        {refillLandingCopy('faqTitle')}
      </Heading>
      {items.map((item, i) => {
        const expanded = open === i;
        return (
          <div key={item.q} style={{ borderBottom: i < items.length - 1 ? '1px solid var(--color-border-subtle)' : 'none' }}>
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={`refill-faq-${i}`}
              className="tubu-press tubu-hit-44"
              style={FAQ_BUTTON}
              onClick={() => {
                haptic('light');
                setOpen(expanded ? null : i);
              }}
            >
              <Text variant="body-sm" as="span" style={{ fontWeight: 600 }}>
                {item.q}
              </Text>
              <ChevronDown size={16} aria-hidden="true" color="var(--color-text-tertiary)" style={{ flex: '0 0 auto', transform: expanded ? 'rotate(180deg)' : undefined }} />
            </button>
            <div id={`refill-faq-${i}`} hidden={!expanded} style={{ paddingBottom: 'var(--space-stack-sm)' }}>
              <Text variant="body-sm" tone="secondary" as="p">
                {item.a}
              </Text>
            </div>
          </div>
        );
      })}
    </section>
  );
}

/**
 * Tiết kiệm với Refill (lối vào: hub Danh mục, Bộ quà tặng). Mỗi hàng là chai khách đang dùng ("Thay cho …") và thẻ gói Refill cùng số với trang chi tiết chai,
 * "+ Thêm" một chạm. Cùng dữ liệu và luật với web `/tiet-kiem-refill`; giá cuối do giỏ tính lại. `refill_swap_shown` một lần mỗi lượt xem có thẻ (surface `landing`).
 */
export default function RefillDealsPage() {
  const navigate = useNavigate();
  const goSmart = useSmartNavigate();
  const query = refillLandingQuery(coreHttp);
  const q = useQuery(query);
  const rows = refillLandingRows(q.data);
  const refill = useRefillDealAdd(query.queryKey);
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current || rows.length === 0) return;
    shown.current = true;
    trackEvent('refill_swap_shown', 'miniapp', { surface: 'landing' });
  }, [rows.length]);
  const busy = refill.busyVariationId;

  return (
    <Page className="page" style={PAGE_STYLE}>
      <PageHeader title={refillLandingCopy('title')} subtitle={rows.length > 0 ? refillLandingIntro(rows) : undefined} />
      <div style={BODY}>
        <div style={{ marginTop: 'var(--space-stack-md)' }}>
          {q.isLoading ? (
            <div style={STACK} aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={96} radius="var(--radius-card)" />
              ))}
            </div>
          ) : q.isError && !q.data ? (
            <ErrorState variant="inline" message={getLoadErrorMessage(q.error)} onRetry={() => q.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState variant="inline" art="basket" heading={refillLandingCopy('empty')} ctaLabel={fillCopy('flash.emptyCta')} onCta={() => goSmart('/browse')} />
          ) : (
            <section aria-labelledby="refill-landing-list-title" data-testid="refill-landing-list">
              <h2 id="refill-landing-list-title" style={SR_ONLY}>
                {refillLandingCopy('listLabel', { n: rows.length })}
              </h2>
              <ul style={LIST}>
                {rows.map((row, i) => (
                  <li key={row.key} data-refill-row={i} data-testid="refill-landing-row" style={{ minWidth: 0 }}>
                    <Text
                      variant="caption"
                      tone="secondary"
                      as="p"
                      data-testid="refill-landing-bottle"
                      style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {refillLandingBottleCaption(row)}
                    </Text>
                    <PdpRefillOffer
                      view={row.view}
                      surface="landing"
                      busy={busy === row.view.variationId}
                      blocked={busy !== null && busy !== row.view.variationId}
                      onAdd={(v) => void refill.add({ view: v, origin: addButtonOf(i) })}
                      onOpen={(slug) => navigate(`/product/${encodeURIComponent(slug)}`)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        {rows.length > 0 && <RefillDealsFaq />}
      </div>
    </Page>
  );
}
