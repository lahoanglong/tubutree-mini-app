import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware';
import {
  getMyBalance, getMyHistory, previewRedeemController,
} from '../controllers/points.controller';

const router = Router();
router.use(authenticateToken);

router.get('/balance', getMyBalance);
router.get('/history', getMyHistory);
router.post('/preview-redeem', previewRedeemController);

export default router;
