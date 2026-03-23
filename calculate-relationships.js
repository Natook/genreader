/**
 * Relationship Calculator
 * Calculates and caches relationships between individuals in the database
 * Optimized for performance with Swedish relationship terms
 */

class RelationshipCalculator {
    constructor(db) {
        this.db = db;
    }

    /**
     * Calculate all relationships from a root person
     */
    async calculateAllRelationships(fileId, rootPersonId) {
        console.log(`Calculating relationships from person ${rootPersonId} in file ${fileId}...`);

        // Clear existing relationships for this file
        await this.dbRun('DELETE FROM relationships WHERE file_id = ?', [fileId]);

        // Load all individuals and family relationships into memory for faster processing
        const individuals = await this.loadIndividuals(fileId);
        const familyMap = await this.loadFamilyRelationships(fileId);

        if (individuals.size === 0) {
            console.log('No individuals found in file');
            return;
        }

        // Build parent and children maps for faster traversal
        const parentMap = new Map(); // child -> [parent IDs]
        const childrenMap = new Map(); // parent -> [child IDs]
        const spouseMap = new Map(); // person -> [spouse IDs]

        for (const [familyId, family] of familyMap) {
            const parents = family.parents;
            const children = family.children;

            // Track spouse relationships
            if (parents.length === 2) {
                const [p1, p2] = parents;
                if (!spouseMap.has(p1)) spouseMap.set(p1, []);
                if (!spouseMap.has(p2)) spouseMap.set(p2, []);
                if (!spouseMap.get(p1).includes(p2)) spouseMap.get(p1).push(p2);
                if (!spouseMap.get(p2).includes(p1)) spouseMap.get(p2).push(p1);
            }

            // Track parent-child relationships
            for (const child of children) {
                if (!parentMap.has(child)) parentMap.set(child, []);
                parentMap.get(child).push(...parents);

                for (const parent of parents) {
                    if (!childrenMap.has(parent)) childrenMap.set(parent, []);
                    if (!childrenMap.get(parent).includes(child)) {
                        childrenMap.get(parent).push(child);
                    }
                }
            }
        }

        // Calculate relationships using BFS
        const relationships = [];
        const visited = new Set();

        // Root person
        relationships.push({
            from_person_id: rootPersonId,
            to_person_id: rootPersonId,
            generations: 0,
            relationship_type: 'self',
            relationship_text: 'Jag',
            path_json: JSON.stringify([])
        });
        visited.add(rootPersonId);

        // BFS queue: { personId, path: [{type, sex, personId}] }
        const queue = [{ personId: rootPersonId, path: [] }];

        while (queue.length > 0) {
            const { personId, path } = queue.shift();
            const person = individuals.get(personId);
            if (!person) continue;

            // Process parents
            const parents = parentMap.get(personId) || [];
            for (const parentId of parents) {
                if (visited.has(parentId)) continue;
                visited.add(parentId);

                const parent = individuals.get(parentId);
                if (!parent) continue;

                const newPath = [...path, { type: 'parent', sex: parent.sex, personId: parentId }];
                const rel = this.buildRelationship(newPath, individuals);

                relationships.push({
                    from_person_id: rootPersonId,
                    to_person_id: parentId,
                    generations: newPath.length,
                    relationship_type: 'ancestor',
                    relationship_text: rel.text,
                    path_json: JSON.stringify(newPath)
                });

                queue.push({ personId: parentId, path: newPath });

                // Process parent's siblings (aunts/uncles)
                this.processAuntsUncles(parentId, parentMap, childrenMap, individuals, path, relationships, visited, rootPersonId);
            }

            // Process children (only for root and close descendants)
            if (path.length < 3) {
                const children = childrenMap.get(personId) || [];
                for (const childId of children) {
                    if (visited.has(childId)) continue;
                    visited.add(childId);

                    const child = individuals.get(childId);
                    if (!child) continue;

                    const newPath = [...path, { type: 'child', sex: child.sex, personId: childId }];
                    const rel = this.buildRelationship(newPath, individuals);

                    relationships.push({
                        from_person_id: rootPersonId,
                        to_person_id: childId,
                        generations: -newPath.length,
                        relationship_type: 'descendant',
                        relationship_text: rel.text,
                        path_json: JSON.stringify(newPath)
                    });

                    queue.push({ personId: childId, path: newPath });
                }
            }

            // Process siblings (only for root)
            if (path.length === 0) {
                const siblings = this.getSiblings(personId, parentMap, childrenMap);
                for (const siblingId of siblings) {
                    if (visited.has(siblingId)) continue;
                    visited.add(siblingId);

                    const sibling = individuals.get(siblingId);
                    if (!sibling) continue;

                    const siblingText = sibling.sex === 'M' ? 'Bror' : sibling.sex === 'F' ? 'Syster' : 'Syskon';
                    relationships.push({
                        from_person_id: rootPersonId,
                        to_person_id: siblingId,
                        generations: 0,
                        relationship_type: 'sibling',
                        relationship_text: siblingText,
                        path_json: JSON.stringify([{ type: 'sibling', sex: sibling.sex, personId: siblingId }])
                    });

                    // Process sibling's children (nieces/nephews)
                    const niblings = childrenMap.get(siblingId) || [];
                    for (const niblingId of niblings) {
                        if (visited.has(niblingId)) continue;
                        visited.add(niblingId);

                        const nibling = individuals.get(niblingId);
                        if (!nibling) continue;

                        const niblingText = nibling.sex === 'M' ? 'Brorson/Systerson' : nibling.sex === 'F' ? 'Brorsdotter/Systerdotter' : 'Syskonbarn';
                        relationships.push({
                            from_person_id: rootPersonId,
                            to_person_id: niblingId,
                            generations: -1,
                            relationship_type: 'niece_nephew',
                            relationship_text: niblingText,
                            path_json: JSON.stringify([
                                { type: 'sibling', sex: sibling.sex, personId: siblingId },
                                { type: 'child', sex: nibling.sex, personId: niblingId }
                            ])
                        });
                    }
                }
            }

            // Process spouses
            if (path.length === 0) {
                const spouses = spouseMap.get(personId) || [];
                for (const spouseId of spouses) {
                    if (visited.has(spouseId)) continue;
                    visited.add(spouseId);

                    const spouse = individuals.get(spouseId);
                    if (!spouse) continue;

                    const spouseText = spouse.sex === 'M' ? 'Man' : spouse.sex === 'F' ? 'Fru' : 'Partner';
                    relationships.push({
                        from_person_id: rootPersonId,
                        to_person_id: spouseId,
                        generations: 0,
                        relationship_type: 'spouse',
                        relationship_text: spouseText,
                        path_json: JSON.stringify([{ type: 'spouse', sex: spouse.sex, personId: spouseId }])
                    });
                }
            }
        }

        // Mark remaining people as relatives
        for (const [personId] of individuals) {
            if (!visited.has(personId)) {
                relationships.push({
                    from_person_id: rootPersonId,
                    to_person_id: personId,
                    generations: null,
                    relationship_type: 'other',
                    relationship_text: 'Släkting',
                    path_json: JSON.stringify([])
                });
            }
        }

        // Save to database
        console.log(`Saving ${relationships.length} relationships...`);
        for (const rel of relationships) {
            await this.dbRun(
                `INSERT INTO relationships (file_id, from_person_id, to_person_id, generations, relationship_type, relationship_text, path_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [fileId, rel.from_person_id, rel.to_person_id, rel.generations, rel.relationship_type, rel.relationship_text, rel.path_json]
            );
        }

        console.log(`✅ Calculated ${relationships.length} relationships`);
        return relationships.length;
    }

    processAuntsUncles(parentId, parentMap, childrenMap, individuals, currentPath, relationships, visited, rootPersonId) {
        const grandparents = parentMap.get(parentId) || [];
        
        for (const grandparentId of grandparents) {
            const siblings = childrenMap.get(grandparentId) || [];
            
            for (const siblingId of siblings) {
                if (siblingId === parentId || visited.has(siblingId)) continue;
                
                const sibling = individuals.get(siblingId);
                if (!sibling) continue;

                visited.add(siblingId);

                let relText;
                if (currentPath.length === 0) {
                    // Direct aunts/uncles
                    const parentSex = individuals.get(parentId)?.sex;
                    if (parentSex === 'M') {
                        relText = sibling.sex === 'M' ? 'Farbror' : sibling.sex === 'F' ? 'Faster' : 'Farbror/Faster';
                    } else {
                        relText = sibling.sex === 'M' ? 'Morbror' : sibling.sex === 'F' ? 'Moster' : 'Morbror/Moster';
                    }

                    relationships.push({
                        from_person_id: rootPersonId,
                        to_person_id: siblingId,
                        generations: 1,
                        relationship_type: 'aunt_uncle',
                        relationship_text: relText,
                        path_json: JSON.stringify([{ type: 'aunt_uncle', sex: sibling.sex, personId: siblingId }])
                    });

                    // Process cousins
                    const cousins = childrenMap.get(siblingId) || [];
                    for (const cousinId of cousins) {
                        if (visited.has(cousinId)) continue;
                        visited.add(cousinId);

                        relationships.push({
                            from_person_id: rootPersonId,
                            to_person_id: cousinId,
                            generations: 0,
                            relationship_type: 'cousin',
                            relationship_text: 'Kusin',
                            path_json: JSON.stringify([
                                { type: 'aunt_uncle', sex: sibling.sex, personId: siblingId },
                                { type: 'child', sex: individuals.get(cousinId)?.sex, personId: cousinId }
                            ])
                        });
                    }
                }
            }
        }
    }

    getSiblings(personId, parentMap, childrenMap) {
        const parents = parentMap.get(personId) || [];
        const siblings = new Set();

        for (const parentId of parents) {
            const children = childrenMap.get(parentId) || [];
            for (const childId of children) {
                if (childId !== personId) {
                    siblings.add(childId);
                }
            }
        }

        return Array.from(siblings);
    }

    buildRelationship(path, individuals) {
        if (path.length === 0) {
            return { text: 'Jag', type: 'self' };
        }

        if (path.length === 1) {
            const step = path[0];
            if (step.type === 'parent') {
                return { text: step.sex === 'M' ? 'Far' : step.sex === 'F' ? 'Mor' : 'Förälder', type: 'parent' };
            } else if (step.type === 'child') {
                return { text: step.sex === 'M' ? 'Son' : step.sex === 'F' ? 'Dotter' : 'Barn', type: 'child' };
            }
        }

        if (path.every(s => s.type === 'parent')) {
            return this.buildAncestorRelationship(path);
        }

        if (path.every(s => s.type === 'child')) {
            return this.buildDescendantRelationship(path);
        }

        return { text: 'Släkting', type: 'other' };
    }

    buildAncestorRelationship(path) {
        // Build compound Swedish terms: far, mor, farfar, farmor, etc.
        let prefix = '';
        
        for (let i = 0; i < path.length; i++) {
            const step = path[i];
            const term = step.sex === 'M' ? 'far' : step.sex === 'F' ? 'mor' : 'förälder';
            
            if (i === 0) {
                prefix = term;
            } else if (i === 1) {
                // Combine into compound: farfar, farmor, morfar, mormor
                prefix = prefix + term;
            } else {
                prefix = prefix + 's ' + term;
            }
        }

        // Capitalize first letter
        const text = prefix.charAt(0).toUpperCase() + prefix.slice(1);
        return { text, type: 'ancestor' };
    }

    buildDescendantRelationship(path) {
        if (path.length === 1) {
            const sex = path[0].sex;
            return { text: sex === 'M' ? 'Son' : sex === 'F' ? 'Dotter' : 'Barn', type: 'descendant' };
        } else if (path.length === 2) {
            const sex = path[1].sex;
            return { text: sex === 'M' ? 'Barnbarn (pojke)' : sex === 'F' ? 'Barnbarn (flicka)' : 'Barnbarn', type: 'descendant' };
        } else if (path.length === 3) {
            return { text: 'Barnbarns barn', type: 'descendant' };
        } else {
            return { text: `Ättling (${path.length} generationer)`, type: 'descendant' };
        }
    }

    async loadIndividuals(fileId) {
        const rows = await this.dbAll(
            'SELECT id, gedcom_id, sex FROM individuals WHERE file_id = ?',
            [fileId]
        );

        const map = new Map();
        for (const row of rows) {
            map.set(row.id, row);
        }
        return map;
    }

    async loadFamilyRelationships(fileId) {
        const families = await this.dbAll(
            'SELECT id FROM families WHERE file_id = ?',
            [fileId]
        );

        const familyMap = new Map();

        for (const family of families) {
            const members = await this.dbAll(
                'SELECT individual_id, role FROM family_members WHERE family_id = ?',
                [family.id]
            );

            const parents = [];
            const children = [];

            for (const member of members) {
                if (member.role === 'parent') {
                    parents.push(member.individual_id);
                } else if (member.role === 'child') {
                    children.push(member.individual_id);
                }
            }

            familyMap.set(family.id, { parents, children });
        }

        return familyMap;
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

    dbAll(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }
}

module.exports = { RelationshipCalculator };
