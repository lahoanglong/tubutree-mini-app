/**
 * Routes Index - Tổng hợp tất cả các route
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
import affiliateRoutes from './affiliate.routes';
import agentRoutes from './agent.routes';
import meRoutes from './me.routes';
import adminRoutes from './admin.routes';
import uploadsRoutes from './uploads.routes';
import pointsRoutes from './points.routes';
import affiliateProfileRoutes from './affiliate-profile.routes';
import agentPricingRoutes from './agent-pricing.routes';
import payoutRoutes from './payout.routes';
import voucherRoutes from './voucher.routes';

const router = Router();

// ===== CÔNG KHAI =====
router.use('/auth', authRoutes);
router.use('/products', productRoutes);
router.use('/banners', bannerRoutes);
router.use('/reviews', reviewRoutes);
router.use('/webhook', webhookRoutes);

// ===== CẦN ĐĂNG NHẬP =====
router.use('/orders', orderRoutes);
router.use('/cart', cartRoutes);
router.use('/addresses', addressRoutes);
router.use('/wishlists', wishlistRoutes);
router.use('/notifications', notificationRoutes);
router.use('/me', meRoutes);
router.use('/affiliate', affiliateRoutes);
router.use('/agent', agentRoutes);
router.use('/uploads', uploadsRoutes);
router.use('/points', pointsRoutes);
router.use('/', affiliateProfileRoutes); // mounts /affiliate/me/*, /referral/*, /wallet/*
router.use('/', agentPricingRoutes);     // mounts /agent/me/*, /admin/agent/tiers, ...
router.use('/', payoutRoutes);           // mounts /payouts/*, /admin/payouts/*
router.use('/', voucherRoutes);          // mounts /vouchers/*, /admin/vouchers/*

// ===== ADMIN (yêu cầu is_admin) =====
router.use('/admin', adminRoutes);

export default router;
