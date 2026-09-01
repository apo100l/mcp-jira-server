import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const packageUrl = new URL('../package.json', import.meta.url);
const packageJson = JSON.parse(readFileSync(fileURLToPath(packageUrl), 'utf8')) as { version?: unknown };

if (typeof packageJson.version !== 'string') {
  throw new Error('package.json does not contain a valid version');
}

export const packageVersion = packageJson.version;
