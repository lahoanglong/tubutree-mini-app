import { Router } from 'express';
import { getProductReviews, createReview } from '../controllers/review.controller';
import { authenticateToken } from '../middlewares/auth.middleware';

const router = Router();

// Public: view reviews for a product
router.get('/product/:productId', getProductReviews);

// Protected: create a review
router.post('/', authenticateToken, createReview);

export default router;
