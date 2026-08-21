[CmdletBinding()]
param(
    # Yalnızca verilen takımları koşturur: 'Diff', 'Test-Diff' ve 'Test-Diff.ps1' aynı şeyi seçer.
    [string[]]$Only,
    # Pencere açan takımları atlar (uzak oturum, yalnızca hızlı denetim istendiğinde).
    [switch]$SkipUi,
    # Takım başına üst sınır; aşan takım öldürülür ve "kaldı" sayılır.
    [int]$TimeoutSeconds = 900
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# Bütün test takımlarını tek komutla koşturur ve ÜÇ durum ayırır: geçti / kaldı / ortam nedeniyle
# atlandı. İkili bir sonuç yanlış olurdu: takımların bir kısmı yönetim paylaşımına yazıyor, bir kısmı
# gerçek WPF penceresi açıyor, bir kısmı deponun config.json'ında bu makinenin tanımlı olmasını
# gerektiriyor. Bunlar yoksa takım "kaldı" değil, koşulamadı demektir; koşucu bunu ayırmazsa
# yükseltilmemiş bir oturumda üç kırmızı verir ve kimse çıktısına güvenmez.
#
# Her takım AYRI süreçte koşar (tercih değil, zorunluluk): on dosyanın hepsi Assert-Equal'i kendi
# içinde yeniden tanımlıyor ve $script: değişkenleriyle ortam değişkenlerini paylaşıyor.
# Günlük ve sihirbaz durumu geçici bir klasöre yönlendirilir; yoksa takımlar deponun log\root.log
# dosyasını ve kullanıcının kayıtlı sihirbaz ayarını kirletiyor.

$testsDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDirectory = Split-Path -Parent $testsDirectory
$powershellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

# Ortam gereksinimleri takımların kodundan okunarak yazıldı. Burada olmayan (sonradan eklenen) bir
# takım gereksinimsiz sayılır ve koşulur: yeni testin sessizce atlanması, yanlış kırmızıdan kötüdür.
$suiteRequirements = @{
    'Test-CopyRun' = @('AdminShare')
    'Test-Destination' = @('AdminShare')
    'Test-Queue' = @('AdminShare')
    'Test-Diff' = @('AdminShare', 'Desktop')
    'Test-Wizard' = @('AdminShare', 'Desktop', 'LocalNode')
    'Test-NotepadPlusPlusIntegration' = @('LocalNode')
    'Test-ExplorerMenu' = @()
    'Test-LocalIdentity' = @()
    'Test-Log' = @()
    'Test-MenuEntries' = @()
}

function Test-AdminShareAccess {
    # Takımlar hedeflerini \\127.0.0.1\C$ üzerine kuruyor: yönetim paylaşımı yükseltilmemiş oturumda
    # kapalıdır. Yetkiyi dolaylı ölçmek (yönetici grubunda mıyım) yanıltıcı olur; erişim denenir.
    try {
        return [bool](Test-Path -LiteralPath '\\127.0.0.1\C$' -ErrorAction Stop)
    }
    catch {
        return $false
    }
}

function Test-DesktopSession {
    # WPF penceresi yalnızca etkileşimli bir masaüstü oturumunda açılabilir (servis/oturum 0 olmaz).
    return [bool][System.Environment]::UserInteractive
}

function Test-LocalNodeResolves {
    param([Parameter(Mandatory = $true)][string]$ProjectDirectory, [Parameter(Mandatory = $true)][string]$PowerShellExe)

    # Bazı takımlar deponun gerçek config.json'ını okuyup bu makinenin kimliğini çözüyor. Kimlik
    # çözülemezse takım ortam yüzünden koşamaz. Denetim ayrı süreçte yapılır: Common.ps1 dot-source
    # edildiğinde Set-StrictMode ve fonksiyonları koşucunun kapsamına sızıyor.
    $probe = @'
$ErrorActionPreference = 'Stop'
. '{0}\SamePathCopy.Common.ps1'
$configuration = Get-SamePathCopyConfiguration -ConfigPath '{0}\config.json'
$identity = Get-LocalSamePathCopyIdentity -Configuration $configuration
Write-Output ([string]$identity.Id)
'@ -f $ProjectDirectory

    $probePath = Join-Path ([System.IO.Path]::GetTempPath()) ('SamePathCopy-NodeProbe-{0}.ps1' -f [guid]::NewGuid().ToString('N'))
    try {
        Set-Content -LiteralPath $probePath -Value $probe -Encoding UTF8
        $output = & $PowerShellExe -NoProfile -ExecutionPolicy Bypass -File $probePath 2>$null
        $nodeId = @($output | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Last 1)
        if ($nodeId.Count -eq 0) { return [pscustomobject]@{ Ok = $false; Detail = '' } }
        return [pscustomobject]@{ Ok = $true; Detail = ([string]$nodeId[0]).Trim() }
    }
    catch {
        return [pscustomobject]@{ Ok = $false; Detail = '' }
    }
    finally {
        if (Test-Path -LiteralPath $probePath) { Remove-Item -LiteralPath $probePath -Force -ErrorAction SilentlyContinue }
    }
}

function Invoke-TestSuite {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$RunDirectory,
        [Parameter(Mandatory = $true)][string]$PowerShellExe,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds
    )

    # Süreç .NET üzerinden başlatılır: Start-Process -PassThru çıkış kodunu güvenilir vermiyor.
    # Çıktı akışları eşzamansız okunur; sırayla ReadToEnd çağırmak dolu bir tampon üzerinde kilitlenir.
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $PowerShellExe
    # Konsol kod sayfası (bu makinede 437) Türkçe karakterleri taşımıyor: çocuk süreç çıktıyı UTF-8
    # yazsın diye -File yerine -Command ile açılıp kodlaması ayarlanır, okuma tarafı da UTF-8 olur.
    # Yoksa kalan takımın hata iletisi "tak??m" gibi okunmaz hâlde geliyor.
    $startInfo.Arguments = '-NoProfile -ExecutionPolicy Bypass -STA -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; & ''{0}''"' -f $Path
    $startInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $startInfo.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.WorkingDirectory = (Split-Path -Parent $Path)
    $startInfo.EnvironmentVariables['SAMEPATHCOPY_LOG'] = Join-Path $RunDirectory 'root.log'
    $startInfo.EnvironmentVariables['SAMEPATHCOPY_WIZARD_STATE'] = Join-Path $RunDirectory 'wizard-state.json'

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $process = [System.Diagnostics.Process]::Start($startInfo)
    $outputTask = $process.StandardOutput.ReadToEndAsync()
    $errorTask = $process.StandardError.ReadToEndAsync()
    $timedOut = $false
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        $timedOut = $true
        try { $process.Kill() } catch { }
    }
    $process.WaitForExit()
    $stopwatch.Stop()

    $standardOutput = ''
    $standardError = ''
    try { $standardOutput = [string]$outputTask.Result } catch { }
    try { $standardError = [string]$errorTask.Result } catch { }

    return [pscustomobject]@{
        ExitCode = [int]$process.ExitCode
        TimedOut = $timedOut
        Seconds = $stopwatch.Elapsed.TotalSeconds
        Output = (@($standardOutput, $standardError) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join "`r`n"
    }
}

