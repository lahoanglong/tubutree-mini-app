'use client';

// Nguồn: apps/miniapp/src/components/ui/page-header.tsx
import type { ReactNode } from 'react';
import { Heading, Text } from './text';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  back?: 'auto' | false;
  actions?: ReactNode;
  variant?: 'plain' | 'hero';
}

// BackButton do layout gắn một lần (position:fixed, left:12, width:44) nên không chiếm chỗ trong flex header.
// Vòng tròn nút (x: 12→56) sẽ đè ký tự đầu tiêu đề vì header chỉ đệm trái 16px: chừa thêm 48px (tổng 64px = mép nút 56 + 8) khi back !== false.
const BACK_BUTTON_TITLE_CLEARANCE = 48;

/** Tiêu đề trang con — thay 3+ kiểu tiêu đề trộn lẫn hiện tại, và 9 trang KHÔNG có tiêu đề nào
 * (audit A4-05: Giỏ hàng, Đơn hàng, Thông báo, Cài đặt, Yêu thích, Sửa hồ sơ, Sổ địa chỉ, Đặt
 * định kỳ, Thanh toán). Nút lùi nổi do layout gắn; `back` chỉ quyết định có chừa chỗ cho nó hay không. */
export function PageHeader({ title, subtitle, back = 'auto', actions, variant = 'plain' }: PageHeaderProps) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px',
        background: variant === 'hero' ? 'var(--color-bg-inverse)' : 'var(--color-bg-surface)',
        paddingTop: 'calc(12px + var(--safe-top))',
      }}
    >
      <div style={{ flex: 1, minWidth: 0, paddingLeft: back !== false ? BACK_BUTTON_TITLE_CLEARANCE : 0 }}>
        <Heading variant="title-lg" as="h1" tone={variant === 'hero' ? 'inverse' : 'primary'}>{title}</Heading>
        {subtitle && <Text variant="caption" tone={variant === 'hero' ? 'inverse' : 'tertiary'} as="div">{subtitle}</Text>}
      </div>
      {actions}
    </div>
  );
}
