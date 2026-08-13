[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Install', 'Uninstall')]
    [string]$Action,

    [string]$ConfigPath,

    # Otomatik algılamanın dışında, taşınabilir veya test amaçlı bir ayar klasörü verilebilir.
    [string[]]$ConfigurationDirectory
)

$ErrorActionPreference = 'Stop'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$commandPrefix = '[SamePathCopy] '
# Notepad++ (RunDlg.cpp, Command::run) Run komut satırını MAX_PATH uzunluğundaki tampona kopyalar;
# $(FULL_CURRENT_PATH) gibi değişkenler açılmadan önce ilk 260 karakter dışındaki kısım atılır.
$notepadPlusPlusCommandLimit = 260

function Get-NotepadPlusPlusTargets {
    param([string[]]$ExplicitConfigurationDirectory)

    if ($ExplicitConfigurationDirectory) {
        return @($ExplicitConfigurationDirectory | ForEach-Object {
            [pscustomobject]@{
                ConfigurationDirectory = [System.IO.Path]::GetFullPath($_)
                InstallationDirectory = $null
                Version = $null
            }
        })
    }

    $executablePaths = New-Object System.Collections.Generic.List[string]
    Get-Process -Name 'notepad++' -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            if ($_.Path) { $executablePaths.Add($_.Path) }
        }
        catch {
            # Başka kullanıcıya ait işlem yolu okunamıyorsa diğer algılama yöntemleri kullanılır.
        }
    }

    $knownExecutablePaths = @(
        (Join-Path $env:ProgramFiles 'Notepad++\notepad++.exe'),
        $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'Notepad++\notepad++.exe' }),
        (Join-Path $env:LOCALAPPDATA 'Programs\Notepad++\notepad++.exe')
    )
    foreach ($path in $knownExecutablePaths) {
        if ($path -and (Test-Path -LiteralPath $path -PathType Leaf)) {
            $executablePaths.Add($path)
        }
    }

    foreach ($registryPath in @(
        'Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\App Paths\notepad++.exe',
        'Registry::HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\App Paths\notepad++.exe',
        'Registry::HKEY_LOCAL_MACHINE\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\notepad++.exe'
    )) {
        try {
            $registeredPath = (Get-Item -LiteralPath $registryPath -ErrorAction Stop).GetValue('')
            if ($registeredPath -and (Test-Path -LiteralPath $registeredPath -PathType Leaf)) {
                $executablePaths.Add([string]$registeredPath)
            }
        }
        catch {
            # Kayıt yoksa kurulu olabilecek diğer konumlar denenir.
        }
    }

    $seenConfigDirectories = @{}
    $targets = @()
    foreach ($executablePath in @($executablePaths | Select-Object -Unique)) {
        $installationDirectory = Split-Path -Parent $executablePath
        $configurationPath = if (Test-Path -LiteralPath (Join-Path $installationDirectory 'doLocalConf.xml')) {
            $installationDirectory
        }
        else {
            Join-Path $env:APPDATA 'Notepad++'
        }
        $configurationPath = [System.IO.Path]::GetFullPath($configurationPath)
        if ($seenConfigDirectories.ContainsKey($configurationPath)) { continue }
        $seenConfigDirectories[$configurationPath] = $true

        $versionText = (Get-Item -LiteralPath $executablePath).VersionInfo.FileVersion
        $version = $null
        try { $version = [version]$versionText } catch { }
        $targets += [pscustomobject]@{
            ConfigurationDirectory = $configurationPath
            InstallationDirectory = $installationDirectory
            Version = $version
        }
    }
    return $targets
}

function Read-XmlDocument {
    param([Parameter(Mandatory = $true)][string]$Path)

    $document = New-Object System.Xml.XmlDocument
    $document.PreserveWhitespace = $false
    $document.XmlResolver = $null
    $document.Load($Path)
    return $document
}

function Save-XmlDocument {
    param(
        [Parameter(Mandatory = $true)][System.Xml.XmlDocument]$Document,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $settings = New-Object System.Xml.XmlWriterSettings
    $settings.Encoding = New-Object System.Text.UTF8Encoding($false)
    $settings.Indent = $true
    $settings.IndentChars = '    '
    $settings.NewLineChars = "`r`n"
    $settings.NewLineHandling = [System.Xml.NewLineHandling]::Replace
    $temporaryPath = "$Path.samepathcopy.tmp"
    $writer = $null
    try {
        $writer = [System.Xml.XmlWriter]::Create($temporaryPath, $settings)
        $Document.Save($writer)
        $writer.Dispose()
        $writer = $null
        Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
    }
    finally {
        if ($null -ne $writer) { $writer.Dispose() }
        if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force }
    }
}

