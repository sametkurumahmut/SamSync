Set-StrictMode -Version 2.0

# Sihirbaz günlüğe yazar; dosya tek başına dot-source edildiğinde (testler, demo) günlük katmanı da yüklenir.
if (-not (Get-Command -Name 'Write-SamePathCopyLog' -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot 'SamePathCopy.Log.ps1')
}
# Ayrıntı bölümündeki "Karşılaştır" düğmesi diff penceresini açıyor; katman burada yüklenir.
if (-not (Get-Command -Name 'Show-SamePathCopyDiff' -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot 'SamePathCopy.Diff.ps1')
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
        # Elements bir List[object]: @() ile diziye çevirmek "bağımsız değişken türleri eşleşmiyor"
        # hatası veriyor. Hata olay işleyicisinin içinde sessizce yutulduğu için filtre kutusu
        # satırları gizleyemiyordu; liste doğrudan dolaşılıyor.
        if ($null -ne $row.Elements) {
            foreach ($element in $row.Elements) {
                $element.Visibility = $(if ($isVisible) { 'Visible' } else { 'Collapsed' })
            }
        }
        if ($row.PSObject.Properties['RowDefinition'] -and $null -ne $row.RowDefinition) {
            $row.RowDefinition.Height = [System.Windows.GridLength]::new($(if ($isVisible) { 34 } else { 0 }))
        }
        # Açık duran ayrıntı bölümü de filtreye uyar: satır gizlenirse bölüm kapanır, geri gelirse açılır.
        if ($row.PSObject.Properties['DetailRowDefinition'] -and $null -ne $row.DetailRowDefinition) {
            $showDetail = $isVisible -and ($row.PSObject.Properties['Expanded'] -and [bool]$row.Expanded)
            $row.DetailRowDefinition.Height = $(if ($showDetail) { [System.Windows.GridLength]::Auto } else { [System.Windows.GridLength]::new(0) })
            if ($row.PSObject.Properties['DetailBorder'] -and $null -ne $row.DetailBorder) {
                $row.DetailBorder.Visibility = $(if ($showDetail) { 'Visible' } else { 'Collapsed' })
            }
        }
    }
    return $visibleCount
}

function Get-SamePathCopyWizardEffectiveSourceItems {
    param(
        $SourceItems,
        [hashtable]$ExcludedPaths
    )

    # Çipte işareti kaldırılan öğeler düşülür; anahtarlar küçük harfli tam yollardır.
    # Liste @() ile sarılmaz: List[object] üzerinde "bağımsız değişken türleri eşleşmiyor" hatası veriyor.
    $effective = New-Object System.Collections.Generic.List[object]
    foreach ($item in $SourceItems) {
        if ($null -eq $item) { continue }
        if ($null -ne $ExcludedPaths -and $ExcludedPaths.ContainsKey(([string]$item.FullName).ToLowerInvariant())) { continue }
        $effective.Add($item)
    }
    return $effective.ToArray()
}

function Add-SamePathCopyWizardSourcePaths {
    param(
        [Parameter(Mandatory = $true)]$SourceItems,
        [string[]]$Paths,
        [hashtable]$ExcludedPaths
    )

    # Pencereye bırakılan yolları kaynak listesine ekler: var olmayan ya da dosya sistemi dışındaki
    # yollar atlanır, zaten listede olan yol yinelenmez (dışlanmışsa işareti geri gelir).
    # Dönen sayı gerçekten eklenen öğe sayısıdır; işareti geri gelenler de sayılır ki liste tazelensin.
    $known = @{}
    foreach ($item in $SourceItems) {
        if ($null -ne $item) { $known[([string]$item.FullName).ToLowerInvariant()] = $true }
    }
    $changed = 0
    foreach ($path in @($Paths)) {
        if ([string]::IsNullOrWhiteSpace([string]$path)) { continue }
        $item = $null
        try { $item = Get-Item -LiteralPath ([string]$path) -Force -ErrorAction Stop } catch { continue }
        if ($item.PSProvider.Name -ne 'FileSystem') { continue }
        $key = ([string]$item.FullName).ToLowerInvariant()
        if ($known.ContainsKey($key)) {
            # Yinelenen yol eklenmez; ama dışlanmışsa bırakma "bunu da gönder" demektir, işareti geri gelir.
            if ($null -ne $ExcludedPaths -and $ExcludedPaths.ContainsKey($key)) {
                $ExcludedPaths.Remove($key)
                $changed++
            }
            continue
        }
        $known[$key] = $true
        [void]$SourceItems.Add($item)
        if ($null -ne $ExcludedPaths -and $ExcludedPaths.ContainsKey($key)) { $ExcludedPaths.Remove($key) }
        $changed++
    }
    return $changed
}

function Get-SamePathCopyWizardExclusionLimit {
    # Düşürülen yollar robocopy'ye /XF ve /XD ile tek komut satırında geçiyor; komut satırı sınırına
    # (~8191 karakter) çarpmamak için hedef başına toplam yol uzunluğu bu değerle sınırlanıyor.
    return 3000
}

function Get-SamePathCopyWizardTargetExclusion {
    param(
        [hashtable]$Exclusions,
        [Parameter(Mandatory = $true)][string]$TargetId
    )

    # Bir hedef için düşürülen yollar: dosyalar /XF, klasörler /XD listesine gidiyor.
    # Sıra kararlı olsun diye yollar sıralanır (günlük ve testler yinelenebilir olsun).
    $filePaths = New-Object System.Collections.Generic.List[string]
    $directoryPaths = New-Object System.Collections.Generic.List[string]
    if ($null -ne $Exclusions -and $Exclusions.ContainsKey($TargetId)) {
        foreach ($key in @($Exclusions[$TargetId].Keys | Sort-Object)) {
            $entry = $Exclusions[$TargetId][$key]
            if ([bool]$entry.IsDirectory) { $directoryPaths.Add([string]$entry.Path) }
            else { $filePaths.Add([string]$entry.Path) }
        }
    }
    # Uzunluk toplamı elle hesaplanır: boş listede Measure-Object hiçbir şey döndürmüyor ve
    # StrictMode altında ".Sum" okumak hata veriyor.
    $totalLength = 0
    foreach ($excludedPath in @(@($filePaths.ToArray()) + @($directoryPaths.ToArray()))) {
        $totalLength += ([string]$excludedPath).Length
    }
    return [pscustomobject]@{
        FilePaths = $filePaths.ToArray()
        DirectoryPaths = $directoryPaths.ToArray()
        Count = ($filePaths.Count + $directoryPaths.Count)
        Length = $totalLength
    }
}

