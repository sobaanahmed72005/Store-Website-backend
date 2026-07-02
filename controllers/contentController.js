import pool from '../config/db.js';

const ALLOWED_KEYS = ['about-us', 'footer-brand', 'site-settings', 'policies', 'currency-settings', 'shipping-settings', 'privacy-policy', 'payment-settings', 'hero-banners', 'announcement-bar', 'email-templates'];

const DEFAULTS = {
  'site-settings': {
    siteName: 'YourITstore',
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
      "YourITstore is one of Pakistan's leading online computer stores, offering laptops, desktops, gaming consoles, components, and accessories at the best prices in Pakistan. Since our founding, we have been committed to bringing genuine, top-quality technology products to customers across the country.",
      'From Dell, Lenovo, HP, and Acer laptops to graphic cards, monitors, and peripherals, our catalog is built for students, professionals, and gamers alike. We work directly with authorized distributors to make sure every product that reaches you comes with full manufacturer warranty and genuine support.',
    ],
    highlights: [
      { title: '100% Genuine Products', description: 'Every product we sell is sourced from authorized distributors with full manufacturer warranty.' },
      { title: 'One Official Store', description: 'YourITstore operates only one official store. Beware of fake stores claiming our name.' },
      { title: 'Nationwide Delivery', description: 'We ship laptops, components, and accessories to every major city across Pakistan.' },
      { title: 'After-Sales Support', description: 'Our team handles warranty claims, repairs, and exchanges directly so you are never left stranded.' },
    ],
    storeAddress: 'FL 4/20, Main Rashid Minhas Road, Gulshan-e-Iqbal Block-5, Karachi, Pakistan.',
    storeTimings: 'Mon–Thu and Sat: 11 AM – 8 PM | Fri: 11 AM – 1 PM, 2:30 PM – 8 PM | Sun: Closed',
  },
  'footer-brand': {
    description: 'Welcome to YourITstore. Online computer store in Pakistan. Buy Dell, Lenovo, HP, Acer laptops at the best prices in Pakistan.',
    address: 'FL 4/20, Main Rashid Minhas Road, Gulshan-e-Iqbal Block-5, Karachi, Pakistan.',
    phone: '+922134817355 | +922134155030 | +922134960583',
    email: 'info@youritstore.com',
    hours: 'Mon–Thu and Sat: 11 AM – 8 PM | Fri: 11 AM – 1 PM, 2:30 PM – 8 PM | Sun: Closed',
    social: {
      facebook: 'https://www.facebook.com/czoneonline/',
      twitter: '',
      instagram: '',
      youtube: '',
      whatsapp: 'https://whatsapp.com/channel/0029VaCWq4v90x2qT9L1kf13',
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
      'Store Timings: Mon–Thu and Sat: 11 AM – 8 PM | Fri: 11 AM – 1 PM, 2:30 PM – 8 PM | Sun: Closed',
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
  'email-templates': {
    signup: {
      subject: 'Verify your email address',
      message: "Thanks for creating an account with us! To get started, please verify your email address by clicking the button below.",
    },
    order_received: {
      subject: 'Order #{{order_id}} received — thank you!',
      message: "Thanks for your order! We've received it and our team is reviewing it now. You'll receive another email as soon as your order is confirmed.",
    },
    order_confirmed: {
      subject: 'Order #{{order_id}} confirmed ✓',
      message: 'Great news! Your order has been confirmed and our team is now preparing it for dispatch.',
    },
    order_packed: {
      subject: 'Order #{{order_id}} is packed and ready',
      message: 'Your order has been carefully packed and will be handed to the courier very soon.',
    },
    order_shipped: {
      subject: 'Order #{{order_id}} is on its way! 🚚',
      message: 'Your order has shipped and is on its way to you via our courier partner.',
    },
    order_out_for_delivery: {
      subject: 'Order #{{order_id}} is out for delivery today!',
      message: 'Your order is out for delivery and should arrive at your door today. Please make sure someone is available to receive it.',
    },
    order_delivered: {
      subject: 'Order #{{order_id}} delivered — enjoy! 🎉',
      message: 'Your order has been delivered. We hope you love your purchase! If you have any questions or concerns, feel free to reach out.',
    },
    order_cancelled: {
      subject: 'Order #{{order_id}} has been cancelled',
      message: 'Your order has been cancelled. If you did not request this cancellation or have any questions, please contact us immediately.',
    },
    order_returned: {
      subject: 'Order #{{order_id}} return processed',
      message: 'Your return for order #{{order_id}} has been processed. If you have questions about your refund or exchange, please contact us.',
    },
    review_reminder: {
      subject: 'How was your order #{{order_id}}? Share your review ⭐',
      message: "It's been 2 weeks since your order was delivered. We hope you're enjoying your purchase! Your honest review helps other customers make the right choice. It only takes a minute:",
    },
    password_reset: {
      subject: 'Reset your password',
      message: 'We received a request to reset your password. Click the button below to choose a new one. If you did not request this, you can safely ignore this email — your password will not be changed.',
    },
    newsletter_welcome: {
      subject: "You're subscribed! 🎉",
      message: "Thanks for subscribing to our newsletter! You'll be the first to know about new arrivals, sales, and exclusive offers.",
    },
  },
};

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
