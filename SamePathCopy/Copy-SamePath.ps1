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

trap {
    Write-SamePathCopyLog -Component 'Kopyala' -Level 'ERROR' -Message ("Hata: {0}" -f $_.Exception.Message)
    Write-SamePathCopyLog -Component 'Kopyala' -Level 'ERROR' -Message ("Konum: {0}" -f ([string]$_.InvocationInfo.PositionMessage -replace '\r?\n', ' '))
    # PlanOnly betikten/otomasyondan çağrılır: hata penceresi açıp beklemek yerine hatayı akışa yazıp çıkar.
    if ($PlanOnly) {
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

function Invoke-Robocopy {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][bool]$IsDirectory,
        [Parameter(Mandatory = $true)][int]$RetryCount,
        [Parameter(Mandatory = $true)][int]$WaitSeconds,
        $Options,
        $Window
    )

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
    $arguments = @(Get-SamePathCopyRobocopyArguments -SourceDirectory $sourceDirectory -DestinationDirectory $destinationDirectory -FileFilter $fileFilter -IsDirectory $IsDirectory -RetryCount $RetryCount -WaitSeconds $WaitSeconds -Options $Options -LogPath $logPath)
    try {
        $process = Start-Process -FilePath 'robocopy.exe' -ArgumentList ($arguments -join ' ') -WindowStyle Hidden -PassThru
        $cancelled = $false
        while (-not $process.WaitForExit(120)) {
            if ($Window) {
                # Pencerenin yanıt vermesini sağlar ve İptal düğmesinin işlenmesine izin verir.
                Invoke-SamePathCopyUiPump
            }
            if ($script:cancelRequested -and -not $cancelled) {
                $cancelled = $true
                try { $process.Kill() } catch { }
            }
        }
        $process.WaitForExit()

        $details = ''
        if (-not $cancelled -and $process.ExitCode -ge 8 -and (Test-Path -LiteralPath $logPath -PathType Leaf)) {
            $detailLines = @(Get-Content -LiteralPath $logPath -Encoding Unicode -ErrorAction SilentlyContinue |
                ForEach-Object { $_.Trim() } |
                Where-Object { $_ } |
                Select-Object -Last 12)
            $details = $detailLines -join "`r`n"
        }
        return [pscustomobject]@{
            ExitCode = [int]$process.ExitCode
            Details = $details
            Cancelled = $cancelled
        }
    }
    finally {
        if (Test-Path -LiteralPath $logPath -PathType Leaf) {
            Remove-Item -LiteralPath $logPath -Force -ErrorAction SilentlyContinue
        }
    }
}

function Invoke-SamePathCopyBackup {
    param(
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][string]$BackupPath,
        [Parameter(Mandatory = $true)][bool]$IsDirectory,
        [Parameter(Mandatory = $true)][int]$RetryCount,
        [Parameter(Mandatory = $true)][int]$WaitSeconds,
        $Window
    )

    # Yalnızca hedefte hâlihazırda var olan öğe yedeklenir; yeni gönderilen öğenin yedeklenecek bir önceki hâli yoktur.
    if (-not (Test-Path -LiteralPath $Destination)) {
        return [pscustomobject]@{ Performed = $false; ExitCode = 0; Details = ''; BackupPath = $BackupPath }
    }

    $result = Invoke-Robocopy -Source $Destination -Destination $BackupPath -IsDirectory $IsDirectory -RetryCount $RetryCount -WaitSeconds $WaitSeconds -Options $null -Window $Window
    return [pscustomobject]@{
        Performed = $true
        ExitCode = [int]$result.ExitCode
        Details = [string]$result.Details
        BackupPath = $BackupPath
    }
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
$cancelButton = $window.FindName('CancelButton')
$closeButton = $window.FindName('CloseButton')

$headerText.Text = 'Kopyalanıyor'
$sourceText.Text = if ($sourceItems.Count -eq 1) {
    [string]$sourceItems[0].FullName
}
else {
    "{0} öğe (ilk: {1})" -f $sourceItems.Count, $sourceItems[0].FullName
}
$sourceText.ToolTip = (@($sourceItems | ForEach-Object { $_.FullName }) -join "`r`n")
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
if ($isWizardLast) {
    Add-SamePathCopyChip -Text 'Son sihirbaz ayarı' -ToolTip 'Hedefler ve parametreler sihirbazda en son kaydedilen hâlden alındı; pencere açılmadı.'
}
if ($isProfile) {
    Add-SamePathCopyChip -Text ("Profil: {0}" -f $profileName) -ToolTip 'Hedefler ve parametreler bu profilden alindi; sihirbaz penceresi acilmadi.'
}
Add-SamePathCopyChip -Text ("Yerel kök: {0}" -f (@($localIdentity.Roots) -join '  •  ')) -ToolTip (@($localIdentity.Roots) -join "`r`n")
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
$script:windowClosed = $false
$window.Add_Closed({ $script:windowClosed = $true })