function Test-SamePathCopyWizardExclusionCovered {
    param(
        [string[]]$DirectoryPaths,
        [Parameter(Mandatory = $true)][string]$Path
    )

    # Üst klasörü düşürülmüş bir satır zaten kopyalanmaz: tablo bunu gösterirken kutuyu kapatıyor.
    foreach ($directoryPath in @($DirectoryPaths)) {
        if ([string]::IsNullOrWhiteSpace($directoryPath)) { continue }
        $prefix = ([string]$directoryPath).TrimEnd('\') + '\'
        if ($Path.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    return $false
}

function Set-SamePathCopyWizardTargetExclusion {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Exclusions,
        [Parameter(Mandatory = $true)][string]$TargetId,
        [Parameter(Mandatory = $true)][string]$Path,
        [bool]$IsDirectory = $false,
        [bool]$Excluded = $true
    )

    # Hedef başına düşürülen yol kümesini günceller. Uzunluk sınırı aşılırsa yol eklenmez ve $false döner;
    # çağıran bunu kullanıcıya söyler. Anahtarlar küçük harfli yollardır.
    if (-not $Exclusions.ContainsKey($TargetId)) { $Exclusions[$TargetId] = @{} }
    $key = $Path.ToLowerInvariant()
    if (-not $Excluded) {
        if ($Exclusions[$TargetId].ContainsKey($key)) { $Exclusions[$TargetId].Remove($key) }
        return $true
    }
    if ($Exclusions[$TargetId].ContainsKey($key)) { return $true }
    $current = [int](Get-SamePathCopyWizardTargetExclusion -Exclusions $Exclusions -TargetId $TargetId).Length
    if (($current + $Path.Length) -gt (Get-SamePathCopyWizardExclusionLimit)) { return $false }
    $Exclusions[$TargetId][$key] = [pscustomobject]@{ Path = $Path; IsDirectory = $IsDirectory }
    return $true
}

function ConvertTo-SamePathCopyWizardExclusionMap {
    param([hashtable]$Exclusions)

    # Sihirbaz sonucuna giren biçim: hedef kimliği -> { FilePaths; DirectoryPaths }. Boş hedefler yazılmaz.
    $map = @{}
    if ($null -eq $Exclusions) { return $map }
    foreach ($targetId in @($Exclusions.Keys)) {
        $exclusion = Get-SamePathCopyWizardTargetExclusion -Exclusions $Exclusions -TargetId ([string]$targetId)
        if ([int]$exclusion.Count -eq 0) { continue }
        $map[[string]$targetId] = [pscustomobject]@{
            FilePaths = @($exclusion.FilePaths)
            DirectoryPaths = @($exclusion.DirectoryPaths)
        }
    }
    return $map
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

function Get-SamePathCopyWizardHistoryLineText {
    param([Parameter(Mandatory = $true)]$Summary)

    # Geçmiş listesindeki bir çalıştırmanın tek satırlık özeti; sıfır olan sayılar yazılmaz.
    $text = "{0}  •  {1} hedef  •  {2} başarılı" -f [string]$Summary.StampText, @($Summary.TargetIds).Count, [int]$Summary.SuccessCount
    if ([int]$Summary.FailedCount -gt 0) { $text += ", {0} hatalı" -f [int]$Summary.FailedCount }
    if ([int]$Summary.CancelledCount -gt 0) { $text += ", {0} iptal" -f [int]$Summary.CancelledCount }
    return $text
}

function New-SamePathCopyWizardHistoryPopup {
    param(
        [Parameter(Mandatory = $true)]$Window,
        [Parameter(Mandatory = $true)]$PlacementTarget,
        $Summaries,
        [scriptblock]$SelectHandler,
        [scriptblock]$OpenHandler
    )

    # Son çalıştırmaların listesi: her satırda özet, o çalıştırmanın hedef kümesini tabloya uygulayan
    # düğme ve CSV raporunu açan düğme. Liste her açılışta yeniden kurulur; rapor klasörü tazelenir.
    $popup = New-Object System.Windows.Controls.Primitives.Popup
    $popup.PlacementTarget = $PlacementTarget
    $popup.Placement = 'Bottom'
    $popup.StaysOpen = $false
    $popup.AllowsTransparency = $true
    $popup.VerticalOffset = 4

    $card = New-Object System.Windows.Controls.Border
    $card.Style = $Window.FindResource('Card')
    $card.Background = $Window.FindResource('SurfaceBrush')
    $card.Padding = New-Object System.Windows.Thickness(14, 12, 14, 12)
    $card.MinWidth = 420
    $card.MaxWidth = 720

    $layout = New-Object System.Windows.Controls.DockPanel
    $layout.LastChildFill = $true
    $titleText = New-Object System.Windows.Controls.TextBlock
    $titleText.Style = $Window.FindResource('SectionText')
    $titleText.Text = 'Son çalıştırmalar'
    $titleText.Margin = New-Object System.Windows.Thickness(0, 0, 0, 6)
    [System.Windows.Controls.DockPanel]::SetDock($titleText, 'Top')
    [void]$layout.Children.Add($titleText)

    $scroller = New-Object System.Windows.Controls.ScrollViewer
    $scroller.VerticalScrollBarVisibility = 'Auto'
    $scroller.HorizontalScrollBarVisibility = 'Disabled'
    $scroller.MaxHeight = 320
    $listPanel = New-Object System.Windows.Controls.StackPanel
    $scroller.Content = $listPanel
    [void]$layout.Children.Add($scroller)

    if (@($Summaries).Count -eq 0) {
        $emptyText = New-Object System.Windows.Controls.TextBlock
        $emptyText.Style = $Window.FindResource('MutedText')
        $emptyText.Text = 'Henüz rapor yok; ilk kopyalamadan sonra çalıştırmalar burada listelenir.'
        [void]$listPanel.Children.Add($emptyText)
    }

    foreach ($summary in @($Summaries)) {
        $rowPanel = New-Object System.Windows.Controls.DockPanel
        $rowPanel.LastChildFill = $true
        $rowPanel.Margin = New-Object System.Windows.Thickness(0, 3, 0, 3)

        # Düğmeler sağda durur; kalan genişlik özet metnine kalır.
        $buttonPanel = New-Object System.Windows.Controls.StackPanel
        $buttonPanel.Orientation = 'Horizontal'
        $buttonPanel.VerticalAlignment = 'Center'
        [System.Windows.Controls.DockPanel]::SetDock($buttonPanel, 'Right')

        $selectButton = New-Object System.Windows.Controls.Button
        $selectButton.Style = $Window.FindResource('GhostButton')
        $selectButton.Content = 'Hedefleri seç'
        $selectButton.ToolTip = 'Bu çalıştırmanın hedef kümesini tabloya uygular: o hedefler seçilir, diğerleri bırakılır.'
        $selectButton.Tag = $summary
        if ($null -ne $SelectHandler) { $selectButton.Add_Click($SelectHandler) }
        [void]$buttonPanel.Children.Add($selectButton)

        $openButton = New-Object System.Windows.Controls.Button
        $openButton.Style = $Window.FindResource('GhostButton')
        $openButton.Content = 'Raporu aç'
        $openButton.ToolTip = [string]$summary.Path
        $openButton.Tag = [string]$summary.Path
        if ($null -ne $OpenHandler) { $openButton.Add_Click($OpenHandler) }
        [void]$buttonPanel.Children.Add($openButton)
        [void]$rowPanel.Children.Add($buttonPanel)

        $infoPanel = New-Object System.Windows.Controls.StackPanel
        $lineText = New-Object System.Windows.Controls.TextBlock
        $lineText.Style = $Window.FindResource('BodyText')
        $lineText.Text = Get-SamePathCopyWizardHistoryLineText -Summary $summary
        [void]$infoPanel.Children.Add($lineText)
        $sourceText = New-Object System.Windows.Controls.TextBlock
        $sourceText.Style = $Window.FindResource('MutedText')
        $sourceText.MaxWidth = 380
        $sourceText.HorizontalAlignment = 'Left'
        $sourceText.Text = if ([int]$summary.SourceCount -gt 1) {
            "{0}  (+{1} kaynak)" -f [string]$summary.FirstSource, ([int]$summary.SourceCount - 1)
        }
        else {
            [string]$summary.FirstSource
        }
        $sourceText.ToolTip = [string]$summary.FirstSource
        [void]$infoPanel.Children.Add($sourceText)
        [void]$rowPanel.Children.Add($infoPanel)

        [void]$listPanel.Children.Add($rowPanel)
    }

    $card.Child = $layout
    $popup.Child = $card
    return $popup
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
            <Border x:Name="LastRunChip" Style="{StaticResource InteractiveChip}" Visibility="Collapsed"
                    ToolTip="Son çalıştırmaların listesi için tıklayın.">
                <StackPanel Orientation="Horizontal">
                    <TextBlock x:Name="LastRunText" Style="{StaticResource MutedText}" MaxWidth="320" />
                    <TextBlock Style="{StaticResource MutedText}" Text=" ⌄" Margin="4,0,0,0" />
                </StackPanel>
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
                <Button x:Name="InspectButton" Style="{StaticResource GhostButton}" Content="Hedefi incele" Margin="0,0,8,0"
                        ToolTip="Seçili hedeflerde robocopy /L çalıştırıp 'Hedefte' kolonunu doldurur: aynı / değişecek / yok / hedef daha yeni." />
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
                        <ColumnDefinition Width="*" MinWidth="150" />
                        <ColumnDefinition Width="96" />
                        <ColumnDefinition Width="112" />
                    </Grid.ColumnDefinitions>
                    <Grid.RowDefinitions>
                        <RowDefinition Height="24" />
                        <RowDefinition Height="26" />
                    </Grid.RowDefinitions>
                    <TextBlock Grid.Column="0" Style="{StaticResource ColumnHeaderText}" Text="Gönder"
                               HorizontalAlignment="Center" />
                    <TextBlock Grid.Column="1" Style="{StaticResource ColumnHeaderText}" Text="Bilgisayar" Margin="6,0,0,0"
                       ToolTip="Bilgisayar adına tıklamak, o makineye gidecek dosyaların tablosunu satırın altında açar." />
                    <TextBlock Grid.Column="2" Style="{StaticResource ColumnHeaderText}" Text="Grup" />
                    <TextBlock Grid.Column="3" Style="{StaticResource ColumnHeaderText}" Text="Hedefte"
                               ToolTip="Seçilen öğelerin bu hedefteki durumu. 'Hedefi incele' düğmesi doldurur; kopyalamadan önce neyin değişeceğini gösterir." />
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
        -BodyXaml (Get-SamePathCopyWizardBodyXaml) -Width 1040 -Height 780 -MinWidth 800 -MinHeight 560 -IconPath $IconPath

    # Başlık, seçimi tek satırda özetler; ayrıntı (hangi öğe, hangi kök, hedefte hangi göreli yol)
    # tıklanan çiplerin açılır listesinde durur. Kaynak listesi burada değişebilir: çipteki onay
    # kutusu öğeyi kopyalamadan düşürür, pencereye bırakılan dosya listeye eklenir. Sonuç nesnesi
    # kopyalamaya girecek son listeyi taşır.
    $script:wizardWindow = $window
    $script:wizardIconPath = $IconPath
    $script:wizardSourceItems = New-Object System.Collections.Generic.List[object]
    foreach ($sourceItem in @($SourceItems)) { if ($null -ne $sourceItem) { $script:wizardSourceItems.Add($sourceItem) } }
    $script:wizardExcludedSources = @{}
    $script:wizardLocalRoots = @($LocalRoots)
    # Satır listesi ve genel parametre denetimleri aşağıda dolduruluyor; ama kaynak çipleri kurulurken
    # çalışan işleyiciler bunlara bakıyor ve StrictMode atanmamış değişkeni hata sayıyor: burada boş kurulur.
    $script:wizardRows = New-Object System.Collections.Generic.List[object]
    $script:wizardGlobalBoxes = @{}
    $script:wizardGlobalDefinitions = @()
    $script:wizardHeadlineText = $window.FindName('SourceText')
    $script:wizardChipPanel = $window.FindName('ChipPanel')

    $script:wizardSourceToggleHandler = {
        param($sender, $eventArgs)
        $key = ([string]$sender.Tag).ToLowerInvariant()
        if ([bool]$sender.IsChecked) { $script:wizardExcludedSources.Remove($key) }
        else { $script:wizardExcludedSources[$key] = $true }
        # Açık duran liste yeniden kurulmaz (kapanırdı); başlık ve çip metinleri tazelenir.
        & $script:wizardRefreshSourceTexts
        & $script:wizardInvalidateDetails
    }

    # Çipler "son çalıştırma" çipinin önüne eklenir: sıra kaynak, yerel kök, son çalıştırma olur.
    $script:wizardRebuildSourceChips = {
        # Açık duran liste, çip ağaçtan çıkarılınca ekranda asılı kalır: Popup kendi penceresinde
        # çizildiği için görsel ağaçtan düşmek onu kapatmıyor. Kaldırılan her çipin listesi önce kapatılır.
        while ($script:wizardChipPanel.Children.Count -gt 1) {
            $removedChip = $script:wizardChipPanel.Children[0]
            if ($removedChip.Tag -is [System.Windows.Controls.Primitives.Popup]) { $removedChip.Tag.IsOpen = $false }
            $script:wizardChipPanel.Children.RemoveAt(0)
        }
        $effectiveItems = @(Get-SamePathCopyWizardEffectiveSourceItems -SourceItems $script:wizardSourceItems -ExcludedPaths $script:wizardExcludedSources)
        $summary = Get-SamePathCopySourceSummary -SourceItems $script:wizardSourceItems.ToArray() -LocalRoots $script:wizardLocalRoots
        $script:wizardSourceChip = New-SamePathCopySourceChip -Window $script:wizardWindow -Summary $summary `
            -Selectable -ToggleHandler $script:wizardSourceToggleHandler -ExcludedPaths $script:wizardExcludedSources
        $script:wizardChipPanel.Children.Insert(0, $script:wizardSourceChip)
        $script:wizardChipPanel.Children.Insert(1, (New-SamePathCopyLocalRootChip -Window $script:wizardWindow `
            -Summary (Get-SamePathCopySourceSummary -SourceItems $effectiveItems -LocalRoots $script:wizardLocalRoots)))
        & $script:wizardRefreshSourceTexts
        & $script:wizardInvalidateDetails
    }

    $script:wizardRefreshSourceTexts = {
        # Başlık ve çip metni etkin listeden hesaplanır; dışlanan öğe varsa çip "X / Y öğe" der.
        $effectiveItems = @(Get-SamePathCopyWizardEffectiveSourceItems -SourceItems $script:wizardSourceItems -ExcludedPaths $script:wizardExcludedSources)
        $effectiveSummary = Get-SamePathCopySourceSummary -SourceItems $effectiveItems -LocalRoots $script:wizardLocalRoots
        $script:wizardHeadlineText.Text = [string]$effectiveSummary.HeadlineText
        $script:wizardHeadlineText.ToolTip = $(if ([string]$effectiveSummary.ToolTipText) { [string]$effectiveSummary.ToolTipText } else { $null })
        $chipTextBlock = $script:wizardSourceChip.LabelTextBlock
        $chipTextBlock.Text = if ($effectiveItems.Count -ne $script:wizardSourceItems.Count) {
            "Kaynak: {0} / {1} öğe" -f $effectiveItems.Count, $script:wizardSourceItems.Count
        }
        else {
            [string]$effectiveSummary.ChipText
        }
    }

    $script:wizardInvalidateDetails = {
        # Kaynak listesi değiştiğinde açık ayrıntı tabloları eskir: liste silinmez ama "Yenile" denir,
        # böylece kullanıcı eski listeye bakıp yanlış karar vermez. Satır listesi henüz boşken de çalışır.
        foreach ($detailRow in $script:wizardRows) {
            if (-not [bool]$detailRow.DetailLoaded) { continue }
            $detailRow.DetailLoaded = $false
            if (-not [bool]$detailRow.Expanded) { continue }
            $detailRow.DetailSummaryText.Text = 'kaynak listesi değişti - Yenile ile güncelleyin'
            $detailRow.DetailSummaryText.Foreground = $script:wizardWindow.FindResource('WarningBrush')
        }
    }
    & $script:wizardRebuildSourceChips

    # Sürükle-bırak: pencereye bırakılan dosya/klasör kaynak listesine eklenir, çipler yeniden kurulur.
    $window.AllowDrop = $true
    $window.Add_PreviewDragOver({
        param($sender, $eventArgs)
        if ($eventArgs.Data.GetDataPresent([System.Windows.DataFormats]::FileDrop)) {
            $eventArgs.Effects = [System.Windows.DragDropEffects]::Copy
            $eventArgs.Handled = $true
        }
    })
    $window.Add_Drop({
        param($sender, $eventArgs)
        if (-not $eventArgs.Data.GetDataPresent([System.Windows.DataFormats]::FileDrop)) { return }
        $droppedPaths = @($eventArgs.Data.GetData([System.Windows.DataFormats]::FileDrop))
        $addedCount = Add-SamePathCopyWizardSourcePaths -SourceItems $script:wizardSourceItems `
            -Paths $droppedPaths -ExcludedPaths $script:wizardExcludedSources
        if ($addedCount -gt 0) {
            & $script:wizardRebuildSourceChips
            Write-SamePathCopyLog -Component 'Sihirbaz' -Message ("Sürükle-bırak: {0} öğe eklendi (toplam {1})." -f $addedCount, $script:wizardSourceItems.Count)
        }
    })

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
    # $script:wizardWindow ve $script:wizardIconPath başlık bölümünde atandı: oradaki çip işleyicileri
    # de bunları kullanıyor.
    $script:wizardOptionDefinitions = $optionDefinitions
    $script:wizardSelectionCountText = $window.FindName('SelectionCountText')
    $script:wizardFilterBox = $window.FindName('FilterBox')
    $script:wizardFilterBox.Tag = 'Ada, gruba ya da kimliğe göre süz'
    $script:wizardTargets = $Targets
    $script:wizardReachabilityStatus = @{}
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

    # --- Hedef ayrıntısı ---------------------------------------------------------------------------
    # Bilgisayar adına tıklanınca satırın altında o makineye gidecek dosyalar tek tek listelenir.
    # Liste robocopy /L ile hesaplanır; hedefe hiçbir şey yazılmaz. Satır başındaki onay kutusunun
    # işareti kaldırılan öğe YALNIZCA o makinede kopyalamaya girmez (robocopy'ye /XF ya da /XD olarak
    # geçer); seçim o çalıştırma içindir, kayıtlı ayarlara yazılmaz.
    $script:wizardTargetExclusions = @{}
    # Ayrıntı tablosunun kolon genişlikleri: sıfır olan kolon (dosya yolu) esner.
    $script:wizardDetailColumnWidths = @(46, 18, 0, 136, 76, 30)

    $script:wizardFindRowById = {
        param([string]$TargetId)
        foreach ($candidate in $script:wizardRows) {
            if ([string]$candidate.Id -eq $TargetId) { return $candidate }
        }
        return $null
    }

    $script:wizardFindTargetById = {
        param([string]$TargetId)
        foreach ($candidate in $script:wizardTargets) {
            if ([string]$candidate.id -eq $TargetId) { return $candidate }
        }
        return $null
    }

    $script:wizardGlobalValue = {
        param([string]$Name)
        # Genel parametre kutusundan o anki değeri okur; kutular henüz kurulmadıysa boş döner.
        if (-not $script:wizardGlobalBoxes.ContainsKey($Name)) { return '' }
        $matchingDefinitions = @($script:wizardGlobalDefinitions | Where-Object { [string]$_.Name -eq $Name })
        if ($matchingDefinitions.Count -eq 0) { return '' }
        return Get-SamePathCopyWizardControlValue -Definition $matchingDefinitions[0] -Control $script:wizardGlobalBoxes[$Name]
    }

    $script:wizardBuildDetailOptions = {
        param($Row)
        # Ayrıntı listelemesi kopyalamayla aynı süzgeçleri kullanmalı: hariç tutulan dosya/klasör
        # kalıpları ve "Yalnızca yeni" parametresi listeyi değiştiriyor. Ayna listelemeyi değiştirmiyor
        # (fazlalıklar her durumda listeleniyor), yalnızca satır metinlerinde kullanılıyor.
        return [pscustomobject]@{
            OnlyNewer = [bool]$Row.Controls['OnlyNewer'].IsChecked
            ExcludeFiles = [string](& $script:wizardGlobalValue 'ExcludeFiles')
            ExcludeDirectories = [string](& $script:wizardGlobalValue 'ExcludeDirectories')
        }
    }

    $script:wizardNewDetailGrid = {
        # Ayrıntı tablosunun her satırı aynı kolon genişliklerini kullanır: sabit genişlikler ve tek
        # esneyen kolon sayesinde satırlar tek bir Grid paylaşmadan hizalı görünür.
        $grid = New-Object System.Windows.Controls.Grid
        foreach ($width in $script:wizardDetailColumnWidths) {
            $column = New-Object System.Windows.Controls.ColumnDefinition
            $column.Width = $(if ([double]$width -eq 0) {
                [System.Windows.GridLength]::new(1, [System.Windows.GridUnitType]::Star)
            }
            else {
                [System.Windows.GridLength]::new([double]$width)
            })
            [void]$grid.ColumnDefinitions.Add($column)
        }
        return $grid
    }

    $script:wizardAddDetailCell = {
        param($Grid, [int]$Column, $Element)
        [System.Windows.Controls.Grid]::SetColumn($Element, $Column)
        [void]$Grid.Children.Add($Element)
    }

    $script:wizardSetDetailVisibility = {
        param($Row)
        $showDetail = [bool]$Row.Expanded -and [bool]$Row.Visible
        $Row.DetailRowDefinition.Height = $(if ($showDetail) { [System.Windows.GridLength]::Auto } else { [System.Windows.GridLength]::new(0) })
        $Row.DetailBorder.Visibility = $(if ($showDetail) { 'Visible' } else { 'Collapsed' })
        $Row.Chevron.Text = $(if ([bool]$Row.Expanded) { '⌄' } else { '›' })
    }

    $script:wizardSyncDetailChecks = {
        param([string]$TargetId)
        $row = & $script:wizardFindRowById $TargetId
        if ($null -eq $row -or $null -eq $row.FileRows) { return }
        $exclusion = Get-SamePathCopyWizardTargetExclusion -Exclusions $script:wizardTargetExclusions -TargetId $TargetId
        $excludedKeys = @{}
        foreach ($excludedPath in @(@($exclusion.FilePaths) + @($exclusion.DirectoryPaths))) {
            $excludedKeys[([string]$excludedPath).ToLowerInvariant()] = $true
        }
        $droppedCount = 0
        foreach ($fileRow in $row.FileRows) {
            $entryPath = [string]$fileRow.Entry.ExcludePath
            $isExcluded = $excludedKeys.ContainsKey($entryPath.ToLowerInvariant())
            # Üst klasörü düşürülmüş satır zaten kopyalanmaz: kutusu kapatılır ki tablo yanıltmasın.
            $isCovered = Test-SamePathCopyWizardExclusionCovered -DirectoryPaths $exclusion.DirectoryPaths -Path $entryPath
            $fileRow.CheckBox.IsChecked = -not ($isExcluded -or $isCovered)
            $fileRow.CheckBox.IsEnabled = -not $isCovered
            $fileRow.CheckBox.ToolTip = $(if ($isCovered) {
                'Üst klasörün işareti kaldırıldığı için bu öğe de gönderilmiyor.'
            }
            else {
                'İşareti kaldırılan öğe yalnızca bu makinede kopyalamaya girmez; öbür hedefler etkilenmez.'
            })
            if ($isExcluded -or $isCovered) { $droppedCount++ }
        }
        $totalCount = $row.FileRows.Count
        $row.DetailSelectionText.Text = $(if ($droppedCount -gt 0) {
            "{0} / {1} öğe gönderilecek  •  {2} öğe düşürüldü" -f ($totalCount - $droppedCount), $totalCount, $droppedCount
        }
        else {
            "{0} öğe gönderilecek" -f $totalCount
        })
        $row.DetailSelectionText.Foreground = $script:wizardWindow.FindResource($(if ($droppedCount -gt 0) { 'WarningBrush' } else { 'TextMutedBrush' }))
    }

    $script:wizardDetailFileToggleHandler = {
        param($sender, $eventArgs)
        $tag = $sender.Tag
        $applied = Set-SamePathCopyWizardTargetExclusion -Exclusions $script:wizardTargetExclusions -TargetId ([string]$tag.TargetId) `
            -Path ([string]$tag.Path) -IsDirectory ([bool]$tag.IsDirectory) -Excluded (-not [bool]$sender.IsChecked)
        if (-not $applied) {
            [void](Show-SamePathCopyConfirm -Title 'Düşürülen öğe sınırı' -Owner $script:wizardWindow -IconPath $script:wizardIconPath `
                -Message ("Bir makinede düşürülen yolların toplam uzunluğu {0} karakteri geçemiyor: robocopy komut satırına sığmıyor. Tek tek dosya yerine üst klasörü düşürün ya da 'Hariç dosyalar' kalıbını kullanın." -f (Get-SamePathCopyWizardExclusionLimit)) `
                -ConfirmText 'Tamam' -CancelText 'Kapat')
        }
        & $script:wizardSyncDetailChecks ([string]$tag.TargetId)
    }

    $script:wizardRenderDetail = {
        param([string]$TargetId)
        $row = & $script:wizardFindRowById $TargetId
        if ($null -eq $row) { return }
        $row.DetailPanel.Children.Clear()
        $row.FileRows = New-Object System.Collections.Generic.List[object]
        $diff = $row.DetailDiff
        if ($null -eq $diff) { return }

        $row.DetailSummaryText.Text = Get-SamePathCopyFileDiffSummaryText -Diff $diff
        $row.DetailSummaryText.Foreground = $script:wizardWindow.FindResource($(if ([bool]$diff.Failed) { 'WarningBrush' } else { 'TextMutedBrush' }))
        if (@($diff.Entries).Count -eq 0) {
            $emptyText = New-Object System.Windows.Controls.TextBlock
            $emptyText.Style = $script:wizardWindow.FindResource('MutedText')
            $emptyText.Text = $(if ([bool]$diff.Failed) {
                'Liste alınamadı: robocopy hedefi listeleyemedi (paylaşım yetkisi ya da ağ sorunu olabilir).'
            }
            else {
                'Bu makinede değişecek bir şey yok: hedef kaynakla aynı.'
            })
            $emptyText.Margin = New-Object System.Windows.Thickness(0, 4, 0, 2)
            [void]$row.DetailPanel.Children.Add($emptyText)
            $row.DetailSelectionText.Text = ''
            return
        }

        # Tablo başlığı: kolon adları satırların üstünde durur.
        $headerGrid = & $script:wizardNewDetailGrid
        $headerIndex = 0
        foreach ($headerText in @('Gönder', '', 'Dosya', 'Durum', 'Boyut', '')) {
            if (-not [string]::IsNullOrWhiteSpace($headerText)) {
                $headerBlock = New-Object System.Windows.Controls.TextBlock
                $headerBlock.Style = $script:wizardWindow.FindResource('ColumnHeaderText')
                $headerBlock.Text = $headerText
                if ($headerIndex -eq 0) { $headerBlock.HorizontalAlignment = 'Center' }
                if ($headerIndex -eq 4) { $headerBlock.HorizontalAlignment = 'Right' }
                & $script:wizardAddDetailCell $headerGrid $headerIndex $headerBlock
            }
            $headerIndex++
        }
        $headerGrid.Margin = New-Object System.Windows.Thickness(0, 6, 0, 2)
        [void]$row.DetailPanel.Children.Add($headerGrid)

        # Birden çok kaynak öğe varsa satırlar öğe başlıklarının altında toplanır.
        $showGroupHeaders = (@($diff.Groups).Count -gt 1)
        $currentHeader = $null
        $entryIndex = 0
        foreach ($entry in @($diff.Entries)) {
            if ($showGroupHeaders -and [string]$entry.ItemHeader -ne [string]$currentHeader) {
                $currentHeader = [string]$entry.ItemHeader
                $groupBlock = New-Object System.Windows.Controls.TextBlock
                $groupBlock.Style = $script:wizardWindow.FindResource('ColumnHeaderText')
                $groupBlock.Text = $currentHeader
                $groupBlock.ToolTip = [string]$entry.SourceItemPath
                $groupBlock.Margin = New-Object System.Windows.Thickness(30, $(if ($entryIndex -eq 0) { 4 } else { 10 }), 0, 2)
                [void]$row.DetailPanel.Children.Add($groupBlock)
            }

            $entryGrid = & $script:wizardNewDetailGrid
            $entryGrid.Margin = New-Object System.Windows.Thickness(0, 1, 0, 1)

            $entryBox = New-Object System.Windows.Controls.CheckBox
            $entryBox.Style = $script:wizardWindow.FindResource('ModernCheckBox')
            $entryBox.IsChecked = $true
            $entryBox.HorizontalAlignment = 'Center'
            $entryBox.VerticalAlignment = 'Center'
            $entryBox.Tag = [pscustomobject]@{ TargetId = $TargetId; Path = [string]$entry.ExcludePath; IsDirectory = [bool]$entry.IsDirectory }
            $entryBox.Add_Click($script:wizardDetailFileToggleHandler)
            & $script:wizardAddDetailCell $entryGrid 0 $entryBox

            # Durum işareti git'teki gibi okunur: + yeni, ~ güncellenecek, ! hedef daha yeni, - fazla.
            $signBlock = New-Object System.Windows.Controls.TextBlock
            $signBlock.Style = $script:wizardWindow.FindResource('MonoText')
            $signBlock.Text = [string]$entry.Sign
            $signBlock.FontWeight = 'Bold'
            $signBlock.HorizontalAlignment = 'Center'
            $signBlock.Foreground = $script:wizardWindow.FindResource([string]$entry.Brush)
            $signBlock.ToolTip = [string]$entry.ToolTip
            & $script:wizardAddDetailCell $entryGrid 1 $signBlock

            $pathBlock = New-Object System.Windows.Controls.TextBlock
            $pathBlock.Style = $script:wizardWindow.FindResource('BodyText')
            $pathBlock.Text = [string]$entry.DisplayPath
            $pathBlock.ToolTip = "{0}`r`n{1}" -f [string]$entry.SourcePath, [string]$entry.DestinationPath
            & $script:wizardAddDetailCell $entryGrid 2 $pathBlock

            $statusBlock = New-Object System.Windows.Controls.TextBlock
            $statusBlock.Style = $script:wizardWindow.FindResource('MutedText')
            $statusBlock.Text = [string]$entry.StatusText
            $statusBlock.Foreground = $script:wizardWindow.FindResource([string]$entry.Brush)
            $statusBlock.ToolTip = [string]$entry.ToolTip
            & $script:wizardAddDetailCell $entryGrid 3 $statusBlock

            $sizeBlock = New-Object System.Windows.Controls.TextBlock
            $sizeBlock.Style = $script:wizardWindow.FindResource('MutedText')
            $sizeBlock.Text = $(if ($null -ne $entry.Size) { Format-SamePathCopySize -Bytes ([long]$entry.Size) } else { '' })
            $sizeBlock.HorizontalAlignment = 'Right'
            & $script:wizardAddDetailCell $entryGrid 4 $sizeBlock

            if (-not [bool]$entry.IsDirectory) {
                # Dosya satırındaki düğme karşılaştırma penceresini o dosyada açar.
                $compareButton = New-Object System.Windows.Controls.Button
                $compareButton.Style = $script:wizardWindow.FindResource('IconButton')
                $compareButton.Content = '⇄'
                $compareButton.ToolTip = 'Bu dosyanın kaynak ile hedef arasındaki farkını ayrı pencerede göster.'
                $compareButton.Tag = [pscustomobject]@{ TargetId = $TargetId; Path = [string]$entry.ExcludePath }
                $compareButton.Add_Click($script:wizardDetailCompareHandler)
                & $script:wizardAddDetailCell $entryGrid 5 $compareButton
            }

            $row.FileRows.Add([pscustomobject]@{ Entry = $entry; CheckBox = $entryBox })
            [void]$row.DetailPanel.Children.Add($entryGrid)
            $entryIndex++
        }

        if ([bool]$diff.Truncated) {
            $truncatedBlock = New-Object System.Windows.Controls.TextBlock
            $truncatedBlock.Style = $script:wizardWindow.FindResource('MutedText')
            $truncatedBlock.Text = "... ve {0} öğe daha (liste bu kadarını gösteriyor; tek tek düşürmek için süzgeç kullanın)" -f [int]$diff.HiddenCount
            $truncatedBlock.Margin = New-Object System.Windows.Thickness(30, 4, 0, 2)
            [void]$row.DetailPanel.Children.Add($truncatedBlock)
        }
        & $script:wizardSyncDetailChecks $TargetId
    }

    $script:wizardLoadDetail = {
        param([string]$TargetId)
        $row = & $script:wizardFindRowById $TargetId
        if ($null -eq $row) { return }
        $row.DetailPanel.Children.Clear()
        $row.FileRows = New-Object System.Collections.Generic.List[object]
        $row.DetailSelectionText.Text = ''
        $row.DetailSummaryText.Text = 'hesaplanıyor...'
        $row.DetailSummaryText.Foreground = $script:wizardWindow.FindResource('TextMutedBrush')
        Invoke-SamePathCopyUiPump

        if ($script:wizardReachabilityStatus.Count -eq 0) { & $script:wizardProbeReachability }
        if ($row.Reachable -eq $false) {
            # Erişilemeyen hedefte robocopy'nin ağ zaman aşımı beklenmez.
            $row.DetailSummaryText.Text = 'erişilemedi: SMB portu yanıt vermiyor, liste alınamadı'
            $row.DetailSummaryText.Foreground = $script:wizardWindow.FindResource('DangerBrush')
            $row.DetailLoaded = $false
            return
        }

        $effectiveItems = @(Get-SamePathCopyWizardEffectiveSourceItems -SourceItems $script:wizardSourceItems -ExcludedPaths $script:wizardExcludedSources)
        $row.DetailDiff = Get-SamePathCopyTargetFileDiff -SourceItems $effectiveItems -LocalRoots $script:wizardLocalRoots `
            -Target (& $script:wizardFindTargetById $TargetId) -Options (& $script:wizardBuildDetailOptions $row) `
            -MirrorEnabled ([bool]$row.Controls['Mirror'].IsChecked) -PumpAction { Invoke-SamePathCopyUiPump }
        $row.DetailLoaded = $true
        & $script:wizardRenderDetail $TargetId
        # "Hedefte" kolonu, listeyi gören kullanıcı için de dolar: aynı sayılardan aynı rozet üretilir.
        $badge = Get-SamePathCopyInspectionText -Inspection (Get-SamePathCopyFileDiffInspection -Diff $row.DetailDiff)
        $row.InspectText.Text = [string]$badge.Text
        $row.InspectText.Foreground = $script:wizardWindow.FindResource([string]$badge.Brush)
        $row.InspectText.ToolTip = $(if ([string]$badge.ToolTip) { [string]$badge.ToolTip } else { $null })
        # Açılan kart tablo alanının altına düşebiliyor; görünür alana kaydırılır.
        $row.DetailBorder.BringIntoView()
        Write-SamePathCopyLog -Component 'Sihirbaz' -Message ("Ayrinti listesi [{0}]: {1} satir | yeni: {2}, guncellenecek: {3}, hedef daha yeni: {4}, fazla: {5}" -f
            $TargetId, @($row.DetailDiff.Entries).Count, $row.DetailDiff.NewCount, $row.DetailDiff.UpdateCount,
            $row.DetailDiff.OlderCount, $row.DetailDiff.ExtraCount)
    }

    $script:wizardToggleDetail = {
        param([string]$TargetId)
        $row = & $script:wizardFindRowById $TargetId
        if ($null -eq $row) { return }
        $row.Expanded = -not [bool]$row.Expanded
        & $script:wizardSetDetailVisibility $row
        if ([bool]$row.Expanded -and -not [bool]$row.DetailLoaded) { & $script:wizardLoadDetail $TargetId }
    }

    $script:wizardDetailToggleHandler = {
        param($sender, $eventArgs)
        & $script:wizardToggleDetail ([string]$sender.Tag)
    }

    $script:wizardDetailRefreshHandler = {
        param($sender, $eventArgs)
        & $script:wizardLoadDetail ([string]$sender.Tag)
    }

    $script:wizardDetailResetHandler = {
        param($sender, $eventArgs)
        # Bu makinede düşürülen bütün öğeler geri gelir.
        $targetId = [string]$sender.Tag
        if ($script:wizardTargetExclusions.ContainsKey($targetId)) { $script:wizardTargetExclusions[$targetId] = @{} }
        & $script:wizardSyncDetailChecks $targetId
    }

    $script:wizardDetailCompareHandler = {
        param($sender, $eventArgs)
        $tag = $sender.Tag
        $targetId = [string]$tag.TargetId
        $row = & $script:wizardFindRowById $targetId
        if ($null -eq $row) { return }
        if (-not [bool]$row.DetailLoaded -or $null -eq $row.DetailDiff) { & $script:wizardLoadDetail $targetId }
        if ($null -eq $row.DetailDiff) { return }
        Show-SamePathCopyDiff -Target (& $script:wizardFindTargetById $targetId) -Diff $row.DetailDiff `
            -SelectPath ([string]$tag.Path) -Owner $script:wizardWindow -IconPath $script:wizardIconPath
    }

    $script:wizardInvalidateRowDetail = {
        param($sender, $eventArgs)
        # Hedef başına parametre değişince o satırın listesi eskir: "Ayna" fazlalıkların silineceğini,
        # "Yalnızca yeni" hangi dosyaların atlanacağını değiştiriyor.
        $row = & $script:wizardFindRowById ([string]$sender.Tag)
        if ($null -eq $row -or -not [bool]$row.DetailLoaded) { return }
        $row.DetailLoaded = $false
        if (-not [bool]$row.Expanded) { return }
        $row.DetailSummaryText.Text = 'parametreler değişti - Yenile ile güncelleyin'
        $row.DetailSummaryText.Foreground = $script:wizardWindow.FindResource('WarningBrush')
    }

    # Veri satırları iki başlık satırının (kolon adları ve toplu seçim ikonları) ardından başlar.
    # Her hedef iki satır kullanır: veri satırı ve altındaki (kapalıyken yüksekliği sıfır) ayrıntı satırı.
    $rowIndex = 2
    $targetIndex = 0
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
        # Şeritli zemin hedef sırasına göre verilir: satır dizini artık iki adım artıyor.
        if ($targetIndex % 2 -eq 0) {
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
        # Hücrenin kendisi tıklanabilir: altındaki ayrıntı tablosunu açar/kapatır. Zemin Transparent
        # olmalı, aksi hâlde (null zemin) StackPanel fare olaylarını almıyor.
        $namePanel = New-Object System.Windows.Controls.StackPanel
        $namePanel.Orientation = 'Horizontal'
        $namePanel.Margin = New-Object System.Windows.Thickness(6, 0, 8, 0)
        $namePanel.Background = [System.Windows.Media.Brushes]::Transparent
        $namePanel.Cursor = 'Hand'
        $namePanel.Tag = $targetId
        $namePanel.ToolTip = 'Bu makineye gidecek dosyaları tek tek görmek için tıklayın.'
        $namePanel.Add_MouseLeftButtonUp($script:wizardDetailToggleHandler)
        $chevron = New-Object System.Windows.Controls.TextBlock
        $chevron.Style = $window.FindResource('MutedText')
        $chevron.Text = '›'
        $chevron.Width = 11
        $chevron.VerticalAlignment = 'Center'
        [void]$namePanel.Children.Add($chevron)
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

        # Hedef durumu rozeti: "Hedefi incele" doldurana kadar boş bir çizgi gösterir.
        $inspectText = New-Object System.Windows.Controls.TextBlock
        $inspectText.Style = $window.FindResource('MutedText')
        $inspectText.Text = '—'
        $inspectText.Margin = New-Object System.Windows.Thickness(0, 0, 8, 0)
        $inspectText.ToolTip = "Henüz incelenmedi. 'Hedefi incele' düğmesi bu hedefte neyin değişeceğini gösterir."
        [System.Windows.Controls.Grid]::SetRow($inspectText, $rowIndex)
        [System.Windows.Controls.Grid]::SetColumn($inspectText, 3)
        [void]$targetGrid.Children.Add($inspectText)
        [void]$rowElements.Add($inspectText)

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
            # Elle değiştirilen parametre açık ayrıntı listesini eskitir; Tag satırı bulmak için duruyor.
            $optionBox.Tag = $targetId
            $optionBox.Add_Click($script:wizardInvalidateRowDetail)
            [System.Windows.Controls.Grid]::SetRow($optionBox, $rowIndex)
            [System.Windows.Controls.Grid]::SetColumn($optionBox, $optionColumn)
            [void]$targetGrid.Children.Add($optionBox)
            [void]$rowElements.Add($optionBox)
            $controls[[string]$optionDefinition.Name] = $optionBox
            $optionColumn++
        }

        # Ayrıntı satırı: veri satırının altında, bütün kolonları kaplayan bir kart. Kapalıyken
        # yüksekliği sıfırdır; açıldığında Auto olur ve içeriği kadar yer kaplar.
        $detailDefinition = New-Object System.Windows.Controls.RowDefinition
        $detailDefinition.Height = [System.Windows.GridLength]::new(0)
        [void]$targetGrid.RowDefinitions.Add($detailDefinition)

        $detailBorder = New-Object System.Windows.Controls.Border
        $detailBorder.Style = $window.FindResource('Card')
        $detailBorder.Background = $window.FindResource('SurfaceAltBrush')
        $detailBorder.Margin = New-Object System.Windows.Thickness(6, 0, 6, 8)
        $detailBorder.Padding = New-Object System.Windows.Thickness(12, 6, 12, 10)
        $detailBorder.Visibility = 'Collapsed'
        [System.Windows.Controls.Grid]::SetRow($detailBorder, ($rowIndex + 1))
        [System.Windows.Controls.Grid]::SetColumn($detailBorder, 0)
        [System.Windows.Controls.Grid]::SetColumnSpan($detailBorder, $targetGrid.ColumnDefinitions.Count)
        [void]$targetGrid.Children.Add($detailBorder)

        $detailLayout = New-Object System.Windows.Controls.DockPanel
        $detailLayout.LastChildFill = $true
        $detailHeader = New-Object System.Windows.Controls.Grid
        $detailHeader.Margin = New-Object System.Windows.Thickness(0, 0, 0, 2)
        [System.Windows.Controls.DockPanel]::SetDock($detailHeader, 'Top')

        $detailTitlePanel = New-Object System.Windows.Controls.StackPanel
        $detailTitleText = New-Object System.Windows.Controls.TextBlock
        $detailTitleText.Style = $window.FindResource('SectionText')
        $detailTitleText.Text = "{0} - gönderilecek dosyalar" -f [string]$target.name
        $detailTitleText.ToolTip = "İşaretler: + hedefte yok (yeni)   ~ üzerine yazılacak   ! hedefteki dosya daha yeni   - hedefte fazla"
        [void]$detailTitlePanel.Children.Add($detailTitleText)
        $detailSummaryText = New-Object System.Windows.Controls.TextBlock
        $detailSummaryText.Style = $window.FindResource('MutedText')
        $detailSummaryText.Margin = New-Object System.Windows.Thickness(0, 2, 0, 0)
        [void]$detailTitlePanel.Children.Add($detailSummaryText)
        $detailSelectionText = New-Object System.Windows.Controls.TextBlock
        $detailSelectionText.Style = $window.FindResource('MutedText')
        [void]$detailTitlePanel.Children.Add($detailSelectionText)
        [void]$detailHeader.Children.Add($detailTitlePanel)

        $detailButtonPanel = New-Object System.Windows.Controls.StackPanel
        $detailButtonPanel.Orientation = 'Horizontal'
        $detailButtonPanel.HorizontalAlignment = 'Right'
        $detailButtonPanel.VerticalAlignment = 'Top'
        foreach ($detailAction in @(
            [pscustomobject]@{ Label = 'Yenile'; ToolTip = 'Listeyi robocopy /L ile yeniden hesaplar.'; Handler = $script:wizardDetailRefreshHandler }
            [pscustomobject]@{ Label = 'Düşürülenleri geri al'; ToolTip = 'Bu makinede işareti kaldırılan bütün öğeleri geri getirir.'; Handler = $script:wizardDetailResetHandler }
        )) {
            $detailButton = New-Object System.Windows.Controls.Button
            $detailButton.Style = $window.FindResource('GhostButton')
            $detailButton.Content = [string]$detailAction.Label
            $detailButton.ToolTip = [string]$detailAction.ToolTip
            $detailButton.Tag = $targetId
            $detailButton.Add_Click($detailAction.Handler)
            [void]$detailButtonPanel.Children.Add($detailButton)
        }
        $detailCompareButton = New-Object System.Windows.Controls.Button
        $detailCompareButton.Style = $window.FindResource('GhostButton')
        $detailCompareButton.Content = 'Karşılaştır ⇄'
        $detailCompareButton.ToolTip = 'Ayrı pencerede: bu makinedeki hâli ile gönderilecek hâli satır satır karşılaştırır.'
        $detailCompareButton.Tag = [pscustomobject]@{ TargetId = $targetId; Path = '' }
        $detailCompareButton.Add_Click($script:wizardDetailCompareHandler)
        [void]$detailButtonPanel.Children.Add($detailCompareButton)
        [void]$detailHeader.Children.Add($detailButtonPanel)
        [void]$detailLayout.Children.Add($detailHeader)

        $detailScroller = New-Object System.Windows.Controls.ScrollViewer
        $detailScroller.VerticalScrollBarVisibility = 'Auto'
        $detailScroller.HorizontalScrollBarVisibility = 'Disabled'
        $detailScroller.MaxHeight = 220
        $detailPanel = New-Object System.Windows.Controls.StackPanel
        $detailScroller.Content = $detailPanel
        [void]$detailLayout.Children.Add($detailScroller)
        $detailBorder.Child = $detailLayout

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
            InspectText = $inspectText
            # Ayrıntı bölümü: açık mı, listesi hesaplandı mı, hangi denetimleri taşıyor.
            Expanded = $false
            DetailLoaded = $false
            DetailRowDefinition = $detailDefinition
            DetailBorder = $detailBorder
            DetailPanel = $detailPanel
            DetailSummaryText = $detailSummaryText
            DetailSelectionText = $detailSelectionText
            DetailDiff = $null
            FileRows = $null
            Chevron = $chevron
        })
        $rowIndex += 2
        $targetIndex++
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

    # Toplu kutular (kolon başlıkları ve grup çipleri) satırlar kurulurken güncellenmiyor: satırın
    # onay kutusuna değer VERİLDİKTEN sonra işleyici bağlandığı için olay tetiklenmiyor, grup çipleri de
    # satırlardan sonra oluşuyor. Bu yüzden hepsi burada bir kez satırlardan hesaplanır; yoksa saklanmış
    # ayarla açılan pencerede bütün satırlar işaretliyken üstteki kutular boş görünüyordu.
    & $script:wizardRefreshBulkToggles

    # Erişim yoklaması: pencere açılırken bir kez, sonra düğmeyle yeniden çalıştırılabilir.
    $window.FindName('ProbeButton').Add_Click({ & $script:wizardProbeReachability })

    # Hedef inceleme: görünen ve seçili satırlarda robocopy /L çalıştırıp "Hedefte" rozetini doldurur.
    # Erişilemeyen hedef atlanır (robocopy'nin ağ zaman aşımı beklenmez); sonuçlar sırayla gelir.
    $script:wizardInspectButton = $window.FindName('InspectButton')
    $script:wizardInspectTargets = {
        if ($script:wizardReachabilityStatus.Count -eq 0) { & $script:wizardProbeReachability }
        $script:wizardInspectButton.IsEnabled = $false
        try {
            $inspectRows = @($script:wizardRows | Where-Object { [bool]$_.Visible -and [bool]$_.Controls['Selected'].IsChecked })
            if ($inspectRows.Count -eq 0) {
                [void](Show-SamePathCopyConfirm -Title 'Hedef seçilmedi' -Message 'İncelemek için en az bir hedef işaretlenmeli.' `
                    -ConfirmText 'Tamam' -CancelText 'Kapat' -Owner $script:wizardWindow -IconPath $script:wizardIconPath)
                return
            }
            foreach ($row in $inspectRows) {
                $row.InspectText.Text = 'inceleniyor...'
                $row.InspectText.Foreground = $script:wizardWindow.FindResource('TextMutedBrush')
                $row.InspectText.ToolTip = $null
            }
            Invoke-SamePathCopyUiPump
            foreach ($row in $inspectRows) {
                if ($row.Reachable -eq $false) {
                    $row.InspectText.Text = 'erişilemedi'
                    $row.InspectText.Foreground = $script:wizardWindow.FindResource('DangerBrush')
                    $row.InspectText.ToolTip = 'SMB portu yanıt vermiyor; hedef incelenemedi.'
                    continue
                }
                $target = @($script:wizardTargets | Where-Object { [string]$_.id -eq [string]$row.Id })[0]
                # İnceleme, çipte işareti kaldırılan öğeleri saymaz: rozet gerçekten kopyalanacak kümeyi anlatır.
                $inspection = Invoke-SamePathCopyTargetInspection `
                    -SourceItems @(Get-SamePathCopyWizardEffectiveSourceItems -SourceItems $script:wizardSourceItems -ExcludedPaths $script:wizardExcludedSources) `
                    -LocalRoots $script:wizardLocalRoots -Target $target -PumpAction { Invoke-SamePathCopyUiPump }
                $badge = Get-SamePathCopyInspectionText -Inspection $inspection
                $row.InspectText.Text = [string]$badge.Text
                $row.InspectText.Foreground = $script:wizardWindow.FindResource([string]$badge.Brush)
                $row.InspectText.ToolTip = $(if ([string]$badge.ToolTip) { [string]$badge.ToolTip } else { $null })
                Write-SamePathCopyLog -Component 'Sihirbaz' -Message ("Inceleme [{0}]: {1} | yok: {2}, degisecek: {3}, hedef daha yeni: {4}, fazla: {5}" -f
                    $row.Id, $badge.Text, $inspection.MissingCount, $inspection.ChangeCount, $inspection.OlderCount, $inspection.ExtraCount)
                Invoke-SamePathCopyUiPump
            }
        }
        finally {
            $script:wizardInspectButton.IsEnabled = $true
        }
    }
    $script:wizardInspectButton.Add_Click({ & $script:wizardInspectTargets })

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
        & $script:wizardRefreshBulkToggles
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
        # Profil bütün satırların seçimini ve parametrelerini değiştirir: toplu kutular da yenilenir.
        & $script:wizardRefreshBulkToggles
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

    # Son çalıştırma özeti günlükten okunur; çip tıklanınca CSV raporlarından geçmiş listesi açılır.
    # Hiç kopyalama yapılmadıysa (ne günlük özeti ne rapor) çip görünmez.
    $lastRun = Get-SamePathCopyLastRunSummary
    $script:wizardHistoryChip = $window.FindName('LastRunChip')
    $script:wizardHistoryPopup = $null
    if ($null -ne $lastRun -or @(Get-SamePathCopyRecentReportSummaries -Limit 1).Count -gt 0) {
        $window.FindName('LastRunText').Text = if ($null -ne $lastRun) { "Son gönderim: {0}" -f $lastRun.Text } else { 'Geçmiş' }
        $script:wizardHistoryChip.Visibility = 'Visible'
    }

    $script:wizardHistorySelectHandler = {
        param($sender, $eventArgs)
        if ($null -ne $script:wizardHistoryPopup) { $script:wizardHistoryPopup.IsOpen = $false }
        $historySummary = $sender.Tag
        $matched = Set-SamePathCopyWizardSelectionById -Rows $script:wizardRows -Ids @($historySummary.TargetIds)
        & $script:wizardUpdateSelectionCount
        & $script:wizardRefreshBulkToggles
        Write-SamePathCopyLog -Component 'Sihirbaz' -Message ("Geçmişten hedef kümesi uygulandı ({0}): {1} ({2} satır eşleşti)." -f
            [string]$historySummary.StampText, (@($historySummary.TargetIds) -join ', '), $matched)
    }
    $script:wizardHistoryOpenHandler = {
        param($sender, $eventArgs)
        # CSV varsayılan uygulamayla (genellikle Excel) açılır; açılamazsa kopyalama etkilenmez.
        try { Start-Process -FilePath ([string]$sender.Tag) } catch { }
    }
    $script:wizardShowHistory = {
        if ($null -ne $script:wizardHistoryPopup -and $script:wizardHistoryPopup.IsOpen) {
            $script:wizardHistoryPopup.IsOpen = $false
            return
        }
        # Liste her açılışta yeniden okunur: sihirbaz açıkken biten bir kopyalama da görünür.
        $script:wizardHistoryPopup = New-SamePathCopyWizardHistoryPopup -Window $script:wizardWindow `
            -PlacementTarget $script:wizardHistoryChip -Summaries @(Get-SamePathCopyRecentReportSummaries -Limit 10) `
            -SelectHandler $script:wizardHistorySelectHandler -OpenHandler $script:wizardHistoryOpenHandler
        $script:wizardHistoryPopup.IsOpen = $true
    }
    $script:wizardHistoryChip.Add_MouseLeftButtonUp({ & $script:wizardShowHistory })

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
        $effectiveSourceCount = @(Get-SamePathCopyWizardEffectiveSourceItems -SourceItems $script:wizardSourceItems -ExcludedPaths $script:wizardExcludedSources).Count
        if ($effectiveSourceCount -eq 0) {
            [void](Show-SamePathCopyConfirm -Title 'Kaynak kalmadı' -Message 'Kaynak çipindeki bütün öğelerin işareti kaldırılmış. Kopyalamak için en az bir öğe işaretli kalmalı.' -ConfirmText 'Tamam' -CancelText 'Kapat' -Owner $script:wizardWindow -IconPath $script:wizardIconPath)
            return
        }
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
        # Çipte bırakılan ve pencereye eklenen öğelerden sonra kopyalamaya girecek liste.
        SourcePaths = @(@(Get-SamePathCopyWizardEffectiveSourceItems -SourceItems $script:wizardSourceItems -ExcludedPaths $script:wizardExcludedSources) |
            ForEach-Object { [string]$_.FullName })
        # Hedef başına ayrıntı tablosunda işareti kaldırılan yollar: kopyalama bunları /XF ve /XD ile atlar.
        TargetExclusions = (ConvertTo-SamePathCopyWizardExclusionMap -Exclusions $script:wizardTargetExclusions)
    }
}
