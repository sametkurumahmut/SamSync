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

    # Kolon başlığındaki tek onay kutusu: üç durum (hepsi / hiçbiri / karışık) ve toplu uygulama.
    function New-FakeRow {
        param([string]$Id, [string]$Group, [bool]$Selected, [bool]$Backup, [bool]$Mirror, [bool]$Visible = $true)
        return [pscustomobject]@{
            Id = $Id
            Group = $Group
            Visible = $Visible
            Controls = @{
                Selected = [pscustomobject]@{ IsChecked = $Selected }
                Backup = [pscustomobject]@{ IsChecked = $Backup }
                Mirror = [pscustomobject]@{ IsChecked = $Mirror }
            }
        }
    }

    $fakeRows = @(
        New-FakeRow -Id 'IG1' -Group 'Unit1' -Selected $true -Backup $false -Mirror $false
        New-FakeRow -Id 'IG2' -Group 'Unit1' -Selected $true -Backup $false -Mirror $true
        New-FakeRow -Id 'IG3' -Group 'Unit2' -Selected $false -Backup $false -Mirror $false
    )

    Assert-Equal $null (Get-SamePathCopyWizardToggleState -Rows $fakeRows -Key 'Selected') 'Karışık durumda toggle belirsiz olmalı.'
    Assert-Equal $false (Get-SamePathCopyWizardToggleState -Rows $fakeRows -Key 'Backup') 'Hiçbiri işaretli değilken toggle boş olmalı.'
    Assert-Equal $true (Get-SamePathCopyWizardToggleState -Rows $fakeRows -Key 'Selected' -Group 'Unit1') 'Grubun tamamı işaretliyken toggle işaretli olmalı.'
    Assert-Equal $false (Get-SamePathCopyWizardToggleState -Rows $fakeRows -Key 'Selected' -Group 'Unit2') 'Grup seçili değilken toggle boş olmalı.'
    Assert-Equal $false (Get-SamePathCopyWizardToggleState -Rows $fakeRows -Key 'Selected' -Group 'YokGrup') 'Satırı olmayan grup için toggle boş olmalı.'

    # Toplu uygulama yalnızca kendi kolonunu ve verilen grubu değiştirir.
    Set-SamePathCopyWizardRowsState -Rows $fakeRows -Key 'Backup' -Value $true
    Assert-Equal $true (Get-SamePathCopyWizardToggleState -Rows $fakeRows -Key 'Backup') 'Toplu uygulama kolonu işaretlemedi.'
    Assert-Equal $true ([bool]$fakeRows[1].Controls['Mirror'].IsChecked) 'Toplu uygulama başka kolonu değiştirdi.'
    Set-SamePathCopyWizardRowsState -Rows $fakeRows -Key 'Selected' -Value $true -Group 'Unit2'
    Assert-Equal $true (Get-SamePathCopyWizardToggleState -Rows $fakeRows -Key 'Selected') 'Grup uygulaması sonrası hepsi işaretli olmalı.'

    # Filtre dışındaki (gizli) satırlar ne sayıma ne de toplu uygulamaya girer.
    $fakeRows[0].Visible = $false
    $fakeRows[0].Controls['Backup'].IsChecked = $true
    Set-SamePathCopyWizardRowsState -Rows $fakeRows -Key 'Backup' -Value $false
    Assert-Equal $true ([bool]$fakeRows[0].Controls['Backup'].IsChecked) 'Gizli satır toplu uygulamadan etkilenmemeliydi.'
    Assert-Equal $false (Get-SamePathCopyWizardToggleState -Rows $fakeRows -Key 'Backup') 'Gizli satır toggle durumuna karışmamalı.'
    Set-SamePathCopyWizardColumnState -Rows $fakeRows -Key 'Mirror' -Value $false
    Assert-Equal $false ([bool]$fakeRows[1].Controls['Mirror'].IsChecked) 'Toplu temizleme kolonu boşaltmadı.'
    Assert-Equal $true ([bool]$fakeRows[0].Controls['Backup'].IsChecked) 'Toplu temizleme başka kolonu etkiledi.'

    # Arayüz gerçekten açılıp tek bir sonuç nesnesi döndürmeli. Bu, olay işleyicilerinin betik kapsamını
    # görmesini ve WPF çağrılarının çıktı akışına sızmamasını (sonucu diziye çevirmemesini) doğrular.
    # WPF STA kipi gerektirdiği için ayrı bir powershell -sta süreci kullanılır.
    $uiScriptPath = Join-Path $testDirectory 'ui-smoke.ps1'
    $uiOutputPath = Join-Path $testDirectory 'ui-smoke-output.txt'
    $uiScript = @"
