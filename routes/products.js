import express from 'express';
import { getProducts, getProductBySlug, getProductBrands, getProductSuggestions, downloadProductDataset } from '../controllers/productsController.js';

const router = express.Router();

router.get('/', getProducts);
router.get('/brands', getProductBrands);
router.get('/suggest', getProductSuggestions);
router.get('/:slug/dataset', downloadProductDataset);
router.get('/:slug', getProductBySlug);

export default router;
