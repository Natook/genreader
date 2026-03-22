require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SqliteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');

const app = express();
const port = process.env.PORT || 3000;

// Trust proxy - required for secure cookies behind Fly.io proxy
app.set('trust proxy', 1);

// Use /data in production (Fly.io volume), ./data locally
const isProduction = process.env.NODE_ENV === 'production';
const dataDir = isProduction ? '/data' : path.join(__dirname, 'data');

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Database connection
const dbPath = path.join(dataDir, 'gedcom.db');
const db = new sqlite3.Database(dbPath);

// Custom promisified database methods that preserve 'this'
const dbRun = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
};

const dbGet = promisify(db.get.bind(db));
const dbAll = promisify(db.all.bind(db));

// Initialize database schema if tables don't exist
async function initializeDatabaseSchema() {
    try {
        // Check if users table exists
        const tableCheck = await dbGet(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
        );

        if (!tableCheck) {
            console.log('Initializing database schema...');
            const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

            // Execute schema synchronously
            await new Promise((resolve, reject) => {
                db.exec(schema, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            console.log('✅ Database schema initialized successfully');
        } else {
            console.log('Database schema already exists');
        }
    } catch (error) {
        console.error('❌ Failed to initialize database schema:', error);
        process.exit(1);
    }
}

// Uploads directory - store inside data directory for single volume
const uploadsDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const userDir = path.join(uploadsDir, req.session.userId.toString());
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }
        cb(null, userDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (path.extname(file.originalname).toLowerCase() === '.ged') {
            cb(null, true);
        } else {
            cb(new Error('Only .ged files are allowed'));
        }
    }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    store: new SqliteStore({
        db: 'sessions.db',
        dir: dataDir
    }),
    secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Serve static files
app.use(express.static('public'));

// Authentication middleware
const requireAuth = (req, res, next) => {
    if (req.session.userId) {
        next();
    } else {
        res.status(401).json({ error: 'Not authenticated' });
    }
};

// Routes
app.post('/api/register', async (req, res) => {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    try {
        // Check if user already exists
        const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [email]);

        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const result = await dbRun('INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
            [email, hashedPassword, name]);
        const user = { id: result.lastID, email, name };

        req.session.userId = user.id;
        res.json({ success: true, user });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
        const user = await dbGet('SELECT id, email, name, password FROM users WHERE email = ?', [email]);

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        req.session.userId = user.id;
        res.json({
            success: true,
            user: { id: user.id, email: user.email, name: user.name }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/user', requireAuth, async (req, res) => {
    try {
        const user = await dbGet('SELECT id, email, name FROM users WHERE id = ?', [req.session.userId]);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ user });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Failed to get user' });
    }
});

app.post('/api/upload', requireAuth, upload.single('gedcomFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        // Fix UTF-8 encoding for filename (multer receives it as latin1)
        const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

        // Save file info to database
        const result = await dbRun('INSERT INTO files (user_id, filename, original_name, file_path) VALUES (?, ?, ?, ?)',
            [req.session.userId, req.file.filename, originalName, req.file.path]);
        const file = await dbGet('SELECT id, filename, original_name, uploaded_at FROM files WHERE id = ?', [result.lastID]);

        res.json({ success: true, file });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Failed to save file' });
    }
});

app.get('/api/files', requireAuth, async (req, res) => {
    try {
        const files = await dbAll('SELECT id, filename, original_name, uploaded_at FROM files WHERE user_id = ? ORDER BY uploaded_at DESC',
            [req.session.userId]);

        res.json({ files });
    } catch (error) {
        console.error('Get files error:', error);
        res.status(500).json({ error: 'Failed to get files' });
    }
});

app.get('/api/files/:filename', requireAuth, async (req, res) => {
    try {
        const file = await dbGet('SELECT file_path FROM files WHERE user_id = ? AND filename = ?',
            [req.session.userId, req.params.filename]);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        res.sendFile(file.file_path);
    } catch (error) {
        console.error('Get file error:', error);
        res.status(500).json({ error: 'Failed to get file' });
    }
});

app.delete('/api/files/:id', requireAuth, async (req, res) => {
    try {
        const file = await dbGet('SELECT file_path FROM files WHERE id = ? AND user_id = ?',
            [req.params.id, req.session.userId]);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Delete file from disk
        if (fs.existsSync(file.file_path)) {
            fs.unlinkSync(file.file_path);
        }

        // Delete from database
        await dbRun('DELETE FROM files WHERE id = ? AND user_id = ?',
            [req.params.id, req.session.userId]);

        res.json({ success: true });
    } catch (error) {
        console.error('Delete file error:', error);
        res.status(500).json({ error: 'Failed to delete file' });
    }
});

// Update note in GEDCOM file
app.post('/api/update-note', requireAuth, async (req, res) => {
    const { fileId, personId, noteIndex, noteText } = req.body;

    if (fileId === undefined || !personId || noteIndex === undefined || noteText === undefined) {
        return res.status(400).json({ error: 'File ID, person ID, note index, and note text are required' });
    }

    try {
        // Get the file
        const file = await dbGet('SELECT file_path FROM files WHERE id = ? AND user_id = ?',
            [fileId, req.session.userId]);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Read the GEDCOM file
        const gedcomContent = fs.readFileSync(file.file_path, 'utf8');
        const lines = gedcomContent.split('\n');

        let newLines = [];
        let currentPerson = null;
        let currentNoteIndex = -1;
        let inTargetPerson = false;
        let noteFound = false;
        let skipNextLines = 0;

        for (let i = 0; i < lines.length; i++) {
            if (skipNextLines > 0) {
                // Skip CONC/CONT lines of the old note
                if (lines[i].trim().match(/^[12] (CONC|CONT)/)) {
                    skipNextLines--;
                    continue;
                }
                skipNextLines = 0;
            }

            const line = lines[i];
            const trimmed = line.trim();

            // Check for individual record
            if (trimmed.startsWith('0 ') && trimmed.includes(' INDI')) {
                const match = trimmed.match(/^0 (@[^@]+@) INDI/);
                if (match) {
                    currentPerson = match[1];
                    inTargetPerson = (currentPerson === personId);
                    currentNoteIndex = -1;
                }
            }

            // If we're in the target person and find a NOTE tag
            if (inTargetPerson && trimmed.match(/^1 NOTE/)) {
                currentNoteIndex++;

                if (currentNoteIndex === noteIndex) {
                    // Replace this note
                    newLines.push('1 NOTE ' + noteText);
                    noteFound = true;
                    // Count how many CONC/CONT lines to skip
                    let j = i + 1;
                    while (j < lines.length && lines[j].trim().match(/^[12] (CONC|CONT)/)) {
                        skipNextLines++;
                        j++;
                    }
                    continue;
                }
            }

            newLines.push(line);
        }

        if (!noteFound) {
            return res.status(404).json({ error: 'Note not found in GEDCOM file' });
        }

        // Write the updated GEDCOM file
        fs.writeFileSync(file.file_path, newLines.join('\n'), 'utf8');

        res.json({ success: true });
    } catch (error) {
        console.error('Update note error:', error);
        res.status(500).json({ error: 'Failed to update note' });
    }
});

// Add new note to GEDCOM file
app.post('/api/add-note', requireAuth, async (req, res) => {
    const { fileId, personId, noteText } = req.body;

    if (fileId === undefined || !personId || noteText === undefined) {
        return res.status(400).json({ error: 'File ID, person ID, and note text are required' });
    }

    try {
        // Get the file
        const file = await dbGet('SELECT file_path FROM files WHERE id = ? AND user_id = ?',
            [fileId, req.session.userId]);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Read the GEDCOM file
        const gedcomContent = fs.readFileSync(file.file_path, 'utf8');
        const lines = gedcomContent.split('\n');

        let newLines = [];
        let inTargetPerson = false;
        let noteAdded = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Check for individual record
            if (trimmed.startsWith('0 ')) {
                if (trimmed.includes(' INDI')) {
                    const match = trimmed.match(/^0 (@[^@]+@) INDI/);
                    if (match && match[1] === personId) {
                        inTargetPerson = true;
                        newLines.push(line);
                        continue;
                    } else if (inTargetPerson) {
                        // We've reached the next record, add note before this
                        newLines.push('1 NOTE ' + noteText);
                        noteAdded = true;
                        inTargetPerson = false;
                    }
                } else if (inTargetPerson) {
                    // We've reached a non-INDI level 0 record, add note before this
                    newLines.push('1 NOTE ' + noteText);
                    noteAdded = true;
                    inTargetPerson = false;
                }
            }

            newLines.push(line);
        }

        // If we reached the end of file and haven't added the note yet, add it now
        if (inTargetPerson && !noteAdded) {
            newLines.push('1 NOTE ' + noteText);
            noteAdded = true;
        }

        if (!noteAdded) {
            return res.status(404).json({ error: 'Person not found in GEDCOM file' });
        }

        // Write the updated GEDCOM file
        fs.writeFileSync(file.file_path, newLines.join('\n'), 'utf8');

        res.json({ success: true });
    } catch (error) {
        console.error('Add note error:', error);
        res.status(500).json({ error: 'Failed to add note' });
    }
});

// Health check for Fly.io
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Start server after database is initialized
initializeDatabaseSchema().then(() => {
    app.listen(port, () => {
        console.log(`Server running on port ${port}`);
    });
}).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
