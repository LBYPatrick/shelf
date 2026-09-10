import { readFileSync } from 'node:fs';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('Expected a release version.');
const changelog = readFileSync('CHANGELOG.md', 'utf8');
const heading = `## [${version}] - `;
const start = changelog.indexOf(`\n${heading}`);
if (start === -1) throw new Error(`No changelog entry for ${version}.`);
const bodyStart = changelog.indexOf('\n', start + 1) + 1;
const next = changelog.indexOf('\n## [', bodyStart);
const body = changelog.slice(bodyStart, next === -1 ? undefined : next).trim();
if (!body) throw new Error(`Empty changelog entry for ${version}.`);
console.log(body);
