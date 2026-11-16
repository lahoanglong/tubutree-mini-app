import { describe, expect, it } from 'vitest';
import { META_DESCRIPTION_MAX } from './product-seo';
import { SITE_URL } from './site';
import { LANDING_SEO, PRIVATE_CHILD_SEO, landingJsonLd, landingMetadata, landingMetadataWithTemplate, type LandingKey } from './landing-seo';

const KEYS = Object.keys(LANDING_SEO) as LandingKey[];

describe('LANDING_SEO — sáu landing tăng trưởng công khai', () => {
  it('đúng sáu đường dẫn công khai, mỗi trang một đường dẫn, bắt đầu bằng "/" và không kèm query', () => {
    expect(KEYS.map((k) => LANDING_SEO[k].path).sort()).toEqual(['/ctv', '/dai-ly', '/doi-rac', '/kho-qua', '/tu-van', '/vuon-xanh']);
    for (const k of KEYS) expect(LANDING_SEO[k].path).toMatch(/^\/[a-z-]+$/);
  });

  it('tiêu đề và mô tả riêng từng trang: không trùng nhau, không mang hậu tố thương hiệu, mô tả đủ dài và không quá trần', () => {
    const titles = KEYS.map((k) => LANDING_SEO[k].title);
    const descriptions = KEYS.map((k) => LANDING_SEO[k].description);
    expect(new Set(titles).size).toBe(KEYS.length);
    expect(new Set(descriptions).size).toBe(KEYS.length);
    for (const k of KEYS) {
      const { title, description } = LANDING_SEO[k];
      expect(title, k).not.toMatch(/— Tubu Tree$/);
      expect(description.length, k).toBeGreaterThan(40);
      expect(description.length, k).toBeLessThanOrEqual(META_DESCRIPTION_MAX);
    }
  });

  it('mô tả không hứa con số do admin cấu hình (chiết khấu, điểm, ngày) vì chúng đổi theo thời gian', () => {
    for (const k of KEYS) expect(LANDING_SEO[k].description, k).not.toMatch(/\d/);
  });
});

describe('landingMetadata', () => {
  it.each(KEYS)('%s: canonical và og:url là chính đường dẫn, og:title có hậu tố, ảnh xem trước đủ, được lập chỉ mục', (key) => {
    const { path, title, description } = LANDING_SEO[key];
    const meta = landingMetadata(key);
    expect(meta.title).toBe(title);
    expect(meta.description).toBe(description);
    expect(meta.alternates?.canonical).toBe(path);
    expect(meta.openGraph).toMatchObject({ type: 'website', siteName: 'Tubu Tree', locale: 'vi_VN', url: path, title: `${title} — Tubu Tree`, description });
    const images = (meta.openGraph as { images?: { url: string }[] }).images ?? [];
    expect(images).toHaveLength(1);
    expect(meta.robots).toBeUndefined();
  });

  it('landingMetadataWithTemplate giữ nguyên mọi trường, chỉ đổi title thành {default, template} để trang con còn hậu tố', () => {
    for (const key of KEYS) {
      const plain = landingMetadata(key);
      const withTemplate = landingMetadataWithTemplate(key);
      expect(withTemplate.title).toEqual({ default: LANDING_SEO[key].title, template: '%s — Tubu Tree' });
      expect({ ...withTemplate, title: undefined }).toEqual({ ...plain, title: undefined });
    }
  });
});

describe('PRIVATE_CHILD_SEO', () => {
  it('đặt null cho alternates và openGraph: Next thay hẳn khoá kế thừa từ layout cha nên trang con noindex không mang canonical/og của landing', () => {
    expect(PRIVATE_CHILD_SEO).toEqual({ alternates: null, openGraph: null });
  });
});

describe('landingJsonLd', () => {
  it.each(KEYS)('%s: WebPage + BreadcrumbList trỏ về URL tuyệt đối của chính trang, tên và mô tả khớp metadata', (key) => {
    const { path, title, description } = LANDING_SEO[key];
    const url = `${SITE_URL}${path}`;
    const ld = landingJsonLd(key) as { '@graph': Record<string, unknown>[] };
    const [page, crumbs] = ld['@graph'] as [Record<string, unknown>, { itemListElement: { position: number; item: string }[] }];
    expect(page).toMatchObject({ '@type': 'WebPage', url, name: title, description, inLanguage: 'vi', isPartOf: { '@id': `${SITE_URL}/#website` } });
    expect(crumbs).toMatchObject({ '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb` });
    expect(crumbs.itemListElement.map((i) => i.position)).toEqual([1, 2]);
    expect(crumbs.itemListElement[0]!.item).toBe(`${SITE_URL}/`);
    expect(crumbs.itemListElement.at(-1)!.item).toBe(url);
  });
});
