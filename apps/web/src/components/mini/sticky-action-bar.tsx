'use client';

// Nguồn: apps/miniapp/src/components/ui/sticky-action-bar.tsx
import type { ReactNode } from 'react';

export interface StickyActionBarProps {
  primary: ReactNode;
  secondary?: ReactNode;
  summary?: ReactNode;
  /** Khối bên trái nút chính, CÙNG HÀNG với nút (vd tổng tiền của giỏ): nút giữ bề rộng riêng, khối này lấy phần còn lại. */
  lead?: ReactNode;
  /** Đệm và khoảng cách gọn (10px / 4px) cho thanh nhiều lớp như chân dính giỏ; mặc định giữ 16px / 8px của các trang khác. */
  dense?: boolean;
}

/** Thanh CTA dính đáy — safe-area MỘT LẦN ở đây, không phải mỗi trang tự cộng (audit A4-21: 10
 * thanh tự vẽ, 3 thiếu safe-area hoàn toàn). Bản Mini App còn ghi chiều cao thật vào `--sticky-bar-h`; web đo ở `components/sticky-action-bar.tsx`. */
export function StickyActionBar({ primary, secondary, summary, lead, dense }: StickyActionBarProps) {
  const pad = dense ? 10 : 16;
  return (
    <div
      data-testid="sticky-bar"
      data-sticky-bar
      className="tubu-sticky-bar"
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20,
        background: 'var(--color-bg-surface)', boxShadow: 'var(--elevation-3)',
        padding: `${pad}px 16px`, paddingBottom: `calc(${pad}px + var(--safe-bottom))`,
        display: 'flex', flexDirection: 'column', gap: dense ? 4 : 8,
      }}
    >
      {summary}
      <div style={{ display: 'flex', gap: 10, alignItems: lead ? 'center' : undefined }}>
        {lead && <div style={{ flex: 1, minWidth: 0 }}>{lead}</div>}
        {secondary}
        {/* minWidth 0: flex item mặc định min-width:auto = bề rộng nội dung → hàng CTA không co được
            và tràn khỏi màn hình ở 320-390px (PDP "Mua ngay · giá" chạm 421px). Nút bên trong co/rút
            gọn nhờ .tubu-sticky-bar .tubu-btn (css/tokens.css). Có `lead` thì nút tự giữ bề rộng (đủ nhãn "Thanh toán (n)"). */}
        <div style={lead ? { flex: '0 0 auto', minWidth: 148 } : { flex: 1, minWidth: 0 }}>{primary}</div>
      </div>
    </div>
  );
}
