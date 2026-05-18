/**
 * Product Controller - Quản lý sản phẩm
 *
 * Sản phẩm được lấy từ Pancake POS (không lưu trong DB của mình).
 * Dùng Redis cache để tải nhanh hơn.
 *
 * 3 API:
 * - GET /products          → Danh sách sản phẩm
 * - GET /products/categories → Danh mục sản phẩm
 * - GET /products/:sku     → Chi tiết 1 sản phẩm
 */
import { Request, Response } from 'express';
import { getPancakeProducts, getPancakeProductDetail, getPancakeCategories } from '../services/pancake.service';
import { getCache, setCache } from '../services/redis.service';
import { handleError, getPagination } from '../lib/helpers';

// Lấy danh sách sản phẩm (có phân trang + cache 5 phút)
export const getProducts = async (req: Request, res: Response) => {
  try {
    const { page, limit } = getPagination(req.query);

    // Kiểm tra cache trước
    const cacheKey = `products_p${page}_l${limit}`;
    const cached = await getCache(cacheKey);
    if (cached) return res.json(cached);

    // Không có cache → lấy từ Pancake POS
    const products = await getPancakeProducts(page, limit);
    await setCache(cacheKey, products, 300); // Cache 5 phút

    res.json(products);
  } catch (error: any) {
    handleError(res, 'Lỗi lấy danh sách sản phẩm', error);
  }
};

// Lấy chi tiết sản phẩm (cache 5 phút)
export const getProductDetail = async (req: Request, res: Response) => {
  try {
    const { sku } = req.params;

    const cacheKey = `product_${sku}`;
    const cached = await getCache(cacheKey);
    if (cached) return res.json(cached);

    const product = await getPancakeProductDetail(sku);
    await setCache(cacheKey, product, 300);

    res.json(product);
  } catch (error: any) {
    handleError(res, 'Lỗi lấy chi tiết sản phẩm', error);
  }
};

// Lấy danh mục sản phẩm (cache 1 giờ - ít thay đổi)
export const getCategories = async (req: Request, res: Response) => {
  try {
    const cacheKey = 'categories';
    const cached = await getCache(cacheKey);
    if (cached) return res.json(cached);

    const categories = await getPancakeCategories();
    await setCache(cacheKey, categories, 3600); // Cache 1 giờ

    res.json(categories);
  } catch (error: any) {
    handleError(res, 'Lỗi lấy danh mục', error);
  }
};
