import { Router } from 'express';
import { loginWithZalo } from '../controllers/auth.controller';

const router = Router();

router.post('/login', loginWithZalo);

export default router;