`$ErrorActionPreference = 'Stop'
. '$projectDirectory\SamePathCopy.Common.ps1'
. '$projectDirectory\SamePathCopy.Ui.ps1'
. '$projectDirectory\SamePathCopy.Wizard.ps1'
`$env:SAMEPATHCOPY_WIZARD_STATE = '$($env:SAMEPATHCOPY_WIZARD_STATE)'
`$env:SAMEPATHCOPY_WIZARD_AUTOCLOSE = '400'
`$configuration = [pscustomobject]@{ menuTitle = 'SamePathCopy'; allLabel = 'Tumu' }
`$targets = @(
    [pscustomobject]@{ id = 'IG1'; name = 'IG1'; group = 'Unit1'; address = '127.0.0.1' }
    [pscustomobject]@{ id = 'IG2'; name = 'IG2'; address = '10.255.255.1' }
)
`$settings = Get-SamePathCopyWizardSettings -ConfigPath '$configPath' -Targets `$targets
`$sourceItems = @(Get-Item -LiteralPath '$projectDirectory\README.md')
`$result = Show-SamePathCopyWizard -Configuration `$configuration -Targets `$targets -SourceItems `$sourceItems -Settings `$settings -ConfigPath '$configPath' -LocalRoots @('C:\Kok')
"sonuc sayisi=`$(@(`$result).Count)" | Out-File -LiteralPath '$uiOutputPath' -Encoding UTF8
"confirmed=`$(`$result.Confirmed)" | Out-File -LiteralPath '$uiOutputPath' -Encoding UTF8 -Append
"hedef sayisi=`$(@(`$result.Settings.Targets.Keys).Count)" | Out-File -LiteralPath '$uiOutputPath' -Encoding UTF8 -Append
"ig1 secili=`$(`$result.Settings.Targets['IG1'].Selected)" | Out-File -LiteralPath '$uiOutputPath' -Encoding UTF8 -Append
"kaynak yolu=`$(@(`$result.SourcePaths) -join ';')" | Out-File -LiteralPath '$uiOutputPath' -Encoding UTF8 -Append
"@
    Set-Content -LiteralPath $uiScriptPath -Value $uiScript -Encoding UTF8

    $uiErrorPath = Join-Path $testDirectory 'ui-smoke-error.txt'
    $uiProcess = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') `
        -ArgumentList @('-sta', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $uiScriptPath) `
        -PassThru -WindowStyle Hidden -RedirectStandardError $uiErrorPath
    if (-not $uiProcess.WaitForExit(60000)) {
        try { $uiProcess.Kill() } catch { }
        throw 'Sihirbaz penceresi kendi kendine kapanmadı.'
    }
    $uiProcess.WaitForExit()
    $uiErrorText = if (Test-Path -LiteralPath $uiErrorPath) { [string](Get-Content -LiteralPath $uiErrorPath -Raw) } else { '' }
    if (-not [string]::IsNullOrWhiteSpace($uiErrorText)) {
        throw "Sihirbaz arayüzü hata verdi: $uiErrorText"
    }
    if (-not (Test-Path -LiteralPath $uiOutputPath -PathType Leaf)) {
        throw 'Sihirbaz arayüzü sonuç üretmeden kapandı.'
    }
    $uiOutput = @(Get-Content -LiteralPath $uiOutputPath -Encoding UTF8)
    Assert-Equal 'sonuc sayisi=1' $uiOutput[0] 'Sihirbaz tek bir sonuç nesnesi döndürmeli.'
    Assert-Equal 'confirmed=True' $uiOutput[1] 'Onaylanan pencere Confirmed=true döndürmeli.'
    Assert-Equal 'hedef sayisi=2' $uiOutput[2] 'Sihirbaz sonucu bütün hedefleri taşımalı.'
    Assert-Equal 'ig1 secili=True' $uiOutput[3] 'Hedefler varsayılan olarak seçili gelmeli.'
    if ($uiOutput[4] -notlike '*README.md') { throw "Sihirbaz sonucu kaynak listesini taşımalı: $($uiOutput[4])" }

    # Kimliğe göre seçim: küme tam uygulanır (filtreden bağımsız), eşleşen satır sayısı döner.
    $selectionRows = @(
        New-FakeRow -Id 'IG1' -Group 'Unit1' -Selected $false -Backup $false -Mirror $false
        New-FakeRow -Id 'IG2' -Group 'Unit1' -Selected $true -Backup $false -Mirror $false -Visible $false
        New-FakeRow -Id 'IG3' -Group 'Unit2' -Selected $true -Backup $false -Mirror $false
    )
    Assert-Equal 2 (Set-SamePathCopyWizardSelectionById -Rows $selectionRows -Ids @('IG1', 'IG2', 'YokHedef')) 'Eşleşen satır sayısı yanlış.'
    Assert-Equal $true ([bool]$selectionRows[0].Controls['Selected'].IsChecked) 'Kümedeki hedef seçilmedi.'
    Assert-Equal $true ([bool]$selectionRows[1].Controls['Selected'].IsChecked) 'Gizli satır da kümeye göre seçilmeli (profil gibi).'
    Assert-Equal $false ([bool]$selectionRows[2].Controls['Selected'].IsChecked) 'Kümede olmayan hedef bırakılmalı.'

    # Ters çevirme yalnızca görünen satırlara dokunur.
    Invoke-SamePathCopyWizardSelectionInvert -Rows $selectionRows
    Assert-Equal $false ([bool]$selectionRows[0].Controls['Selected'].IsChecked) 'Görünen satır ters çevrilmedi.'
    Assert-Equal $true ([bool]$selectionRows[1].Controls['Selected'].IsChecked) 'Gizli satır ters çevirmeden etkilenmemeli.'
    Assert-Equal $true ([bool]$selectionRows[2].Controls['Selected'].IsChecked) 'Görünen satır ters çevrilmedi.'

    # Geçmiş listesi satır metni: sıfır olan sayılar yazılmaz.
    function New-FakeRunSummary {
        param([int]$Success = 0, [int]$Failed = 0, [int]$Cancelled = 0, [int]$Targets = 3, [int]$Sources = 1)
        return [pscustomobject]@{
            Path = 'C:\raporlar\rapor-20260821-100000.csv'; Stamp = Get-Date; StampText = '21.08.2026 10:00'
            RowCount = $Success + $Failed + $Cancelled; SuccessCount = $Success; FailedCount = $Failed
            CancelledCount = $Cancelled; TargetIds = @(1..$Targets | ForEach-Object { "IG$_" })
            FailedTargetIds = @(); SourceCount = $Sources; FirstSource = 'C:\Kaynak\Data'
        }
    }
    Assert-Equal '21.08.2026 10:00  •  3 hedef  •  3 başarılı' (Get-SamePathCopyWizardHistoryLineText -Summary (New-FakeRunSummary -Success 3)) 'Temiz çalıştırma satırı yanlış.'
    Assert-Equal '21.08.2026 10:00  •  3 hedef  •  1 başarılı, 2 hatalı' (Get-SamePathCopyWizardHistoryLineText -Summary (New-FakeRunSummary -Success 1 -Failed 2)) 'Hatalı çalıştırma satırı yanlış.'
    Assert-Equal '21.08.2026 10:00  •  3 hedef  •  1 başarılı, 1 hatalı, 1 iptal' (Get-SamePathCopyWizardHistoryLineText -Summary (New-FakeRunSummary -Success 1 -Failed 1 -Cancelled 1)) 'İptalli çalıştırma satırı yanlış.'

    # Kaynak listesi düzenleme yardımcıları: dışlama süzer, bırakılan yol eklenir/yinelenmez/geri işaretlenir.
    $editSourceDir = Join-Path $testDirectory 'kaynak-duzenleme'
    [void](New-Item -ItemType Directory -Path $editSourceDir)
    Set-Content -LiteralPath (Join-Path $editSourceDir 'a.txt') -Value 'a' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $editSourceDir 'b.txt') -Value 'b' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $editSourceDir 'c.txt') -Value 'c' -Encoding UTF8

    $editList = New-Object System.Collections.Generic.List[object]
    $editList.Add((Get-Item -LiteralPath (Join-Path $editSourceDir 'a.txt')))
    $editList.Add((Get-Item -LiteralPath (Join-Path $editSourceDir 'b.txt')))
    $editExcluded = @{}
    Assert-Equal 2 @(Get-SamePathCopyWizardEffectiveSourceItems -SourceItems $editList -ExcludedPaths $editExcluded).Count 'Dışlama yokken bütün öğeler etkin olmalı.'
    $editExcluded[(Join-Path $editSourceDir 'b.txt').ToLowerInvariant()] = $true
    $effectiveAfterExclude = @(Get-SamePathCopyWizardEffectiveSourceItems -SourceItems $editList -ExcludedPaths $editExcluded)
    Assert-Equal 1 $effectiveAfterExclude.Count 'Dışlanan öğe etkin listeden düşmedi.'
    Assert-Equal 'a.txt' ([string]$effectiveAfterExclude[0].Name) 'Yanlış öğe dışlandı.'

    # Bırakma: yeni yol eklenir, var olan yinelenmez, dışlanmış yol bırakılırsa işareti geri gelir, olmayan yol atlanır.
    $addedCount = Add-SamePathCopyWizardSourcePaths -SourceItems $editList -ExcludedPaths $editExcluded -Paths @(
        (Join-Path $editSourceDir 'c.txt'),
        (Join-Path $editSourceDir 'a.txt'),
        (Join-Path $editSourceDir 'b.txt'),
        (Join-Path $editSourceDir 'olmayan.txt')
    )
    Assert-Equal 2 $addedCount 'Eklenen sayısı yanlış: c.txt yeni, b.txt geri işaretlenen.'
    Assert-Equal 3 $editList.Count 'Liste c.txt ile üçe çıkmalı; a.txt yinelenmemeli.'
    Assert-Equal 0 $editExcluded.Count 'Bırakılan b.txt yeniden işaretlenmeliydi.'

    # Başlıktaki kaynak ve yerel kök çipleri: tıklanınca açılan listede öğelerin göreli yolları ve
    # köklerin tamamı görünmeli. Popup gerçekten açılabilmeli; bu yüzden pencere STA sürecinde gösterilir.
    $chipScriptPath = Join-Path $testDirectory 'chip-smoke.ps1'
    $chipOutputPath = Join-Path $testDirectory 'chip-smoke-output.txt'
    $chipScript = @"
`$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework
. '$projectDirectory\SamePathCopy.Common.ps1'
. '$projectDirectory\SamePathCopy.Ui.ps1'
. '$projectDirectory\SamePathCopy.Wizard.ps1'
`$window = New-SamePathCopyWindow -Title 'Cip' -BodyXaml '<StackPanel x:Name="ChipPanel" Orientation="Horizontal" />' -Width 500 -Height 220
`$items = @(
    [pscustomobject]@{ FullName = 'C:\Kok\Data\x.entity'; PSIsContainer = `$false }
    [pscustomobject]@{ FullName = 'C:\Kok\Data\Sahneler'; PSIsContainer = `$true }
    [pscustomobject]@{ FullName = 'C:\Gecici\z.txt'; PSIsContainer = `$false }
)
`$summary = Get-SamePathCopySourceSummary -SourceItems `$items -LocalRoots @('C:\Kok', 'D:\Baska')
`$panel = `$window.FindName('ChipPanel')
`$script:chipToggled = @()
`$toggleHandler = { param(`$sender, `$eventArgs) `$script:chipToggled += [string]`$sender.Tag }
`$selectableChip = New-SamePathCopySourceChip -Window `$window -Summary `$summary -Selectable -ToggleHandler `$toggleHandler -ExcludedPaths @{}
`$sourceChip = New-SamePathCopySourceChip -Window `$window -Summary `$summary
`$rootChip = New-SamePathCopyLocalRootChip -Window `$window -Summary `$summary
[void]`$panel.Children.Add(`$sourceChip)
[void]`$panel.Children.Add(`$rootChip)
function Get-ChipListPanel {
    param(`$Chip)
    `$layout = `$Chip.Tag.Child.Child
    foreach (`$child in `$layout.Children) {
        if (`$child -is [System.Windows.Controls.ScrollViewer]) { return `$child.Content }
    }
    return `$null
}
`$sourceList = Get-ChipListPanel -Chip `$sourceChip
`$rootList = Get-ChipListPanel -Chip `$rootChip
`$sourceTexts = @(foreach (`$row in `$sourceList.Children) { [string]`$row.Children[0].Text })
`$rootTexts = @(foreach (`$row in `$rootList.Children) { [string]`$row.Children[0].Text })
`$window.Show()
Invoke-SamePathCopyUiPump
`$sourceChip.Tag.IsOpen = `$true
Invoke-SamePathCopyUiPump
"popup acik=`$(`$sourceChip.Tag.IsOpen)" | Out-File -LiteralPath '$chipOutputPath' -Encoding UTF8
"kaynak satir=`$(`$sourceTexts -join '|')" | Out-File -LiteralPath '$chipOutputPath' -Encoding UTF8 -Append
"kok satir=`$(`$rootTexts -join '|')" | Out-File -LiteralPath '$chipOutputPath' -Encoding UTF8 -Append
`$script:historySelected = @()
`$historySummaries = @(
    [pscustomobject]@{ Path = 'C:\rapor1.csv'; StampText = '21.08.2026 10:00'; SuccessCount = 2; FailedCount = 1; CancelledCount = 0; TargetIds = @('IG1', 'IG2', 'IG3'); FailedTargetIds = @('IG3'); SourceCount = 2; FirstSource = 'C:\Kaynak\Data' }
    [pscustomobject]@{ Path = 'C:\rapor2.csv'; StampText = '20.08.2026 09:00'; SuccessCount = 3; FailedCount = 0; CancelledCount = 0; TargetIds = @('IG1'); FailedTargetIds = @(); SourceCount = 1; FirstSource = 'C:\Kaynak\Diger' }
)
`$historyPopup = New-SamePathCopyWizardHistoryPopup -Window `$window -PlacementTarget `$panel -Summaries `$historySummaries -SelectHandler { param(`$sender, `$eventArgs) `$script:historySelected += (@(`$sender.Tag.TargetIds) -join ',') } -OpenHandler { }
`$historyList = `$historyPopup.Child.Child.Children | Where-Object { `$_ -is [System.Windows.Controls.ScrollViewer] } | ForEach-Object { `$_.Content }
`$historyRows = @(`$historyList.Children)
`$historyButton = `$historyRows[0].Children[0].Children[0]
`$historyButton.RaiseEvent((New-Object System.Windows.RoutedEventArgs([System.Windows.Controls.Primitives.ButtonBase]::ClickEvent)))
"gecmis satir=`$(`$historyRows.Count)" | Out-File -LiteralPath '$chipOutputPath' -Encoding UTF8 -Append
"gecmis secim=`$(`$script:historySelected -join '|')" | Out-File -LiteralPath '$chipOutputPath' -Encoding UTF8 -Append
`$selectableList = Get-ChipListPanel -Chip `$selectableChip
`$firstRow = @(`$selectableList.Children | Where-Object { `$_.Children.Count -gt 0 -and `$_.Children[0] -is [System.Windows.Controls.CheckBox] })[0]
`$firstCheck = `$firstRow.Children[0]
"kutu tipi=`$(`$firstCheck.GetType().Name)" | Out-File -LiteralPath '$chipOutputPath' -Encoding UTF8 -Append
`$firstCheck.IsChecked = `$false
`$firstCheck.RaiseEvent((New-Object System.Windows.RoutedEventArgs([System.Windows.Controls.Primitives.ButtonBase]::ClickEvent)))
"kutu tag=`$(`$script:chipToggled -join '|')" | Out-File -LiteralPath '$chipOutputPath' -Encoding UTF8 -Append
`$sourceChip.Tag.IsOpen = `$false
Invoke-SamePathCopyUiPump
`$window.Close()
"@
    Set-Content -LiteralPath $chipScriptPath -Value $chipScript -Encoding UTF8

    $chipErrorPath = Join-Path $testDirectory 'chip-smoke-error.txt'
    $chipProcess = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') `
        -ArgumentList @('-sta', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $chipScriptPath) `
        -PassThru -WindowStyle Hidden -RedirectStandardError $chipErrorPath
    if (-not $chipProcess.WaitForExit(60000)) {
        try { $chipProcess.Kill() } catch { }
        throw 'Çip penceresi kapanmadı.'
    }
    $chipProcess.WaitForExit()
    $chipErrorText = if (Test-Path -LiteralPath $chipErrorPath) { [string](Get-Content -LiteralPath $chipErrorPath -Raw) } else { '' }
    if (-not [string]::IsNullOrWhiteSpace($chipErrorText)) {
        throw "Başlık çipleri hata verdi: $chipErrorText"
    }
    $chipOutput = @(Get-Content -LiteralPath $chipOutputPath -Encoding UTF8)
    Assert-Equal 'popup acik=True' $chipOutput[0] 'Çipe tıklanınca açılan liste açılamadı.'
    # Kaynak listesi: kök başlığı + iki öğe, kök dışı başlığı + bir öğe (başlık satırları da aynı panelde durur).
    if ($chipOutput[1] -notlike '*Data\x.entity*') { throw "Kaynak listesinde göreli yol yok: $($chipOutput[1])" }
    if ($chipOutput[1] -notlike '*Data\Sahneler\*') { throw "Klasör satırı ters bölü ile bitmiyor: $($chipOutput[1])" }
    if ($chipOutput[1] -notlike '*C\Gecici\z.txt*') { throw "Kök dışı öğe listede yok: $($chipOutput[1])" }
    if ($chipOutput[2] -notlike '*C:\Kok*' -or $chipOutput[2] -notlike '*D:\Baska*') { throw "Kök listesi eksik: $($chipOutput[2])" }
    Assert-Equal 'gecmis satir=2' $chipOutput[3] 'Geçmiş listesi iki çalıştırmayı da göstermeli.'
    Assert-Equal 'gecmis secim=IG1,IG2,IG3' $chipOutput[4] '"Hedefleri seç" düğmesi çalıştırmanın hedef kümesini taşımalı.'
    Assert-Equal 'kutu tipi=CheckBox' $chipOutput[5] 'Seçilebilir çipte satır başında onay kutusu olmalı.'
    if ($chipOutput[6] -notlike '*C:\Kok\Data\*') { throw "Onay kutusu işleyicisi öğe yolunu taşımalı: $($chipOutput[6])" }

    # Filtre: ada, gruba ve kimliğe göre süzer; boş filtre bütün satırları gösterir.
    $filterRows = @(
        [pscustomobject]@{ Id = 'U1IG1'; Name = 'IG1 - 10.10.1.11'; Group = 'Unit1'; Visible = $true; Elements = @(); RowDefinition = $null; Controls = @{ Selected = [pscustomobject]@{ IsChecked = $false } } }
        [pscustomobject]@{ Id = 'U2IG1'; Name = 'IG1 - 10.10.1.31'; Group = 'Unit2'; Visible = $true; Elements = @(); RowDefinition = $null; Controls = @{ Selected = [pscustomobject]@{ IsChecked = $false } } }
        [pscustomobject]@{ Id = 'Yedek'; Name = 'Yedek sunucu'; Group = ''; Visible = $true; Elements = @(); RowDefinition = $null; Controls = @{ Selected = [pscustomobject]@{ IsChecked = $false } } }
    )
    Assert-Equal 3 (Set-SamePathCopyWizardRowFilter -Rows $filterRows -Filter '') 'Boş filtre bütün satırları göstermeli.'
    Assert-Equal 1 (Set-SamePathCopyWizardRowFilter -Rows $filterRows -Filter 'unit2') 'Grup adına göre süzme çalışmadı.'
    Assert-Equal 1 (Set-SamePathCopyWizardRowFilter -Rows $filterRows -Filter '46.31') 'Bilgisayar adına göre süzme çalışmadı.'
    Assert-Equal 1 (Set-SamePathCopyWizardRowFilter -Rows $filterRows -Filter 'yedek') 'Node kimliğine göre süzme çalışmadı.'
    Assert-Equal 0 (Set-SamePathCopyWizardRowFilter -Rows $filterRows -Filter 'yokböylebir') 'Eşleşmeyen filtre satır bırakmamalı.'

    # Toplu seçim yalnızca görünen satırlara uygulanır: filtre varken tümünü seç gizli satırlara dokunmaz.
    [void](Set-SamePathCopyWizardRowFilter -Rows $filterRows -Filter 'unit2')
    Set-SamePathCopyWizardColumnState -Rows $filterRows -Key 'Selected' -Value $true
    Assert-Equal $true ([bool]$filterRows[1].Controls['Selected'].IsChecked) 'Görünen satır işaretlenmeliydi.'
    Assert-Equal $false ([bool]$filterRows[0].Controls['Selected'].IsChecked) 'Filtre dışındaki satır işaretlenmemeliydi.'

    # Erişilebilirlik yoklaması: açık bir port erişilebilir, kapalı port erişilemez sayılmalı.
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try {
        $openPort = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
        $probeTargets = @([pscustomobject]@{ id = 'Acik'; address = '127.0.0.1' })
        $status = Test-SamePathCopyTargetReachability -Targets $probeTargets -Port $openPort -TimeoutMilliseconds 1500
        Assert-Equal $true ([bool]$status['Acik'].Reachable) 'Açık port erişilebilir sayılmalı.'
    }
    finally {
        $listener.Stop()
    }
    $closedStatus = Test-SamePathCopyTargetReachability -Targets @([pscustomobject]@{ id = 'Kapali'; address = '127.0.0.1' }) -Port 1 -TimeoutMilliseconds 800
    Assert-Equal $false ([bool]$closedStatus['Kapali'].Reachable) 'Kapalı port erişilemez sayılmalı.'
    $unroutableStatus = Test-SamePathCopyTargetReachability -Targets @([pscustomobject]@{ id = 'Yok'; address = '10.255.255.1' }) -TimeoutMilliseconds 600
    Assert-Equal $false ([bool]$unroutableStatus['Yok'].Reachable) 'Erişilemeyen adres zaman aşımıyla erişilemez sayılmalı.'

    # Yoklama sonucu satırlara işlenir.
    $reachRows = @(
        [pscustomobject]@{ Id = 'Acik'; Reachable = $null; ReachabilityDot = $null }
        [pscustomobject]@{ Id = 'Yok'; Reachable = $null; ReachabilityDot = $null }
    )
    Set-SamePathCopyWizardReachabilityState -Rows $reachRows -Status @{
        'Acik' = [pscustomobject]@{ Reachable = $true; Address = '127.0.0.1'; Port = 445 }
        'Yok' = [pscustomobject]@{ Reachable = $false; Address = '10.255.255.1'; Port = 445 }
    } -Window $null
    Assert-Equal $true ([bool]$reachRows[0].Reachable) 'Erişilebilir satır işaretlenmedi.'
    Assert-Equal $false ([bool]$reachRows[1].Reachable) 'Erişilemez satır işaretlenmedi.'

    # Uçtan uca profil sınaması gerçek config.json ile yapılır: hedefler oradan gelir.
    . (Join-Path $projectDirectory 'SamePathCopy.Common.ps1')
    $projectConfigPath = (Resolve-Path -LiteralPath (Join-Path $projectDirectory 'config.json')).Path
    $projectConfiguration = Get-SamePathCopyConfiguration -ConfigPath $projectConfigPath
    $projectIdentity = Get-LocalSamePathCopyIdentity -Configuration $projectConfiguration
    $projectTargets = @(Get-EnabledSamePathCopyNodes -Configuration $projectConfiguration -ExcludeId $projectIdentity.Id)

    # Profiller: adlandırılmış seçim kümeleri saklanır, son kullanılan ayardan bağımsız durur.
    Assert-Equal 0 @(Get-SamePathCopyWizardProfileNames -ConfigPath $configPath).Count 'Başlangıçta profil olmamalı.'

    $profileSettings = Get-SamePathCopyWizardSettings -ConfigPath $configPath -Targets $targets
    $profileSettings.Targets['IG1'].Selected = $true
    $profileSettings.Targets['IG2'].Selected = $false
    $profileSettings.Targets['IG1'].Backup = $true
    $profileSettings.Global.DryRun = $true
    Assert-Equal 'Unit1IG' (Save-SamePathCopyWizardProfile -ConfigPath $configPath -Name 'Unit1IG' -Settings $profileSettings) 'Profil adı geri dönmedi.'
    Assert-Equal 'Unit1IG' ((Get-SamePathCopyWizardProfileNames -ConfigPath $configPath) -join ',') 'Profil listesi beklenenden farklı.'

    $loadedProfile = Get-SamePathCopyWizardProfile -ConfigPath $configPath -Name 'unit1ig' -Targets $targets
    Assert-Equal $true ([bool]$loadedProfile.Targets['IG1'].Selected) 'Profil seçimi yüklenmedi.'
    Assert-Equal $false ([bool]$loadedProfile.Targets['IG2'].Selected) 'Profil seçimi yüklenmedi.'
    Assert-Equal $true ([bool]$loadedProfile.Targets['IG1'].Backup) 'Profil parametresi yüklenmedi.'
    Assert-Equal $true ([bool]$loadedProfile.Global.DryRun) 'Profil genel parametresi yüklenmedi.'

    # Son kullanılan ayarı kaydetmek profilleri silmemeli.
    $lastUsed = Get-SamePathCopyWizardSettings -ConfigPath $configPath -Targets $targets
    $lastUsed.Targets['IG2'].Selected = $true
    Save-SamePathCopyWizardSettings -ConfigPath $configPath -Settings $lastUsed
    Assert-Equal 'Unit1IG' ((Get-SamePathCopyWizardProfileNames -ConfigPath $configPath) -join ',') 'Ayar kaydetmek profili sildi.'

    # Aynı ad büyük/küçük harf farkıyla verilirse ikinci profil oluşmaz, mevcut olan güncellenir.
    $profileSettings.Targets['IG2'].Selected = $true
    [void](Save-SamePathCopyWizardProfile -ConfigPath $configPath -Name 'UNIT1IG' -Settings $profileSettings)
    Assert-Equal 1 @(Get-SamePathCopyWizardProfileNames -ConfigPath $configPath).Count 'Büyük/küçük harf farkı ikinci profil oluşturdu.'
    Assert-Equal $true ([bool](Get-SamePathCopyWizardProfile -ConfigPath $configPath -Name 'Unit1IG' -Targets $targets).Targets['IG2'].Selected) 'Profil güncellenmedi.'

    # İkinci profil ve silme.
    [void](Save-SamePathCopyWizardProfile -ConfigPath $configPath -Name 'Egitmenler' -Settings $profileSettings)
    Assert-Equal 'Egitmenler,Unit1IG' ((Get-SamePathCopyWizardProfileNames -ConfigPath $configPath) -join ',') 'Profiller sıralı dönmeli.'
    Assert-Equal $true (Remove-SamePathCopyWizardProfile -ConfigPath $configPath -Name 'egitmenler') 'Profil silinemedi.'
    Assert-Equal 'Unit1IG' ((Get-SamePathCopyWizardProfileNames -ConfigPath $configPath) -join ',') 'Silinen profil listede kaldı.'
    Assert-Equal $false (Remove-SamePathCopyWizardProfile -ConfigPath $configPath -Name 'yokboyle') 'Olmayan profil silinmiş sayıldı.'
    Assert-Equal $null (Get-SamePathCopyWizardProfile -ConfigPath $configPath -Name 'yokboyle' -Targets $targets) 'Olmayan profil için nesne döndü.'

    # Geçersiz profil adı reddedilir.
    Assert-Equal $false (Test-SamePathCopyWizardProfileName -Name 'boşluk olur mu') 'Boşluklu profil adı kabul edildi.'
    Assert-Equal $false (Test-SamePathCopyWizardProfileName -Name '') 'Boş profil adı kabul edildi.'
    Assert-Equal $true (Test-SamePathCopyWizardProfileName -Name 'Unit1-IG_2.set') 'Geçerli profil adı reddedildi.'
    $profileNameError = $null
    try { [void](Save-SamePathCopyWizardProfile -ConfigPath $configPath -Name 'geçersiz ad' -Settings $profileSettings) } catch { $profileNameError = $_ }
    if ($null -eq $profileNameError) { throw 'Geçersiz profil adı için hata verilmedi.' }

    # profile:<ad> hedefi kopyalama betiğinde uygulanmalı: yalnızca profildeki hedefler ve parametreler.
    $e2eProfileSettings = Get-SamePathCopyWizardSettings -ConfigPath $projectConfigPath -Targets $projectTargets
    foreach ($id in @($e2eProfileSettings.Targets.Keys)) { $e2eProfileSettings.Targets[$id].Selected = $false }
    $firstTargetId = [string]$projectTargets[0].id
    $e2eProfileSettings.Targets[$firstTargetId].Selected = $true
    $e2eProfileSettings.Targets[$firstTargetId].OnlyNewer = $true
    [void](Save-SamePathCopyWizardProfile -ConfigPath $projectConfigPath -Name 'TestProfil' -Settings $e2eProfileSettings)

    # Alt süreç çıktısı metin olarak döner; satırlar üzerinden doğrulanır.
    $planLines = @(& (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -NoProfile -ExecutionPolicy Bypass `
        -File (Join-Path $projectDirectory 'Copy-SamePath.ps1') -TargetId 'profile:TestProfil' `
        -SourcePath (Join-Path $projectDirectory 'README.md') -PlanOnly | Out-String -Stream)
    $planTargetLines = @($planLines | Where-Object { $_ -match '^Target\s+:' })
    Assert-Equal 1 $planTargetLines.Count 'Profil yalnızca kendi hedefini planlamalı.'
    if (@($planLines | Where-Object { $_ -match '^Options\s+: OnlyNewer' }).Count -ne 1) {
        throw "Profil parametresi plana yansımadı: $($planLines -join ' | ')"
    }

    # Bulunmayan profil: PlanOnly kipinde pencere açmadan hata verip çıkmalı (otomasyonu kilitlemez).
    # .NET süreci kullanılır: Start-Process -PassThru çıkış kodunu güvenilir vermiyor, timeout da gerekiyor.
    $missingStartInfo = New-Object System.Diagnostics.ProcessStartInfo
    $missingStartInfo.FileName = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $missingStartInfo.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -TargetId profile:YokBoyleProfil -SourcePath "{1}" -PlanOnly' -f `
        (Join-Path $projectDirectory 'Copy-SamePath.ps1'), (Join-Path $projectDirectory 'README.md')
    $missingStartInfo.UseShellExecute = $false
    $missingStartInfo.CreateNoWindow = $true
    $missingStartInfo.RedirectStandardError = $true
    $missingStartInfo.RedirectStandardOutput = $true
    $missingProcess = [System.Diagnostics.Process]::Start($missingStartInfo)
    $missingErrorText = $missingProcess.StandardError.ReadToEnd()
    [void]$missingProcess.StandardOutput.ReadToEnd()
    if (-not $missingProcess.WaitForExit(30000)) {
        try { $missingProcess.Kill() } catch { }
        throw 'Bulunmayan profil kopyalama betiğini kilitledi (hata penceresi bekliyor olabilir).'
    }
    Assert-Equal 1 $missingProcess.ExitCode 'Bulunmayan profil için çıkış kodu 1 olmalı.'
    if ($missingErrorText -notlike '*YokBoyleProfil*') {
        throw "Bulunmayan profil hatası akışa yazılmadı: $missingErrorText"
    }

    # Süzgeç, bant genişliği ve yeniden deneme parametreleri robocopy anahtarlarına çevrilmeli.
    $filterOptions = [pscustomobject]@{
        ExcludeFiles = '*.pdb; *.tmp'
        ExcludeDirectories = '.git;Logs'
        ThrottleMilliseconds = 15
        RetryCount = 7
        WaitSeconds = 3
    }
    $filterArguments = (Get-SamePathCopyRobocopyArguments -SourceDirectory 'C:\Kaynak' -DestinationDirectory '\\ip\pay' `
        -IsDirectory $true -RetryCount 2 -WaitSeconds 1 -Options $filterOptions) -join ' '
    if ($filterArguments -notlike '*/XF "*.pdb" "*.tmp"*') { throw "Hariç dosyalar /XF üretmedi: $filterArguments" }
    if ($filterArguments -notlike "*/XD `"$(Get-SamePathCopyBackupFolderName)`" `".git`" `"Logs`"*") { throw "Hariç klasörler /XD listesine eklenmedi: $filterArguments" }
    if ($filterArguments -notlike '*/IPG:15*') { throw "Bant genişliği /IPG üretmedi: $filterArguments" }
    if ($filterArguments -notlike '*/R:7*' -or $filterArguments -notlike '*/W:3*') { throw "Yeniden deneme değerleri ezilmedi: $filterArguments" }

    # Değer verilmediğinde config.json değerleri kullanılır ve gereksiz anahtar eklenmez.
    $defaultArguments = (Get-SamePathCopyRobocopyArguments -SourceDirectory 'C:\Kaynak' -DestinationDirectory '\\ip\pay' `
        -IsDirectory $true -RetryCount 2 -WaitSeconds 1 `
        -Options ([pscustomobject]@{ ExcludeFiles = ''; ExcludeDirectories = ''; ThrottleMilliseconds = 0; RetryCount = -1; WaitSeconds = -1 })) -join ' '
    if ($defaultArguments -like '*/XF*') { throw 'Boş süzgeç için /XF eklendi.' }
    if ($defaultArguments -like '*/IPG*') { throw 'Sıfır bekleme için /IPG eklendi.' }
    if ($defaultArguments -notlike '*/R:2*' -or $defaultArguments -notlike '*/W:1*') { throw "config.json yeniden deneme değerleri kullanılmadı: $defaultArguments" }

    # Kalıp listesi ayrıştırma: noktalı virgül ve virgül, boşluklar temizlenir.
    Assert-Equal '*.pdb|*.tmp|desktop.ini' ((Split-SamePathCopyPatternList -Text ' *.pdb ; *.tmp , desktop.ini ') -join '|') 'Kalıp listesi yanlış ayrıştırıldı.'
    Assert-Equal 0 @(Split-SamePathCopyPatternList -Text '  ').Count 'Boş metin kalıp üretmemeli.'

    # Tipli genel ayarlar saklanıp geri okunmalı (metin ve sayı dâhil).
    $typedSettings = Get-SamePathCopyWizardSettings -ConfigPath $configPath -Targets $targets
    Assert-Equal '' ([string]$typedSettings.Global.ExcludeFiles) 'Metin parametresi varsayılanı boş olmalı.'
    Assert-Equal -1 ([int]$typedSettings.Global.RetryCount) 'Sayı parametresi varsayılanı -1 (config) olmalı.'
    $typedSettings.Global.ExcludeFiles = '*.pdb'
    $typedSettings.Global.ThrottleMilliseconds = 25
    $typedSettings.Global.RetryCount = 4
    Save-SamePathCopyWizardSettings -ConfigPath $configPath -Settings $typedSettings
    $typedReloaded = Get-SamePathCopyWizardSettings -ConfigPath $configPath -Targets $targets
    Assert-Equal '*.pdb' ([string]$typedReloaded.Global.ExcludeFiles) 'Metin parametresi saklanmadı.'
    Assert-Equal 25 ([int]$typedReloaded.Global.ThrottleMilliseconds) 'Sayı parametresi saklanmadı.'
    Assert-Equal 4 ([int]$typedReloaded.Global.RetryCount) 'Yeniden deneme değeri saklanmadı.'

    # Arayüz denetiminden değer okuma: boş sayı kutusu varsayılana döner, bozuk metin varsayılana düşer.
    $intDefinition = @(Get-SamePathCopyWizardGlobalDefinitions | Where-Object { $_.Name -eq 'RetryCount' })[0]
    Assert-Equal -1 (Get-SamePathCopyWizardControlValue -Definition $intDefinition -Control ([pscustomobject]@{ Text = '' })) 'Boş sayı kutusu -1 vermeli.'
    Assert-Equal 5 (Get-SamePathCopyWizardControlValue -Definition $intDefinition -Control ([pscustomobject]@{ Text = ' 5 ' })) 'Sayı kutusu değeri okunmadı.'
    Assert-Equal -1 (Get-SamePathCopyWizardControlValue -Definition $intDefinition -Control ([pscustomobject]@{ Text = 'abc' })) 'Bozuk sayı varsayılana dönmeli.'
    $textDefinition = @(Get-SamePathCopyWizardGlobalDefinitions | Where-Object { $_.Name -eq 'ExcludeFiles' })[0]
    Assert-Equal '*.pdb' (Get-SamePathCopyWizardControlValue -Definition $textDefinition -Control ([pscustomobject]@{ Text = '  *.pdb  ' })) 'Metin kutusu değeri kırpılmadı.'

    Write-Host 'Sihirbaz testleri başarılı.'
}
finally {
    $env:SAMEPATHCOPY_WIZARD_STATE = $previousStatePath
    if (Test-Path -LiteralPath $testDirectory) {
        Remove-Item -LiteralPath $testDirectory -Recurse -Force
    }
}