# --- takım listesi -------------------------------------------------------------------------------
$suitePaths = @(Get-ChildItem -LiteralPath $testsDirectory -Filter 'Test-*.ps1' -File | Sort-Object Name | ForEach-Object { $_.FullName })
if ($suitePaths.Count -eq 0) { throw "Test takımı bulunamadı: $testsDirectory" }

if ($null -ne $Only -and @($Only).Count -gt 0) {
    # powershell.exe -File kipinde "-Only a,b" tek dize olarak geliyor: virgül ve noktalı virgül elle ayrılır.
    $wanted = @(@($Only) | ForEach-Object { ([string]$_) -split '[,;]' } | ForEach-Object {
        ([string]$_).Trim() -replace '\.ps1$', '' -replace '^Test-', ''
    } | Where-Object { $_ })
    $suitePaths = @($suitePaths | Where-Object {
        $suiteName = [System.IO.Path]::GetFileNameWithoutExtension($_) -replace '^Test-', ''
        @($wanted | Where-Object { $suiteName -eq $_ }).Count -gt 0
    })
    if ($suitePaths.Count -eq 0) { throw ("Verilen adla takım bulunamadı: {0}" -f (@($Only) -join ', ')) }
}

# --- ortam yoklaması ------------------------------------------------------------------------------
$runDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('SamePathCopy-TestRun-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $runDirectory -Force)

$hasAdminShare = Test-AdminShareAccess
$hasDesktop = (Test-DesktopSession) -and (-not $SkipUi)
$localNode = Test-LocalNodeResolves -ProjectDirectory $projectDirectory -PowerShellExe $powershellExe

$environmentText = @(
    $(if ($hasAdminShare) { 'yönetim paylaşımı var' } else { 'yönetim paylaşımı YOK' })
    $(if ($SkipUi) { 'pencere testleri atlanıyor (-SkipUi)' } elseif ($hasDesktop) { 'masaüstü oturumu var' } else { 'masaüstü oturumu YOK' })
    $(if ($localNode.Ok) { "yerel node: {0}" -f $localNode.Detail } else { 'yerel node çözülemedi' })
) -join '  ·  '

Write-Host ''
Write-Host 'SamePathCopy test koşucusu' -ForegroundColor Cyan
Write-Host ("  Takım   : {0}" -f $suitePaths.Count)
Write-Host ("  Ortam   : {0}" -f $environmentText)
Write-Host ("  Çalışma : {0}" -f $runDirectory)
Write-Host ''

# --- koşu ----------------------------------------------------------------------------------------
$results = New-Object System.Collections.Generic.List[object]
foreach ($suitePath in $suitePaths) {
    $suiteName = [System.IO.Path]::GetFileNameWithoutExtension($suitePath)
    $requirements = @()
    if ($suiteRequirements.ContainsKey($suiteName)) { $requirements = @($suiteRequirements[$suiteName]) }

    # Tabloda olmayan takım gereksinimsiz koşar; ama bu satırda söylenir ki tablo sessizce sapmasın.
    $tableNote = $(if ($suiteRequirements.ContainsKey($suiteName)) { '' } else { '(gereksinim tanımlı değil)' })

    $skipReason = ''
    foreach ($requirement in $requirements) {
        if ($skipReason) { break }
        switch ($requirement) {
            'AdminShare' {
                if (-not $hasAdminShare) { $skipReason = 'yönetim paylaşımına erişilemiyor (\\127.0.0.1\C$); yükseltilmiş oturum gerekiyor' }
            }
            'Desktop' {
                if ($SkipUi) { $skipReason = '-SkipUi verildi; pencere açan takım' }
                elseif (-not $hasDesktop) { $skipReason = 'etkileşimli masaüstü oturumu yok; WPF penceresi açılamaz' }
            }
            'LocalNode' {
                if (-not $localNode.Ok) { $skipReason = 'bu makine config.json içindeki bir node ile eşleşmiyor' }
            }
        }
    }

    if ($skipReason) {
        Write-Host ("  {0,-36} {1,-9} {2,8}   {3}" -f $suiteName, 'atlandı', '—', $skipReason) -ForegroundColor DarkYellow
        $results.Add([pscustomobject]@{ Name = $suiteName; State = 'atlandı'; Seconds = 0.0; Note = $skipReason; Output = '' })
        continue
    }

    $run = Invoke-TestSuite -Path $suitePath -RunDirectory $runDirectory -PowerShellExe $powershellExe -TimeoutSeconds $TimeoutSeconds
    $passed = (-not $run.TimedOut) -and ([int]$run.ExitCode -eq 0)
    $note = ''
    if ($run.TimedOut) { $note = "{0} saniyede bitmedi, süreç öldürüldü" -f $TimeoutSeconds }
    elseif (-not $passed) { $note = "çıkış kodu {0}" -f $run.ExitCode }

    Write-Host ("  {0,-36} {1,-9} {2,7:N1}s   {3}" -f $suiteName, $(if ($passed) { 'geçti' } else { 'kaldı' }), $run.Seconds, (@($note, $tableNote) | Where-Object { $_ }) -join ' ') `
        -ForegroundColor $(if ($passed) { 'Green' } else { 'Red' })
    $results.Add([pscustomobject]@{
        Name = $suiteName
        State = $(if ($passed) { 'geçti' } else { 'kaldı' })
        Seconds = [double]$run.Seconds
        Note = $note
        Output = [string]$run.Output
    })
}

# --- kalanların çıktısı --------------------------------------------------------------------------
$failedResults = @($results.ToArray() | Where-Object { [string]$_.State -eq 'kaldı' })
foreach ($failed in $failedResults) {
    Write-Host ''
    Write-Host ("─── {0} çıktısı (son 20 satır) ───" -f $failed.Name) -ForegroundColor Red
    $tail = @(([string]$failed.Output) -split '\r?\n' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Last 20)
    foreach ($line in $tail) { Write-Host ("  {0}" -f $line.TrimEnd()) }
}

# --- özet ----------------------------------------------------------------------------------------
$resultArray = $results.ToArray()
$passedCount = @($resultArray | Where-Object { [string]$_.State -eq 'geçti' }).Count
$failedCount = @($resultArray | Where-Object { [string]$_.State -eq 'kaldı' }).Count
$skippedCount = @($resultArray | Where-Object { [string]$_.State -eq 'atlandı' }).Count
$totalSeconds = 0.0
foreach ($result in $resultArray) { $totalSeconds += [double]$result.Seconds }

Write-Host ''
Write-Host ("{0} geçti  ·  {1} kaldı  ·  {2} atlandı  ·  {3:N1}s" -f $passedCount, $failedCount, $skippedCount, $totalSeconds) `
    -ForegroundColor $(if ($failedCount -gt 0) { 'Red' } elseif ($skippedCount -gt 0) { 'DarkYellow' } else { 'Green' })

# Tabloda kalmış ama dosyası olmayan takım: gereksinim listesi eskimiş demektir.
$knownNames = @(Get-ChildItem -LiteralPath $testsDirectory -Filter 'Test-*.ps1' -File | ForEach-Object { [System.IO.Path]::GetFileNameWithoutExtension($_.Name) })
$staleNames = @(@($suiteRequirements.Keys) | Where-Object { $knownNames -notcontains $_ } | Sort-Object)
if ($staleNames.Count -gt 0) {
    Write-Host ("Gereksinim tablosunda dosyası olmayan takım var: {0}" -f ($staleNames -join ', ')) -ForegroundColor DarkYellow
}

if ($failedCount -eq 0) {
    # Tertemiz koşuda incelenecek bir şey yok; çalışma klasörü bırakılmaz.
    Remove-Item -LiteralPath $runDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
else {
    Write-Host ("Takımların günlüğü: {0}" -f (Join-Path $runDirectory 'root.log'))
}
Write-Host ''

# Çıkış kodu yalnızca GERÇEK başarısızlıkta 1: atlanan takım otomasyonu kırmızıya çevirmemeli.
exit $(if ($failedCount -gt 0) { 1 } else { 0 })
