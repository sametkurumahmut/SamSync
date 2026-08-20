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
. (Join-Path $scriptDirectory 'SamePathCopy.Log.ps1')
[void](Initialize-SamePathCopyLog -ScriptDirectory $scriptDirectory)
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

function ConvertTo-NotepadPlusPlusShortcut {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$EntryId
    )

    # "Ctrl+Alt+W" gibi bir metni Notepad++ shortcuts.xml biçimine (Ctrl/Alt/Shift + sanal tuş kodu) çevirir.
    $namedKeys = @{
        'BACKSPACE' = 8; 'TAB' = 9; 'ENTER' = 13; 'RETURN' = 13; 'ESC' = 27; 'ESCAPE' = 27; 'SPACE' = 32
        'PAGEUP' = 33; 'PAGEDOWN' = 34; 'END' = 35; 'HOME' = 36
        'LEFT' = 37; 'UP' = 38; 'RIGHT' = 39; 'DOWN' = 40
        'INSERT' = 45; 'INS' = 45; 'DELETE' = 46; 'DEL' = 46
    }

    $useCtrl = $false
    $useAlt = $false
    $useShift = $false
    $keyToken = $null
    foreach ($token in @($Text -split '\+' | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
        $upperToken = $token.ToUpperInvariant()
        if ($upperToken -eq 'CTRL' -or $upperToken -eq 'CONTROL') { $useCtrl = $true }
        elseif ($upperToken -eq 'ALT') { $useAlt = $true }
        elseif ($upperToken -eq 'SHIFT') { $useShift = $true }
        elseif ($null -ne $keyToken) { throw "Kısayolda birden fazla tuş var ($EntryId): $Text" }
        else { $keyToken = $upperToken }
    }
    if ($null -eq $keyToken) { throw "Kısayolda tuş belirtilmedi ($EntryId): $Text" }

    $keyCode = 0
    if ($keyToken -match '^[A-Z0-9]$') {
        if (-not ($useCtrl -or $useAlt -or $useShift)) {
            throw "Harf ve rakam kısayolları en az bir Ctrl/Alt/Shift tuşu gerektirir ($EntryId): $Text"
        }
        $keyCode = [int][char]$keyToken
    }
    elseif ($keyToken -match '^F([1-9]|1[0-9]|2[0-4])$') {
        $keyCode = 111 + [int]$Matches[1]
    }
    elseif ($namedKeys.ContainsKey($keyToken)) {
        $keyCode = $namedKeys[$keyToken]
    }
    else {
        throw "Kısayoldaki tuş tanınmadı ($EntryId): $keyToken. Harf, rakam, F1-F24 veya $(($namedKeys.Keys | Sort-Object) -join ', ') kullanılabilir."
    }

    $displayParts = @()
    if ($useCtrl) { $displayParts += 'Ctrl' }
    if ($useAlt) { $displayParts += 'Alt' }
    if ($useShift) { $displayParts += 'Shift' }
    $displayParts += $keyToken
    return [pscustomobject]@{
        Ctrl = if ($useCtrl) { 'yes' } else { 'no' }
        Alt = if ($useAlt) { 'yes' } else { 'no' }
        Shift = if ($useShift) { 'yes' } else { 'no' }
        Key = [string]$keyCode
        Text = $displayParts -join '+'
    }
}

