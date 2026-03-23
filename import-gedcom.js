/**
 * GEDCOM Parser and Database Importer
 * Parses GEDCOM files and imports data into SQLite database
 */

const fs = require('fs');
const path = require('path');

class GedcomParser {
    constructor() {
        this.individuals = new Map();
        this.families = new Map();
        this.sources = new Map();
        this.currentEntity = null;
        this.currentEntityType = null;
        this.currentEvent = null;
        this.tagStack = [];
    }

    /**
     * Parse GEDCOM file format
     */
    parse(content) {
        // Split on line endings (handle both \r\n and \n)
        const lines = content.split(/\r?\n/);
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim()) continue;

            const parsed = this.parseLine(line);
            if (!parsed) continue;

            this.processLine(parsed, lines, i);
        }

        return {
            individuals: Array.from(this.individuals.values()),
            families: Array.from(this.families.values()),
            sources: Array.from(this.sources.values())
        };
    }

    parseLine(line) {
        const match = line.match(/^(\d+)\s+(@[^@]+@\s+)?(\w+)(\s+(.*))?$/);
        if (!match) return null;

        return {
            level: parseInt(match[1]),
            id: match[2] ? match[2].trim() : null,
            tag: match[3],
            value: match[5] ? match[5].trim() : ''
        };
    }

    processLine(parsed) {
        const { level, id, tag, value } = parsed;

        // Level 0 - Start of new entity
        if (level === 0) {
            this.tagStack = [];
            this.currentEvent = null;

            if (tag === 'INDI' && id) {
                this.currentEntity = {
                    gedcomId: id,
                    type: 'INDI',
                    sex: null,
                    names: [],
                    events: [],
                    parentFamilies: [],
                    spouseFamilies: [],
                    notes: [],
                    media: []
                };
                this.individuals.set(id, this.currentEntity);
                this.currentEntityType = 'INDI';
            } else if (tag === 'FAM' && id) {
                this.currentEntity = {
                    gedcomId: id,
                    type: 'FAM',
                    husband: null,
                    wife: null,
                    children: [],
                    events: [],
                    notes: [],
                    media: []
                };
                this.families.set(id, this.currentEntity);
                this.currentEntityType = 'FAM';
            } else if (tag === 'SOUR' && id) {
                this.currentEntity = {
                    gedcomId: id,
                    type: 'SOUR',
                    title: null,
                    author: null,
                    publication: null,
                    repository: null
                };
                this.sources.set(id, this.currentEntity);
                this.currentEntityType = 'SOUR';
            } else {
                this.currentEntity = null;
                this.currentEntityType = null;
            }
            return;
        }

        if (!this.currentEntity) return;

        // Update tag stack
        while (this.tagStack.length >= level) {
            this.tagStack.pop();
        }
        this.tagStack.push(tag);

        // Level 1 - Main tags
        if (level === 1) {
            this.currentEvent = null;

            if (this.currentEntityType === 'INDI') {
                this.processIndividualTag(tag, value, parsed);
            } else if (this.currentEntityType === 'FAM') {
                this.processFamilyTag(tag, value, parsed);
            } else if (this.currentEntityType === 'SOUR') {
                this.processSourceTag(tag, value);
            }
        }
        // Level 2+ - Detail tags
        else if (level >= 2) {
            if (this.currentEvent) {
                this.processEventDetail(tag, value);
            } else if (this.tagStack.includes('NAME')) {
                this.processNameDetail(tag, value);
            }
        }
    }

    processIndividualTag(tag, value, parsed) {
        switch (tag) {
            case 'NAME':
                const name = this.parseName(value);
                this.currentEntity.names.push(name);
                break;
            case 'SEX':
                this.currentEntity.sex = value;
                break;
            case 'BIRT':
            case 'DEAT':
            case 'CHR':
            case 'BAPM':
            case 'BURI':
            case 'OCCU':
            case 'RESI':
            case 'EMIG':
            case 'IMMI':
            case 'NATU':
            case 'GRAD':
                this.currentEvent = {
                    type: tag.toLowerCase(),
                    date: null,
                    place: null,
                    description: value || null,
                    gedcomTag: tag
                };
                this.currentEntity.events.push(this.currentEvent);
                break;
            case 'FAMC':
                this.currentEntity.parentFamilies.push(value);
                break;
            case 'FAMS':
                this.currentEntity.spouseFamilies.push(value);
                break;
            case 'NOTE':
                this.currentEntity.notes.push({ text: value });
                break;
            case 'OBJE':
                this.currentEntity.media.push({ ref: value });
                break;
        }
    }

    processFamilyTag(tag, value, parsed) {
        switch (tag) {
            case 'HUSB':
                this.currentEntity.husband = value;
                break;
            case 'WIFE':
                this.currentEntity.wife = value;
                break;
            case 'CHIL':
                this.currentEntity.children.push(value);
                break;
            case 'MARR':
            case 'DIV':
            case 'ENGA':
                this.currentEvent = {
                    type: tag.toLowerCase(),
                    date: null,
                    place: null,
                    description: value || null,
                    gedcomTag: tag
                };
                this.currentEntity.events.push(this.currentEvent);
                break;
            case 'NOTE':
                this.currentEntity.notes.push({ text: value });
                break;
        }
    }

    processSourceTag(tag, value) {
        switch (tag) {
            case 'TITL':
                this.currentEntity.title = value;
                break;
            case 'AUTH':
                this.currentEntity.author = value;
                break;
            case 'PUBL':
                this.currentEntity.publication = value;
                break;
            case 'REPO':
                this.currentEntity.repository = value;
                break;
        }
    }

    processEventDetail(tag, value) {
        if (!this.currentEvent) return;

        switch (tag) {
            case 'DATE':
                this.currentEvent.date = value;
                break;
            case 'PLAC':
                this.currentEvent.place = value;
                break;
            case 'NOTE':
                if (!this.currentEvent.notes) this.currentEvent.notes = [];
                this.currentEvent.notes.push(value);
                break;
        }
    }

    processNameDetail(tag, value) {
        const currentName = this.currentEntity.names[this.currentEntity.names.length - 1];
        if (!currentName) return;

        switch (tag) {
            case 'GIVN':
                currentName.given = value;
                break;
            case 'SURN':
                currentName.surname = value;
                break;
            case 'NPFX':
                currentName.prefix = value;
                break;
            case 'NSFX':
                currentName.suffix = value;
                break;
            case 'NICK':
                currentName.nickname = value;
                break;
        }
    }

    parseName(nameString) {
        // GEDCOM format: "Given Names /Surname/ Suffix"
        const match = nameString.match(/^([^\/]*)\/?([^\/]*)\/?(.*)$/);
        const given = match[1].trim();
        const surname = match[2].trim();
        const suffix = match[3].trim();

        // Build full name from the original string, or construct from parts
        let full = nameString.replace(/\//g, '').trim();
        if (!full && (given || surname)) {
            full = [given, surname, suffix].filter(Boolean).join(' ');
        }

        return {
            full: full || null,
            given: given || null,
            surname: surname || null,
            suffix: suffix || null,
            prefix: null
        };
    }
}

