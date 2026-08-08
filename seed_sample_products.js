import mysql from 'mysql2/promise';
import { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } from './config/env.js';

const SAMPLE_PRODUCTS = [
  {
    name: '4K Ultra HD Outdoor CCTV Camera',
    slug: '4k-ultra-hd-outdoor-cctv-camera',
    brand: 'Dahua',
    description: 'AI-powered 4K outdoor surveillance camera with night vision, motion detection, and weather resistance.',
    price: 18500,
    discount_price: 15999,
    stock: 25,
    image: 'https://lh3.googleusercontent.com/d/1fO2_k-Af938-ffnLMnTILSdtBI8b3gj5',
    is_featured: 1,
    is_new_arrival: 1,
    is_on_sale: 1,
  },
  {
    name: 'Smart WiFi Video Doorbell & Intercom',
    slug: 'smart-wifi-video-doorbell-intercom',
    brand: 'Ezviz',
    description: 'HD video doorbell with 2-way audio, chime box, night vision, and instant mobile notification.',
    price: 14500,
    discount_price: 12499,
    stock: 18,
    image: 'https://lh3.googleusercontent.com/d/1fO2_k-Af938-ffnLMnTILSdtBI8b3gj5',
    is_featured: 1,
    is_new_arrival: 1,
    is_on_sale: 1,
  },
  {
    name: '16-Channel 4K NVR Network Video Recorder',
    slug: '16-channel-4k-nvr-video-recorder',
    brand: 'Hikvision',
    description: 'Professional 16-channel NVR with 24/7 continuous recording, H.265+ compression, and remote mobile viewing.',
    price: 38000,
    discount_price: 34500,
    stock: 12,
    image: 'https://lh3.googleusercontent.com/d/1fO2_k-Af938-ffnLMnTILSdtBI8b3gj5',
    is_featured: 1,
    is_new_arrival: 1,
    is_on_sale: 0,
  },
  {
    name: 'Dual-Band WiFi 6 Gigabit Router',
    slug: 'dual-band-wifi-6-gigabit-router',
    brand: 'TP-Link',
    description: 'Next-gen WiFi 6 speeds up to 1.8 Gbps with 4 high-gain antennas and beamforming coverage.',
    price: 12999,
    discount_price: 10999,
    stock: 30,
    image: 'https://lh3.googleusercontent.com/d/1fO2_k-Af938-ffnLMnTILSdtBI8b3gj5',
    is_featured: 1,
    is_new_arrival: 1,
    is_on_sale: 1,
  },
  {
    name: 'Fingerprint Smart Door Lock with Keypad',
    slug: 'fingerprint-smart-door-lock-keypad',
    brand: 'Tuya',
    description: 'Biometric smart door lock supporting fingerprint, passcode, RFID card, physical key, and app unlock.',
    price: 24999,
    discount_price: 21999,
    stock: 15,
    image: 'https://lh3.googleusercontent.com/d/1fO2_k-Af938-ffnLMnTILSdtBI8b3gj5',
    is_featured: 1,
    is_new_arrival: 1,
    is_on_sale: 1,
  },
];

async function seed() {
  const conn = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });

  const [businessRows] = await conn.query('SELECT id FROM businesses WHERE slug = ?', ['main']);
  const businessId = businessRows[0]?.id || 1;

  for (const p of SAMPLE_PRODUCTS) {
    const [existing] = await conn.query(
      'SELECT id FROM products WHERE business_id = ? AND slug = ?',
      [businessId, p.slug]
    );

    if (existing.length === 0) {
      await conn.query(
        `INSERT INTO products 
        (business_id, name, slug, brand, description, price, discount_price, stock, image, is_featured, is_new_arrival, is_on_sale)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [businessId, p.name, p.slug, p.brand, p.description, p.price, p.discount_price, p.stock, p.image, p.is_featured, p.is_new_arrival, p.is_on_sale]
      );
      console.log(`Added sample product: ${p.name}`);
    } else {
      console.log(`Product "${p.name}" already exists, skipping.`);
    }
  }

  await conn.end();
  console.log('Seeding finished cleanly.');
}

seed().catch(console.error);
