import type { Metadata } from 'next';
import { staticPageJsonLd, staticPageMetadata } from './page-seo';

/**
 * Sáu landing tăng trưởng công khai. Các trang này là trang client (`'use client'`, không export được `metadata`), nên thẻ SEO khai ở layout của
 * từng đoạn đường dẫn (riêng /doi-rac khai ở page vì không có layout). Mỗi trang một tiêu đề, mô tả, canonical, og:url riêng: trước đây chúng
 * kế thừa mô tả và og của layout gốc, nên Zalo/Google hiện cùng một thẻ cho cả sáu URL.
 *
 * Mô tả chỉ nói điều trang thật sự làm, không nêu con số (mức chiết khấu, điểm, thời hạn) vì những giá trị đó do admin cấu hình và đổi theo thời gian.
 * Tiêu đề chưa gồm hậu tố "— Tubu Tree": template ở layout gốc thêm (xem page-seo).
 */
export const LANDING_SEO = {
  recycle: {
    path: '/doi-rac',
    title: 'Đổi rác lấy quà',
    description: 'Đổi rác tái chế lấy Điểm Xanh và quà tại Tubu Tree: tạo yêu cầu, chọn cách giao rác phù hợp và theo dõi từng bước đến khi nhận quà.',
  },
  garden: {
    path: '/vuon-xanh',
    title: 'Vườn Xanh',
    description: 'Vườn Xanh của Tubu Tree: chăm vườn ảo, chơi mini game và giữ nhịp sống xanh mỗi ngày cùng cộng đồng Vườn Tubu.',
  },
  affiliate: {
    path: '/ctv',
    title: 'Cộng tác viên',
    description: 'Trở thành cộng tác viên Tubu Tree: chia sẻ sản phẩm sống xanh bằng mã giới thiệu, có gian hàng riêng và theo dõi hoa hồng ngay trên một trang.',
  },
  dealer: {
    path: '/dai-ly',
    title: 'Kênh đại lý',
    description: 'Kênh đại lý Tubu Tree: gửi hồ sơ, được duyệt và nhập mỹ phẩm, đồ tiêu dùng thiên nhiên với chiết khấu dành cho đại lý.',
  },
  rewards: {
    path: '/kho-qua',
    title: 'Kho quà Điểm Xanh',
    description: 'Kho quà Điểm Xanh của Tubu Tree: dùng điểm tích lũy từ đơn hàng và hoạt động xanh để đổi mã giảm giá và quà tặng.',
  },
  advisor: {
    path: '/tu-van',
    title: 'Trợ lý AI Tubu',
    description: 'Trợ lý AI Tubu giúp bạn chọn sản phẩm, hiểu thành phần và cách dùng phù hợp. Gợi ý chỉ mang tính tham khảo, không thay lời khuyên của chuyên gia.',
  },
} as const;

export type LandingKey = keyof typeof LANDING_SEO;

/** Metadata đầy đủ (title, description, canonical, openGraph) của một landing; `title` giữ dạng chuỗi để template gốc thêm hậu tố. */
export function landingMetadata(key: LandingKey): Metadata {
  return staticPageMetadata(LANDING_SEO[key]);
}

/**
 * Landing có trang con riêng tư (/ctv/gian-hang, /kho-qua/cua-toi): metadata của layout cha chảy xuống mọi trang con, nên tiêu đề phải ở dạng
 * `{ default, template }` để trang con vẫn có hậu tố; canonical/og:url của landing do con xoá bằng `PRIVATE_CHILD_SEO`.
 */
export function landingMetadataWithTemplate(key: LandingKey): Metadata {
  const meta = landingMetadata(key);
  return { ...meta, title: { default: LANDING_SEO[key].title, template: '%s — Tubu Tree' } };
}

/**
 * Trang con riêng tư nằm dưới một landing công khai: gỡ canonical và og:url/ảnh kế thừa từ layout cha (trang noindex không khai canonical,
 * và canonical trỏ về landing cha là tín hiệu mâu thuẫn với noindex). `null` thay hẳn khoá cha trong cách Next trộn metadata.
 */
export const PRIVATE_CHILD_SEO = { alternates: null, openGraph: null } satisfies Metadata;

/** WebPage + BreadcrumbList của landing (cùng khuôn với các trang tĩnh khác). */
export function landingJsonLd(key: LandingKey): Record<string, unknown> {
  return staticPageJsonLd(LANDING_SEO[key]);
}
