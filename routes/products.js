import express from 'express';
import { getProducts, getProductBySlug, getProductBrands } from '../controllers/productsController.js';

const router = express.Router();

router.get('/', getProducts);
router.get('/brands', getProductBrands);
router.get('/:slug', getProductBySlug);

export default router;
