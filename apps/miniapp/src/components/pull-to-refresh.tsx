import { useEffect, useRef, useState } from 'react';

/**
 * Pull-to-refresh cho trang zmp-ui (không có API sẵn). PHÒNG THỦ để không xung đột scroll:
 *  - chỉ kích hoạt khi vùng scroll (.zaui-page) đang ở ĐỈNH (scrollTop<=0) và kéo XUỐNG;
 *  - preventDefault chỉ khi đang thực sự kéo (listener passive:false) → không chặn scroll thường;
 *  - có resistance + ngưỡng; đang refresh thì khoá cho tới khi xong.
 * Dùng ref cho pull/refreshing trong handler để tránh stale-closure.
 *
 * LƯU Ý: cảm giác cử chỉ cần kiểm tra trên thiết bị thật (không mô phỏng được khi build).
 */
const THRESHOLD = 64; // px (sau resistance) để kích hoạt
const MAX = 90;
const RESIST = 0.5;

export function PullToRefresh({ onRefresh }: { onRefresh: () => Promise<unknown> | void }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const st = useRef({ startY: 0, active: false, el: null as HTMLElement | null, pull: 0, refreshing: false });
  st.current.refreshing = refreshing;

  useEffect(() => {
    const scroller = anchorRef.current?.closest('.zaui-page') as HTMLElement | null;
    if (!scroller) return;

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (st.current.refreshing || e.touches.length !== 1 || !t) { st.current.active = false; return; }
      if (scroller.scrollTop > 0) { st.current.active = false; return; }
      st.current.active = true;
      st.current.startY = t.clientY;
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!st.current.active || st.current.refreshing || !t) return;
      if (scroller.scrollTop > 0) { st.current.active = false; setPull(0); st.current.pull = 0; return; }
      const dy = t.clientY - st.current.startY;
      if (dy <= 0) { if (st.current.pull !== 0) { setPull(0); st.current.pull = 0; } return; }
      e.preventDefault(); // đang kéo xuống ở đỉnh → giữ, không cho bounce
      const p = Math.min(MAX, dy * RESIST);
      st.current.pull = p;
      setPull(p);
    };
    const onEnd = () => {
      if (!st.current.active) return;
      st.current.active = false;
      if (st.current.pull >= THRESHOLD && !st.current.refreshing) {
        setRefreshing(true);
        setPull(THRESHOLD);
        Promise.resolve(onRefresh()).finally(() => {
          setRefreshing(false);
          setPull(0);
          st.current.pull = 0;
        });
      } else {
        setPull(0);
        st.current.pull = 0;
      }
    };

    scroller.addEventListener('touchstart', onStart, { passive: true });
    scroller.addEventListener('touchmove', onMove, { passive: false });
    scroller.addEventListener('touchend', onEnd, { passive: true });
    scroller.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      scroller.removeEventListener('touchstart', onStart);
      scroller.removeEventListener('touchmove', onMove);
      scroller.removeEventListener('touchend', onEnd);
      scroller.removeEventListener('touchcancel', onEnd);
    };
  }, [onRefresh]);

  const visible = pull > 0 || refreshing;
  return (
    <div ref={anchorRef} aria-hidden style={{ height: 0, overflow: 'visible' }}>
      {visible && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: pull,
            transition: st.current.active ? 'none' : 'height var(--dur-slow, .3s) var(--ease-out, ease)',
            pointerEvents: 'none',
            zIndex: 5,
          }}
        >
          <span
            style={{
              fontSize: 18,
              opacity: Math.min(1, pull / THRESHOLD),
              transform: refreshing ? 'none' : `rotate(${pull * 4}deg)`,
            }}
            className={refreshing ? 'ptr-spin' : undefined}
          >
            🌿
          </span>
        </div>
      )}
    </div>
  );
}
