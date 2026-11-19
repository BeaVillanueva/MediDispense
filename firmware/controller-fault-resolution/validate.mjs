// Local source-boundary checks only. Never executes an unsigned native binary.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const read = name => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
const core = read('ControllerFaultResolutionCore.h');
const suite = read('core.test.cpp');
let passed = 0;
function check(name, predicate) { assert.ok(predicate, name); console.log(`PASS ${name}`); passed++; }
check('only standard C++ headers', [...core.matchAll(/#include\s+([^\n]+)/g)].every(m => /^<(cstdint|cinttypes|cstddef|cstdio|cstring)>$/.test(m[1])));
check('no service hardware or persistence SDK', !/WiFi|Firebase|HTTPClient|Preferences|Serial|GPIO|COM5|sqlite|mysql|system\s*\(/i.test(core+suite));
check('no production identifiers', !/2C8C6AF3AF48|20799D470968|2202FD51F9C2DB7E/.test(core+suite));
check('hold has no release path', /bool hold\(\) \{ return true; \}/.test(core) && !/bool release\(/.test(core));
check('versioned separate signing domains', core.includes('cfr-auth-v1') && core.includes('cfr-ack-v1'));
check('every transition explicitly disabled', (core.match(/if \(!enabled\) return Result::Disabled;/g)||[]).length===3);
check('synthetic persistence interruption matrix', suite.includes('phase<=3') && suite.includes('for (bool committed:{false,true})'));
check('reboot fault missing replay coverage present', ['prepared reboot','new fault during','missing records','expiry replay'].every(x=>suite.includes(x)));
console.log(`SUMMARY source_checks=${passed} failed=0 native_runtime=BLOCKED sanitizer=BLOCKED`);