/**
 * Database Importer
 */
class DatabaseImporter {
    constructor(db) {
        this.db = db;
    }

    async importParsedData(fileId, parsedData) {
        const { individuals, families, sources } = parsedData;

        // Maps to track GEDCOM IDs to database IDs
        const individualMap = new Map();
        const familyMap = new Map();
        const sourceMap = new Map();

        console.log(`Importing ${individuals.length} individuals...`);
        
        // Import individuals and their basic data
        for (const indi of individuals) {
            const result = await this.dbRun(
                'INSERT INTO individuals (file_id, gedcom_id, sex) VALUES (?, ?, ?)',
                [fileId, indi.gedcomId, indi.sex]
            );
            const individualId = result.lastID;
            individualMap.set(indi.gedcomId, individualId);

            // Import names
            for (let i = 0; i < indi.names.length; i++) {
                const name = indi.names[i];
                await this.dbRun(
                    'INSERT INTO names (individual_id, given_name, surname, prefix, suffix, full_name, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [individualId, name.given, name.surname, name.prefix, name.suffix, name.full, i === 0 ? 1 : 0]
                );
            }

            // Import individual events
            for (const event of indi.events) {
                const dateInfo = this.parseDate(event.date);
                await this.dbRun(
                    `INSERT INTO events (individual_id, type, date_text, date_sort, date_from, date_to, date_quality, place_text, description, gedcom_tag)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [individualId, event.type, event.date, dateInfo.sort, dateInfo.from, dateInfo.to, dateInfo.quality, event.place, event.description, event.gedcomTag]
                );
            }

            // Import notes
            for (const note of indi.notes) {
                await this.dbRun(
                    'INSERT INTO notes (entity_type, entity_id, text) VALUES (?, ?, ?)',
                    ['individual', individualId, note.text]
                );
            }
        }

        console.log(`Importing ${families.length} families...`);

        // Import families
        for (const fam of families) {
            const result = await this.dbRun(
                'INSERT INTO families (file_id, gedcom_id) VALUES (?, ?)',
                [fileId, fam.gedcomId]
            );
            const familyId = result.lastID;
            familyMap.set(fam.gedcomId, familyId);

            // Import family events
            for (const event of fam.events) {
                const dateInfo = this.parseDate(event.date);
                const eventResult = await this.dbRun(
                    `INSERT INTO events (family_id, type, date_text, date_sort, date_from, date_to, date_quality, place_text, description, gedcom_tag)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [familyId, event.type, event.date, dateInfo.sort, dateInfo.from, dateInfo.to, dateInfo.quality, event.place, event.description, event.gedcomTag]
                );

                // If marriage event, link to family
                if (event.type === 'marr') {
                    await this.dbRun(
                        'UPDATE families SET marriage_event_id = ? WHERE id = ?',
                        [eventResult.lastID, familyId]
                    );
                }
            }

            // Import family members
            if (fam.husband) {
                const individualId = individualMap.get(fam.husband);
                if (individualId) {
                    await this.dbRun(
                        'INSERT INTO family_members (family_id, individual_id, role, relationship_type) VALUES (?, ?, ?, ?)',
                        [familyId, individualId, 'parent', 'biological']
                    );
                }
            }

            if (fam.wife) {
                const individualId = individualMap.get(fam.wife);
                if (individualId) {
                    await this.dbRun(
                        'INSERT INTO family_members (family_id, individual_id, role, relationship_type) VALUES (?, ?, ?, ?)',
                        [familyId, individualId, 'parent', 'biological']
                    );
                }
            }

            for (const childRef of fam.children) {
                const individualId = individualMap.get(childRef);
                if (individualId) {
                    await this.dbRun(
                        'INSERT INTO family_members (family_id, individual_id, role, relationship_type) VALUES (?, ?, ?, ?)',
                        [familyId, individualId, 'child', 'biological']
                    );
                }
            }

            // Import notes
            for (const note of fam.notes) {
                await this.dbRun(
                    'INSERT INTO notes (entity_type, entity_id, text) VALUES (?, ?, ?)',
                    ['family', familyId, note.text]
                );
            }
        }

        console.log(`Importing ${sources.length} sources...`);

        // Import sources
        for (const source of sources) {
            const result = await this.dbRun(
                'INSERT INTO sources (file_id, gedcom_id, title, author, publication_info, repository) VALUES (?, ?, ?, ?, ?, ?)',
                [fileId, source.gedcomId, source.title, source.author, source.publication, source.repository]
            );
            sourceMap.set(source.gedcomId, result.lastID);
        }

        return {
            individualCount: individuals.length,
            familyCount: families.length,
            sourceCount: sources.length
        };
    }

