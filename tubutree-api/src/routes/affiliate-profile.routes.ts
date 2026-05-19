import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware';
import {
  getMyProfile, getMyReferrals, getMyCommissions,
  attributeReferralController, getMyReferrer,
  getWallet, getWalletHistory,
} from '../controllers/affiliate-profile.controller';

const router = Router();
router.use(authenticateToken);

// Affiliate profile (cần affiliate_enabled — controller check)
router.get('/affiliate/me/profile', getMyProfile);
router.get('/affiliate/me/referrals', getMyReferrals);
router.get('/affiliate/me/commissions', getMyCommissions);

// Referral (mọi user đều có thể nhập ref_code)
router.post('/referral/attribute', attributeReferralController);
router.get('/referral/my-referrer', getMyReferrer);

// Wallet (mọi user đều có ví — tạm thời chỉ CTV mới có nguồn vào)
router.get('/wallet/balance', getWallet);
router.get('/wallet/history', getWalletHistory);

export default router;
