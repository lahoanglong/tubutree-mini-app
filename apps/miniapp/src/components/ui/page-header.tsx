import type { ReactNode } from 'react';
import { Heading, Text } from './text';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  back?: 'auto' | false;
  actions?: ReactNode;
  variant?: 'plain' | 'hero';
}

// Nút Quay lại là position:fixed (left:12, width:44 — xem back-button.tsx) và do vỏ app dựng MỘT lần cho mọi trang con (app.tsx), nên KHÔNG chiếm chỗ
// trong flex layout của header. Header không vẽ thêm nút nào: vẽ hai nút thì có hai nút cùng tên ở cùng chỗ (trình đọc màn hình đọc đôi), và nút nào
// gỡ trước cũng kéo theo lớp `with-back-btn` của <body> làm nút còn lại mất đệm đầu trang. Không có đệm riêng thì vòng tròn nút (x: 12→56) đè lên ký tự
// đầu của tiêu đề vì header cũng có padding-left 16px (< 56). Chừa thêm 48px trên khối tiêu đề (cộng với 16px padding có sẵn của header = 64px từ mép
// trái — bằng đúng mép phải nút (56) + đệm 8px) khi back !== false. Xem chú thích trong hàm bên dưới.
const BACK_BUTTON_TITLE_CLEARANCE = 48;

/** Tiêu đề trang con — thay 3+ kiểu tiêu đề trộn lẫn hiện tại, và 9 trang KHÔNG có tiêu đề nào
 * (audit A4-05: Giỏ hàng, Đơn hàng, Thông báo, Cài đặt, Yêu thích, Sửa hồ sơ, Sổ địa chỉ, Đặt
 * định kỳ, Thanh toán). Nút Quay lại nổi (position: fixed) do app.tsx dựng và tự ẩn ở trang gốc —
 * PageHeader chỉ quyết định có chừa chỗ cho nó hay không (`back`), không vẽ và không kiểm soát vị trí của nó. */
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
