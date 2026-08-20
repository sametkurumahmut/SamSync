Set-StrictMode -Version 2.0

# Sihirbaz günlüğe yazar; dosya tek başına dot-source edildiğinde (testler, demo) günlük katmanı da yüklenir.
if (-not (Get-Command -Name 'Write-SamePathCopyLog' -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot 'SamePathCopy.Log.ps1')
}

# Sihirbaz ayarları config.json'a değil, bilgisayara özel bir duruma yazılır: config ortak (hatta salt okunur ağ)
# olabilir ve seçimler kullanıcıya göre değişir. SAMEPATHCOPY_WIZARD_STATE ortam değişkeni yolu değiştirir (testler kullanır).
function Get-SamePathCopyWizardStatePath {
    if (-not [string]::IsNullOrWhiteSpace($env:SAMEPATHCOPY_WIZARD_STATE)) {
        return [string]$env:SAMEPATHCOPY_WIZARD_STATE
    }
    $root = if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { $env:LOCALAPPDATA } else { [System.IO.Path]::GetTempPath() }
    return (Join-Path $root 'SamePathCopy\wizard-state.json')
}

function Get-SamePathCopyWizardOptionDefinitions {
    # Hedef başına parametreler: kolon başlığı, varsayılan ve açıklama tek yerde durur.
    # Yeni parametre eklemek için buraya bir satır yetiyor; kolon ve onay kutuları buradan üretilir.
    return @(
        [pscustomobject]@{ Name = 'Backup'; Key = 'backup'; Header = 'Yedek al'; Default = $false; Width = 92
            Description = 'Hedefte aynı yolda duran öğeyi, üzerine yazmadan önce _SamePathCopyYedek klasörüne kopyalar.' }
        [pscustomobject]@{ Name = 'OnlyNewer'; Key = 'onlyNewer'; Header = 'Yalnızca yeni'; Default = $false; Width = 112
            Description = 'Hedefteki dosya kaynaktan yeni ya da aynı yaştaysa dokunmaz (robocopy /XO).' }
        [pscustomobject]@{ Name = 'Mirror'; Key = 'mirror'; Header = 'Ayna'; Default = $false; Width = 92
            Description = 'Hedefi kaynağın aynası yapar: kaynakta olmayan dosyalar hedefte silinir (robocopy /MIR). Yalnızca klasör kopyalamada uygulanır.' }
    )
}

function Get-SamePathCopyWizardGlobalDefinitions {
    # Type: bool (onay kutusu), text (serbest metin), int (sayı). Yeni parametre eklemek için buraya bir satır yeter;
    # arayüz denetimi, saklama ve robocopy argümanı bu listeden türetilir.
    return @(
        [pscustomobject]@{ Name = 'DryRun'; Key = 'dryRun'; Type = 'bool'; Header = 'Deneme çalıştırması — hiçbir şey kopyalanmaz'; Default = $false
            Description = 'Ne kopyalanacağını hesaplar, hedefe yazmaz (robocopy /L). Yedek adımı da atlanır.' }
        [pscustomobject]@{ Name = 'FastCopy'; Key = 'fastCopy'; Type = 'bool'; Header = 'Hızlı kopyalama — çok iş parçacıklı'; Default = $false
            Description = 'robocopy /MT:8 kullanır. Yeniden başlatılabilir kip (/Z) bu durumda devre dışı kalır.' }
        [pscustomobject]@{ Name = 'ExcludeFiles'; Key = 'excludeFiles'; Type = 'text'; Header = 'Hariç dosyalar'; Default = ''
            Placeholder = '*.pdb;*.tmp;desktop.ini'
            Description = 'Noktalı virgülle ayrılmış dosya kalıpları kopyalanmaz (robocopy /XF).' }
        [pscustomobject]@{ Name = 'ExcludeDirectories'; Key = 'excludeDirectories'; Type = 'text'; Header = 'Hariç klasörler'; Default = ''
            Placeholder = '.git;Logs;Temp'
            Description = 'Noktalı virgülle ayrılmış klasör adları kopyalanmaz (robocopy /XD).' }
        [pscustomobject]@{ Name = 'Notify'; Key = 'notify'; Type = 'bool'; Header = 'Bitince bildirim göster'; Default = $true
            Description = 'Kopyalama bittiğinde görev çubuğunda bildirim balonu gösterir; pencere arkada kalsa da sonuç görülür.' }
        [pscustomobject]@{ Name = 'ParallelTargets'; Key = 'parallelTargets'; Type = 'int'; Header = 'Eşzamanlı hedef'; Default = 4
            Placeholder = '4'
            Description = 'Aynı anda kaç bilgisayara kopyalanacağı. 1 = sırayla. Aynı hedefe iki kopyalama birden gönderilmez.' }
        [pscustomobject]@{ Name = 'ThrottleMilliseconds'; Key = 'throttleMilliseconds'; Type = 'int'; Header = 'Paket arası bekleme (ms)'; Default = 0
            Placeholder = '0'
            Description = 'Ağı boğmamak için paketler arasına bekleme koyar (robocopy /IPG:n). 0 = sınırsız hız.' }
        [pscustomobject]@{ Name = 'RetryCount'; Key = 'retryCount'; Type = 'int'; Header = 'Yeniden deneme sayısı'; Default = -1
            Placeholder = 'config'
            Description = 'Başarısız kopyalamanın tekrar sayısı (robocopy /R:n). Boş ya da -1 ise config.json değeri kullanılır.' }
        [pscustomobject]@{ Name = 'WaitSeconds'; Key = 'waitSeconds'; Type = 'int'; Header = 'Denemeler arası bekleme (sn)'; Default = -1
            Placeholder = 'config'
            Description = 'Tekrarlar arasındaki bekleme (robocopy /W:n). Boş ya da -1 ise config.json değeri kullanılır.' }
    )
}

function Get-SamePathCopyWizardDefinitionType {
    param([Parameter(Mandatory = $true)]$Definition)

    if ($Definition.PSObject.Properties['Type'] -and -not [string]::IsNullOrWhiteSpace([string]$Definition.Type)) {
        return [string]$Definition.Type
    }
    return 'bool'
}

function Get-SamePathCopyStoredValue {
    param(
        $Container,
        [Parameter(Mandatory = $true)]$Definition
    )

    # Saklanan değer tipe göre okunur; eksik ya da bozuk değer varsayılana döner.
    $name = [string]$Definition.Key
    $type = Get-SamePathCopyWizardDefinitionType -Definition $Definition
    if ($type -eq 'bool') {
        return (Get-SamePathCopyStoredBoolean -Container $Container -Name $name -Default ([bool]$Definition.Default))
    }
    if ($null -eq $Container -or -not $Container.PSObject.Properties[$name] -or $null -eq $Container.$name) {
        return $Definition.Default
    }
    if ($type -eq 'int') {
        $parsed = 0
        if ([int]::TryParse([string]$Container.$name, [ref]$parsed)) { return $parsed }
        return $Definition.Default
    }
    return [string]$Container.$name
}

function Get-SamePathCopyStoredBoolean {
    param($Container, [Parameter(Mandatory = $true)][string]$Name, [Parameter(Mandatory = $true)][bool]$Default)

    if ($null -eq $Container -or -not $Container.PSObject.Properties[$Name]) { return $Default }
    $value = $Container.$Name
    if ($null -eq $value) { return $Default }
    return [bool]$value
}

function Read-SamePathCopyWizardState {
    $statePath = Get-SamePathCopyWizardStatePath
    if (Test-Path -LiteralPath $statePath -PathType Leaf) {
        try {
            $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($null -ne $state -and $state.PSObject.Properties['configs'] -and $null -ne $state.configs) { return $state }
        }
        catch {
            # Bozuk durum dosyasi kopyalamayi engellemez; varsayilanlarla devam edilir.
        }
    }
    return [pscustomobject]@{ version = 1; configs = [pscustomobject]@{} }
}

