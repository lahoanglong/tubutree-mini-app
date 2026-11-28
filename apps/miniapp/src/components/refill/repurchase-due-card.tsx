import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSnackbar } from 'zmp-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { REPURCHASE_DUE_KEY, repurchaseDueQuery } from '@tubutree/app-core/api/repurchase-due';
import { refillLandingQuery } from '@tubutree/app-core/refill/refill-landing';
import {
  dismissRepurchaseDue,
  isRepurchaseDueDismissed,
  repurchaseDueCopy,
  repurchaseDueView,
  type RepurchaseDueStore,
  type RepurchaseDueSurface,
} from '@tubutree/app-core/refill/repurchase-due-card';
import { announce } from '../../lib/announce';
import { trackEvent } from '../../services/analytics';
import { getErrorMessage, isStaleStateError } from '../../services/api';
import { cartKey } from '../../services/cart-key';
import { coreHttp } from '../../services/core-http';
import { addToCart } from '../../services/shop-api';
import { useAuthStore } from '../../store/auth';
import { playCartFeedback } from '../../utils/cart-feedback';
import { formatVnd } from '../../utils/format';
import { haptic } from '../../utils/haptic';
import { settleWithin } from '../../utils/settle-within';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { IconButton } from '../ui/icon-button';
import { Text } from '../ui/text';

function dismissStore(): RepurchaseDueStore | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

const clampLines = (lines: number) => ({ display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }) as const;
const TITLE_CLAMP = clampLines(2);
// Thân 3 dòng: câu Refill dài hai dòng ở 375px sẽ cắt mất lý do (bớt một chai nhựa).
const BODY_CLAMP = clampLines(3);
const PAGE_SECTION = { padding: 'var(--space-inset-card) var(--space-inset-page) 0' } as const;
// Trang Refill đã đặt thân trang trong lề trang: thẻ chỉ cần khoảng cách dọc như thẻ "Kỳ Refill tới" ngay trên.
const LANDING_SECTION = { marginTop: 'var(--space-stack-md)' } as const;

export interface RepurchaseDueCardProps {
  /** Nơi đặt thẻ (`repurchase_due_*.surface`): Cá nhân, giỏ trống hay trang Tiết kiệm với Refill. */
  surface: RepurchaseDueSurface;
}

/**
 * Thẻ "Mua lại" hàng tiêu hao theo nhịp 21–30 ngày (nước rửa chén, nước rửa rau 25–40) sau khi nhận (w36-01, w55-01), chunk lười ở Cá nhân, giỏ trống và trang Tiết kiệm
 * với Refill. Một nút: thêm gói Refill ghép cặp (không có thì đúng món đã mua) vào giỏ một chạm. Giỏ trống mà khách chỉ có đơn sàn đã quét (không có dòng sản phẩm)
 * thì ghép gói Refill đầu trang Tiết kiệm theo mốc `scanDays`. × ẩn đúng món đó 14 ngày ở máy này. Chỉ khách đã đăng nhập; cờ tắt, không có món hay lỗi: không vẽ gì.
 * Cùng vai với `RepurchaseDueCard` của web.
 */
export default function RepurchaseDueCard({ surface }: RepurchaseDueCardProps) {
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const q = useQuery({ ...repurchaseDueQuery(coreHttp), enabled: authed });
  // Trang Refill là công khai và đã có ở trang Tiết kiệm: chỉ tải khi giỏ trống có mốc đơn sàn mà không có món theo đơn trực tiếp.
  const scanDays = q.data?.item ? null : (q.data?.scanDays ?? null);
  const landingQ = useQuery({ ...refillLandingQuery(coreHttp), enabled: authed && surface === 'cart_empty' && scanDays !== null });
  const view = repurchaseDueView(q.data?.item, formatVnd, { surface, scanDays, landing: landingQ.data });
  const [hiddenKey, setHiddenKey] = useState<string | null>(null);
  const dismissed = view ? hiddenKey === view.key || isRepurchaseDueDismissed(view.key, Date.now(), dismissStore()) : true;
  const shown = authed && view !== null && !dismissed;
  const inflight = useRef(false);
  // Phản hồi bay vào giỏ xuất phát từ nút; Button không đưa sự kiện ra ngoài nên lấy khung bọc.
  const ctaRef = useRef<HTMLSpanElement>(null);

  const viewedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!shown || !view || viewedKey.current === view.key) return;
    viewedKey.current = view.key;
    trackEvent('repurchase_due_view', 'miniapp', { surface, variationId: view.variationId });
  }, [shown, view, surface]);

  const mutation = useMutation({
    mutationFn: ({ variationId }: { variationId: string; origin: Element | null }) => addToCart(variationId, 1, 'repurchase_due'),
    onSuccess: (cart, { variationId, origin }) => {
      qc.setQueryData(cartKey(), cart);
      qc.setQueryData(REPURCHASE_DUE_KEY, { item: null });
      haptic('medium');
      playCartFeedback(origin?.isConnected ? origin : null);
      trackEvent('repurchase_due_add', 'miniapp', { surface, variationId });
      const text = repurchaseDueCopy('added');
      // Ở giỏ trống thì giỏ tự hiện món vừa thêm, không cần lối "Xem giỏ".
      openSnackbar({
        text,
        type: 'success',
        duration: 4000,
        ...(surface !== 'cart_empty' ? { action: { text: repurchaseDueCopy('viewCart'), close: true, onClick: () => navigate('/cart') } } : null),
      });
      announce('status', text);
    },
    onError: (e) => {
      const text = getErrorMessage(e);
      openSnackbar({ text, type: 'error' });
      announce('alert', text);
      return isStaleStateError(e) ? settleWithin(qc.invalidateQueries({ queryKey: REPURCHASE_DUE_KEY })) : undefined;
    },
    onSettled: () => {
      inflight.current = false;
    },
  });

  if (!shown || !view) return null;

  const add = (origin: Element | null) => {
    if (inflight.current) return;
    inflight.current = true;
    haptic('light');
    mutation.mutate({ variationId: view.variationId, origin });
  };

  const dismiss = () => {
    haptic('light');
    dismissRepurchaseDue(view.key, Date.now(), dismissStore());
    setHiddenKey(view.key);
    trackEvent('repurchase_due_dismiss', 'miniapp', { surface, variationId: view.variationId });
  };

  return (
    <section aria-label={repurchaseDueCopy('region')} data-testid="repurchase-due-card" style={surface === 'refill_landing' ? LANDING_SECTION : PAGE_SECTION}>
      <Card padding={12}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-inline-md)' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-stack-xs)' }}>
            <Text variant="label" as="p" style={TITLE_CLAMP}>
              {view.title}
            </Text>
            <Text variant="caption" tone="secondary" as="p" style={BODY_CLAMP}>
              {view.body}
            </Text>
            <div style={{ marginTop: 'var(--space-stack-xs)' }}>
              <span ref={ctaRef} style={{ display: 'inline-flex' }}>
                <Button variant="secondary" size="md" loading={mutation.isPending} onPress={() => add(ctaRef.current)}>
                  {view.cta}
                </Button>
              </span>
            </div>
          </div>
          <IconButton icon={X} label={repurchaseDueCopy('dismiss')} size="sm" onPress={dismiss} />
        </div>
      </Card>
    </section>
  );
}
