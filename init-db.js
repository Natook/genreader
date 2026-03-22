require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function initDatabase() {
    const dbUrl = new URL(process.env.DATABASE_URL);
    const dbName = dbUrl.pathname.slice(1); // Remove leading slash

    // First, connect to the default 'postgres' database to create our database if needed
    const defaultDbUrl = new URL(process.env.DATABASE_URL);
    defaultDbUrl.pathname = '/postgres';

    const defaultPool = new Pool({
        connectionString: defaultDbUrl.toString(),
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    try {
        console.log(`Checking if database '${dbName}' exists...`);

        // Check if database exists
        const result = await defaultPool.query(
            "SELECT 1 FROM pg_database WHERE datname = $1",
            [dbName]
        );

        if (result.rows.length === 0) {
            console.log(`Creating database '${dbName}'...`);
            await defaultPool.query(`CREATE DATABASE ${dbName}`);
            console.log('Database created successfully!');
        } else {
            console.log('Database already exists.');
        }

        await defaultPool.end();

        // Now connect to the actual database to create tables
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });

        console.log('Creating tables...');
        const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
        await pool.query(schema);

        await pool.end();

        console.log('✅ Database initialized successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Database initialization failed:', error.message);
        process.exit(1);
    }
}

initDatabase();
