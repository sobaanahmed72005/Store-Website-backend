import mysql from 'mysql2/promise';

async function main() {
  try {
    const connection = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'store_website'
    });

    console.log('Connected to MySQL database!');
    await connection.execute(`UPDATE site_settings SET value = 'logo-globe.png' WHERE key_name = 'logo'`);
    await connection.execute(`INSERT INTO site_settings (key_name, value) VALUES ('logo', 'logo-globe.png') ON DUPLICATE KEY UPDATE value = 'logo-globe.png'`);
    console.log('Successfully updated logo in site_settings table!');
    await connection.end();
  } catch (err) {
    console.error('Error updating site_settings:', err.message);
  }
}

main();
