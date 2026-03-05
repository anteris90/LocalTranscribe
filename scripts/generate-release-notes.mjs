import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const thisFilePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(thisFilePath), '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const templatePath = path.join(repoRoot, 'docs', 'release-notes-template.md');

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;

if (!version) {
  throw new Error('Missing version in package.json');
}

const targetTag = process.argv[2] || `v${version}`;
const defaultOutputPath = path.join(repoRoot, 'docs', `release-notes-${targetTag}.md`);
const outputPath = process.argv[3] ? path.resolve(process.argv[3]) : defaultOutputPath;

let notes = fs.readFileSync(templatePath, 'utf8');
notes = notes.replaceAll('X.Y.Z', version);

fs.writeFileSync(outputPath, notes, 'utf8');

console.log(`Generated release notes: ${path.relative(repoRoot, outputPath)}`);
console.log(`Next: edit placeholders and run gh release edit ${targetTag} --notes-file ${outputPath}`);
