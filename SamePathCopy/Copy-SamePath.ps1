[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string[]]$SourcePath,
    [Parameter(Mandatory = $true)][string]$TargetId,
    [string]$ConfigPath,
    [switch]$PlanOnly
)

$ErrorActionPreference = 'Stop'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($scriptDirectory)) {
    throw 'Copy-SamePath.ps1 dosyasının bulunduğu klasör belirlenemedi.'
}
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = Join-Path $scriptDirectory 'config.json'
}
. (Join-Path $scriptDirectory 'SamePathCopy.Common.ps1')
. (Join-Path $scriptDirectory 'SamePathCopy.Ui.ps1')
. (Join-Path $scriptDirectory 'SamePathCopy.Log.ps1')

[void](Initialize-SamePathCopyLog -ScriptDirectory $scriptDirectory)
Write-SamePathCopyLogStart -Component 'Kopyala' -Summary ("Kopyalama isteği: hedef '{0}', {1} kaynak" -f $TargetId, @($SourcePath).Count)
foreach ($requestedSource in @($SourcePath)) {
    Write-SamePathCopyLog -Component 'Kopyala' -Message ("İstenen kaynak: {0}" -f $requestedSource)
}

# Kopyalama penceresindeki İptal düğmesi bu bayrağı kaldırır; çalışan robocopy süreci durdurulur.
$script:cancelRequested = $false
$script:notifyIcon = $null

trap {
    Write-SamePathCopyLog -Component 'Kopyala' -Level 'ERROR' -Message ("Hata: {0}" -f $_.Exception.Message)
    Write-SamePathCopyLog -Component 'Kopyala' -Level 'ERROR' -Message ("Tür: {0} | Konum: {1}" -f $_.Exception.GetType().FullName, ([string]$_.InvocationInfo.PositionMessage -replace '\r?\n', ' '))
    Write-SamePathCopyLog -Component 'Kopyala' -Level 'ERROR' -Message ("Yığın: {0}" -f ([string]$_.ScriptStackTrace -replace '\r?\n', ' <- '))
    # PlanOnly ve otomatik kapanma kipi betikten/testten çağrılır: hata penceresi açıp beklemek yerine
    # hatayı akışa yazıp çıkar; aksi hâlde kimsenin kapatmayacağı bir iletişim kutusu süreci kilitler.
    if ($PlanOnly -or -not [string]::IsNullOrWhiteSpace($env:SAMEPATHCOPY_COPYWINDOW_AUTOCLOSE)) {
        Write-Error $_.Exception.Message -ErrorAction Continue
        exit 1
    }
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [void][System.Windows.Forms.MessageBox]::Show(
            $_.Exception.Message,
            'Aynı Dizine Kopyala - Hata',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        )
    }
    catch {
        # Explorer'dan çalışırken ana hatayı gizlememek için yalnızca GUI hatasını yut.
    }
    exit 1
}

function Start-SamePathCopyRobocopy {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][bool]$IsDirectory,
        [Parameter(Mandatory = $true)][int]$RetryCount,
        [Parameter(Mandatory = $true)][int]$WaitSeconds,
        $Options
    )

    # robocopy süreci başlatılır ve beklenmeden döner: birden fazla hedefe aynı anda kopyalayabilmek için
    # bekleme işi çağırana (zamanlayıcıya) bırakılır. Sonuç Complete-SamePathCopyRobocopy ile alınır.
    if ($Destination -match '^(\\\\[^\\]+\\[^\\]+)') {
        $shareRoot = $Matches[1]
        try {
            [void](Get-Item -LiteralPath $shareRoot -ErrorAction Stop)
        }
        catch {
            throw "Hedef SMB paylaşımına erişilemiyor: $shareRoot. Windows paylaşım ve NTFS izinlerini veya kayıtlı ağ kimlik bilgilerini kontrol edin. Ayrıntı: $($_.Exception.Message)"
        }
    }

    if ($IsDirectory) {
        $sourceDirectory = $Source
        $destinationDirectory = $Destination
        $fileFilter = $null
    }
    else {
        $sourceDirectory = [System.IO.Path]::GetDirectoryName($Source)
        $destinationDirectory = [System.IO.Path]::GetDirectoryName($Destination)
        $fileFilter = [System.IO.Path]::GetFileName($Source)
        if ([string]::IsNullOrWhiteSpace($sourceDirectory) -or
            [string]::IsNullOrWhiteSpace($destinationDirectory) -or
            [string]::IsNullOrWhiteSpace($fileFilter)) {
            throw "Dosya kopyalama yolları çözümlenemedi. Kaynak: $Source; Hedef: $Destination"
        }
    }

    $logPath = Join-Path ([System.IO.Path]::GetTempPath()) ("SamePathCopy-Robocopy-{0}.log" -f [guid]::NewGuid().ToString('N'))
    $arguments = @(Get-SamePathCopyRobocopyArguments -SourceDirectory $sourceDirectory -DestinationDirectory $destinationDirectory `
        -FileFilter $fileFilter -IsDirectory $IsDirectory -RetryCount $RetryCount -WaitSeconds $WaitSeconds -Options $Options -LogPath $logPath)
    $process = Start-Process -FilePath 'robocopy.exe' -ArgumentList ($arguments -join ' ') -WindowStyle Hidden -PassThru
    return [pscustomobject]@{ Process = $process; LogPath = $logPath; Killed = $false }
}

function Complete-SamePathCopyRobocopy {
    param([Parameter(Mandatory = $true)]$Run)

    $Run.Process.WaitForExit()
    $details = ''
    try {
        if (-not $Run.Killed -and $Run.Process.ExitCode -ge 8 -and (Test-Path -LiteralPath $Run.LogPath -PathType Leaf)) {
            $detailLines = @(Get-Content -LiteralPath $Run.LogPath -Encoding Unicode -ErrorAction SilentlyContinue |
                ForEach-Object { $_.Trim() } |
                Where-Object { $_ } |
                Select-Object -Last 12)
            $details = $detailLines -join "`r`n"
        }
    }
    finally {
        if (Test-Path -LiteralPath $Run.LogPath -PathType Leaf) {
            Remove-Item -LiteralPath $Run.LogPath -Force -ErrorAction SilentlyContinue
        }
    }
    return [pscustomobject]@{
        ExitCode = [int]$Run.Process.ExitCode
        Details = $details
        Cancelled = [bool]$Run.Killed
    }
}

function Start-SamePathCopyBackup {
    param(
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][string]$BackupPath,
        [Parameter(Mandatory = $true)][bool]$IsDirectory,
        [Parameter(Mandatory = $true)][int]$RetryCount,
        [Parameter(Mandatory = $true)][int]$WaitSeconds
    )

    # Yalnızca hedefte hâlihazırda var olan öğe yedeklenir; yeni gönderilen öğenin yedeklenecek bir önceki hâli yoktur.
    if (-not (Test-Path -LiteralPath $Destination)) { return $null }
    return (Start-SamePathCopyRobocopy -Source $Destination -Destination $BackupPath -IsDirectory $IsDirectory `
        -RetryCount $RetryCount -WaitSeconds $WaitSeconds -Options $null)
}

$config = Get-SamePathCopyConfiguration -ConfigPath $ConfigPath
$localIdentity = Get-LocalSamePathCopyIdentity -Configuration $config
$resolvedConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$isWizard = $TargetId -eq 'wizard'
# wizard:last, sihirbaz penceresini açmadan son kaydedilen seçim ve parametrelerle kopyalar (klavye kısayolu için).
$isWizardLast = $TargetId -eq 'wizard:last'
# profile:<ad>, sihirbazda kaydedilmis adlandirilmis bir secim kumesiyle kopyalar.
$profileName = if ($TargetId.StartsWith('profile:', [System.StringComparison]::OrdinalIgnoreCase)) { $TargetId.Substring(8).Trim() } else { '' }
$isProfile = -not [string]::IsNullOrWhiteSpace($profileName)
# restore, yedekteki eski hâli hedefe geri yazar; yön ters olduğu için sihirbaz ayarları kullanılmaz.
$isRestore = $TargetId -eq 'restore'
$useWizardSettings = $isWizard -or $isWizardLast -or $isProfile
$targets = @(Resolve-SamePathCopyTargets -Configuration $config -TargetId $TargetId -LocalIdentity $localIdentity)
if ($targets.Count -eq 0) {
    throw "Kopyalama için etkin hedef yok."
}

