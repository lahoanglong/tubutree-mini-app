'use client';

import { fetchBrandProducts, type BrandProductsQuery } from '@tubutree/app-core/api/brand';
import { coreHttp } from './core-http';

/** Sản phẩm của thương hiệu, phân trang thật (trang thương hiệu chỉ nhận 30 món đầu trong HTML dựng sẵn). */
export const fetchBrandProductsPage = (slug: string, q: BrandProductsQuery = {}) => fetchBrandProducts(coreHttp, slug, q);