function Write-SamePathCopyWizardState {
    param([Parameter(Mandatory = $true)]$State)

    $statePath = Get-SamePathCopyWizardStatePath
    $stateDirectory = Split-Path -Parent $statePath
    if ($stateDirectory -and -not (Test-Path -LiteralPath $stateDirectory -PathType Container)) {
        [void](New-Item -ItemType Directory -Path $stateDirectory -Force)
    }
    $temporaryPath = "$statePath.tmp"
    ($State | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
    Move-Item -LiteralPath $temporaryPath -Destination $statePath -Force
}

function Get-SamePathCopyWizardConfigState {
    param(
        [Parameter(Mandatory = $true)]$State,
        [Parameter(Mandatory = $true)][string]$ConfigPath
    )

    $configKey = $ConfigPath.ToLowerInvariant()
    if ($State.configs.PSObject.Properties[$configKey]) { return $State.configs.$configKey }
    return $null
}

function ConvertFrom-SamePathCopyWizardStoredSettings {
    param(
        $Stored,
        [Parameter(Mandatory = $true)][object[]]$Targets
    )

    $storedTargets = if ($null -ne $Stored -and $Stored.PSObject.Properties['targets']) { $Stored.targets } else { $null }
    $storedGlobal = if ($null -ne $Stored -and $Stored.PSObject.Properties['global']) { $Stored.global } else { $null }

    $global = [pscustomobject]@{}
    foreach ($definition in Get-SamePathCopyWizardGlobalDefinitions) {
        $global | Add-Member -NotePropertyName $definition.Name -NotePropertyValue (Get-SamePathCopyStoredValue -Container $storedGlobal -Definition $definition)
    }

    # config.json'a sonradan eklenen bilgisayarlar varsayilan olarak secili gelir; silinenler durumdan duser.
    $targetSettings = @{}
    foreach ($target in $Targets) {
        $targetId = [string]$target.id
        $stored = if ($null -ne $storedTargets -and $storedTargets.PSObject.Properties[$targetId]) { $storedTargets.$targetId } else { $null }
        $entry = [pscustomobject]@{ Selected = (Get-SamePathCopyStoredBoolean -Container $stored -Name 'selected' -Default $true) }
        foreach ($definition in Get-SamePathCopyWizardOptionDefinitions) {
            $entry | Add-Member -NotePropertyName $definition.Name -NotePropertyValue (Get-SamePathCopyStoredBoolean -Container $stored -Name $definition.Key -Default $definition.Default)
        }
        $targetSettings[$targetId] = $entry
    }

    return [pscustomobject]@{ Global = $global; Targets = $targetSettings }
}

function ConvertTo-SamePathCopyWizardStoredSettings {
    param([Parameter(Mandatory = $true)]$Settings)

    $globalObject = [pscustomobject]@{}
    foreach ($definition in Get-SamePathCopyWizardGlobalDefinitions) {
        $value = $Settings.Global.($definition.Name)
        $globalObject | Add-Member -NotePropertyName $definition.Key -NotePropertyValue $(
            switch (Get-SamePathCopyWizardDefinitionType -Definition $definition) {
                'bool' { [bool]$value }
                'int' { [int]$value }
                default { [string]$value }
            })
    }

    $targetsObject = [pscustomobject]@{}
    foreach ($targetId in @($Settings.Targets.Keys | Sort-Object)) {
        $entry = $Settings.Targets[$targetId]
        $stored = [pscustomobject]@{ selected = [bool]$entry.Selected }
        foreach ($definition in Get-SamePathCopyWizardOptionDefinitions) {
            $stored | Add-Member -NotePropertyName $definition.Key -NotePropertyValue ([bool]$entry.($definition.Name))
        }
        $targetsObject | Add-Member -NotePropertyName $targetId -NotePropertyValue $stored
    }

    return [pscustomobject]@{ global = $globalObject; targets = $targetsObject }
}

function Get-SamePathCopyWizardSettings {
    param(
        [Parameter(Mandatory = $true)][string]$ConfigPath,
        [Parameter(Mandatory = $true)][object[]]$Targets
    )

    $stored = Get-SamePathCopyWizardConfigState -State (Read-SamePathCopyWizardState) -ConfigPath $ConfigPath
    return (ConvertFrom-SamePathCopyWizardStoredSettings -Stored $stored -Targets $Targets)
}

function Save-SamePathCopyWizardSettings {
    param(
        [Parameter(Mandatory = $true)][string]$ConfigPath,
        [Parameter(Mandatory = $true)]$Settings
    )

    $state = Read-SamePathCopyWizardState
    $configKey = $ConfigPath.ToLowerInvariant()
    $stored = ConvertTo-SamePathCopyWizardStoredSettings -Settings $Settings
    # Profiller son kullanilan ayarla ayni kayitta durur; ayar kaydetmek profilleri silmemeli.
    $existing = Get-SamePathCopyWizardConfigState -State $state -ConfigPath $ConfigPath
    if ($null -ne $existing -and $existing.PSObject.Properties['profiles']) {
        $stored | Add-Member -NotePropertyName 'profiles' -NotePropertyValue $existing.profiles
    }
    $state.configs | Add-Member -NotePropertyName $configKey -NotePropertyValue $stored -Force
    Write-SamePathCopyWizardState -State $state
}

function Test-SamePathCopyWizardProfileName {
    param([string]$Name)

    # Profil adi menu komutlarinda "profile:<ad>" hedef kimligi olarak gectigi icin node kimligiyle ayni karakterlerle sinirlidir.
    if ([string]::IsNullOrWhiteSpace($Name)) { return $false }
    return [System.Text.RegularExpressions.Regex]::IsMatch(
        $Name.Trim(), '^[A-Za-z0-9._-]+$', [System.Text.RegularExpressions.RegexOptions]::CultureInvariant)
}

function Get-SamePathCopyWizardProfileNames {
    param([Parameter(Mandatory = $true)][string]$ConfigPath)

    $stored = Get-SamePathCopyWizardConfigState -State (Read-SamePathCopyWizardState) -ConfigPath $ConfigPath
    if ($null -eq $stored -or -not $stored.PSObject.Properties['profiles'] -or $null -eq $stored.profiles) { return @() }
    return @($stored.profiles.PSObject.Properties | ForEach-Object { [string]$_.Name } | Sort-Object)
}

function Get-SamePathCopyWizardProfile {
    param(
        [Parameter(Mandatory = $true)][string]$ConfigPath,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][object[]]$Targets
    )

    $stored = Get-SamePathCopyWizardConfigState -State (Read-SamePathCopyWizardState) -ConfigPath $ConfigPath
    if ($null -eq $stored -or -not $stored.PSObject.Properties['profiles'] -or $null -eq $stored.profiles) { return $null }
    $match = @($stored.profiles.PSObject.Properties | Where-Object { $_.Name.Equals($Name, [System.StringComparison]::OrdinalIgnoreCase) })
    if ($match.Count -eq 0) { return $null }
    return (ConvertFrom-SamePathCopyWizardStoredSettings -Stored $match[0].Value -Targets $Targets)
}

