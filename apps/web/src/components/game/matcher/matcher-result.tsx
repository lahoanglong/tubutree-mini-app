'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { addCartItemsBatch } from '@tubutree/app-core/api/cart';
import {
  MATCHER_PATH,
  matcherCartLines,
  matcherItemView,
  matcherTotal,
  matcherWhy,
  type MatcherResult,
} from '@tubutree/app-core/game-mini/matcher';
import { matcherCopy } from '@tubutree/app-core/game-mini/matcher-copy';
import { Button, Heading, Money, ProductTile, Text } from '@/components/mini';
import { trackWebEvent } from '@/lib/analytics';
import { useAuthPhase } from '@/lib/auth-phase';
import { cartStorefrontSlug } from '@/lib/cart-key';
import { coreHttp } from '@/lib/core-http';
import { playCartFeedback } from '@/lib/cart-feedback';
import { guestCartFlagNow } from '@/lib/guest-cart/flag';
import { addGuestLine, GUEST_CART_MAX_LINES, readGuestCart } from '@/lib/guest-cart/store';
import { loginHref } from '@/lib/return-to';
import { clearPendingMatcher, savePendingMatcher } from './matcher-pending';

const CART_PATH = '/gio-hang';

type AddState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'added'; n: number } | { kind: 'error'; text: string };

/** Thêm từng món vào giỏ khách (trình duyệt). Giỏ không đủ chỗ cho cả bộ thì không thêm món nào: bộ là một quyết định, không nửa vời. */
function addToGuestCart(result: MatcherResult): 'ok' | 'full' | 'storage' {
  const have = readGuestCart();
  const fresh = result.items.filter((i) => !have.some((l) => l.variationId === i.variationId)).length;
  if (have.length + fresh > GUEST_CART_MAX_LINES) return 'full';
  for (const i of result.items) {
    const r = addGuestLine({ variationId: i.variationId, slug: i.slug, quantity: 1 });
    if (!r.ok && r.reason === 'storage') return 'storage';
  }
  return 'ok';
}

/**
 * Bộ gợi ý: tiêu đề, 2–4 dòng gọn (ảnh, tên kèm phân loại, giá) mỗi dòng một câu "vì sao hợp", tổng tiền và MỘT nút chính "Thêm cả bộ vào giỏ".
 * Thêm xong nút thành "Xem giỏ" và trang đứng yên (không tự chuyển). Khoá `busy` là ref đồng bộ nên chạm đúp chỉ gửi một lệnh; lệnh lô của máy
 * chủ thêm tất cả hoặc không món nào. Khách: giỏ khách bật thì ghi vào trình duyệt; tắt thì giữ bộ trong phiên rồi sang đăng nhập. Không có thưởng
 * nào cho việc thêm giỏ. Bộ giữ từ trước khi đăng nhập (`pending`) không in giá: giá có thể đã đổi (Giờ vàng hết suất), giỏ tính lại giá thật.
 */
