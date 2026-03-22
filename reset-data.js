require('dotenv').config(); const sqlite3 = require('sqlite3').verbose(); const path = require('path'); const fs = require('fs'); function resetData() {
    const dataDir = path.join(__dirname, 'data'); const dbPath = path.join(dataDir, 'gedcom.db'); if (!fs.existsSync(dbPath)) { console.log('Database does not exist. Nothing to reset.'); process.exit(0); } console.log('Clearing all data...'); const db = new sqlite3.Database(dbPath); db.serialize(() => {        // Delete all data (CASCADE will also clear files since it references users)        db.run('DELETE FROM files', (err) => {            if (err) console.error('Error deleting files:', err);        });                db.run('DELETE FROM users', (err) => {            if (err) console.error('Error deleting users:', err);        });        // Also clear session database        const sessionsPath = path.join(dataDir, 'sessions.db');        if (fs.existsSync(sessionsPath)) {            const sessionsDb = new sqlite3.Database(sessionsPath);            sessionsDb.run('DELETE FROM sessions', (err) => {                if (err) console.error('Error deleting sessions:', err);                sessionsDb.close();            });        }    });    db.close((err) => {        if (err) {            console.error('❌ Failed to clear data:', err.message);            process.exit(1);        }        console.log('✅ All data cleared successfully!');
        console.log('You can now register a new account.');
        process.exit(0);
    });
}

resetData();
