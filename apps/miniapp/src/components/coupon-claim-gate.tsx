import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'zmp-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift } from 'lucide-react';
import type { AuthUser } from '@tubutree/shared-types';
import { useAuthStore } from '../store/auth';
import { useCartCount } from '../hooks/use-cart-count';
import { getErrorMessage, isOutcomeUnknown } from '../services/api';
import { getPublicConfig } from '../services/shop-api';
import { isHttpError } from '../services/http';
import {
  claimCoupon,
  claimOfferLabel,
  clearPendingClaim,
  readClaimParam,
  readPendingClaim,
  savePendingClaim,
  type ClaimedCoupon,
} from '../services/coupon-claim';
import { setCardGiftNote } from '../services/card-gift-note';
import { formatDate } from '../utils/format';
import { BottomSheet } from './ui/bottom-sheet';
import { Button } from './ui/button';
import { Icon } from './ui/icon';
import { Text } from './ui/text';

type Phase =
  | { kind: 'closed' }
  | { kind: 'claiming' }
  | { kind: 'needLogin'; loginFailed?: boolean }
  | { kind: 'done'; coupon: ClaimedCoupon }
  | { kind: 'failed'; message: string; retryable: boolean };

/** Cùng luật "khách thật" của máy chủ (common/real-user.ts): có SĐT, hoặc zaloId Zalo thật (không phải guest_). */
export function isGuestUser(u: Pick<AuthUser, 'phone' | 'zaloId'>): boolean {
  if (u.phone) return false;
  return !u.zaloId || u.zaloId.startsWith('guest_');
}

const isRateLimited = (err: unknown) => isHttpError(err) && err.response?.status === 429;
const needsZaloLogin = (message: string) => /đăng nhập Zalo/i.test(message);
const isNewCustomerOnlyRefusal = (message: string) => /đơn đầu tiên/i.test(message);
/** Khách đang ở màn tích điểm đơn sàn (vào từ thẻ): việc chính là tích điểm, quà thẻ không được kéo khách đi chỗ khác. */
const onScanRoute = () => typeof window !== 'undefined' && /\/points\/scan\/?$/.test(window.location.pathname);

/** Cờ tích điểm đơn sàn lúc cần quyết (đợi config nếu chưa tải); lỗi hoặc thiếu coi là tắt. */
async function marketplaceFlagOn(queryClient: ReturnType<typeof useQueryClient>): Promise<boolean> {
  try {
    const cfg = await queryClient.fetchQuery({ queryKey: ['public-config'], queryFn: getPublicConfig, staleTime: 5 * 60_000 });
    return cfg.loyalty?.marketplaceClaimEnabled === true;
  } catch {
    return false;
  }
}

/**
 * Nhận mã từ thẻ QR trong hộp hàng sàn (D2-03): link `?claim=CODE` mở Mini App → lưu mã trên máy → khi đã có tài khoản Zalo
 * thì nhận vào ví và báo bằng sheet "Bạn nhận được ưu đãi". Chưa đăng nhập Zalo (tài khoản khách) thì mời đăng nhập; mã
 * giữ trên máy nên lần mở sau, khi đã đăng nhập, mã tự vào ví. Khách đóng sheet thì phiên này không tự hỏi lại.
 */
