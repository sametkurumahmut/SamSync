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
$menuEntries = @(Get-SamePathCopyMenuEntries -Configuration $config -ExcludeId $localIdentity.Id)
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
    $menuOrder = 0
    foreach ($entry in $menuEntries) {
        # Kayıt anahtarı adında iki nokta üst üste kullanılmadığı için "group:Unit1" -> "group_Unit1".
        $entryKey = Join-Path $submenuShellRoot ("{0:D3}_{1}" -f $menuOrder, ($entry.Id -replace ':', '_'))
        Set-RegistryString -Path $entryKey -Name 'MUIVerb' -Value ([string]$entry.Label)
        # İkon yalnızca toplu girdilerde (Tümü ve gruplar) durur; tek makine girdileri ikonsuz kalarak menüde ayrışır.
        if ($entry.IsAggregate) {
            Set-RegistryString -Path $entryKey -Name 'Icon' -Value ('"{0}",0' -f $iconPath)
        }
        Set-RegistryString -Path $entryKey -Name 'MultiSelectModel' -Value 'Document'
        Set-RegistryString -Path (Join-Path $entryKey 'command') -Name '' -Value ('"{0}" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{1}" -SourcePath "%1" -TargetId "{2}" -ConfigPath "{3}"' -f $powershellExe, $queueScript, $entry.Id, $resolvedConfigPath)
        $menuOrder += 10
    }
}

Write-Host "Sağ tık menüsü kuruldu: $($config.menuTitle)"
Write-Host "Sürüm: v$($config.version)"
Write-Host "Bu bilgisayar: $($localIdentity.Name) | Yerel kök: $(@($localIdentity.Roots) -join ' ; ')"
& (Join-Path $scriptDirectory 'NotepadPlusPlus-Integration.ps1') -Action Install -ConfigPath $resolvedConfigPath -WhatIf:$WhatIfPreference
Write-Host 'config.json değişince menüyü yenilemek için bu betiği tekrar çalıştırın.'
