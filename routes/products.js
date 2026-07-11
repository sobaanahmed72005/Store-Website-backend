import express from 'express';
import { getProducts, getProductBySlug, suggestProducts } from '../controllers/productsController.js';

const router = express.Router();

router.get('/', getProducts);
router.get('/suggest', suggestProducts);
router.get('/:slug', getProductBySlug);

export default router;