function Get-NotepadPlusPlusIntegrityKey {
    # Notepad++ 8.9.6.2 ve üzeri, shortcuts.xml imzasını makine GUID'ini HMAC anahtarı olarak kullanarak üretir.
    $baseKey = $null
    $cryptographyKey = $null
    try {
        $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
        $cryptographyKey = $baseKey.OpenSubKey('SOFTWARE\Microsoft\Cryptography')
        if ($null -eq $cryptographyKey) { return $null }
        $machineGuid = [string]$cryptographyKey.GetValue('MachineGuid')
        if ([string]::IsNullOrWhiteSpace($machineGuid)) { return $null }
        return [System.Text.Encoding]::ASCII.GetBytes($machineGuid)
    }
    catch {
        return $null
    }
    finally {
        if ($null -ne $cryptographyKey) { $cryptographyKey.Dispose() }
        if ($null -ne $baseKey) { $baseKey.Dispose() }
    }
}

function Get-ShortcutsXmlSignature {
    param(
        [Parameter(Mandatory = $true)][string]$ShortcutsPath,
        [Parameter(Mandatory = $true)][byte[]]$KeyBytes
    )

    # İmza, dosyanın ham baytları üzerinden HMAC-SHA256 olarak hesaplanır ve küçük harfli hex olarak yazılır.
    $hmac = New-Object System.Security.Cryptography.HMACSHA256 -ArgumentList @(, $KeyBytes)
    try {
        $hash = $hmac.ComputeHash([System.IO.File]::ReadAllBytes($ShortcutsPath))
    }
    finally {
        $hmac.Dispose()
    }
    return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Update-ShortcutsXmlSignature {
    param(
        [Parameter(Mandatory = $true)][string]$ConfigurationDirectory,
        [Parameter(Mandatory = $true)][string]$ShortcutsPath
    )

    # Notepad++ 8.9.6.2 ve üzeri, bir kullanıcı komutunu çalıştırmadan önce shortcuts.xml imzasını
    # config.xml içindeki "shortcutsXmlHMAC" değeriyle karşılaştırır (CVE-2026-48800). İmza güncellenmezse
    # komut çalışmaz; Notepad++ "Security Warning" uyarısı gösterip shortcuts.xml dosyasını salt okunur açar.
    $manualStep = 'Notepad++ içinde Çalıştır (Run) > Validate shortcuts.xml komutunu bir kez kullanın.'
    if (-not (Test-Path -LiteralPath $ShortcutsPath -PathType Leaf)) { return }

    $configXmlPath = Join-Path $ConfigurationDirectory 'config.xml'
    if (-not (Test-Path -LiteralPath $configXmlPath -PathType Leaf)) {
        Write-Warning "Notepad++ config.xml bulunamadı, shortcuts.xml imzası yazılamadı ($configXmlPath). $manualStep"
        return
    }

    $keyBytes = Get-NotepadPlusPlusIntegrityKey
    if ($null -eq $keyBytes) {
        Write-Warning "Makine GUID okunamadı, shortcuts.xml imzası yazılamadı. $manualStep"
        return
    }

    $element = '<GUIConfig name="shortcutsXmlHMAC" value="{0}" />' -f (Get-ShortcutsXmlSignature -ShortcutsPath $ShortcutsPath -KeyBytes $keyBytes)

    # config.xml kullanıcının tüm Notepad++ ayarlarını taşıdığı için yeniden biçimlendirilmez; yalnızca ilgili satır değiştirilir.
    $bytes = [System.IO.File]::ReadAllBytes($configXmlPath)
    $hasByteOrderMark = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
    $contentOffset = if ($hasByteOrderMark) { 3 } else { 0 }
    $content = [System.Text.Encoding]::UTF8.GetString($bytes, $contentOffset, $bytes.Length - $contentOffset)
    $newLine = if ($content.Contains("`r`n")) { "`r`n" } else { "`n" }

    $existingSignature = [regex]::Match($content, '<GUIConfig\s+name="shortcutsXmlHMAC"[^>]*>')
    $guiConfigsEnd = [regex]::Match($content, '(?m)^([ \t]*)</GUIConfigs>')
    $rootEnd = [regex]::Match($content, '(?m)^([ \t]*)</NotepadPlus>')
    if ($existingSignature.Success) {
        $updatedContent = $content.Remove($existingSignature.Index, $existingSignature.Length).Insert($existingSignature.Index, $element)
    }
    elseif ($guiConfigsEnd.Success) {
        $indent = $guiConfigsEnd.Groups[1].Value
        $updatedContent = $content.Insert($guiConfigsEnd.Index, "$indent    $element$newLine")
    }
    elseif ($rootEnd.Success) {
        $indent = $rootEnd.Groups[1].Value
        $updatedContent = $content.Insert($rootEnd.Index, "$indent    <GUIConfigs>$newLine$indent        $element$newLine$indent    </GUIConfigs>$newLine")
    }
    else {
        Write-Warning "Notepad++ config.xml beklenen yapıda değil, shortcuts.xml imzası yazılamadı ($configXmlPath). $manualStep"
        return
    }
    if ($updatedContent -eq $content) { return }

    if ($PSCmdlet.ShouldProcess($configXmlPath, 'shortcuts.xml bütünlük imzasını güncelle')) {
        $temporaryPath = "$configXmlPath.samepathcopy.tmp"
        try {
            [System.IO.File]::WriteAllText($temporaryPath, $updatedContent, (New-Object System.Text.UTF8Encoding($hasByteOrderMark)))
            Move-Item -LiteralPath $temporaryPath -Destination $configXmlPath -Force
        }
        finally {
            if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force }
        }
    }
}

