import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getReviewsForProduct, createReview, updateOwnReview, deleteOwnReview, getReviewEligibility } from '../controllers/reviewsController.js';

const router = express.Router();

router.get('/', getReviewsForProduct);
router.get('/eligibility', requireAuth, getReviewEligibility);
router.post('/', requireAuth, createReview);
router.put('/:id', requireAuth, updateOwnReview);
router.delete('/:id', requireAuth, deleteOwnReview);

export default router;