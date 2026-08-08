import mysql from 'mysql2/promise';

async function main() {
  try {
    const connection = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'store_website'
    });

    const [rows] = await connection.execute('SELECT * FROM site_content');
    console.log('site_content:', rows);
    await connection.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
