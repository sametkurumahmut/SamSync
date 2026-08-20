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

# Kaynak öğenin hedefte alacağı göreli yol: kökün altında kökten sonrası, kökün kendisi için boş,
# kök dışında sürücü harfi klasör adı olur.
Assert-Equal 'Data\x.entity' ([string](Get-SamePathCopySourceRelativePath -SourcePath 'C:\Kaynak\proje\Data\x.entity' -LocalRoots $roots).RelativePath) 'Kök altındaki göreli yol yanlış.'
Assert-Equal '' ([string](Get-SamePathCopySourceRelativePath -SourcePath 'C:\Kaynak\proje' -LocalRoots $roots).RelativePath) 'Kökün kendisi için göreli yol boş olmalı.'
Assert-Equal $true ([bool](Get-SamePathCopySourceRelativePath -SourcePath 'C:\Kaynak\proje\Data' -LocalRoots $roots).IsInsideLocalRoot) 'Kök altındaki öğe kök dışı sayıldı.'
Assert-Equal 'C\Fraps\README.HTM' ([string](Get-SamePathCopySourceRelativePath -SourcePath 'C:\Fraps\README.HTM' -LocalRoots $roots).RelativePath) 'Kök dışı göreli yol yanlış.'
Assert-Equal $false ([bool](Get-SamePathCopySourceRelativePath -SourcePath 'C:\Fraps\README.HTM' -LocalRoots $roots).IsInsideLocalRoot) 'Kök dışı öğe kök altında sayıldı.'

# Başlıktaki kaynak özeti: seçilen öğeler köklere göre gruplanır, sayı dökümü ve göreli yollar üretilir.
function New-FakeSourceItem {
    param([string]$FullName, [bool]$IsDirectory = $false)
    return [pscustomobject]@{ FullName = $FullName; PSIsContainer = $IsDirectory }
}

$singleSummary = Get-SamePathCopySourceSummary -SourceItems @(New-FakeSourceItem -FullName 'C:\Kaynak\proje\Data\x.entity') -LocalRoots $roots
Assert-Equal 1 ([int]$singleSummary.Count) 'Tek öğe sayısı yanlış.'
Assert-Equal 'C:\Kaynak\proje\Data\x.entity  (dosya)' ([string]$singleSummary.HeadlineText) 'Tek öğe başlığı yanlış.'
Assert-Equal 'Kaynak: 1 öğe' ([string]$singleSummary.ChipText) 'Kaynak çipi metni yanlış.'
Assert-Equal 'Yerel kök: C:\Kaynak\proje' ([string](Get-SamePathCopySourceSummary -SourceItems @(New-FakeSourceItem -FullName 'C:\Kaynak\proje\Data\x.entity') -LocalRoots @('C:\Kaynak\proje')).RootChipText) 'Tek kökte çip tam yolu göstermeli.'
Assert-Equal '3 yerel kök' ([string]$singleSummary.RootChipText) 'Çok kökte çip kök sayısını göstermeli.'
Assert-Equal 'Yerel kök tanımsız' ([string](Get-SamePathCopySourceSummary -SourceItems @(New-FakeSourceItem -FullName 'C:\Kaynak\proje\Data\x.entity')).RootChipText) 'Kök yokken çip metni yanlış.'

$sameFolderSummary = Get-SamePathCopySourceSummary -SourceItems @(
    New-FakeSourceItem -FullName 'C:\Kaynak\proje\Data\x.entity'
    New-FakeSourceItem -FullName 'C:\Kaynak\proje\Data\y.entity'
    New-FakeSourceItem -FullName 'C:\Kaynak\proje\Data\Sahneler' -IsDirectory $true
) -LocalRoots $roots
Assert-Equal 3 ([int]$sameFolderSummary.Count) 'Öğe sayısı yanlış.'
Assert-Equal 2 ([int]$sameFolderSummary.FileCount) 'Dosya sayısı yanlış.'
Assert-Equal 1 ([int]$sameFolderSummary.DirectoryCount) 'Klasör sayısı yanlış.'
Assert-Equal 'C:\Kaynak\proje\Data içinden 3 öğe (2 dosya, 1 klasör)' ([string]$sameFolderSummary.HeadlineText) 'Aynı klasördeki seçim için başlık yanlış.'
Assert-Equal 1 @($sameFolderSummary.Groups).Count 'Tek kökten gelen seçim tek grup olmalı.'

