import pool from '../config/db.js';
import { TEMPLATE_DEFAULTS } from '../utils/emailLoader.js';

const ALLOWED_KEYS = ['about-us', 'footer-brand', 'site-settings', 'policies', 'currency-settings', 'shipping-settings', 'privacy-policy', 'payment-settings', 'hero-banners', 'announcement-bar', 'email-templates', 'homepage-seo', 'contact-us'];

const DEFAULTS = {
  'contact-us': {
    mainBranch: {
      tagline: 'MAIN BRANCH LOCATION',
      title: 'IT Solutions Lahore Store',
      address: 'Office # 19, 2nd Floor, Fazal Trade Center, Near Hafeez Center, Gulberg III, Lahore, Punjab 54660, Pakistan',
      phone: '+92 300 4265499',
      email: 'itsolutions543@gmail.com',
      hours: 'Monday – Saturday (10:00 AM – 8:00 PM PKT)',
      mapQuery: 'Fazal Trade Center Hafeez Center Gulberg III Lahore',
    },
    deliveryCard: {
      tagline: 'NATIONWIDE DELIVERY & BRANCH NETWORK',
      title: 'Serving All Cities Across Pakistan',
      description: 'We provide fast Cash on Delivery (COD) and courier dispatch to Lahore, Karachi, Islamabad, Rawalpindi, Faisalabad, Multan, Burewala, Peshawar, Quetta, and 200+ cities nationwide.',
      features: [
        { label: 'Official Brand Warranty', text: '100% Original products with brand support' },
        { label: 'Free Shipping', text: 'On your 1st order nationwide (Rs 180 standard)' },
        { label: '7-Day Return Guarantee', text: 'Hassle-free return & exchange policy' },
        { label: 'Dedicated Technical Support', text: 'Direct WhatsApp & phone assistance' },
      ],
    },
    regionalBranch: {
      title: 'Burewala Regional Branch',
      address: 'Store # 12, Main College Road, Burewala, Vehari, Punjab 61010',
      mapQuery: 'Main College Road Burewala',
    },
  },
  'homepage-seo': {
    title: "Pakistan's Premier Store for Mobile Accessories, CCTV Cameras, Smart Home & Networking",
    intro: "Welcome to IT Solutions — your authorized destination for genuine mobile accessories, CCTV security cameras, NVR video recorders, smart home appliances, networking devices, smart wearables, car accessories, and cooling electronics in Pakistan. Enjoy competitive pricing, official brand warranty, and fast nationwide Cash on Delivery.",
    columns: [
      {
        heading: 'Mobile & Audio Accessories',
        description: 'Shop fast chargers & power adapters, charging cables, high-capacity power banks, TWS wireless earbuds, wired earphones, phone coolers, power strips, and audio adapters.',
      },
      {
        heading: 'CCTV Cameras & NVR Recorders',
        description: 'Secure your property with indoor, outdoor, indoor & outdoor hybrid cameras, battery & solar cameras, and multi-channel Network Video Recorders (NVR).',
      },
      {
        heading: 'Smart Home & Wearables',
        description: 'Upgrade your living space with smart door locks, smart video doorbells, smart video door phones, and feature-rich smart watches.',
      },
      {
        heading: 'Networking, Car & Cooling Gear',
        description: 'Stay connected and powered with Wi-Fi routers, network switches, Wi-Fi adapters, connectors & plugs, car chargers, and portable handheld cooling fans.',
      },
    ],
  },
  'site-settings': {
    siteName: 'My Store',
    logo: null,
    favicon: null,
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
      "Welcome to IT Solutions Pakistan — your authorized online destination and trade supplier for genuine mobile accessories, CCTV security cameras, video recorders, smart home appliances, networking devices, smart wearables, car accessories, and cooling electronics. Headquartered near Hafeez Center in Gulberg III, Lahore, with our regional branch in Burewala, we have built a trusted reputation across Pakistan for delivering 100% authentic products backed by official brand warranties.",
      "Our comprehensive catalog is carefully curated across 8 core product departments to meet all your personal, home, and business technology needs. Browse our extensive selection of mobile accessories — including fast chargers & power adapters, charging & data cables, power banks, wireless earbuds, wired earphones, phone coolers, power strips & charging hubs, and audio adapters — alongside advanced CCTV security cameras featuring indoor, outdoor, battery, and solar-powered models. We also specialize in multi-channel Network Video Recorders (NVR), smart home appliances like video doorbells and smart door locks, enterprise networking devices including Wi-Fi routers and network switches, feature-rich smart watches, fast car chargers, and portable cooling fans. Every product is sourced directly from official brand distributors to guarantee genuine performance and authentic warranty coverage.",
      "Our mission is to provide a seamless, reliable tech shopping experience for customers nationwide. Enjoy fast Cash on Delivery (COD) to 200+ cities across Pakistan, hassle-free 7-day returns, and direct phone & WhatsApp customer support whenever you need assistance.",
    ],
    highlights: [
      { title: 'Official Brand Warranty', description: '100% genuine electronics across all categories sourced directly from authorized brand suppliers with official warranty protection.' },
      { title: 'Mobile & Wearable Tech', description: 'Fast chargers, power banks, wireless earbuds, charging cables, phone coolers, audio adapters, and feature-rich smart watches.' },
      { title: 'CCTV, NVR & Smart Home', description: 'Indoor & outdoor CCTV cameras, solar cameras, NVR video recorders, smart door locks, video doorbells & video door phones.' },
      { title: 'Nationwide COD & Fast Shipping', description: 'Express courier dispatch with Cash on Delivery (COD) to Lahore, Karachi, Islamabad, Rawalpindi, Burewala, and 200+ cities.' },
    ],
    storeAddress: 'Office # 19, 2nd Floor, Fazal Trade Center, Near Hafeez Center, Gulberg III, Lahore, Punjab 54660, Pakistan',
    storeTimings: 'Monday – Saturday (10:00 AM – 8:00 PM PKT)',
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
        heading: 'Exchange & Return Process (By Mail)',
        body: 'To request an exchange or return, contact our support team with your order number. Once approved, ship the parcel via courier (by mail) to our official store address. The replacement or refund is dispatched after the returned item passes inspection.',
      },
      {
        heading: 'Defective or Damaged Items',
        body: 'Defective or damaged items must be reported within 24 hours of delivery along with an unboxing video proof for immediate replacement.',
      },
      {
        heading: 'Warranty Claims',
        body: 'All products carry the manufacturer warranty stated on the product page. Warranty claims are coordinated directly with the relevant brand’s authorized service center.',
      },
      {
        heading: 'Refunds',
        body: 'Approved refunds are processed back to the original payment method within 7–10 business days of the returned item passing inspection.',
      },
      {
        heading: 'Return Shipping Charges',
        body: 'The customer is responsible for paying return shipping/courier charges when sending items back for inspection or exchange.',
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

// Only a handful of fields actually flow into places a wrong type would cause real damage
// (site-settings.logo is fetched server-side when generating invoices — see
// utils/invoiceGenerator.js — and would throw if it weren't a string; footer-brand.columns feeds
// array iteration on the storefront). This isn't a full schema for every key (see docs/AUDIT.md),
// just a guard against the concrete failure modes above plus an overall size cap so this endpoint
// can't be used to stuff an arbitrarily large blob into a row.
const MAX_CONTENT_BYTES = 200_000;
const FIELD_SHAPES = {
  'site-settings': { siteName: 'string', logo: 'string', favicon: 'string' },
  'payment-settings': { methods: 'object' },
  'hero-banners': { slides: 'array', sideBanners: 'array' },
  'footer-brand': { columns: 'array', social: 'object' },
};

function typeOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function shapeError(key, body) {
  const expected = FIELD_SHAPES[key];
  if (!expected) return null;
  for (const [field, expectedType] of Object.entries(expected)) {
    if (body[field] === undefined || body[field] === null) continue; // optional — DEFAULTS covers absence
    if (typeOf(body[field]) !== expectedType) {
      return `"${field}" must be a${expectedType === 'object' ? 'n' : ''} ${expectedType}`;
    }
  }
  return null;
}

export async function updateContent(req, res) {
  const { key } = req.params;
  if (!ALLOWED_KEYS.includes(key)) return res.status(404).json({ error: 'Unknown content key' });

  if (typeOf(req.body) !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON object' });
  }
  if (key === 'currency-settings' && !(req.body?.enabled?.length > 0)) {
    return res.status(400).json({ error: 'At least one currency must remain enabled' });
  }
  const shapeErr = shapeError(key, req.body);
  if (shapeErr) return res.status(400).json({ error: shapeErr });

  const serialized = JSON.stringify(req.body);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_CONTENT_BYTES) {
    return res.status(400).json({ error: 'Content is too large' });
  }

  await pool.query(
    'INSERT INTO site_content (business_id, content_key, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [req.business.id, key, serialized]
  );
  res.json({ message: 'Content updated' });
}
