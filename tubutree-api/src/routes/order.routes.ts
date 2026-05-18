import { Router } from 'express';
import { createOrder, getMyOrders, getOrderDetail, cancelOrder, reorder } from '../controllers/order.controller';
import { authenticateToken } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticateToken); // Protect all order routes

router.post('/', createOrder);
router.get('/', getMyOrders);
router.get('/:id', getOrderDetail);
router.put('/:id/cancel', cancelOrder);
router.post('/:id/reorder', reorder);

export default router;
