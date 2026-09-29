import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROUTES_FILE = join(dirname(fileURLToPath(import.meta.url)), 'routes.fixture.json');
