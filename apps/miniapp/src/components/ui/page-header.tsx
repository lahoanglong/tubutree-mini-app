import type { ReactNode } from 'react';
import BackButton from '../back-button';
import { Heading, Text } from './text';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  back?: 'auto' | false;
  actions?: ReactNode;
  variant?: 'plain' | 'hero';
}

// BackButton là position:fixed (left:12, width:44 — xem back-button.tsx) nên KHÔNG chiếm chỗ
// trong flex layout của header — `gap` bên dưới vô tác dụng với nó. Không có đệm riêng, vòng tròn
// nút (x: 12→56) đè lên ký tự đầu của tiêu đề vì header cũng có padding-left 16px (< 56). Chừa
// thêm 48px trên khối tiêu đề (cộng với 16px padding có sẵn của header = 64px từ mép trái —
// bằng đúng mép phải nút (56) + đệm 8px) khi back !== false. Xem chú thích trong hàm bên dưới.
const BACK_BUTTON_TITLE_CLEARANCE = 48;

/** Tiêu đề trang con — thay 3+ kiểu tiêu đề trộn lẫn hiện tại, và 9 trang KHÔNG có tiêu đề nào
 * (audit A4-05: Giỏ hàng, Đơn hàng, Thông báo, Cài đặt, Yêu thích, Sửa hồ sơ, Sổ địa chỉ, Đặt
 * định kỳ, Thanh toán). BackButton tự nổi (position: fixed) và tự ẩn ở trang gốc — PageHeader chỉ
 * quyết định có gắn nó vào cây hay không, không kiểm soát vị trí của nó. */
export function PageHeader({ title, subtitle, back = 'auto', actions, variant = 'plain' }: PageHeaderProps) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px',
        background: variant === 'hero' ? 'var(--color-bg-inverse)' : 'var(--color-bg-surface)',
        paddingTop: 'calc(12px + var(--safe-top))',
      }}
    >
      {back !== false && <BackButton />}
      <div style={{ flex: 1, minWidth: 0, paddingLeft: back !== false ? BACK_BUTTON_TITLE_CLEARANCE : 0 }}>
        <Heading variant="title-lg" as="h1" tone={variant === 'hero' ? 'inverse' : 'primary'}>{title}</Heading>
        {subtitle && <Text variant="caption" tone={variant === 'hero' ? 'inverse' : 'tertiary'} as="div">{subtitle}</Text>}
      </div>
      {actions}
    </div>
  );
}
