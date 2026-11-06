// twin.bundle.js (used when index.html is opened from disk) must match the source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourceHash } from '../tools/build.mjs';

test('twin.bundle.js is up to date with the source (run `npm run build` if not)', () => {
  const head = readFileSync(new URL('../twin.bundle.js', import.meta.url), 'utf8').slice(0, 400);
  const m = head.match(/source-hash: (\w+)/);
  assert.ok(m, 'bundle has no source hash');
  assert.equal(m[1], sourceHash(), 'twin.bundle.js is stale: run `cd warehouse && npm run build`');
});
