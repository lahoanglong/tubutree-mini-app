/** Chữ dự phòng cho trang sản phẩm. Nguồn thật nằm ở `@tubutree/shared-types` (api CommonJS không nạp được app-core ESM chưa build); file này giữ đường nhập cũ của web, Mini và kiểm tra catalog. */
export {
  findProductCopyFallback,
  resolveProductCopyFallback,
  withProductCopyFallback,
  type CopyIngredient,
  type ProductCopyFallback,
} from '@tubutree/shared-types';