function New-ShortcutsDocument {
    $document = New-Object System.Xml.XmlDocument
    [void]$document.AppendChild($document.CreateXmlDeclaration('1.0', 'UTF-8', $null))
    $root = $document.CreateElement('NotepadPlus')
    [void]$document.AppendChild($root)
    foreach ($elementName in @('InternalCommands', 'Macros', 'UserDefinedCommands', 'PluginCommands', 'ScintillaKeys')) {
        [void]$root.AppendChild($document.CreateElement($elementName))
    }
    return $document
}

function New-TabContextMenuDocument {
    param($Target)

    $exampleCandidates = @(
        (Join-Path $Target.ConfigurationDirectory 'tabContextMenu_example.xml'),
        $(if ($Target.InstallationDirectory) { Join-Path $Target.InstallationDirectory 'tabContextMenu_example.xml' })
    )
    $examplePath = @($exampleCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1)
    if ($examplePath.Count -gt 0) {
        return Read-XmlDocument -Path $examplePath[0]
    }

    # Örnek dosya bulunamazsa temel sekme komutlarını koruyan uyumlu bir menü oluşturulur.
    $document = New-Object System.Xml.XmlDocument
    [void]$document.AppendChild($document.CreateXmlDeclaration('1.0', 'UTF-8', $null))
    $root = $document.CreateElement('NotepadPlus')
    [void]$document.AppendChild($root)
    $menu = $document.CreateElement('TabContextMenu')
    [void]$root.AppendChild($menu)
    foreach ($definition in @(
        @('File', 'Close', ''),
        @('File', 'Save', ''),
        @('File', 'Save As...', ''),
        @('File', 'Reload from Disk', ''),
        @('File', 'Print...', ''),
        @('Edit', 'Copy Current Full File Path', 'Copy to Clipboard'),
        @('Edit', 'Copy Current Filename', 'Copy to Clipboard'),
        @('Edit', 'Copy Current Dir. Path', 'Copy to Clipboard')
    )) {
        $item = $document.CreateElement('Item')
        $item.SetAttribute('MenuEntryName', $definition[0])
        $item.SetAttribute('MenuItemName', $definition[1])
        if ($definition[2]) { $item.SetAttribute('FolderName', $definition[2]) }
        [void]$menu.AppendChild($item)
    }
    return $document
}

