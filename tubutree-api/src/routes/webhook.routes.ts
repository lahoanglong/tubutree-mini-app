import { Router } from 'express';
import { handlePancakeWebhook } from '../controllers/webhook.controller';

const router = Router();

router.post('/pancake', handlePancakeWebhook);

export default router;
