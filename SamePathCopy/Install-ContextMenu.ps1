[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$ConfigPath
)

$ErrorActionPreference = 'Stop'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($scriptDirectory)) {
    throw 'Install-ContextMenu.ps1 dosyasının bulunduğu klasör belirlenemedi.'
}
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = Join-Path $scriptDirectory 'config.json'
}
. (Join-Path $scriptDirectory 'SamePathCopy.Common.ps1')
. (Join-Path $scriptDirectory 'SamePathCopy.Log.ps1')
. (Join-Path $scriptDirectory 'SamePathCopy.Wizard.ps1')
[void](Initialize-SamePathCopyLog -ScriptDirectory $scriptDirectory)
Write-SamePathCopyLogStart -Component 'Kurulum' -Summary 'Sağ tık menüsü kurulumu'

function Set-RegistryString {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Name,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value
    )

    $prefix = 'HKCU:\'
    if (-not $Path.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Yalnızca HKCU kayıt yolları destekleniyor: $Path"
    }

    if ($PSCmdlet.ShouldProcess($Path, "Kayıt değeri yaz: $Name = $Value")) {
        $relativePath = $Path.Substring($prefix.Length)
        $key = $null
        try {
            $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($relativePath)
            if ($null -eq $key) {
                throw "Kayıt anahtarı oluşturulamadı: $Path"
            }
            $key.SetValue($Name, $Value, [Microsoft.Win32.RegistryValueKind]::String)
        }
        finally {
            if ($null -ne $key) {
                $key.Dispose()
            }
        }
    }
}

function Set-RegistryDword {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][int]$Value
    )

    $prefix = 'HKCU:\'
    if (-not $Path.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Yalnızca HKCU kayıt yolları destekleniyor: $Path"
    }

    if ($PSCmdlet.ShouldProcess($Path, "Kayıt değeri yaz: $Name = $Value")) {
        $relativePath = $Path.Substring($prefix.Length)
        $key = $null
        try {
            $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($relativePath)
            if ($null -eq $key) {
                throw "Kayıt anahtarı oluşturulamadı: $Path"
            }
            $key.SetValue($Name, $Value, [Microsoft.Win32.RegistryValueKind]::DWord)
        }
        finally {
            if ($null -ne $key) {
                $key.Dispose()
            }
        }
    }
}

