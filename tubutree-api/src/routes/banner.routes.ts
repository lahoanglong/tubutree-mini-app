import { Router } from 'express';
import { getActiveBanners, getAllBanners, createBanner, updateBanner, deleteBanner } from '../controllers/banner.controller';

const router = Router();

// Public: get active banners for Mini App
router.get('/', getActiveBanners);

// Admin routes (TODO: add admin auth middleware)
router.get('/admin', getAllBanners);
router.post('/admin', createBanner);
router.put('/admin/:id', updateBanner);
router.delete('/admin/:id', deleteBanner);

export default router;
