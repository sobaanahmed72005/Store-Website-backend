import express from 'express';
import { getProducts, getProductBySlug, getProductBrands, getProductSuggestions } from '../controllers/productsController.js';

const router = express.Router();

router.get('/', getProducts);
router.get('/brands', getProductBrands);
router.get('/suggest', getProductSuggestions);
router.get('/:slug', getProductBySlug);

export default router;
