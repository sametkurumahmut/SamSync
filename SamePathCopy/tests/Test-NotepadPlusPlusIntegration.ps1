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

    # Yeniden kurulum aynı girdileri çoğaltmamalı.
    & $integrationScript -Action Install -ConfigPath $configPath -ConfigurationDirectory $testDirectory
    [xml]$shortcuts = Get-Content -LiteralPath (Join-Path $testDirectory 'shortcuts.xml') -Raw -Encoding UTF8
    Assert-Equal 3 @($shortcuts.NotepadPlus.UserDefinedCommands.Command | Where-Object { $_.name -like '[[]SamePathCopy[]]*' }).Count 'Yeniden kurulum yinelenen komut oluşturdu.'

    & $integrationScript -Action Uninstall -ConfigurationDirectory $testDirectory
    [xml]$shortcuts = Get-Content -LiteralPath (Join-Path $testDirectory 'shortcuts.xml') -Raw -Encoding UTF8
    [xml]$tabMenu = Get-Content -LiteralPath (Join-Path $testDirectory 'tabContextMenu.xml') -Raw -Encoding UTF8
    Assert-Equal 0 @($shortcuts.NotepadPlus.UserDefinedCommands.Command | Where-Object { $_.name -like '[[]SamePathCopy[]]*' }).Count 'Kaldırma, yönetilen komutları temizlemedi.'
    Assert-Equal 0 @($tabMenu.NotepadPlus.TabContextMenu.Item | Where-Object { $_.MenuItemName -like '[[]SamePathCopy[]]*' }).Count 'Kaldırma, yönetilen menü girdilerini temizlemedi.'
    Assert-Equal 1 @($shortcuts.NotepadPlus.UserDefinedCommands.Command | Where-Object { $_.name -eq 'Kullanıcı komutu' }).Count 'Kaldırma kullanıcı komutunu sildi.'

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