function Remove-ManagedNodes {
    param(
        [Parameter(Mandatory = $true)][System.Xml.XmlNode]$Parent,
        [Parameter(Mandatory = $true)][string]$AttributeName
    )

    foreach ($node in @($Parent.SelectNodes("Item|Command"))) {
        $attribute = $node.Attributes[$AttributeName]
        if ($null -ne $attribute -and $attribute.Value.StartsWith($commandPrefix, [System.StringComparison]::Ordinal)) {
            [void]$Parent.RemoveChild($node)
        }
    }
}

function Update-NotepadPlusPlusConfiguration {
    param(
        [Parameter(Mandatory = $true)]$Target,
        [Parameter(Mandatory = $true)][string]$RequestedAction,
        $Configuration,
        [object[]]$Targets,
        [string]$ResolvedConfigPath,
        [string]$QueueScriptPath
    )

    $configDirectory = $Target.ConfigurationDirectory
    if ($RequestedAction -eq 'Install' -and -not (Test-Path -LiteralPath $configDirectory -PathType Container)) {
        if ($PSCmdlet.ShouldProcess($configDirectory, 'Notepad++ ayar klasörünü oluştur')) {
            [void](New-Item -ItemType Directory -Path $configDirectory -Force)
        }
    }
    if (-not (Test-Path -LiteralPath $configDirectory -PathType Container)) { return }

    $shortcutsPath = Join-Path $configDirectory 'shortcuts.xml'
    $shortcutsDocument = if (Test-Path -LiteralPath $shortcutsPath -PathType Leaf) {
        Read-XmlDocument -Path $shortcutsPath
    }
    else {
        New-ShortcutsDocument
    }
    $userCommands = $shortcutsDocument.SelectSingleNode('/NotepadPlus/UserDefinedCommands')
    if ($null -eq $userCommands) {
        $root = $shortcutsDocument.SelectSingleNode('/NotepadPlus')
        if ($null -eq $root) { throw "Geçersiz Notepad++ shortcuts.xml: $shortcutsPath" }
        $userCommands = $shortcutsDocument.CreateElement('UserDefinedCommands')
        [void]$root.AppendChild($userCommands)
    }
    Remove-ManagedNodes -Parent $userCommands -AttributeName 'name'

    $tabMenuPath = Join-Path $configDirectory 'tabContextMenu.xml'
    $tabMenuDocument = if (Test-Path -LiteralPath $tabMenuPath -PathType Leaf) {
        Read-XmlDocument -Path $tabMenuPath
    }
    else {
        New-TabContextMenuDocument -Target $Target
    }
    $tabMenu = $tabMenuDocument.SelectSingleNode('/NotepadPlus/TabContextMenu')
    if ($null -eq $tabMenu) { throw "Geçersiz Notepad++ tabContextMenu.xml: $tabMenuPath" }
    Remove-ManagedNodes -Parent $tabMenu -AttributeName 'MenuItemName'

    if ($RequestedAction -eq 'Install') {
        $powershellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        # Notepad++ Run komutunu, değişkenleri açmadan önce 260 karakterde kesip sessizce bozar; komut bu yüzden
        # olabildiğince kısa tutulur: kısa PowerShell anahtarları kullanılır ve config yolu yalnızca
        # betiğin yanındaki varsayılan config.json dışında bir dosya kullanılıyorsa yazılır.
        $defaultConfigPath = Join-Path (Split-Path -Parent $QueueScriptPath) 'config.json'
        $configPathArgument = if ($ResolvedConfigPath -and -not $ResolvedConfigPath.Equals($defaultConfigPath, [System.StringComparison]::OrdinalIgnoreCase)) {
            ' -ConfigPath "{0}"' -f $ResolvedConfigPath
        }
        else {
            ''
        }
        $entries = @([pscustomobject]@{ Id = 'all'; Label = [string]$Configuration.allLabel }) + @(
            $Targets | ForEach-Object { [pscustomobject]@{ Id = [string]$_.id; Label = [string]$_.name } }
        )
        foreach ($entry in $entries) {
            $commandName = "$commandPrefix$($entry.Id)"
            $commandText = ('"{0}" -nop -w hidden -ep bypass -f "{1}" -TargetId {2} -SourcePath "$(FULL_CURRENT_PATH)"{3}' -f $powershellExe, $QueueScriptPath, $entry.Id, $configPathArgument)
            if ($commandText.Length -gt $notepadPlusPlusCommandLimit) {
                Write-Warning "$commandName komutu Notepad++ sınırını aşıyor ($($commandText.Length) karakter, en fazla $notepadPlusPlusCommandLimit) ve eklenmedi. Aracı ve config dosyasını daha kısa bir yola taşıyın (örnek: C:\SamePathCopy)."
                continue
            }
            $command = $shortcutsDocument.CreateElement('Command')
            $command.SetAttribute('name', $commandName)
            $command.SetAttribute('Ctrl', 'no')
            $command.SetAttribute('Alt', 'no')
            $command.SetAttribute('Shift', 'no')
            $command.SetAttribute('Key', '0')
            $command.InnerText = $commandText
            [void]$userCommands.AppendChild($command)

            $item = $tabMenuDocument.CreateElement('Item')
            $item.SetAttribute('FolderName', [string]$Configuration.menuTitle)
            $item.SetAttribute('MenuEntryName', 'Run')
            $item.SetAttribute('MenuItemName', $commandName)
            $item.SetAttribute('ItemNameAs', [string]$entry.Label)
            [void]$tabMenu.AppendChild($item)
        }
    }

    foreach ($file in @(
        [pscustomobject]@{ Document = $shortcutsDocument; Path = $shortcutsPath },
        [pscustomobject]@{ Document = $tabMenuDocument; Path = $tabMenuPath }
    )) {
        if ($PSCmdlet.ShouldProcess($file.Path, "Notepad++ SamePathCopy bütünleşmesini $RequestedAction")) {
            Save-XmlDocument -Document $file.Document -Path $file.Path
        }
    }
    # İmza, shortcuts.xml son hâlini aldıktan sonra hesaplanmalıdır.
    Update-ShortcutsXmlSignature -ConfigurationDirectory $configDirectory -ShortcutsPath $shortcutsPath
    Write-Host "Notepad++ bütünleşmesi $RequestedAction`: $configDirectory"
}

