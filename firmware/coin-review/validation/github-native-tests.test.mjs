import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { run } from './github-native-tests.mjs';

const root = resolve(import.meta.dirname, '../../..');
function simulate(response) {
  const calls = [];
  // Keep simulated PASS/FAIL output out of real native-test evidence logs.
  const log = console.log;
  console.log = () => {};
  try {
    const results = run(root, mkdtempSync(resolve(tmpdir(), 'coin-ci-mock-')), (...args) => {
      calls.push(args);
      return response(...args);
    });
    return { results, calls };
  } finally {
    console.log = log;
  }
}
test('four cases compile and execute; synthetic environment has no inherited secrets', () => {
  const { results, calls } = simulate(() => ({ status: 0 }));
  assert.equal(calls.length, 8);
  assert.ok(results.every(r => r.result === 'PASS'));
  assert.deepEqual(Object.keys(calls[0][2].env).sort(), ['ASAN_OPTIONS', 'HOME', 'LANG', 'PATH', 'UBSAN_OPTIONS']);
  assert.ok(calls[4][1].includes('-fsanitize=address,undefined'));
  assert.ok(calls[6][1].includes('-fsanitize=address,undefined'));
  assert.ok(!calls.some(c => c[1].includes('-DNDEBUG')));
});
test('compile failure skips that executable and continues all suites', () => {
  const { results, calls } = simulate(() => ({ status: 1 }));
  assert.equal(calls.length, 4);
  assert.ok(results.every(r => r.result.startsWith('FAIL (compile')));
});
test('missing compiler reports blocked, never passed', () => {
  const { results } = simulate(() => ({ error: { code: 'ENOENT' }, status: null }));
  assert.ok(results.every(r => r.result.startsWith('BLOCKED')));
});
test('runtime failure or timeout cannot pass', () => {
  const { results } = simulate((command) => command === 'gcc' || command === 'g++'
    ? { status: 0 } : { status: null, error: { code: 'ETIMEDOUT' } });
  assert.ok(results.every(r => r.result.startsWith('FAIL (runtime')));
});