function Get-NotepadPlusPlusShortcutAssignments {
    param(
        $Configuration,
        [Parameter(Mandatory = $true)][string[]]$KnownIds
    )

    $assignments = @{}
    if ($null -eq $Configuration -or -not $Configuration.PSObject.Properties['notepadPlusPlusShortcuts']) { return $assignments }
    $shortcutConfiguration = $Configuration.notepadPlusPlusShortcuts
    if ($null -eq $shortcutConfiguration) { return $assignments }

    foreach ($property in @($shortcutConfiguration.PSObject.Properties)) {
        $requestedId = ([string]$property.Name).Trim()
        $shortcutText = [string]$property.Value
        if ([string]::IsNullOrWhiteSpace($shortcutText)) { continue }

        $matchedIds = @($KnownIds | Where-Object { $_.Equals($requestedId, [System.StringComparison]::OrdinalIgnoreCase) })
        if ($matchedIds.Count -eq 0) {
            Write-Warning "notepadPlusPlusShortcuts içindeki '$requestedId' kimliği menüde bulunmadığı için kısayol atlandı. Kullanılabilir kimlikler: $($KnownIds -join ', ')"
            continue
        }

        $shortcut = ConvertTo-NotepadPlusPlusShortcut -Text $shortcutText -EntryId $matchedIds[0]
        foreach ($assignedId in @($assignments.Keys)) {
            $assigned = $assignments[$assignedId]
            if ($assigned.Key -eq $shortcut.Key -and $assigned.Ctrl -eq $shortcut.Ctrl -and $assigned.Alt -eq $shortcut.Alt -and $assigned.Shift -eq $shortcut.Shift) {
                throw "Aynı kısayol birden fazla hedefe atandı ($assignedId ve $($matchedIds[0])): $($shortcut.Text)"
            }
        }
        $assignments[$matchedIds[0]] = $shortcut
    }
    return $assignments
}

function Test-ShortcutConflict {
    param(
        [Parameter(Mandatory = $true)][System.Xml.XmlDocument]$ShortcutsDocument,
        [Parameter(Mandatory = $true)]$Shortcut
    )

    # Notepad++ varsayılan kısayolları shortcuts.xml içinde tutulmaz; yalnızca dosyada yazılı olanlar denetlenebilir.
    foreach ($node in @($ShortcutsDocument.SelectNodes('/NotepadPlus/*/*'))) {
        if ($null -eq $node.Attributes['Key'] -or $node.GetAttribute('Key') -ne $Shortcut.Key) { continue }
        if ($node.GetAttribute('Ctrl') -ne $Shortcut.Ctrl) { continue }
        if ($node.GetAttribute('Alt') -ne $Shortcut.Alt) { continue }
        if ($node.GetAttribute('Shift') -ne $Shortcut.Shift) { continue }
        $conflictName = if ($node.Attributes['name']) { $node.GetAttribute('name') } else { $node.Name }
        return $conflictName
    }
    return $null
}

