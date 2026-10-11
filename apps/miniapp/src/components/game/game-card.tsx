import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '../ui/card';
import { Heading } from '../ui/text';
import { Icon } from '../ui/icon';

/** Khung chuẩn của mỗi khối trong trang Vườn Xanh: tiêu đề h2 (icon Lucide, không emoji) + nội dung. */
export function GameCard({ title, icon, children }: { title: string; icon?: LucideIcon; children: ReactNode }) {
  return (
    <Card padding={16}>
      <Heading variant="title-sm" as="h2" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {icon && <Icon icon={icon} tone="brand" />}
        {title}
      </Heading>
      {children}
    </Card>
  );
}
