$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$integrationScript = Join-Path $projectDirectory 'NotepadPlusPlus-Integration.ps1'
$configPath = Join-Path $projectDirectory 'config.json'
$testDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('SamePathCopy-Npp-' + [guid]::NewGuid().ToString('N'))

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) {
        throw "$Message Beklenen: $Expected; gerçek: $Actual"
    }
}

function Get-XmlAttributeValue {
    param($Node, [Parameter(Mandatory = $true)][string]$Name)

    # Katı kipte olmayan niteliğe erişmek hata verir; ayırıcı girdiler MenuItemName taşımaz.
    if ($null -eq $Node -or $null -eq $Node.Attributes -or $null -eq $Node.Attributes[$Name]) { return '' }
    return [string]$Node.Attributes[$Name].Value
}

function Get-ExpectedShortcutsSignature {
    param([Parameter(Mandatory = $true)][string]$ShortcutsPath)

    # Notepad++ 8.9.6.2 ve üzeri ile aynı hesap: anahtar makine GUID'i, veri dosyanın ham baytları.
    $machineGuid = [string](Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name 'MachineGuid').MachineGuid
    $hmac = New-Object System.Security.Cryptography.HMACSHA256 -ArgumentList @(, [System.Text.Encoding]::ASCII.GetBytes($machineGuid))
    try {
        $hash = $hmac.ComputeHash([System.IO.File]::ReadAllBytes($ShortcutsPath))
    }
    finally {
        $hmac.Dispose()
    }
    return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Get-WrittenShortcutsSignature {
    param([Parameter(Mandatory = $true)][string]$ConfigXmlPath)

    [xml]$configXml = Get-Content -LiteralPath $ConfigXmlPath -Raw -Encoding UTF8
    $signatureNodes = @($configXml.NotepadPlus.GUIConfigs.GUIConfig | Where-Object { $_.name -eq 'shortcutsXmlHMAC' })
    Assert-Equal 1 $signatureNodes.Count 'config.xml içinde tek bir shortcutsXmlHMAC girdisi olmalı.'
    return [string]$signatureNodes[0].value
}

# Beklenen girdi sayısı config.json'dan türetilir; node listesi değiştiğinde test kırılmamalı.
. (Join-Path $projectDirectory 'SamePathCopy.Common.ps1')
$configuration = Get-SamePathCopyConfiguration -ConfigPath $configPath
$localIdentity = Get-LocalSamePathCopyIdentity -Configuration $configuration
$expectedEntries = @(Get-SamePathCopyMenuEntries -Configuration $configuration -ExcludeId $localIdentity.Id)
$expectedCommandCount = $expectedEntries.Count

try {
    [void](New-Item -ItemType Directory -Path $testDirectory)
    @'
<?xml version="1.0" encoding="UTF-8" ?>
<NotepadPlus>
    <InternalCommands />
    <Macros />
    <UserDefinedCommands>
        <Command name="Kullanıcı komutu" Ctrl="no" Alt="no" Shift="no" Key="0">cmd /c echo korunmalı</Command>
    </UserDefinedCommands>
    <PluginCommands />
    <ScintillaKeys />
</NotepadPlus>
'@ | Set-Content -LiteralPath (Join-Path $testDirectory 'shortcuts.xml') -Encoding UTF8
    @'
<?xml version="1.0" encoding="UTF-8" ?>
<NotepadPlus>
    <TabContextMenu>
        <Item MenuEntryName="File" MenuItemName="Close" />
    </TabContextMenu>
</NotepadPlus>
'@ | Set-Content -LiteralPath (Join-Path $testDirectory 'tabContextMenu_example.xml') -Encoding UTF8
    @'
<?xml version="1.0" encoding="UTF-8" ?>
<NotepadPlus>
    <GUIConfigs>
        <GUIConfig name="StatusBar">show</GUIConfig>
    </GUIConfigs>
</NotepadPlus>
'@ | Set-Content -LiteralPath (Join-Path $testDirectory 'config.xml') -Encoding UTF8

    $shortcutsPath = Join-Path $testDirectory 'shortcuts.xml'
    $configXmlPath = Join-Path $testDirectory 'config.xml'

    & $integrationScript -Action Install -ConfigPath $configPath -ConfigurationDirectory $testDirectory

    [xml]$shortcuts = Get-Content -LiteralPath (Join-Path $testDirectory 'shortcuts.xml') -Raw -Encoding UTF8
    [xml]$tabMenu = Get-Content -LiteralPath (Join-Path $testDirectory 'tabContextMenu.xml') -Raw -Encoding UTF8
    $managedCommands = @($shortcuts.NotepadPlus.UserDefinedCommands.Command | Where-Object { $_.name -like '[[]SamePathCopy[]]*' })
    $tabMenuItems = @($tabMenu.NotepadPlus.TabContextMenu.Item)
    $managedItems = @($tabMenuItems | Where-Object { (Get-XmlAttributeValue -Node $_ -Name 'MenuItemName') -like '[[]SamePathCopy[]]*' })
    # Ayırıcılar (id="0") MenuItemName taşımaz; kendi klasörümüzdeki ayırıcılar ayrı sayılır.
    $managedSeparators = @($tabMenuItems | Where-Object {
        (Get-XmlAttributeValue -Node $_ -Name 'id') -eq '0' -and
        (Get-XmlAttributeValue -Node $_ -Name 'FolderName') -eq [string]$configuration.menuTitle })
    Assert-Equal $expectedCommandCount $managedCommands.Count 'Tümü ve uzak hedef komutları eklenmedi.'
    Assert-Equal $expectedCommandCount $managedItems.Count 'Sekme menüsü girdileri eklenmedi.'
    Assert-Equal 1 @($shortcuts.NotepadPlus.UserDefinedCommands.Command | Where-Object { $_.name -eq 'Kullanıcı komutu' }).Count 'Mevcut kullanıcı komutu korunmadı.'
    Assert-Equal 1 @($tabMenuItems | Where-Object { (Get-XmlAttributeValue -Node $_ -Name 'MenuItemName') -eq 'Close' }).Count 'Mevcut sekme menüsü korunmadı.'
    if ($managedCommands[0].'#text' -notlike '*$(FULL_CURRENT_PATH)*') {
        throw 'Aktif dosya yolu Notepad++ komutuna bağlanmadı.'
    }

    # Sekme menüsü, Explorer menüsüyle aynı sırayı ve etiketleri kullanmalı (grup girdileri kendi makinelerinin başında).
    Assert-Equal (@($expectedEntries | ForEach-Object { $_.Id }) -join ' > ') (@($managedCommands | ForEach-Object { ([string]$_.name) -replace '^\[SamePathCopy\] ', '' }) -join ' > ') 'Notepad++ komut sırası menü sırasından farklı.'
    Assert-Equal (@($expectedEntries | ForEach-Object { $_.Label }) -join ' > ') (@($managedItems | ForEach-Object { Get-XmlAttributeValue -Node $_ -Name 'ItemNameAs' }) -join ' > ') 'Sekme menüsü etiketleri menü sırasından farklı.'
    foreach ($groupEntry in @($expectedEntries | Where-Object { $_.Kind -eq 'group' })) {
        $groupCommand = @($managedCommands | Where-Object { $_.name -eq "[SamePathCopy] $($groupEntry.Id)" })
        Assert-Equal 1 $groupCommand.Count "$($groupEntry.Id) grup komutu eklenmedi."
        if (([string]$groupCommand[0].'#text') -notlike "*-TargetId $($groupEntry.Id) *") {
            throw "$($groupEntry.Id) grup komutu grup hedefini geçirmiyor: $($groupCommand[0].'#text')"
        }
    }

    # Bölümler arasına ayırıcı konur: Tümü | sihirbaz girdileri | geri alma | profiller | gruplar | tek makineler.
    $expectedSeparatorCount = @($expectedEntries | ForEach-Object { [string]$_.Section } |
        Select-Object -Unique).Count - 1
    Assert-Equal $expectedSeparatorCount $managedSeparators.Count 'Sekme menüsünde ayırıcı sayısı bölüm sayısıyla uyuşmuyor.'

    # Ayırıcılar doğru yerde mi: her ayırıcıdan sonraki girdi yeni bölümün ilk girdisi olmalı.
    $tabMenuNodes = @($tabMenuItems | Where-Object {
        (Get-XmlAttributeValue -Node $_ -Name 'MenuItemName') -like '[[]SamePathCopy[]]*' -or
        ((Get-XmlAttributeValue -Node $_ -Name 'id') -eq '0' -and
         (Get-XmlAttributeValue -Node $_ -Name 'FolderName') -eq [string]$configuration.menuTitle) })
    $sectionByCommandName = @{}
    foreach ($expectedEntry in $expectedEntries) { $sectionByCommandName["[SamePathCopy] $($expectedEntry.Id)"] = [string]$expectedEntry.Section }
    $previousSection = ''
    $separatorPending = $false
    foreach ($node in $tabMenuNodes) {
        if ((Get-XmlAttributeValue -Node $node -Name 'id') -eq '0') {
            if ($separatorPending) { throw 'Sekme menüsünde üst üste iki ayırıcı var.' }
            $separatorPending = $true
            continue
        }
        $nodeName = Get-XmlAttributeValue -Node $node -Name 'MenuItemName'
        $nodeSection = [string]$sectionByCommandName[$nodeName]
        if ($separatorPending -and $previousSection -eq $nodeSection) {
            throw "Aynı bölümün içine ayırıcı konuldu: $nodeName"
        }
        if (-not $separatorPending -and $previousSection -ne '' -and $previousSection -ne $nodeSection) {
            throw "Bölüm değişiminde ayırıcı yok: $nodeName"
        }
        $separatorPending = $false
        $previousSection = $nodeSection
    }
    if ($tabMenuNodes.Count -gt 0 -and (Get-XmlAttributeValue -Node $tabMenuNodes[0] -Name 'id') -eq '0') {
        throw 'Sekme menüsü ayırıcı ile başlıyor.'
    }

    # config.json içindeki notepadPlusPlusShortcuts girdisi komuta klavye kısayolu olarak işlenmeli.
    # Kısayol, sihirbaz penceresini açmadan son ayarla kopyalayan girdide olmalı.
    $shortcutCommandName = '[SamePathCopy] wizard:last'
    $shortcutCommand = @($shortcuts.NotepadPlus.UserDefinedCommands.Command | Where-Object { $_.name -eq $shortcutCommandName })[0]
    Assert-Equal 'yes' ([string]$shortcutCommand.Ctrl) 'Kısayol komutuna Ctrl atanmadı.'
    Assert-Equal 'yes' ([string]$shortcutCommand.Alt) 'Kısayol komutuna Alt atanmadı.'
    Assert-Equal 'no' ([string]$shortcutCommand.Shift) 'Kısayol komutuna beklenmeyen Shift atandı.'
    Assert-Equal '87' ([string]$shortcutCommand.Key) 'Kısayol komutuna W tuşu (87) atanmadı.'
    if (([string]$shortcutCommand.'#text') -notlike '*-TargetId wizard:last *') {
        throw "Kısayol komutu wizard:last hedefini geçirmiyor: $($shortcutCommand.'#text')"
    }
    foreach ($managedCommand in @($managedCommands | Where-Object { $_.name -ne $shortcutCommandName })) {
        Assert-Equal '0' ([string]$managedCommand.Key) "$($managedCommand.name) komutuna kısayol atanmamalıydı."
    }

    # Notepad++ Run komutunu 260 karakterde kesip sessizce bozar; varsayılan config yolu bu yüzden yazılmaz.
    foreach ($managedCommand in $managedCommands) {
        $commandText = [string]$managedCommand.'#text'
        if ($commandText.Length -gt 260) {
            throw "$($managedCommand.name) komutu Notepad++ sınırını aşıyor: $($commandText.Length) karakter."
        }
        if ($commandText -like '*-ConfigPath*') {
            throw "$($managedCommand.name) komutu varsayılan config yolunu gereksiz yazdı."
        }
        if ($commandText -notlike '*Queue-SamePathCopy.ps1*') {
            throw "$($managedCommand.name) komutu kuyruk betiğini çağırmıyor."
        }
    }

    # Notepad++ 8.9.6.2 ve üzeri, komutu çalıştırmadan önce bu imzayı doğrular.
    Assert-Equal (Get-ExpectedShortcutsSignature -ShortcutsPath $shortcutsPath) (Get-WrittenShortcutsSignature -ConfigXmlPath $configXmlPath) 'Kurulum shortcuts.xml bütünlük imzasını config.xml içine yazmadı.'
    [xml]$configXml = Get-Content -LiteralPath $configXmlPath -Raw -Encoding UTF8
    Assert-Equal 'show' ([string](@($configXml.NotepadPlus.GUIConfigs.GUIConfig | Where-Object { $_.name -eq 'StatusBar' })[0].'#text')) 'İmza yazılırken mevcut config.xml ayarı bozuldu.'

    # Yeniden kurulum aynı girdileri çoğaltmamalı.
    & $integrationScript -Action Install -ConfigPath $configPath -ConfigurationDirectory $testDirectory
    [xml]$shortcuts = Get-Content -LiteralPath (Join-Path $testDirectory 'shortcuts.xml') -Raw -Encoding UTF8
    Assert-Equal $expectedCommandCount @($shortcuts.NotepadPlus.UserDefinedCommands.Command | Where-Object { $_.name -like '[[]SamePathCopy[]]*' }).Count 'Yeniden kurulum yinelenen komut oluşturdu.'
    Assert-Equal (Get-ExpectedShortcutsSignature -ShortcutsPath $shortcutsPath) (Get-WrittenShortcutsSignature -ConfigXmlPath $configXmlPath) 'Yeniden kurulum imzayı güncellemedi.'

    & $integrationScript -Action Uninstall -ConfigurationDirectory $testDirectory
    [xml]$shortcuts = Get-Content -LiteralPath (Join-Path $testDirectory 'shortcuts.xml') -Raw -Encoding UTF8
    [xml]$tabMenu = Get-Content -LiteralPath (Join-Path $testDirectory 'tabContextMenu.xml') -Raw -Encoding UTF8
    Assert-Equal 0 @($shortcuts.NotepadPlus.UserDefinedCommands.Command | Where-Object { $_.name -like '[[]SamePathCopy[]]*' }).Count 'Kaldırma, yönetilen komutları temizlemedi.'
    Assert-Equal 0 @($tabMenu.NotepadPlus.TabContextMenu.Item | Where-Object { (Get-XmlAttributeValue -Node $_ -Name 'MenuItemName') -like '[[]SamePathCopy[]]*' }).Count 'Kaldırma, yönetilen menü girdilerini temizlemedi.'
    Assert-Equal 0 @($tabMenu.NotepadPlus.TabContextMenu.Item | Where-Object {
        (Get-XmlAttributeValue -Node $_ -Name 'id') -eq '0' -and
        (Get-XmlAttributeValue -Node $_ -Name 'FolderName') -eq [string]$configuration.menuTitle }).Count 'Kaldırma, eklenen ayırıcıları temizlemedi.'
    Assert-Equal 1 @($shortcuts.NotepadPlus.UserDefinedCommands.Command | Where-Object { $_.name -eq 'Kullanıcı komutu' }).Count 'Kaldırma kullanıcı komutunu sildi.'
    Assert-Equal (Get-ExpectedShortcutsSignature -ShortcutsPath $shortcutsPath) (Get-WrittenShortcutsSignature -ConfigXmlPath $configXmlPath) 'Kaldırma sonrası imza güncellenmedi; kalan kullanıcı komutları çalışmazdı.'

    # Varsayılan dışındaki uzun bir config yolu 260 karakter sınırını aşıyorsa komut bozuk yazılmak yerine atlanmalı.
    $longConfigDirectory = Join-Path $testDirectory (('u' * 50) + '\' + ('u' * 50))
    [void](New-Item -ItemType Directory -Path $longConfigDirectory -Force)
    $longConfigPath = Join-Path $longConfigDirectory 'config.json'
    Copy-Item -LiteralPath $configPath -Destination $longConfigPath
    $limitWarnings = @()
    & $integrationScript -Action Install -ConfigPath $longConfigPath -ConfigurationDirectory $testDirectory -WarningVariable limitWarnings -WarningAction SilentlyContinue
    [xml]$shortcuts = Get-Content -LiteralPath $shortcutsPath -Raw -Encoding UTF8
    [xml]$tabMenu = Get-Content -LiteralPath (Join-Path $testDirectory 'tabContextMenu.xml') -Raw -Encoding UTF8
    Assert-Equal 0 @($shortcuts.NotepadPlus.UserDefinedCommands.Command | Where-Object { $_.name -like '[[]SamePathCopy[]]*' }).Count 'Sınırı aşan komut shortcuts.xml içine yazıldı.'
    Assert-Equal 0 @($tabMenu.NotepadPlus.TabContextMenu.Item | Where-Object { (Get-XmlAttributeValue -Node $_ -Name 'MenuItemName') -like '[[]SamePathCopy[]]*' }).Count 'Sınırı aşan komut için sekme menüsü girdisi eklendi.'
    if (@($limitWarnings | Where-Object { [string]$_ -like '*Notepad++ sınırını aşıyor*' }).Count -eq 0) {
        throw 'Sınır aşımı için uyarı verilmedi.'
    }

    # Geçersiz kısayol metni sessizce yok sayılmamalı.
    $invalidShortcutConfigPath = Join-Path $testDirectory 'config-invalid-shortcut.json'
    $configObject = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $configObject | Add-Member -NotePropertyName 'notepadPlusPlusShortcuts' -NotePropertyValue ([pscustomobject]@{ all = 'Ctrl+Alt+YokTus' }) -Force
    ($configObject | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $invalidShortcutConfigPath -Encoding UTF8
    $invalidShortcutError = $null
    try {
        & $integrationScript -Action Install -ConfigPath $invalidShortcutConfigPath -ConfigurationDirectory $testDirectory -WarningAction SilentlyContinue
    }
    catch {
        $invalidShortcutError = $_
    }
    if ($null -eq $invalidShortcutError -or [string]$invalidShortcutError.Exception.Message -notlike '*tanınmadı*') {
        throw 'Geçersiz kısayol tuşu için hata verilmedi.'
    }

    # Menüde bulunmayan bir kimliğe atanan kısayol uyarı vermeli.
    $unknownIdConfigPath = Join-Path $testDirectory 'config-unknown-shortcut.json'
    $configObject | Add-Member -NotePropertyName 'notepadPlusPlusShortcuts' -NotePropertyValue ([pscustomobject]@{ YokHedef = 'Ctrl+Alt+Q' }) -Force
    ($configObject | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $unknownIdConfigPath -Encoding UTF8
    $unknownIdWarnings = @()
    & $integrationScript -Action Install -ConfigPath $unknownIdConfigPath -ConfigurationDirectory $testDirectory -WarningVariable unknownIdWarnings -WarningAction SilentlyContinue
    if (@($unknownIdWarnings | Where-Object { [string]$_ -like '*YokHedef*' }).Count -eq 0) {
        throw 'Menüde olmayan kimlik için uyarı verilmedi.'
    }

    Write-Host 'Notepad++ bütünleşme testleri başarılı.'
}
finally {
    $resolvedTestDirectory = [System.IO.Path]::GetFullPath($testDirectory)
    $temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if ($resolvedTestDirectory.StartsWith($temporaryRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $resolvedTestDirectory).StartsWith('SamePathCopy-Npp-', [System.StringComparison]::Ordinal)) {
        Remove-Item -LiteralPath $resolvedTestDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}