function Update-NotepadPlusPlusConfiguration {
    param(
        [Parameter(Mandatory = $true)]$Target,
        [Parameter(Mandatory = $true)][string]$RequestedAction,
        $Configuration,
        [object[]]$MenuEntries,
        [string]$ResolvedConfigPath,
        [string]$QueueScriptPath,
        [hashtable]$ShortcutAssignments = @{}
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
        foreach ($entry in $MenuEntries) {
            $commandName = "$commandPrefix$($entry.Id)"
            $commandText = ('"{0}" -nop -w hidden -ep bypass -f "{1}" -TargetId {2} -SourcePath "$(FULL_CURRENT_PATH)"{3}' -f $powershellExe, $QueueScriptPath, $entry.Id, $configPathArgument)
            if ($commandText.Length -gt $notepadPlusPlusCommandLimit) {
                Write-SamePathCopyLog -Component 'Notepad++' -Level 'WARN' -Message ("$commandName komutu 260 karakter sınırını aştı ({0} karakter) ve eklenmedi." -f $commandText.Length)
                Write-Warning "$commandName komutu Notepad++ sınırını aşıyor ($($commandText.Length) karakter, en fazla $notepadPlusPlusCommandLimit) ve eklenmedi. Aracı ve config dosyasını daha kısa bir yola taşıyın (örnek: C:\SamePathCopy)."
                continue
            }
            $shortcut = $ShortcutAssignments[$entry.Id]
            if ($null -ne $shortcut) {
                $conflictName = Test-ShortcutConflict -ShortcutsDocument $shortcutsDocument -Shortcut $shortcut
                if ($null -ne $conflictName) {
                    Write-Warning "$($shortcut.Text) kısayolu shortcuts.xml içinde '$conflictName' tarafından da kullanılıyor; Notepad++ içinde Ayarlar > Kısayol Eşleyici ile denetleyin."
                }
            }
            $command = $shortcutsDocument.CreateElement('Command')
            $command.SetAttribute('name', $commandName)
            $command.SetAttribute('Ctrl', $(if ($null -ne $shortcut) { $shortcut.Ctrl } else { 'no' }))
            $command.SetAttribute('Alt', $(if ($null -ne $shortcut) { $shortcut.Alt } else { 'no' }))
            $command.SetAttribute('Shift', $(if ($null -ne $shortcut) { $shortcut.Shift } else { 'no' }))
            $command.SetAttribute('Key', $(if ($null -ne $shortcut) { $shortcut.Key } else { '0' }))
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
    Write-SamePathCopyLog -Component 'Notepad++' -Message ("{0}: {1} | komut: {2} | sekme menüsü: {3}" -f
        $RequestedAction, $configDirectory,
        @($userCommands.ChildNodes | Where-Object { $_.Attributes -and $_.Attributes['name'] -and ([string]$_.GetAttribute('name')).StartsWith($commandPrefix, [System.StringComparison]::Ordinal) }).Count,
        @($tabMenu.ChildNodes | Where-Object { $_.Attributes -and $_.Attributes['MenuItemName'] -and ([string]$_.GetAttribute('MenuItemName')).StartsWith($commandPrefix, [System.StringComparison]::Ordinal) }).Count)
}

$notepadPlusPlusTargets = @(Get-NotepadPlusPlusTargets -ExplicitConfigurationDirectory $ConfigurationDirectory)
if ($notepadPlusPlusTargets.Count -eq 0) {
    Write-Host 'Notepad++ bulunamadı; sekme sağ tık bütünleşmesi atlandı.'
    return
}

$configuration = $null
$menuEntries = @()
$resolvedConfigPath = $null
$queueScriptPath = $null
$shortcutAssignments = @{}
if ($Action -eq 'Install') {
    if ([string]::IsNullOrWhiteSpace($ConfigPath)) { $ConfigPath = Join-Path $scriptDirectory 'config.json' }
    . (Join-Path $scriptDirectory 'SamePathCopy.Common.ps1')
    $configuration = Get-SamePathCopyConfiguration -ConfigPath $ConfigPath
    $localIdentity = Get-LocalSamePathCopyIdentity -Configuration $configuration
    $menuEntries = @(Get-SamePathCopyMenuEntries -Configuration $configuration -ExcludeId $localIdentity.Id)
    $resolvedConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
    $queueScriptPath = (Resolve-Path -LiteralPath (Join-Path $scriptDirectory 'Queue-SamePathCopy.ps1')).Path
    $shortcutAssignments = Get-NotepadPlusPlusShortcutAssignments -Configuration $configuration -KnownIds @($menuEntries | ForEach-Object { [string]$_.Id })
}

foreach ($target in $notepadPlusPlusTargets) {
    if ($null -ne $target.Version -and $target.Version -lt [version]'8.4.8') {
        Write-Warning "Notepad++ $($target.Version), özelleştirilebilir sekme menüsünü desteklemiyor (en az 8.4.8 gerekli): $($target.InstallationDirectory)"
        continue
    }
    Update-NotepadPlusPlusConfiguration -Target $target -RequestedAction $Action -Configuration $configuration -MenuEntries $menuEntries -ResolvedConfigPath $resolvedConfigPath -QueueScriptPath $queueScriptPath -ShortcutAssignments $shortcutAssignments
}

if (Get-Process -Name 'notepad++' -ErrorAction SilentlyContinue) {
    # Notepad++ kapanırken shortcuts.xml ve config.xml dosyalarını kendi belleğindeki içerikle yeniden yazar;
    # bu yüzden açıkken yapılan değişiklikler ve bütünlük imzası kaybolur.
    Write-Warning 'Notepad++ açık. Uygulamayı kapatıp bu betiği bir kez daha çalıştırın; aksi hâlde Notepad++ kapanırken yaptığı değişiklikleri geri yazar.'
}