$notepadPlusPlusTargets = @(Get-NotepadPlusPlusTargets -ExplicitConfigurationDirectory $ConfigurationDirectory)
if ($notepadPlusPlusTargets.Count -eq 0) {
    Write-Host 'Notepad++ bulunamadı; sekme sağ tık bütünleşmesi atlandı.'
    return
}

$configuration = $null
$enabledTargets = @()
$resolvedConfigPath = $null
$queueScriptPath = $null
if ($Action -eq 'Install') {
    if ([string]::IsNullOrWhiteSpace($ConfigPath)) { $ConfigPath = Join-Path $scriptDirectory 'config.json' }
    . (Join-Path $scriptDirectory 'SamePathCopy.Common.ps1')
    $configuration = Get-SamePathCopyConfiguration -ConfigPath $ConfigPath
    $localIdentity = Get-LocalSamePathCopyIdentity -Configuration $configuration
    $enabledTargets = @(Get-EnabledSamePathCopyNodes -Configuration $configuration -ExcludeId $localIdentity.Id)
    $resolvedConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
    $queueScriptPath = (Resolve-Path -LiteralPath (Join-Path $scriptDirectory 'Queue-SamePathCopy.ps1')).Path
}

foreach ($target in $notepadPlusPlusTargets) {
    if ($null -ne $target.Version -and $target.Version -lt [version]'8.4.8') {
        Write-Warning "Notepad++ $($target.Version), özelleştirilebilir sekme menüsünü desteklemiyor (en az 8.4.8 gerekli): $($target.InstallationDirectory)"
        continue
    }
    Update-NotepadPlusPlusConfiguration -Target $target -RequestedAction $Action -Configuration $configuration -Targets $enabledTargets -ResolvedConfigPath $resolvedConfigPath -QueueScriptPath $queueScriptPath
}

if (Get-Process -Name 'notepad++' -ErrorAction SilentlyContinue) {
    # Notepad++ kapanırken shortcuts.xml ve config.xml dosyalarını kendi belleğindeki içerikle yeniden yazar;
    # bu yüzden açıkken yapılan değişiklikler ve bütünlük imzası kaybolur.
    Write-Warning 'Notepad++ açık. Uygulamayı kapatıp bu betiği bir kez daha çalıştırın; aksi hâlde Notepad++ kapanırken yaptığı değişiklikleri geri yazar.'
}
