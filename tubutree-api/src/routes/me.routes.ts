import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware';
import { getMyCapabilities } from '../controllers/capabilities.controller';

const router = Router();

router.use(authenticateToken);
router.get('/capabilities', getMyCapabilities);

export default router;
