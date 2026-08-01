[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$taskName = "SiftExtensionDev"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$supervisorPath = Join-Path $repoRoot "scripts\extension-dev-supervisor.js"
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

if (-not (Test-Path (Join-Path $repoRoot ".git") -PathType Container)) {
  throw "Register this task from the main Sift repository, not a worktree."
}

$action = New-ScheduledTaskAction `
  -Execute $nodePath `
  -Argument ('"' + $supervisorPath + '"') `
  -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal `
  -UserId $userId `
  -LogonType Interactive `
  -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -Hidden `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Force | Out-Null

Start-ScheduledTask -TaskName $taskName
Write-Output "Registered and started $taskName for $repoRoot"