function Remove-RegistryTree {
    param([Parameter(Mandatory = $true)][string]$Path)

    $prefix = 'HKCU:\'
    if (-not $Path.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Yalnızca HKCU kayıt yolları destekleniyor: $Path"
    }

    if ($PSCmdlet.ShouldProcess($Path, 'Eski kayıt ağacını kaldır')) {
        $relativePath = $Path.Substring($prefix.Length)
        try {
            [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($relativePath, $false)
        }
        catch [System.ArgumentException] {
            # Anahtar zaten yoksa kurulum devam eder.
        }
    }
}

$config = Get-SamePathCopyConfiguration -ConfigPath $ConfigPath
$localIdentity = Get-LocalSamePathCopyIdentity -Configuration $config
# Sihirbazda kaydedilmis profiller de menuye girdi olarak eklenir.
$profileNames = @(Get-SamePathCopyWizardProfileNames -ConfigPath ((Resolve-Path -LiteralPath $ConfigPath).Path))
$menuEntries = @(Get-SamePathCopyMenuEntries -Configuration $config -ExcludeId $localIdentity.Id -ProfileNames $profileNames)
if (@($menuEntries | Where-Object { $_.Kind -eq 'node' }).Count -eq 0) {
    throw "Menüye eklenecek etkin hedef yok."
}

$queueScript = (Resolve-Path -LiteralPath (Join-Path $scriptDirectory 'Queue-SamePathCopy.ps1')).Path
$iconPath = (Resolve-Path -LiteralPath (Join-Path $scriptDirectory 'assets\SamePathCopy.ico')).Path
$resolvedConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$powershellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$legacyCommandStoreRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\CommandStore\shell'
foreach ($legacyName in @('All') + @($config.nodes | ForEach-Object { [string]$_.id })) {
    Remove-RegistryTree -Path (Join-Path $legacyCommandStoreRoot "SamePathCopy.$legacyName")
}

Remove-RegistryTree -Path 'HKCU:\Software\Classes\SamePathCopy.Menu'

$legacyMenuRoots = @(
    'HKCU:\Software\Classes\*\shell\SamePathCopy',
    'HKCU:\Software\Classes\Directory\shell\SamePathCopy'
)
foreach ($legacyMenuRoot in $legacyMenuRoots) {
    Remove-RegistryTree -Path $legacyMenuRoot
}

$menuRoots = @('HKCU:\Software\Classes\AllFilesystemObjects\shell\SamePathCopy')
foreach ($menuRoot in $menuRoots) {
    Remove-RegistryTree -Path $menuRoot
    Set-RegistryString -Path $menuRoot -Name 'MUIVerb' -Value ([string]$config.menuTitle)
    Set-RegistryString -Path $menuRoot -Name 'Icon' -Value ('"{0}",0' -f $iconPath)
    Set-RegistryString -Path $menuRoot -Name 'MultiSelectModel' -Value 'Document'
    Set-RegistryString -Path $menuRoot -Name 'SubCommands' -Value ''

    $submenuShellRoot = Join-Path $menuRoot 'shell'

    # Windows'un klasik basamaklı sağ tık menüsü BÜTÜN ağaçta en fazla 16 öğe gösterir: alt menüye taşımak
    # bütçeyi artırmıyor, 17. öğe uyarı vermeden düşüyor (gözlemlendi: düz 19 girdinin 16'sı, alt menülü
    # ağaçta 4 + (1+5) + (1+5) = 16 öğe göründü). Ayırıcılar bu bütçeden yer yemiyor.
    # Bu yüzden bütçe önceden hesaplanır ve sığmıyorsa tek makine girdileri menüye konmaz; sihirbaz zaten
    # makine seçimini yapıyor. Davranış config.json içindeki menuShowNodes ile değiştirilir (auto/always/never).
    $menuItemBudget = 16
    $separatorBeforeFlag = 0x20

    $aggregateEntries = @($menuEntries | Where-Object { $_.Kind -ne 'node' -and $_.Kind -ne 'group' })
    $groupEntries = @($menuEntries | Where-Object { $_.Kind -eq 'group' })
    $nodeEntries = @($menuEntries | Where-Object { $_.Kind -eq 'node' })
    # Grup alt menüsünde grubun kendi "hepsine gönder" girdisi de bir öğe sayılır.
    $itemsWithNodes = $aggregateEntries.Count + ($groupEntries.Count * 2) + $nodeEntries.Count
    $itemsWithoutNodes = $aggregateEntries.Count + $groupEntries.Count

    $includeNodes = switch ([string]$config.menuShowNodes) {
        'always' { $true }
        'never' { $false }
        default { $itemsWithNodes -le $menuItemBudget }
    }
    # Grup yoksa tek makineler menüdeki tek hedeftir; bu durumda bütçeyi aşsa da konurlar.
    if (-not $includeNodes -and $groupEntries.Count -eq 0) { $includeNodes = $true }

    $plannedItemCount = if ($includeNodes) { $itemsWithNodes } else { $itemsWithoutNodes }
    if ($includeNodes -and $plannedItemCount -gt $menuItemBudget) {
        Write-Warning ("Explorer menüsünde {0} öğe olacak; Windows en fazla {1} öğe gösterir ve fazlasını sessizce gizler. config.json içinde menuShowNodes değerini auto yapın." -f $plannedItemCount, $menuItemBudget)
        Write-SamePathCopyLog -Component 'Kurulum' -Level 'WARN' -Message ("Menü {0} öğe ile 16 sınırını aşıyor (menuShowNodes={1})." -f $plannedItemCount, $config.menuShowNodes)
    }
    if (-not $includeNodes -and $nodeEntries.Count -gt 0) {
        Write-Host ("Menüde tek makine girdileri gösterilmiyor: {0} makine + {1} grup + {2} toplu girdi Windows'un 16 öğe sınırını aşıyor. Tek makineye göndermek için Wizard'ı kullanın (menuShowNodes=always ile zorlanabilir)." -f
            $nodeEntries.Count, $groupEntries.Count, $aggregateEntries.Count)
        Write-SamePathCopyLog -Component 'Kurulum' -Message ("Tek makine girdileri menüye konmadı: {0} makine, sınır {1}, planlanan {2}" -f
            $nodeEntries.Count, $menuItemBudget, $itemsWithNodes)
    }

    function Set-MenuItem {
        param(
            [Parameter(Mandatory = $true)][string]$Path,
            [Parameter(Mandatory = $true)][string]$Label,
            [string]$TargetId,
            [switch]$WithIcon,
            [switch]$SeparatorBefore
        )

        Set-RegistryString -Path $Path -Name 'MUIVerb' -Value $Label
        # İkon yalnızca toplu girdilerde (Tümü, sihirbaz, geri alma, profiller ve gruplar) durur;
        # tek makine girdileri ikonsuz kalarak menüde ayrışır.
        if ($WithIcon) {
            Set-RegistryString -Path $Path -Name 'Icon' -Value ('"{0}",0' -f $iconPath)
        }
        Set-RegistryString -Path $Path -Name 'MultiSelectModel' -Value 'Document'
        if ($SeparatorBefore) {
            Set-RegistryDword -Path $Path -Name 'CommandFlags' -Value $separatorBeforeFlag
        }
        if (-not [string]::IsNullOrWhiteSpace($TargetId)) {
            Set-RegistryString -Path (Join-Path $Path 'command') -Name '' -Value ('"{0}" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{1}" -SourcePath "%1" -TargetId "{2}" -ConfigPath "{3}"' -f $powershellExe, $queueScript, $TargetId, $resolvedConfigPath)
        }
    }

    $menuOrder = 0
    $previousSection = ''
    foreach ($entry in $menuEntries) {
        # Gruba ait makineler üst seviyede değil, grubun alt menüsünde oluşur.
        if ($entry.Kind -eq 'node' -and -not [string]::IsNullOrWhiteSpace([string]$entry.GroupName)) { continue }
        # Bütçe yetmiyorsa tek makine girdileri menüye hiç konmaz.
        if ($entry.Kind -eq 'node' -and -not $includeNodes) { continue }

        $needsSeparator = ($previousSection -ne '' -and $previousSection -ne [string]$entry.Section)
        # Kayıt anahtarı adında iki nokta üst üste kullanılmadığı için "group:Unit1" -> "group_Unit1".
        $entryKey = Join-Path $submenuShellRoot ("{0:D3}_{1}" -f $menuOrder, ($entry.Id -replace ':', '_'))

        if ($entry.Kind -eq 'group') {
            $groupMembers = @($menuEntries | Where-Object { $_.Kind -eq 'node' -and [string]$_.GroupName -eq [string]$entry.GroupName })
            if ($includeNodes -and $groupMembers.Count -gt 0) {
                # Grup alt menüsü: SubCommands boş bırakılıp altına kendi shell anahtarı açılır.
                Set-MenuItem -Path $entryKey -Label ([string]$entry.Label) -WithIcon -SeparatorBefore:$needsSeparator
                Set-RegistryString -Path $entryKey -Name 'SubCommands' -Value ''
                $groupShellRoot = Join-Path $entryKey 'shell'
                $groupOrder = 0
                Set-MenuItem -Path (Join-Path $groupShellRoot ("{0:D3}_{1}" -f $groupOrder, ($entry.Id -replace ':', '_'))) `
                    -Label ("{0} - {1}" -f $entry.Label, [string]$config.allLabel) -TargetId ([string]$entry.Id) -WithIcon
                $groupOrder += 10
                foreach ($member in $groupMembers) {
                    Set-MenuItem -Path (Join-Path $groupShellRoot ("{0:D3}_{1}" -f $groupOrder, ($member.Id -replace ':', '_'))) `
                        -Label ([string]$member.Label) -TargetId ([string]$member.Id)
                    $groupOrder += 10
                }
            }
            else {
                # Tek makineler menüye konmuyorsa grup girdisi doğrudan komuta bağlanır (alt menü gereksiz).
                Set-MenuItem -Path $entryKey -Label ([string]$entry.Label) -TargetId ([string]$entry.Id) `
                    -WithIcon -SeparatorBefore:$needsSeparator
            }
        }
        else {
            Set-MenuItem -Path $entryKey -Label ([string]$entry.Label) -TargetId ([string]$entry.Id) `
                -WithIcon:([bool]$entry.IsAggregate) -SeparatorBefore:$needsSeparator
        }

        $previousSection = [string]$entry.Section
        $menuOrder += 10
    }
}

Write-Host "Sağ tık menüsü kuruldu: $($config.menuTitle)"
Write-Host "Sürüm: v$($config.version)"
Write-Host "Bu bilgisayar: $($localIdentity.Name) | Yerel kök: $(@($localIdentity.Roots) -join ' ; ')"
Write-SamePathCopyLog -Component 'Kurulum' -Message ("Menü kuruldu: {0} girdi | bu bilgisayar: {1} ({2}) | config: {3} | sürüm: v{4}" -f
    $menuEntries.Count, $localIdentity.Id, $localIdentity.Name, $resolvedConfigPath, $config.version)
Write-SamePathCopyLog -Component 'Kurulum' -Message ("Menü girdileri: {0}" -f (@($menuEntries | ForEach-Object { $_.Id }) -join ', '))
& (Join-Path $scriptDirectory 'NotepadPlusPlus-Integration.ps1') -Action Install -ConfigPath $resolvedConfigPath -WhatIf:$WhatIfPreference
Write-Host 'config.json değişince menüyü yenilemek için bu betiği tekrar çalıştırın.'
