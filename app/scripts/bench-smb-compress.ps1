# Measures whether SMB compression helps on this link: copies a compressible file and a random (incompressible)
# file to a share with robocopy, once plainly and once with /COMPRESS (Windows 10 20H2+ / Server 2022 client and
# server, SMB 3.1.1), and prints MB/s for each. Nothing is left on the share.
#   .\bench-smb-compress.ps1 -Share \\192.168.46.101\Dsim\ActiveRelease -SizeMB 200
param(
  [Parameter(Mandatory = $true)][string]$Share,
  [int]$SizeMB = 200
)
$ErrorActionPreference = 'Stop'
$tmp = Join-Path $env:TEMP ("samsync-smbbench-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp | Out-Null
$remote = Join-Path $Share ("_samsync-smbbench-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
try {
  # a DLL-like file: text and zeros mixed, compresses to roughly 40%
  $comp = Join-Path $tmp 'compressible.bin'
  $fs = [System.IO.File]::OpenWrite($comp)
  $block = [System.Text.Encoding]::ASCII.GetBytes(('SamSync benchmark block ' * 32) + ("`0" * 256))
  for ($i = 0; $i -lt ($SizeMB * 1MB / $block.Length); $i++) { $fs.Write($block, 0, $block.Length) }
  $fs.Close()
  # random bytes: nothing to gain, shows the cost of trying
  $rand = Join-Path $tmp 'random.bin'
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $buf = New-Object byte[] (1MB)
  $fs = [System.IO.File]::OpenWrite($rand)
  for ($i = 0; $i -lt $SizeMB; $i++) { $rng.GetBytes($buf); $fs.Write($buf, 0, $buf.Length) }
  $fs.Close()

  function Measure-Copy([string]$file, [string[]]$extra) {
    $name = [System.IO.Path]::GetFileName($file)
    New-Item -ItemType Directory -Path $remote -Force | Out-Null
    Remove-Item (Join-Path $remote $name) -ErrorAction SilentlyContinue
    $t0 = Get-Date
    & robocopy $tmp $remote $name /NJH /NJS /NP /NFL /NDL @extra | Out-Null
    $s = ((Get-Date) - $t0).TotalSeconds
    Remove-Item (Join-Path $remote $name) -ErrorAction SilentlyContinue
    return [math]::Round($SizeMB / $s, 2)
  }

  Write-Host ("Share: {0}   file size: {1} MB" -f $Share, $SizeMB)
  foreach ($f in @($comp, $rand)) {
    $plain = Measure-Copy $f @()
    $compressed = Measure-Copy $f @('/COMPRESS')
    Write-Host ("{0,-18} plain {1,8} MB/s   /COMPRESS {2,8} MB/s   ({3:+0.0;-0.0}%)" -f [System.IO.Path]::GetFileName($f), $plain, $compressed, (($compressed / $plain - 1) * 100))
  }
  Write-Host 'If /COMPRESS is not faster for compressible.bin, the server or the link does not compress (needs SMB 3.1.1 on both sides).'
} finally {
  Remove-Item $remote -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
