param([string]$SourceSketch='C:\Users\Cla\OneDrive\Documents\Arduino\CAPSTONE_MEDICINE_VENDO')
$ErrorActionPreference='Stop'
$workspace=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$candidate=Join-Path $workspace 'tmp\coin-review-build\CAPSTONE_MEDICINE_VENDO'
New-Item -ItemType Directory -Path $candidate -Force | Out-Null
foreach($file in @('CAPSTONE_MEDICINE_VENDO.ino','CoinPaymentCore.h','ReliableCoinPayment.h','WiFiConnection.h','secrets.h','PaymentDemo.local.h')){
  $source=Join-Path $SourceSketch $file
  if(Test-Path -LiteralPath $source){Copy-Item -LiteralPath $source -Destination (Join-Path $candidate $file)}
}
foreach($file in @('CoinEventReviewCore.h','CoinEventReview.h')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $candidate $file)}
$sketch=Join-Path $candidate 'CAPSTONE_MEDICINE_VENDO.ino'
$text=[IO.File]::ReadAllText($sketch)
$text=$text.Replace('#include "ReliableCoinPayment.h"',"static void handleCoinReviewCommand(const String &command);`r`n#include `"ReliableCoinPayment.h`"`r`n#include `"CoinEventReview.h`"")
$text=$text.Replace('  handleCoinMaintenance();',"  handleCoinMaintenance();`r`n  serviceCoinReviewAck();")
[IO.File]::WriteAllText($sketch,$text)
$reliable=Join-Path $candidate 'ReliableCoinPayment.h'
$text=[IO.File]::ReadAllText($reliable)
$anchor='      command.trim();'
if(-not $text.Contains($anchor)){throw 'Coin maintenance hook does not match this firmware version.'}
$text=$text.Replace($anchor,$anchor+"`r`n      handleCoinReviewCommand(command);")
[IO.File]::WriteAllText($reliable,$text)
# Compile-only key; never accepted by the disabled production backend. Do not upload this build.
$key=@'
#pragma once
#define MEDIDISPENSE_COIN_REVIEW_ENABLED 1
#define MEDIDISPENSE_COIN_REVIEW_KEY_HEX "1111111111111111111111111111111111111111111111111111111111111111"
'@
[IO.File]::WriteAllText((Join-Path $candidate 'CoinReview.local.h'),$key)
Write-Output 'Private compile-only candidate prepared in tmp/coin-review-build. Original sketch and NVS unchanged. DO NOT UPLOAD this test-key build.'
