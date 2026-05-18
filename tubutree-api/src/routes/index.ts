/**
 * Routes Index - Tổng hợp tất cả các route
 *
 * Chia thành 2 nhóm:
 * - CÔNG KHAI: ai cũng truy cập được (sản phẩm, banner, đánh giá, webhook)
 * - CẦN ĐĂNG NHẬP: phải có JWT token (đơn hàng, giỏ hàng, địa chỉ, v.v.)
 */
import { Router } from 'express';
import productRoutes from './product.routes';
import authRoutes from './auth.routes';
import bannerRoutes from './banner.routes';
import reviewRoutes from './review.routes';
import webhookRoutes from './webhook.routes';
import orderRoutes from './order.routes';
import cartRoutes from './cart.routes';
import addressRoutes from './address.routes';
import wishlistRoutes from './wishlist.routes';
import notificationRoutes from './notification.routes';

const router = Router();

// ========== CÔNG KHAI (không cần đăng nhập) ==========
router.use('/auth', authRoutes);           // Đăng nhập
router.use('/products', productRoutes);     // Sản phẩm
router.use('/banners', bannerRoutes);       // Banner quảng cáo
router.use('/reviews', reviewRoutes);       // Đánh giá sản phẩm
router.use('/webhook', webhookRoutes);      // Webhook từ POS

// ========== CẦN ĐĂNG NHẬP (JWT token) ==========
router.use('/orders', orderRoutes);         // Đơn hàng
router.use('/cart', cartRoutes);            // Giỏ hàng
router.use('/addresses', addressRoutes);    // Địa chỉ giao hàng
router.use('/wishlists', wishlistRoutes);   // Yêu thích
router.use('/notifications', notificationRoutes); // Thông báo

export default router;
