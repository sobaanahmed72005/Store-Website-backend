import express from 'express';
import { getContent } from '../controllers/contentController.js';

const router = express.Router();

router.get('/:key', getContent);

export default router;
