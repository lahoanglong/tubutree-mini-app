import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware';
import { uploadKYC, verifyImageMagicBytes } from '../lib/upload';
import {
  submitAffiliateApplication,
  getMyAffiliateApplication,
  updateMyAffiliateApplication,
} from '../controllers/affiliate-application.controller';

const router = Router();

router.use(authenticateToken);

router.post(
  '/applications',
  uploadKYC.fields([{ name: 'cccd_front', maxCount: 1 }]),
  verifyImageMagicBytes,
  submitAffiliateApplication,
);
router.get('/applications/me', getMyAffiliateApplication);
router.put(
  '/applications/me',
  uploadKYC.fields([{ name: 'cccd_front', maxCount: 1 }]),
  verifyImageMagicBytes,
  updateMyAffiliateApplication,
);

export default router;
