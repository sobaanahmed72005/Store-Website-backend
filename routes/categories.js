import express from 'express';
import { getCategories, getCategoryTree, getCategoryBySlug } from '../controllers/categoriesController.js';

const router = express.Router();

router.get('/', getCategories);
router.get('/tree', getCategoryTree);
router.get('/:slug', getCategoryBySlug);

export default router;
