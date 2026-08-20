$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $projectDirectory 'SamePathCopy.Common.ps1')
. (Join-Path $projectDirectory 'SamePathCopy.Wizard.ps1')

$testDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('SamePathCopy-Wizard-' + [guid]::NewGuid().ToString('N'))

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) {
        throw "$Message Beklenen: $Expected; gerçek: $Actual"
    }
}

$previousStatePath = $env:SAMEPATHCOPY_WIZARD_STATE
try {
    [void](New-Item -ItemType Directory -Path $testDirectory)
    $env:SAMEPATHCOPY_WIZARD_STATE = Join-Path $testDirectory 'wizard-state.json'
    $configPath = Join-Path $testDirectory 'config.json'
    $targets = @(
        [pscustomobject]@{ id = 'IG1'; name = 'IG1' }
        [pscustomobject]@{ id = 'IG2'; name = 'IG2' }
    )

    # Durum dosyası yokken bütün hedefler seçili, parametreler kapalı gelmeli.
    $settings = Get-SamePathCopyWizardSettings -ConfigPath $configPath -Targets $targets
    Assert-Equal $true ([bool]$settings.Targets['IG1'].Selected) 'Yeni hedef varsayılan olarak seçili olmalı.'
    Assert-Equal $true ([bool]$settings.Targets['IG2'].Selected) 'Yeni hedef varsayılan olarak seçili olmalı.'
    Assert-Equal $false ([bool]$settings.Targets['IG1'].Backup) 'Yedek parametresi varsayılan olarak kapalı olmalı.'
    Assert-Equal $false ([bool]$settings.Global.DryRun) 'Deneme parametresi varsayılan olarak kapalı olmalı.'

    # Kaydedilen ayarlar bir sonraki açılışta aynen geri gelmeli.
    $settings.Targets['IG2'].Selected = $false
    $settings.Targets['IG1'].Backup = $true
    $settings.Targets['IG1'].Mirror = $true
    $settings.Global.FastCopy = $true
    Save-SamePathCopyWizardSettings -ConfigPath $configPath -Settings $settings

    $reloaded = Get-SamePathCopyWizardSettings -ConfigPath $configPath -Targets $targets
    Assert-Equal $false ([bool]$reloaded.Targets['IG2'].Selected) 'Seçim durumu saklanmadı.'
    Assert-Equal $true ([bool]$reloaded.Targets['IG1'].Backup) 'Yedek parametresi saklanmadı.'
    Assert-Equal $true ([bool]$reloaded.Targets['IG1'].Mirror) 'Ayna parametresi saklanmadı.'
    Assert-Equal $true ([bool]$reloaded.Global.FastCopy) 'Genel parametre saklanmadı.'

    # Yol büyük/küçük harf farkıyla verilse de aynı config'in ayarları bulunmalı.
    $reloadedUpper = Get-SamePathCopyWizardSettings -ConfigPath $configPath.ToUpperInvariant() -Targets $targets
    Assert-Equal $false ([bool]$reloadedUpper.Targets['IG2'].Selected) 'Config yolu büyük harfle verilince ayarlar bulunamadı.'

    # Farklı config aynı durum dosyasında ayrı tutulmalı.
    $otherConfigPath = Join-Path $testDirectory 'other-config.json'
    $otherSettings = Get-SamePathCopyWizardSettings -ConfigPath $otherConfigPath -Targets $targets
    Assert-Equal $true ([bool]$otherSettings.Targets['IG2'].Selected) 'Farklı config ayarları birbirine karıştı.'

    # config.json'a sonradan eklenen hedef seçili gelir, silinen hedef durumdan düşer.
    $extendedTargets = @($targets) + @([pscustomobject]@{ id = 'IG3'; name = 'IG3' })
    $extended = Get-SamePathCopyWizardSettings -ConfigPath $configPath -Targets $extendedTargets
    Assert-Equal $true ([bool]$extended.Targets['IG3'].Selected) 'Sonradan eklenen hedef seçili gelmeli.'
    $reduced = Get-SamePathCopyWizardSettings -ConfigPath $configPath -Targets @($targets[0])
    Assert-Equal 1 @($reduced.Targets.Keys).Count 'Silinen hedef ayarlardan düşmedi.'

    # Bozuk durum dosyası kopyalamayı engellemez, varsayılanlara dönülür.
    Set-Content -LiteralPath $env:SAMEPATHCOPY_WIZARD_STATE -Value '{bozuk' -Encoding UTF8
    $afterCorruption = Get-SamePathCopyWizardSettings -ConfigPath $configPath -Targets $targets
    Assert-Equal $true ([bool]$afterCorruption.Targets['IG2'].Selected) 'Bozuk durum dosyasında varsayılanlara dönülmedi.'

    # Robocopy argümanları: parametreler doğru anahtarlara çevrilmeli.
    $noOptions = Get-SamePathCopyRobocopyArguments -SourceDirectory 'C:\Kaynak' -DestinationDirectory '\\ip\pay' -IsDirectory $true -RetryCount 2 -WaitSeconds 1 -Options $null
    if (($noOptions -join ' ') -notlike '*/E*') { throw 'Klasör kopyalamada /E yok.' }
    if (($noOptions -join ' ') -notlike '*/Z*') { throw 'Varsayılan kopyalamada /Z yok.' }
    if (($noOptions -join ' ') -like '*/MIR*') { throw 'Parametre verilmeden /MIR eklendi.' }
    if (($noOptions -join ' ') -notlike "*/XD `"$(Get-SamePathCopyBackupFolderName)`"*") { throw 'Yedek klasörü kopyalama dışında bırakılmadı.' }

    $allOptions = [pscustomobject]@{ Backup = $true; OnlyNewer = $true; Mirror = $true; DryRun = $true; FastCopy = $true }
    $directoryArguments = (Get-SamePathCopyRobocopyArguments -SourceDirectory 'C:\Kaynak' -DestinationDirectory '\\ip\pay' -IsDirectory $true -RetryCount 2 -WaitSeconds 1 -Options $allOptions) -join ' '
    if ($directoryArguments -notlike '*/MIR*') { throw 'Ayna parametresi /MIR üretmedi.' }
    if ($directoryArguments -like '* /E *') { throw '/MIR ile birlikte gereksiz /E eklendi.' }
    if ($directoryArguments -notlike '*/XO*') { throw 'Yalnızca yeni parametresi /XO üretmedi.' }
    if ($directoryArguments -notlike '*/L*') { throw 'Deneme parametresi /L üretmedi.' }
    if ($directoryArguments -notlike '*/MT:8*') { throw 'Hızlı kopyalama /MT:8 üretmedi.' }
    if ($directoryArguments -like '*/Z*') { throw 'Hızlı kopyalamada /Z düşmedi.' }

    # Tek dosya kopyalamada /MIR kullanılmamalı: hedef klasördeki diğer dosyaları silerdi.
    $fileArguments = (Get-SamePathCopyRobocopyArguments -SourceDirectory 'C:\Kaynak' -DestinationDirectory '\\ip\pay' -FileFilter 'a.txt' -IsDirectory $false -RetryCount 2 -WaitSeconds 1 -Options $allOptions) -join ' '
    if ($fileArguments -like '*/MIR*') { throw 'Dosya kopyalamada /MIR eklendi.' }
    if ($fileArguments -notlike '*"a.txt"*') { throw 'Dosya süzgeci argümanlara eklenmedi.' }

    # Yedek yolu, hedefin göreli yolunu yedek klasörü altında korumalı.
    $backupPath = Get-SamePathCopyBackupPath -Destination '\\10.10.1.11\Sim\ActiveRelease\Data\x.entity' -Address '10.10.1.11' -NetworkRoot 'Sim\ActiveRelease' -Stamp '20260820-101500'
    Assert-Equal "\\10.10.1.11\Sim\ActiveRelease\$(Get-SamePathCopyBackupFolderName)\20260820-101500\Data\x.entity" $backupPath 'Yedek yolu yanlış üretildi.'
    $rootBackupPath = Get-SamePathCopyBackupPath -Destination '\\10.10.1.11\Sim\ActiveRelease' -Address '10.10.1.11' -NetworkRoot 'Sim\ActiveRelease' -Stamp '20260820-101500'
    Assert-Equal "\\10.10.1.11\Sim\ActiveRelease\$(Get-SamePathCopyBackupFolderName)\20260820-101500" $rootBackupPath 'Kök hedefi için yedek yolu yanlış.'

    # Arayüz gerçekten açılıp tek bir sonuç nesnesi döndürmeli: WinForms çağrılarının çıktı akışına
    # sızması (EndEdit gibi) sonucu diziye çevirip Copy-SamePath'i kırıyordu.
    $previousAutoClose = $env:SAMEPATHCOPY_WIZARD_AUTOCLOSE
    try {
        $env:SAMEPATHCOPY_WIZARD_AUTOCLOSE = '300'
        $uiConfiguration = [pscustomobject]@{ menuTitle = 'SamePathCopy'; allLabel = 'Tümü' }
        $uiTargets = @(
            [pscustomobject]@{ id = 'IG1'; name = 'IG1'; group = 'Unit1' }
            [pscustomobject]@{ id = 'IG2'; name = 'IG2' }
        )
        $uiSettings = Get-SamePathCopyWizardSettings -ConfigPath $configPath -Targets $uiTargets
        $uiSourceItems = @(Get-Item -LiteralPath (Join-Path $projectDirectory 'README.md'))
        $dialogResult = Show-SamePathCopyWizard -Configuration $uiConfiguration -Targets $uiTargets -SourceItems $uiSourceItems -Settings $uiSettings
        Assert-Equal 1 @($dialogResult).Count 'Sihirbaz tek bir sonuç nesnesi döndürmeli.'
        Assert-Equal $true ([bool]$dialogResult.Confirmed) 'Onaylanan diyalog Confirmed=true döndürmeli.'
        Assert-Equal 2 @($dialogResult.Settings.Targets.Keys).Count 'Sihirbaz sonucu bütün hedefleri taşımalı.'
        Assert-Equal $true ([bool]$dialogResult.Settings.Targets['IG1'].Selected) 'Hedefler varsayılan olarak seçili gelmeli.'
    }
    finally {
        $env:SAMEPATHCOPY_WIZARD_AUTOCLOSE = $previousAutoClose
    }

    Write-Host 'Sihirbaz testleri başarılı.'
}
finally {
    $env:SAMEPATHCOPY_WIZARD_STATE = $previousStatePath
    if (Test-Path -LiteralPath $testDirectory) {
        Remove-Item -LiteralPath $testDirectory -Recurse -Force
    }
}
