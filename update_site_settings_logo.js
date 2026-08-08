import mysql from 'mysql2/promise';

async function main() {
  try {
    const connection = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'store_website'
    });

    const revertedValue = JSON.stringify({
      siteName: "IT SOLUTIONS",
      logo: null,
      favicon: null
    });

    await connection.execute(
      `UPDATE site_content SET value = ? WHERE content_key = 'site-settings'`,
      [revertedValue]
    );

    console.log('Successfully reverted site-settings logo to null!');
    await connection.end();
  } catch (err) {
    console.error('Error reverting site_content:', err.message);
  }
}

main();