Write-SamePathCopyLog -Component 'Kopyala' -Message ("Yerel node: {0} ({1}) | kökler: {2} | config: {3} | sürüm: v{4}" -f
    $localIdentity.Id, $localIdentity.Name, (@($localIdentity.Roots) -join ' ; '), $resolvedConfigPath, $config.version)
Write-SamePathCopyLog -Component 'Kopyala' -Message ("Çözülen hedefler ({0}): {1}" -f $targets.Count, (@($targets | ForEach-Object { $_.id }) -join ', '))

$wizardSettings = $null
if ($useWizardSettings) {
    . (Join-Path $scriptDirectory 'SamePathCopy.Wizard.ps1')
    if ($isProfile) {
        $wizardSettings = Get-SamePathCopyWizardProfile -ConfigPath $resolvedConfigPath -Name $profileName -Targets $targets
        if ($null -eq $wizardSettings) {
            $availableProfiles = @(Get-SamePathCopyWizardProfileNames -ConfigPath $resolvedConfigPath)
            $availableText = if ($availableProfiles.Count -gt 0) { $availableProfiles -join ', ' } else { '(kayitli profil yok)' }
            throw "'$profileName' profili bulunamadi. Sihirbazda kayitli profiller: $availableText"
        }
    }
    else {
        $wizardSettings = Get-SamePathCopyWizardSettings -ConfigPath $resolvedConfigPath -Targets $targets
    }
    Write-SamePathCopyLog -Component 'Sihirbaz' -Message ("{0} okundu: {1} | secili: {2}" -f
        $(if ($isProfile) { "'$profileName' profili" } else { 'Kayitli ayar' }),
        (Get-SamePathCopyWizardStatePath), (@($wizardSettings.Targets.Keys | Where-Object { $wizardSettings.Targets[$_].Selected } | Sort-Object) -join ', '))
}

$sourceItems = @(foreach ($path in @($SourcePath | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Kaynak bulunamadı: $path"
    }
    $item = Get-Item -LiteralPath $path -Force
    if ($item.PSProvider.Name -ne 'FileSystem') {
        throw "Yalnızca dosya sistemi öğeleri destekleniyor: $path"
    }
    $item
})
if ($sourceItems.Count -eq 0) {
    throw 'Kopyalanacak kaynak seçilmedi.'
}

$globalOptions = $null
if ($useWizardSettings) {
    if ($isWizard -and -not $PlanOnly) {
        # Arayüz, kullanıcı vazgeçse bile tablodaki son hâli döndürür; ayarlar her iki durumda da saklanır.
        Write-SamePathCopyLog -Component 'Sihirbaz' -Message 'Sihirbaz penceresi açıldı.'
        $wizardResult = Show-SamePathCopyWizard -Configuration $config -Targets $targets -SourceItems $sourceItems -Settings $wizardSettings -ConfigPath $resolvedConfigPath -LocalRoots $localIdentity.Roots -IconPath (Join-Path $scriptDirectory 'assets\SamePathCopy.ico')
        Save-SamePathCopyWizardSettings -ConfigPath $resolvedConfigPath -Settings $wizardResult.Settings
        Write-SamePathCopyLog -Component 'Sihirbaz' -Message ("Pencere kapandı: {0} | seçili: {1} | genel: {2}" -f
            $(if ($wizardResult.Confirmed) { 'başlat' } else { 'vazgeç' }),
            (@($wizardResult.Settings.Targets.Keys | Where-Object { $wizardResult.Settings.Targets[$_].Selected } | Sort-Object) -join ', '),
            (@(@('DryRun', 'FastCopy') | Where-Object { Get-SamePathCopyOptionValue -Options $wizardResult.Settings.Global -Name $_ }) -join ', '))
        if (-not $wizardResult.Confirmed) { exit 0 }
        $wizardSettings = $wizardResult.Settings
    }
    $globalOptions = $wizardSettings.Global
    $targets = @($targets | Where-Object { [bool]$wizardSettings.Targets[[string]$_.id].Selected })
    if ($targets.Count -eq 0) {
        if ($isProfile) {
            throw "'$profileName' profilinde hicbir bilgisayar secili degil. Sihirbazda profili duzenleyip yeniden kaydedin."
        }
        if ($isWizardLast) {
            throw 'Son sihirbaz ayarında hiçbir bilgisayar seçili değil. Sihirbazı açıp hedef seçin; kısayol bir dahaki sefere o seçimi kullanır.'
        }
        throw 'Sihirbazda hiçbir bilgisayar seçilmedi.'
    }
}

$backupStamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
if ($isRestore) {
    # Geri alma: hedeflerdeki yedekler taranır, kullanıcı hangi bilgisayarda hangi yedeği geri yazacağını seçer.
    . (Join-Path $scriptDirectory 'SamePathCopy.Restore.ps1')
    $restoreProbePlans = @(foreach ($target in $targets) {
        foreach ($sourceItem in $sourceItems) {
            [pscustomobject]@{
                Target = $target
                SourceItem = $sourceItem
                IsDirectory = [bool]$sourceItem.PSIsContainer
                Destination = Get-SamePathCopyDestination -SourcePath $sourceItem.FullName -LocalRoots $localIdentity.Roots `
                    -Address ([string]$target.address) -NetworkRoot ([string]$target.networkRoot)
            }
        }
    })
    $restoreCandidates = @(Get-SamePathCopyRestoreCandidates -Plans $restoreProbePlans)
    Write-SamePathCopyLog -Component 'GeriAl' -Message ("Yedek taraması: {0} hedefte yedek bulundu" -f $restoreCandidates.Count)
    if ($restoreCandidates.Count -eq 0) {
        throw 'Seçilen öğe için hiçbir hedefte yedek bulunamadı. Yedekler kopyalama sırasında "Yedek al" seçiliyken oluşur.'
    }

    $restoreResult = Show-SamePathCopyRestore -Configuration $config -Candidates $restoreCandidates -SourceItems $sourceItems `
        -IconPath (Join-Path $scriptDirectory 'assets\SamePathCopy.ico')
    if (-not $restoreResult.Confirmed -or @($restoreResult.Selections).Count -eq 0) {
        Write-SamePathCopyLog -Component 'GeriAl' -Message 'Geri alma penceresinde vazgeçildi.'
        exit 0
    }

    # Geri alma planları: kaynak yedekteki kopya, hedef ise aslı. Ayna kullanılmaz; istenirse mevcut hâl yedeklenir.
    $plans = @(foreach ($selection in @($restoreResult.Selections)) {
        $candidate = $selection.Candidate
        $backupItem = Get-Item -LiteralPath $selection.Stamp.Path -Force
        [pscustomobject]@{
            SourceItem = $backupItem
            IsDirectory = [bool]$backupItem.PSIsContainer
            Target = $candidate.Plan.Target
            MatchedRoot = $selection.Stamp.Path
            Destination = $candidate.Destination
            Options = [pscustomobject]@{
                Backup = [bool]$restoreResult.BackupCurrent
                OnlyNewer = $false
                Mirror = $false
                DryRun = $false
                FastCopy = $false
                Notify = $true
                ExcludeFiles = ''
                ExcludeDirectories = ''
                ThrottleMilliseconds = 0
                ParallelTargets = 4
                RetryCount = -1
                WaitSeconds = -1
            }
            BackupPath = Get-SamePathCopyBackupPath -Destination $candidate.Destination -Address ([string]$candidate.Plan.Target.address) `
                -NetworkRoot ([string]$candidate.Plan.Target.networkRoot) -Stamp $backupStamp
        }
        Write-SamePathCopyLog -Component 'GeriAl' -Message ("{0}: {1} yedeği geri yazılacak -> {2}" -f
            $candidate.TargetName, $selection.Stamp.Label, $candidate.Destination)
    })
}
# Geri alma kipinde planlar yukarıda kuruldu; normal kopyalama planı yalnızca diğer kiplerde hesaplanır.
if (-not $isRestore) {
$plans = @(foreach ($target in $targets) {
    $targetId = [string]$target.id
    # Hedef başına parametreler sihirbazdan gelir; sihirbaz dışı çağrılarda hepsi kapalıdır (eski davranış).
    $targetOptions = if ($useWizardSettings) { $wizardSettings.Targets[$targetId] } else { $null }
    $options = [pscustomobject]@{
        Backup = Get-SamePathCopyOptionValue -Options $targetOptions -Name 'Backup'
        OnlyNewer = Get-SamePathCopyOptionValue -Options $targetOptions -Name 'OnlyNewer'
        Mirror = Get-SamePathCopyOptionValue -Options $targetOptions -Name 'Mirror'
        DryRun = Get-SamePathCopyOptionValue -Options $globalOptions -Name 'DryRun'
        FastCopy = Get-SamePathCopyOptionValue -Options $globalOptions -Name 'FastCopy'
        ExcludeFiles = Get-SamePathCopyOptionText -Options $globalOptions -Name 'ExcludeFiles'
        ExcludeDirectories = Get-SamePathCopyOptionText -Options $globalOptions -Name 'ExcludeDirectories'
        ThrottleMilliseconds = Get-SamePathCopyOptionNumber -Options $globalOptions -Name 'ThrottleMilliseconds' -Default 0
        Notify = $(if ($null -ne $globalOptions -and $globalOptions.PSObject.Properties['Notify']) { [bool]$globalOptions.Notify } else { $true })
        RetryCount = Get-SamePathCopyOptionNumber -Options $globalOptions -Name 'RetryCount' -Default -1
        WaitSeconds = Get-SamePathCopyOptionNumber -Options $globalOptions -Name 'WaitSeconds' -Default -1
    }
    foreach ($sourceItem in $sourceItems) {
        # Kaynak hangi yerel kökün altındaysa göreli yol o köke göre hesaplanır; hiçbirinin altında değilse tam yol korunur.
        $matchedRoot = Get-SamePathCopyMatchingRoot -FullPath ([System.IO.Path]::GetFullPath($sourceItem.FullName)) -LocalRoots $localIdentity.Roots
        $destination = Get-SamePathCopyDestination -SourcePath $sourceItem.FullName -LocalRoots $localIdentity.Roots -Address ([string]$target.address) -NetworkRoot ([string]$target.networkRoot)
        [pscustomobject]@{
            SourceItem = $sourceItem
            IsDirectory = [bool]$sourceItem.PSIsContainer
            Target = $target
            MatchedRoot = $matchedRoot
            Destination = $destination
            Options = $options
            BackupPath = Get-SamePathCopyBackupPath -Destination $destination -Address ([string]$target.address) -NetworkRoot ([string]$target.networkRoot) -Stamp $backupStamp
        }
    }
})
}

function Get-SamePathCopyActiveOptionNames {
    param($Options)

    return @(@('Backup', 'OnlyNewer', 'Mirror', 'DryRun', 'FastCopy') |
        Where-Object { Get-SamePathCopyOptionValue -Options $Options -Name $_ })
}

foreach ($plan in $plans) {
    Write-SamePathCopyLog -Component 'Plan' -Message ("[{0}] {1} → {2} | kök: {3} | parametreler: {4}" -f
        $plan.Target.name, $plan.SourceItem.FullName, $plan.Destination,
        $(if ($plan.MatchedRoot) { $plan.MatchedRoot } else { '(kök dışı)' }),
        (@(Get-SamePathCopyActiveOptionNames -Options $plan.Options) -join ',' | ForEach-Object { if ($_) { $_ } else { 'yok' } }))
}

if ($PlanOnly) {
    Write-SamePathCopyLog -Component 'Kopyala' -Message ("PlanOnly: {0} işlem hesaplandı, kopyalama yapılmadı." -f $plans.Count)
    foreach ($plan in $plans) {
        [pscustomobject]@{
            Source = $plan.SourceItem.FullName
            LocalRoot = if ($plan.MatchedRoot) { $plan.MatchedRoot } else { '(kök dışı)' }
            LocalMachine = $localIdentity.Name
            Target = $plan.Target.name
            Destination = $plan.Destination
            Options = (@(Get-SamePathCopyActiveOptionNames -Options $plan.Options) -join ',')
        }
    }
    exit 0
}

$copyWindowBody = @'
    <Grid Margin="20,18,20,18">
        <Grid.RowDefinitions>
            <RowDefinition Height="Auto" />
            <RowDefinition Height="Auto" />
            <RowDefinition Height="Auto" />
            <RowDefinition Height="*" />
            <RowDefinition Height="Auto" />
        </Grid.RowDefinitions>

        <StackPanel>
            <TextBlock x:Name="HeaderText" Style="{StaticResource TitleText}" />
            <TextBlock x:Name="SourceText" Style="{StaticResource SubtitleText}" Margin="0,4,0,0" />
        </StackPanel>

        <StackPanel x:Name="ChipPanel" Grid.Row="1" Orientation="Horizontal" Margin="0,12,0,0" />

        <Grid Grid.Row="2" Margin="0,16,0,0">
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto" />
                <RowDefinition Height="Auto" />
            </Grid.RowDefinitions>
            <Grid>
                <TextBlock x:Name="ProgressLabel" Style="{StaticResource BodyText}" />
                <TextBlock x:Name="ProgressCountText" Style="{StaticResource MutedText}" HorizontalAlignment="Right" />
            </Grid>
            <ProgressBar x:Name="CopyProgress" Grid.Row="1" Style="{StaticResource ModernProgressBar}"
                         Margin="0,8,0,0" Minimum="0" />
        </Grid>

        <Border Grid.Row="3" Style="{StaticResource Card}" Margin="0,16,0,0" Padding="6">
            <ScrollViewer x:Name="LogScroller" VerticalScrollBarVisibility="Auto"
                          HorizontalScrollBarVisibility="Disabled" CanContentScroll="False">
                <StackPanel x:Name="LogPanel" Margin="6,4,6,4" />
            </ScrollViewer>
        </Border>

        <Grid Grid.Row="4" Margin="0,16,0,0">
            <TextBlock x:Name="SummaryText" Style="{StaticResource MutedText}" VerticalAlignment="Center" />
            <StackPanel Orientation="Horizontal" HorizontalAlignment="Right">
                <Button x:Name="OpenReportButton" Style="{StaticResource GhostButton}" Content="Raporu aç"
                        Margin="0,0,10,0" IsEnabled="False" />
                <Button x:Name="CopyLogButton" Style="{StaticResource GhostButton}" Content="Günlüğü kopyala"
                        Margin="0,0,10,0" />
                <Button x:Name="CancelButton" Style="{StaticResource SecondaryButton}" Content="İptal"
                        Margin="0,0,10,0" />
                <Button x:Name="CloseButton" Style="{StaticResource PrimaryButton}" Content="Kapat" IsEnabled="False" />
            </StackPanel>
        </Grid>
    </Grid>
'@

$iconPath = Join-Path $scriptDirectory 'assets\SamePathCopy.ico'
$window = New-SamePathCopyWindow -Title ("{0} v{1}" -f [string]$config.menuTitle, [string]$config.version) `
    -BodyXaml $copyWindowBody -Width 940 -Height 640 -MinWidth 720 -MinHeight 480 -IconPath $iconPath

$headerText = $window.FindName('HeaderText')
$sourceText = $window.FindName('SourceText')
$chipPanel = $window.FindName('ChipPanel')
$progressLabel = $window.FindName('ProgressLabel')
$progressCountText = $window.FindName('ProgressCountText')
$copyProgress = $window.FindName('CopyProgress')
$logPanel = $window.FindName('LogPanel')
$logScroller = $window.FindName('LogScroller')
$summaryText = $window.FindName('SummaryText')
$copyLogButton = $window.FindName('CopyLogButton')
$openReportButton = $window.FindName('OpenReportButton')
$cancelButton = $window.FindName('CancelButton')
$closeButton = $window.FindName('CloseButton')

$headerText.Text = 'Kopyalanıyor'
# Başlık satırı seçimi özetler; öğelerin tamamı ve hedefteki göreli yolları başlıktaki kaynak çipinde durur.
$sourceSummary = Get-SamePathCopySourceSummary -SourceItems $sourceItems -LocalRoots $localIdentity.Roots
$sourceText.Text = [string]$sourceSummary.HeadlineText
$sourceText.ToolTip = [string]$sourceSummary.ToolTipText
$copyProgress.Maximum = $plans.Count
$progressLabel.Text = 'Başlatılıyor...'
$progressCountText.Text = "0 / {0}" -f $plans.Count

function Add-SamePathCopyChip {
    param([Parameter(Mandatory = $true)][string]$Text, [string]$ToolTip)

    $chip = New-Object System.Windows.Controls.Border
    $chip.Style = $window.FindResource('Chip')
    $chipText = New-Object System.Windows.Controls.TextBlock
    $chipText.Style = $window.FindResource('MutedText')
    $chipText.Text = $Text
    $chipText.MaxWidth = 420
    if ($ToolTip) { $chip.ToolTip = $ToolTip }
    $chip.Child = $chipText
    [void]$chipPanel.Children.Add($chip)
}

Add-SamePathCopyChip -Text ("{0} işlem" -f $plans.Count)
[void]$chipPanel.Children.Add((New-SamePathCopySourceChip -Window $window -Summary $sourceSummary))
if ($isWizardLast) {
    Add-SamePathCopyChip -Text 'Son sihirbaz ayarı' -ToolTip 'Hedefler ve parametreler sihirbazda en son kaydedilen hâlden alındı; pencere açılmadı.'
}
if ($isProfile) {
    Add-SamePathCopyChip -Text ("Profil: {0}" -f $profileName) -ToolTip 'Hedefler ve parametreler bu profilden alindi; sihirbaz penceresi acilmadi.'
}
[void]$chipPanel.Children.Add((New-SamePathCopyLocalRootChip -Window $window -Summary $sourceSummary))
$activeGlobalOptions = @(@('DryRun', 'FastCopy') | Where-Object { Get-SamePathCopyOptionValue -Options $globalOptions -Name $_ })
if ($activeGlobalOptions -contains 'DryRun') { Add-SamePathCopyChip -Text 'Deneme çalıştırması' -ToolTip 'Hedefe hiçbir şey yazılmaz (robocopy /L).' }
if ($activeGlobalOptions -contains 'FastCopy') { Add-SamePathCopyChip -Text 'Hızlı kopyalama' -ToolTip 'robocopy /MT:8' }

$logLines = New-Object System.Collections.Generic.List[string]
$glyphs = @{
    Running = [pscustomobject]@{ Glyph = '⋯'; Brush = 'TextMutedBrush' }
    Success = [pscustomobject]@{ Glyph = '✓'; Brush = 'SuccessBrush' }
    Error = [pscustomobject]@{ Glyph = '✕'; Brush = 'DangerBrush' }
    Skipped = [pscustomobject]@{ Glyph = '–'; Brush = 'TextMutedBrush' }
    Info = [pscustomobject]@{ Glyph = '•'; Brush = 'AccentBrush' }
}

function Get-SamePathCopyLogLevelForKind {
    param([Parameter(Mandatory = $true)][string]$Kind)

    switch ($Kind) {
        'Error' { return 'ERROR' }
        'Skipped' { return 'WARN' }
        default { return 'INFO' }
    }
}

function New-SamePathCopyLogEntry {
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [string]$Detail,
        [string]$Kind = 'Running'
    )

    $border = New-Object System.Windows.Controls.Border
    $border.Style = $window.FindResource('RowBorder')
    $border.Padding = New-Object System.Windows.Thickness(6, 5, 6, 5)
    $border.Margin = New-Object System.Windows.Thickness(0, 0, 0, 2)

    $grid = New-Object System.Windows.Controls.Grid
    $glyphColumn = New-Object System.Windows.Controls.ColumnDefinition
    $glyphColumn.Width = [System.Windows.GridLength]::new(22)
    $textColumn = New-Object System.Windows.Controls.ColumnDefinition
    $textColumn.Width = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star)
    [void]$grid.ColumnDefinitions.Add($glyphColumn)
    [void]$grid.ColumnDefinitions.Add($textColumn)

    $glyphText = New-Object System.Windows.Controls.TextBlock
    $glyphText.Style = $window.FindResource('BodyText')
    $glyphText.FontSize = 13
    $glyphText.VerticalAlignment = 'Top'
    $glyphText.Text = [string]$glyphs[$Kind].Glyph
    $glyphText.Foreground = $window.FindResource([string]$glyphs[$Kind].Brush)
    [System.Windows.Controls.Grid]::SetColumn($glyphText, 0)
    [void]$grid.Children.Add($glyphText)

    $textPanel = New-Object System.Windows.Controls.StackPanel
    [System.Windows.Controls.Grid]::SetColumn($textPanel, 1)
    $titleText = New-Object System.Windows.Controls.TextBlock
    $titleText.Style = $window.FindResource('BodyText')
    $titleText.Text = $Title
    [void]$textPanel.Children.Add($titleText)
    if (-not [string]::IsNullOrWhiteSpace($Detail)) {
        $detailText = New-Object System.Windows.Controls.TextBlock
        $detailText.Style = $window.FindResource('MutedText')
        $detailText.Text = $Detail
        $detailText.ToolTip = $Detail
        [void]$textPanel.Children.Add($detailText)
    }
    [void]$grid.Children.Add($textPanel)
    $border.Child = $grid
    [void]$logPanel.Children.Add($border)
    $logScroller.ScrollToBottom()

    $logLines.Add(("{0} {1}" -f [string]$glyphs[$Kind].Glyph, $Title))
    if (-not [string]::IsNullOrWhiteSpace($Detail)) { $logLines.Add("    $Detail") }

    # Ekranda görünen her satır dosya günlüğüne de yazılır; böylece root.log paneldeki sonucun aynısını taşır.
    $logMessage = if ([string]::IsNullOrWhiteSpace($Detail)) { $Title } else { "$Title | $Detail" }
    Write-SamePathCopyLog -Component 'Panel' -Level (Get-SamePathCopyLogLevelForKind -Kind $Kind) -Message $logMessage

    return [pscustomobject]@{ GlyphText = $glyphText; TextPanel = $textPanel; Title = $Title }
}

function Set-SamePathCopyLogEntryState {
    param(
        [Parameter(Mandatory = $true)]$Entry,
        [Parameter(Mandatory = $true)][string]$Kind
    )

    $Entry.GlyphText.Text = [string]$glyphs[$Kind].Glyph
    $Entry.GlyphText.Foreground = $window.FindResource([string]$glyphs[$Kind].Brush)
    Write-SamePathCopyLog -Component 'Panel' -Level (Get-SamePathCopyLogLevelForKind -Kind $Kind) -Message ("{0} → {1}" -f $Entry.Title, (Get-SamePathCopyKindLabel -Kind $Kind))
}

function Get-SamePathCopyKindLabel {
    param([Parameter(Mandatory = $true)][string]$Kind)

    switch ($Kind) {
        'Success' { return 'başarılı' }
        'Error' { return 'hatalı' }
        'Skipped' { return 'atlandı' }
        'Running' { return 'sürüyor' }
        default { return $Kind }
    }
}

function Add-SamePathCopyLogNote {
    param(
        [Parameter(Mandatory = $true)]$Entry,
        [Parameter(Mandatory = $true)][string]$Text,
        [string]$Brush = 'TextMutedBrush'
    )

    $noteText = New-Object System.Windows.Controls.TextBlock
    $noteText.Style = $window.FindResource('MutedText')
    $noteText.Text = $Text
    $noteText.Foreground = $window.FindResource($Brush)
    $noteText.TextWrapping = 'Wrap'
    $noteText.TextTrimming = 'None'
    [void]$Entry.TextPanel.Children.Add($noteText)
    $logScroller.ScrollToBottom()
    $logLines.Add("    $Text")
    $noteLevel = if ($Brush -eq 'DangerBrush') { 'ERROR' } else { 'INFO' }
    Write-SamePathCopyLog -Component 'Panel' -Level $noteLevel -Message ("{0} | {1}" -f $Entry.Title, $Text)
}

# Olay işleyicileri betik kapsamındaki değişkenleri ve fonksiyonları görür; kapanış (GetNewClosure)
# kullanılmaz, çünkü kapanışlar ayrı bir modül kapsamına bağlanır ve betikteki fonksiyonlara erişemez.
$logFilePath = Get-SamePathCopyLogPath
if (-not [string]::IsNullOrWhiteSpace($logFilePath)) {
    # Panelde görünen satırlar dosyaya da yazıldığı için düğmenin ipucunda günlük dosyasının yolu gösterilir.
    $copyLogButton.ToolTip = "Paneldeki satırları panoya kopyalar.`r`nDosya günlüğü: $logFilePath"
}
$copyLogButton.Add_Click({
    try { [System.Windows.Clipboard]::SetText(($logLines -join "`r`n")) } catch { }
})
$cancelButton.Add_Click({
    $script:cancelRequested = $true
    $cancelButton.IsEnabled = $false
    $cancelButton.Content = 'İptal ediliyor...'
})
$closeButton.Add_Click({ $window.Close() })
$script:reportPath = ''
$openReportButton.Add_Click({
    if ([string]::IsNullOrWhiteSpace($script:reportPath)) { return }
    try { Start-Process -FilePath $script:reportPath } catch { }
})
$script:windowClosed = $false
$window.Add_Closed({ $script:windowClosed = $true })

function Invoke-SamePathCopyListing {
    param(
        [Parameter(Mandatory = $true)]$Plan,
        [Parameter(Mandatory = $true)][int]$RetryCount,
        [Parameter(Mandatory = $true)][int]$WaitSeconds,
        [int]$TimeoutSeconds = 120
    )

    # robocopy /L ile hiçbir şey yazmadan "ne olurdu" listesi alınır; ayna onayında ve deneme kipinde kullanılır.
    $isDirectory = [bool]$Plan.IsDirectory
    if ($isDirectory) {
        $sourceDirectory = $Plan.SourceItem.FullName
        $destinationDirectory = $Plan.Destination
        $fileFilter = $null
    }
    else {
        $sourceDirectory = [System.IO.Path]::GetDirectoryName($Plan.SourceItem.FullName)
        $destinationDirectory = [System.IO.Path]::GetDirectoryName($Plan.Destination)
        $fileFilter = [System.IO.Path]::GetFileName($Plan.SourceItem.FullName)
    }

    $logPath = Join-Path ([System.IO.Path]::GetTempPath()) ("SamePathCopy-Listing-{0}.log" -f [guid]::NewGuid().ToString('N'))
    $arguments = @(Get-SamePathCopyRobocopyArguments -SourceDirectory $sourceDirectory -DestinationDirectory $destinationDirectory `
        -FileFilter $fileFilter -IsDirectory $isDirectory -RetryCount $RetryCount -WaitSeconds $WaitSeconds `
        -Options $Plan.Options -LogPath $logPath -Listing)
    try {
        $process = Start-Process -FilePath 'robocopy.exe' -ArgumentList ($arguments -join ' ') -WindowStyle Hidden -PassThru
        $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
        while (-not $process.WaitForExit(120)) {
            Invoke-SamePathCopyUiPump
            if ([DateTime]::UtcNow -gt $deadline) {
                try { $process.Kill() } catch { }
                break
            }
        }
        $process.WaitForExit()
        $lines = @()
        if (Test-Path -LiteralPath $logPath -PathType Leaf) {
            $lines = @(Get-Content -LiteralPath $logPath -Encoding Unicode -ErrorAction SilentlyContinue)
        }
        return (Get-SamePathCopyListingSummary -Lines $lines)
    }
    finally {
        if (Test-Path -LiteralPath $logPath -PathType Leaf) {
            Remove-Item -LiteralPath $logPath -Force -ErrorAction SilentlyContinue
        }
    }
}

# Kopyalama döngüsü olay işleyicisi içinde değil, betik akışında çalışır: böylece buradaki yardımcı
# fonksiyonlar ve değişkenler doğrudan görünür. Pencere modelsiz açılıp döngü boyunca beslenir.
$window.Show()
[void]$window.Activate()
Invoke-SamePathCopyUiPump

# Ön uçuş denetimleri: ayna silmeleri ve yetersiz disk alanı kopyalama başlamadan gösterilir.
$preflightWarnings = New-Object System.Collections.Generic.List[string]
$mirrorPlans = @($plans | Where-Object {
    (Get-SamePathCopyOptionValue -Options $_.Options -Name 'Mirror') -and
    -not (Get-SamePathCopyOptionValue -Options $_.Options -Name 'DryRun') -and
    [bool]$_.IsDirectory
})
if ($mirrorPlans.Count -gt 0) {
    $headerText.Text = 'Ayna önizlemesi hazırlanıyor'
    $progressLabel.Text = 'robocopy /L ile hedefteki fazla dosyalar listeleniyor...'
    Invoke-SamePathCopyUiPump
    $mirrorEntry = New-SamePathCopyLogEntry -Title 'Ayna önizlemesi' -Detail 'Hedeflerde silinecek dosyalar hesaplanıyor' -Kind 'Info'
    $totalExtras = 0
    foreach ($mirrorPlan in $mirrorPlans) {
        $summary = Invoke-SamePathCopyListing -Plan $mirrorPlan -RetryCount 0 -WaitSeconds 0
        $totalExtras += [int]$summary.ExtraCount
        Add-SamePathCopyLogNote -Entry $mirrorEntry -Text ("{0}: {1} fazla öğe silinecek, {2} öğe güncellenecek" -f
            $mirrorPlan.Target.name, $summary.ExtraCount, $summary.ChangeCount)
        foreach ($extra in @($summary.Extras | Select-Object -First 5)) {
            Add-SamePathCopyLogNote -Entry $mirrorEntry -Text ("    silinecek: {0}" -f $extra) -Brush 'WarningBrush'
        }
        if ([int]$summary.ExtraCount -gt 5) {
            Add-SamePathCopyLogNote -Entry $mirrorEntry -Text ("    ... ve {0} öğe daha" -f ([int]$summary.ExtraCount - 5)) -Brush 'WarningBrush'
        }
        Write-SamePathCopyLog -Component 'Ayna' -Message ("{0}: {1} fazla, {2} değişecek | ilk örnekler: {3}" -f
            $mirrorPlan.Target.name, $summary.ExtraCount, $summary.ChangeCount, ((@($summary.Extras | Select-Object -First 3)) -join ' | '))
    }
    # Otomatik kapanma kipinde (test/otomasyon) onay penceresi açılmaz: kimse tıklayamaz, süreç kilitlenir.
    $autoConfirm = -not [string]::IsNullOrWhiteSpace($env:SAMEPATHCOPY_COPYWINDOW_AUTOCLOSE)
    if ($totalExtras -gt 0 -and $autoConfirm) {
        Write-SamePathCopyLog -Component 'Ayna' -Level 'WARN' -Message ("Otomatik kip: {0} silme onay istenmeden kabul edildi." -f $totalExtras)
    }
    if ($totalExtras -gt 0 -and -not $autoConfirm) {
        $mirrorNames = (@($mirrorPlans | ForEach-Object { [string]$_.Target.name } | Select-Object -Unique) -join ', ')
        $confirmed = Show-SamePathCopyConfirm -Title 'Ayna onayı' `
            -Message ("Ayna seçili hedeflerde toplam {0} dosya/klasör SİLİNECEK.`r`n`r`nHedefler: {1}`r`n`r`nAyrıntılı liste pencerede duruyor. Devam edilsin mi?" -f $totalExtras, $mirrorNames) `
            -ConfirmText 'Devam et' -CancelText 'Vazgeç' -Owner $window -IconPath $iconPath
        if (-not $confirmed) {
            Write-SamePathCopyLog -Component 'Ayna' -Level 'WARN' -Message ("Kullanıcı ayna onayını reddetti; {0} silme yapılmadı." -f $totalExtras)
            Set-SamePathCopyLogEntryState -Entry $mirrorEntry -Kind 'Skipped'
            Add-SamePathCopyLogNote -Entry $mirrorEntry -Text 'Vazgeçildi, hiçbir şey kopyalanmadı.'
            $headerText.Text = 'Vazgeçildi'
            $progressLabel.Text = 'Ayna onayı verilmedi'
            $cancelButton.IsEnabled = $false
            $closeButton.IsEnabled = $true
            if (-not [string]::IsNullOrWhiteSpace($env:SAMEPATHCOPY_COPYWINDOW_AUTOCLOSE)) { $window.Close() }
            while (-not $script:windowClosed) {
                Invoke-SamePathCopyUiPump
                Start-Sleep -Milliseconds 30
            }
            exit 0
        }
    }
    Set-SamePathCopyLogEntryState -Entry $mirrorEntry -Kind 'Info'
}

# Disk alanı: hedef paylaşımdaki boş alan kaynak boyutundan küçükse uyarı satırı eklenir (kopyalama engellenmez).
$sourceTotalSize = 0
foreach ($sourceItem in $sourceItems) {
    $itemSize = Get-SamePathCopySourceSize -Path $sourceItem.FullName
    if ($null -ne $itemSize) { $sourceTotalSize += [long]$itemSize }
}
if ($sourceTotalSize -gt 0) {
    foreach ($target in @($plans | Group-Object -Property { [string]$_.Target.id } | ForEach-Object { $_.Group[0].Target })) {
        $shareRoot = "\\{0}\{1}" -f [string]$target.address, ([string]$target.networkRoot).Trim('\').Split('\')[0]
        $freeSpace = Get-SamePathCopyFreeSpace -Path $shareRoot
        if ($null -eq $freeSpace) { continue }
        if ($freeSpace -lt $sourceTotalSize) {
            $preflightWarnings.Add(("{0}: paylaşımda {1} boş alan var, kaynak {2}" -f
                $target.name, (Format-SamePathCopySize -Bytes $freeSpace), (Format-SamePathCopySize -Bytes $sourceTotalSize)))
        }
    }
}
if ($preflightWarnings.Count -gt 0) {
    $spaceEntry = New-SamePathCopyLogEntry -Title 'Disk alanı uyarısı' -Detail 'Hedefte boş alan kaynak boyutundan küçük görünüyor' -Kind 'Skipped'
    foreach ($warning in $preflightWarnings) {
        Add-SamePathCopyLogNote -Entry $spaceEntry -Text $warning -Brush 'WarningBrush'
        Write-SamePathCopyLog -Component 'Kopyala' -Level 'WARN' -Message ("Disk alanı uyarısı: {0}" -f $warning)
    }
}

# Her plan için bir rapor satırı toplanır; kopyalama bitince CSV olarak yazılır.
$reportRows = New-Object System.Collections.Generic.List[object]

function Add-SamePathCopyReportRow {
    param(
        [Parameter(Mandatory = $true)]$Plan,
        [Parameter(Mandatory = $true)][string]$Result,
        [int]$ExitCode = 0,
        [string]$Note = '',
        [double]$Seconds = 0
    )

    $script:reportRows.Add([pscustomobject]@{
        Zaman = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        Hedef = [string]$Plan.Target.name
        HedefKimlik = [string]$Plan.Target.id
        Kaynak = [string]$Plan.SourceItem.FullName
        HedefYolu = [string]$Plan.Destination
        Parametreler = (@(Get-SamePathCopyActiveOptionNames -Options $Plan.Options) -join ',')
        Sonuc = $Result
        RobocopyKodu = $ExitCode
        SaniyeSuresi = [Math]::Round($Seconds, 1)
        Not = $Note
    })
}

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$successCount = 0
$failedCount = 0
$skippedCount = 0
$completed = 0

# Hedefler eşzamanlı işlenir: her hedef için sırayla kendi planları çalışır, hedefler arasında ise
# en fazla $parallelTargetLimit tanesi aynı anda ilerler. Aynı hedefe iki robocopy birden gönderilmez;
# böylece ayna gibi yıkıcı parametreler kendi içinde sıralı kalır.
# Sihirbaz dışı çağrılarda (Tümü, grup, tek hedef) da eşzamanlı kopyalama açık: varsayılan 4 hedef.
$parallelTargetLimit = [Math]::Max(1, [Math]::Min(16, (Get-SamePathCopyOptionNumber -Options $globalOptions -Name 'ParallelTargets' -Default 4)))
$targetQueues = New-Object System.Collections.Generic.Queue[object]
foreach ($targetGroup in @($plans | Group-Object -Property { [string]$_.Target.id })) {
    $targetQueues.Enqueue([pscustomobject]@{
        TargetId = [string]$targetGroup.Name
        Plans = @($targetGroup.Group)
        Index = 0
    })
}
Write-SamePathCopyLog -Component 'Kopyala' -Message ("Kopyalama başlıyor: {0} işlem, {1} hedef, eşzamanlı hedef sınırı {2}" -f
    $plans.Count, $targetQueues.Count, $parallelTargetLimit)

function Complete-SamePathCopyPlanStep {
    param([Parameter(Mandatory = $true)]$Worker)

    # Süreç bitti: sonucu panele ve günlüğe yazar, gerekiyorsa aynı plan için kopyalama adımını başlatır.
    # Dönen değer $true ise plan tamamlandı, $false ise aynı plan için yeni bir adım başladı.
    $plan = $Worker.Plan
    $entry = $Worker.Entry
    $result = Complete-SamePathCopyRobocopy -Run $Worker.Run
    $Worker.Run = $null

    if ($Worker.Stage -eq 'Backup') {
        if ([int]$result.ExitCode -le 7 -and -not $result.Cancelled) {
            Add-SamePathCopyLogNote -Entry $entry -Text ("Yedek: {0}" -f $plan.BackupPath)
            $removedBackups = @(Remove-SamePathCopyOldBackups -BackupRoot (Get-SamePathCopyBackupRoot -Address ([string]$plan.Target.address) -NetworkRoot ([string]$plan.Target.networkRoot)) -Keep ([int]$config.copy.backupKeep))
            if ($removedBackups.Count -gt 0) {
                Add-SamePathCopyLogNote -Entry $entry -Text ("Eski yedekler silindi ({0}): {1}" -f $removedBackups.Count, ($removedBackups -join ', '))
            }
            # Yedek tamam: asıl kopyalama başlar.
            $Worker.Stage = 'Copy'
            $Worker.Run = Start-SamePathCopyRobocopy -Source $plan.SourceItem.FullName -Destination $plan.Destination `
                -IsDirectory $plan.IsDirectory -RetryCount ([int]$config.copy.retryCount) -WaitSeconds ([int]$config.copy.waitSeconds) -Options $plan.Options
            return $false
        }
        if ($result.Cancelled) {
            Set-SamePathCopyLogEntryState -Entry $entry -Kind 'Skipped'
            Add-SamePathCopyLogNote -Entry $entry -Text 'İptal edildi'
            $script:skippedCount++
            return $true
        }
        Set-SamePathCopyLogEntryState -Entry $entry -Kind 'Error'
        Add-SamePathCopyLogNote -Entry $entry -Text ("Yedek alınamadı (robocopy: {0}). Kopyalama yapılmadı." -f $result.ExitCode) -Brush 'DangerBrush'
        Add-SamePathCopyReportRow -Plan $plan -Result 'hatalı' -ExitCode ([int]$result.ExitCode) -Note 'Yedek alınamadı'
        $script:failedCount++
        return $true
    }

    $elapsedSeconds = if ($Worker.PSObject.Properties['StartedAt']) { ([DateTime]::UtcNow - $Worker.StartedAt).TotalSeconds } else { 0 }
    if ($result.Cancelled) {
        Set-SamePathCopyLogEntryState -Entry $entry -Kind 'Skipped'
        Add-SamePathCopyLogNote -Entry $entry -Text 'İptal edildi'
        Add-SamePathCopyReportRow -Plan $plan -Result 'iptal' -ExitCode ([int]$result.ExitCode) -Seconds $elapsedSeconds
        $script:skippedCount++
        return $true
    }
    if ([int]$result.ExitCode -le 7) {
        Set-SamePathCopyLogEntryState -Entry $entry -Kind 'Success'
        # Deneme çalıştırmasında sonuç panelinde ne değişeceği de gösterilir.
        if (Get-SamePathCopyOptionValue -Options $plan.Options -Name 'DryRun') {
            $listing = Invoke-SamePathCopyListing -Plan $plan -RetryCount 0 -WaitSeconds 0
            Add-SamePathCopyLogNote -Entry $entry -Text ("Deneme: {0} öğe kopyalanacaktı, {1} öğe hedefte fazla" -f $listing.ChangeCount, $listing.ExtraCount)
            foreach ($change in @($listing.Changes | Select-Object -First 5)) {
                Add-SamePathCopyLogNote -Entry $entry -Text ("    {0}" -f $change)
            }
            if ([int]$listing.ChangeCount -gt 5) {
                Add-SamePathCopyLogNote -Entry $entry -Text ("    ... ve {0} öğe daha" -f ([int]$listing.ChangeCount - 5))
            }
        }
        Add-SamePathCopyReportRow -Plan $plan -Result 'başarılı' -ExitCode ([int]$result.ExitCode) -Seconds $elapsedSeconds
        $script:successCount++
        # Hedefin son planı da bittiyse kopyalama sonrası komut bir kez çalıştırılır.
        if (-not (Get-SamePathCopyOptionValue -Options $plan.Options -Name 'DryRun') -and
            ($Worker.Index + 1) -ge $Worker.Plans.Count) {
            Invoke-SamePathCopyPostCommand -Plan $plan -Entry $entry
        }
        return $true
    }
    Set-SamePathCopyLogEntryState -Entry $entry -Kind 'Error'
    Add-SamePathCopyLogNote -Entry $entry -Text ("robocopy hata kodu: {0}" -f $result.ExitCode) -Brush 'DangerBrush'
    Add-SamePathCopyReportRow -Plan $plan -Result 'hatalı' -ExitCode ([int]$result.ExitCode) -Seconds $elapsedSeconds -Note ([string]$result.Details -replace '\r?\n', ' | ')
    if (-not [string]::IsNullOrWhiteSpace([string]$result.Details)) {
        foreach ($detailLine in ([string]$result.Details -split "`r?`n")) {
            if (-not [string]::IsNullOrWhiteSpace($detailLine)) {
                Add-SamePathCopyLogNote -Entry $entry -Text $detailLine -Brush 'DangerBrush'
            }
        }
    }
    $script:failedCount++
    return $true
}

function Invoke-SamePathCopyPostCommand {
    param(
        [Parameter(Mandatory = $true)]$Plan,
        [Parameter(Mandatory = $true)]$Entry
    )

    # config.json'daki copy.postCommand, bir hedefe kopyalama başarıyla bittikten sonra bir kez çalıştırılır.
    # Örnek kullanım: karşı taraftaki simülatörü yeniden başlatan bir betiği/servisi tetiklemek.
    $template = [string]$config.copy.postCommand
    if ([string]::IsNullOrWhiteSpace($template)) { return }

    $command = Expand-SamePathCopyCommandTemplate -Template $template -Target $Plan.Target `
        -Destination ([string]$Plan.Destination) -Source ([string]$Plan.SourceItem.FullName)
    Add-SamePathCopyLogNote -Entry $Entry -Text ("Komut: {0}" -f $command)
    Write-SamePathCopyLog -Component 'Komut' -Message ("{0}: {1}" -f $Plan.Target.name, $command)
    try {
        $startInfo = New-Object System.Diagnostics.ProcessStartInfo
        $startInfo.FileName = Join-Path $env:SystemRoot 'System32\cmd.exe'
        $startInfo.Arguments = '/c ' + $command
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        $process = [System.Diagnostics.Process]::Start($startInfo)
        $timeoutMilliseconds = [int]$config.copy.postCommandTimeoutSeconds * 1000
        $deadline = [DateTime]::UtcNow.AddMilliseconds($timeoutMilliseconds)
        while (-not $process.HasExited) {
            Invoke-SamePathCopyUiPump
            Start-Sleep -Milliseconds 60
            if ([DateTime]::UtcNow -gt $deadline) {
                try { $process.Kill() } catch { }
                Add-SamePathCopyLogNote -Entry $Entry -Text ("Komut zaman aşımına uğradı ({0} sn)" -f $config.copy.postCommandTimeoutSeconds) -Brush 'DangerBrush'
                Write-SamePathCopyLog -Component 'Komut' -Level 'ERROR' -Message ("{0}: komut zaman aşımı" -f $Plan.Target.name)
                return
            }
        }
        $standardOutput = $process.StandardOutput.ReadToEnd()
        $standardError = $process.StandardError.ReadToEnd()
        $exitCode = $process.ExitCode
        if ($exitCode -eq 0) {
            Add-SamePathCopyLogNote -Entry $Entry -Text 'Komut tamamlandı (0)'
            Write-SamePathCopyLog -Component 'Komut' -Message ("{0}: komut 0 ile bitti" -f $Plan.Target.name)
        }
        else {
            Add-SamePathCopyLogNote -Entry $Entry -Text ("Komut {0} ile bitti" -f $exitCode) -Brush 'DangerBrush'
            Write-SamePathCopyLog -Component 'Komut' -Level 'ERROR' -Message ("{0}: komut {1} ile bitti | cikti: {2} | hata: {3}" -f
                $Plan.Target.name, $exitCode, ($standardOutput -replace '\r?\n', ' '), ($standardError -replace '\r?\n', ' '))
        }
    }
    catch {
        Add-SamePathCopyLogNote -Entry $Entry -Text ("Komut çalıştırılamadı: {0}" -f $_.Exception.Message) -Brush 'DangerBrush'
        Write-SamePathCopyLog -Component 'Komut' -Level 'ERROR' -Message ("{0}: komut çalıştırılamadı: {1}" -f $Plan.Target.name, $_.Exception.Message)
    }
}

function Start-SamePathCopyPlan {
    param([Parameter(Mandatory = $true)]$Worker)

    # Sıradaki planı başlatır: yedek isteniyorsa önce yedek adımı, yoksa doğrudan kopyalama.
    $plan = $Worker.Plans[$Worker.Index]
    $Worker.Plan = $plan
    $targetName = [string]$plan.Target.name
    $activeOptions = @(Get-SamePathCopyActiveOptionNames -Options $plan.Options)
    $optionText = if ($activeOptions.Count -gt 0) {
        "  [{0}]" -f ((@($activeOptions | ForEach-Object { Get-SamePathCopyOptionLabel -Name $_ })) -join ', ')
    }
    else { '' }
    $progressLabel.Text = "{0}{1}" -f $targetName, $optionText
    $Worker.Entry = New-SamePathCopyLogEntry -Title ("{0}{1}" -f $targetName, $optionText) `
        -Detail ("{0}  →  {1}" -f $plan.SourceItem.FullName, $plan.Destination) -Kind 'Running'
    $Worker | Add-Member -NotePropertyName StartedAt -NotePropertyValue ([DateTime]::UtcNow) -Force

    $wantsBackup = (Get-SamePathCopyOptionValue -Options $plan.Options -Name 'Backup') -and
        -not (Get-SamePathCopyOptionValue -Options $plan.Options -Name 'DryRun')
    if ($wantsBackup) {
        $backupRun = Start-SamePathCopyBackup -Destination $plan.Destination -BackupPath $plan.BackupPath `
            -IsDirectory $plan.IsDirectory -RetryCount ([int]$config.copy.retryCount) -WaitSeconds ([int]$config.copy.waitSeconds)
        if ($null -ne $backupRun) {
            $Worker.Stage = 'Backup'
            $Worker.Run = $backupRun
            return
        }
        Add-SamePathCopyLogNote -Entry $Worker.Entry -Text 'Yedek: hedefte önceki hâli yok, atlandı'
    }
    $Worker.Stage = 'Copy'
    $Worker.Run = Start-SamePathCopyRobocopy -Source $plan.SourceItem.FullName -Destination $plan.Destination `
        -IsDirectory $plan.IsDirectory -RetryCount ([int]$config.copy.retryCount) -WaitSeconds ([int]$config.copy.waitSeconds) -Options $plan.Options
}

$activeWorkers = New-Object System.Collections.Generic.List[object]
while ($targetQueues.Count -gt 0 -or $activeWorkers.Count -gt 0) {
    # Boş yuvalar yeni hedeflerle doldurulur.
    while (-not $script:cancelRequested -and $activeWorkers.Count -lt $parallelTargetLimit -and $targetQueues.Count -gt 0) {
        $worker = $targetQueues.Dequeue()
        $worker | Add-Member -NotePropertyName Stage -NotePropertyValue 'Idle' -Force
        $worker | Add-Member -NotePropertyName Run -NotePropertyValue $null -Force
        $worker | Add-Member -NotePropertyName Entry -NotePropertyValue $null -Force
        $worker | Add-Member -NotePropertyName Plan -NotePropertyValue $null -Force
        try {
            Start-SamePathCopyPlan -Worker $worker
            $activeWorkers.Add($worker)
        }
        catch {
            # Paylaşıma erişilemiyor gibi başlatma hataları o hedefin bütün planlarını düşürür.
            if ($null -eq $worker.Entry) {
                $worker.Entry = New-SamePathCopyLogEntry -Title ([string]$worker.Plans[0].Target.name) -Detail '' -Kind 'Error'
            }
            Set-SamePathCopyLogEntryState -Entry $worker.Entry -Kind 'Error'
            Add-SamePathCopyLogNote -Entry $worker.Entry -Text $_.Exception.Message -Brush 'DangerBrush'
            $remaining = $worker.Plans.Count - $worker.Index
            $failedCount += $remaining
            $completed += $remaining
        }
    }

    # İptal edildiyse çalışan robocopy süreçleri durdurulur, kuyrukta bekleyen hedefler atlanır.
    if ($script:cancelRequested) {
        foreach ($worker in $activeWorkers.ToArray()) {
            if ($null -ne $worker.Run -and -not $worker.Run.Killed) {
                $worker.Run.Killed = $true
                try { $worker.Run.Process.Kill() } catch { }
            }
        }
        while ($targetQueues.Count -gt 0) {
            $pending = $targetQueues.Dequeue()
            foreach ($pendingPlan in @($pending.Plans)) {
                [void](New-SamePathCopyLogEntry -Title ([string]$pendingPlan.Target.name) -Detail 'İptal edildi, kopyalanmadı' -Kind 'Skipped')
                $skippedCount++
                $completed++
            }
        }
    }

    # List[object] doğrudan @() ile diziye çevrilirken PowerShell 5.1 "Bağımsız değişken türleri eşleşmiyor"
    # hatası veriyor; ToArray() ile anlık görüntü alınır (döngü içinde listeden çıkarma da bunu gerektirir).
    foreach ($worker in $activeWorkers.ToArray()) {
        if ($null -eq $worker.Run) { continue }
        if (-not $worker.Run.Process.HasExited) { continue }

        $planFinished = Complete-SamePathCopyPlanStep -Worker $worker
        if (-not $planFinished) { continue }

        $completed++
        $copyProgress.Value = $completed
        $progressCountText.Text = "{0} / {1}" -f $completed, $plans.Count
        $worker.Index++
        if ($worker.Index -ge $worker.Plans.Count -or $script:cancelRequested) {
            [void]$activeWorkers.Remove($worker)
            continue
        }
        try {
            Start-SamePathCopyPlan -Worker $worker
        }
        catch {
            Set-SamePathCopyLogEntryState -Entry $worker.Entry -Kind 'Error'
            Add-SamePathCopyLogNote -Entry $worker.Entry -Text $_.Exception.Message -Brush 'DangerBrush'
            $remaining = $worker.Plans.Count - $worker.Index
            $failedCount += $remaining
            $completed += $remaining
            [void]$activeWorkers.Remove($worker)
        }
    }

    Invoke-SamePathCopyUiPump
    Start-Sleep -Milliseconds 60
}

$stopwatch.Stop()
$elapsedText = if ($stopwatch.Elapsed.TotalMinutes -ge 1) {
    "{0:0} dk {1:00} sn" -f [Math]::Floor($stopwatch.Elapsed.TotalMinutes), $stopwatch.Elapsed.Seconds
}
else {
    "{0:0.0} sn" -f $stopwatch.Elapsed.TotalSeconds
}

$headerText.Text = if ($failedCount -gt 0) { 'Tamamlandı — hatalar var' } elseif ($skippedCount -gt 0) { 'İptal edildi' } else { 'Tamamlandı' }
$progressLabel.Text = if ($failedCount -eq 0 -and $skippedCount -eq 0) { 'Bütün kopyalamalar başarılı' } else { 'Bitti' }
$summaryParts = @("$successCount başarılı")
if ($failedCount -gt 0) { $summaryParts += "$failedCount hatalı" }
if ($skippedCount -gt 0) { $summaryParts += "$skippedCount atlandı" }
$summaryParts += $elapsedText
$summaryText.Text = $summaryParts -join '  •  '
Write-SamePathCopyLog -Component 'Kopyala' -Level $(if ($failedCount -gt 0) { 'ERROR' } elseif ($skippedCount -gt 0) { 'WARN' } else { 'INFO' }) `
    -Message ("Bitti: {0} başarılı, {1} hatalı, {2} atlandı, süre {3}" -f $successCount, $failedCount, $skippedCount, $elapsedText)

# Rapor: çalıştırma başına CSV. Yazılabildiyse "Raporu aç" düğmesi etkinleşir.
$script:reportPath = Get-SamePathCopyReportPath -Stamp $backupStamp
if (-not [string]::IsNullOrWhiteSpace($script:reportPath) -and (Write-SamePathCopyReport -Path $script:reportPath -Rows $reportRows.ToArray())) {
    $openReportButton.IsEnabled = $true
    $openReportButton.ToolTip = $script:reportPath
    Write-SamePathCopyLog -Component 'Kopyala' -Message ("Rapor yazıldı: {0}" -f $script:reportPath)
}
else {
    $script:reportPath = ''
}

# Bildirim: uzun kopyalamada pencere arkada kalmış olabilir; bitişi bildirim balonu haber verir.
$notifyEnabled = if ($null -ne $globalOptions -and $globalOptions.PSObject.Properties['Notify']) { [bool]$globalOptions.Notify } else { $true }
if ($notifyEnabled -and [string]::IsNullOrWhiteSpace($env:SAMEPATHCOPY_COPYWINDOW_AUTOCLOSE)) {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $script:notifyIcon = New-Object System.Windows.Forms.NotifyIcon
        $script:notifyIcon.Icon = if (Test-Path -LiteralPath $iconPath -PathType Leaf) {
            New-Object System.Drawing.Icon($iconPath)
        }
        else {
            [System.Drawing.SystemIcons]::Information
        }
        $script:notifyIcon.Visible = $true
        $script:notifyIcon.BalloonTipTitle = "{0} — {1}" -f [string]$config.menuTitle, $headerText.Text
        $script:notifyIcon.BalloonTipText = $summaryText.Text
        $script:notifyIcon.BalloonTipIcon = $(if ($failedCount -gt 0) { 'Error' } elseif ($skippedCount -gt 0) { 'Warning' } else { 'Info' })
        $script:notifyIcon.ShowBalloonTip(6000)
    }
    catch {
        # Bildirim gösterilemezse kopyalama sonucu etkilenmez.
        $script:notifyIcon = $null
    }
}
$cancelButton.IsEnabled = $false
$closeButton.IsEnabled = $true
[void]$closeButton.Focus()

if (-not [string]::IsNullOrWhiteSpace($env:SAMEPATHCOPY_COPYWINDOW_AUTOCLOSE)) {
    $window.Close()
}

# Pencere kapanana kadar arayüz beslenmeye devam eder.
while (-not $script:windowClosed) {
    Invoke-SamePathCopyUiPump
    Start-Sleep -Milliseconds 30
}

if ($null -ne $script:notifyIcon) {
    $script:notifyIcon.Visible = $false
    $script:notifyIcon.Dispose()
}
