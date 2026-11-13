$ErrorActionPreference = 'Stop'
$stage = (Resolve-Path (Join-Path $PSScriptRoot 'CAPSTONE_MEDICINE_VENDO')).Path
$target = 'C:\Users\Cla\OneDrive\Documents\Arduino\CAPSTONE_MEDICINE_VENDO'
$sketch = Join-Path $target 'CAPSTONE_MEDICINE_VENDO.ino'
$expected = (Get-Content -LiteralPath (Join-Path $stage 'source-baseline.sha256') -Raw).Trim()
if ((Get-FileHash -LiteralPath $sketch -Algorithm SHA256).Hash -ne $expected) { throw 'Arduino source changed after inspection. Re-review before applying; no files changed.' }
$original = [IO.File]::ReadAllText($sketch).Replace("`r`n", "`n")
$updated = [IO.File]::ReadAllText((Join-Path $stage 'CAPSTONE_MEDICINE_VENDO.ino')).Replace("`r`n", "`n")
foreach ($name in @('WIFI_SSID','WIFI_PASSWORD')) {
    $pattern = '(?m)^const char\* ' + $name + ' = [^\r\n]+'
    $configurationLine = [regex]::Match($original,$pattern)
    if (-not $configurationLine.Success) { throw 'Private Wi-Fi definition missing. No files changed.' }
    $preservedLine = $configurationLine.Value
    $updated = [regex]::Replace($updated,$pattern,[Text.RegularExpressions.MatchEvaluator]{param($match) $preservedLine})
}
# All motor, IR, Firebase command and sensor callback implementations must remain identical.
$start = $original.IndexOf('void stopMotor(')
$end = $original.IndexOf('// PAYMENT SESSION',$start)
$newStart = $updated.IndexOf('void stopMotor(')
$newEnd = $updated.IndexOf('// PAYMENT SESSION',$newStart)
if ($start -lt 0 -or $end -lt $start -or $newStart -lt 0 -or $newEnd -lt $newStart -or $original.Substring($start,$end-$start) -cne $updated.Substring($newStart,$newEnd-$newStart)) { throw 'Protected motor/sensor/Firebase region differs. No files changed.' }
if ($original -cne $updated) { throw 'Sketch differs from the reviewed header-only safety update. Re-review the source instead of overwriting unrelated edits.' }
$backup = $sketch + '.before-coin-reliability-' + [guid]::NewGuid().ToString('N').Substring(0,8) + '.bak'
Copy-Item -LiteralPath $sketch -Destination $backup
$headers=@('ReliableCoinPayment.h','CoinPaymentCore.h')
if(Test-Path -LiteralPath (Join-Path $stage 'PaymentDemo.local.h')) { $headers+='PaymentDemo.local.h' }
foreach ($header in $headers) {
    $headerTarget = Join-Path $target $header
    if (Test-Path -LiteralPath $headerTarget) { Copy-Item -LiteralPath $headerTarget -Destination ($headerTarget + '.before-safety-review-' + [guid]::NewGuid().ToString('N').Substring(0,8) + '.bak') }
    Copy-Item -LiteralPath (Join-Path $stage $header) -Destination $headerTarget
}
[IO.File]::WriteAllText($sketch,$updated,(New-Object Text.UTF8Encoding($false)))
Write-Output 'Arduino source updated with protected motor/sensor/Firebase region verified unchanged.'
Write-Output 'Private Wi-Fi definitions preserved; secrets.h untouched. Backup created beside the sketch.'
Write-Output 'No firmware upload, board reset, motor command or test payment was performed.'
