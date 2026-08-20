$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $projectDirectory 'SamePathCopy.Common.ps1')
. (Join-Path $projectDirectory 'SamePathCopy.Wizard.ps1')

# Kopyalama gerçekten çalıştırılır: hedefler yerel paylaşımlar (\\127.0.0.1\C$\...) olduğu için
# robocopy, paralel zamanlayıcı, yedekleme ve parametreler uçtan uca sınanır.
$testDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('SamePathCopy-Run-' + [guid]::NewGuid().ToString('N'))

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) {
        throw "$Message Beklenen: $Expected; gerçek: $Actual"
    }
}

function New-TestFile {
    param([Parameter(Mandatory = $true)][string]$Path, [string]$Content = 'veri')

    $directory = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        [void](New-Item -ItemType Directory -Path $directory -Force)
    }
    Set-Content -LiteralPath $Path -Value $Content -Encoding UTF8
}

function Invoke-TestCopy {
    param(
        [Parameter(Mandatory = $true)][string]$ConfigPath,
        [Parameter(Mandatory = $true)][string]$TargetId,
        [Parameter(Mandatory = $true)][string[]]$SourcePath,
        [int]$TimeoutSeconds = 180
    )

    # Kopyalama penceresi kendini kapatsın; süreç ayrı çalıştırılıp çıkış kodu ve hata akışı okunur.
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $quotedSources = (@($SourcePath) | ForEach-Object { '"{0}"' -f $_ }) -join ','
    $startInfo.Arguments = '-sta -NoProfile -ExecutionPolicy Bypass -File "{0}" -TargetId {1} -ConfigPath "{2}" -SourcePath {3}' -f `
        (Join-Path $projectDirectory 'Copy-SamePath.ps1'), $TargetId, $ConfigPath, $quotedSources
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.EnvironmentVariables['SAMEPATHCOPY_COPYWINDOW_AUTOCLOSE'] = '1'
    $startInfo.EnvironmentVariables['SAMEPATHCOPY_WIZARD_STATE'] = $env:SAMEPATHCOPY_WIZARD_STATE
    $startInfo.EnvironmentVariables['SAMEPATHCOPY_LOG'] = $env:SAMEPATHCOPY_LOG
    $startInfo.EnvironmentVariables['SAMEPATHCOPY_NODE_ID'] = 'Yerel'

    $process = [System.Diagnostics.Process]::Start($startInfo)
    $standardError = $process.StandardError.ReadToEnd()
    [void]$process.StandardOutput.ReadToEnd()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        try { $process.Kill() } catch { }
        throw "Kopyalama $TimeoutSeconds saniyede bitmedi (hedef: $TargetId)."
    }
    if (-not [string]::IsNullOrWhiteSpace($standardError)) {
        throw "Kopyalama hata akışına yazdı (hedef: $TargetId): $standardError"
    }
    return $process.ExitCode
}

$previousStatePath = $env:SAMEPATHCOPY_WIZARD_STATE
$previousLogPath = $env:SAMEPATHCOPY_LOG
try {
    [void](New-Item -ItemType Directory -Path $testDirectory)
    $env:SAMEPATHCOPY_WIZARD_STATE = Join-Path $testDirectory 'wizard-state.json'
    $env:SAMEPATHCOPY_LOG = Join-Path $testDirectory 'root.log'

    $sourceRoot = Join-Path $testDirectory 'kaynak'
    New-TestFile -Path (Join-Path $sourceRoot 'Data\bir.txt') -Content 'bir'
    New-TestFile -Path (Join-Path $sourceRoot 'Data\Alt\iki.txt') -Content 'iki'
    New-TestFile -Path (Join-Path $sourceRoot 'Data\atlanacak.tmp') -Content 'gecici'

    # Üç hedef: hepsi bu bilgisayarın yönetim paylaşımı altında ayrı klasörler.
    $shareBase = $testDirectory.Substring(3) -replace '\\$', ''
    $nodes = @(
        @{ id = 'Yerel'; name = 'Yerel'; address = '127.0.0.1'; localNames = @([System.Environment]::MachineName); localRoot = $sourceRoot; networkRoot = "C$\$shareBase\kaynak" }
    )
    foreach ($index in 1..3) {
        $nodes += @{ id = "Hedef$index"; name = "Hedef $index"; group = 'Hepsi'; address = '127.0.0.1'
            localRoot = (Join-Path $testDirectory "hedef$index"); networkRoot = "C$\$shareBase\hedef$index" }
    }
    $configPath = Join-Path $testDirectory 'config.json'
    (@{ version = '1.0.0'; menuTitle = 'SamePathCopy'; allLabel = 'Tümü'; nodes = $nodes; copy = @{ retryCount = 0; waitSeconds = 0; backupKeep = 2 } } |
        ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $configPath -Encoding UTF8

    # 1) Tümü: üç hedefe paralel kopyalama, göreli yol korunur.
    Assert-Equal 0 (Invoke-TestCopy -ConfigPath $configPath -TargetId 'all' -SourcePath @((Join-Path $sourceRoot 'Data'))) 'Tümü kopyalaması hatayla bitti.'
    foreach ($index in 1..3) {
        $copied = Join-Path $testDirectory "hedef$index\Data\bir.txt"
        if (-not (Test-Path -LiteralPath $copied -PathType Leaf)) { throw "Hedef $index için dosya kopyalanmadı: $copied" }
        Assert-Equal 'bir' ([string](Get-Content -LiteralPath $copied -Raw)).Trim() "Hedef $index içeriği yanlış."
        if (-not (Test-Path -LiteralPath (Join-Path $testDirectory "hedef$index\Data\Alt\iki.txt") -PathType Leaf)) {
            throw "Hedef $index için alt klasör kopyalanmadı."
        }
    }

    # 2) Grup hedefi yalnızca gruptaki makinelere gider (üçü de aynı grupta) ve günlük panel satırlarını taşır.
    $logText = [string](Get-Content -LiteralPath $env:SAMEPATHCOPY_LOG -Raw -Encoding UTF8)
    if ($logText -notlike '*[Panel]*Hedef 1*') { throw 'Panel satırları günlüğe yazılmadı.' }
    if ($logText -notlike '*eşzamanlı hedef sınırı*') { throw 'Eşzamanlı hedef sınırı günlüğe yazılmadı.' }

    # 3) Süzgeç ve yedek: profil üzerinden parametreler uygulanır.
    $targetsForSettings = @(Get-EnabledSamePathCopyNodes -Configuration (Get-SamePathCopyConfiguration -ConfigPath $configPath) -ExcludeId 'Yerel')
    $settings = Get-SamePathCopyWizardSettings -ConfigPath $configPath -Targets $targetsForSettings
    foreach ($id in @($settings.Targets.Keys)) { $settings.Targets[$id].Selected = ($id -eq 'Hedef1') }
    $settings.Targets['Hedef1'].Backup = $true
    $settings.Global.ExcludeFiles = '*.tmp'
    $settings.Global.ParallelTargets = 2
    [void](Save-SamePathCopyWizardProfile -ConfigPath $configPath -Name 'Sadece1' -Settings $settings)

    # İlk kopyalama süzgeçsiz çalıştığı için .tmp dosyası hedefte duruyor; süzgeci sınamak için silinir.
    Remove-Item -LiteralPath (Join-Path $testDirectory 'hedef1\Data\atlanacak.tmp') -Force -ErrorAction SilentlyContinue
    Assert-Equal 0 (Invoke-TestCopy -ConfigPath $configPath -TargetId 'profile:Sadece1' -SourcePath @((Join-Path $sourceRoot 'Data'))) 'Profil kopyalaması hatayla bitti.'
    if (Test-Path -LiteralPath (Join-Path $testDirectory 'hedef1\Data\atlanacak.tmp')) {
        throw 'Hariç tutulan dosya kopyalandı.'
    }
    # Süzgeç yalnızca hariç tutulanı atlamalı; diğer dosyalar kopyalanmaya devam eder.
    if (-not (Test-Path -LiteralPath (Join-Path $testDirectory 'hedef1\Data\bir.txt') -PathType Leaf)) {
        throw 'Süzgeçli kopyalama diğer dosyaları atladı.'
    }
    $backupRoot = Join-Path $testDirectory ("hedef1\" + (Get-SamePathCopyBackupFolderName))
    if (-not (Test-Path -LiteralPath $backupRoot -PathType Container)) { throw 'Yedek klasörü oluşmadı.' }
    $backupStamps = @(Get-ChildItem -LiteralPath $backupRoot -Directory)
    if ($backupStamps.Count -lt 1) { throw 'Yedek alınmadı.' }
    if (-not (Test-Path -LiteralPath (Join-Path $backupStamps[0].FullName 'Data\bir.txt') -PathType Leaf)) {
        throw 'Yedek içinde önceki dosya yok.'
    }

    # 4) Deneme çalıştırması hedefe yazmamalı.
    $settings.Targets['Hedef1'].Backup = $false
    foreach ($id in @($settings.Targets.Keys)) { $settings.Targets[$id].Selected = ($id -eq 'Hedef2') }
    $settings.Global.DryRun = $true
    $settings.Global.ExcludeFiles = ''
    [void](Save-SamePathCopyWizardProfile -ConfigPath $configPath -Name 'Deneme' -Settings $settings)
    New-TestFile -Path (Join-Path $sourceRoot 'Data\yeni.txt') -Content 'yeni'
    Assert-Equal 0 (Invoke-TestCopy -ConfigPath $configPath -TargetId 'profile:Deneme' -SourcePath @((Join-Path $sourceRoot 'Data'))) 'Deneme kopyalaması hatayla bitti.'
    if (Test-Path -LiteralPath (Join-Path $testDirectory 'hedef2\Data\yeni.txt')) {
        throw 'Deneme çalıştırması hedefe yazdı.'
    }

    # 5) Ayna: kaynakta olmayan dosya hedeften silinir.
    $extraFile = Join-Path $testDirectory 'hedef3\Data\fazla.txt'
    New-TestFile -Path $extraFile -Content 'fazla'
    foreach ($id in @($settings.Targets.Keys)) { $settings.Targets[$id].Selected = ($id -eq 'Hedef3') }
    $settings.Targets['Hedef3'].Mirror = $true
    $settings.Global.DryRun = $false
    [void](Save-SamePathCopyWizardProfile -ConfigPath $configPath -Name 'Ayna' -Settings $settings)
    Assert-Equal 0 (Invoke-TestCopy -ConfigPath $configPath -TargetId 'profile:Ayna' -SourcePath @((Join-Path $sourceRoot 'Data'))) 'Ayna kopyalaması hatayla bitti.'
    if (Test-Path -LiteralPath $extraFile) { throw 'Ayna kipinde fazla dosya silinmedi.' }
    if (-not (Test-Path -LiteralPath (Join-Path $testDirectory 'hedef3\Data\yeni.txt') -PathType Leaf)) {
        throw 'Ayna kipinde yeni dosya kopyalanmadı.'
    }

    Write-Host 'Kopyalama çalıştırma testleri başarılı.'
}
finally {
    $env:SAMEPATHCOPY_WIZARD_STATE = $previousStatePath
    $env:SAMEPATHCOPY_LOG = $previousLogPath
    if (Test-Path -LiteralPath $testDirectory) {
        Remove-Item -LiteralPath $testDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}
