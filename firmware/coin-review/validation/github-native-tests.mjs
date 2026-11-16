// Offline native tests only: no backend, SDK, journals, or credentials.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const sources = [
  'esp32/CAPSTONE_MEDICINE_VENDO/CoinPaymentCore.h',
  'firmware/coin-review/CoinEventReviewCore.h',
  'esp32/tests/coin-payment-core.c',
  'firmware/coin-review/review-core.test.cpp',
];

export function run(root, output, execute = spawnSync) {
  mkdirSync(output, { recursive: true });
  for (const source of sources) {
    console.log(`SHA256 ${createHash('sha256').update(readFileSync(resolve(root, source))).digest('hex')} ${source}`);
  }
  const env = {
    PATH: '/usr/bin:/bin', HOME: output, LANG: 'C.UTF-8',
    ASAN_OPTIONS: 'halt_on_error=1:detect_leaks=1',
    UBSAN_OPTIONS: 'halt_on_error=1:print_stacktrace=1',
  };
  const results = [];
  const common = ['-Wall', '-Wextra', '-Wpedantic', '-g', '-O1',
    '-I', resolve(root, 'esp32/CAPSTONE_MEDICINE_VENDO'),
    '-I', resolve(root, 'firmware/coin-review')];
  const options = { env, timeout: 60_000, stdio: 'inherit' };
  for (const sanitized of [false, true]) {
    for (const [suite, compiler, standard, source] of [
      ['payment', 'gcc', 'c99', sources[2]],
      ['review', 'g++', 'c++17', sources[3]],
    ]) {
      const name = `${suite}-${sanitized ? 'asan-ubsan' : 'normal'}`;
      const binary = resolve(output, name);
      const flags = sanitized ? ['-fsanitize=address,undefined', '-fno-omit-frame-pointer'] : [];
      console.log(`\n=== ${name} ===`);
      const compile = execute(compiler, [`-std=${standard}`, ...common, ...flags,
        resolve(root, source), '-o', binary], options);
      let result;
      if (compile.error?.code === 'ENOENT') result = 'BLOCKED (compiler missing)';
      else if (compile.error || compile.status !== 0) result = 'FAIL (compile; execution blocked)';
      else {
        const test = execute(binary, [], options);
        result = !test.error && test.status === 0 ? 'PASS' : 'FAIL (runtime, signal, or timeout)';
      }
      results.push({ name, result });
    }
  }
  console.log('\nNative fault-test results (physical ESP32 tests NOT EXECUTED):');
  for (const { name, result } of results) console.log(`${name}: ${result}`);
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.platform !== 'linux' || process.argv.length !== 4) {
    console.error('Requires the approved Linux CI environment and source/output paths.');
    process.exitCode = 2;
  } else {
    const results = run(resolve(process.argv[2]), resolve(process.argv[3]));
    process.exitCode = results.every(({ result }) => result === 'PASS') ? 0 : 1;
  }
}
