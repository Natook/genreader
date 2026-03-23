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
const { GedcomParser, DatabaseImporter } = require('./import-gedcom');
const { RelationshipCalculator } = require('./calculate-relationships');

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
        // Fix UTF-8 encoding for filename (multer receives it as latin1)
        const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        cb(null, Date.now() + '-' + originalName);
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
        const fileId = result.lastID;

        // Parse and import GEDCOM data
        console.log(`Processing GEDCOM file: ${originalName}`);
        const gedcomContent = fs.readFileSync(req.file.path, 'utf8');
        const parser = new GedcomParser();
        const parsedData = parser.parse(gedcomContent);

        console.log(`Parsed ${parsedData.individuals.length} individuals, ${parsedData.families.length} families`);

        // Import into database
        const importer = new DatabaseImporter(db);
        const importStats = await importer.importParsedData(fileId, parsedData);

        // Set root person (first individual) and calculate relationships
        if (importStats.individualCount > 0) {
            const firstIndividual = await dbGet(
                'SELECT id FROM individuals WHERE file_id = ? ORDER BY id LIMIT 1',
                [fileId]
            );

            if (firstIndividual) {
                await dbRun(
                    'UPDATE files SET root_person_id = ? WHERE id = ?',
                    [firstIndividual.id, fileId]
                );

                // Calculate relationships
                console.log('Calculating relationships...');
                const calculator = new RelationshipCalculator(db);
                await calculator.calculateAllRelationships(fileId, firstIndividual.id);
            }
        }

        const file = await dbGet('SELECT id, filename, original_name, uploaded_at FROM files WHERE id = ?', [fileId]);

        res.json({
            success: true,
            file,
            stats: importStats
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Failed to process file: ' + error.message });
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

        // Delete from database (cascade will delete related data)
        await dbRun('DELETE FROM files WHERE id = ? AND user_id = ?',
            [req.params.id, req.session.userId]);

        res.json({ success: true });
    } catch (error) {
        console.error('Delete file error:', error);
        res.status(500).json({ error: 'Failed to delete file' });
    }
});

// Get all individuals from a file with their relationships
app.get('/api/files/:fileId/individuals', requireAuth, async (req, res) => {
    try {
        const file = await dbGet('SELECT id, root_person_id FROM files WHERE id = ? AND user_id = ?',
            [req.params.fileId, req.session.userId]);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Get all individuals with their primary names and relationships
        const individuals = await dbAll(
            `SELECT 
                i.id, i.gedcom_id, i.sex, i.is_living,
                n.given_name, n.surname, n.full_name,
                r.relationship_text, r.relationship_type, r.generations,
                b.date_text as birth_date, b.place_text as birth_place,
                d.date_text as death_date, d.place_text as death_place
             FROM individuals i
             LEFT JOIN names n ON i.id = n.individual_id AND n.is_primary = 1
             LEFT JOIN relationships r ON i.id = r.to_person_id AND r.from_person_id = ?
             LEFT JOIN events b ON i.id = b.individual_id AND b.type = 'birt'
             LEFT JOIN events d ON i.id = d.individual_id AND d.type = 'deat'
             WHERE i.file_id = ?
             ORDER BY n.surname, n.given_name`,
            [file.root_person_id, req.params.fileId]
        );

        res.json({ individuals, rootPersonId: file.root_person_id });
    } catch (error) {
        console.error('Get individuals error:', error);
        res.status(500).json({ error: 'Failed to get individuals' });
    }
});

// Get detailed information about a specific individual
app.get('/api/individuals/:id', requireAuth, async (req, res) => {
    try {
        // Get individual basic info
        const individual = await dbGet(
            `SELECT i.*, f.user_id, f.id as file_id
             FROM individuals i
             JOIN files f ON i.file_id = f.id
             WHERE i.id = ? AND f.user_id = ?`,
            [req.params.id, req.session.userId]
        );

        if (!individual) {
            return res.status(404).json({ error: 'Individual not found' });
        }

        // Get all names
        const names = await dbAll(
            'SELECT * FROM names WHERE individual_id = ? ORDER BY is_primary DESC',
            [req.params.id]
        );

        // Get all events
        const events = await dbAll(
            'SELECT * FROM events WHERE individual_id = ? ORDER BY date_sort',
            [req.params.id]
        );

        // Get notes
        const notes = await dbAll(
            'SELECT * FROM notes WHERE entity_type = ? AND entity_id = ?',
            ['individual', req.params.id]
        );

        // Get parent families
        const parentFamilies = await dbAll(
            `SELECT f.id, f.gedcom_id,
                    h.id as father_id, hn.full_name as father_name,
                    w.id as mother_id, wn.full_name as mother_name
             FROM family_members fm
             JOIN families f ON fm.family_id = f.id
             LEFT JOIN family_members hm ON f.id = hm.family_id AND hm.role = 'parent'
             LEFT JOIN individuals h ON hm.individual_id = h.id AND h.sex = 'M'
             LEFT JOIN names hn ON h.id = hn.individual_id AND hn.is_primary = 1
             LEFT JOIN family_members wm ON f.id = wm.family_id AND wm.role = 'parent' AND wm.individual_id != h.id
             LEFT JOIN individuals w ON wm.individual_id = w.id AND w.sex = 'F'
             LEFT JOIN names wn ON w.id = wn.individual_id AND wn.is_primary = 1
             WHERE fm.individual_id = ? AND fm.role = 'child'`,
            [req.params.id]
        );

        // Get spouse families
        const spouseFamilies = await dbAll(
            `SELECT f.id, f.gedcom_id,
                    spouse.id as spouse_id, sn.full_name as spouse_name, spouse.sex as spouse_sex,
                    me.date_text as marriage_date, me.place_text as marriage_place
             FROM family_members fm
             JOIN families f ON fm.family_id = f.id
             LEFT JOIN events me ON f.marriage_event_id = me.id
             LEFT JOIN family_members sm ON f.id = sm.family_id AND sm.role = 'parent' AND sm.individual_id != ?
             LEFT JOIN individuals spouse ON sm.individual_id = spouse.id
             LEFT JOIN names sn ON spouse.id = sn.individual_id AND sn.is_primary = 1
             WHERE fm.individual_id = ? AND fm.role = 'parent'`,
            [req.params.id, req.params.id]
        );

        // Get children for each spouse family
        for (const family of spouseFamilies) {
            const children = await dbAll(
                `SELECT i.id, i.sex, n.full_name, n.given_name, n.surname
                 FROM family_members fm
                 JOIN individuals i ON fm.individual_id = i.id
                 LEFT JOIN names n ON i.id = n.individual_id AND n.is_primary = 1
                 WHERE fm.family_id = ? AND fm.role = 'child'`,
                [family.id]
            );
            family.children = children;
        }

        // Get relationship to root person
        const relationship = await dbGet(
            `SELECT r.relationship_text, r.relationship_type, r.generations
             FROM relationships r
             JOIN files f ON r.file_id = f.id
             WHERE r.to_person_id = ? AND r.from_person_id = f.root_person_id AND f.user_id = ?`,
            [req.params.id, req.session.userId]
        );

        res.json({
            individual,
            names,
            events,
            notes,
            parentFamilies,
            spouseFamilies,
            relationship
        });
    } catch (error) {
        console.error('Get individual details error:', error);
        res.status(500).json({ error: 'Failed to get individual details' });
    }
});

