require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

function initDatabase() {
    // Use /data in production (Fly.io volume), ./data locally
    const isProduction = process.env.NODE_ENV === 'production';
    const dataDir = isProduction ? '/data' : path.join(__dirname, 'data');
    
    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
        console.log('Created data directory');
    }

    // Create/open database
    const dbPath = path.join(dataDir, 'gedcom.db');
    console.log(`Initializing database at ${dbPath}...`);

    const db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
            console.error('❌ Database initialization failed:', err.message);
            process.exit(1);
        }
    });

    // Read and execute schema
    console.log('Creating tables...');
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

    db.exec(schema, (err) => {
        if (err) {
            console.error('❌ Database initialization failed:', err.message);
            db.close();
            process.exit(1);
        }

        db.close((err) => {
            if (err) {
                console.error('Error closing database:', err.message);
            }
            console.log('✅ Database initialized successfully!');
            process.exit(0);
        });
    });
}

initDatabase();
