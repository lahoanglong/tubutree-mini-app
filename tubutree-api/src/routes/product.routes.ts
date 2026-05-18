import { Router } from 'express';
import { getProducts, getProductDetail, getCategories } from '../controllers/product.controller';

const router = Router();

router.get('/', getProducts);
router.get('/categories', getCategories);
router.get('/:sku', getProductDetail);

export default router;
