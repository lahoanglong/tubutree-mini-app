import { Router } from 'express';
import { authenticateToken, requireAdmin } from '../middlewares/auth.middleware';
import {
  applyVoucher, listActiveVouchers,
  adminListVouchers, adminCreateVoucher, adminUpdateVoucher, adminDeactivateVoucher, adminListUsages,
} from '../controllers/voucher.controller';

const router = Router();
router.use(authenticateToken);

// User
router.post('/vouchers/apply', applyVoucher);
router.get('/vouchers/active', listActiveVouchers);

// Admin
router.get('/admin/vouchers', requireAdmin, adminListVouchers);
router.post('/admin/vouchers', requireAdmin, adminCreateVoucher);
router.put('/admin/vouchers/:id', requireAdmin, adminUpdateVoucher);
router.delete('/admin/vouchers/:id', requireAdmin, adminDeactivateVoucher);
router.get('/admin/vouchers/:id/usages', requireAdmin, adminListUsages);

export default router;
