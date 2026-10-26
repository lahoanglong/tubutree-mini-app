'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift } from 'lucide-react';
import { claimCoupon, type ClaimedCoupon } from '@tubutree/app-core/api/coupon-claim';
import {
  claimFailure,
  claimOfferLabel,
  clearPendingClaim,
  needsZaloLogin,
  readClaimParam,
  readPendingClaim,
  savePendingClaim,
  withoutClaimParam,
} from '@/components/account/coupon-claim';
import { Sheet } from '@/components/ui/sheet';
import { useAuthPhase } from '@/lib/auth-phase';
import { useCartKey } from '@/lib/cart-key';
import { coreHttp } from '@/lib/core-http';
import { formatDate } from '@/lib/format-date';
import { ui } from '@/lib/guest-ui';
import { loginHref } from '@/lib/return-to';
import { getCart } from '@/lib/shop-client';
import { useShellPathname } from '@/lib/shell-pathname';

type Phase =
  | { kind: 'closed' }
  | { kind: 'claiming' }
  | { kind: 'needLogin' }
  | { kind: 'done'; coupon: ClaimedCoupon }
  | { kind: 'failed'; message: string; retryable: boolean };

/**
 * Nhận mã từ thẻ QR trong hộp hàng sàn (D2-03), cùng luật với `CouponClaimGate` của Mini App: link `?claim=CODE` → lưu mã trên
 * máy và xoá khỏi thanh địa chỉ → khi đã đăng nhập thì nhận vào ví đúng một lần và báo bằng sheet "Bạn nhận được ưu đãi".
 * Chưa đăng nhập thì mời đăng nhập (web không có tài khoản khách ngầm); mã giữ trên máy nên sau khi đăng nhập xong mã tự vào ví.
 * Đang khôi phục phiên hoặc mất kết nối lúc khôi phục thì chưa làm gì. Khách đóng sheet thì phiên này không tự hỏi lại.
 */
export function CouponClaimGate() {
  const phaseAuth = useAuthPhase();
  const router = useRouter();
  const pathname = useShellPathname();
  const queryClient = useQueryClient();
  const cartQ = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: phaseAuth === 'authenticated' });
  const cartCount = cartQ.data?.itemCount ?? 0;
  const [pending, setPending] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'closed' });
  const [stopped, setStopped] = useState(false);
  const inFlight = useRef(false);
  const autoTried = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    const { search, hash } = window.location;
    const fromUrl = readClaimParam(search, hash);
    if (fromUrl) {
      setPending(fromUrl);
      void savePendingClaim(fromUrl);
      window.history.replaceState(window.history.state, '', withoutClaimParam(window.location.href));
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
        const coupon = await claimCoupon(coreHttp, code);
        await forget();
        void queryClient.invalidateQueries({ queryKey: ['coupons'] });
        setPhase({ kind: 'done', coupon });
      } catch (err) {
        const { message, retryable } = claimFailure(err);
        if (needsZaloLogin(message)) {
          setPhase({ kind: 'needLogin' });
        } else {
          if (!retryable) await forget();
          setPhase({ kind: 'failed', message, retryable });
        }
      } finally {
        inFlight.current = false;
      }
    },
    [forget, queryClient],
  );

  useEffect(() => {
    if (!pending || stopped) return;
    if (phaseAuth === 'guest') {
      // Trang đăng nhập có nút riêng; sheet phủ lên sẽ che nó.
      if (phase.kind === 'closed' && !pathname.startsWith('/dang-nhap')) setPhase({ kind: 'needLogin' });
      return;
    }
    if (phaseAuth !== 'authenticated') return;
    // Mỗi mã chỉ tự nhận một lần: máy chủ đòi đăng nhập Zalo (needLogin) không được kéo effect này nhận lại vô hạn.
    if (autoTried.current === pending) return;
    if (phase.kind !== 'closed' && phase.kind !== 'needLogin') return;
    autoTried.current = pending;
    void claim(pending);
  }, [pending, stopped, phaseAuth, phase.kind, pathname, claim]);

  const close = () => {
    setStopped(true);
    setPhase({ kind: 'closed' });
  };

  const useNow = () => {
    close();
    router.push(cartCount > 0 ? '/gio-hang' : '/san-pham');
  };

  const view = describe(phase);
  let footer: ReactNode;
  if (phase.kind === 'done') {
    footer = (
      <div className="grid gap-2">
        <button type="button" onClick={useNow} className={`${ui.btnPrimary} w-full`}>
          Dùng ngay
        </button>
        <button type="button" onClick={close} className={`${ui.btnSecondary} w-full`}>
          Để sau
        </button>
      </div>
    );
  } else if (phase.kind === 'needLogin') {
    footer = (
      <div className="grid gap-2">
        <Link
          href={loginHref(withoutClaimParam(window.location.href))}
          onClick={close}
          className={`${ui.btnPrimary} w-full`}
        >
          Đăng nhập với Zalo
        </Link>
        <button type="button" onClick={close} className={`${ui.btnSecondary} w-full`}>
          Để sau
        </button>
      </div>
    );
  } else if (phase.kind === 'failed' && phase.retryable && pending) {
    footer = (
      <div className="grid gap-2">
        <button type="button" onClick={() => void claim(pending)} className={`${ui.btnPrimary} w-full`}>
          Thử lại
        </button>
        <button type="button" onClick={close} className={`${ui.btnSecondary} w-full`}>
          Để sau
        </button>
      </div>
    );
  } else if (phase.kind === 'claiming') {
    footer = (
      <button type="button" disabled aria-label="Đang nhận ưu đãi" className={`${ui.btnPrimary} w-full`}>
        Đang nhận ưu đãi
      </button>
    );
  } else {
    footer = (
      <button type="button" onClick={close} className={`${ui.btnSecondary} w-full`}>
        Đã hiểu
      </button>
    );
  }

  return (
    <Sheet open={phase.kind !== 'closed'} onClose={close} title={view.title} footer={footer}>
      <div className="grid justify-items-start gap-2" data-testid="coupon-claim-sheet">
        {phase.kind === 'done' && <Gift className="h-8 w-8 text-forest-600" aria-hidden="true" />}
        {view.lines.map((line, i) => (
          <p key={i} className={i === 0 ? (phase.kind === 'done' ? 'text-base font-semibold text-stone-900' : 'text-sm text-stone-900') : 'text-sm text-stone-700'}>
            {line}
          </p>
        ))}
      </div>
    </Sheet>
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
        lines: ['Ưu đãi từ thẻ trong hộp hàng dành cho tài khoản Zalo. Đăng nhập một chạm, ưu đãi tự vào ví của bạn.'],
      };
    case 'failed':
      return { title: 'Chưa nhận được ưu đãi', lines: [phase.message] };
    case 'claiming':
      return { title: 'Đang nhận ưu đãi', lines: ['Tubu Tree đang thêm ưu đãi từ thẻ của bạn vào ví.'] };
    default:
      return { title: '', lines: [] };
  }
}
