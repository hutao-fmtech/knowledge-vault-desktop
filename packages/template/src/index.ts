/**
 * @kvd/template — absolute path of the bundled Obsidian vault template.
 * Data-only package; @kvd/vault/create copies from here.
 */
import { fileURLToPath } from 'node:url';

export const templateRoot: string = fileURLToPath(new URL('../template', import.meta.url));
