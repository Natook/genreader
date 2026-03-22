require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function resetData() {
    try {
        console.log('Clearing all data...');

        // Truncate tables (CASCADE will also clear files since it references users)
        await pool.query('TRUNCATE TABLE users CASCADE');
        await pool.query('TRUNCATE TABLE session');

        console.log('✅ All data cleared successfully!');
        console.log('You can now register a new account.');

        await pool.end();
        process.exit(0);
    } catch (error) {
        console.error('❌ Failed to clear data:', error.message);
        process.exit(1);
    }
}

resetData();
