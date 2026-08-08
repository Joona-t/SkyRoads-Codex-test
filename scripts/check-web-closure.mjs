#!/usr/bin/env node
import assert from 'node:assert/strict';

import { expectedCounts, maxChunkDrawables, validateLevel } from '../web/src/level-contract.mjs';

const args = process.argv.slice(2);
const trackedOnly = args.includes('--tracked-only');
const baseArg = args.find((arg) => !arg.startsWith('--'));
const base = new URL(baseArg ?? 'http://127.0.0.1:8091/');

function webPath(pathname) {
  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

async function fetchText(pathname) {
  const url = new URL(webPath(pathname), base);
  const response = await fetch(url);
  const text = await response.text();
  assert.equal(response.status, 200, `${url.href} returned HTTP ${response.status}`);
  return { url, status: response.status, bytes: Buffer.byteLength(text), text };
}

function parseImportMap(html) {
  const match = html.match(/<script\b[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);
  assert.ok(match, 'index.html has no importmap');
  return JSON.parse(match[1]);
}

function parseModuleScripts(html) {
  const scripts = [];
  const re = /<script\b(?=[^>]*type=["']module["'])(?=[^>]*src=["']([^"']+)["'])[^>]*>/gi;
  let match;
  while ((match = re.exec(html))) scripts.push(match[1]);
  assert.ok(scripts.length > 0, 'index.html has no module script');
  return scripts;
}

function resolveImport(specifier, fromPath, importMap) {
  if (/^[a-z]+:/i.test(specifier)) throw new Error(`remote module import is not allowed: ${specifier}`);
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return new URL(specifier, new URL(fromPath, 'http://local.invalid')).pathname;
  }
  const imports = importMap.imports ?? {};
  if (Object.hasOwn(imports, specifier)) {
    return new URL(imports[specifier], new URL('/index.html', 'http://local.invalid')).pathname;
  }
  for (const [prefix, target] of Object.entries(imports)) {
    if (prefix.endsWith('/') && specifier.startsWith(prefix)) {
      return new URL(`${target}${specifier.slice(prefix.length)}`,
        new URL('/index.html', 'http://local.invalid')).pathname;
    }
  }
  throw new Error(`unmapped bare module import "${specifier}" from ${fromPath}`);
}

function importedSpecifiers(source) {
  const specs = new Set();
  const staticRe = /\b(?:import|export)\s*(?:[^'"]*?\bfrom\s*)?["']([^"']+)["']/g;
  const dynamicRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const re of [staticRe, dynamicRe]) {
    let match;
    while ((match = re.exec(source))) specs.add(match[1]);
  }
  return [...specs];
}

async function crawlModules(entryScripts, importMap) {
  const pending = entryScripts.map((script) =>
    new URL(script, new URL('/index.html', 'http://local.invalid')).pathname
  );
  const seen = new Map();
  while (pending.length > 0) {
    const modulePath = pending.shift();
    if (seen.has(modulePath)) continue;
    const fetched = await fetchText(modulePath);
    seen.set(modulePath, fetched.bytes);
    for (const specifier of importedSpecifiers(fetched.text)) {
      const next = resolveImport(specifier, modulePath, importMap);
      if (!seen.has(next)) pending.push(next);
    }
  }
  return seen;
}

function validatePalette(palette, name) {
  assert.ok(Array.isArray(palette) && palette.length > 0, `${name} is empty`);
  for (const [index, color] of palette.entries()) {
    assert.ok(Array.isArray(color) && color.length === 3, `${name}[${index}] must be RGB`);
    for (const channel of color) {
      assert.ok(Number.isInteger(channel) && channel >= 0 && channel <= 255,
        `${name}[${index}] channel ${channel} must be 0..255`);
    }
  }
}

async function validateAssets() {
  const indexFetch = await fetchText('/assets/levels/index.json');
  const index = JSON.parse(indexFetch.text);
  assert.equal(index.version, 1);
  assert.equal(index.generatedFrom, 'ROADS.LZS');
  assert.equal(index.count, 31);
  assert.equal(index.levels.length, 31);
  assert.equal(new Set(index.levels.map((entry) => entry.roadIndex)).size, 31);

  const totals = { cells: 0, instances: 0, nonEmpty: 0, maxDrawables: 0 };
  const levelFiles = [];
  for (const entry of index.levels) {
    assert.match(entry.file, /^level_\d+\.json$/);
    const levelFetch = await fetchText(`/assets/levels/${entry.file}`);
    const level = validateLevel(JSON.parse(levelFetch.text));
    assert.equal(level.roadIndex, entry.roadIndex);
    assert.equal(level.length, entry.length);
    const counts = expectedCounts(level);
    totals.cells += level.length * level.columns;
    totals.instances += counts.flat + counts.short + counts.tall + counts.tunnel;
    totals.nonEmpty += counts.nonEmpty;
    totals.maxDrawables += maxChunkDrawables(level);
    levelFiles.push(entry.file);
  }
  assert.deepEqual(totals, {
    cells: 30436,
    instances: 17357,
    nonEmpty: 15265,
    maxDrawables: 681,
  });

  for (let world = 0; world < 10; world++) {
    const paletteFetch = await fetchText(`/assets/palettes/world_${world}.json`);
    validatePalette(JSON.parse(paletteFetch.text), `world_${world}.json`);
  }

  return { indexBytes: indexFetch.bytes, levels: levelFiles.length, palettes: 10, totals };
}

const root = await fetchText('/');
const index = await fetchText('/index.html');
assert.equal(root.text, index.text, 'root and /index.html should serve the same document');
const importMap = parseImportMap(index.text);
const modules = await crawlModules(parseModuleScripts(index.text), importMap);
const assets = trackedOnly ? null : await validateAssets();

console.log(JSON.stringify({
  base: base.href,
  mode: trackedOnly ? 'tracked-only' : 'full-assets',
  documents: [
    { path: '/', status: root.status, bytes: root.bytes },
    { path: '/index.html', status: index.status, bytes: index.bytes },
  ],
  modules: {
    count: modules.size,
    paths: [...modules.keys()].sort(),
  },
  assets,
}, null, 2));
