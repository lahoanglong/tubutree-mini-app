import 'reflect-metadata';
import { HEADERS_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from './public.decorator';
import { PUBLIC_CACHE, PUBLIC_CACHE_POLICY_KEY } from './public-cache.decorator';
import { CatalogController } from '../../modules/catalog/catalog.controller';
import { HomeController } from '../../modules/catalog/home.controller';
import { SystemConfigController } from '../../modules/system-config/system-config.controller';
import { FlashSaleController } from '../../modules/flash-sale/flash-sale.controller';
import { FaqController } from '../../modules/faq/faq.controller';
import { GeoController } from '../../modules/integrations/pancake/geo.controller';
import { BrandController } from '../../modules/brand/brand.controller';
import { StorefrontController } from '../../modules/storefront/storefront.controller';

type Ctor = { prototype: object };

function cacheControl(ctor: Ctor, method: string): string | undefined {
  const handler = (ctor.prototype as Record<string, object>)[method]!;
  const policy = Reflect.getMetadata(PUBLIC_CACHE_POLICY_KEY, handler) as keyof typeof PUBLIC_CACHE | undefined;
  if (policy) return PUBLIC_CACHE[policy];
  const headers = Reflect.getMetadata(HEADERS_METADATA, handler) as { name: string; value: string }[] | undefined;
  return headers?.find((h) => h.name.toLowerCase() === 'cache-control')?.value;
}

const isPublic = (ctor: Ctor, method: string) =>
  Reflect.getMetadata(IS_PUBLIC_KEY, (ctor.prototype as Record<string, object>)[method]!) === true ||
  Reflect.getMetadata(IS_PUBLIC_KEY, ctor) === true;

describe('Cache-Control cho API công khai (C-039)', () => {
  const cacheable: [string, Ctor, string][] = [
    ['GET /config/public', SystemConfigController, 'publicConfig'],
    ['GET /categories', CatalogController, 'categories'],
    ['GET /brands', CatalogController, 'brands'],
    ['GET /products', CatalogController, 'list'],
    ['GET /products/:slug', CatalogController, 'detail'],
    ['GET /products/:slug/related', CatalogController, 'related'],
    ['GET /products/:slug/bought-together', CatalogController, 'boughtTogether'],
    ['GET /home', HomeController, 'publicBlocks'],
    ['GET /flash-sales/active', FlashSaleController, 'active'],
    ['GET /faqs', FaqController, 'list'],
    ['GET /geo/provinces', GeoController, 'provinces'],
    ['GET /geo/communes', GeoController, 'communes'],
    ['GET /brand/public/:slug', BrandController, 'publicView'],
    ['GET /storefront/public/:slug', StorefrontController, 'publicView'],
    ['GET /storefront/by-host', StorefrontController, 'byHost'],
  ];

  it.each(cacheable)('%s: public + max-age/s-maxage ngắn', (_label, ctor, method) => {
    expect(isPublic(ctor, method)).toBe(true);
    const value = cacheControl(ctor, method);
    expect(value).toMatch(/^public, max-age=\d+, s-maxage=\d+$/);
    const maxAge = Number(/max-age=(\d+)/.exec(value ?? '')?.[1]);
    expect(maxAge).toBeLessThanOrEqual(300);
  });

  it('endpoint theo user KHÔNG được public cache', () => {
    expect(cacheControl(CatalogController, 'forYou')).toBeUndefined();
    expect(cacheControl(FlashSaleController, 'upcoming')).toBeUndefined();
    expect(cacheControl(HomeController, 'me')).toBe('private, no-store');
    expect(cacheControl(StorefrontController, 'me')).toBeUndefined();
  });

  it('/search/suggest không bị gói này đụng tới', () => {
    expect(cacheControl(CatalogController, 'suggest')).toBeUndefined();
  });
});
