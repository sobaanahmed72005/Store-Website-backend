import pool from '../config/db.js';
import { TEMPLATE_DEFAULTS } from '../utils/emailLoader.js';

const ALLOWED_KEYS = ['about-us', 'footer-brand', 'site-settings', 'policies', 'currency-settings', 'shipping-settings', 'privacy-policy', 'payment-settings', 'hero-banners', 'announcement-bar', 'email-templates'];

const DEFAULTS = {
  'site-settings': {
    siteName: 'My Store',
    logo: null,
  },
  'currency-settings': {
    enabled: ['PKR', 'USD', 'GBP', 'AED'],
  },
  'shipping-settings': {
    fee: 1800,
  },
  'announcement-bar': {
    enabled: false,
    text: '🎉 MEGA SALE — Up to 50% off selected products! Limited time only.',
    bgColor: '#c62828',
    textColor: '#ffffff',
    speed: 25,
  },
  'hero-banners': {
    slides: [],
    sideBanners: [
      { image: '', tagline: '', title: '', description: '', cta: 'See Offers', href: '/shop', active: true },
      { image: '', tagline: '', title: '', description: '', cta: 'Buy Now', href: '/shop', active: true },
    ],
  },
  'payment-settings': {
    methods: {
      bank_transfer: { enabled: false, label: 'Bank Transfer', bankName: '', accountTitle: '', accountNumber: '', instructions: '' },
      jazzcash: { enabled: false, label: 'JazzCash', accountTitle: '', number: '', instructions: '' },
      easypaisa: { enabled: false, label: 'EasyPaisa', accountTitle: '', number: '', instructions: '' },
      cod: { enabled: false, label: 'Cash on Delivery', instructions: '' },
    },
  },
  'about-us': {
    paragraphs: [
      "Welcome to our store — one of the leading online destinations for computers, laptops, and accessories. Since our founding, we have been committed to bringing genuine, top-quality technology products to our customers.",
      'From leading laptop brands to graphic cards, monitors, and peripherals, our catalog is built for students, professionals, and gamers alike. We work directly with authorized distributors to make sure every product that reaches you comes with full manufacturer warranty and genuine support.',
    ],
    highlights: [
      { title: '100% Genuine Products', description: 'Every product we sell is sourced from authorized distributors with full manufacturer warranty.' },
      { title: 'One Official Store', description: 'We operate only one official store. Beware of fake stores claiming our name.' },
      { title: 'Nationwide Delivery', description: 'We ship laptops, components, and accessories to every major city.' },
      { title: 'After-Sales Support', description: 'Our team handles warranty claims, repairs, and exchanges directly so you are never left stranded.' },
    ],
    storeAddress: 'Add your store address in Admin → About Us Page.',
    storeTimings: 'Add your store timings in Admin → About Us Page.',
  },
  'footer-brand': {
    description: 'Welcome to our store. Update this description in Admin → Footer / Store Info.',
    address: 'Add your store address in Admin → Footer / Store Info.',
    phone: 'Add your phone number(s) in Admin → Footer / Store Info.',
    email: '',
    hours: 'Add your store timings in Admin → Footer / Store Info.',
    social: {
      facebook: '',
      twitter: '',
      instagram: '',
      youtube: '',
      whatsapp: '',
      tiktok: '',
    },
    columns: [
      {
        heading: 'Shop',
        links: [
          { label: 'All Products', href: '/products' },
          { label: 'Cart', href: '/cart' },
          { label: 'Track Order', href: '/account' },
        ],
      },
      {
        heading: 'Account',
        links: [
          { label: 'Sign Up', href: '/signup' },
          { label: 'Sign In', href: '/signin' },
          { label: 'My Account', href: '/account' },
        ],
      },
      {
        heading: 'Company',
        links: [
          { label: 'About Us', href: '/about-us' },
          { label: 'Contact Us', href: '/contact' },
          { label: 'Return & Exchange', href: '/return-exchange' },
          { label: 'Privacy Policy', href: '/privacy-policy' },
        ],
      },
    ],
    marqueeMessages: [
      'Add your announcement messages in Admin → Footer / Store Info.',
      'Prices may vary due to currency changes.',
      'We operate only one official store. Beware of fake stores claiming our name.',
    ],
  },
  policies: {
    pageTitle: 'Return & Exchange Policy',
    sections: [
      {
        heading: 'Return Window',
        body: 'Products can be returned within 7 days of delivery, provided they are unused, in their original packaging, and accompanied by the original invoice.',
      },
      {
        heading: 'Conditions for Return',
        body: 'Items must not be physically damaged or missing accessories. Software, opened consumables, and customized/build-to-order products are not eligible for return.',
      },
      {
        heading: 'Exchange Process',
        body: 'To request an exchange, contact our support team with your order number. Once approved, the replacement item is shipped after the original product is received and inspected.',
      },
      {
        heading: 'Warranty Claims',
        body: 'All products carry the manufacturer warranty stated on the product page. Warranty claims are coordinated directly with the relevant brand’s authorized service center.',
      },
      {
        heading: 'Refunds',
        body: 'Approved refunds are processed back to the original payment method within 7–10 business days of the returned item passing inspection.',
      },
    ],
  },
  'privacy-policy': {
    pageTitle: 'Privacy Policy',
    sections: [
      {
        heading: 'Information We Collect',
        body: 'When you create an account, place an order, or subscribe to our newsletter, we collect information such as your name, email address, phone number, and shipping address.',
      },
      {
        heading: 'How We Use Your Information',
        body: 'We use your information to process orders, provide customer support, send order and account-related notifications, and — if you subscribe — to send you promotional emails about new products and offers.',
      },
      {
        heading: 'Cookies',
        body: 'We use cookies and local storage to keep you signed in, remember your cart and currency preference, and understand how our store is used.',
      },
      {
        heading: 'Sharing Your Information',
        body: 'We do not sell your personal information. We only share it with service providers (such as payment and delivery partners) as needed to fulfill your order.',
      },
      {
        heading: 'Your Choices',
        body: 'You can unsubscribe from promotional emails at any time, and you can contact us to request that we update or delete your account information.',
      },
    ],
  },
  // Single source of truth is emailLoader.js's TEMPLATE_DEFAULTS — this is what the admin
  // content editor shows/edits, and getEmailTemplate() falls back to the exact same object
  // when actually sending a business's emails, so the two can never drift out of sync.
  'email-templates': TEMPLATE_DEFAULTS,
};

