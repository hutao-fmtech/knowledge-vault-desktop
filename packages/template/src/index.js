'use strict';

/**
 * @kvd/template — absolute path of the bundled Obsidian vault template.
 * Data-only package; @kvd/vault/create copies from here.
 */
const path = require('path');

const templateRoot = path.join(__dirname, '..', 'template');

module.exports = { templateRoot };
