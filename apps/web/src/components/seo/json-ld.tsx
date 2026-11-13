import { jsonLdScript } from '@/lib/product-seo';

/** Thẻ `<script type="application/ld+json">` cho dữ liệu có cấu trúc; JSON đã thoát "<" nên chuỗi trong dữ liệu không đóng được thẻ. Chạy ở server, không thêm JS cho client. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }} />;
}
