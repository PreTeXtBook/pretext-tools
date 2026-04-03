import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, '..');
const extensionRoot = path.join(workspaceRoot, 'packages', 'vscode-extension');
const distRoot = path.join(workspaceRoot, 'dist', 'vscode-extension');

const filesToCopy = [
  ['LICENSE', path.join(workspaceRoot, 'LICENSE')],
  ['logo.png', path.join(extensionRoot, 'logo.png')],
  ['language-configuration.json', path.join(extensionRoot, 'language-configuration.json')],
  ['.vscodeignore', path.join(extensionRoot, '.vscodeignore')],
];

const directoriesToCopy = ['assets', 'snippets', 'syntaxes'];

fs.mkdirSync(distRoot, { recursive: true });

const packageJsonPath = path.join(extensionRoot, 'package.json');
const distPackageJsonPath = path.join(distRoot, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

delete packageJson.scripts;
delete packageJson.devDependencies;

if (packageJson.dependencies) {
  delete packageJson.dependencies['@pretextbook/format'];
  delete packageJson.dependencies['@pretextbook/completions'];
}

fs.writeFileSync(distPackageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

for (const [relativeTarget, sourcePath] of filesToCopy) {
  fs.copyFileSync(sourcePath, path.join(distRoot, relativeTarget));
}

for (const relativeDir of directoriesToCopy) {
  const sourceDir = path.join(extensionRoot, relativeDir);
  const targetDir = path.join(distRoot, relativeDir);
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
}
