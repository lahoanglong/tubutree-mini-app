import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Thay `@use-gesture/react` (~18 KB sau nén) cho đúng một nơi dùng trong bản build: tay kéo của `zmp-ui/esm/components/sheet/content.js`
 * (`useDrag(handlerDrag, { filterTaps: true })`, `{...bind()}` trên thanh kéo). `build-vendor-shims.ts` chặn build nếu module khác nhập gói này.
 *
 * Sheet chỉ đọc `down`, `first`, `movement`, `velocity[1]`, `event` và `memo` (giá trị handler trả về ở lần gọi trước trong cùng lượt kéo):
 * thả tay khi kéo xuống quá DRAG_THRESHOLD (100px) thì gọi `onClose`, chưa tới thì bật về chỗ cũ. Như `filterTaps`, chạm không dời quá
 * 3px trên trục nào không tính là kéo nên không gọi handler. Như use-gesture: bắt con trỏ (`setPointerCapture`) để kéo ra ngoài thanh vẫn theo
 * dõi được; đang có một ngón thì bỏ qua ngón khác; lúc kết thúc (thả, `pointercancel`, mất bắt con trỏ) báo quãng kéo của lần move cuối,
 * không đọc toạ độ của sự kiện kết thúc (sự kiện huỷ có thể mang toạ độ 0).
 */

const TAP_THRESHOLD_PX = 3;

export interface DragState {
  down: boolean;
  first: boolean;
  last: boolean;
  movement: [number, number];
  velocity: [number, number];
  event: ReactPointerEvent<Element>;
  memo: unknown;
}

type DragHandler = (state: DragState) => unknown;

interface Gesture {
  id: number;
  x0: number;
  y0: number;
  lastY: number;
  lastT: number;
  vy: number;
  movement: [number, number];
  active: boolean;
  memo: unknown;
}

export function useDrag(handler: DragHandler, _options?: { filterTaps?: boolean }) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const gesture = useRef<Gesture | null>(null);

  const emit = (g: Gesture, event: ReactPointerEvent<Element>, down: boolean, first: boolean) => {
    g.memo = handlerRef.current({
      down,
      first,
      last: !down,
      movement: g.movement,
      velocity: [0, g.vy],
      event,
      memo: g.memo,
    });
  };

  const end = (event: ReactPointerEvent<Element>) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    gesture.current = null;
    if (g.active) emit(g, event, false, false);
  };

  return () => ({
    onPointerDown(event: ReactPointerEvent<Element>) {
      if (event.button > 0) return;
      if (gesture.current?.active) return;
      gesture.current = {
        id: event.pointerId,
        x0: event.clientX,
        y0: event.clientY,
        lastY: event.clientY,
        lastT: event.timeStamp,
        vy: 0,
        movement: [0, 0],
        active: false,
        memo: undefined,
      };
      try {
        (event.currentTarget as Element).setPointerCapture(event.pointerId);
      } catch {
        /* trình duyệt không cho bắt con trỏ: vẫn nhận move/up khi ngón tay còn trên thanh */
      }
    },
    onPointerMove(event: ReactPointerEvent<Element>) {
      const g = gesture.current;
      if (!g || g.id !== event.pointerId) return;
      const dt = event.timeStamp - g.lastT;
      if (dt > 0) g.vy = Math.abs(event.clientY - g.lastY) / dt;
      g.lastY = event.clientY;
      g.lastT = event.timeStamp;
      g.movement = [event.clientX - g.x0, event.clientY - g.y0];
      const first = !g.active;
      if (first && Math.abs(g.movement[0]) < TAP_THRESHOLD_PX && Math.abs(g.movement[1]) < TAP_THRESHOLD_PX) return;
      g.active = true;
      emit(g, event, true, first);
    },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
  });
}
