import express from 'express';
import {
  getBlogPosts,
  getBlogPostBySlug,
  getAdminBlogPosts,
  createAdminBlogPost,
  updateAdminBlogPost,
  deleteAdminBlogPost,
} from '../controllers/blogController.js';
import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Public routes
router.get('/', getBlogPosts);
router.get('/:slug', getBlogPostBySlug);

// Admin routes (protected)
router.get('/admin/all', requireAdmin, getAdminBlogPosts);
router.post('/admin/create', requireAdmin, createAdminBlogPost);
router.put('/admin/update/:id', requireAdmin, updateAdminBlogPost);
router.delete('/admin/delete/:id', requireAdmin, deleteAdminBlogPost);

export default router;
