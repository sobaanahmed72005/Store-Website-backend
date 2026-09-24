import mysql from 'mysql2/promise';
import { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } from '../config/env.js';
import { ensureMigrationsTable, hasRun, recordMigration } from './migrationRunner.js';

const MIGRATION_NAME = 'add-blog-posts-table';

export async function runMigration() {
  const connection = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });

  try {
    await ensureMigrationsTable(connection);
    if (await hasRun(connection, MIGRATION_NAME)) {
      console.log(`Migration "${MIGRATION_NAME}" already applied, skipping.`);
      await connection.end();
      return;
    }

    console.log(`Running migration "${MIGRATION_NAME}"...`);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS blog_posts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        business_id INT NOT NULL DEFAULT 1,
        title VARCHAR(255) NOT NULL,
        slug VARCHAR(255) NOT NULL,
        excerpt TEXT NOT NULL,
        content LONGTEXT NOT NULL,
        cover_image VARCHAR(500),
        category VARCHAR(100) DEFAULT 'Tech Guides',
        author VARCHAR(100) DEFAULT 'IT Solutions Team',
        read_time VARCHAR(50) DEFAULT '5 min read',
        featured_product_ids JSON,
        is_published TINYINT(1) NOT NULL DEFAULT 1,
        views INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY business_id_slug (business_id, slug),
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Seed initial high-converting blog posts if table is empty
    const [existing] = await connection.query('SELECT COUNT(*) as count FROM blog_posts WHERE business_id = 1');
    if (existing[0].count === 0) {
      const posts = [
        {
          title: 'Top 5 Best 4K CCTV Cameras in Pakistan (2026 Buying & Price Guide)',
          slug: 'top-5-best-4k-cctv-cameras-pakistan-buying-guide',
          excerpt: 'Looking for the best 4K CCTV security cameras for your home, office, or shop in Pakistan? Discover top-rated EZVIZ, Hikvision, and IMOU outdoor & indoor cameras with color night vision, 4G SIM support, and AI auto-tracking.',
          category: 'Security & Surveillance',
          author: 'IT Solutions Tech Team',
          read_time: '6 min read',
          cover_image: 'https://images.unsplash.com/photo-1557597774-9d273605dfa9?w=1200&q=80',
          featured_product_ids: JSON.stringify([17, 21, 22, 15, 20]),
          content: `
<h2>Why 4K CCTV Cameras are Essential for Security in Pakistan</h2>
<p>Securing your home, warehouse, or commercial office in Pakistan requires high-resolution video surveillance. Modern <strong>4K (8MP & 5MP) CCTV cameras</strong> provide crystal-clear image clarity, allowing you to easily read license plates, identify faces, and monitor night-time activity with full-color night vision.</p>

<h3>Key Features to Look for Before Buying:</h3>
<ul>
  <li><strong>Resolution:</strong> 3K (5MP) or 4K (8MP) for maximum detail over wide outdoor areas.</li>
  <li><strong>Connectivity:</strong> 4G SIM Card slot for remote locations without Wi-Fi (farms, construction sites, plazas).</li>
  <li><strong>Color Night Vision:</strong> Dual spotlights that activate automatically when human motion is detected.</li>
  <li><strong>Two-Way Audio:</strong> Built-in microphone and speaker for real-time conversation via mobile app.</li>
  <li><strong>Weatherproofing:</strong> IP65 or IP67 certified casing built for harsh Pakistani weather conditions.</li>
</ul>

<h2>1. EZVIZ CS-H8c Pro 3K 5MP Outdoor Camera</h2>
<p>The <strong>EZVIZ H8c Pro 3K</strong> is our #1 recommendation for outdoor surveillance in Lahore, Karachi, and Islamabad. Equipped with 360-degree motor rotation, AI human shape detection, and color night vision, it replaces multiple fixed cameras in a single installation.</p>

<h2>2. EZVIZ CS-H8c 4G 2K (3MP) — Best for Remote Locations</h2>
<p>If your location lacks a home Wi-Fi router, the <strong>EZVIZ H8c 4G</strong> connects directly to Jazz, Zong, Telenor, or Ufone 4G SIM cards. Perfect for farmhouses, parking lots, and remote shops.</p>

<h2>3. EZVIZ CS-H90 Dual 2K+ (Dual Lens 4MP + 4MP)</h2>
<p>The ultimate dual-lens security system! One lens stays stationary monitoring your main gate while the second motorized lens tracks movement across the yard.</p>

<h2>Conclusion & How to Buy in Pakistan</h2>
<p>All EZVIZ security cameras come with official manufacturer warranty and fast nationwide Cash on Delivery (COD) across 200+ Pakistani cities from <strong>IT Solutions</strong>.</p>
          `.trim()
        },
        {
          title: 'Wi-Fi 6 Routers in Pakistan: Complete Home & Office Buying Guide 2026',
          slug: 'wifi-6-routers-pakistan-buying-guide-2026',
          excerpt: 'Upgrade your internet speed with high-performance Wi-Fi 6 Gigabit routers in Pakistan. Compare speed, coverage, dual-band stability, and seamless mesh networking for PTCL, Nayatel, and StormFiber connections.',
          category: 'Networking',
          author: 'IT Solutions Tech Team',
          read_time: '5 min read',
          cover_image: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=1200&q=80',
          featured_product_ids: JSON.stringify([19, 5]),
          content: `
<h2>Why Upgrade to Wi-Fi 6 (802.11ax) in Pakistan?</h2>
<p>With fiber-optic internet connections (Nayatel, StormFiber, Transworld, PTCL Flash Fiber) offering 50Mbps to 500Mbps speeds across Pakistan, standard Wi-Fi 5 routers often create bottleneck slowdowns. <strong>Wi-Fi 6 routers</strong> deliver 3x faster wireless speeds, lower latency for online gaming, and handle up to 50 connected devices without lag.</p>

<h3>Benefits of Wi-Fi 6 Routers:</h3>
<ul>
  <li><strong>Gigabit Speeds:</strong> Dual-band combined speeds of up to 3000 Mbps.</li>
  <li><strong>OFDMA & MU-MIMO:</strong> Smooth 4K video streaming and gaming on smartphones, laptops, and smart TVs simultaneously.</li>
  <li><strong>Enhanced Security:</strong> WPA3 encryption protecting your home network from unauthorized access.</li>
  <li><strong>Target Wake Time (TWT):</strong> Reduces battery consumption on connected mobile phones.</li>
</ul>

<h2>How to Choose the Right Router for Your Home:</h2>
<p>For a standard 1-Kanal or 10-Marla house in Pakistan, select a dual-band Gigabit Wi-Fi 6 router with high-gain external antennas. If you live in a multi-story house with thick concrete walls, pair your main router with mesh extenders.</p>

<h2>Order Original Routers with Official Warranty</h2>
<p>Get original routers with brand warranty and fast Cash on Delivery at <strong>IT Solutions Pakistan</strong>!</p>
          `.trim()
        }
      ];

      for (const p of posts) {
        await connection.query(
          `INSERT INTO blog_posts (business_id, title, slug, excerpt, content, category, author, read_time, cover_image, featured_product_ids, is_published)
           VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [p.title, p.slug, p.excerpt, p.content, p.category, p.author, p.read_time, p.cover_image, p.featured_product_ids]
        );
      }
      console.log('Seeded 2 initial tech buying guides into blog_posts table.');
    }

    await recordMigration(connection, MIGRATION_NAME);
    console.log(`Migration "${MIGRATION_NAME}" completed successfully.`);
  } catch (err) {
    console.error(`Error executing migration "${MIGRATION_NAME}":`, err);
    throw err;
  } finally {
    await connection.end();
  }
}

// Allow direct execution via CLI
if (process.argv[1] && process.argv[1].endsWith('migrate-blog.js')) {
  runMigration().then(() => process.exit(0)).catch(() => process.exit(1));
}
