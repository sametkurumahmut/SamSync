$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $projectDirectory 'SamePathCopy.Common.ps1')

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) {
        throw "$Message Beklenen: $Expected; gerçek: $Actual"
    }
}

$roots = @('C:\Kaynak\proje', 'C:\Kaynak\simulatorexternaldata', 'D:\SimContents')
$address = '10.10.1.11'
$networkRoot = 'Sim\ActiveRelease'

function Get-Destination {
    param([string]$SourcePath, [string[]]$LocalRoots = $roots)
    return Get-SamePathCopyDestination -SourcePath $SourcePath -LocalRoots $LocalRoots -Address $address -NetworkRoot $networkRoot
}

# Her kökten gelen kaynak, göreli yolunu koruyarak aynı networkRoot altına gider.
Assert-Equal "\\$address\Sim\ActiveRelease\Data\x.entity" (Get-Destination -SourcePath 'C:\Kaynak\proje\Data\x.entity') 'İlk kökten göreli yol yanlış.'
Assert-Equal "\\$address\Sim\ActiveRelease\ses\a.wav" (Get-Destination -SourcePath 'C:\Kaynak\simulatorexternaldata\ses\a.wav') 'İkinci kökten göreli yol yanlış.'
Assert-Equal "\\$address\Sim\ActiveRelease\model\b.fbx" (Get-Destination -SourcePath 'D:\SimContents\model\b.fbx') 'Başka sürücüdeki kökten göreli yol yanlış.'

