import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware';
import { serveKYCFile, mintSignedKycUrl } from '../controllers/uploads.controller';

const router = Router();

// Serve KYC file — auth qua signed URL (query) hoặc Bearer header bên trong controller.
// KHÔNG dùng authenticateToken middleware (tránh require JWT cho mode signed URL).
router.get('/kyc/:userId/:filename', serveKYCFile);

// Mint signed URL — yêu cầu JWT
router.get('/kyc/:userId/:filename/sign', authenticateToken, mintSignedKycUrl);

export default router;
