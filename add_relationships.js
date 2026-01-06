#!/usr/bin/env node
/**
 * Add _RELA (relationship) tags to GEDCOM file based on family tree structure.
 * This calculates Swedish relationship terms from a root person.
 */

const fs = require('fs');
const path = require('path');

class GedcomPerson {
    constructor(id) {
        this.id = id;
        this.name = '';
        this.sex = '';
        this.parentFamily = null;
        this.families = [];
        this.relationship = null;
    }
}

class GedcomFamily {
    constructor(id) {
        this.id = id;
        this.husband = null;
        this.wife = null;
        this.children = [];
    }
}

function parseGedcom(filename) {
    const individuals = {};
    const families = {};

    const content = fs.readFileSync(filename, 'utf-8');
    const lines = content.split('\n');

    let currentEntity = null;
    let currentType = null;

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        const parts = line.split(' ');
        const level = parseInt(parts[0]);

        if (parts.length < 2) continue;

        const tag = parts[1];
        const value = parts.slice(2).join(' ');

        if (level === 0 && tag.startsWith('@') && tag.endsWith('@')) {
            currentEntity = tag;
            currentType = parts[2];

            if (currentType === 'INDI') {
                individuals[currentEntity] = new GedcomPerson(currentEntity);
            } else if (currentType === 'FAM') {
                families[currentEntity] = new GedcomFamily(currentEntity);
            }
        } else if (level === 1 && currentEntity) {
            if (currentType === 'INDI') {
                const person = individuals[currentEntity];
                if (tag === 'NAME') {
                    person.name = value.replace(/\//g, '');
                } else if (tag === 'SEX') {
                    person.sex = value;
                } else if (tag === 'FAMC') {
                    person.parentFamily = value;
                } else if (tag === 'FAMS') {
                    person.families.push(value);
                }
            } else if (currentType === 'FAM') {
                const family = families[currentEntity];
                if (tag === 'HUSB') {
                    family.husband = value;
                } else if (tag === 'WIFE') {
                    family.wife = value;
                } else if (tag === 'CHIL') {
                    family.children.push(value);
                }
            }
        }
    }

    return { individuals, families };
}

