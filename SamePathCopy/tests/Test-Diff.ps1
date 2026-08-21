$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $projectDirectory 'SamePathCopy.Common.ps1')
. (Join-Path $projectDirectory 'SamePathCopy.Diff.ps1')

# Karşılaştırma katmanı: satır farkı hesabı saf işlev olarak, dosya karşılaştırması gerçek dosyalarla,
# pencere ise ayrı bir powershell -sta sürecinde (WPF STA gerektiriyor) sınanır.
$testDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('SamePathCopy-Diff-' + [guid]::NewGuid().ToString('N'))

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) {
        throw "$Message Beklenen: $Expected; gerçek: $Actual"
    }
}

function Get-DiffText {
    param($Diff)
    # Farkı tek satırlık bir dizeye indirir: "@" atlanan blok, "-" hedeften kalkan, "+" eklenen satır.
    return (@(@($Diff.Lines) | ForEach-Object {
        if ([string]$_.Kind -eq 'Skip') { "@{0}" -f [int]$_.Count } else { "{0}{1}" -f ([string]$_.Sign).Trim(), [string]$_.Text }
    }) -join '|')
}

[void](New-Item -ItemType Directory -Path $testDirectory)
try {
    # Ortasında tek satır değişen dosya: değişiklik hem kalkan hem eklenen satır olarak görünür.
    $simpleDiff = Get-SamePathCopyTextDiff -SourceLines @('a', 'b', 'YENI', 'c') -DestinationLines @('a', 'b', 'ESKI', 'c')
    Assert-Equal 1 ([int]$simpleDiff.AddedCount) 'Eklenen satır sayısı yanlış.'
    Assert-Equal 1 ([int]$simpleDiff.RemovedCount) 'Kalkan satır sayısı yanlış.'
    Assert-Equal 'a|b|-ESKI|+YENI|c' (Get-DiffText -Diff $simpleDiff) 'Fark satırları beklenenden farklı.'
    Assert-Equal 'tamam' ([string]$simpleDiff.Reason) 'Başarılı farkın nedeni "tamam" olmalı.'

    # Satır numaraları: kalkan satır hedefteki, eklenen satır kaynaktaki numarayı taşır.
    $numberedLine = @(@($simpleDiff.Lines) | Where-Object { [string]$_.Kind -eq 'Added' })[0]
    Assert-Equal 3 ([int]$numberedLine.SourceNumber) 'Eklenen satırın kaynak numarası yanlış.'
    Assert-Equal $null $numberedLine.DestinationNumber 'Eklenen satırın hedef numarası olmamalı.'

    # Karşılaştırma büyük/küçük harfe duyarlı olmalı: -eq harf ayırmadığı için -ceq kullanılıyor.
    Assert-Equal 1 ([int](Get-SamePathCopyTextDiff -SourceLines @('Abc') -DestinationLines @('abc')).AddedCount) 'Harf farkı değişiklik sayılmadı.'

    # Aynı içerik: fark yok denir, satır üretilmez.
    $identicalDiff = Get-SamePathCopyTextDiff -SourceLines @('a', 'b') -DestinationLines @('a', 'b')
    Assert-Equal $true ([bool]$identicalDiff.Identical) 'Aynı dosya "aynı" sayılmadı.'
    Assert-Equal 'ayni' ([string]$identicalDiff.Reason) 'Aynı dosyanın nedeni "ayni" olmalı.'
    Assert-Equal 0 @($identicalDiff.Lines).Count 'Aynı dosyada satır üretilmemeli.'

    # Hedefte hiç olmayan dosya: bütün satırlar eklenir. Kaynakta olmayan (hedefte fazla) dosya: hepsi kalkar.
    Assert-Equal 2 ([int](Get-SamePathCopyTextDiff -SourceLines @('a', 'b') -DestinationLines @()).AddedCount) 'Yeni dosyanın bütün satırları eklenmeli.'
    Assert-Equal 2 ([int](Get-SamePathCopyTextDiff -SourceLines @() -DestinationLines @('a', 'b')).RemovedCount) 'Fazla dosyanın bütün satırları kalkmalı.'

    # Uzun ortak bloklar bağlam satırına indirilir: 30 satırlık dosyada tek değişiklik çevresi görünür.
    $contextDiff = Get-SamePathCopyTextDiff -SourceLines @(1..30 | ForEach-Object { "satir$_" }) `
        -DestinationLines @(1..30 | ForEach-Object { if ($_ -eq 15) { 'DEGISTI' } else { "satir$_" } }) -ContextLines 3
    Assert-Equal 'DEGISTI' ([string]@(@($contextDiff.Lines) | Where-Object { [string]$_.Kind -eq 'Removed' })[0].Text) 'Değişen satır bulunamadı.'
    Assert-Equal 10 @($contextDiff.Lines).Count 'Bağlam kırpması beklenen satır sayısını vermedi (2 atlama + 6 bağlam + 2 değişiklik olmalı).'
    Assert-Equal '@11' (@(@($contextDiff.Lines) | ForEach-Object { if ([string]$_.Kind -eq 'Skip') { "@{0}" -f [int]$_.Count } }) | Select-Object -First 1) 'Baştaki atlanan satır sayısı yanlış.'
    Assert-Equal 12 ([int]@($contextDiff.Lines)[1].SourceNumber) 'Bağlam satırının numarası dosyadaki gerçek numara olmalı.'

    # Değişen bölüm çok büyükse satır farkı hesaplanmaz (LCS tablosu satır sayısının karesi kadar yer tutuyor).
    $bigDiff = Get-SamePathCopyTextDiff -SourceLines @(1..40 | ForEach-Object { "x$_" }) `
        -DestinationLines @(1..40 | ForEach-Object { "y$_" }) -MaxCompareLines 10
    Assert-Equal 'buyuk' ([string]$bigDiff.Reason) 'Sınırı aşan farkın nedeni "buyuk" olmalı.'
    Assert-Equal 0 @($bigDiff.Lines).Count 'Sınırı aşan farkta satır üretilmemeli.'
    if (([string]$bigDiff.ReasonText) -notlike '*40*') { throw "Sınır aşımı iletisinde satır sayısı yok: $($bigDiff.ReasonText)" }

    # Çıktı sınırı: çok uzun fark listesi kesilir ve bildirilir.
    $longDiff = Get-SamePathCopyTextDiff -SourceLines @(1..60 | ForEach-Object { "x$_" }) `
        -DestinationLines @(1..60 | ForEach-Object { "y$_" }) -MaxOutputLines 20
    Assert-Equal 20 @($longDiff.Lines).Count 'Çıktı sınırı uygulanmadı.'
    Assert-Equal $true ([bool]$longDiff.Truncated) 'Kesilen fark listesi bildirilmedi.'

    # İkili içerik algılama: NUL baytı taşıyan dosya metin sayılmaz.
    $textFilePath = Join-Path $testDirectory 'metin.txt'
    Set-Content -LiteralPath $textFilePath -Value "bir`niki" -Encoding UTF8
    $binaryFilePath = Join-Path $testDirectory 'ikili.bin'
    [System.IO.File]::WriteAllBytes($binaryFilePath, [byte[]]@(1, 2, 0, 3, 4))
    Assert-Equal $false (Test-SamePathCopyBinaryContent -Path $textFilePath) 'Metin dosyası ikili sayıldı.'
    Assert-Equal $true (Test-SamePathCopyBinaryContent -Path $binaryFilePath) 'NUL baytlı dosya metin sayıldı.'

    # Dosya karşılaştırması: boyut/tarih her durumda, satır farkı yalnızca metin dosyalarında.
    $comparisonSource = Join-Path $testDirectory 'kaynak.txt'
    $comparisonDestination = Join-Path $testDirectory 'hedef.txt'
    Set-Content -LiteralPath $comparisonSource -Value "bir`niki`nYENI" -Encoding UTF8
    Set-Content -LiteralPath $comparisonDestination -Value "bir`niki`nESKI" -Encoding UTF8
    $comparison = Get-SamePathCopyFileComparison -SourcePath $comparisonSource -DestinationPath $comparisonDestination
    Assert-Equal 'tamam' ([string]$comparison.Reason) 'Metin dosyaları karşılaştırılamadı.'
    Assert-Equal $true ([bool]$comparison.SourceExists) 'Kaynak dosyanın varlığı okunmadı.'
    Assert-Equal $true ([bool]$comparison.DestinationExists) 'Hedef dosyanın varlığı okunmadı.'
    if ([long]$comparison.SourceSize -le 0) { throw 'Kaynak boyutu okunmadı.' }
    if ($null -eq $comparison.SourceWriteTime) { throw 'Kaynak tarihi okunmadı.' }
    Assert-Equal 'bir|iki|-ESKI|+YENI' (Get-DiffText -Diff $comparison.Diff) 'Dosya farkı beklenenden farklı.'

    # Hedefte olmayan dosya: karşılaştırma yine çalışır, bütün satırlar eklenir.
    $missingComparison = Get-SamePathCopyFileComparison -SourcePath $comparisonSource -DestinationPath (Join-Path $testDirectory 'yok.txt')
    Assert-Equal $false ([bool]$missingComparison.DestinationExists) 'Olmayan hedef var sayıldı.'
    Assert-Equal 3 ([int]$missingComparison.Diff.AddedCount) 'Hedefte olmayan dosyanın bütün satırları eklenmeli.'

    # İki dosya da yok: neden "yok" olur, çökmez.
    Assert-Equal 'yok' ([string](Get-SamePathCopyFileComparison -SourcePath (Join-Path $testDirectory 'yok1.txt') `
        -DestinationPath (Join-Path $testDirectory 'yok2.txt')).Reason) 'İki tarafı da olmayan dosyanın nedeni "yok" olmalı.'

    # İkili dosya, klasör ve sınırı aşan dosya: satır farkı yerine neden döner.
    Assert-Equal 'ikili' ([string](Get-SamePathCopyFileComparison -SourcePath $binaryFilePath -DestinationPath $textFilePath).Reason) 'İkili dosyanın nedeni "ikili" olmalı.'
    Assert-Equal 'klasor' ([string](Get-SamePathCopyFileComparison -SourcePath $testDirectory -DestinationPath $testDirectory -IsDirectory $true).Reason) 'Klasörün nedeni "klasor" olmalı.'
    $largeComparison = Get-SamePathCopyFileComparison -SourcePath $comparisonSource -DestinationPath $comparisonDestination -MaxBytes 4
    Assert-Equal 'buyuk' ([string]$largeComparison.Reason) 'Sınırı aşan dosyanın nedeni "buyuk" olmalı.'
    if (([string]$largeComparison.ReasonText) -notlike '*>*') { throw "Sınır aşımı iletisinde boyut yok: $($largeComparison.ReasonText)" }
    # Aynı içerikli iki dosyada neden "ayni" olur.
    Copy-Item -LiteralPath $comparisonSource -Destination (Join-Path $testDirectory 'kopya.txt')
    Assert-Equal 'ayni' ([string](Get-SamePathCopyFileComparison -SourcePath $comparisonSource `
        -DestinationPath (Join-Path $testDirectory 'kopya.txt')).Reason) 'Birebir aynı dosyanın nedeni "ayni" olmalı.'

    # Pano metni: her satır işaretiyle ve hedef yoluyla yazılır, ilk satır makine özetini taşır.
    $clipboardTarget = [pscustomobject]@{ id = 'IG1'; name = 'IG1'; address = '10.10.1.11'; networkRoot = 'Sim' }
    $clipboardDiff = [pscustomobject]@{
        Entries = @([pscustomobject]@{ Sign = '+'; DisplayPath = 'Data\x.txt'; StatusText = 'yeni'; DestinationPath = '\\10.10.1.11\Sim\Data\x.txt' })
        NewCount = 1; UpdateCount = 0; OlderCount = 0; ExtraCount = 0; Truncated = $false; HiddenCount = 0
        MirrorEnabled = $false; Failed = $false
    }
    $clipboardText = Get-SamePathCopyDiffClipboardText -Diff $clipboardDiff -Target $clipboardTarget
    if ($clipboardText -notlike 'IG1 (10.10.1.11) - +1 yeni*') { throw "Pano metninin ilk satırı yanlış: $clipboardText" }
    if ($clipboardText -notlike "*+ Data\x.txt*yeni*\\10.10.1.11\Sim\Data\x.txt*") { throw "Pano metninde satır dökümü yok: $clipboardText" }

    # --- Pencere: gerçek WPF ağacı ayrı bir STA sürecinde kurulur ---------------------------------
    # Karşılaştırılacak liste gerçek robocopy /L ile üretilir; hedef yerel yönetim paylaşımıdır.
    $windowSource = Join-Path $testDirectory 'pencere\kaynak\Data'
    [void](New-Item -ItemType Directory -Path $windowSource -Force)
    Set-Content -LiteralPath (Join-Path $windowSource 'guncel.txt') -Value "bir`niki`nKAYNAK" -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $windowSource 'yeni.txt') -Value 'yeni dosya' -Encoding UTF8
    $windowTargetPath = Join-Path $testDirectory 'pencere\hedef'
    [void](New-Item -ItemType Directory -Path (Join-Path $windowTargetPath 'Data') -Force)
    Set-Content -LiteralPath (Join-Path $windowTargetPath 'Data\guncel.txt') -Value "bir`niki`nHEDEF (eski)" -Encoding UTF8
    (Get-Item -LiteralPath (Join-Path $windowTargetPath 'Data\guncel.txt')).LastWriteTime = (Get-Date).AddHours(-5)

    $windowScriptPath = Join-Path $testDirectory 'diff-smoke.ps1'
    $windowOutputPath = Join-Path $testDirectory 'diff-smoke-output.txt'
    $windowScript = @"
