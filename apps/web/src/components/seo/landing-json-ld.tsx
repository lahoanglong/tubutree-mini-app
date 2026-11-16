import { landingJsonLd, type LandingKey } from '@/lib/landing-seo';
import { jsonLdScript } from '@/lib/product-seo';
import { SegmentJsonLd } from './segment-json-ld';

/** WebPage + BreadcrumbList của một landing công khai, dựng ở server; chỉ xuất hiện ở trang của landing, không ở trang con riêng tư. */
export function LandingJsonLd({ landing }: { landing: LandingKey }) {
  return <SegmentJsonLd json={jsonLdScript(landingJsonLd(landing))} />;
}
