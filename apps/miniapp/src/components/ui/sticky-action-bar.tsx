import type { ReactNode } from 'react';

export interface StickyActionBarProps {
  primary: ReactNode;
  secondary?: ReactNode;
  summary?: ReactNode;
}

/** Thanh CTA dính đáy — safe-area MỘT LẦN ở đây, không phải mỗi trang tự cộng (audit A4-21: 10
 * thanh tự vẽ, 3 thiếu safe-area hoàn toàn). */
export function StickyActionBar({ primary, secondary, summary }: StickyActionBarProps) {
  return (
    <div
      data-testid="sticky-bar"
      className="tubu-sticky-bar"
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20,
        background: 'var(--color-bg-surface)', boxShadow: 'var(--elevation-3)',
        padding: 16, paddingBottom: 'calc(16px + var(--safe-bottom))',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}
    >
      {summary}
      <div style={{ display: 'flex', gap: 10 }}>
        {secondary}
        {/* minWidth 0: flex item mặc định min-width:auto = bề rộng nội dung → hàng CTA không co được
            và tràn khỏi màn hình ở 320-390px (PDP "Mua ngay · giá" chạm 421px). Nút bên trong co/rút
            gọn nhờ .tubu-sticky-bar .tubu-btn (css/tokens.css). */}
        <div style={{ flex: 1, minWidth: 0 }}>{primary}</div>
      </div>
    </div>
  );
}
