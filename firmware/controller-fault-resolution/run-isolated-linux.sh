#!/usr/bin/env bash
# Run only inside a separately approved network/credential/device-isolated Linux sandbox.
# Does not create namespaces or claim that the caller's environment is isolated.
set -euo pipefail
if [[ "${CFR_APPROVED_ISOLATED_TEST_ENV:-}" != 'yes' ]]; then
  echo 'BLOCKED: approved isolated environment must be explicitly confirmed.' >&2
  exit 2
fi
source_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
output="$(mktemp -d)"
echo "Synthetic native output: $output"
for mode in normal sanitized; do
  flags=()
  if [[ "$mode" == sanitized ]]; then
    flags=(-fsanitize=address,undefined -fno-omit-frame-pointer)
  fi
  /usr/bin/g++ -std=c++17 -Wall -Wextra -Wpedantic -Werror -g -O1 "${flags[@]}" \
    "$source_dir/core.test.cpp" -o "$output/$mode"
  env -i PATH=/usr/bin:/bin HOME="$output" LANG=C \
    ASAN_OPTIONS=halt_on_error=1:detect_leaks=1 UBSAN_OPTIONS=halt_on_error=1 \
    "$output/$mode"
done
