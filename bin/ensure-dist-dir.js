import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {ensureDirectoryPath} from './shared/ensure-directory-path.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repositoryRoot = path.resolve(__dirname, '..');

await ensureDirectoryPath(path.join(repositoryRoot, 'dist'));