export function CouponClaimGate() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const ensurePhone = useAuthStore((s) => s.ensurePhone);
  const queryClient = useQueryClient();
  const cfgQ = useQuery({ queryKey: ['public-config'], queryFn: getPublicConfig, staleTime: 5 * 60_000, enabled: onScanRoute() });
  // Cờ tắt thì màn Tích điểm chỉ là "sắp mở": nút chính của sheet không được hứa việc chưa làm được.
  const scanFlowOn = onScanRoute() && cfgQ.data?.loyalty?.marketplaceClaimEnabled === true;
  const navigate = useNavigate();
  const cartCount = useCartCount();
  const [pending, setPending] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'closed' });
  const [stopped, setStopped] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let alive = true;
    const fromUrl = typeof window === 'undefined' ? null : readClaimParam(window.location.search, window.location.hash);
    if (fromUrl) {
      setPending(fromUrl);
      void savePendingClaim(fromUrl);
    } else {
      void readPendingClaim().then((code) => {
        if (alive && code) setPending(code);
      });
    }
    return () => {
      alive = false;
    };
  }, []);

  const forget = useCallback(async () => {
    setPending(null);
    await clearPendingClaim();
  }, []);

  const claim = useCallback(
    async (code: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setPhase({ kind: 'claiming' });
      try {
        const coupon = await claimCoupon(code);
        await forget();
        void queryClient.invalidateQueries({ queryKey: ['coupons'] });
        setPhase({ kind: 'done', coupon });
      } catch (err) {
        const message = getErrorMessage(err);
        if (needsZaloLogin(message)) {
          setPhase({ kind: 'needLogin' });
        } else if (isNewCustomerOnlyRefusal(message) && onScanRoute() && (await marketplaceFlagOn(queryClient))) {
          await forget();
          setCardGiftNote('new-customers-only');
          setPhase({ kind: 'closed' });
        } else {
          const retryable = isOutcomeUnknown(err) || isRateLimited(err);
          // Mã sai, hết hạn, đã có người nhận, khách đã có đơn: thử lại cũng vậy, không giữ trên máy nữa.
          if (!retryable) await forget();
          setPhase({ kind: 'failed', message, retryable });
        }
      } finally {
        inFlight.current = false;
      }
    },
    [forget, queryClient],
  );

  const userKey = user ? `${user.id}:${user.phone ?? ''}:${user.zaloId ?? ''}` : '';
  useEffect(() => {
    if (!pending || stopped || status !== 'authenticated' || !user) return;
    if (phase.kind !== 'closed' && phase.kind !== 'needLogin') return;
    if (isGuestUser(user)) {
      if (phase.kind === 'closed') setPhase({ kind: 'needLogin' });
      return;
    }
    void claim(pending);
    // userKey thay cho `user`: tài khoản khách vừa được nâng lên tài khoản Zalo (đăng nhập ở sheet hoặc nâng ngầm) thì nhận
    // ngay, còn object user mới mà cùng danh tính (làm mới token) thì không gọi lại.
  }, [pending, stopped, status, userKey, phase.kind, claim]);

  const close = () => {
    setStopped(true);
    setPhase({ kind: 'closed' });
  };

  const login = async () => {
    setLoggingIn(true);
    try {
      const phone = await ensurePhone();
      if (!phone) setPhase({ kind: 'needLogin', loginFailed: true });
    } finally {
      setLoggingIn(false);
    }
  };

  const useNow = () => {
    close();
    navigate(cartCount > 0 ? '/cart' : '/browse');
  };

  const view = describe(phase);
  const scanning = scanFlowOn;
  const footer =
    phase.kind === 'done' ? (
      <div style={{ display: 'grid', gap: 8 }}>
        {scanning ? (
          <>
            <Button fullWidth onPress={close}>
              Tích điểm đơn này
            </Button>
            <Button fullWidth variant="ghost" onPress={useNow}>
              Xem ưu đãi
            </Button>
          </>
        ) : (
          <>
            <Button fullWidth onPress={useNow}>
              Dùng ngay
            </Button>
            <Button fullWidth variant="ghost" onPress={close}>
              Để sau
            </Button>
          </>
        )}
      </div>
    ) : phase.kind === 'needLogin' ? (
      <div style={{ display: 'grid', gap: 8 }}>
        <Button fullWidth loading={loggingIn} onPress={login}>
          Đăng nhập bằng Zalo
        </Button>
        <Button fullWidth variant="ghost" onPress={close}>
          Để sau
        </Button>
      </div>
    ) : phase.kind === 'failed' && phase.retryable && pending ? (
      <div style={{ display: 'grid', gap: 8 }}>
        <Button fullWidth onPress={() => claim(pending)}>
          Thử lại
        </Button>
        <Button fullWidth variant="ghost" onPress={close}>
          Để sau
        </Button>
      </div>
    ) : phase.kind === 'claiming' ? (
      <Button fullWidth loading aria-label="Đang nhận ưu đãi">
        Đang nhận ưu đãi
      </Button>
    ) : (
      <Button fullWidth variant="secondary" onPress={close}>
        Đã hiểu
      </Button>
    );

  return (
    <BottomSheet open={phase.kind !== 'closed'} onClose={close} title={view.title} footer={footer}>
      <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }} data-testid="coupon-claim-sheet">
        {phase.kind === 'done' && <Icon icon={Gift} size="lg" tone="brand" />}
        {view.lines.map((line, i) => (
          <Text key={i} as="p" variant={i === 0 && phase.kind === 'done' ? 'body-lg' : 'body-md'} tone={i === 0 ? 'primary' : 'secondary'}>
            {line}
          </Text>
        ))}
      </div>
    </BottomSheet>
  );
}

function describe(phase: Phase): { title: string; lines: string[] } {
  switch (phase.kind) {
    case 'done': {
      const c = phase.coupon;
      return {
        title: c.alreadyClaimed ? 'Ưu đãi đã có trong ví của bạn' : 'Bạn nhận được ưu đãi',
        lines: [
          claimOfferLabel(c),
          `Mã ${c.code} đã vào mục Mã giảm giá của tôi, chọn ở bước thanh toán. Hạn dùng đến ${formatDate(c.endAt)}.`,
          ...(c.newCustomerOnly ? ['Dành cho đơn đầu tiên của bạn tại Tubu Tree.'] : []),
        ],
      };
    }
    case 'needLogin':
      return {
        title: 'Đăng nhập Zalo để nhận ưu đãi',
        lines: [
          'Ưu đãi từ thẻ trong hộp hàng dành cho tài khoản Zalo. Đăng nhập một chạm, ưu đãi tự vào ví của bạn.',
          ...(phase.loginFailed ? ['Chưa đăng nhập được. Bạn thử lại nhé.'] : []),
        ],
      };
    case 'failed':
      return { title: 'Chưa nhận được ưu đãi', lines: [phase.message] };
    case 'claiming':
      return { title: 'Đang nhận ưu đãi', lines: ['Tubu Tree đang thêm ưu đãi từ thẻ của bạn vào ví.'] };
    default:
      return { title: '', lines: [] };
  }
}
