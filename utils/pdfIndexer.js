import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import pool from '../config/db.js';
import { logger } from './logger.js';
import { isObjectStorageConfigured, getObjectBuffer } from './objectStorage.js';

const require = createRequire(import.meta.url);
const pdfParseModule = require('pdf-parse');
const PDFParse = pdfParseModule.PDFParse || pdfParseModule;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_DATASETS_DIR = path.join(__dirname, '../uploads/datasets');

/**
 * Extracts plain text from a PDF Buffer using pdf-parse.
 *
 * @param {Buffer} pdfBuffer
 * @returns {Promise<string>} Cleaned extracted text
 */
export async function extractTextFromPdfBuffer(pdfBuffer) {
  try {
    let rawText = '';

    if (typeof PDFParse === 'function') {
      const parser = new PDFParse({ data: pdfBuffer });
      const res = await parser.getText();
      rawText = typeof res === 'string' ? res : (res?.text || '');
    } else if (typeof pdfParseModule === 'function') {
      const res = await pdfParseModule(pdfBuffer);
      rawText = res?.text || '';
    }

    // Clean up excessive blank lines & carriage returns
    const cleanedText = rawText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('-- ') && !line.endsWith(' --'))
      .join('\n');

    return cleanedText;
  } catch (err) {
    logger.error({ err }, 'Failed to parse PDF text');
    throw err;
  }
}

/**
 * Indexes the PDF dataset for a single product by ID, saving extracted text into products.dataset_text.
 *
 * @param {number} productId
 * @returns {Promise<{ success: boolean, productId: number, length: number, reason?: string }>}
 */
export async function indexProductPdfDataset(productId) {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, dataset FROM products WHERE id = ?',
      [productId]
    );

    if (rows.length === 0 || !rows[0].dataset) {
      return { success: false, productId, length: 0, reason: 'No dataset file attached' };
    }

    const product = rows[0];
    const filename = product.dataset;
    let pdfBuffer = null;

    // 1. Attempt reading from S3 Object Storage if configured
    if (isObjectStorageConfigured()) {
      try {
        const s3Key = `datasets/${filename}`;
        pdfBuffer = await getObjectBuffer(s3Key);
      } catch (err) {
        logger.warn({ err, filename }, 'Could not read PDF dataset from object storage, falling back to local disk');
      }
    }

    // 2. Fall back to local disk
    if (!pdfBuffer) {
      const filePath = path.join(LOCAL_DATASETS_DIR, filename);
      try {
        pdfBuffer = await fs.readFile(filePath);
      } catch (err) {
        logger.warn({ filePath }, 'PDF dataset file not found on local disk');
        return { success: false, productId, length: 0, reason: 'File not found on disk' };
      }
    }

    // 3. Extract text from PDF
    const extractedText = await extractTextFromPdfBuffer(pdfBuffer);

    if (!extractedText || !extractedText.trim()) {
      return { success: false, productId, length: 0, reason: 'No text extracted from PDF' };
    }

    // Cap at 100,000 characters (~20,000 words) per product datasheet to fit easily into DB & context
    const formattedText = extractedText.trim().slice(0, 100000);

    // 4. Update products.dataset_text in MySQL
    await pool.query(
      'UPDATE products SET dataset_text = ? WHERE id = ?',
      [formattedText, productId]
    );

    logger.info({ productId, filename, length: formattedText.length }, 'Successfully indexed product PDF dataset');
    return { success: true, productId, length: formattedText.length };
  } catch (err) {
    logger.error({ err, productId }, 'Error indexing product PDF dataset');
    throw err;
  }
}

/**
 * Indexes PDF datasets for all active products in a business store.
 *
 * @param {number} [businessId=1]
 * @returns {Promise<{ totalProcessed: number, indexedCount: number }>}
 */
export async function indexAllProductPdfDatasets(businessId = 1) {
  try {
    const [products] = await pool.query(
      "SELECT id, name, dataset FROM products WHERE business_id = ? AND dataset IS NOT NULL AND dataset != ''",
      [businessId]
    );

    let indexedCount = 0;
    for (const p of products) {
      const res = await indexProductPdfDataset(p.id);
      if (res.success) indexedCount++;
    }

    logger.info({ totalProcessed: products.length, indexedCount }, 'Completed batch PDF dataset indexing');
    return { totalProcessed: products.length, indexedCount };
  } catch (err) {
    logger.error({ err }, 'Error in indexAllProductPdfDatasets');
    throw err;
  }
}