// Update individual's note
app.post('/api/individuals/:id/notes', requireAuth, async (req, res) => {
    const { noteText } = req.body;

    if (!noteText) {
        return res.status(400).json({ error: 'Note text is required' });
    }

    try {
        // Verify user owns this individual's file
        const individual = await dbGet(
            `SELECT i.id
             FROM individuals i
             JOIN files f ON i.file_id = f.id
             WHERE i.id = ? AND f.user_id = ?`,
            [req.params.id, req.session.userId]
        );

        if (!individual) {
            return res.status(404).json({ error: 'Individual not found' });
        }

        // Add note
        await dbRun(
            'INSERT INTO notes (entity_type, entity_id, text) VALUES (?, ?, ?)',
            ['individual', req.params.id, noteText]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Add note error:', error);
        res.status(500).json({ error: 'Failed to add note' });
    }
});

// Update a note
app.put('/api/notes/:id', requireAuth, async (req, res) => {
    const { noteText } = req.body;

    if (!noteText) {
        return res.status(400).json({ error: 'Note text is required' });
    }

    try {
        // Verify user owns this note's file
        const note = await dbGet(
            `SELECT n.id
             FROM notes n
             JOIN individuals i ON n.entity_id = i.id AND n.entity_type = 'individual'
             JOIN files f ON i.file_id = f.id
             WHERE n.id = ? AND f.user_id = ?`,
            [req.params.id, req.session.userId]
        );

        if (!note) {
            return res.status(404).json({ error: 'Note not found' });
        }

        // Update note
        await dbRun(
            'UPDATE notes SET text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [noteText, req.params.id]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Update note error:', error);
        res.status(500).json({ error: 'Failed to update note' });
    }
});

// Delete a note
app.delete('/api/notes/:id', requireAuth, async (req, res) => {
    try {
        // Verify user owns this note's file
        const note = await dbGet(
            `SELECT n.id
             FROM notes n
             JOIN individuals i ON n.entity_id = i.id AND n.entity_type = 'individual'
             JOIN files f ON i.file_id = f.id
             WHERE n.id = ? AND f.user_id = ?`,
            [req.params.id, req.session.userId]
        );

        if (!note) {
            return res.status(404).json({ error: 'Note not found' });
        }

        await dbRun('DELETE FROM notes WHERE id = ?', [req.params.id]);

        res.json({ success: true });
    } catch (error) {
        console.error('Delete note error:', error);
        res.status(500).json({ error: 'Failed to delete note' });
    }
});

// Set root person for relationship calculations
app.post('/api/files/:fileId/set-root', requireAuth, async (req, res) => {
    const { individualId } = req.body;

    if (!individualId) {
        return res.status(400).json({ error: 'Individual ID is required' });
    }

    try {
        const file = await dbGet('SELECT id FROM files WHERE id = ? AND user_id = ?',
            [req.params.fileId, req.session.userId]);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Update root person
        await dbRun('UPDATE files SET root_person_id = ? WHERE id = ?',
            [individualId, req.params.fileId]);

        // Recalculate relationships
        console.log(`Recalculating relationships for file ${req.params.fileId} from person ${individualId}...`);
        const calculator = new RelationshipCalculator(db);
        await calculator.calculateAllRelationships(req.params.fileId, individualId);

        res.json({ success: true });
    } catch (error) {
        console.error('Set root person error:', error);
        res.status(500).json({ error: 'Failed to set root person' });
    }
});

// Legacy GEDCOM file manipulation endpoints are deprecated
// Use the new database-backed API endpoints instead:
// POST /api/individuals/:id/notes - Add note to individual
// PUT /api/notes/:id - Update note
// DELETE /api/notes/:id - Delete note

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
