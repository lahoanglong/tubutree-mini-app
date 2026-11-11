'use client';

import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { CartSummary } from '@/lib/shop-client';
import { cartKey } from '@/lib/cart-key';
import { LOCK_REFRESH_WAIT_MS, settleWithin } from '@/lib/settle-within';

/**
 * Một lệnh ghi giỏ từ lúc gửi tới lúc nhận phản hồi. `stale` bật khi có việc khác chồng lên đời lệnh (lệnh khác đang bay, hoặc lần tải lại giỏ do cơ chế này
 * khởi động còn chạy): phản hồi của nó là NGUYÊN giỏ tại lúc máy chủ xử lý, nên không còn đáng ghi vào cache.
 */
export interface CartCommand {
  stale: boolean;
}

interface Gate {
  live: Set<CartCommand>;
  /** Số lần tải lại do cơ chế này khởi động và chưa xong (kể cả đang chờ lệnh bay). */
  reloading: number;
  waiting: ((loaded: Promise<unknown>) => void)[];
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Sổ lệnh giỏ theo từng QueryClient (không theo component): rời trang rồi quay lại khi lệnh cũ còn bay vẫn thấy nó, và lệnh của các màn khác nhau
 * (dòng giỏ, món bù freeship, Hoàn tác) nhìn thấy nhau mà không cần biết khoá mutation của nhau.
 */
const gates = new WeakMap<QueryClient, Gate>();
function gateOf(qc: QueryClient): Gate {
  let gate = gates.get(qc);
  if (!gate) {
    gate = { live: new Set(), reloading: 0, waiting: [], timer: null };
    gates.set(qc, gate);
  }
  return gate;
}

/** Tải lại giỏ MỘT lần cho mọi bên đang chờ; chạy lúc còn lệnh bay (hết hạn chờ) thì lệnh đó cũng thành cũ vì lần tải có thể về trước hoặc sau phản hồi của nó. */
function flush(qc: QueryClient, gate: Gate) {
  if (gate.timer) {
    clearTimeout(gate.timer);
    gate.timer = null;
  }
  const waiters = gate.waiting.splice(0);
  if (waiters.length === 0) return;
  for (const cmd of gate.live) cmd.stale = true;
  const loaded = qc.invalidateQueries({ queryKey: ['cart'] });
  for (const resolve of waiters) resolve(loaded);
}

function begin(qc: QueryClient): CartCommand {
  const gate = gateOf(qc);
  const overlapped = gate.live.size > 0 || gate.reloading > 0;
  for (const other of gate.live) other.stale = true;
  const cmd: CartCommand = { stale: overlapped };
  gate.live.add(cmd);
  return cmd;
}

/** Hết giai đoạn "đang bay" của lệnh (có phản hồi hay lỗi đều tính), gọi lại nhiều lần không sao; lệnh cuối cùng rời sổ thì các lần tải đang chờ chạy. */
function end(qc: QueryClient, cmd: CartCommand) {
  const gate = gateOf(qc);
  gate.live.delete(cmd);
  if (gate.live.size === 0) flush(qc, gate);
}

/** Chờ mọi lệnh đang bay xong (tối đa `LOCK_REFRESH_WAIT_MS`, quá hạn thì tải luôn) rồi tải lại giỏ; nhiều bên cùng chờ thì dùng chung một lần tải. */
function reload(qc: QueryClient): Promise<void> {
  const gate = gateOf(qc);
  gate.reloading += 1;
  const loaded = new Promise<unknown>((resolve) => {
    gate.waiting.push(resolve);
    gate.timer ??= setTimeout(() => flush(qc, gate), LOCK_REFRESH_WAIT_MS);
    if (gate.live.size === 0) flush(qc, gate);
  });
  const done = () => {
    gate.reloading -= 1;
  };
  return loaded.then(done, done);
}

const droppedListeners = new WeakMap<QueryClient, Set<(cart: CartSummary) => void>>();

/**
 * Nghe các phản hồi giỏ bị bỏ (lệnh chồng nhau, xem `useCartWrite`). `couponRemoved` chỉ nằm ở đúng phản hồi làm máy chủ gỡ mã, lần tải lại sau không còn,
 * và tính số thiếu phải theo phần hàng của chính phản hồi đó: nơi nhớ lời báo (`useRemovedCoupon`) nhận thẳng phản hồi như `remember` của Mini App, không qua cache.
 */
export function subscribeDroppedCart(qc: QueryClient, listener: (cart: CartSummary) => void): () => void {
  let listeners = droppedListeners.get(qc);
  if (!listeners) {
    listeners = new Set();
    droppedListeners.set(qc, listeners);
  }
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function notifyDropped(qc: QueryClient, cart: CartSummary) {
  for (const listener of droppedListeners.get(qc) ?? []) listener(cart);
}

/**
 * Cách MỌI lệnh ghi giỏ trên một màn ghi phản hồi của mình vào cache. Mỗi phản hồi là NGUYÊN giỏ tại lúc máy chủ xử lý lệnh đó, nên hai lệnh bay chồng nhau
 * (dòng này với dòng kia, dòng với món bù, Hoàn tác) mà phản hồi về lệch thứ tự thì phản hồi cũ ghi đè phần của lệnh mới. Lệnh đi MỘT MÌNH suốt đời của nó thì
 * ghi thẳng phản hồi cho nhanh; lệnh từng chồng với việc khác thì bỏ phản hồi và tải lại giỏ từ máy chủ SAU KHI mọi lệnh đang bay xong, như Mini App
 * (`countEdits`, pages/cart.tsx: không ghi phản hồi, lệnh xong cuối cùng đọc lại).
 *
 * Gắn `begin` vào `onMutate` (và trả nó ra làm context), `write` vào `onSuccess`, `fail` vào `onError`. Khi phải tải lại, `write` (và `fail` với `reloadCart`) TRẢ lời hứa tải lại và
 * `onSuccess`/`onError` trả nó ra: TanStack Query đợi nó trước `onSettled`, nên lệnh còn tính là đang bay (khoá của dòng/món còn giữ) tới khi giỏ mới về, tối đa `LOCK_REFRESH_WAIT_MS`.
 * Nhả khoá sớm hơn thì nút bấm được lúc giỏ hiện còn cũ: số lượng tính từ số cũ, hoặc thêm lần hai một món đã vào giỏ.
 */
export function useCartWrite() {
  const qc = useQueryClient();
  return {
    begin: (): CartCommand => begin(qc),
    /** Phản hồi của lệnh: ghi thẳng khi lệnh đi một mình, còn không thì bỏ và tải lại giỏ. Trả lời hứa tải lại (đã giới hạn thời gian) hoặc `undefined`. */
    write: (cmd: CartCommand, cart: CartSummary): Promise<void> | undefined => {
      // Lần tải giỏ đang bay đã gửi trước lúc máy chủ xử lý lệnh này (tải đầu trang, lấy lại khi quay lại tab): nó về muộn với giỏ cũ và đè phản hồi vừa ghi. Tải lại khởi động lại nó.
      if (!cmd.stale && qc.isFetching({ queryKey: cartKey(), exact: true }) === 0) {
        qc.setQueryData(cartKey(), cart);
        end(qc, cmd);
        return undefined;
      }
      notifyDropped(qc, cart);
      const loaded = reload(qc);
      end(qc, cmd);
      return settleWithin(loaded);
    },
    /**
     * Lệnh lỗi: trả lại chỗ trong sổ. `reloadCart` khi máy chủ nói giỏ đã khác (xem `serverRejectedState`): tải lại sau khi các lệnh đang bay xong, và trả lời hứa tải lại
     * CHƯA có hạn: nơi gọi gộp nó với các lần tải khác của màn rồi tự đặt hạn một lần bằng `settleWithin`.
     */
    fail: (cmd: CartCommand | undefined, reloadCart = false): Promise<void> | undefined => {
      const loaded = reloadCart ? reload(qc) : undefined;
      if (cmd) end(qc, cmd);
      return loaded;
    },
    /** Tải lại giỏ không do lệnh nào gây ra (vd hết giờ Giờ vàng): chờ lệnh đang bay xong, không tải lúc chúng còn chạy. */
    reload: (): Promise<void> => reload(qc),
  };
}
