$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$workerPath = (Resolve-Path (Join-Path $PSScriptRoot 'sync-transaction-references.php')).Path
$phpPath = 'C:\xampp\php\php.exe'
if (-not (Test-Path -LiteralPath $phpPath)) { $phpPath = (Get-Command php.exe -ErrorAction Stop).Source }
# Seed current maxima only; no historical Firebase writes.
& $phpPath $workerPath --initialize
if ($LASTEXITCODE -ne 0) { throw 'Reference synchronization initialization failed.' }
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$command = "& '" + $phpPath.Replace("'", "''") + "' '" + $workerPath.Replace("'", "''") + "' --watch"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -Command "' + $command + '"') -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'MediDispense Reference Sync' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Synchronize identity metadata for new purchases and dispense requests; never dispatch hardware.' -Force | Out-Null
Start-ScheduledTask -TaskName 'MediDispense Reference Sync'
Get-ScheduledTask -TaskName 'MediDispense Reference Sync' | Select-Object TaskName,State
