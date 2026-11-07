import { useEffect, useState } from 'react';
import {
  CART_ADDED_EVENT,
  CART_FEEDBACK_EASE,
  CART_FLY_MS,
  CART_TARGET_ATTR,
  FLY_DOT_SIZE,
  flyDelta,
  flyKeyframes,
  isMeasurable,
  type Box,
} from '@tubutree/app-core/commerce/cart-feedback';

// Cùng nội dung với apps/web/src/lib/cart-feedback.ts (cart-feedback.spec.tsx của Mini App đọc cả hai): sửa một bên phải sửa bên kia.

function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Phần tử đầu tiên khớp mà đang có diện tích (bản ẩn bằng CSS đo ra 0): header điện thoại và máy tính cùng có giỏ nhưng chỉ một bản hiện. */
export function firstMeasurable(selector: string): Element | null {
  for (const el of Array.from(document.querySelectorAll(selector))) {
    if (isMeasurable(boxOf(el))) return el;
  }
  return null;
}

/**
 * Báo "vừa thêm vào giỏ": huy hiệu giỏ nảy một nhịp, và (trừ khi khách bật giảm chuyển động) một chấm bay từ `source` tới biểu tượng giỏ.
 * Không có nguồn hoặc không thấy biểu tượng giỏ thì chỉ nảy huy hiệu; câu xác nhận bằng chữ do nơi gọi hiện như trước.
 */
export function playCartFeedback(source: Element | null): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CART_ADDED_EVENT));
  if (!source || prefersReducedMotion()) return;
  const target = firstMeasurable(`[${CART_TARGET_ATTR}]`);
  const from = boxOf(source);
  if (!target || !isMeasurable(from)) return;
  const dot = document.createElement('span');
  if (typeof dot.animate !== 'function') return;
  dot.setAttribute('aria-hidden', 'true');
  dot.setAttribute('data-cart-fly', '');
  Object.assign(dot.style, {
    position: 'fixed',
    left: `${from.left + from.width / 2 - FLY_DOT_SIZE / 2}px`,
    top: `${from.top + from.height / 2 - FLY_DOT_SIZE / 2}px`,
    width: `${FLY_DOT_SIZE}px`,
    height: `${FLY_DOT_SIZE}px`,
    borderRadius: 'var(--radius-pill)',
    background: 'var(--color-promo-solid-bg)',
    pointerEvents: 'none',
    zIndex: '70',
    willChange: 'transform, opacity',
  });
  document.body.appendChild(dot);
  const anim = dot.animate(flyKeyframes(flyDelta(from, boxOf(target))), { duration: CART_FLY_MS, easing: CART_FEEDBACK_EASE, fill: 'forwards' });
  const cleanup = () => dot.remove();
  anim.onfinish = cleanup;
  anim.oncancel = cleanup;
}

/** Số lần đã thêm vào giỏ kể từ lúc gắn (0 = chưa); đổi số thì huy hiệu dựng lại và chạy lại nhịp nảy. `enabled=false` thì không nghe. */
export function useCartBumpKey(enabled = true): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const on = () => setN((v) => v + 1);
    window.addEventListener(CART_ADDED_EVENT, on);
    return () => window.removeEventListener(CART_ADDED_EVENT, on);
  }, [enabled]);
  return n;
}