# Kopyalama döngüsü olay işleyicisi içinde değil, betik akışında çalışır: böylece buradaki yardımcı
# fonksiyonlar ve değişkenler doğrudan görünür. Pencere modelsiz açılıp döngü boyunca beslenir.
$window.Show()
[void]$window.Activate()
Invoke-SamePathCopyUiPump

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$successCount = 0
$failedCount = 0
$skippedCount = 0
$completed = 0

foreach ($plan in $plans) {
    $targetName = [string]$plan.Target.name
    if ($script:cancelRequested) {
        $skippedCount++
        [void](New-SamePathCopyLogEntry -Title $targetName -Detail 'İptal edildi, kopyalanmadı' -Kind 'Skipped')
        $completed++
        $copyProgress.Value = $completed
        $progressCountText.Text = "{0} / {1}" -f $completed, $plans.Count
        Invoke-SamePathCopyUiPump
        continue
    }

    $activeOptions = @(Get-SamePathCopyActiveOptionNames -Options $plan.Options)
    $optionText = if ($activeOptions.Count -gt 0) {
        "  [{0}]" -f ((@($activeOptions | ForEach-Object { Get-SamePathCopyOptionLabel -Name $_ })) -join ', ')
    }
    else { '' }
    $progressLabel.Text = "{0}{1}" -f $targetName, $optionText
    $entry = New-SamePathCopyLogEntry -Title ("{0}{1}" -f $targetName, $optionText) `
        -Detail ("{0}  →  {1}" -f $plan.SourceItem.FullName, $plan.Destination) -Kind 'Running'
    Invoke-SamePathCopyUiPump

    try {
        if ((Get-SamePathCopyOptionValue -Options $plan.Options -Name 'Backup') -and -not (Get-SamePathCopyOptionValue -Options $plan.Options -Name 'DryRun')) {
            $backupResult = Invoke-SamePathCopyBackup -Destination $plan.Destination -BackupPath $plan.BackupPath -IsDirectory $plan.IsDirectory -RetryCount ([int]$config.copy.retryCount) -WaitSeconds ([int]$config.copy.waitSeconds) -Window $window
            if (-not $backupResult.Performed) {
                Add-SamePathCopyLogNote -Entry $entry -Text 'Yedek: hedefte önceki hâli yok, atlandı'
            }
            elseif ([int]$backupResult.ExitCode -le 7) {
                Add-SamePathCopyLogNote -Entry $entry -Text ("Yedek: {0}" -f $backupResult.BackupPath)
            }
            else {
                throw "Yedek alınamadı (robocopy: $($backupResult.ExitCode)). Kopyalama yapılmadı: $($backupResult.BackupPath)"
            }
        }

        $copyResult = Invoke-Robocopy -Source $plan.SourceItem.FullName -Destination $plan.Destination -IsDirectory $plan.IsDirectory -RetryCount ([int]$config.copy.retryCount) -WaitSeconds ([int]$config.copy.waitSeconds) -Options $plan.Options -Window $window
        if ($copyResult.Cancelled) {
            $skippedCount++
            Set-SamePathCopyLogEntryState -Entry $entry -Kind 'Skipped'
            Add-SamePathCopyLogNote -Entry $entry -Text 'İptal edildi'
        }
        elseif ([int]$copyResult.ExitCode -le 7) {
            $successCount++
            Set-SamePathCopyLogEntryState -Entry $entry -Kind 'Success'
        }
        else {
            $failedCount++
            Set-SamePathCopyLogEntryState -Entry $entry -Kind 'Error'
            Add-SamePathCopyLogNote -Entry $entry -Text ("robocopy hata kodu: {0}" -f $copyResult.ExitCode) -Brush 'DangerBrush'
            if (-not [string]::IsNullOrWhiteSpace([string]$copyResult.Details)) {
                foreach ($detailLine in ([string]$copyResult.Details -split "`r?`n")) {
                    if (-not [string]::IsNullOrWhiteSpace($detailLine)) {
                        Add-SamePathCopyLogNote -Entry $entry -Text $detailLine -Brush 'DangerBrush'
                    }
                }
            }
        }
    }
    catch {
        $failedCount++
        Set-SamePathCopyLogEntryState -Entry $entry -Kind 'Error'
        Add-SamePathCopyLogNote -Entry $entry -Text $_.Exception.Message -Brush 'DangerBrush'
    }

    $completed++
    $copyProgress.Value = $completed
    $progressCountText.Text = "{0} / {1}" -f $completed, $plans.Count
    Invoke-SamePathCopyUiPump
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
