import { ui } from '@/lib/guest-ui';

/**
 * Lớp phủ kiểu Mini App cho các màn đổi rác, đại lý, nhân viên, chủ thương hiệu: chỉ có tác dụng dưới md (điện thoại),
 * từ md giữ giao diện máy tính của `ui`. Mọi lớp `max-md:` cùng thuộc tính với lớp gốc nên thắng bằng thứ tự media của Tailwind.
 */
export const skin = {
  /** Nút phụ ZaUI secondary: nền xanh nhạt, không viền, chữ xanh đậm. */
  btnSecondary: `${ui.btnSecondary} max-md:border-transparent max-md:bg-[var(--color-action-secondary-bg)] max-md:text-[var(--color-action-secondary-fg)] max-md:hover:bg-[var(--color-action-secondary-bg)]`,
  /** Card raised: không viền, chỉ bóng elevation-1. */
  card: `${ui.card} max-md:border-transparent max-md:shadow-[var(--elevation-1)]`,
  /** h1 trang con: chừa chỗ cho nút lùi tròn nổi, serif cỡ title-lg như PageHeader dùng chung. */
  pageTitle: `${ui.pageTitle} max-md:py-3 max-md:pl-12 max-md:text-[length:var(--type-title-lg-size)] max-md:leading-[var(--type-title-lg-lh)] max-md:tracking-[-0.01em]`,
  /** Tiêu đề thẻ kiểu Heading title-sm (serif ~15px). */
  cardTitle: 'font-display text-lg font-semibold text-stone-900 max-md:text-[length:var(--type-title-sm-size)] max-md:leading-[var(--type-title-sm-lh)]',
} as const;