$mixedSummary = Get-SamePathCopySourceSummary -SourceItems @(
    New-FakeSourceItem -FullName 'C:\Kaynak\proje\Data\x.entity'
    New-FakeSourceItem -FullName 'C:\Kaynak\simulatorexternaldata\ses' -IsDirectory $true
    New-FakeSourceItem -FullName 'C:\Fraps\README.HTM'
) -LocalRoots $roots
Assert-Equal '3 öğe (2 dosya, 1 klasör) - 3 ayrı klasörden' ([string]$mixedSummary.HeadlineText) 'Farklı klasörlerdeki seçim için başlık yanlış.'
Assert-Equal 3 @($mixedSummary.Groups).Count 'Gruplar köklere ve kök dışına göre ayrılmadı.'
Assert-Equal 'C:\Kaynak\proje' ([string]$mixedSummary.Groups[0].Header) 'İlk grup başlığı ilk kök olmalı.'
Assert-Equal 'Data\x.entity' ([string]$mixedSummary.Groups[0].Items[0].RelativePath) 'Grup içindeki göreli yol yanlış.'
Assert-Equal 'ses' ([string]$mixedSummary.Groups[1].Items[0].RelativePath) 'İkinci kökteki göreli yol yanlış.'
Assert-Equal $false ([bool]$mixedSummary.Groups[2].IsInsideLocalRoot) 'Üçüncü grup kök dışı olmalı.'
Assert-Equal 'C\Fraps\README.HTM' ([string]$mixedSummary.Groups[2].Items[0].RelativePath) 'Kök dışı göreli yol yanlış.'
Assert-Equal 1 ([int]$mixedSummary.OutsideRootCount) 'Kök dışı öğe sayısı yanlış.'
# Kök listesi config sırasını korur; seçimden öğe düşmeyen kök de listede kalır.
Assert-Equal 3 @($mixedSummary.Roots).Count 'Kök listesi eksik.'
Assert-Equal 1 ([int]$mixedSummary.Roots[0].ItemCount) 'Kökün öğe sayısı yanlış.'
Assert-Equal 0 ([int]$mixedSummary.Roots[2].ItemCount) 'Öğesi olmayan kök için sayı sıfır olmalı.'
if (([string]$mixedSummary.ClipboardText) -notlike '*C:\Fraps\README.HTM*') { throw 'Panoya kopyalanacak metin bütün yolları içermiyor.' }

# Çok kalabalık seçimde liste kırpılır, kalan sayı bildirilir; pano metni bütün yolları taşır.
$manyItems = @(1..25 | ForEach-Object { New-FakeSourceItem -FullName ("C:\Kaynak\proje\Data\dosya{0}.txt" -f $_) })
$cappedSummary = Get-SamePathCopySourceSummary -SourceItems $manyItems -LocalRoots $roots -MaxListItems 10
Assert-Equal 25 ([int]$cappedSummary.Count) 'Kalabalık seçimde öğe sayısı yanlış.'
Assert-Equal 10 @($cappedSummary.Groups[0].Items).Count 'Liste sınırı uygulanmadı.'
Assert-Equal 15 ([int]$cappedSummary.Groups[0].HiddenCount) 'Listeye girmeyen öğe sayısı yanlış.'
Assert-Equal 15 ([int]$cappedSummary.HiddenCount) 'Toplam gizli öğe sayısı yanlış.'
Assert-Equal 25 @(([string]$cappedSummary.ClipboardText) -split "`r`n").Count 'Pano metni bütün yolları içermeli.'

