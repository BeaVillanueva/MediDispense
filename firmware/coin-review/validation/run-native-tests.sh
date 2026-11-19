#!/usr/bin/env bash
# Run only inside a security-owner-approved Linux development environment.
set -euo pipefail
if [[ $# != 2 || "$1" != "--approved-environment" || -z "$2" ]]; then
  echo 'Approval required. After approval: bash run-native-tests.sh --approved-environment "approved lab/VM identifier"' >&2
  exit 2
fi
[[ "$(uname -s)" == Linux ]] || { echo 'This package targets an approved Linux runtime; it does not bypass Windows policy.' >&2; exit 2; }
cd -- "$(dirname -- "$0")"
sha256sum --check manifest.sha256
command -v gcc >/dev/null
command -v g++ >/dev/null
out="$(mktemp -d "$PWD/results-XXXXXXXX")"
printf 'UTC: %s\nApproved environment supplied by operator: %s\n' "$(date -u +%FT%TZ)" "$2" > "$out/environment.txt"
uname -a >> "$out/environment.txt"
gcc --version >> "$out/environment.txt"
g++ --version >> "$out/environment.txt"
printf 'case\tresult\n' > "$out/results.tsv"
run_case() {
  local name="$1"; shift
  if "$@" > "$out/$name.log" 2>&1; then
    printf '%s\tPASS\n' "$name" | tee -a "$out/results.tsv"
  else
    printf '%s\tFAIL\n' "$name" | tee -a "$out/results.tsv"
    cat "$out/$name.log" >&2
    echo "Stopped; preserve results at $out" >&2
    exit 1
  fi
}
common=(-Wall -Wextra -Wpedantic -g -O1 -I core)
run_case compile-payment gcc -std=c99 "${common[@]}" tests/coin-payment-core.c -o "$out/payment"
run_case payment "$out/payment"
run_case compile-review g++ -std=c++17 "${common[@]}" tests/review-core.test.cpp -o "$out/review"
run_case review "$out/review"
sanitize=(-fsanitize=address,undefined -fno-omit-frame-pointer)
run_case compile-payment-sanitized gcc -std=c99 "${common[@]}" "${sanitize[@]}" tests/coin-payment-core.c -o "$out/payment-sanitized"
run_case payment-sanitized "$out/payment-sanitized"
run_case compile-review-sanitized g++ -std=c++17 "${common[@]}" "${sanitize[@]}" tests/review-core.test.cpp -o "$out/review-sanitized"
run_case review-sanitized "$out/review-sanitized"
echo "Native runs completed. Results: $out/results.tsv"
echo 'These are host fault simulations, not physical ESP32/NVS power-loss validation.'
