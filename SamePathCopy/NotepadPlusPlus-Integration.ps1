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
        $entries = @([pscustomobject]@{ Id = 'all'; Label = [string]$Configuration.allLabel }) + @(
            $Targets | ForEach-Object { [pscustomobject]@{ Id = [string]$_.id; Label = [string]$_.name } }
        )
        foreach ($entry in $entries) {
            $commandName = "$commandPrefix$($entry.Id)"
            $command = $shortcutsDocument.CreateElement('Command')
            $command.SetAttribute('name', $commandName)
            $command.SetAttribute('Ctrl', 'no')
            $command.SetAttribute('Alt', 'no')
            $command.SetAttribute('Shift', 'no')
            $command.SetAttribute('Key', '0')
            $command.InnerText = ('"{0}" -NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{1}" -SourcePath "$(FULL_CURRENT_PATH)" -TargetId "{2}" -ConfigPath "{3}"' -f $powershellExe, $QueueScriptPath, $entry.Id, $ResolvedConfigPath)
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
    Write-Warning 'Yeni sekme menüsünün görünmesi için Notepad++ uygulamasını kapatıp yeniden açın.'
}
