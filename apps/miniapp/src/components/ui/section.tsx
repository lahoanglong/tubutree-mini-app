import type { ReactNode } from 'react';

export interface SectionProps {
  /** Neo cuộn tới và khoá chiều cao giữ chỗ của khối (Trang chủ). */
  id: string;
  /** block: giữa hai khối ở màn danh sách (16px); section: màn nội dung (24px). */
  spacing?: 'block' | 'section';
  /** Tên vùng cho trình đọc màn hình khi khối không có tiêu đề nhìn thấy. */
  label?: string;
  children: ReactNode;
}

/**
 * Nhịp khối thống nhất (DS-05): khoảng cách giữa hai khối do `Section` quyết định bằng `margin-top`, khối con không tự đặt đệm
 * trên/dưới. Thay 12 cách đệm lệch nhau (8–24px tuỳ khối đứng cạnh).
 */
export function Section({ id, spacing = 'block', label, children }: SectionProps) {
  return (
    <section id={id} aria-label={label} style={{ marginTop: spacing === 'section' ? 'var(--space-section)' : 'var(--space-block)' }}>
      {children}
    </section>
  );
}