function Save-SamePathCopyWizardProfile {
    param(
        [Parameter(Mandatory = $true)][string]$ConfigPath,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)]$Settings
    )

    if (-not (Test-SamePathCopyWizardProfileName -Name $Name)) {
        throw "Profil adi buyuk/kucuk Ingilizce harf, rakam, nokta, alt cizgi ve tire icerebilir: '$Name'"
    }

    $state = Read-SamePathCopyWizardState
    $configKey = $ConfigPath.ToLowerInvariant()
    $stored = Get-SamePathCopyWizardConfigState -State $state -ConfigPath $ConfigPath
    if ($null -eq $stored) {
        $stored = ConvertTo-SamePathCopyWizardStoredSettings -Settings $Settings
        $state.configs | Add-Member -NotePropertyName $configKey -NotePropertyValue $stored -Force
    }
    if (-not $stored.PSObject.Properties['profiles'] -or $null -eq $stored.profiles) {
        $stored | Add-Member -NotePropertyName 'profiles' -NotePropertyValue ([pscustomobject]@{}) -Force
    }
    # Ayni ad buyuk/kucuk harf farkiyla verilirse eski kayit degistirilir, ikinci bir profil olusmaz.
    $existingName = @($stored.profiles.PSObject.Properties | Where-Object { $_.Name.Equals($Name.Trim(), [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $_.Name })
    $profileName = if ($existingName.Count -gt 0) { [string]$existingName[0] } else { $Name.Trim() }
    $stored.profiles | Add-Member -NotePropertyName $profileName -NotePropertyValue (ConvertTo-SamePathCopyWizardStoredSettings -Settings $Settings) -Force
    Write-SamePathCopyWizardState -State $state
    return $profileName
}

function Remove-SamePathCopyWizardProfile {
    param(
        [Parameter(Mandatory = $true)][string]$ConfigPath,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $state = Read-SamePathCopyWizardState
    $stored = Get-SamePathCopyWizardConfigState -State $state -ConfigPath $ConfigPath
    if ($null -eq $stored -or -not $stored.PSObject.Properties['profiles'] -or $null -eq $stored.profiles) { return $false }
    $match = @($stored.profiles.PSObject.Properties | Where-Object { $_.Name.Equals($Name, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $_.Name })
    if ($match.Count -eq 0) { return $false }
    $stored.profiles.PSObject.Properties.Remove([string]$match[0])
    Write-SamePathCopyWizardState -State $state
    return $true
}

function Get-SamePathCopyWizardControlValue {
    param(
        [Parameter(Mandatory = $true)]$Definition,
        [Parameter(Mandatory = $true)]$Control
    )

    # Arayuzdeki denetimden tipe uygun deger okunur: bos sayi kutusu -1 (config degerini kullan) demektir.
    $type = Get-SamePathCopyWizardDefinitionType -Definition $Definition
    if ($type -eq 'bool') { return [bool]$Control.IsChecked }
    $text = [string]$Control.Text
    if ($type -eq 'int') {
        if ([string]::IsNullOrWhiteSpace($text)) { return [int]$Definition.Default }
        $parsed = 0
        if ([int]::TryParse($text.Trim(), [ref]$parsed)) { return $parsed }
        return [int]$Definition.Default
    }
    return $text.Trim()
}

function Set-SamePathCopyWizardColumnState {
    param(
        [object[]]$Rows,
        [Parameter(Mandatory = $true)][string]$Key,
        [Parameter(Mandatory = $true)][bool]$Value
    )

    # Kolon başlığındaki toplu seçim ikonlarının yaptığı iş; arayüzden ayrı sınanabilmesi için burada durur.
    # Filtre uygulanmışsa yalnızca görünen satırlar etkilenir: "Unit2 yaz, tümünü seç" böyle çalışır.
    foreach ($row in @($Rows)) {
        if ($row.PSObject.Properties['Visible'] -and -not [bool]$row.Visible) { continue }
        $row.Controls[$Key].IsChecked = $Value
    }
}

function Get-SamePathCopyWizardToggleState {
    param(
        [object[]]$Rows,
        [Parameter(Mandatory = $true)][string]$Key,
        [string]$Group
    )

    # Tek onay kutusunun üç durumu: hepsi işaretli ($true), hiçbiri ($false), karışık ($null).
    # Yalnızca görünen (filtreye uyan) satırlar sayılır; ilgili satır yoksa $false döner.
    $relevant = @(@($Rows) | Where-Object {
        (-not $_.PSObject.Properties['Visible'] -or [bool]$_.Visible) -and
        ([string]::IsNullOrWhiteSpace($Group) -or [string]$_.Group -eq $Group)
    })
    if ($relevant.Count -eq 0) { return $false }
    $checked = @($relevant | Where-Object { [bool]$_.Controls[$Key].IsChecked }).Count
    if ($checked -eq 0) { return $false }
    if ($checked -eq $relevant.Count) { return $true }
    return $null
}

function Set-SamePathCopyWizardRowsState {
    param(
        [object[]]$Rows,
        [Parameter(Mandatory = $true)][string]$Key,
        [Parameter(Mandatory = $true)][bool]$Value,
        [string]$Group
    )

    # Toplu onay kutusuna basıldığında uygulanan iş: filtre dışındaki ve gruba ait olmayan satırlara dokunulmaz.
    foreach ($row in @($Rows)) {
        if ($row.PSObject.Properties['Visible'] -and -not [bool]$row.Visible) { continue }
        if (-not [string]::IsNullOrWhiteSpace($Group) -and [string]$row.Group -ne $Group) { continue }
        $row.Controls[$Key].IsChecked = $Value
    }
}

function Test-SamePathCopyWizardRowMatch {
    param(
        [Parameter(Mandatory = $true)]$Row,
        [string]$Filter
    )

    # Filtre metni ad, grup ve node kimliğinde aranır; boş filtre bütün satırları gösterir.
    if ([string]::IsNullOrWhiteSpace($Filter)) { return $true }
    $needle = $Filter.Trim()
    foreach ($candidate in @([string]$Row.Name, [string]$Row.Group, [string]$Row.Id)) {
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and
            $candidate.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
            return $true
        }
    }
    return $false
}

function Set-SamePathCopyWizardRowFilter {
    param(
        [object[]]$Rows,
        [string]$Filter
    )

    # Gizlenen satırın seçim durumu korunur; yalnızca görünürlüğü ve satır yüksekliği değişir.
    $visibleCount = 0
    foreach ($row in @($Rows)) {
        $isVisible = Test-SamePathCopyWizardRowMatch -Row $row -Filter $Filter
        $row.Visible = $isVisible
        if ($isVisible) { $visibleCount++ }
        foreach ($element in @($row.Elements)) {
            $element.Visibility = $(if ($isVisible) { 'Visible' } else { 'Collapsed' })
        }
        if ($row.PSObject.Properties['RowDefinition'] -and $null -ne $row.RowDefinition) {
            $row.RowDefinition.Height = [System.Windows.GridLength]::new($(if ($isVisible) { 34 } else { 0 }))
        }
    }
    return $visibleCount
}

function Set-SamePathCopyWizardSelectionById {
    param(
        [object[]]$Rows,
        [string[]]$Ids
    )

    # Verilen kimlik kümesini tam olarak uygular: kümede olan hedef seçilir, olmayan bırakılır.
    # Profil yüklemek gibi bir "seçimi geri getir" işlemi olduğu için filtre durumuna bakılmaz.
    $idSet = @{}
    foreach ($id in @($Ids)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$id)) { $idSet[[string]$id] = $true }
    }
    $matched = 0
    foreach ($row in @($Rows)) {
        $isSelected = $idSet.ContainsKey([string]$row.Id)
        if ($isSelected) { $matched++ }
        $row.Controls['Selected'].IsChecked = $isSelected
    }
    return $matched
}

function Invoke-SamePathCopyWizardSelectionInvert {
    param([object[]]$Rows)

    # Seçimi ters çevirir; toplu işlemlerin geri kalanı gibi yalnızca görünen satırlara dokunur.
    foreach ($row in @($Rows)) {
        if (-not [bool]$row.Visible) { continue }
        $row.Controls['Selected'].IsChecked = -not [bool]$row.Controls['Selected'].IsChecked
    }
}

function Set-SamePathCopyWizardReachabilityState {
    param(
        [object[]]$Rows,
        [Parameter(Mandatory = $true)][hashtable]$Status,
        $Window
    )

    # Erişilemeyen hedefler kırmızı, erişilebilenler yeşil noktayla işaretlenir; yoklanmayanlar nötr kalır.
    foreach ($row in @($Rows)) {
        if (-not $Status.ContainsKey([string]$row.Id)) { continue }
        $entry = $Status[[string]$row.Id]
        $row.Reachable = [bool]$entry.Reachable
        if ($row.PSObject.Properties['ReachabilityDot'] -and $null -ne $row.ReachabilityDot -and $null -ne $Window) {
            $row.ReachabilityDot.Text = '●'
            $row.ReachabilityDot.Foreground = $Window.FindResource($(if ($row.Reachable) { 'SuccessBrush' } else { 'DangerBrush' }))
            $row.ReachabilityDot.ToolTip = if ($row.Reachable) {
                "{0}: SMB portu (445) yanıt veriyor" -f $entry.Address
            }
            else {
                "{0}: SMB portu (445) yanıt vermiyor. Bilgisayar kapalı, ağ dışı ya da paylaşım kapalı olabilir." -f $entry.Address
            }
        }
    }
}