function calculateAllRelationships(rootId, individuals, families) {
    // Single-pass algorithm: traverse tree once, marking relationships as we go
    const marked = new Set();

    // Start with root
    if (individuals[rootId]) {
        individuals[rootId].relationship = 'Jag';
        marked.add(rootId);
    }

    // Process in waves: parents, then grandparents, etc.
    const queue = [{ id: rootId, prefix: '' }];

    while (queue.length > 0) {
        const { id, prefix } = queue.shift();
        const person = individuals[id];
        if (!person) continue;

        // Mark parents
        if (person.parentFamily && families[person.parentFamily]) {
            const family = families[person.parentFamily];

            // Mark father
            if (family.husband && !marked.has(family.husband)) {
                const fatherPrefix = prefix ? prefix + 's far' : 'far';
                const fatherRel = buildSwedishRelation(fatherPrefix);
                individuals[family.husband].relationship = fatherRel;
                marked.add(family.husband);
                queue.push({ id: family.husband, prefix: fatherPrefix });

                // Mark father's spouse(s) if not already marked
                const father = individuals[family.husband];
                if (father) {
                    for (const famId of father.families) {
                        const spouseFamily = families[famId];
                        if (spouseFamily) {
                            // Mark spouse (wife in this case, if not the person's mother)
                            if (spouseFamily.wife && spouseFamily.wife !== family.wife && !marked.has(spouseFamily.wife)) {
                                const spouse = individuals[spouseFamily.wife];
                                if (spouse) {
                                    spouse.relationship = fatherRel + ' fru';
                                    marked.add(spouseFamily.wife);
                                }
                            }
                        }
                    }

                    // Mark father's siblings (all levels)
                    if (father.parentFamily && families[father.parentFamily]) {
                        const grandparentFamily = families[father.parentFamily];
                        for (const uncleAuntId of grandparentFamily.children) {
                            if (uncleAuntId !== family.husband && !marked.has(uncleAuntId)) {
                                const uncleAunt = individuals[uncleAuntId];
                                if (uncleAunt) {
                                    let rel;
                                    if (!prefix) { // Direct aunts/uncles
                                        rel = uncleAunt.sex === 'M' ? 'Farbror' : uncleAunt.sex === 'F' ? 'Faster' : 'Farbror/Faster';
                                        marked.add(uncleAuntId);

                                        // Mark their children as cousins
                                        for (const famId of uncleAunt.families) {
                                            const cousinFamily = families[famId];
                                            if (cousinFamily) {
                                                for (const cousinId of cousinFamily.children) {
                                                    if (!marked.has(cousinId)) {
                                                        individuals[cousinId].relationship = 'Kusin';
                                                        marked.add(cousinId);
                                                    }
                                                }
                                            }
                                        }
                                    } else { // Ancestor's siblings
                                        const siblingType = uncleAunt.sex === 'M' ? 'bror' : uncleAunt.sex === 'F' ? 'syster' : 'syskon';
                                        rel = buildSwedishRelation(fatherPrefix + 's ' + siblingType);
                                        marked.add(uncleAuntId);

                                        // Mark their spouses
                                        for (const famId of uncleAunt.families) {
                                            const siblingFamily = families[famId];
                                            if (siblingFamily) {
                                                const spouseId = uncleAunt.sex === 'M' ? siblingFamily.wife : siblingFamily.husband;
                                                if (spouseId && !marked.has(spouseId)) {
                                                    const spouse = individuals[spouseId];
                                                    if (spouse) {
                                                        const spouseType = spouse.sex === 'F' ? 'fru' : 'man';
                                                        spouse.relationship = rel + ' ' + spouseType;
                                                        marked.add(spouseId);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    uncleAunt.relationship = rel;
                                }
                            }
                        }
                    }
                }
            }

            // Mark mother
            if (family.wife && !marked.has(family.wife)) {
                const motherPrefix = prefix ? prefix + 's mor' : 'mor';
                const motherRel = buildSwedishRelation(motherPrefix);
                individuals[family.wife].relationship = motherRel;
                marked.add(family.wife);
                queue.push({ id: family.wife, prefix: motherPrefix });

                // Mark mother's spouse(s) if not already marked
                const mother = individuals[family.wife];
                if (mother) {
                    for (const famId of mother.families) {
                        const spouseFamily = families[famId];
                        if (spouseFamily) {
                            // Mark spouse (husband in this case, if not the person's father)
                            if (spouseFamily.husband && spouseFamily.husband !== family.husband && !marked.has(spouseFamily.husband)) {
                                const spouse = individuals[spouseFamily.husband];
                                if (spouse) {
                                    spouse.relationship = motherRel + ' man';
                                    marked.add(spouseFamily.husband);
                                }
                            }
                        }
                    }

                    // Mark mother's siblings (all levels)
                    if (mother.parentFamily && families[mother.parentFamily]) {
                        const grandparentFamily = families[mother.parentFamily];
                        for (const uncleAuntId of grandparentFamily.children) {
                            if (uncleAuntId !== family.wife && !marked.has(uncleAuntId)) {
                                const uncleAunt = individuals[uncleAuntId];
                                if (uncleAunt) {
                                    let rel;
                                    if (!prefix) { // Direct aunts/uncles
                                        rel = uncleAunt.sex === 'M' ? 'Morbror' : uncleAunt.sex === 'F' ? 'Moster' : 'Morbror/Moster';
                                        marked.add(uncleAuntId);

                                        // Mark their children as cousins
                                        for (const famId of uncleAunt.families) {
                                            const cousinFamily = families[famId];
                                            if (cousinFamily) {
                                                for (const cousinId of cousinFamily.children) {
                                                    if (!marked.has(cousinId)) {
                                                        individuals[cousinId].relationship = 'Kusin';
                                                        marked.add(cousinId);
                                                    }
                                                }
                                            }
                                        }
                                    } else { // Ancestor's siblings
                                        const siblingType = uncleAunt.sex === 'M' ? 'bror' : uncleAunt.sex === 'F' ? 'syster' : 'syskon';
                                        rel = buildSwedishRelation(motherPrefix + 's ' + siblingType);
                                        marked.add(uncleAuntId);

                                        // Mark their spouses
                                        for (const famId of uncleAunt.families) {
                                            const siblingFamily = families[famId];
                                            if (siblingFamily) {
                                                const spouseId = uncleAunt.sex === 'M' ? siblingFamily.wife : siblingFamily.husband;
                                                if (spouseId && !marked.has(spouseId)) {
                                                    const spouse = individuals[spouseId];
                                                    if (spouse) {
                                                        const spouseType = spouse.sex === 'F' ? 'fru' : 'man';
                                                        spouse.relationship = rel + ' ' + spouseType;
                                                        marked.add(spouseId);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    uncleAunt.relationship = rel;
                                }
                            }
                        }
                    }
                }
            }

            // Mark siblings
            for (const siblingId of family.children) {
                if (siblingId !== id && !marked.has(siblingId)) {
                    const sibling = individuals[siblingId];
                    if (sibling) {
                        if (!prefix) { // Direct siblings only
                            const siblingRel = sibling.sex === 'M' ? 'Bror' : sibling.sex === 'F' ? 'Syster' : 'Syskon';
                            sibling.relationship = siblingRel;
                            marked.add(siblingId);
                        }
                    }
                }
            }
        }

        // Mark children (only for root or direct descendants)
        if (!prefix || prefix.split(' ').length < 3) {
            for (const famId of person.families) {
                const family = families[famId];
                if (family) {
                    for (const childId of family.children) {
                        if (!marked.has(childId)) {
                            const child = individuals[childId];
                            if (child) {
                                if (!prefix) {
                                    // Direct children
                                    const childRel = child.sex === 'M' ? 'Son' : child.sex === 'F' ? 'Dotter' : 'Barn';
                                    child.relationship = childRel;
                                    marked.add(childId);
                                } else if (prefix === 'son' || prefix === 'dotter') {
                                    // Grandchildren
                                    const grandchildRel = child.sex === 'M' ? 'Barnbarn (pojke)' : 'Barnbarn (flicka)';
                                    child.relationship = grandchildRel;
                                    marked.add(childId);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Mark any remaining as "Släkting"
    for (const person of Object.values(individuals)) {
        if (!person.relationship) {
            person.relationship = 'Släkting';
        }
    }
}

function buildSwedishRelation(prefix) {
    // Convert prefix like "far", "fars far", "fars mors far" to Swedish
    const parts = prefix.split('s ');

    // Handle simple cases
    if (parts.length === 1) {
        const mapping = { 'far': 'Far', 'mor': 'Mor' };
        return mapping[parts[0]] || parts[0];
    }

    // Build compound terms
    let result = '';
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];

        // Combine consecutive far/mor pairs
        if (i < parts.length - 1) {
            const next = parts[i + 1];
            if (part === 'far' && next === 'far') {
                result += (result ? 's ' : '') + 'farfar';
                i++;
                continue;
            }
            if (part === 'far' && next === 'mor') {
                result += (result ? 's ' : '') + 'farmor';
                i++;
                continue;
            }
            if (part === 'mor' && next === 'far') {
                result += (result ? 's ' : '') + 'morfar';
                i++;
                continue;
            }
            if (part === 'mor' && next === 'mor') {
                result += (result ? 's ' : '') + 'mormor';
                i++;
                continue;
            }
        }

        result += (result ? 's ' : '') + part;
    }

    // Capitalize first letter
    return result.charAt(0).toUpperCase() + result.slice(1);
}

function addRelationshipsToGedcom(inputFile, outputFile) {
    console.log(`Reading ${inputFile}...`);
    const { individuals, families } = parseGedcom(inputFile);

    console.log(`Found ${Object.keys(individuals).length} individuals and ${Object.keys(families).length} families`);

    // Use the first person in the file as root
    const rootId = Object.keys(individuals)[0];

    console.log(`Using ${individuals[rootId]?.name || rootId} as root person`);
    console.log(`Calculating relationships using tree traversal...`);

    // Calculate all relationships from this person using single tree traversal
    calculateAllRelationships(rootId, individuals, families);

    let marked = 0;
    for (const person of Object.values(individuals)) {
        if (person.relationship && person.relationship !== 'Släkting') {
            marked++;
        }
    }

    console.log(`Marked ${marked} people with specific relationships`);

    // Read original file and add _RELA tags
    console.log(`Writing updated GEDCOM to ${outputFile}...`);
    const content = fs.readFileSync(inputFile, 'utf-8');
    const lines = content.split('\n');

    const newLines = [];
    let currentIndividual = null;
    let skipRela = false;

    for (const line of lines) {
        const stripped = line.trim();

        if (!stripped) {
            newLines.push(line);
            continue;
        }

        const parts = stripped.split(' ');
        const level = parseInt(parts[0]);
        const tag = parts.length > 1 ? parts[1] : '';

        // Track current individual
        if (level === 0 && tag.startsWith('@') && tag.endsWith('@')) {
            if (parts.length > 2 && parts[2] === 'INDI') {
                currentIndividual = tag;
                skipRela = false;
            } else {
                currentIndividual = null;
            }
        }

        // Skip existing _RELA tags
        if (level === 1 && tag === '_RELA') {
            skipRela = true;
            continue;
        }

        if (skipRela && level > 1) {
            continue;
        } else {
            skipRela = false;
        }

        // Insert _RELA tag before NAME
        if (currentIndividual && level === 1 && tag === 'NAME') {
            const person = individuals[currentIndividual];
            if (person && person.relationship) {
                newLines.push(`1 _RELA ${person.relationship}`);
            }
        }

        newLines.push(line);
    }

    fs.writeFileSync(outputFile, newLines.join('\n'), 'utf-8');

    console.log(`Done! Updated GEDCOM saved to ${outputFile}`);

    // Print statistics
    const relationships = {};
    for (const person of Object.values(individuals)) {
        if (person.relationship) {
            relationships[person.relationship] = (relationships[person.relationship] || 0) + 1;
        }
    }

    console.log('\nRelationship statistics:');
    const sorted = Object.entries(relationships).sort((a, b) => b[1] - a[1]);
    for (const [rel, count] of sorted) {
        console.log(`  ${rel}: ${count}`);
    }
}

// Main
if (process.argv.length < 3) {
    console.log('Usage: node add_relationships.js <gedcom_file> [output_file] [root_person_id]');
    console.log('\nExample:');
    console.log('  node add_relationships.js "Svedström_släktträd.ged"');
    console.log('  node add_relationships.js input.ged output.ged @I500001@');
    process.exit(1);
}

const inputFile = process.argv[2];
const outputFile = process.argv[3] || inputFile.replace('.ged', '_with_relationships.ged');
const rootId = process.argv[4] || '@I500001@';

addRelationshipsToGedcom(inputFile, outputFile, rootId);