export function MatcherResultView({ result, pending, onAgain }: { result: MatcherResult; pending: boolean; onAgain: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const phase = useAuthPhase();
  const busy = useRef(false);
  const addRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [add, setAdd] = useState<AddState>({ kind: 'idle' });
  const n = result.items.length;
  const now = Date.now();

  const done = (count: number) => {
    clearPendingMatcher();
    setAdd({ kind: 'added', n: count });
    trackWebEvent('matcher_add_all', { itemCount: count });
    playCartFeedback(addRef.current);
  };

  const addAll = async () => {
    if (busy.current || phase === 'loading') return;
    busy.current = true;
    setAdd({ kind: 'busy' });
    try {
      if (phase !== 'authenticated') {
        const guestOn = phase === 'guest' && (await guestCartFlagNow(qc));
        const r = guestOn ? addToGuestCart(result) : 'storage';
        if (r === 'ok') return done(n);
        if (r === 'full') return setAdd({ kind: 'error', text: matcherCopy('result.guestFull') });
        savePendingMatcher(result);
        router.push(loginHref(MATCHER_PATH));
        return;
      }
      // Nguồn 'pdp' như bộ đúng của Giỏ Đúng Việc (mặc định của máy chủ): 'ctv_sheet' của "Thêm cả combo" sẽ ghi nhầm lượt thêm này cho trang CTV.
      await addCartItemsBatch(coreHttp, matcherCartLines(result.items), 'pdp', cartStorefrontSlug());
      void qc.invalidateQueries({ queryKey: ['cart'] });
      done(n);
    } catch {
      setAdd({ kind: 'error', text: matcherCopy('result.addError') });
    } finally {
      busy.current = false;
    }
  };

  const viewEach = () => {
    const first = listRef.current?.querySelector<HTMLElement>('a[href]');
    listRef.current?.scrollIntoView({ block: 'start' });
    first?.focus({ preventScroll: true });
  };

  if (n === 0) {
    return (
      <div className="tubu-mg-panel" data-testid="matcher-result-empty">
        <Text variant="body-md" as="p">
          {matcherCopy('result.empty')}
        </Text>
        <Button fullWidth size="lg" onPress={onAgain}>
          {matcherCopy('result.again')}
        </Button>
      </div>
    );
  }

  const added = add.kind === 'added';
  return (
    <section className="tubu-mg-panel" aria-labelledby="matcher-result-title" data-testid="matcher-result" data-fallback={result.fallback}>
      <Text variant="caption" tone="brand" as="p" style={{ fontWeight: 'var(--type-label-weight)' }}>
        {pending ? matcherCopy('result.pending') : matcherCopy(result.fallback ? 'result.fallback' : 'result.kicker')}
      </Text>
      <Heading id="matcher-result-title" as="h2" variant="title-md" font="ui">
        {result.title}
      </Heading>
      {result.fallback && (
        <Text variant="body-sm" tone="secondary" as="p" data-testid="matcher-fallback-note">
          {matcherCopy('result.fallbackNote')}
        </Text>
      )}
      {result.water > 0 && (
        <Text variant="body-sm" tone="brand" as="p" data-testid="matcher-water">
          {matcherCopy('result.water', { n: result.water })}
        </Text>
      )}
      <ul ref={listRef} className="tubu-mx-items" data-testid="matcher-items" tabIndex={-1}>
        {result.items.map((item) => (
          <li key={item.variationId} onClickCapture={() => trackWebEvent('matcher_item_opened', { productSlug: item.slug })}>
            <ProductTile view={matcherItemView(item, now)} variant="line" href={`/san-pham/${item.slug}`} hidePrice={pending} />
            <Text variant="caption" tone="secondary" as="p" className="tubu-mx-why">
              {matcherWhy(item)}
            </Text>
          </li>
        ))}
      </ul>
      {pending ? (
        <Text variant="body-sm" tone="secondary" as="p" data-testid="matcher-pending-price">
          {matcherCopy('result.pendingPrice')}
        </Text>
      ) : (
        <div className="tubu-mx-total" data-testid="matcher-total">
          <Text variant="body-sm" tone="secondary" as="span">
            {matcherCopy('result.total', { n })}
          </Text>
          <Text variant="price-md" as="span">
            <Money amount={matcherTotal(result.items)} />
          </Text>
        </div>
      )}
      <div ref={addRef}>
        <Button
          fullWidth
          size="lg"
          loading={add.kind === 'busy' || phase === 'loading'}
          onPress={added ? () => router.push(CART_PATH) : () => void addAll()}
        >
          {matcherCopy(added ? 'result.viewCart' : 'result.addAll')}
        </Button>
      </div>
      <div role="status" aria-live="polite" data-testid="matcher-add-status">
        {added && (
          <Text variant="body-sm" tone="secondary" as="p">
            {matcherCopy('result.added', { n: add.n })}
          </Text>
        )}
        {add.kind === 'error' && (
          <Text variant="body-sm" tone="danger" as="p">
            {add.text}
          </Text>
        )}
      </div>
      <div className="tubu-mx-links">
        <button type="button" className="tubu-mg-link" onClick={viewEach} data-testid="matcher-view-each">
          {matcherCopy('result.viewEach')}
        </button>
        <button type="button" className="tubu-mg-link" onClick={onAgain} data-testid="matcher-again">
          {matcherCopy('result.again')}
        </button>
      </div>
    </section>
  );
}
