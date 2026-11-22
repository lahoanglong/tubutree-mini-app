'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { myRefillPairsQuery, refillFirstOn, refillQueryIds } from '@tubutree/app-core/refill/refill-api';
import {
  REFILL_UNDO_MS,
  applyRefillSwap,
  undoRefillSwap,
  type RefillCartOps,
  type RefillSwapReceipt,
  type RefillSwapInput,
  type RefillSwapView,
} from '@tubutree/app-core/refill/refill-swap';
import { trackWebEvent } from '@/lib/analytics';
import { coreHttp } from '@/lib/core-http';
import { addToCart, removeCartItem, type CartLine, type CartSummary } from '@/lib/shop-client';
import { useAutoDismiss } from '@/lib/use-auto-dismiss';
import { useCartWrite } from '@/lib/use-cart-write';
import { usePublicConfig } from '@/lib/use-public-config';

const ops: RefillCartOps<CartSummary> = { add: (v, q) => addToCart(v, q), remove: removeCartItem };
const CART = { surface: 'cart' };

type SavingBadge = NonNullable<RefillSwapInput['saving']>;
const noBadge: SavingBadge = () => null;

/**
 * Hàm huy hiệu "Tiết kiệm …" nạp lười (bộ đọc dung tích vài KB không vào JS tải đầu của giỏ). Bắt đầu nạp cùng lúc hỏi cặp, nên liên
 * kết đổi và huy hiệu hiện cùng lúc; nạp hỏng thì liên kết vẫn hiện, không có huy hiệu.
 */
function useSavingBadge(wanted: boolean): SavingBadge | null {
  const [badge, setBadge] = useState<SavingBadge | null>(null);
  useEffect(() => {
    if (!wanted || badge) return;
    let live = true;
    import('@tubutree/app-core/refill/refill-saving').then(
      (m) => live && setBadge(() => m.refillSavingBadge),
      () => live && setBadge(() => noBadge),
    );
    return () => {
      live = false;
    };
  }, [wanted, badge]);
  return badge;
}

/**
 * Đổi dòng chai sang gói Refill ở giỏ (cờ `catalog.refill_first_enabled`), cùng luật với `useCartRefill` của Mini App. Cờ tắt thì không gọi máy chủ và
 * `pairs` rỗng. Đổi và Hoàn tác dùng chung một khoá; phản hồi giỏ ghi qua `useCartWrite` như mọi lệnh giỏ khác của màn (lệnh chồng thì tải lại giỏ).
 */
export function useCartRefill(lines: readonly CartLine[] | undefined, onError: (e: unknown) => void, onApplied?: () => void) {
  const on = refillFirstOn(usePublicConfig());
  const ids = refillQueryIds((lines ?? []).map((l) => l.productId));
  const pairs = useQuery({ ...myRefillPairsQuery(coreHttp, ids), enabled: on && ids.length > 0 }).data;
  const saving = useSavingBadge(on && ids.length > 0);
  const cartWrite = useCartWrite();
  const [confirm, setConfirm] = useState<RefillSwapView | null>(null);
  const [receipt, setReceipt] = useState<RefillSwapReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const hold = useAutoDismiss(!!receipt, REFILL_UNDO_MS, () => setReceipt(null), receipt);
  const run = <T>(task: () => Promise<T>, cart: (r: T) => CartSummary, done: (r: T) => void) => {
    lock.current = true;
    setBusy(true);
    const cmd = cartWrite.begin();
    task()
      .then(
        (r) => {
          void cartWrite.write(cmd, cart(r));
          done(r);
        },
        (e: unknown) => {
          void cartWrite.fail(cmd, true);
          onError(e);
        },
      )
      .finally(() => {
        lock.current = false;
        setBusy(false);
      });
  };
  const apply = (view: RefillSwapView) => {
    setConfirm(null);
    if (lock.current) return;
    run(
      () => applyRefillSwap(ops, view),
      (r) => r.cart,
      (r) => {
        setReceipt(r.receipt);
        onApplied?.();
        trackWebEvent('refill_swap_applied', CART);
      },
    );
  };
  const undo = () => {
    if (!receipt || lock.current) return;
    setReceipt(null);
    run(
      () => undoRefillSwap(ops, receipt),
      (c) => c,
      () => trackWebEvent('refill_swap_undone', CART),
    );
  };
  return {
    pairs: on && saving ? pairs : undefined,
    saving: saving ?? undefined,
    confirm,
    cancel: () => setConfirm(null),
    receipt,
    hold,
    dismiss: () => setReceipt(null),
    busy,
    apply,
    undo,
    press: (v: RefillSwapView) => (v.needsConfirm ? setConfirm(v) : apply(v)),
  };
}
