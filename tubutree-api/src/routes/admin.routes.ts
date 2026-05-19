import { Router } from 'express';
import { authenticateToken, requireAdmin } from '../middlewares/auth.middleware';
import {
  listApplications, getApplicationDetail,
  approveApplication, rejectApplication,
  suspendApplication, restoreApplication,
} from '../controllers/admin-application.controller';
import {
  listUsers, getUserDetail, banUser, unbanUser,
} from '../controllers/admin-user.controller';

const router = Router();

router.use(authenticateToken, requireAdmin);

// ===== Affiliate apps =====
router.get('/affiliate/applications', listApplications('affiliate'));
router.get('/affiliate/applications/:id', getApplicationDetail('affiliate'));
router.post('/affiliate/applications/:id/approve', approveApplication('affiliate'));
router.post('/affiliate/applications/:id/reject', rejectApplication('affiliate'));
router.post('/affiliate/applications/:id/suspend', suspendApplication('affiliate'));
router.post('/affiliate/applications/:id/restore', restoreApplication('affiliate'));

// ===== Agent apps =====
router.get('/agent/applications', listApplications('agent'));
router.get('/agent/applications/:id', getApplicationDetail('agent'));
router.post('/agent/applications/:id/approve', approveApplication('agent'));
router.post('/agent/applications/:id/reject', rejectApplication('agent'));
router.post('/agent/applications/:id/suspend', suspendApplication('agent'));
router.post('/agent/applications/:id/restore', restoreApplication('agent'));

// ===== Users =====
router.get('/users', listUsers);
router.get('/users/:userId', getUserDetail);
router.post('/users/:userId/ban', banUser);
router.post('/users/:userId/unban', unbanUser);

export default router;
