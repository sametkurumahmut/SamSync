[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param()

$ErrorActionPreference = 'Stop'
$paths = @(
    'HKCU:\Software\Classes\*\shell\SamePathCopy',
    'HKCU:\Software\Classes\Directory\shell\SamePathCopy',
    'HKCU:\Software\Classes\AllFilesystemObjects\shell\SamePathCopy',
    'HKCU:\Software\Classes\SamePathCopy.Menu'
)
foreach ($path in $paths) {
    if ((Test-Path -LiteralPath $path) -and $PSCmdlet.ShouldProcess($path, 'Sağ tık menüsünü kaldır')) {
        Remove-Item -LiteralPath $path -Recurse -Force
    }
}

$commandStoreRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\CommandStore\shell'
Get-ChildItem -LiteralPath $commandStoreRoot -ErrorAction SilentlyContinue |
    Where-Object { $_.PSChildName -like 'SamePathCopy.*' } |
    ForEach-Object {
        if ($PSCmdlet.ShouldProcess($_.PSPath, 'Menü komutunu kaldır')) {
            Remove-Item -LiteralPath $_.PSPath -Recurse -Force
        }
    }

Write-Host 'Aynı Dizine Kopyala sağ tık menüsü kaldırıldı.'
