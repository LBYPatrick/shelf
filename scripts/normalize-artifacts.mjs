import { existsSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const directory = process.argv[2];
if (!directory) throw new Error('Expected an artifact directory.');
const moves = readdirSync(directory)
  .filter((name) => name.includes(' '))
  .map((name) => [join(directory, name), join(directory, name.replace(/ /g, '-'))]);
// Validate first so a collision cannot leave the directory half-renamed.
for (const [, target] of moves) {
  if (existsSync(target)) throw new Error(`Artifact already exists: ${target}`);
}
for (const [source, target] of moves) renameSync(source, target);