`$ErrorActionPreference = 'Stop'
# WPF türleri pencere açılana kadar yüklenmiyor; zamanlayıcı türü pencereden önce kullanıldığı için burada yüklenir.
Add-Type -AssemblyName PresentationFramework
. '$projectDirectory\SamePathCopy.Common.ps1'
. '$projectDirectory\SamePathCopy.Ui.ps1'
. '$projectDirectory\SamePathCopy.Diff.ps1'
`$target = [pscustomobject]@{ id = 'Yerel'; name = 'Yerel'; address = '127.0.0.1'; networkRoot = 'C`$\$($windowTargetPath.Substring(3))' }
`$diff = Get-SamePathCopyTargetFileDiff -SourceItems @(Get-Item -LiteralPath '$windowSource') -LocalRoots @('$($testDirectory)\pencere\kaynak') -Target `$target
`$env:SAMEPATHCOPY_DIFF_AUTOCLOSE = '900'
Show-SamePathCopyDiff -Target `$target -Diff `$diff -SelectPath '$($windowSource)\guncel.txt'
"liste satir=`$(`$script:diffRowBorders.Count)" | Out-File -LiteralPath '$windowOutputPath' -Encoding UTF8
"secili=`$(`$script:diffEntries[`$script:diffSelectedIndex].DisplayPath)" | Out-File -LiteralPath '$windowOutputPath' -Encoding UTF8 -Append
"karsilastirma satir=`$(`$script:diffComparePanel.Children.Count)" | Out-File -LiteralPath '$windowOutputPath' -Encoding UTF8 -Append
`$signs = @(foreach (`$child in `$script:diffLinePanel.Children) { if (`$child -is [System.Windows.Controls.Border]) { foreach (`$cell in `$child.Child.Children) { if ([System.Windows.Controls.Grid]::GetColumn(`$cell) -eq 2) { [string]`$cell.Text } } } })
"isaretler=`$((`$signs -join '').Trim())" | Out-File -LiteralPath '$windowOutputPath' -Encoding UTF8 -Append
`$texts = @(foreach (`$child in `$script:diffLinePanel.Children) { if (`$child -is [System.Windows.Controls.Border]) { foreach (`$cell in `$child.Child.Children) { if ([System.Windows.Controls.Grid]::GetColumn(`$cell) -eq 3) { [string]`$cell.Text } } } })
"metinler=`$(`$texts -join '|')" | Out-File -LiteralPath '$windowOutputPath' -Encoding UTF8 -Append
"@
    Set-Content -LiteralPath $windowScriptPath -Value $windowScript -Encoding UTF8

    $windowErrorPath = Join-Path $testDirectory 'diff-smoke-error.txt'
    $windowProcess = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') `
        -ArgumentList @('-sta', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $windowScriptPath) `
        -PassThru -WindowStyle Hidden -RedirectStandardError $windowErrorPath
    if (-not $windowProcess.WaitForExit(90000)) {
        try { $windowProcess.Kill() } catch { }
        throw 'Karşılaştırma penceresi kendi kendine kapanmadı.'
    }
    $windowProcess.WaitForExit()
    $windowErrorText = if (Test-Path -LiteralPath $windowErrorPath) { [string](Get-Content -LiteralPath $windowErrorPath -Raw) } else { '' }
    if (-not [string]::IsNullOrWhiteSpace($windowErrorText)) {
        throw "Karşılaştırma penceresi hata verdi: $windowErrorText"
    }
    if (-not (Test-Path -LiteralPath $windowOutputPath -PathType Leaf)) {
        throw 'Karşılaştırma penceresi sonuç üretmeden kapandı.'
    }
    $windowOutput = @(Get-Content -LiteralPath $windowOutputPath -Encoding UTF8)
    Assert-Equal 'liste satir=2' $windowOutput[0] 'Pencerenin sol listesi iki öğeyi göstermeli (guncel.txt, yeni.txt).'
    Assert-Equal 'secili=guncel.txt' $windowOutput[1] 'Verilen dosya açılışta seçili gelmeli.'
    if ([int]($windowOutput[2] -replace '\D', '') -lt 3) { throw "Karşılaştırma bölümü boyut/tarih satırlarını göstermeli: $($windowOutput[2])" }
    # Farkın kendisi çizilmeli: hedeften kalkan ve eklenen satır işaretleri görünür.
    if ($windowOutput[3] -notlike '*-*' -or $windowOutput[3] -notlike '*+*') { throw "Fark işaretleri çizilmedi: $($windowOutput[3])" }
    if ($windowOutput[4] -notlike '*KAYNAK*' -or $windowOutput[4] -notlike '*HEDEF (eski)*') { throw "Fark satırlarının içeriği yanlış: $($windowOutput[4])" }

    Write-Host 'Karşılaştırma testleri başarılı.'
}
finally {
    if (Test-Path -LiteralPath $testDirectory) {
        Remove-Item -LiteralPath $testDirectory -Recurse -Force
    }
}
