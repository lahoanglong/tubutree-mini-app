/**
 * Pancake POS Service - Giao tiếp với hệ thống Pancake POS
 *
 * Pancake POS quản lý: sản phẩm, đơn hàng, tồn kho, danh mục.
 * Service này gọi API của Pancake để lấy/tạo/hủy dữ liệu.
 *
 * Cần cấu hình trong file .env:
 * - PANCAKE_API_KEY  (mã xác thực API)
 * - PANCAKE_SHOP_ID  (ID cửa hàng trên Pancake)
 */
import axios from 'axios';

// Tạo HTTP client riêng cho Pancake API
const pancakeApi = axios.create({
  baseURL: 'https://pos.pages.fm/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

// Tự động gắn API key vào mỗi request (dùng query parameter theo Pancake API docs)
pancakeApi.interceptors.request.use((config) => {
  if (process.env.PANCAKE_API_KEY) {
    config.params = { ...config.params, api_key: process.env.PANCAKE_API_KEY };
  }
  return config;
});

// Lấy SHOP_ID, báo lỗi nếu chưa cấu hình
function getShopId(): string {
  const shopId = process.env.PANCAKE_SHOP_ID;
  if (!shopId) throw new Error('Chưa cấu hình PANCAKE_SHOP_ID trong .env');
  return shopId;
}

// ========== SẢN PHẨM ==========

// Lấy danh sách sản phẩm (có phân trang)
export const getPancakeProducts = async (page = 1, limit = 20) => {
  const res = await pancakeApi.get(`/shops/${getShopId()}/products`, { params: { page, limit } });
  return res.data;
};

// Lấy chi tiết 1 sản phẩm
export const getPancakeProductDetail = async (productId: string) => {
  const res = await pancakeApi.get(`/shops/${getShopId()}/products/${productId}`);
  return res.data;
};

// Lấy danh sách danh mục
export const getPancakeCategories = async () => {
  const res = await pancakeApi.get(`/shops/${getShopId()}/categories`);
  return res.data;
};

// ========== ĐƠN HÀNG ==========

// Tạo đơn hàng mới trên POS
export const createPancakeOrder = async (orderData: any) => {
  const res = await pancakeApi.post(`/shops/${getShopId()}/orders`, orderData);
  return res.data;
};

// Lấy chi tiết đơn hàng
export const getPancakeOrder = async (orderId: string) => {
  const res = await pancakeApi.get(`/shops/${getShopId()}/orders/${orderId}`);
  return res.data;
};

// Hủy đơn hàng
export const cancelPancakeOrder = async (orderId: string, reason: string) => {
  const res = await pancakeApi.put(`/shops/${getShopId()}/orders/${orderId}/cancel`, { reason });
  return res.data;
};
