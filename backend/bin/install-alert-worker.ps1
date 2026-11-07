$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$workerPath = (Resolve-Path (Join-Path $PSScriptRoot 'alert-worker.php')).Path
if (-not $workerPath.StartsWith($projectRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Worker must remain in this checkout.' }
$phpPath = (Get-Command php.exe -ErrorAction Stop).Source
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$workerCommand = "& '" + $phpPath.Replace("'", "''") + "' '" + $workerPath.Replace("'", "''") + "' --watch"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -Command "' + $workerCommand + '"') -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
if (Get-ScheduledTask -TaskName 'MediDispense Alert Monitor' -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName 'MediDispense Alert Monitor' }
# Stopping the PowerShell task alone can leave its PHP child alive. Stop only
# this exact checkout's alert daemon; never touch Apache or other PHP scripts.
$workerPattern = '(?i)(?:^|\s|")' + [regex]::Escape($workerPath) + '(?:"|\s|$)'
Get-CimInstance Win32_Process -Filter "Name='php.exe'" | Where-Object {
    $_.ExecutablePath -eq $phpPath -and $_.CommandLine -match $workerPattern -and $_.CommandLine -match '(?:^|\s)--watch(?:\s|$)'
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Register-ScheduledTask -TaskName 'MediDispense Alert Monitor' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Detect stock/dispense incidents every five seconds and deliver queued emails only when SMTP is configured.' -Force | Out-Null
Start-ScheduledTask -TaskName 'MediDispense Alert Monitor'
Get-ScheduledTask -TaskName 'MediDispense Alert Monitor' | Select-Object TaskName,State
