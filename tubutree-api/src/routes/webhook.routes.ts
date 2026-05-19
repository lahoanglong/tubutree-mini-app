import { Router } from 'express';
import { handlePancakeWebhook } from '../controllers/webhook.controller';
import { verifyWebhookSecret } from '../middlewares/webhook-auth.middleware';

const router = Router();

router.post('/pancake', verifyWebhookSecret, handlePancakeWebhook);

export default router;