function Get-SamePathCopyWizardBodyXaml {
    return @'
    <Grid Margin="20,18,20,18">
        <Grid.RowDefinitions>
            <RowDefinition Height="Auto" />
            <RowDefinition Height="Auto" />
            <RowDefinition Height="Auto" />
            <RowDefinition Height="*" />
            <RowDefinition Height="Auto" />
            <RowDefinition Height="Auto" />
        </Grid.RowDefinitions>

        <StackPanel>
            <TextBlock x:Name="HeaderText" Style="{StaticResource TitleText}" Text="Kopyalama sihirbazı" />
            <TextBlock x:Name="SourceText" Style="{StaticResource SubtitleText}" Margin="0,4,0,0" />
        </StackPanel>

        <StackPanel x:Name="ChipPanel" Grid.Row="1" Orientation="Horizontal" Margin="0,12,0,0">
            <Border x:Name="LastRunChip" Style="{StaticResource Chip}" Visibility="Collapsed">
                <TextBlock x:Name="LastRunText" Style="{StaticResource MutedText}" MaxWidth="320" />
            </Border>
        </StackPanel>

        <Grid Grid.Row="2" Margin="0,16,0,8">
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto" />
                <RowDefinition Height="Auto" />
            </Grid.RowDefinitions>
            <TextBlock Style="{StaticResource SectionText}" Text="Hedefler" VerticalAlignment="Center" />
            <StackPanel Orientation="Horizontal" HorizontalAlignment="Right" VerticalAlignment="Center">
                <TextBox x:Name="FilterBox" Style="{StaticResource SearchBox}" Width="200" Margin="0,0,10,0" />
                <Button x:Name="ProbeButton" Style="{StaticResource GhostButton}" Content="Erişimi sına" Margin="0,0,8,0" />
                <Button x:Name="SelectMenuButton" Style="{StaticResource GhostButton}" Content="Seç ⌄" Margin="0,0,10,0" />
                <TextBlock x:Name="SelectionCountText" Style="{StaticResource MutedText}" VerticalAlignment="Center" />
            </StackPanel>
            <StackPanel x:Name="GroupTogglePanel" Grid.Row="1" Orientation="Horizontal" Margin="0,8,0,0" />
            <StackPanel Grid.Row="1" Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,8,0,0">
                <TextBlock Style="{StaticResource MutedText}" Text="Profil:" VerticalAlignment="Center"
                           Margin="0,0,8,0" />
                <ComboBox x:Name="ProfileBox" Style="{StaticResource ModernComboBox}" Width="180" Margin="0,0,8,0" />
                <Button x:Name="SaveProfileButton" Style="{StaticResource GhostButton}" Content="Profili kaydet"
                        Margin="0,0,6,0" />
                <Button x:Name="DeleteProfileButton" Style="{StaticResource GhostButton}" Content="Sil" />
            </StackPanel>
        </Grid>

        <Border Grid.Row="3" Style="{StaticResource Card}" Padding="6">
            <ScrollViewer VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Disabled"
                          CanContentScroll="False" Padding="0,0,4,0">
                <Grid x:Name="TargetGrid">
                    <Grid.ColumnDefinitions>
                        <ColumnDefinition Width="64" />
                        <ColumnDefinition Width="*" MinWidth="180" />
                        <ColumnDefinition Width="104" />
                    </Grid.ColumnDefinitions>
                    <Grid.RowDefinitions>
                        <RowDefinition Height="24" />
                        <RowDefinition Height="26" />
                    </Grid.RowDefinitions>
                    <TextBlock Grid.Column="0" Style="{StaticResource ColumnHeaderText}" Text="Gönder"
                               HorizontalAlignment="Center" />
                    <TextBlock Grid.Column="1" Style="{StaticResource ColumnHeaderText}" Text="Bilgisayar" Margin="6,0,0,0" />
                    <TextBlock Grid.Column="2" Style="{StaticResource ColumnHeaderText}" Text="Grup" />
                </Grid>
            </ScrollViewer>
        </Border>

        <Border Grid.Row="4" Style="{StaticResource Card}" Margin="0,12,0,0" Padding="16,12,16,12">
            <StackPanel>
                <TextBlock Style="{StaticResource SectionText}" Text="Bütün hedefler için" Margin="0,0,0,8" />
                <StackPanel x:Name="GlobalOptionPanel" />
            </StackPanel>
        </Border>

        <Grid Grid.Row="5" Margin="0,16,0,0">
            <TextBlock x:Name="HintText" Style="{StaticResource MutedText}" VerticalAlignment="Center"
                       Text="Seçimler bu bilgisayarda saklanır; pencere bir dahaki açılışta aynı gelir." />
            <StackPanel Orientation="Horizontal" HorizontalAlignment="Right">
                <Button x:Name="CancelButton" Style="{StaticResource SecondaryButton}" Content="Vazgeç" Margin="0,0,10,0" />
                <Button x:Name="StartButton" Style="{StaticResource PrimaryButton}" Content="Kopyalamayı başlat" MinWidth="150" />
            </StackPanel>
        </Grid>
    </Grid>
'@
}

