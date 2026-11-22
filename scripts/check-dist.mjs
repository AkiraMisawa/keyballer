// Fails the build if dist/ names the local sign-in settings or contains their values. They live
// in .env.local for Vite's own server (vite.config.ts) and must never reach the published site.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from 'vite';

const PREFIX = 'KEYBALLER_GITHUB_';
const env = loadEnv('production', process.cwd(), PREFIX);
const needles = [[PREFIX, 'the variable names'], ...Object.entries(env).filter(([, v]) => v.trim().length >= 8).map(([k, v]) => [v.trim(), `the value of ${k}`])];

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else yield path;
  }
}

let found = false;
for (const file of files('dist')) {
  const text = readFileSync(file, 'latin1');
  for (const [needle, what] of needles) {
    if (text.includes(needle)) {
      console.error(`${file} contains ${what}`);
      found = true;
    }
  }
}
if (found) process.exit(1);
console.log(`dist/ is free of the sign-in settings (${needles.length - 1} value(s) checked).`);
