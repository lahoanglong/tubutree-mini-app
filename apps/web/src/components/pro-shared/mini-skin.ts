import { ui } from '@/lib/guest-ui';

/**
 * Lớp phủ kiểu Mini App cho các màn đổi rác, đại lý, nhân viên, chủ thương hiệu: chỉ có tác dụng dưới md (điện thoại),
 * từ md giữ giao diện máy tính của `ui`. Mọi lớp `max-md:` cùng thuộc tính với lớp gốc nên thắng bằng thứ tự media của Tailwind.
 */
export const skin = {
  /** Nút phụ ZaUI secondary: nền xanh nhạt, không viền, chữ xanh đậm. */
  btnSecondary: `${ui.btnSecondary} max-md:border-transparent max-md:bg-[var(--color-action-secondary-bg)] max-md:text-[var(--color-action-secondary-fg)] max-md:hover:bg-[var(--color-action-secondary-bg)]`,
  /** Kéo thân trang lên sát mép trên khi có nút lùi nổi: tiêu đề nằm ngang hàng nút như thanh đầu của Mini App (body.with-back-btn đã đệm 48px cho nút). */
  mainUp: 'max-md:[body.with-back-btn_&]:-mt-12 max-md:[body.with-back-btn_&]:pt-0',
  /** Card raised: không viền, chỉ bóng elevation-1. */
  card: `${ui.card} max-md:border-transparent max-md:[box-shadow:var(--elevation-1)]`,
  /** Khối hàng trơn trên nền trang (không viền, không nền, không bóng). Dùng shadow-none thay cho box-shadow tuỳ ý để thắng thứ tự phát hành của Tailwind. */
  plain: `${ui.card} max-md:border-transparent max-md:bg-transparent max-md:shadow-none`,
  /** Thẻ viền không bóng như Card variant outline của Mini App. */
  outlineCard: `${ui.card} max-md:border-[color:var(--color-border-default)] max-md:shadow-none`,
  /** Nút chính navy của kênh đại lý (inkButton): chỉ khi đang bật, nút khoá giữ kiểu khoá của btnPrimary kể cả khi hover. */
  dealerInkBtn: 'max-md:enabled:bg-[var(--color-dealer-ink)] max-md:enabled:hover:bg-[var(--color-dealer-ink)]',
  /** h1 trang con: chừa chỗ cho nút lùi tròn nổi, serif cỡ title-lg như PageHeader dùng chung. */
  pageTitle: `${ui.pageTitle} max-md:py-3 max-md:pl-12 max-md:text-[length:var(--type-title-lg-size)] max-md:leading-[var(--type-title-lg-lh)] max-md:tracking-[-0.01em]`,
  /** Tiêu đề khối kiểu Heading title-md. */
  sectionTitle: `${ui.sectionTitle} max-md:text-[length:var(--type-title-md-size)] max-md:leading-[var(--type-title-md-lh)]`,
  /** Tiêu đề thẻ kiểu Heading title-sm (serif ~15px). */
  cardTitle: 'font-display text-lg font-semibold text-stone-900 max-md:text-[length:var(--type-title-sm-size)] max-md:leading-[var(--type-title-sm-lh)]',
  /** Như cardTitle nhưng máy tính giữ sans 16px; chỉ điện thoại đổi sang serif title-sm. */
  cardTitleSans: 'text-base font-semibold text-stone-900 max-md:font-display max-md:text-[length:var(--type-title-sm-size)] max-md:leading-[var(--type-title-sm-lh)]',
} as const;