export async function getSiteName(businessId) {
  const [rows] = await pool.query('SELECT value FROM site_content WHERE business_id = ? AND content_key = ?', [businessId, 'site-settings']);
  if (rows.length === 0) return DEFAULTS['site-settings'].siteName;
  const value = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
  return value.siteName || DEFAULTS['site-settings'].siteName;
}

export async function getContent(req, res) {
  const { key } = req.params;
  if (!ALLOWED_KEYS.includes(key)) return res.status(404).json({ error: 'Unknown content key' });

  const [rows] = await pool.query('SELECT value FROM site_content WHERE business_id = ? AND content_key = ?', [req.business.id, key]);
  if (rows.length === 0) return res.json(DEFAULTS[key]);
  const value = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
  res.json(value);
}

export async function updateContent(req, res) {
  const { key } = req.params;
  if (!ALLOWED_KEYS.includes(key)) return res.status(404).json({ error: 'Unknown content key' });

  if (key === 'currency-settings' && !(req.body?.enabled?.length > 0)) {
    return res.status(400).json({ error: 'At least one currency must remain enabled' });
  }

  await pool.query(
    'INSERT INTO site_content (business_id, content_key, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [req.business.id, key, JSON.stringify(req.body)]
  );
  res.json({ message: 'Content updated' });
}
