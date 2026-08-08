#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, lstat, copyFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outRoot = resolve(outIndex >= 0 ? args[outIndex + 1] : '/tmp/neondrift-public-artifact');
const manifestOnly = args.includes('--manifest-only');

const INCLUDE_FILES = Object.freeze([
  'README.md',
  'LICENSE',
  'NOTICE',
  'docs/neondrift-alpha-manual-checklist.md',
  'docs/neondrift-delivery.md',
  'docs/neondrift-luminance-mask-procedure.md',
  'docs/neondrift-performance-trace.md',
  'scripts/build-web.sh',
  'scripts/check-web-closure.mjs',
  'scripts/stage-public-artifact.mjs',
  'web/index.html',
  'web/README.md',
  'web/CHANGELOG.md',
  'web/VERSION',
  'web/tests/fixtures/perf-ion-gauntlet.trace.json',
  'web/vendor/three/LICENSE',
  'web/vendor/three/three.core.min.js',
  'web/vendor/three/three.module.min.js',
]);

const INCLUDE_DIRS = Object.freeze([
  'web/src',
]);

const FORBIDDEN_PATH_PATTERNS = Object.freeze([
  /(^|\/)web\/assets(\/|$)/,
  /(^|\/)(target|node_modules|\.git|\.zenith|\.agents|\.codex|\.claude)(\/|$)/,
  /(^|\/)(SKYROADS\.EXE|DEMO\.REC)$/i,
  /(^|\/)[^/]+\.(LZS|SND|DAT|REC|EXE)$/i,
  /(^|\/).*\.profraw$/i,
  /(^|\/).*\.sqlite(?:3)?$/i,
]);

const SECRET_PATTERNS = Object.freeze([
  { id: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { id: 'openai-api-key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
]);

function toPosix(path) {
  return path.split(sep).join('/');
}

function assertInsideRepo(absPath) {
  const rel = relative(repoRoot, absPath);
  if (rel.startsWith('..') || rel === '') throw new Error(`${absPath} is outside an included repo path`);
}

async function walk(dir) {
  const results = [];
  for (const name of await readdir(dir)) {
    const abs = resolve(dir, name);
    const info = await lstat(abs);
    if (info.isSymbolicLink()) throw new Error(`public artifact cannot include symlink ${relative(repoRoot, abs)}`);
    if (info.isDirectory()) results.push(...await walk(abs));
    else if (info.isFile()) results.push(abs);
  }
  return results;
}

async function collectIncludedFiles() {
  const files = new Set();
  for (const file of INCLUDE_FILES) {
    const abs = resolve(repoRoot, file);
    await stat(abs);
    files.add(abs);
  }
  for (const dir of INCLUDE_DIRS) {
    const abs = resolve(repoRoot, dir);
    assertInsideRepo(abs);
    for (const file of await walk(abs)) files.add(file);
  }
  return [...files].sort((a, b) => relative(repoRoot, a).localeCompare(relative(repoRoot, b)));
}

function forbiddenPathReason(relPath) {
  const normalized = toPosix(relPath);
  return FORBIDDEN_PATH_PATTERNS.find((pattern) => pattern.test(normalized))?.source ?? null;
}

function secretFindingsForText(relPath, text) {
  const findings = [];
  for (const pattern of SECRET_PATTERNS) {
    pattern.re.lastIndex = 0;
    let match;
    while ((match = pattern.re.exec(text))) {
      const before = text.slice(0, match.index);
      const line = before.split('\n').length;
      findings.push({ file: relPath, line, pattern: pattern.id });
    }
  }
  return findings;
}

async function fileRecord(abs) {
  assertInsideRepo(abs);
  const relPath = toPosix(relative(repoRoot, abs));
  const forbidden = forbiddenPathReason(relPath);
  assert.equal(forbidden, null, `${relPath} matched forbidden public artifact pattern ${forbidden}`);
  const bytes = await readFile(abs);
  const text = bytes.toString('utf8');
  const secrets = secretFindingsForText(relPath, text);
  return {
    path: relPath,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    secrets,
  };
}

async function copyArtifact(files) {
  if (manifestOnly) return null;
  const rel = relative(repoRoot, outRoot);
  if (!rel.startsWith('..')) throw new Error('--out must be outside the repository');
  await rm(outRoot, { recursive: true, force: true });
  for (const abs of files) {
    const relPath = toPosix(relative(repoRoot, abs));
    const dest = resolve(outRoot, relPath);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(abs, dest);
  }
  return outRoot;
}

async function main() {
  const files = await collectIncludedFiles();
  const records = [];
  const secretFindings = [];
  for (const abs of files) {
    const record = await fileRecord(abs);
    records.push({
      path: record.path,
      bytes: record.bytes,
      sha256: record.sha256,
    });
    secretFindings.push(...record.secrets);
  }
  assert.deepEqual(secretFindings, [], `secret-like material found: ${JSON.stringify(secretFindings)}`);

  const artifactRoot = await copyArtifact(files);
  const manifest = {
    schema: 'neondrift.publicArtifact.v1',
    generatedAt: new Date().toISOString(),
    sourceRoot: repoRoot,
    artifactRoot,
    manifestOnly,
    files: records,
    fileCount: records.length,
    totalBytes: records.reduce((sum, item) => sum + item.bytes, 0),
    excluded: [
      'SKYROADS.EXE',
      '*.LZS',
      '*.SND',
      '*.DAT',
      'DEMO.REC',
      'web/assets/',
      'target/',
      'node_modules/',
      '.git/',
      '.zenith/',
      '.agents/',
      '.codex/',
      '.claude/',
      'developer evidence and local caches',
    ],
    dependencyProvenance: [
      {
        name: 'three',
        version: 'vendored local snapshot',
        source: 'web/vendor/three/',
        license: 'MIT',
        licenseFile: 'web/vendor/three/LICENSE',
        files: [
          'web/vendor/three/three.core.min.js',
          'web/vendor/three/three.module.min.js',
        ],
      },
    ],
    scans: {
      forbiddenPathPatterns: FORBIDDEN_PATH_PATTERNS.map((pattern) => pattern.source),
      forbiddenMatches: [],
      secretPatterns: SECRET_PATTERNS.map((pattern) => pattern.id),
      secretFindings,
    },
  };

  if (artifactRoot) {
    await writeFile(resolve(artifactRoot, 'artifact-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  console.log(JSON.stringify({
    artifactRoot,
    manifestOnly,
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
    forbiddenMatches: manifest.scans.forbiddenMatches.length,
    secretFindings: manifest.scans.secretFindings.length,
    dependencyProvenance: manifest.dependencyProvenance,
  }, null, 2));
}

await main();