# Yol listesi düz metin olarak da verilebilir (test ve otomasyon kolaylığı).
Assert-Equal 2 ([int](Get-SamePathCopySourceSummary -SourceItems @('C:\Kaynak\proje\a.txt', 'C:\Kaynak\proje\b.txt') -LocalRoots $roots).Count) 'Metin yol listesi okunamadı.'
Assert-Equal 'Kaynak seçilmedi' ([string](Get-SamePathCopySourceSummary -SourceItems @() -LocalRoots $roots).HeadlineText) 'Boş seçim başlığı yanlış.'

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

    # Yedek kökü hedefin paylaşım yolundan üretilir.
    Assert-Equal "\\10.10.1.11\Sim\ActiveRelease\$(Get-SamePathCopyBackupFolderName)" (Get-SamePathCopyBackupRoot -Address '10.10.1.11' -NetworkRoot 'Sim\ActiveRelease') 'Yedek kökü yanlış üretildi.'
    Assert-Equal "\\10.10.1.11\Sim\$(Get-SamePathCopyBackupFolderName)" (Get-SamePathCopyBackupRoot -Address '10.10.1.11' -NetworkRoot '\Sim\') 'Yedek kökünde fazla ters bölü temizlenmedi.'

    # Yedek temizliği: en yeni N tarih klasörü kalır, tarih biçiminde olmayan klasörlere dokunulmaz.
    $backupRoot = Join-Path $temporaryDirectory 'yedekler'
    foreach ($stamp in @('20260818-101500', '20260819-101500', '20260820-101500', '20260820-113000', 'elle-alinan')) {
        [void](New-Item -ItemType Directory -Path (Join-Path $backupRoot $stamp) -Force)
    }
    'x' | Set-Content -LiteralPath (Join-Path $backupRoot '20260818-101500\dosya.txt') -Encoding UTF8
    $removedNames = @(Remove-SamePathCopyOldBackups -BackupRoot $backupRoot -Keep 2)
    Assert-Equal '20260819-101500,20260818-101500' ($removedNames -join ',') 'Silinen yedekler beklenenden farklı.'
    $remaining = @(Get-ChildItem -LiteralPath $backupRoot -Directory | ForEach-Object { $_.Name } | Sort-Object)
    Assert-Equal '20260820-101500,20260820-113000,elle-alinan' ($remaining -join ',') 'Kalan yedekler beklenenden farklı.'

    # Keep 0 sınırsız demektir: hiçbir şey silinmez.
    Assert-Equal 0 @(Remove-SamePathCopyOldBackups -BackupRoot $backupRoot -Keep 0).Count 'Keep 0 iken yedek silindi.'
    # Olmayan klasör hata vermemeli.
    Assert-Equal 0 @(Remove-SamePathCopyOldBackups -BackupRoot (Join-Path $temporaryDirectory 'yok') -Keep 3).Count 'Olmayan yedek kökü hata verdi.'

    # config.json doğrulaması: backupKeep varsayılanı ve sınırları.
    $keepConfig = @{
        version = '1.0.0'
        nodes = @(@{ id = 'Yerel'; name = 'Yerel'; address = '10.10.1.10'; localRoot = 'C:\Kaynak'; networkRoot = 'Sim' })
    }
    ($keepConfig | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $configPath -Encoding UTF8
    Assert-Equal 5 ([int](Get-SamePathCopyConfiguration -ConfigPath $configPath).copy.backupKeep) 'backupKeep varsayılanı 5 olmalı.'
    $keepConfig['copy'] = @{ backupKeep = 900 }
    ($keepConfig | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $configPath -Encoding UTF8
    $keepError = $null
    try { [void](Get-SamePathCopyConfiguration -ConfigPath $configPath) } catch { $keepError = [string]$_.Exception.Message }
    if ($keepError -notlike '*backupKeep*') { throw "Sınır dışı backupKeep için hata verilmedi. Alınan: $keepError" }

    # robocopy /L çıktısı: fazla (silinecek) ve değişecek öğeler ayrıştırılmalı.
    $listingLines = @(
        '',
        '   *EXTRA File  \\ip\pay\Data\fazla.txt',
        '    New File    C:\Kaynak\Data\yeni.txt',
        '    Newer       C:\Kaynak\Data\guncel.txt',
        '   *EXTRA Dir   \\ip\pay\Data\FazlaKlasor\',
        '    Older       C:\Kaynak\Data\eski.txt',
        '  100%',
        'Toplam    Kopyalanan'
    )
    $summary = Get-SamePathCopyListingSummary -Lines $listingLines
    Assert-Equal 2 $summary.ExtraCount 'Fazla öğe sayısı yanlış.'
    Assert-Equal 3 $summary.ChangeCount 'Değişecek öğe sayısı yanlış.'
    Assert-Equal '\\ip\pay\Data\fazla.txt' ([string]$summary.Extras[0]) 'Fazla öğe yolu yanlış ayrıştırıldı.'
    Assert-Equal 'C:\Kaynak\Data\yeni.txt' ([string]$summary.Changes[0]) 'Değişecek öğe yolu yanlış ayrıştırıldı.'
    $emptySummary = Get-SamePathCopyListingSummary -Lines @()
    Assert-Equal 0 $emptySummary.ExtraCount 'Boş çıktı için fazla sayısı 0 olmalı.'

    # Listeleme kipi robocopy argümanları: /L ve dosya listesi açık, sessiz anahtarlar kapalı.
    $listingArguments = (Get-SamePathCopyRobocopyArguments -SourceDirectory 'C:\Kaynak' -DestinationDirectory '\\ip\pay' `
        -IsDirectory $true -RetryCount 0 -WaitSeconds 0 -Options ([pscustomobject]@{ Mirror = $true }) -Listing) -join ' '
    if ($listingArguments -notlike '*/L*') { throw "Listeleme kipinde /L yok: $listingArguments" }
    if ($listingArguments -notlike '*/MIR*') { throw "Listeleme kipinde ayna anahtarı korunmadı: $listingArguments" }
    if ($listingArguments -like '*/NFL*' -or $listingArguments -like '*/NDL*') { throw "Listeleme kipinde dosya listesi kapatıldı: $listingArguments" }
    if ($listingArguments -notlike '*/FP*') { throw "Listeleme kipinde tam yol (/FP) yok: $listingArguments" }

    # Kaynak boyutu: dosya ve klasör.
    $sizeDirectory = Join-Path $temporaryDirectory 'boyut'
    [void](New-Item -ItemType Directory -Path $sizeDirectory -Force)
    [System.IO.File]::WriteAllBytes((Join-Path $sizeDirectory 'a.bin'), (New-Object byte[] 1024))
    [System.IO.File]::WriteAllBytes((Join-Path $sizeDirectory 'b.bin'), (New-Object byte[] 2048))
    Assert-Equal 3072 (Get-SamePathCopySourceSize -Path $sizeDirectory) 'Klasör boyutu yanlış hesaplandı.'
    Assert-Equal 1024 (Get-SamePathCopySourceSize -Path (Join-Path $sizeDirectory 'a.bin')) 'Dosya boyutu yanlış hesaplandı.'
    Assert-Equal $null (Get-SamePathCopySourceSize -Path (Join-Path $temporaryDirectory 'yok-boyle-bir-sey')) 'Olmayan yol için boyut null olmalı.'

    # Boş alan sorgusu: yerel sürücüde bir değer dönmeli, geçersiz yolda null.
    $freeSpace = Get-SamePathCopyFreeSpace -Path $temporaryDirectory
    if ($null -eq $freeSpace -or [long]$freeSpace -le 0) { throw "Yerel sürücüde boş alan okunamadı: $freeSpace" }
    Assert-Equal $null (Get-SamePathCopyFreeSpace -Path '\\10.255.255.1\YokPaylasim') 'Erişilemeyen paylaşım için null dönmeli.'

    # Boyut biçimlendirme.
    Assert-Equal '1,0 KB' (Format-SamePathCopySize -Bytes 1024) 'KB biçimlendirme yanlış.'
    Assert-Equal '512 B' (Format-SamePathCopySize -Bytes 512) 'Bayt biçimlendirme yanlış.'
    Assert-Equal '2,0 GB' (Format-SamePathCopySize -Bytes (2GB)) 'GB biçimlendirme yanlış.'

    # Kopyalama sonrası komut kalıbı: yer tutucular hedef bilgileriyle dolmalı.
    $commandTarget = [pscustomobject]@{ id = 'Unit1IG1'; name = 'IG1'; address = '10.10.1.11'; networkRoot = 'Sim\ActiveRelease' }
    $expandedCommand = Expand-SamePathCopyCommandTemplate -Template 'schtasks /run /s {address} /tn "Yeniden Baslat" & echo {targetId} {targetName} {networkRoot} {destination} {source}' `
        -Target $commandTarget -Destination '\\10.10.1.11\Sim\ActiveRelease\Data' -Source 'C:\Kaynak\Data'
    if ($expandedCommand -notlike '*/s 10.10.1.11*') { throw "address yer tutucusu dolmadı: $expandedCommand" }
    if ($expandedCommand -notlike '*Unit1IG1 IG1 Sim\ActiveRelease*') { throw "hedef bilgileri dolmadı: $expandedCommand" }
    if ($expandedCommand -notlike '*\\10.10.1.11\Sim\ActiveRelease\Data C:\Kaynak\Data*') { throw "yol yer tutucuları dolmadı: $expandedCommand" }

    # config.json doğrulaması: postCommand varsayılanı boş, zaman aşımı sınırlı.
    $commandConfig = @{
        version = '1.0.0'
        nodes = @(@{ id = 'Yerel'; name = 'Yerel'; address = '10.10.1.10'; localRoot = 'C:\Kaynak'; networkRoot = 'Sim' })
    }
    ($commandConfig | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $configPath -Encoding UTF8
    $loadedCommandConfig = Get-SamePathCopyConfiguration -ConfigPath $configPath
    Assert-Equal '' ([string]$loadedCommandConfig.copy.postCommand) 'postCommand varsayılanı boş olmalı.'
    Assert-Equal 60 ([int]$loadedCommandConfig.copy.postCommandTimeoutSeconds) 'postCommandTimeoutSeconds varsayılanı 60 olmalı.'
    $commandConfig['copy'] = @{ postCommandTimeoutSeconds = 99999 }
    ($commandConfig | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $configPath -Encoding UTF8
    $commandError = $null
    try { [void](Get-SamePathCopyConfiguration -ConfigPath $configPath) } catch { $commandError = [string]$_.Exception.Message }
    if ($commandError -notlike '*postCommandTimeoutSeconds*') { throw "Sınır dışı zaman aşımı için hata verilmedi: $commandError" }

    Write-Host 'Hedef yolu ve çoklu kök testleri başarılı.'
}
finally {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
}
