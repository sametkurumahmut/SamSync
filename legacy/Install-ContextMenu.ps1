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
    # Seçim sınırı: Windows, komut satırıyla çalışan (legacy) bir fiili seçim modeline göre gizliyor.
    # "Document" 15 öğede kesiliyor (16 dosya seçince menü girdisi hiç görünmüyordu), "Player" 100 öğeye
    # kadar gösteriyor. Explorer fiili yine dosya başına bir kez çalıştırıyor; Queue-SamePathCopy.ps1
    # bu çağrıları tek bir kopyalamada topladığı için Player bu araç için doğru model.
    # Kaynak: learn.microsoft.com/windows/win32/shell/how-to-employ-the-verb-selection-model
    Set-RegistryString -Path $menuRoot -Name 'MultiSelectModel' -Value 'Player'
    Set-RegistryString -Path $menuRoot -Name 'SubCommands' -Value ''

    $submenuShellRoot = Join-Path $menuRoot 'shell'

    # Windows'un klasik basamaklı sağ tık menüsü BÜTÜN ağaçta en fazla 16 öğe gösterir: alt menüye taşımak
    # bütçeyi artırmıyor, 17. öğe uyarı vermeden düşüyor (gözlemlendi: düz 19 girdinin 16'sı, alt menülü
    # ağaçta 4 + (1+5) + (1+5) = 16 öğe göründü). Ayırıcılar bu bütçeden yer yemiyor.
    # Bütçeyi kimin harcayacağına Get-SamePathCopyMenuPlan karar veriyor: bu makinenin KENDİ grubunun
    # makineleri menüde tek tek açılıyor, sığmayan gruplar grup girdisi olarak kalıyor (hepsi ya da hiçbiri).
    # Davranış config.json içindeki menuShowNodes ile değiştirilir (auto/always/never).
    $menuItemBudget = Get-SamePathCopyMenuItemBudget
    $separatorBeforeFlag = 0x20

    $menuPlan = Get-SamePathCopyMenuPlan -Entries $menuEntries -LocalGroup ([string]$localIdentity.Group) `
        -ShowNodes ([string]$config.menuShowNodes) -Budget $menuItemBudget
    # Grup adları büyük/küçük harf farkıyla karşılaştırılır: config'te yazıldığı gibi kalabilir.
    $expandedGroupKeys = @(@($menuPlan.ExpandedGroups) | ForEach-Object { ([string]$_).ToLowerInvariant() })

    if ([bool]$menuPlan.OverBudget) {
        Write-Warning ("Explorer menüsünde {0} öğe olacak; Windows en fazla {1} öğe gösterir ve fazlasını sessizce gizler. config.json içinde menuShowNodes değerini auto yapın." -f $menuPlan.ItemCount, $menuItemBudget)
        Write-SamePathCopyLog -Component 'Kurulum' -Level 'WARN' -Message ("Menü {0} öğe ile {1} sınırını aşıyor (menuShowNodes={2})." -f
            $menuPlan.ItemCount, $menuItemBudget, $config.menuShowNodes)
    }
    if ([bool]$menuPlan.LocalGroupExpanded) {
        Write-Host ("Bu makinenin grubu ({0}) menüde tek tek açıldı." -f $menuPlan.LocalGroup)
    }
    if (@($menuPlan.CollapsedGroups).Count -gt 0) {
        Write-Host ("Şu grupların makineleri menüde tek tek gösterilmiyor ({0} makine): {1}. O gruplara grup girdisiyle ya da Wizard'la gönderilir (menuShowNodes=always ile zorlanabilir)." -f
            $menuPlan.HiddenNodeCount, (@($menuPlan.CollapsedGroups) -join ', '))
    }
    Write-SamePathCopyLog -Component 'Kurulum' -Message ("Menü planı: {0}/{1} öğe | yerel grup: {2} (açık: {3}) | açılan: {4} | kapalı: {5} | gruba ait olmayanlar: {6} | menüye girmeyen makine: {7}" -f
        $menuPlan.ItemCount, $menuItemBudget,
        $(if ($menuPlan.LocalGroup) { $menuPlan.LocalGroup } else { '(yok)' }), $menuPlan.LocalGroupExpanded,
        $(if (@($menuPlan.ExpandedGroups).Count -gt 0) { (@($menuPlan.ExpandedGroups) -join ',') } else { 'yok' }),
        $(if (@($menuPlan.CollapsedGroups).Count -gt 0) { (@($menuPlan.CollapsedGroups) -join ',') } else { 'yok' }),
        $menuPlan.IncludeUngroupedNodes, $menuPlan.HiddenNodeCount)

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
        # Alt menüdeki fiiller de aynı modeli taşımalı: kök "Player" olsa da girdinin kendisi "Document"
        # kalırsa 15 öğeden sonra alt menüde görünmüyor.
        Set-RegistryString -Path $Path -Name 'MultiSelectModel' -Value 'Player'
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
        # Bütçe yetmiyorsa gruba ait olmayan makineler menüye konmaz.
        if ($entry.Kind -eq 'node' -and -not [bool]$menuPlan.IncludeUngroupedNodes) { continue }

        $needsSeparator = ($previousSection -ne '' -and $previousSection -ne [string]$entry.Section)
        # Kayıt anahtarı adında iki nokta üst üste kullanılmadığı için "group:Unit1" -> "group_Unit1".
        $entryKey = Join-Path $submenuShellRoot ("{0:D3}_{1}" -f $menuOrder, ($entry.Id -replace ':', '_'))

        if ($entry.Kind -eq 'group') {
            $groupMembers = @($menuEntries | Where-Object { $_.Kind -eq 'node' -and [string]$_.GroupName -eq [string]$entry.GroupName })
            $expandThisGroup = ($expandedGroupKeys -contains ([string]$entry.GroupName).ToLowerInvariant())
            if ($expandThisGroup -and $groupMembers.Count -gt 0) {
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
                # Bu grup açılmıyorsa girdi doğrudan komuta bağlanır: tıklamak grubun tamamına gönderir.
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
