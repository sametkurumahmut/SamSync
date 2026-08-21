[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string[]]$SourcePath,
    [Parameter(Mandatory = $true)][string]$TargetId,
    [string]$ConfigPath,
    [switch]$PlanOnly,
    # Explorer, seçilen her öğe için komutu bir kez çalıştırıyor ve "%1" yerine tek yol yazıyor; bu
    # çağrılar aşağıdaki kuyrukta tek kopyalamada toplanıyor. Bazı kabuk sürümleri ise bütün seçimi tek
    # komut satırına diziyor ("%1" yerine yolların hepsi). O durumda fazladan yollar adsız bağımsız
    # değişken olarak buraya düşer; kaynak listesine katılıyor ki iki davranışta da seçimin tamamı gitsin.
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$AdditionalSourcePath
)

$ErrorActionPreference = 'Stop'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDirectory 'SamePathCopy.Log.ps1')
[void](Initialize-SamePathCopyLog -ScriptDirectory $scriptDirectory)
$requestedPaths = @(@(@($SourcePath) + @($AdditionalSourcePath)) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
Write-SamePathCopyLogStart -Component 'Kuyruk' -Summary ("Kuyruk isteği: hedef '{0}', {1} kaynak: {2}" -f
    $TargetId, $requestedPaths.Count, ($requestedPaths -join ' | '))

trap {
    Write-SamePathCopyLog -Component 'Kuyruk' -Level 'ERROR' -Message ("Hata: {0}" -f $_.Exception.Message)
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
# Notepad++ Run komutu 260 karakterle sınırlı olduğundan çağrı ConfigPath vermeden yapılabilir.
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = Join-Path $scriptDirectory 'config.json'
}
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

# Her yol kendi istek dosyasına yazılır: dosya önce .tmp olarak yazılıp sonra taşınır, böylece
# toplayıcı yarı yazılmış bir istek okumaz.
$requestStamp = '{0:yyyyMMddHHmmssfffffff}-{1}' -f [DateTime]::UtcNow, [guid]::NewGuid().ToString('N')
$requestIndex = 0
foreach ($requestedPath in $requestedPaths) {
    $requestId = '{0}-{1:D4}' -f $requestStamp, $requestIndex
    $temporaryRequest = Join-Path $queueDirectory "$requestId.tmp"
    $requestPath = Join-Path $queueDirectory "$requestId.request"
    [System.IO.File]::WriteAllText($temporaryRequest, [string]$requestedPath, (New-Object System.Text.UTF8Encoding($false)))
    [System.IO.File]::Move($temporaryRequest, $requestPath)
    $requestIndex++
}

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
        # Aynı hedef için bir toplayıcı süreç çalışıyor; bu istek onun kuyruğuna eklendi ve burada bitiyor.
        Write-SamePathCopyLog -Component 'Kuyruk' -Message 'Toplayıcı başka bir süreçte çalışıyor; istek kuyruğa bırakıldı.'
        exit 0
    }

    # Toplama, yeni istek gelmeyi bırakana kadar sürer. Explorer 16-100 öğelik seçimde o kadar süreç
    # başlatıyor ve süreçlerin açılması saniyeler sürebiliyor: sabit 3 saniyelik sınır dolduğunda geri
    # kalanlar ikinci bir toplayıcı (ve ikinci bir kopyalama penceresi) açıyordu. Sessizlik penceresi
    # tek dosyada kısa kalır, çok seçimde uzar; üst sınır yalnızca takılmaya karşı duruyor.
    $hardDeadline = [DateTime]::UtcNow.AddSeconds(30)
    $stableSince = [DateTime]::UtcNow
    $lastSnapshot = ''
    $quietMilliseconds = 400
    do {
        Start-Sleep -Milliseconds 100
        $requestFiles = @(Get-ChildItem -LiteralPath $queueDirectory -Filter '*.request' -File | Sort-Object Name)
        $snapshot = @($requestFiles.Name) -join '|'
        if ($snapshot -ne $lastSnapshot) {
            $lastSnapshot = $snapshot
            $stableSince = [DateTime]::UtcNow
        }
        # Birden fazla istek görüldüyse çok seçim yapılıyor: geç açılan süreçler için daha uzun beklenir.
        if ($requestFiles.Count -gt 1) { $quietMilliseconds = 1200 }
    } while (($requestFiles.Count -eq 0 -or ([DateTime]::UtcNow - $stableSince).TotalMilliseconds -lt $quietMilliseconds) -and
        [DateTime]::UtcNow -lt $hardDeadline)

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

Write-SamePathCopyLog -Component 'Kuyruk' -Message ("Toplandı: {0} istek, {1} tekil kaynak" -f $requestFiles.Count, $paths.Count)

if ($paths.Count -gt 0) {
    if ($PlanOnly) {
        @(& $copyScript -SourcePath $paths -TargetId $TargetId -ConfigPath $resolvedConfigPath -PlanOnly) |
            ConvertTo-Json -Compress
    }
    else {
        & $copyScript -SourcePath $paths -TargetId $TargetId -ConfigPath $resolvedConfigPath
    }
}
