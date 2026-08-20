Set-StrictMode -Version 2.0

# Günlük, araç klasörünün altındaki log\root.log dosyasına yazılır. Klasör yazılabilir değilse (salt okunur
# paylaşımdan çalıştırma) %LOCALAPPDATA%\SamePathCopy\log\root.log kullanılır. SAMEPATHCOPY_LOG ortam
# değişkeni her ikisini de geçersiz kılar (testler bunu kullanır).
$script:SamePathCopyLogPath = $null
$script:SamePathCopyLogRunId = $null
$script:SamePathCopyLogMaxBytes = 5MB
$script:SamePathCopyLogKeep = 3

function Get-SamePathCopyLogRunId {
    if ([string]::IsNullOrWhiteSpace($script:SamePathCopyLogRunId)) {
        # Aynı dosyaya birden fazla süreç yazabildiği için her çalıştırma kısa bir kimlikle etiketlenir.
        $script:SamePathCopyLogRunId = [guid]::NewGuid().ToString('N').Substring(0, 8)
    }
    return $script:SamePathCopyLogRunId
}

function Test-SamePathCopyWritableDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)

    try {
        if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
            [void](New-Item -ItemType Directory -Path $Path -Force -ErrorAction Stop)
        }
        $probe = Join-Path $Path ('.spc-write-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
        [System.IO.File]::WriteAllText($probe, 'x')
        Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
        return $true
    }
    catch {
        return $false
    }
}

function Initialize-SamePathCopyLog {
    param([string]$ScriptDirectory)

    if (-not [string]::IsNullOrWhiteSpace($env:SAMEPATHCOPY_LOG)) {
        $script:SamePathCopyLogPath = [string]$env:SAMEPATHCOPY_LOG
        $overrideDirectory = Split-Path -Parent $script:SamePathCopyLogPath
        if ($overrideDirectory) { [void](Test-SamePathCopyWritableDirectory -Path $overrideDirectory) }
        return $script:SamePathCopyLogPath
    }

    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($ScriptDirectory)) { $candidates += (Join-Path $ScriptDirectory 'log') }
    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { $candidates += (Join-Path $env:LOCALAPPDATA 'SamePathCopy\log') }
    $candidates += (Join-Path ([System.IO.Path]::GetTempPath()) 'SamePathCopy\log')

    foreach ($candidate in $candidates) {
        if (Test-SamePathCopyWritableDirectory -Path $candidate) {
            $script:SamePathCopyLogPath = Join-Path $candidate 'root.log'
            return $script:SamePathCopyLogPath
        }
    }
    $script:SamePathCopyLogPath = $null
    return $null
}

function Get-SamePathCopyLogPath {
    if ([string]::IsNullOrWhiteSpace($script:SamePathCopyLogPath)) {
        return (Initialize-SamePathCopyLog -ScriptDirectory $PSScriptRoot)
    }
    return $script:SamePathCopyLogPath
}

function Invoke-SamePathCopyLogRotation {
    param([Parameter(Mandatory = $true)][string]$Path)

    # root.log büyüdüğünde root.1.log, root.2.log ... olarak kaydırılır; en eskisi silinir.
    try {
        if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
        if ((Get-Item -LiteralPath $Path -Force).Length -lt $script:SamePathCopyLogMaxBytes) { return }

        $directory = Split-Path -Parent $Path
        $baseName = [System.IO.Path]::GetFileNameWithoutExtension($Path)
        $extension = [System.IO.Path]::GetExtension($Path)
        $oldest = Join-Path $directory ("{0}.{1}{2}" -f $baseName, $script:SamePathCopyLogKeep, $extension)
        if (Test-Path -LiteralPath $oldest -PathType Leaf) { Remove-Item -LiteralPath $oldest -Force }
        for ($index = $script:SamePathCopyLogKeep - 1; $index -ge 1; $index--) {
            $source = Join-Path $directory ("{0}.{1}{2}" -f $baseName, $index, $extension)
            if (Test-Path -LiteralPath $source -PathType Leaf) {
                Move-Item -LiteralPath $source -Destination (Join-Path $directory ("{0}.{1}{2}" -f $baseName, ($index + 1), $extension)) -Force
            }
        }
        Move-Item -LiteralPath $Path -Destination (Join-Path $directory ("{0}.1{1}" -f $baseName, $extension)) -Force
    }
    catch {
        # Kaydırma başarısız olsa da günlük yazmaya devam edilir.
    }
}

function Write-SamePathCopyLog {
    param(
        [Parameter(Mandatory = $true)][string]$Message,
        [ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level = 'INFO',
        [string]$Component = 'Genel'
    )

    # Günlük yazımı hiçbir koşulda kopyalamayı bozmamalı; bütün hatalar yutulur.
    try {
        $path = Get-SamePathCopyLogPath
        if ([string]::IsNullOrWhiteSpace($path)) { return }

        $line = '{0} [{1,-5}] [{2}] [{3}] {4}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss.fff'),
            $Level, (Get-SamePathCopyLogRunId), $Component, ($Message -replace '\r?\n', ' | ')

        $mutex = New-Object System.Threading.Mutex($false, 'Local\SamePathCopyLog')
        $hasLock = $false
        try {
            try { $hasLock = $mutex.WaitOne(2000) } catch [System.Threading.AbandonedMutexException] { $hasLock = $true }
            Invoke-SamePathCopyLogRotation -Path $path
            [System.IO.File]::AppendAllText($path, $line + [System.Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
        }
        finally {
            if ($hasLock) { $mutex.ReleaseMutex() }
            $mutex.Dispose()
        }
    }
    catch {
    }
}

function Get-SamePathCopyLastRunSummary {
    # Sihirbaz açılışında "en son ne oldu" bilgisini göstermek için günlüğün sonundaki özet satırı okunur.
    try {
        $path = Get-SamePathCopyLogPath
        if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }

        $stream = [System.IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
        try {
            # Dosyanın yalnızca son parçası okunur; günlük büyüdüğünde de hızlı kalır.
            $tailLength = [Math]::Min($stream.Length, 64KB)
            [void]$stream.Seek(-$tailLength, [System.IO.SeekOrigin]::End)
            $buffer = New-Object byte[] $tailLength
            [void]$stream.Read($buffer, 0, $buffer.Length)
            $text = [System.Text.Encoding]::UTF8.GetString($buffer)
        }
        finally {
            $stream.Dispose()
        }

        $lastLine = @($text -split '\r?\n' | Where-Object { $_ -match '\[Kopyala\] Bitti: ' })[-1]
        if ([string]::IsNullOrWhiteSpace($lastLine)) { return $null }
        if ($lastLine -notmatch '^(?<stamp>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\.\d{3} .*\[Kopyala\] (?<summary>Bitti: .+)$') { return $null }

        return [pscustomobject]@{
            Timestamp = $Matches['stamp']
            Summary = $Matches['summary']
            Text = "{0} — {1}" -f $Matches['stamp'], $Matches['summary']
        }
    }
    catch {
        return $null
    }
}

function Write-SamePathCopyLogStart {
    param(
        [Parameter(Mandatory = $true)][string]$Component,
        [Parameter(Mandatory = $true)][string]$Summary
    )

    Write-SamePathCopyLog -Component $Component -Message ('=== {0} | pid {1} | {2}\{3} | PowerShell {4} ===' -f
        $Summary, $PID, $env:USERDOMAIN, $env:USERNAME, $PSVersionTable.PSVersion)
}