function Show-SamePathCopyWizard {
    param(
        [Parameter(Mandatory = $true)]$Configuration,
        [Parameter(Mandatory = $true)][object[]]$Targets,
        [Parameter(Mandatory = $true)][object[]]$SourceItems,
        [Parameter(Mandatory = $true)]$Settings,
        [string]$ConfigPath,
        [string[]]$LocalRoots,
        [string]$IconPath
    )

    $optionDefinitions = @(Get-SamePathCopyWizardOptionDefinitions)
    $globalDefinitions = @(Get-SamePathCopyWizardGlobalDefinitions)

    $window = New-SamePathCopyWindow -Title ("{0} - Sihirbaz" -f [string]$Configuration.menuTitle) `
        -BodyXaml (Get-SamePathCopyWizardBodyXaml) -Width 940 -Height 660 -MinWidth 760 -MinHeight 520 -IconPath $IconPath

    # Başlık, seçimi tek satırda özetler; ayrıntı (hangi öğe, hangi kök, hedefte hangi göreli yol)
    # tıklanan çiplerin açılır listesinde durur. Seçim kalabalık olduğunda satır uzayıp kesilmez.
    $sourceSummary = Get-SamePathCopySourceSummary -SourceItems $SourceItems -LocalRoots $LocalRoots
    $sourceTextBlock = $window.FindName('SourceText')
    $sourceTextBlock.Text = [string]$sourceSummary.HeadlineText
    $sourceTextBlock.ToolTip = [string]$sourceSummary.ToolTipText
    $wizardChipPanel = $window.FindName('ChipPanel')
    # Çipler "son çalıştırma" çipinin önüne eklenir: sıra kaynak, yerel kök, son çalıştırma olur.
    $wizardChipPanel.Children.Insert(0, (New-SamePathCopySourceChip -Window $window -Summary $sourceSummary))
    $wizardChipPanel.Children.Insert(1, (New-SamePathCopyLocalRootChip -Window $window -Summary $sourceSummary))

    # Satırlar XAML'deki başlık ızgarasına eklenir; böylece başlık ve hücreler aynı kolon genişliklerini paylaşır.
    # Parametre kolonları tanımlardan üretilir: yeni bir parametre eklendiğinde kolon ve başlık kendiliğinden oluşur.
    $targetGrid = $window.FindName('TargetGrid')
    $firstOptionColumn = $targetGrid.ColumnDefinitions.Count
    foreach ($optionDefinition in $optionDefinitions) {
        $column = New-Object System.Windows.Controls.ColumnDefinition
        $column.Width = [System.Windows.GridLength]::new([double]$optionDefinition.Width)
        [void]$targetGrid.ColumnDefinitions.Add($column)

        $headerText = New-Object System.Windows.Controls.TextBlock
        $headerText.Style = $window.FindResource('ColumnHeaderText')
        $headerText.Text = [string]$optionDefinition.Header
        $headerText.HorizontalAlignment = 'Center'
        $headerText.ToolTip = [string]$optionDefinition.Description
        [System.Windows.Controls.Grid]::SetRow($headerText, 0)
        [System.Windows.Controls.Grid]::SetColumn($headerText, ($firstOptionColumn + $optionDefinitions.IndexOf($optionDefinition)))
        [void]$targetGrid.Children.Add($headerText)
    }
    # Olay işleyicileri betik kapsamındaki değişkenleri ve fonksiyonları görür. Kapanış (GetNewClosure)
    # kullanılmaz: kapanışlar ayrı bir modül kapsamına bağlanır ve betikte tanımlı fonksiyonlara erişemez.
    $script:wizardWindow = $window
    $script:wizardIconPath = $IconPath
    $script:wizardOptionDefinitions = $optionDefinitions
    $script:wizardSelectionCountText = $window.FindName('SelectionCountText')
    $script:wizardFilterBox = $window.FindName('FilterBox')
    $script:wizardFilterBox.Tag = 'Ada, gruba ya da kimliğe göre süz'
    $script:wizardTargets = $Targets
    $script:wizardReachabilityStatus = @{}
    $script:wizardRows = New-Object System.Collections.Generic.List[object]
    $rows = $script:wizardRows

    $updateSelectionCount = {
        $selected = @($script:wizardRows | Where-Object { [bool]$_.Controls['Selected'].IsChecked }).Count
        $text = "{0} / {1} seçili" -f $selected, $script:wizardRows.Count
        $hidden = @($script:wizardRows | Where-Object { -not [bool]$_.Visible }).Count
        if ($hidden -gt 0) { $text += "  •  filtre: {0} satır" -f ($script:wizardRows.Count - $hidden) }
        $script:wizardSelectionCountText.Text = $text
    }

    # Kolon başlığının altında o kolonun tamamını çeviren tek bir onay kutusu durur: hepsi işaretliyse
    # işaretli, hiçbiri değilse boş, karışıksa belirsiz görünür. Basıldığında hepsi işaretlenir ya da temizlenir.
    # Toplu kutular ve grup kutuları aynı listede tutulur; satır değiştiğinde hepsinin durumu yenilenir.
    $script:wizardBulkToggles = New-Object System.Collections.Generic.List[object]

    $script:wizardRefreshBulkToggles = {
        foreach ($toggle in $script:wizardBulkToggles) {
            $toggle.CheckBox.IsChecked = Get-SamePathCopyWizardToggleState -Rows $script:wizardRows -Key ([string]$toggle.Key) -Group ([string]$toggle.Group)
        }
    }

    $bulkToggleHandler = {
        param($sender, $eventArgs)
        $tag = $sender.Tag
        # Hedef değer satırlardan hesaplanır: hepsi işaretliyse temizle, değilse hepsini işaretle.
        $currentState = Get-SamePathCopyWizardToggleState -Rows $script:wizardRows -Key ([string]$tag.Key) -Group ([string]$tag.Group)
        Set-SamePathCopyWizardRowsState -Rows $script:wizardRows -Key ([string]$tag.Key) -Value (-not ($currentState -eq $true)) -Group ([string]$tag.Group)
        & $script:wizardRefreshBulkToggles
        & $script:wizardUpdateSelectionCount
    }

    $script:wizardUpdateSelectionCount = $updateSelectionCount
    $script:wizardProbeReachability = {
        $script:wizardReachabilityStatus = Test-SamePathCopyTargetReachability -Targets $script:wizardTargets
        Set-SamePathCopyWizardReachabilityState -Rows $script:wizardRows -Status $script:wizardReachabilityStatus -Window $script:wizardWindow
        $unreachable = @($script:wizardRows | Where-Object { $_.Reachable -eq $false }).Count
        Write-SamePathCopyLog -Component 'Sihirbaz' -Message ("Erişim yoklaması: {0} hedef, {1} erişilemez" -f $script:wizardRows.Count, $unreachable)
    }

    $addColumnToggle = {
        param([int]$Column, [string]$Key, [string]$Label)

        $toggleBox = New-Object System.Windows.Controls.CheckBox
        $toggleBox.Style = $script:wizardWindow.FindResource('ModernCheckBox')
        $toggleBox.IsThreeState = $true
        $toggleBox.HorizontalAlignment = 'Center'
        $toggleBox.VerticalAlignment = 'Center'
        $toggleBox.ToolTip = "Bütün hedeflerde '$Label' işaretini aç/kapat"
        $toggleBox.Tag = [pscustomobject]@{ Key = $Key; Group = '' }
        $toggleBox.Add_Click($bulkToggleHandler)
        [System.Windows.Controls.Grid]::SetRow($toggleBox, 1)
        [System.Windows.Controls.Grid]::SetColumn($toggleBox, $Column)
        [void]$targetGrid.Children.Add($toggleBox)
        $script:wizardBulkToggles.Add([pscustomobject]@{ Key = $Key; Group = ''; CheckBox = $toggleBox })
    }

    & $addColumnToggle 0 'Selected' 'Gönder'
    foreach ($optionDefinition in $optionDefinitions) {
        & $addColumnToggle ($firstOptionColumn + $optionDefinitions.IndexOf($optionDefinition)) ([string]$optionDefinition.Name) ([string]$optionDefinition.Header)
    }

    # Veri satırları iki başlık satırının (kolon adları ve toplu seçim ikonları) ardından başlar.
    $rowIndex = 2
    foreach ($target in $Targets) {
        $targetId = [string]$target.id
        $entry = $Settings.Targets[$targetId]
        $definition = New-Object System.Windows.Controls.RowDefinition
        $definition.Height = [System.Windows.GridLength]::new(34)
        [void]$targetGrid.RowDefinitions.Add($definition)

        $rowElements = New-Object System.Collections.Generic.List[object]
        $rowBorder = New-Object System.Windows.Controls.Border
        $rowBorder.Style = $window.FindResource('RowBorder')
        [System.Windows.Controls.Grid]::SetRow($rowBorder, $rowIndex)
        [System.Windows.Controls.Grid]::SetColumn($rowBorder, 0)
        [System.Windows.Controls.Grid]::SetColumnSpan($rowBorder, $targetGrid.ColumnDefinitions.Count)
        if ($rowIndex % 2 -eq 0) {
            $rowBorder.Background = $window.FindResource('SurfaceAltBrush')
        }
        [void]$targetGrid.Children.Add($rowBorder)
        [void]$rowElements.Add($rowBorder)

        $controls = @{}
        $selectedBox = New-Object System.Windows.Controls.CheckBox
        $selectedBox.Style = $window.FindResource('ModernCheckBox')
        $selectedBox.IsChecked = [bool]$entry.Selected
        $selectedBox.HorizontalAlignment = 'Center'
        $selectedBox.VerticalAlignment = 'Center'
        $rowStateChanged = {
            & $script:wizardUpdateSelectionCount
            & $script:wizardRefreshBulkToggles
        }
        $selectedBox.Add_Checked($rowStateChanged)
        $selectedBox.Add_Unchecked($rowStateChanged)
        [System.Windows.Controls.Grid]::SetRow($selectedBox, $rowIndex)
        [System.Windows.Controls.Grid]::SetColumn($selectedBox, 0)
        [void]$targetGrid.Children.Add($selectedBox)
        [void]$rowElements.Add($selectedBox)
        $controls['Selected'] = $selectedBox

        # Ad hücresi, erişilebilirlik noktası ile adı yan yana taşır; nokta yoklama sonucuna göre renklenir.
        $namePanel = New-Object System.Windows.Controls.StackPanel
        $namePanel.Orientation = 'Horizontal'
        $namePanel.Margin = New-Object System.Windows.Thickness(6, 0, 8, 0)
        $reachabilityDot = New-Object System.Windows.Controls.TextBlock
        $reachabilityDot.Style = $window.FindResource('MutedText')
        $reachabilityDot.Text = '○'
        $reachabilityDot.FontSize = 11
        $reachabilityDot.VerticalAlignment = 'Center'
        $reachabilityDot.Margin = New-Object System.Windows.Thickness(0, 0, 7, 0)
        $reachabilityDot.ToolTip = 'Erişim henüz sınanmadı'
        [void]$namePanel.Children.Add($reachabilityDot)
        $nameText = New-Object System.Windows.Controls.TextBlock
        $nameText.Style = $window.FindResource('BodyText')
        $nameText.Text = [string]$target.name
        $nameText.VerticalAlignment = 'Center'
        [void]$namePanel.Children.Add($nameText)
        [System.Windows.Controls.Grid]::SetRow($namePanel, $rowIndex)
        [System.Windows.Controls.Grid]::SetColumn($namePanel, 1)
        [void]$targetGrid.Children.Add($namePanel)
        [void]$rowElements.Add($namePanel)

        $groupName = if ($target.PSObject.Properties['group']) { [string]$target.group } else { '' }
        $groupText = New-Object System.Windows.Controls.TextBlock
        $groupText.Style = $window.FindResource('MutedText')
        $groupText.Text = $groupName
        [System.Windows.Controls.Grid]::SetRow($groupText, $rowIndex)
        [System.Windows.Controls.Grid]::SetColumn($groupText, 2)
        [void]$targetGrid.Children.Add($groupText)
        [void]$rowElements.Add($groupText)

        $optionColumn = $firstOptionColumn
        foreach ($optionDefinition in $optionDefinitions) {
            $optionBox = New-Object System.Windows.Controls.CheckBox
            $optionBox.Style = $window.FindResource('ModernCheckBox')
            $optionBox.IsChecked = [bool]$entry.($optionDefinition.Name)
            $optionBox.HorizontalAlignment = 'Center'
            $optionBox.VerticalAlignment = 'Center'
            $optionBox.ToolTip = [string]$optionDefinition.Description
            # Hedef başına parametre değişince kolon başlığındaki toplu kutu da güncellenir.
            $optionBox.Add_Checked($rowStateChanged)
            $optionBox.Add_Unchecked($rowStateChanged)
            [System.Windows.Controls.Grid]::SetRow($optionBox, $rowIndex)
            [System.Windows.Controls.Grid]::SetColumn($optionBox, $optionColumn)
            [void]$targetGrid.Children.Add($optionBox)
            [void]$rowElements.Add($optionBox)
            $controls[[string]$optionDefinition.Name] = $optionBox
            $optionColumn++
        }

        $rows.Add([pscustomobject]@{
            Id = $targetId
            Name = [string]$target.name
            Group = $groupName
            Controls = $controls
            Elements = $rowElements
            RowDefinition = $definition
            Visible = $true
            Reachable = $null
            ReachabilityDot = $reachabilityDot
        })
        $rowIndex++
    }
    & $updateSelectionCount

    # Filtre kutusu: her tuş vuruşunda satırlar süzülür, seçim durumları korunur.
    $script:wizardFilterBox.Add_TextChanged({
        [void](Set-SamePathCopyWizardRowFilter -Rows $script:wizardRows -Filter $script:wizardFilterBox.Text)
        & $script:wizardUpdateSelectionCount
        # Toplu kutular yalnızca görünen satırlara göre durum gösterir; filtre değişince yenilenir.
        & $script:wizardRefreshBulkToggles
    })

    # Grup başına toplu seçim: her grup için işaretle/temizle ikon çifti.
    $groupTogglePanel = $window.FindName('GroupTogglePanel')
    $groupNames = @($script:wizardRows | ForEach-Object { [string]$_.Group } | Where-Object { $_ } | Select-Object -Unique)
    if ($groupNames.Count -gt 0) {
        $groupLabel = New-Object System.Windows.Controls.TextBlock
        $groupLabel.Style = $window.FindResource('MutedText')
        $groupLabel.Text = 'Gruplar:'
        $groupLabel.VerticalAlignment = 'Center'
        $groupLabel.Margin = New-Object System.Windows.Thickness(0, 0, 8, 0)
        [void]$groupTogglePanel.Children.Add($groupLabel)
    }
    foreach ($groupName in $groupNames) {
        $groupChip = New-Object System.Windows.Controls.Border
        $groupChip.Style = $window.FindResource('Chip')
        $chipPanel = New-Object System.Windows.Controls.StackPanel
        $chipPanel.Orientation = 'Horizontal'
        $chipText = New-Object System.Windows.Controls.TextBlock
        $chipText.Style = $window.FindResource('MutedText')
        $chipText.Text = $groupName
        $chipText.VerticalAlignment = 'Center'
        $chipText.Margin = New-Object System.Windows.Thickness(0, 0, 7, 0)
        $groupToggleBox = New-Object System.Windows.Controls.CheckBox
        $groupToggleBox.Style = $window.FindResource('ModernCheckBox')
        $groupToggleBox.IsThreeState = $true
        $groupToggleBox.VerticalAlignment = 'Center'
        $groupToggleBox.ToolTip = "$groupName grubundaki bilgisayarların seçimini aç/kapat"
        $groupToggleBox.Tag = [pscustomobject]@{ Key = 'Selected'; Group = [string]$groupName }
        $groupToggleBox.Add_Click($bulkToggleHandler)
        # Onay kutusu adın solunda durur: tek tıkla grubun tamamı seçilir ya da bırakılır.
        [void]$chipPanel.Children.Add($groupToggleBox)
        [void]$chipPanel.Children.Add($chipText)
        $script:wizardBulkToggles.Add([pscustomobject]@{ Key = 'Selected'; Group = [string]$groupName; CheckBox = $groupToggleBox })
        $groupChip.Child = $chipPanel
        [void]$groupTogglePanel.Children.Add($groupChip)
    }

    # Erişim yoklaması: pencere açılırken bir kez, sonra düğmeyle yeniden çalıştırılabilir.
    $window.FindName('ProbeButton').Add_Click({ & $script:wizardProbeReachability })

    # "Seç" düğmesi, seçim yardımcılarını tek bir açılır listede toplar: erişilebilirler, son
    # çalıştırmada hata alanlar ve ters çevirme. Düğme başına yer harcamadan yenisi eklenebilir.
    $selectMenuButton = $window.FindName('SelectMenuButton')
    $selectPopup = New-Object System.Windows.Controls.Primitives.Popup
    $selectPopup.PlacementTarget = $selectMenuButton
    $selectPopup.Placement = 'Bottom'
    $selectPopup.StaysOpen = $false
    $selectPopup.AllowsTransparency = $true
    $selectPopup.VerticalOffset = 4
    $selectCard = New-Object System.Windows.Controls.Border
    $selectCard.Style = $window.FindResource('Card')
    $selectCard.Background = $window.FindResource('SurfaceBrush')
    $selectCard.Padding = New-Object System.Windows.Thickness(6, 6, 6, 6)
    $selectPanel = New-Object System.Windows.Controls.StackPanel
    $selectCard.Child = $selectPanel
    $selectPopup.Child = $selectCard
    $script:wizardSelectPopup = $selectPopup
    $selectMenuButton.Add_Click({ $script:wizardSelectPopup.IsOpen = -not [bool]$script:wizardSelectPopup.IsOpen })

    $addSelectAction = {
        param([string]$Label, [string]$Description, [scriptblock]$Handler)
        $actionButton = New-Object System.Windows.Controls.Button
        $actionButton.Style = $script:wizardWindow.FindResource('GhostButton')
        $actionButton.Content = $Label
        $actionButton.ToolTip = $Description
        $actionButton.HorizontalAlignment = 'Stretch'
        $actionButton.HorizontalContentAlignment = 'Left'
        $actionButton.Margin = New-Object System.Windows.Thickness(0, 1, 0, 1)
        $actionButton.Add_Click($Handler)
        [void]$selectPanel.Children.Add($actionButton)
    }

    & $addSelectAction 'Erişilebilirleri seç' 'Yalnızca erişim yoklamasına yanıt veren hedefleri işaretler (görünen satırlarda).' {
        $script:wizardSelectPopup.IsOpen = $false
        if ($script:wizardReachabilityStatus.Count -eq 0) { & $script:wizardProbeReachability }
        foreach ($row in $script:wizardRows) {
            if (-not [bool]$row.Visible) { continue }
            if ($null -eq $row.Reachable) { continue }
            $row.Controls['Selected'].IsChecked = [bool]$row.Reachable
        }
        & $script:wizardUpdateSelectionCount
    }
    & $addSelectAction 'Son çalıştırmada hatalıları seç' 'En son raporda hata alan hedefleri işaretler, diğerlerini bırakır; yarım kalan gönderim tamamlanır.' {
        $script:wizardSelectPopup.IsOpen = $false
        $recentReports = @(Get-SamePathCopyRecentReportSummaries -Limit 1)
        if ($recentReports.Count -eq 0) {
            [void](Show-SamePathCopyConfirm -Title 'Rapor yok' -Message 'Henüz bir kopyalama raporu yok; hangi hedeflerin hata aldığı bilinmiyor.' `
                -ConfirmText 'Tamam' -CancelText 'Kapat' -Owner $script:wizardWindow -IconPath $script:wizardIconPath)
            return
        }
        $failedIds = @($recentReports[0].FailedTargetIds)
        if ($failedIds.Count -eq 0) {
            [void](Show-SamePathCopyConfirm -Title 'Hata yok' -Message ("Son çalıştırmada ({0}) hata alan hedef yok." -f $recentReports[0].StampText) `
                -ConfirmText 'Tamam' -CancelText 'Kapat' -Owner $script:wizardWindow -IconPath $script:wizardIconPath)
            return
        }
        $matched = Set-SamePathCopyWizardSelectionById -Rows $script:wizardRows -Ids $failedIds
        & $script:wizardUpdateSelectionCount
        & $script:wizardRefreshBulkToggles
        Write-SamePathCopyLog -Component 'Sihirbaz' -Message ("Son raporun hatalı hedefleri seçildi: {0} ({1} satır eşleşti)." -f ($failedIds -join ', '), $matched)
    }
    & $addSelectAction 'Seçimi ters çevir' 'Görünen satırlarda seçiliyi bırakır, seçili olmayanı işaretler.' {
        $script:wizardSelectPopup.IsOpen = $false
        Invoke-SamePathCopyWizardSelectionInvert -Rows $script:wizardRows
        & $script:wizardUpdateSelectionCount
        & $script:wizardRefreshBulkToggles
    }

    # Profiller: adlandirilmis secim kumeleri. Secilince tabloya uygulanir, kaydet/sil aninda dosyaya yazar.
    $script:wizardConfigPath = $ConfigPath
    $script:wizardProfileBox = $window.FindName('ProfileBox')
    $script:wizardProfileSuppressChange = $false
    $script:wizardApplySettingsToRows = {
        param($AppliedSettings)
        foreach ($row in $script:wizardRows) {
            if (-not $AppliedSettings.Targets.ContainsKey([string]$row.Id)) { continue }
            $entry = $AppliedSettings.Targets[[string]$row.Id]
            $row.Controls['Selected'].IsChecked = [bool]$entry.Selected
            foreach ($optionDefinition in $script:wizardOptionDefinitions) {
                $row.Controls[[string]$optionDefinition.Name].IsChecked = [bool]$entry.($optionDefinition.Name)
            }
        }
        foreach ($globalDefinition in $script:wizardGlobalDefinitions) {
            $control = $script:wizardGlobalBoxes[[string]$globalDefinition.Name]
            $value = $AppliedSettings.Global.($globalDefinition.Name)
            if ((Get-SamePathCopyWizardDefinitionType -Definition $globalDefinition) -eq 'bool') {
                $control.IsChecked = [bool]$value
            }
            elseif ((Get-SamePathCopyWizardDefinitionType -Definition $globalDefinition) -eq 'int' -and [int]$value -lt 0) {
                $control.Text = ''
            }
            else {
                $control.Text = [string]$value
            }
        }
        & $script:wizardUpdateSelectionCount
    }
    $script:wizardCollectSettings = {
        $collectedTargets = @{}
        foreach ($row in $script:wizardRows) {
            $entry = [pscustomobject]@{ Selected = [bool]$row.Controls['Selected'].IsChecked }
            foreach ($optionDefinition in $script:wizardOptionDefinitions) {
                $entry | Add-Member -NotePropertyName ([string]$optionDefinition.Name) -NotePropertyValue ([bool]$row.Controls[[string]$optionDefinition.Name].IsChecked)
            }
            $collectedTargets[[string]$row.Id] = $entry
        }
        $collectedGlobal = [pscustomobject]@{}
        foreach ($globalDefinition in $script:wizardGlobalDefinitions) {
            $collectedGlobal | Add-Member -NotePropertyName ([string]$globalDefinition.Name) -NotePropertyValue (Get-SamePathCopyWizardControlValue -Definition $globalDefinition -Control $script:wizardGlobalBoxes[[string]$globalDefinition.Name])
        }
        return [pscustomobject]@{ Global = $collectedGlobal; Targets = $collectedTargets }
    }
    $script:wizardRefreshProfiles = {
        param([string]$SelectName)
        $script:wizardProfileSuppressChange = $true
        try {
            [void]$script:wizardProfileBox.Items.Clear()
            [void]$script:wizardProfileBox.Items.Add('(profil yok)')
            foreach ($name in @(Get-SamePathCopyWizardProfileNames -ConfigPath $script:wizardConfigPath)) {
                [void]$script:wizardProfileBox.Items.Add($name)
            }
            $script:wizardProfileBox.SelectedIndex = 0
            if (-not [string]::IsNullOrWhiteSpace($SelectName)) {
                $index = $script:wizardProfileBox.Items.IndexOf($SelectName)
                if ($index -ge 0) { $script:wizardProfileBox.SelectedIndex = $index }
            }
        }
        finally {
            $script:wizardProfileSuppressChange = $false
        }
    }
    if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
        # Config yolu verilmediyse (tek basina arayuz denemesi) profil denetimleri kapali kalir.
        $script:wizardProfileBox.IsEnabled = $false
        $window.FindName('SaveProfileButton').IsEnabled = $false
        $window.FindName('DeleteProfileButton').IsEnabled = $false
    }
    else {
        & $script:wizardRefreshProfiles ''
        $script:wizardProfileBox.Add_SelectionChanged({
            if ($script:wizardProfileSuppressChange) { return }
            if ($script:wizardProfileBox.SelectedIndex -le 0) { return }
            $selectedProfile = [string]$script:wizardProfileBox.SelectedItem
            $profileSettings = Get-SamePathCopyWizardProfile -ConfigPath $script:wizardConfigPath -Name $selectedProfile -Targets $script:wizardTargets
            if ($null -eq $profileSettings) { return }
            & $script:wizardApplySettingsToRows $profileSettings
            Write-SamePathCopyLog -Component 'Sihirbaz' -Message ("'{0}' profili tabloya uygulandi." -f $selectedProfile)
        })
        $window.FindName('SaveProfileButton').Add_Click({
            $suggested = if ($script:wizardProfileBox.SelectedIndex -gt 0) { [string]$script:wizardProfileBox.SelectedItem } else { '' }
            $name = Show-SamePathCopyPrompt -Title 'Profili kaydet' `
                -Message 'Bu secim ve parametreler bu adla saklanir. Ad menude ve klavye kisayolunda hedef olarak kullanilabilir (harf, rakam, nokta, alt cizgi, tire).' `
                -DefaultText $suggested -Placeholder 'Unit1IG' -ConfirmText 'Kaydet' -CancelText 'Vazgec' `
                -Owner $script:wizardWindow -IconPath $script:wizardIconPath
            if ([string]::IsNullOrWhiteSpace($name)) { return }
            if (-not (Test-SamePathCopyWizardProfileName -Name $name)) {
                [void](Show-SamePathCopyConfirm -Title 'Gecersiz profil adi' `
                    -Message "Profil adi yalnizca harf, rakam, nokta, alt cizgi ve tire icerebilir: '$name'" `
                    -ConfirmText 'Tamam' -CancelText 'Kapat' -Owner $script:wizardWindow -IconPath $script:wizardIconPath)
                return
            }
            $savedName = Save-SamePathCopyWizardProfile -ConfigPath $script:wizardConfigPath -Name $name -Settings (& $script:wizardCollectSettings)
            & $script:wizardRefreshProfiles $savedName
            Write-SamePathCopyLog -Component 'Sihirbaz' -Message ("'{0}' profili kaydedildi." -f $savedName)
        })
        $window.FindName('DeleteProfileButton').Add_Click({
            if ($script:wizardProfileBox.SelectedIndex -le 0) { return }
            $selectedProfile = [string]$script:wizardProfileBox.SelectedItem
            if (-not (Show-SamePathCopyConfirm -Title 'Profili sil' -Message "'$selectedProfile' profili silinecek. Menudeki girdisi de bir sonraki kurulumda kalkar." -ConfirmText 'Sil' -CancelText 'Vazgec' -Owner $script:wizardWindow -IconPath $script:wizardIconPath)) { return }
            [void](Remove-SamePathCopyWizardProfile -ConfigPath $script:wizardConfigPath -Name $selectedProfile)
            & $script:wizardRefreshProfiles ''
            Write-SamePathCopyLog -Component 'Sihirbaz' -Message ("'{0}' profili silindi." -f $selectedProfile)
        })
    }

    # Son çalıştırma özeti günlükten okunur; henüz kopyalama yapılmadıysa chip görünmez.
    $lastRun = Get-SamePathCopyLastRunSummary
    if ($null -ne $lastRun) {
        $window.FindName('LastRunText').Text = "Son gönderim: {0}" -f $lastRun.Text
        $window.FindName('LastRunChip').Visibility = 'Visible'
    }

    # Genel parametreler: mantiksal olanlar onay kutusu, metin/sayi olanlar etiketli kutu olarak cizilir.
    $globalPanel = $window.FindName('GlobalOptionPanel')
    $globalBoxes = @{}
    $globalValuePanel = New-Object System.Windows.Controls.WrapPanel
    $globalValuePanel.Orientation = 'Horizontal'
    $globalValuePanel.Margin = New-Object System.Windows.Thickness(0, 6, 0, 0)
    foreach ($globalDefinition in $globalDefinitions) {
        $definitionType = Get-SamePathCopyWizardDefinitionType -Definition $globalDefinition
        if ($definitionType -eq 'bool') {
            $globalBox = New-Object System.Windows.Controls.CheckBox
            $globalBox.Style = $window.FindResource('ModernCheckBox')
            $globalBox.Content = [string]$globalDefinition.Header
            $globalBox.IsChecked = [bool]$Settings.Global.($globalDefinition.Name)
            $globalBox.Margin = New-Object System.Windows.Thickness(0, 4, 0, 4)
            $globalBox.ToolTip = [string]$globalDefinition.Description
            [void]$globalPanel.Children.Add($globalBox)
            $globalBoxes[[string]$globalDefinition.Name] = $globalBox
            continue
        }

        $valueGroup = New-Object System.Windows.Controls.StackPanel
        $valueGroup.Orientation = 'Horizontal'
        $valueGroup.Margin = New-Object System.Windows.Thickness(0, 4, 18, 4)
        $valueLabel = New-Object System.Windows.Controls.TextBlock
        $valueLabel.Style = $window.FindResource('MutedText')
        $valueLabel.Text = [string]$globalDefinition.Header
        $valueLabel.ToolTip = [string]$globalDefinition.Description
        $valueLabel.Margin = New-Object System.Windows.Thickness(0, 0, 8, 0)
        [void]$valueGroup.Children.Add($valueLabel)
        $valueBox = New-Object System.Windows.Controls.TextBox
        $valueBox.Style = $window.FindResource('SearchBox')
        $valueBox.Width = $(if ($definitionType -eq 'int') { 70 } else { 200 })
        $valueBox.ToolTip = [string]$globalDefinition.Description
        if ($globalDefinition.PSObject.Properties['Placeholder']) { $valueBox.Tag = [string]$globalDefinition.Placeholder }
        $storedValue = $Settings.Global.($globalDefinition.Name)
        # -1 "config.json degerini kullan" anlamina gelir; kutuda bos gorunur.
        $valueBox.Text = $(if ($definitionType -eq 'int' -and [int]$storedValue -lt 0) { '' } else { [string]$storedValue })
        [void]$valueGroup.Children.Add($valueBox)
        [void]$globalValuePanel.Children.Add($valueGroup)
        $globalBoxes[[string]$globalDefinition.Name] = $valueBox
    }
    if ($globalValuePanel.Children.Count -gt 0) { [void]$globalPanel.Children.Add($globalValuePanel) }
    $script:wizardGlobalBoxes = $globalBoxes
    $script:wizardGlobalDefinitions = $globalDefinitions

    $window.FindName('CancelButton').Add_Click({ $script:wizardWindow.DialogResult = $false })
    $window.FindName('StartButton').Add_Click({
        $selectedRows = @($script:wizardRows | Where-Object { [bool]$_.Controls['Selected'].IsChecked })
        if ($selectedRows.Count -eq 0) {
            [void](Show-SamePathCopyConfirm -Title 'Hedef seçilmedi' -Message 'Kopyalamak için en az bir bilgisayar işaretlenmeli.' -ConfirmText 'Tamam' -CancelText 'Kapat' -Owner $script:wizardWindow -IconPath $script:wizardIconPath)
            return
        }
        # Ayna, hedefte kaynakta bulunmayan dosyaları sildiği için ayrıca onay ister.
        $mirrorRows = @($selectedRows | Where-Object { [bool]$_.Controls['Mirror'].IsChecked })
        if ($mirrorRows.Count -gt 0) {
            $mirrorNames = (@($mirrorRows | ForEach-Object { $_.Name }) -join ', ')
            $confirmed = Show-SamePathCopyConfirm -Title 'Ayna onayı' -Owner $script:wizardWindow -IconPath $script:wizardIconPath `
                -Message "Şu hedeflerde, kaynakta bulunmayan dosyalar silinecek:`r`n`r`n$mirrorNames" `
                -ConfirmText 'Sil ve kopyala' -CancelText 'Vazgeç'
            if (-not $confirmed) { return }
        }
        $script:wizardWindow.DialogResult = $true
    })

    # Arayüzün etkileşimsiz sınanabilmesi için: değer verilirse pencere o kadar milisaniye sonra kendini onaylayıp kapanır.
    if (-not [string]::IsNullOrWhiteSpace($env:SAMEPATHCOPY_WIZARD_AUTOCLOSE)) {
        $timer = New-Object System.Windows.Threading.DispatcherTimer
        $timer.Interval = [TimeSpan]::FromMilliseconds([Math]::Max(1, [int]$env:SAMEPATHCOPY_WIZARD_AUTOCLOSE))
        $script:wizardAutoCloseTimer = $timer
        $timer.Add_Tick({
            $script:wizardAutoCloseTimer.Stop()
            $script:wizardWindow.DialogResult = $true
        })
        $timer.Start()
    }

    # İlk erişim yoklaması pencere açılmadan yapılır: satırlar açılışta doğru renkle gelir.
    & $script:wizardProbeReachability

    $dialogResult = $window.ShowDialog()

    # Vazgeçilse bile tablodaki son hâl saklanır; pencere bir sonraki açılışta aynı gelir.
    $updatedTargets = @{}
    foreach ($row in $rows) {
        $entry = [pscustomobject]@{ Selected = [bool]$row.Controls['Selected'].IsChecked }
        foreach ($optionDefinition in $optionDefinitions) {
            $entry | Add-Member -NotePropertyName $optionDefinition.Name -NotePropertyValue ([bool]$row.Controls[[string]$optionDefinition.Name].IsChecked)
        }
        $updatedTargets[$row.Id] = $entry
    }
    $updatedGlobal = [pscustomobject]@{}
    foreach ($globalDefinition in $globalDefinitions) {
        $updatedGlobal | Add-Member -NotePropertyName $globalDefinition.Name -NotePropertyValue (Get-SamePathCopyWizardControlValue -Definition $globalDefinition -Control $globalBoxes[[string]$globalDefinition.Name])
    }

    return [pscustomobject]@{
        Confirmed = ($dialogResult -eq $true)
        Settings = [pscustomobject]@{ Global = $updatedGlobal; Targets = $updatedTargets }
    }
}
