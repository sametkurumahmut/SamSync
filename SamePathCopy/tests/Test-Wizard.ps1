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

    # Kolon başlığındaki toplu seçim ikonları yalnızca kendi kolonunu değiştirmeli.
    $fakeRows = @(
        [pscustomobject]@{ Id = 'IG1'; Controls = @{ Selected = [pscustomobject]@{ IsChecked = $true }; Backup = [pscustomobject]@{ IsChecked = $false }; Mirror = [pscustomobject]@{ IsChecked = $false } } }
        [pscustomobject]@{ Id = 'IG2'; Controls = @{ Selected = [pscustomobject]@{ IsChecked = $true }; Backup = [pscustomobject]@{ IsChecked = $false }; Mirror = [pscustomobject]@{ IsChecked = $true } } }
    )
    Set-SamePathCopyWizardColumnState -Rows $fakeRows -Key 'Backup' -Value $true
    Assert-Equal $true ([bool]$fakeRows[0].Controls['Backup'].IsChecked) 'Toplu seçim kolonun ilk satırını işaretlemedi.'
    Assert-Equal $true ([bool]$fakeRows[1].Controls['Backup'].IsChecked) 'Toplu seçim kolonun bütün satırlarını işaretlemedi.'
    Assert-Equal $true ([bool]$fakeRows[0].Controls['Selected'].IsChecked) 'Toplu seçim başka kolonu değiştirdi.'
    Assert-Equal $true ([bool]$fakeRows[1].Controls['Mirror'].IsChecked) 'Toplu seçim başka kolonu değiştirdi.'
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

    Write-Host 'Sihirbaz testleri başarılı.'
}
finally {
    $env:SAMEPATHCOPY_WIZARD_STATE = $previousStatePath
    if (Test-Path -LiteralPath $testDirectory) {
        Remove-Item -LiteralPath $testDirectory -Recurse -Force
    }
}
