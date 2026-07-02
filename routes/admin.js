import express from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { getStats, uploadImage } from '../controllers/adminController.js';
import {
  getRevenueTrend,
  getRevenueSummary,
  getTopProducts,
  getBottomProducts,
  getSalesByCity,
  getOrderStatusBreakdown,
  getPaymentMethodBreakdown,
  getOrderValueHistogram,
  getSaleSplit,
} from '../controllers/reportsController.js';
import {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  bulkSale,
} from '../controllers/productsController.js';
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../controllers/categoriesController.js';
import {
  getAllOrders,
  getNewOrders,
  getOrderById,
  updateOrderStatus,
  updateOrderTracking,
  downloadInvoice,
  bookOrderCourier,
} from '../controllers/ordersController.js';
import { updateContent } from '../controllers/contentController.js';
import { getCustomers, getCustomerById } from '../controllers/customersController.js';
import {
  listForCategory,
  createAttribute,
  renameAttribute,
  deleteAttribute,
  addOption,
  renameOption,
  deleteOption,
} from '../controllers/categoryAttributesController.js';
import { adminListReviews, adminCreateReview, adminDeleteReview, adminApproveReview } from '../controllers/reviewsController.js';
import { adminList, adminCreate, adminUpdate, adminDelete } from '../controllers/discountCodesController.js';
import {
  adminList as adminListSubscribers,
  adminDelete as adminDeleteSubscriber,
  adminSend as adminSendNewsletter,
} from '../controllers/newsletterController.js';
import { adminGet as adminGetCourier, adminUpdate as adminUpdateCourier, adminTestConnection as adminTestCourierConnection } from '../controllers/courierController.js';
import { adminGet as adminGetSafepay, adminUpdate as adminUpdateSafepay } from '../controllers/safepayController.js';
import {
  adminList as adminListPromoEmails,
  adminCreate as adminCreatePromoEmail,
  adminUpdate as adminUpdatePromoEmail,
  adminDelete as adminDeletePromoEmail,
  adminSend as adminSendPromoEmail,
} from '../controllers/promotionalEmailsController.js';

const router = express.Router();

router.use(requireAdmin);

router.get('/stats', getStats);
router.post('/upload', upload.single('image'), uploadImage);

router.get('/reports/revenue-trend', getRevenueTrend);
router.get('/reports/revenue-summary', getRevenueSummary);
router.get('/reports/top-products', getTopProducts);
router.get('/reports/bottom-products', getBottomProducts);
router.get('/reports/sales-by-city', getSalesByCity);
router.get('/reports/order-status-breakdown', getOrderStatusBreakdown);
router.get('/reports/payment-method-breakdown', getPaymentMethodBreakdown);
router.get('/reports/order-value-histogram', getOrderValueHistogram);
router.get('/reports/sale-split', getSaleSplit);

router.get('/products', getProducts);
router.post('/products/bulk-sale', bulkSale);
router.get('/products/:id', getProductById);
router.post('/products', createProduct);
router.put('/products/:id', updateProduct);
router.delete('/products/:id', deleteProduct);

router.get('/categories', getCategories);
router.post('/categories', createCategory);
router.put('/categories/:id', updateCategory);
router.delete('/categories/:id', deleteCategory);

router.get('/orders', getAllOrders);
router.get('/orders/new', getNewOrders);
router.get('/orders/:id/invoice', downloadInvoice);
router.get('/orders/:id', getOrderById);
router.put('/orders/:id/status', updateOrderStatus);
router.put('/orders/:id/tracking', updateOrderTracking);
router.post('/orders/:id/book-courier', bookOrderCourier);

router.put('/content/:key', updateContent);

router.get('/customers', getCustomers);
router.get('/customers/:id', getCustomerById);

router.get('/categories/:id/attributes', listForCategory);
router.post('/categories/:id/attributes', createAttribute);
router.patch('/attributes/:attrId', renameAttribute);
router.delete('/attributes/:attrId', deleteAttribute);
router.post('/attributes/:attrId/options', addOption);
router.patch('/options/:optId', renameOption);
router.delete('/options/:optId', deleteOption);

router.get('/reviews', adminListReviews);
router.post('/products/:id/reviews', adminCreateReview);
router.patch('/reviews/:id', adminApproveReview);
router.delete('/reviews/:id', adminDeleteReview);

router.get('/discount-codes', adminList);
router.post('/discount-codes', adminCreate);
router.patch('/discount-codes/:id', adminUpdate);
router.delete('/discount-codes/:id', adminDelete);

router.get('/newsletter', adminListSubscribers);
router.delete('/newsletter/:id', adminDeleteSubscriber);
router.post('/newsletter/send', adminSendNewsletter);

router.get('/courier-settings', adminGetCourier);
router.put('/courier-settings', adminUpdateCourier);
router.post('/courier-settings/test', adminTestCourierConnection);

router.get('/payment-gateways/safepay', adminGetSafepay);
router.put('/payment-gateways/safepay', adminUpdateSafepay);

router.get('/promo-emails', adminListPromoEmails);
router.post('/promo-emails', adminCreatePromoEmail);
router.put('/promo-emails/:id', adminUpdatePromoEmail);
router.delete('/promo-emails/:id', adminDeletePromoEmail);
router.post('/promo-emails/:id/send', adminSendPromoEmail);

export default router;
