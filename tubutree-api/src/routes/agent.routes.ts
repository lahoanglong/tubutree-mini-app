import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware';
import { uploadKYC, verifyImageMagicBytes } from '../lib/upload';
import {
  submitAgentApplication,
  getMyAgentApplication,
  updateMyAgentApplication,
} from '../controllers/agent-application.controller';

const router = Router();

const agentFields = [
  { name: 'cccd_front', maxCount: 1 },
  { name: 'cccd_back', maxCount: 1 },
  { name: 'selfie', maxCount: 1 },
  { name: 'business_license', maxCount: 1 },
];

router.use(authenticateToken);

router.post('/applications', uploadKYC.fields(agentFields), verifyImageMagicBytes, submitAgentApplication);
router.get('/applications/me', getMyAgentApplication);
router.put('/applications/me', uploadKYC.fields(agentFields), verifyImageMagicBytes, updateMyAgentApplication);

export default router;
