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
    $managedItems = @($tabMenu.NotepadPlus.TabContextMenu.Item | Where-Object { $_.MenuItemName -like '[[]SamePathCopy[]]*' })
    Assert-Equal 3 $managedCommands.Count 'Tümü ve iki uzak hedef komutu eklenmedi.'
    Assert-Equal 3 $managedItems.Count 'Sekme menüsü girdileri eklenmedi.'
    Assert-Equal 1 @($shortcuts.NotepadPlus.UserDefinedCommands.Command | Where-Object { $_.name -eq 'Kullanıcı komutu' }).Count 'Mevcut kullanıcı komutu korunmadı.'
    Assert-Equal 1 @($tabMenu.NotepadPlus.TabContextMenu.Item | Where-Object { $_.MenuItemName -eq 'Close' }).Count 'Mevcut sekme menüsü korunmadı.'
    if ($managedCommands[0].'#text' -notlike '*$(FULL_CURRENT_PATH)*') {
        throw 'Aktif dosya yolu Notepad++ komutuna bağlanmadı.'
    }

    # config.json içindeki notepadPlusPlusShortcuts girdisi komuta klavye kısayolu olarak işlenmeli.
    $allCommand = @($shortcuts.NotepadPlus.UserDefinedCommands.Command | Where-Object { $_.name -eq '[SamePathCopy] all' })[0]
    Assert-Equal 'yes' ([string]$allCommand.Ctrl) 'Tümü komutuna Ctrl atanmadı.'
    Assert-Equal 'yes' ([string]$allCommand.Alt) 'Tümü komutuna Alt atanmadı.'
    Assert-Equal 'no' ([string]$allCommand.Shift) 'Tümü komutuna beklenmeyen Shift atandı.'
    Assert-Equal '87' ([string]$allCommand.Key) 'Tümü komutuna W tuşu (87) atanmadı.'
    foreach ($managedCommand in @($managedCommands | Where-Object { $_.name -ne '[SamePathCopy] all' })) {
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
    Assert-Equal 3 @($shortcuts.NotepadPlus.UserDefinedCommands.Command | Where-Object { $_.name -like '[[]SamePathCopy[]]*' }).Count 'Yeniden kurulum yinelenen komut oluşturdu.'
    Assert-Equal (Get-ExpectedShortcutsSignature -ShortcutsPath $shortcutsPath) (Get-WrittenShortcutsSignature -ConfigXmlPath $configXmlPath) 'Yeniden kurulum imzayı güncellemedi.'

    & $integrationScript -Action Uninstall -ConfigurationDirectory $testDirectory
    [xml]$shortcuts = Get-Content -LiteralPath (Join-Path $testDirectory 'shortcuts.xml') -Raw -Encoding UTF8
    [xml]$tabMenu = Get-Content -LiteralPath (Join-Path $testDirectory 'tabContextMenu.xml') -Raw -Encoding UTF8
    Assert-Equal 0 @($shortcuts.NotepadPlus.UserDefinedCommands.Command | Where-Object { $_.name -like '[[]SamePathCopy[]]*' }).Count 'Kaldırma, yönetilen komutları temizlemedi.'
    Assert-Equal 0 @($tabMenu.NotepadPlus.TabContextMenu.Item | Where-Object { $_.MenuItemName -like '[[]SamePathCopy[]]*' }).Count 'Kaldırma, yönetilen menü girdilerini temizlemedi.'
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
    Assert-Equal 0 @($tabMenu.NotepadPlus.TabContextMenu.Item | Where-Object { $_.MenuItemName -like '[[]SamePathCopy[]]*' }).Count 'Sınırı aşan komut için sekme menüsü girdisi eklendi.'
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
