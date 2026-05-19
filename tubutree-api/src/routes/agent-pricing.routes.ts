import { Router } from 'express';
import { authenticateToken, requireAdmin } from '../middlewares/auth.middleware';
import {
  getMyAgentProfile, previewWholesale,
  listTiers, createTier, updateTier,
  listAgentProfiles, setAgentTier,
} from '../controllers/agent-pricing.controller';

const router = Router();
router.use(authenticateToken);

// User
router.get('/agent/me/profile', getMyAgentProfile);
router.get('/agent/me/preview', previewWholesale);

// Admin
router.get('/admin/agent/tiers', requireAdmin, listTiers);
router.post('/admin/agent/tiers', requireAdmin, createTier);
router.put('/admin/agent/tiers/:id', requireAdmin, updateTier);
router.get('/admin/agent/profiles', requireAdmin, listAgentProfiles);
router.put('/admin/agent/profiles/:userId/tier', requireAdmin, setAgentTier);

export default router;
