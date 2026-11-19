param([string]$OutputDirectory='tmp\coin-review-validation-kit')
$ErrorActionPreference='Stop'
$workspace=Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent
$target=[IO.Path]::GetFullPath((Join-Path $workspace $OutputDirectory))
$tmpRoot=[IO.Path]::GetFullPath((Join-Path $workspace 'tmp'))+[IO.Path]::DirectorySeparatorChar
if(-not $target.StartsWith($tmpRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Output must stay under workspace tmp.'}
if(Test-Path -LiteralPath $target){throw 'Use a new output directory to preserve the previous evidence package.'}
New-Item -ItemType Directory -Path (Join-Path $target 'core'),(Join-Path $target 'tests') -Force | Out-Null
$utf8=New-Object System.Text.UTF8Encoding($false)
$files=@{
  'core/CoinPaymentCore.h'='esp32/CAPSTONE_MEDICINE_VENDO/CoinPaymentCore.h'
  'core/CoinEventReviewCore.h'='firmware/coin-review/CoinEventReviewCore.h'
  'tests/review-core.test.cpp'='firmware/coin-review/review-core.test.cpp'
  'tests/coin-payment-core.c'='esp32/tests/coin-payment-core.c'
  'run-native-tests.sh'='firmware/coin-review/validation/run-native-tests.sh'
}
$manifest=@();$origins=@()
foreach($relative in $files.Keys | Sort-Object){
  $source=Join-Path $workspace $files[$relative]
  $contents=[IO.File]::ReadAllText($source).Replace("`r`n","`n")
  if($relative -eq 'tests/coin-payment-core.c'){$contents=$contents.Replace('../CAPSTONE_MEDICINE_VENDO/CoinPaymentCore.h','CoinPaymentCore.h')}
  $destination=Join-Path $target $relative
  [IO.File]::WriteAllText($destination,$contents,$utf8)
  $manifest+=((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLower()+'  '+$relative)
  $origins+=[pscustomobject]@{file=$relative;source=$files[$relative];source_sha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash;package_sha256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash}
}
[IO.File]::WriteAllText((Join-Path $target 'manifest.sha256'),($manifest -join "`n")+"`n",$utf8)
[IO.File]::WriteAllText((Join-Path $target 'source-origins.json'),($origins | ConvertTo-Json -Depth 3),$utf8)
Write-Output 'Source-only kit prepared. No tests were executed, installed, signed, or uploaded.'
Write-Output $target
