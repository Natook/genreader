-- Database schema for GEDCOM Viewer (SQLite)
-- Enhanced schema for genealogy data with relationship caching

-- ======================
-- User Management Tables
-- ======================

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    root_person_id INTEGER,  -- The "me" person for relationship calculations
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ======================
-- Core Genealogy Tables
-- ======================

CREATE TABLE IF NOT EXISTS individuals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL,
    gedcom_id TEXT NOT NULL,  -- e.g., @I123@
    sex TEXT,  -- M, F, or NULL
    is_living INTEGER DEFAULT 0,  -- 0 = deceased, 1 = living (for privacy)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS names (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    individual_id INTEGER NOT NULL,
    type TEXT DEFAULT 'birth',  -- birth, married, nickname, aka, etc.
    prefix TEXT,  -- Dr., Rev., etc.
    given_name TEXT,
    surname TEXT,
    suffix TEXT,  -- Jr., Sr., III, etc.
    full_name TEXT,  -- Computed/cached full name for easy display
    is_primary INTEGER DEFAULT 0,  -- 1 for primary name, 0 for alternates
    FOREIGN KEY (individual_id) REFERENCES individuals(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    individual_id INTEGER,  -- NULL for family events like marriage
    family_id INTEGER,      -- NULL for individual events
    type TEXT NOT NULL,  -- birth, death, marriage, burial, baptism, occupation, residence, etc.
    date_text TEXT,  -- Original date string: "abt 1850", "between 1840 and 1850"
    date_sort TEXT,  -- Normalized YYYY-MM-DD for sorting (middle of range for uncertain dates)
    date_from TEXT,  -- Start of date range
    date_to TEXT,    -- End of date range
    date_quality TEXT,  -- exact, about, before, after, between, calculated
    place_text TEXT,
    description TEXT,
    gedcom_tag TEXT,  -- Original GEDCOM tag for reference
    FOREIGN KEY (individual_id) REFERENCES individuals(id) ON DELETE CASCADE,
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS families (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL,
    gedcom_id TEXT NOT NULL,  -- e.g., @F123@
    marriage_event_id INTEGER,  -- Reference to marriage event
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
    FOREIGN KEY (marriage_event_id) REFERENCES events(id)
);

CREATE TABLE IF NOT EXISTS family_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    family_id INTEGER NOT NULL,
    individual_id INTEGER NOT NULL,
    role TEXT NOT NULL,  -- 'parent', 'child'
    relationship_type TEXT DEFAULT 'biological',  -- biological, adopted, foster, step, sealed
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE,
    FOREIGN KEY (individual_id) REFERENCES individuals(id) ON DELETE CASCADE
);

-- ======================
-- Notes and Documentation
-- ======================

CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,  -- 'individual', 'family', 'event', etc.
    entity_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ======================
-- Sources and Citations
-- ======================

CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL,
    gedcom_id TEXT,
    title TEXT,
    author TEXT,
    publication_info TEXT,
    repository TEXT,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS citations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    entity_type TEXT NOT NULL,  -- 'individual', 'family', 'event', 'name'
    entity_id INTEGER NOT NULL,
    page TEXT,
    quality TEXT,  -- primary, secondary, questionable
    citation_notes TEXT,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

-- ======================
-- Media
-- ======================

CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL,
    gedcom_id TEXT,
    file_path TEXT,
    mime_type TEXT,
    title TEXT,
    description TEXT,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS media_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);

-- ======================
-- Relationship Caching (Performance optimization)
-- ======================

CREATE TABLE IF NOT EXISTS relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL,
    from_person_id INTEGER NOT NULL,  -- The reference person ("me")
    to_person_id INTEGER NOT NULL,    -- The other person
    generations INTEGER,  -- -2=grandchild, -1=child, 0=self/spouse/sibling, 1=parent, 2=grandparent
    relationship_type TEXT,  -- 'self', 'ancestor', 'descendant', 'sibling', 'spouse', 'cousin', 'aunt_uncle', 'niece_nephew', 'other'
    relationship_text TEXT,  -- Swedish: "Farmors mors far", English: "Great-grandfather"
    path_json TEXT,  -- JSON array of relationship steps for building custom descriptions
    calculated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
    FOREIGN KEY (from_person_id) REFERENCES individuals(id) ON DELETE CASCADE,
    FOREIGN KEY (to_person_id) REFERENCES individuals(id) ON DELETE CASCADE
);

-- ======================
-- Indexes for Performance
-- ======================

CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE INDEX IF NOT EXISTS idx_individuals_file ON individuals(file_id);
CREATE INDEX IF NOT EXISTS idx_individuals_gedcom ON individuals(file_id, gedcom_id);

CREATE INDEX IF NOT EXISTS idx_names_individual ON names(individual_id);
CREATE INDEX IF NOT EXISTS idx_names_primary ON names(individual_id, is_primary);
CREATE INDEX IF NOT EXISTS idx_names_search ON names(given_name, surname);

CREATE INDEX IF NOT EXISTS idx_events_individual ON events(individual_id);
CREATE INDEX IF NOT EXISTS idx_events_family ON events(family_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date_sort);

CREATE INDEX IF NOT EXISTS idx_families_file ON families(file_id);
CREATE INDEX IF NOT EXISTS idx_families_gedcom ON families(file_id, gedcom_id);

CREATE INDEX IF NOT EXISTS idx_family_members_family ON family_members(family_id);
CREATE INDEX IF NOT EXISTS idx_family_members_individual ON family_members(individual_id);
CREATE INDEX IF NOT EXISTS idx_family_members_role ON family_members(role);

CREATE INDEX IF NOT EXISTS idx_notes_entity ON notes(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_sources_file ON sources(file_id);

CREATE INDEX IF NOT EXISTS idx_citations_source ON citations(source_id);
CREATE INDEX IF NOT EXISTS idx_citations_entity ON citations(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_media_file ON media(file_id);
CREATE INDEX IF NOT EXISTS idx_media_links_media ON media_links(media_id);
CREATE INDEX IF NOT EXISTS idx_media_links_entity ON media_links(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_relationships_from ON relationships(from_person_id);
CREATE INDEX IF NOT EXISTS idx_relationships_to ON relationships(to_person_id);
CREATE INDEX IF NOT EXISTS idx_relationships_file ON relationships(file_id, from_person_id);
CREATE INDEX IF NOT EXISTS idx_relationships_type ON relationships(relationship_type, generations);