# Kökün kendisi seçilirse hedef doğrudan networkRoot olur.
Assert-Equal "\\$address\Sim\ActiveRelease" (Get-Destination -SourcePath 'C:\Kaynak\proje') 'Kökün kendisi için hedef yanlış.'
Assert-Equal "\\$address\Sim\ActiveRelease" (Get-Destination -SourcePath 'C:\Kaynak\proje\') 'Sonunda ters bölü olan kök için hedef yanlış.'

# Büyük/küçük harf farkı ve göreli yol bileşenleri eşleşmeyi bozmamalı.
Assert-Equal "\\$address\Sim\ActiveRelease\Data\x.entity" (Get-Destination -SourcePath 'c:\kaynak\PROJE\Data\x.entity') 'Büyük/küçük harf farkı eşleşmeyi bozdu.'
Assert-Equal "\\$address\Sim\ActiveRelease\Data\x.entity" (Get-Destination -SourcePath 'C:\Kaynak\proje\Alt\..\Data\x.entity') 'Göreli yol bileşenleri çözülmedi.'

# İç içe kökler: en uzun eşleşen kök kullanılır, göreli yol en yakın köke göre hesaplanır.
$nestedRoots = @('C:\Kaynak', 'C:\Kaynak\proje')
Assert-Equal "\\$address\Sim\ActiveRelease\Data\x.entity" (Get-Destination -SourcePath 'C:\Kaynak\proje\Data\x.entity' -LocalRoots $nestedRoots) 'İç içe köklerde en uzun eşleşme kullanılmadı.'
Assert-Equal "\\$address\Sim\ActiveRelease\baska\y.txt" (Get-Destination -SourcePath 'C:\Kaynak\baska\y.txt' -LocalRoots $nestedRoots) 'İç içe köklerde üst kök kullanılmadı.'

# Kökler dışındaki kaynak, sürücü harfi klasöre dönüştürülerek tam yolunu korur.
Assert-Equal "\\$address\Sim\ActiveRelease\C\Fraps\README.HTM" (Get-Destination -SourcePath 'C:\Fraps\README.HTM') 'Kök dışı yol için sürücü klasörü üretilmedi.'
Assert-Equal "\\$address\Sim\ActiveRelease\UNC\sunucu\pay\z.txt" (Get-Destination -SourcePath '\\sunucu\pay\z.txt') 'UNC kaynak için hedef yanlış.'

# Yalnızca localRoot verilmiş eski yapılandırma da çalışmalı.
$legacyNode = [pscustomobject]@{ id = 'Eski'; name = 'Eski'; localRoot = 'C:\Kaynak\proje'; networkRoot = $networkRoot }
Assert-Equal 'C:\Kaynak\proje' (@(Get-SamePathCopyLocalRoots -Node $legacyNode) -join ' ; ') 'localRoot tek başına okunamadı.'

# localRoot ve localRoots birlikte verilirse localRoot ilk kök olur ve yinelenenler tekilleşir.
$mixedNode = [pscustomobject]@{
    id = 'Karma'
    name = 'Karma'
    localRoot = 'C:\Kaynak\proje'
    localRoots = @('C:\Kaynak\simulatorexternaldata', 'C:\Kaynak\proje\', 'D:\SimContents')
    networkRoot = $networkRoot
}
Assert-Equal 'C:\Kaynak\proje ; C:\Kaynak\simulatorexternaldata ; D:\SimContents' (@(Get-SamePathCopyLocalRoots -Node $mixedNode) -join ' ; ') 'Kök listesi tekilleştirilmedi veya sıra bozuldu.'

# Kimlik nesnesi bütün kökleri taşımalı, Root ilk kökü göstermeli.
$identity = ConvertTo-SamePathCopyIdentity -Node $mixedNode
Assert-Equal 3 @($identity.Roots).Count 'Kimlik nesnesi kökleri taşımıyor.'
Assert-Equal 'C:\Kaynak\proje' ([string]$identity.Root) 'Kimlik nesnesindeki Root ilk kök olmalı.'

# Yapılandırma doğrulaması: localRoots kabul edilmeli, geçersiz kök reddedilmeli.
$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('SamePathCopy-Destination-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $temporaryDirectory)
try {
    $configPath = Join-Path $temporaryDirectory 'config.json'
    $baseConfig = @{
        version = '1.0.0'
        nodes = @(
            @{ id = 'Yerel'; name = 'Yerel'; address = '10.10.1.10'; localRoots = @('C:\Kaynak\proje', 'D:\SimContents'); networkRoot = 'Sim' }
        )
    }
    ($baseConfig | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $configPath -Encoding UTF8
    $loaded = Get-SamePathCopyConfiguration -ConfigPath $configPath
    Assert-Equal 'C:\Kaynak\proje ; D:\SimContents' (@(Get-SamePathCopyLocalRoots -Node $loaded.nodes[0]) -join ' ; ') 'localRoots yapılandırmadan okunamadı.'

    $invalidConfig = @{
        version = '1.0.0'
        nodes = @(
            @{ id = 'Yerel'; name = 'Yerel'; address = '10.10.1.10'; localRoots = @('Kaynak\proje'); networkRoot = 'Sim' }
        )
    }
    ($invalidConfig | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $configPath -Encoding UTF8
    $errorMessage = $null
    try { Get-SamePathCopyConfiguration -ConfigPath $configPath } catch { $errorMessage = [string]$_.Exception.Message }
    if ($errorMessage -notlike '*sürücü harfiyle başlayan*') {
        throw "Göreli kök yolu için hata verilmedi. Alınan: $errorMessage"
    }

    $missingRootConfig = @{
        version = '1.0.0'
        nodes = @(
            @{ id = 'Yerel'; name = 'Yerel'; address = '10.10.1.10'; networkRoot = 'Sim' }
        )
    }
    ($missingRootConfig | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $configPath -Encoding UTF8
    $errorMessage = $null
    try { Get-SamePathCopyConfiguration -ConfigPath $configPath } catch { $errorMessage = [string]$_.Exception.Message }
    if ($errorMessage -notlike '*localRoot*') {
        throw "Kök verilmediğinde hata verilmedi. Alınan: $errorMessage"
    }

    Write-Host 'Hedef yolu ve çoklu kök testleri başarılı.'
}
finally {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
}
