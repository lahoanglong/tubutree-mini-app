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
      <div style={{ flex: 1, minWidth: 0 }}>
        <Heading variant="title-lg" as="h1" tone={variant === 'hero' ? 'inverse' : 'primary'}>{title}</Heading>
        {subtitle && <Text variant="caption" tone={variant === 'hero' ? 'inverse' : 'tertiary'} as="div">{subtitle}</Text>}
      </div>
      {actions}
    </div>
  );
}
