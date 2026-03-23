/**
 * Migration Script: Reimport existing GEDCOM files into new database schema
 * Run this after updating to the new database schema
 */

require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { GedcomParser, DatabaseImporter } = require('./import-gedcom');
const { RelationshipCalculator } = require('./calculate-relationships');

const isProduction = process.env.NODE_ENV === 'production';
const dataDir = isProduction ? '/data' : path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'gedcom.db');

const db = new sqlite3.Database(dbPath);

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

async function migrateFiles() {
    console.log('🔄 Starting migration of existing GEDCOM files...\n');

    try {
        // Get all files that haven't been imported yet
        const files = await dbAll('SELECT * FROM files WHERE root_person_id IS NULL ORDER BY id');

        if (files.length === 0) {
            console.log('✅ No files need migration. All files are already imported!');
            process.exit(0);
        }

        console.log(`Found ${files.length} files to migrate\n`);

        for (const file of files) {
            console.log(`\n📁 Processing: ${file.original_name}`);
            console.log(`   File ID: ${file.id}`);
            console.log(`   User ID: ${file.user_id}`);

            if (!fs.existsSync(file.file_path)) {
                console.log(`   ⚠️  File not found at: ${file.file_path}`);
                console.log(`   Skipping...`);
                continue;
            }

            try {
                // Parse GEDCOM file
                const gedcomContent = fs.readFileSync(file.file_path, 'utf8');
                const parser = new GedcomParser();
                const parsedData = parser.parse(gedcomContent);

                console.log(`   📊 Parsed: ${parsedData.individuals.length} individuals, ${parsedData.families.length} families, ${parsedData.sources.length} sources`);

                // Import into database
                const importer = new DatabaseImporter(db);
                const stats = await importer.importParsedData(file.id, parsedData);

                console.log(`   ✅ Imported: ${stats.individualCount} individuals, ${stats.familyCount} families, ${stats.sourceCount} sources`);

                // Set root person and calculate relationships
                if (stats.individualCount > 0) {
                    const firstIndividual = await dbAll(
                        'SELECT id FROM individuals WHERE file_id = ? ORDER BY id LIMIT 1',
                        [file.id]
                    );

                    if (firstIndividual.length > 0) {
                        const rootId = firstIndividual[0].id;
                        await dbRun(
                            'UPDATE files SET root_person_id = ? WHERE id = ?',
                            [rootId, file.id]
                        );

                        console.log(`   🔗 Calculating relationships from person ${rootId}...`);
                        const calculator = new RelationshipCalculator(db);
                        const relCount = await calculator.calculateAllRelationships(file.id, rootId);
                        console.log(`   ✅ Calculated ${relCount} relationships`);
                    }
                }

                console.log(`   ✅ Successfully migrated: ${file.original_name}`);
            } catch (error) {
                console.error(`   ❌ Error migrating file:`, error.message);
                console.error(`   Stack:`, error.stack);
            }
        }

        console.log('\n\n✅ Migration completed!');
        console.log('\nYou can now use the new database-backed API endpoints.');
        console.log('\nNew API endpoints available:');
        console.log('  GET  /api/files/:fileId/individuals - Get all individuals with relationships');
        console.log('  GET  /api/individuals/:id - Get detailed individual information');
        console.log('  POST /api/individuals/:id/notes - Add note to individual');
        console.log('  PUT  /api/notes/:id - Update note');
        console.log('  POST /api/files/:fileId/set-root - Change root person for relationships');

    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    } finally {
        db.close();
    }
}

migrateFiles();
