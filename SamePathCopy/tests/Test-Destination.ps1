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

    # Listeleme özeti sınıf dökümü: "Older" hedefte daha yeni dosya demektir, ayrı sayılmalı.
    $listingLines = @(
        '   New File              C:\x\a.txt'
        '   New Dir               C:\x\Alt\'
        '   Newer                 C:\x\b.txt'
        '   Older                 C:\x\c.txt'
        '   Changed               C:\x\d.txt'
        '  *EXTRA File            C:\y\z.txt'
    )
    $listingSummary = Get-SamePathCopyListingSummary -Lines $listingLines
    Assert-Equal 5 ([int]$listingSummary.ChangeCount) 'Değişecek öğe sayısı yanlış.'
    Assert-Equal 2 ([int]$listingSummary.NewCount) 'Yeni öğe sayısı yanlış (dosya + klasör).'
    Assert-Equal 1 ([int]$listingSummary.NewerCount) 'Kaynak daha yeni sayısı yanlış.'
    Assert-Equal 1 ([int]$listingSummary.OlderCount) 'Hedef daha yeni sayısı yanlış.'
    Assert-Equal 1 ([int]$listingSummary.ChangedCount) 'Boyutu farklı sayısı yanlış.'
    Assert-Equal 1 ([int]$listingSummary.ExtraCount) 'Fazlalık sayısı yanlış.'

    # Rozet metni: incelemenin durumlarını kısa metne ve fırçaya çevirir.
    function New-FakeInspection {
        param([int]$ItemCount = 1, [int]$Missing = 0, [int]$Change = 0, [int]$New = 0, [int]$Newer = 0,
            [int]$Older = 0, [int]$Changed = 0, [int]$Extra = 0, [bool]$Failed = $false)
        return [pscustomobject]@{
            TargetId = 'T'; ItemCount = $ItemCount; MissingCount = $Missing; ChangeCount = $Change
            NewCount = $New; NewerCount = $Newer; OlderCount = $Older; ChangedCount = $Changed
            ExtraCount = $Extra; Failed = $Failed
        }
    }
    Assert-Equal 'aynı' ([string](Get-SamePathCopyInspectionText -Inspection (New-FakeInspection)).Text) 'Fark yokken rozet "aynı" olmalı.'
    Assert-Equal 'SuccessBrush' ([string](Get-SamePathCopyInspectionText -Inspection (New-FakeInspection)).Brush) 'Aynı rozeti yeşil olmalı.'
    Assert-Equal 'hedefte yok' ([string](Get-SamePathCopyInspectionText -Inspection (New-FakeInspection -ItemCount 2 -Missing 2)).Text) 'Hepsi yokken rozet "hedefte yok" olmalı.'
    Assert-Equal '3 değişecek' ([string](Get-SamePathCopyInspectionText -Inspection (New-FakeInspection -Change 3 -New 3)).Text) 'Değişecek rozeti yanlış.'
    Assert-Equal '2 değişecek, 1 öğe yok' ([string](Get-SamePathCopyInspectionText -Inspection (New-FakeInspection -ItemCount 2 -Missing 1 -Change 2 -New 2)).Text) 'Karışık rozet yanlış.'
    $olderBadge = Get-SamePathCopyInspectionText -Inspection (New-FakeInspection -Change 2 -Older 1 -Newer 1)
    Assert-Equal '! 2 değişecek' ([string]$olderBadge.Text) 'Hedef daha yeniyken rozet ünlemle başlamalı.'
    Assert-Equal 'WarningBrush' ([string]$olderBadge.Brush) 'Hedef daha yeniyken rozet uyarı renginde olmalı.'
    if (([string]$olderBadge.ToolTip) -notlike '*hedef daha yeni (üzerine yazılır): 1*') { throw "Rozet ipucunda üzerine yazma uyarısı yok: $($olderBadge.ToolTip)" }
    Assert-Equal 'inceleme hatası' ([string](Get-SamePathCopyInspectionText -Inspection (New-FakeInspection -Failed $true)).Text) 'Hata rozeti yanlış.'
    $sameWithExtras = Get-SamePathCopyInspectionText -Inspection (New-FakeInspection -Extra 4)
    Assert-Equal 'aynı' ([string]$sameWithExtras.Text) 'Yalnızca fazlalık varken rozet "aynı" kalmalı.'
    if (([string]$sameWithExtras.ToolTip) -notlike '*fazladan: 4*') { throw "Aynı rozetinin ipucunda fazlalık sayısı yok: $($sameWithExtras.ToolTip)" }

    # Satır dökümü: her sınıf satırı sırasıyla girdiye çevrilir, yıldızlı adlar tekilleştirilir.
    Assert-Equal 6 @($listingSummary.Entries).Count 'Listeleme girdileri eksik.'
    Assert-Equal 'New File' ([string]$listingSummary.Entries[0].Class) 'İlk girdinin sınıfı yanlış.'
    Assert-Equal 'C:\x\a.txt' ([string]$listingSummary.Entries[0].Path) 'İlk girdinin yolu yanlış.'
    Assert-Equal $false ([bool]$listingSummary.Entries[0].IsDirectory) 'Dosya girdisi klasör sayıldı.'
    Assert-Equal 'New Dir' ([string]$listingSummary.Entries[1].Class) 'Klasör girdisinin sınıfı yanlış.'
    Assert-Equal $true ([bool]$listingSummary.Entries[1].IsDirectory) 'Klasör girdisi dosya sayıldı.'
    Assert-Equal 'Extra File' ([string]$listingSummary.Entries[5].Class) 'Fazlalık sınıfı "Extra File" olarak yazılmalı.'

    # /NS verilmediğinde robocopy klasör satırlarına dosya sayısı (fazlalıkta -1) koyuyor; yol bundan ayrılmalı.
    $countedSummary = Get-SamePathCopyListingSummary -Lines @(
        '   New Dir             4    C:\x\Alt\'
        '  *EXTRA Dir          -1    \\ip\pay\Fazla\'
        '   New File          1024    C:\x\b.txt'
        '        C:\x\'
        'Toplam    Kopyalanan'
    )
    Assert-Equal 3 @($countedSummary.Entries).Count 'Sayı taşıyan satırlar ayrıştırılamadı.'
    Assert-Equal 'C:\x\Alt\' ([string]$countedSummary.Entries[0].Path) 'Klasör satırındaki dosya sayısı yola karıştı.'
    Assert-Equal '\\ip\pay\Fazla\' ([string]$countedSummary.Entries[1].Path) 'Fazlalık satırındaki -1 yola karıştı.'
    Assert-Equal 'C:\x\b.txt' ([string]$countedSummary.Entries[2].Path) 'Dosya satırındaki boyut yola karıştı.'

    # Sınıf gösterimi: işaret, metin ve fırça. Ayna açıkken fazlalık "silinecek" olur ve kırmızıya döner.
    Assert-Equal '+' ([string](Get-SamePathCopyChangeClassInfo -Class 'New File').Sign) 'Yeni dosya işareti + olmalı.'
    Assert-Equal 'SuccessBrush' ([string](Get-SamePathCopyChangeClassInfo -Class 'New File').Brush) 'Yeni dosya yeşil olmalı.'
    Assert-Equal '~' ([string](Get-SamePathCopyChangeClassInfo -Class 'Newer').Sign) 'Güncellenecek dosya işareti ~ olmalı.'
    Assert-Equal '~' ([string](Get-SamePathCopyChangeClassInfo -Class 'Changed').Sign) 'Boyutu farklı dosya işareti ~ olmalı.'
    Assert-Equal '!' ([string](Get-SamePathCopyChangeClassInfo -Class 'Older').Sign) 'Hedef daha yeni işareti ! olmalı.'
    Assert-Equal 'WarningBrush' ([string](Get-SamePathCopyChangeClassInfo -Class 'Older').Brush) 'Hedef daha yeni uyarı renginde olmalı.'
    Assert-Equal 'hedefte fazla' ([string](Get-SamePathCopyChangeClassInfo -Class 'Extra File').Text) 'Ayna kapalıyken fazlalık silinmiyor.'
    Assert-Equal 'TextMutedBrush' ([string](Get-SamePathCopyChangeClassInfo -Class 'Extra File').Brush) 'Ayna kapalıyken fazlalık soluk olmalı.'
    Assert-Equal 'silinecek' ([string](Get-SamePathCopyChangeClassInfo -Class 'Extra File' -MirrorEnabled $true).Text) 'Ayna açıkken fazlalık silinecek demeli.'
    Assert-Equal 'DangerBrush' ([string](Get-SamePathCopyChangeClassInfo -Class 'Extra File' -MirrorEnabled $true).Brush) 'Ayna açıkken fazlalık kırmızı olmalı.'
    Assert-Equal '?' ([string](Get-SamePathCopyChangeClassInfo -Class 'BilinmeyenSinif').Sign) 'Bilinmeyen sınıf işareti ? olmalı.'

    # Yol eşlemesi: kaynak kökünden hedef köküne (ve tersine) taşıma, kökün kendisi ve kök dışı yol.
    Assert-Equal '\\ip\pay\Alt\a.txt' (Get-SamePathCopyMappedPath -Path 'C:\Kaynak\Alt\a.txt' -FromRoot 'C:\Kaynak' -ToRoot '\\ip\pay') 'Yol hedefe eşlenemedi.'
    Assert-Equal '\\ip\pay' (Get-SamePathCopyMappedPath -Path 'C:\Kaynak\' -FromRoot 'C:\Kaynak' -ToRoot '\\ip\pay') 'Kökün kendisi eşlenemedi.'
    Assert-Equal 'D:\Baska\a.txt' (Get-SamePathCopyMappedPath -Path 'D:\Baska\a.txt' -FromRoot 'C:\Kaynak' -ToRoot '\\ip\pay') 'Kök dışı yol değiştirilmemeli.'
    Assert-Equal 'Alt\a.txt' (Get-SamePathCopyPathUnderRoot -Path 'C:\Kaynak\Alt\a.txt' -Root 'C:\Kaynak\') 'Kök altındaki yol çıkarılamadı.'
    Assert-Equal '' (Get-SamePathCopyPathUnderRoot -Path 'C:\Kaynak' -Root 'C:\Kaynak') 'Kökün kendisi için boş metin dönmeli.'
    Assert-Equal 'C:\' (Get-SamePathCopyTrimmedPath -Path 'C:\') 'Sürücü kökündeki ters bölü korunmalı.'
    Assert-Equal 'C:\Kaynak' (Get-SamePathCopyTrimmedPath -Path 'C:\Kaynak\') 'Sondaki ters bölü atılmalı.'

    # Hedef inceleme gerçek robocopy ile: yerel yönetim paylaşımı üzerinden üç durum sınanır.
    $inspectRoot = Join-Path $temporaryDirectory 'incele'
    $inspectSource = Join-Path $inspectRoot 'kaynak\Data'
    [void](New-Item -ItemType Directory -Path (Join-Path $inspectSource 'Alt') -Force)
    Set-Content -LiteralPath (Join-Path $inspectSource 'bir.txt') -Value 'bir' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $inspectSource 'Alt\iki.txt') -Value 'iki' -Encoding UTF8

    function New-InspectTarget {
        param([string]$Id, [string]$LocalPath)
        return [pscustomobject]@{ id = $Id; name = $Id; address = '127.0.0.1'; networkRoot = ("C$\" + $LocalPath.Substring(3)) }
    }
    $inspectRoots = @((Join-Path $inspectRoot 'kaynak'))
    $inspectItems = @(Get-Item -LiteralPath $inspectSource)

    # Hedef 1: birebir kopya + hedefte fazladan bir dosya -> "aynı", fazlalık ipucunda.
    $sameTargetPath = Join-Path $inspectRoot 'hedefAyni'
    [void](New-Item -ItemType Directory -Path $sameTargetPath -Force)
    $robocopyOutput = robocopy $inspectSource (Join-Path $sameTargetPath 'Data') /E /COPY:DAT /FFT /R:0 /W:0
    Set-Content -LiteralPath (Join-Path $sameTargetPath 'Data\fazla.txt') -Value 'fazla' -Encoding UTF8
    $sameInspection = Invoke-SamePathCopyTargetInspection -SourceItems $inspectItems -LocalRoots $inspectRoots `
        -Target (New-InspectTarget -Id 'Ayni' -LocalPath $sameTargetPath)
    Assert-Equal 0 ([int]$sameInspection.ChangeCount) 'Birebir kopyada değişecek öğe olmamalı.'
    Assert-Equal 0 ([int]$sameInspection.MissingCount) 'Birebir kopyada eksik öğe olmamalı.'
    Assert-Equal 1 ([int]$sameInspection.ExtraCount) 'Hedefteki fazladan dosya sayılmadı.'
    Assert-Equal 'aynı' ([string](Get-SamePathCopyInspectionText -Inspection $sameInspection).Text) 'Birebir kopyanın rozeti "aynı" olmalı.'

    # Hedef 2: hiç yok -> "hedefte yok".
    $missingTargetPath = Join-Path $inspectRoot 'hedefYok'
    [void](New-Item -ItemType Directory -Path $missingTargetPath -Force)
    $missingInspection = Invoke-SamePathCopyTargetInspection -SourceItems $inspectItems -LocalRoots $inspectRoots `
        -Target (New-InspectTarget -Id 'Yok' -LocalPath $missingTargetPath)
    Assert-Equal 1 ([int]$missingInspection.MissingCount) 'Olmayan hedef "yok" sayılmadı.'
    Assert-Equal 'hedefte yok' ([string](Get-SamePathCopyInspectionText -Inspection $missingInspection).Text) 'Olmayan hedefin rozeti yanlış.'

    # Hedef 3: hedefteki dosya kaynaktan daha yeni -> "Older" sınıfı, uyarılı rozet.
    $newerTargetPath = Join-Path $inspectRoot 'hedefYeni'
    [void](New-Item -ItemType Directory -Path $newerTargetPath -Force)
    $robocopyOutput = robocopy $inspectSource (Join-Path $newerTargetPath 'Data') /E /COPY:DAT /FFT /R:0 /W:0
    (Get-Item -LiteralPath (Join-Path $newerTargetPath 'Data\bir.txt')).LastWriteTime = (Get-Date).AddHours(2)
    $newerInspection = Invoke-SamePathCopyTargetInspection -SourceItems $inspectItems -LocalRoots $inspectRoots `
        -Target (New-InspectTarget -Id 'Yeni' -LocalPath $newerTargetPath)
    Assert-Equal 1 ([int]$newerInspection.OlderCount) 'Hedefteki daha yeni dosya "Older" olarak sayılmadı.'
    $newerBadge = Get-SamePathCopyInspectionText -Inspection $newerInspection
    Assert-Equal 'WarningBrush' ([string]$newerBadge.Brush) 'Hedef daha yeniyken rozet uyarı renginde olmalı.'
    if (([string]$newerBadge.Text) -notlike '!*') { throw "Hedef daha yeniyken rozet ünlem taşımalı: $($newerBadge.Text)" }

    # Hedef başına dosya listesi gerçek robocopy ile: yeni, güncellenecek, hedefte fazla ve hedef
    # daha yeni durumlarının hepsi tek listede görünmeli. Hedefe hiçbir şey yazılmamalı.
    $diffRoot = Join-Path $temporaryDirectory 'fark'
    $diffSource = Join-Path $diffRoot 'kaynak\Data'
    [void](New-Item -ItemType Directory -Path (Join-Path $diffSource 'Alt') -Force)
    Set-Content -LiteralPath (Join-Path $diffSource 'ayni.txt') -Value 'ayni' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $diffSource 'guncel.txt') -Value 'kaynak surumu' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $diffSource 'Alt\yeni.txt') -Value 'yeni' -Encoding UTF8
    $diffTargetPath = Join-Path $diffRoot 'hedef'
    [void](New-Item -ItemType Directory -Path (Join-Path $diffTargetPath 'Data') -Force)
    Set-Content -LiteralPath (Join-Path $diffTargetPath 'Data\ayni.txt') -Value 'ayni' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $diffTargetPath 'Data\guncel.txt') -Value 'hedef surumu (eski)' -Encoding UTF8
    (Get-Item -LiteralPath (Join-Path $diffTargetPath 'Data\guncel.txt')).LastWriteTime = (Get-Date).AddHours(-4)
    Set-Content -LiteralPath (Join-Path $diffTargetPath 'Data\fazla.txt') -Value 'fazla' -Encoding UTF8

    $diffTarget = New-InspectTarget -Id 'Fark' -LocalPath $diffTargetPath
    $fileDiff = Get-SamePathCopyTargetFileDiff -SourceItems @(Get-Item -LiteralPath $diffSource) `
        -LocalRoots @((Join-Path $diffRoot 'kaynak')) -Target $diffTarget -MirrorEnabled $true
    Assert-Equal $false ([bool]$fileDiff.Failed) 'Dosya listesi robocopy hatası verdi.'
    $diffByPath = @{}
    foreach ($entry in @($fileDiff.Entries)) { $diffByPath[[string]$entry.DisplayPath] = $entry }
    if ($diffByPath.ContainsKey('ayni.txt')) { throw 'Hedefle aynı olan dosya listeye girmemeli.' }
    Assert-Equal 'Newer' ([string]$diffByPath['guncel.txt'].Class) 'Kaynağı yeni olan dosya "Newer" olmalı.'
    Assert-Equal '~' ([string]$diffByPath['guncel.txt'].Sign) 'Güncellenecek dosyanın işareti ~ olmalı.'
    Assert-Equal 'New File' ([string]$diffByPath['Alt\yeni.txt'].Class) 'Hedefte olmayan dosya "New File" olmalı.'
    Assert-Equal $true ([bool]$diffByPath['Alt\'].IsDirectory) 'Hedefte olmayan klasör satırı klasör olmalı.'
    Assert-Equal 'Extra File' ([string]$diffByPath['fazla.txt'].Class) 'Hedefteki fazla dosya listeye girmedi.'
    Assert-Equal 'silinecek' ([string]$diffByPath['fazla.txt'].StatusText) 'Ayna açıkken fazlalık "silinecek" demeli.'
    Assert-Equal 1 ([int]$fileDiff.UpdateCount) 'Güncellenecek sayısı yanlış.'
    Assert-Equal 2 ([int]$fileDiff.NewCount) 'Yeni sayısı yanlış (dosya + klasör).'
    Assert-Equal 1 ([int]$fileDiff.ExtraCount) 'Fazlalık sayısı yanlış.'
    Assert-Equal 0 ([int]$fileDiff.HiddenCount) 'Küçük listede kırpma olmamalı.'

    # Kaynak tarafındaki girdi kaynak yolunu, hedefteki fazlalık hedef yolunu düşürme anahtarı yapar.
    Assert-Equal (Join-Path $diffSource 'guncel.txt') ([string]$diffByPath['guncel.txt'].ExcludePath) 'Kaynak girdisinin düşürme yolu kaynak olmalı.'
    if (([string]$diffByPath['fazla.txt'].ExcludePath) -notlike '\\127.0.0.1\*') { throw "Fazlalığın düşürme yolu hedef paylaşımı olmalı: $($diffByPath['fazla.txt'].ExcludePath)" }
    if (([string]$diffByPath['guncel.txt'].DestinationPath) -notlike '\\127.0.0.1\*Data\guncel.txt') { throw "Girdinin hedef yolu yanlış: $($diffByPath['guncel.txt'].DestinationPath)" }
    if ([long]$diffByPath['guncel.txt'].Size -le 0) { throw 'Kaynak dosyasının boyutu okunmadı.' }
    if (Test-Path -LiteralPath (Join-Path $diffTargetPath 'Data\Alt')) { throw 'Listeleme hedefe yazdı.' }

    # Özet metni: sıfır olan sınıflar yazılmaz, ayna kapalıyken fazlalık silinmiş gibi anlatılmaz.
    Assert-Equal '+2 yeni  •  ~1 güncellenecek  •  -1 silinecek' (Get-SamePathCopyFileDiffSummaryText -Diff $fileDiff) 'Ayna açık özet metni yanlış.'
    $fileDiffNoMirror = Get-SamePathCopyTargetFileDiff -SourceItems @(Get-Item -LiteralPath $diffSource) `
        -LocalRoots @((Join-Path $diffRoot 'kaynak')) -Target $diffTarget
    Assert-Equal '+2 yeni  •  ~1 güncellenecek  •  -1 hedefte fazla' (Get-SamePathCopyFileDiffSummaryText -Diff $fileDiffNoMirror) 'Ayna kapalı özet metni yanlış.'

    # Hedef hiç yoksa robocopy her şeyi yeni sayar: öğenin kendisi de satır olarak görünür.
    $emptyTargetPath = Join-Path $diffRoot 'bosHedef'
    [void](New-Item -ItemType Directory -Path $emptyTargetPath -Force)
    $missingDiff = Get-SamePathCopyTargetFileDiff -SourceItems @(Get-Item -LiteralPath $diffSource) `
        -LocalRoots @((Join-Path $diffRoot 'kaynak')) -Target (New-InspectTarget -Id 'BosHedef' -LocalPath $emptyTargetPath)
    Assert-Equal 0 ([int]$missingDiff.SameItemCount) 'Hedefte hiç olmayan öğe "aynı" sayılmamalı.'
    if (@($missingDiff.Entries | Where-Object { [string]$_.DisplayPath -eq 'Data\' }).Count -ne 1) {
        throw "Hedefte olmayan kök klasör kendi adıyla listelenmeli: $(@($missingDiff.Entries | ForEach-Object { $_.DisplayPath }) -join ', ')"
    }

    # Hedef kaynakla birebir aynıysa liste boş kalır ve öğe "aynı" sayılır.
    $sameDiffTargetPath = Join-Path $diffRoot 'ayniHedef'
    [void](New-Item -ItemType Directory -Path $sameDiffTargetPath -Force)
    $robocopyOutput = robocopy $diffSource (Join-Path $sameDiffTargetPath 'Data') /E /COPY:DAT /FFT /R:0 /W:0
    $sameDiff = Get-SamePathCopyTargetFileDiff -SourceItems @(Get-Item -LiteralPath $diffSource) `
        -LocalRoots @((Join-Path $diffRoot 'kaynak')) -Target (New-InspectTarget -Id 'AyniHedef' -LocalPath $sameDiffTargetPath)
    Assert-Equal 0 @($sameDiff.Entries).Count 'Birebir kopyada liste boş olmalı.'
    Assert-Equal 1 ([int]$sameDiff.SameItemCount) 'Birebir kopyada öğe "aynı" sayılmalı.'
    Assert-Equal 'hedef kaynakla aynı' (Get-SamePathCopyFileDiffSummaryText -Diff $sameDiff) 'Fark yokken özet metni yanlış.'

    # Kalabalık listede kırpma: sınır kadar satır girer, kalanı sayı olarak bildirilir.
    $cappedDiff = Get-SamePathCopyTargetFileDiff -SourceItems @(Get-Item -LiteralPath $diffSource) `
        -LocalRoots @((Join-Path $diffRoot 'kaynak')) -Target (New-InspectTarget -Id 'Kirpik' -LocalPath $emptyTargetPath) -MaxEntries 2
    Assert-Equal 2 @($cappedDiff.Entries).Count 'Satır sınırı uygulanmadı.'
    Assert-Equal $true ([bool]$cappedDiff.Truncated) 'Kırpılan liste bildirilmedi.'
    if ([int]$cappedDiff.HiddenCount -le 0) { throw 'Listeye girmeyen satır sayısı bildirilmedi.' }
    # Sayılar listeleme özetinden toplandığı için kırpma onları eksiltmemeli (rozet doğru kalsın).
    Assert-Equal ([int]$missingDiff.NewCount) ([int]$cappedDiff.NewCount) 'Liste kırpılınca sınıf sayıları eksildi.'

    # Dosya listesi "Hedefte" kolonundaki rozete de çevrilebilmeli: satıra tıklayan kullanıcı kolonu boş görmez.
    $diffInspection = Get-SamePathCopyFileDiffInspection -Diff $fileDiff
    Assert-Equal 3 ([int]$diffInspection.ChangeCount) 'Rozet için değişecek sayısı yanlış (2 yeni + 1 güncellenecek).'
    Assert-Equal 1 ([int]$diffInspection.ExtraCount) 'Rozet için fazlalık sayısı yanlış.'
    Assert-Equal '3 değişecek' ([string](Get-SamePathCopyInspectionText -Inspection $diffInspection).Text) 'Dosya listesinden üretilen rozet metni yanlış.'
    $sameDiffInspection = Get-SamePathCopyFileDiffInspection -Diff $sameDiff
    Assert-Equal 'aynı' ([string](Get-SamePathCopyInspectionText -Inspection $sameDiffInspection).Text) 'Fark yokken rozet "aynı" olmalı.'

    # Erişilemeyen hedefte robocopy zaman aşımına düşer: liste hata döner, süreç kilitlenmez.
    $unreachableDiff = Get-SamePathCopyTargetFileDiff -SourceItems @(Get-Item -LiteralPath $diffSource) `
        -LocalRoots @((Join-Path $diffRoot 'kaynak')) `
        -Target ([pscustomobject]@{ id = 'Yok'; name = 'Yok'; address = '10.255.255.1'; networkRoot = 'Sim' }) -TimeoutSeconds 6
    # robocopy erişilemeyen paylaşımda hızlı dönüyor ama çıkış kodu 8'in altında kalabiliyor ve her şeyi
    # "yeni" sayıyor: hata günlükteki "ERROR nn (0x...)" satırından anlaşılıyor ve özete yazılıyor.
    Assert-Equal $true ([bool]$unreachableDiff.Failed) 'Erişilemeyen hedef hata olarak dönmeli.'
    if ((Get-SamePathCopyFileDiffSummaryText -Diff $unreachableDiff) -notlike '*liste eksik olabilir*') {
        throw "Hata durumunda özet listenin eksik olabileceğini söylemeli: $(Get-SamePathCopyFileDiffSummaryText -Diff $unreachableDiff)"
    }
    Assert-Equal 'liste alınamadı' (Get-SamePathCopyFileDiffSummaryText -Diff ([pscustomobject]@{
        Failed = $true; Entries = @(); NewCount = 0; UpdateCount = 0; OlderCount = 0; ExtraCount = 0
        Truncated = $false; HiddenCount = 0; MirrorEnabled = $false })) 'Hiç satır gelmeyen hatada özet metni yanlış.'

    # Yol bazlı hariç tutma: ayrıntı tablosunda düşürülen yollar /XF ve /XD listelerine eklenmeli.
    $pathExcludeArguments = (Get-SamePathCopyRobocopyArguments -SourceDirectory 'C:\Kaynak' -DestinationDirectory '\\ip\pay' `
        -IsDirectory $true -RetryCount 0 -WaitSeconds 0 -Options ([pscustomobject]@{
            ExcludeFiles = '*.tmp'
            ExcludeFilePaths = @('C:\Kaynak\a.txt', '\\ip\pay\fazla.txt')
            ExcludeDirectoryPaths = @('C:\Kaynak\Alt')
        })) -join ' '
    if ($pathExcludeArguments -notlike '*/XF "*.tmp" "C:\Kaynak\a.txt" "\\ip\pay\fazla.txt"*') { throw "Düşürülen dosya yolları /XF listesine eklenmedi: $pathExcludeArguments" }
    if ($pathExcludeArguments -notlike "*/XD `"$(Get-SamePathCopyBackupFolderName)`" `"C:\Kaynak\Alt`"*") { throw "Düşürülen klasör yolu /XD listesine eklenmedi: $pathExcludeArguments" }
    $noPathExcludeArguments = (Get-SamePathCopyRobocopyArguments -SourceDirectory 'C:\Kaynak' -DestinationDirectory '\\ip\pay' `
        -IsDirectory $true -RetryCount 0 -WaitSeconds 0 -Options ([pscustomobject]@{ ExcludeFilePaths = @(); ExcludeDirectoryPaths = @() })) -join ' '
    if ($noPathExcludeArguments -like '*/XF*') { throw "Boş düşürme listesi için /XF eklendi: $noPathExcludeArguments" }

    Write-Host 'Hedef yolu ve çoklu kök testleri başarılı.'
}
finally {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
}