    parseDate(dateString) {
        if (!dateString) {
            return { sort: null, from: null, to: null, quality: null };
        }

        const dateStr = dateString.trim();
        
        // Handle "ABT" (about)
        if (dateStr.match(/^ABT\s+/i)) {
            const year = dateStr.match(/\d{4}/);
            if (year) {
                return {
                    sort: `${year[0]}-06-15`,
                    from: `${year[0]}-01-01`,
                    to: `${year[0]}-12-31`,
                    quality: 'about'
                };
            }
        }

        // Handle "BEF" (before)
        if (dateStr.match(/^BEF\s+/i)) {
            const year = dateStr.match(/\d{4}/);
            if (year) {
                return {
                    sort: `${year[0]}-01-01`,
                    from: null,
                    to: `${year[0]}-12-31`,
                    quality: 'before'
                };
            }
        }

        // Handle "AFT" (after)
        if (dateStr.match(/^AFT\s+/i)) {
            const year = dateStr.match(/\d{4}/);
            if (year) {
                return {
                    sort: `${year[0]}-12-31`,
                    from: `${year[0]}-01-01`,
                    to: null,
                    quality: 'after'
                };
            }
        }

        // Handle "BET ... AND ..." (between)
        const betMatch = dateStr.match(/^BET\s+.*?(\d{4}).*?AND.*?(\d{4})/i);
        if (betMatch) {
            const year1 = parseInt(betMatch[1]);
            const year2 = parseInt(betMatch[2]);
            const midYear = Math.floor((year1 + year2) / 2);
            return {
                sort: `${midYear}-06-15`,
                from: `${year1}-01-01`,
                to: `${year2}-12-31`,
                quality: 'between'
            };
        }

        // Handle exact date: "DD MMM YYYY"
        const exactMatch = dateStr.match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{4})/i);
        if (exactMatch) {
            const months = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
                           JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
            const day = exactMatch[1].padStart(2, '0');
            const month = months[exactMatch[2].toUpperCase()];
            const year = exactMatch[3];
            const isoDate = `${year}-${month}-${day}`;
            return {
                sort: isoDate,
                from: isoDate,
                to: isoDate,
                quality: 'exact'
            };
        }

        // Handle year only
        const yearMatch = dateStr.match(/^\d{4}$/);
        if (yearMatch) {
            return {
                sort: `${dateStr}-06-15`,
                from: `${dateStr}-01-01`,
                to: `${dateStr}-12-31`,
                quality: 'exact'
            };
        }

        return { sort: null, from: null, to: null, quality: null };
    }

    dbRun(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function (err) {
                if (err) reject(err);
                else resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    }

    dbGet(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }
}

module.exports = { GedcomParser, DatabaseImporter };
