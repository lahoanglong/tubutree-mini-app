'use client';

import Link from 'next/link';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { Heading, Text } from '@/components/mini';

/** Lá và cành vẽ bằng đường nét, màu chữ sáng nhạt dần: hoạ tiết nền, không mang nghĩa. */
const SPRIG = 'M20 150c0-60 30-110 90-136 0 52-28 100-90 136z';
const LEAVES: readonly { transform: string; opacity: number }[] = [
  { transform: 'translate(210 10) rotate(8) scale(1.1)', opacity: 0.18 },
  { transform: 'translate(120 70) rotate(-24) scale(0.9)', opacity: 0.12 },
  { transform: 'translate(250 150) rotate(36) scale(0.8)', opacity: 0.1 },
  { transform: 'translate(30 40) rotate(-60) scale(0.6)', opacity: 0.08 },
];

const BTN = 'inline-flex min-h-11 items-center justify-center rounded-control px-5 text-sm font-semibold no-underline transition-colors';

/**
 * Khối giới thiệu mặc định của Trang chủ web từ `md`, đứng ở chỗ banner chiến dịch khi DB không có chiến dịch nào (`HubLayout` `hero`): nền xanh rừng, tiêu đề, một câu mô tả và hai lối
 * (danh mục sản phẩm, Hành trình nguyên liệu). Chỉ có trên web (điện thoại ẩn hẳn nên Mini App không cần). Tỉ lệ khung bằng banner (`--banner-ratio`) để chiến dịch về muộn thay vào
 * không làm các khối dưới nhảy; nội dung dài hơn khung thì khung giãn ra (lớp trang trí tách riêng, `overflow` không đặt trên khung giữ tỉ lệ). Chữ ở `homeCopy.hero`.
 */
export function HomeEditorialHero() {
  const c = homeCopy.hero;
  return (
    <section
      aria-label={c.label}
      data-testid="home-editorial-hero"
      className="relative hidden md:block"
      style={{ aspectRatio: 'var(--banner-ratio)' }}
    >
      <div aria-hidden className="absolute inset-0 overflow-hidden" style={{ background: 'var(--color-bg-cover)', borderRadius: 'var(--radius-media)' }}>
        <svg viewBox="0 0 400 200" preserveAspectRatio="xMaxYMid slice" className="absolute inset-y-0 right-0 h-full w-3/5" fill="none">
          {LEAVES.map((l) => (
            <path key={l.transform} d={SPRIG} transform={l.transform} style={{ fill: 'var(--color-text-inverse)', opacity: l.opacity }} />
          ))}
        </svg>
      </div>
      <div className="relative flex h-full max-w-lg flex-col justify-center gap-3 p-6 lg:p-8">
        <Text variant="label" tone="inverse" style={{ letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.85 }}>
          {c.eyebrow}
        </Text>
        <Heading variant="display-md" as="h2" tone="inverse">
          {c.title}
        </Heading>
        <Text variant="body-lg" tone="inverse" as="p" style={{ opacity: 0.92 }}>
          {c.body}
        </Text>
        <div className="mt-2 flex flex-wrap gap-3">
          <Link href="/san-pham" className={BTN} style={{ background: 'var(--color-bg-surface)', color: 'var(--color-text-brand)' }}>
            {c.ctaShop}
          </Link>
          <Link
            href="/cau-chuyen"
            className={`${BTN} border`}
            style={{ color: 'var(--color-text-inverse)', borderColor: 'color-mix(in srgb, var(--color-text-inverse) 55%, transparent)' }}
          >
            {c.ctaStory}
          </Link>
        </div>
      </div>
    </section>
  );
}
