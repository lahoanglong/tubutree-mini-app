import { Router } from 'express';
import { authenticateToken, requireAdmin } from '../middlewares/auth.middleware';
import { verifyImageMagicBytes } from '../lib/upload';
import {
  requestPayout, listMyPayouts,
  adminListPayouts, adminApprovePayout, adminRejectPayout, adminCompletePayout, proofUpload,
} from '../controllers/payout.controller';

const router = Router();
router.use(authenticateToken);

// User
router.post('/payouts', requestPayout);
router.get('/payouts/me', listMyPayouts);

// Admin
router.get('/admin/payouts', requireAdmin, adminListPayouts);
router.post('/admin/payouts/:id/approve', requireAdmin, adminApprovePayout);
router.post('/admin/payouts/:id/reject', requireAdmin, adminRejectPayout);
router.post('/admin/payouts/:id/complete', requireAdmin, proofUpload, verifyImageMagicBytes, adminCompletePayout);

export default router;
