[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$TargetId,
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [switch]$PlanOnly
)

$ErrorActionPreference = 'Stop'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path

trap {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [void][System.Windows.Forms.MessageBox]::Show(
            $_.Exception.Message,
            'Aynı Dizine Kopyala - Kuyruk Hatası',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        )
    }
    catch {
        # Explorer'dan çalışırken ikincil GUI hatasını yut.
    }
    exit 1
}

$copyScript = (Resolve-Path -LiteralPath (Join-Path $scriptDirectory 'Copy-SamePath.ps1')).Path
$resolvedConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path

$keyText = "$TargetId|$resolvedConfigPath|$([bool]$PlanOnly)"
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
    $hashBytes = $sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($keyText))
}
finally {
    $sha256.Dispose()
}
$queueId = (-join @($hashBytes | ForEach-Object { $_.ToString('x2') })).Substring(0, 32)
$queueDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "SamePathCopy\Queue\$queueId"
[void][System.IO.Directory]::CreateDirectory($queueDirectory)

$requestId = '{0:yyyyMMddHHmmssfffffff}-{1}' -f [DateTime]::UtcNow, [guid]::NewGuid().ToString('N')
$temporaryRequest = Join-Path $queueDirectory "$requestId.tmp"
$requestPath = Join-Path $queueDirectory "$requestId.request"
[System.IO.File]::WriteAllText($temporaryRequest, $SourcePath, (New-Object System.Text.UTF8Encoding($false)))
[System.IO.File]::Move($temporaryRequest, $requestPath)

$mutex = New-Object System.Threading.Mutex($false, "Local\SamePathCopy_$queueId")
$hasLock = $false
$requestFiles = @()
try {
    try {
        $hasLock = $mutex.WaitOne(0)
    }
    catch [System.Threading.AbandonedMutexException] {
        $hasLock = $true
    }
    if (-not $hasLock) {
        exit 0
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(3)
    $stableSince = [DateTime]::UtcNow
    $lastSnapshot = ''
    do {
        Start-Sleep -Milliseconds 100
        $requestFiles = @(Get-ChildItem -LiteralPath $queueDirectory -Filter '*.request' -File | Sort-Object Name)
        $snapshot = @($requestFiles.Name) -join '|'
        if ($snapshot -ne $lastSnapshot) {
            $lastSnapshot = $snapshot
            $stableSince = [DateTime]::UtcNow
        }
    } while (($requestFiles.Count -eq 0 -or ([DateTime]::UtcNow - $stableSince).TotalMilliseconds -lt 400) -and [DateTime]::UtcNow -lt $deadline)

    $paths = @($requestFiles | ForEach-Object {
        [System.IO.File]::ReadAllText($_.FullName, [System.Text.Encoding]::UTF8)
    } | Select-Object -Unique)
    foreach ($requestFile in $requestFiles) {
        Remove-Item -LiteralPath $requestFile.FullName -Force
    }
}
finally {
    if ($hasLock) {
        $mutex.ReleaseMutex()
    }
    $mutex.Dispose()
}

if ($paths.Count -gt 0) {
    if ($PlanOnly) {
        @(& $copyScript -SourcePath $paths -TargetId $TargetId -ConfigPath $resolvedConfigPath -PlanOnly) |
            ConvertTo-Json -Compress
    }
    else {
        & $copyScript -SourcePath $paths -TargetId $TargetId -ConfigPath $resolvedConfigPath
    }
}
