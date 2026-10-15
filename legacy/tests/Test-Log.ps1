$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $projectDirectory 'SamePathCopy.Log.ps1')

$testDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('SamePathCopy-Log-' + [guid]::NewGuid().ToString('N'))

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) {
        throw "$Message Beklenen: $Expected; gerçek: $Actual"
    }
}

$previousLogPath = $env:SAMEPATHCOPY_LOG
try {
    [void](New-Item -ItemType Directory -Path $testDirectory)

    # Ortam değişkeni verilmediğinde günlük araç klasörünün altındaki log\root.log dosyasıdır.
    $env:SAMEPATHCOPY_LOG = $null
    $toolDirectory = Join-Path $testDirectory 'arac'
    [void](New-Item -ItemType Directory -Path $toolDirectory)
    Assert-Equal (Join-Path $toolDirectory 'log\root.log') (Initialize-SamePathCopyLog -ScriptDirectory $toolDirectory) 'Varsayılan günlük yolu araç klasörünün altında olmalı.'

    # Yazılamayan bir araç klasöründe %LOCALAPPDATA% altına düşülür.
    $env:SAMEPATHCOPY_LOG = $null
    $unwritableDirectory = Join-Path $testDirectory 'yok\bulunamaz:klasor'
    $fallbackPath = Initialize-SamePathCopyLog -ScriptDirectory $unwritableDirectory
    Assert-Equal (Join-Path $env:LOCALAPPDATA 'SamePathCopy\log\root.log') $fallbackPath 'Yazılamayan klasörde LOCALAPPDATA altına düşülmeli.'

    # Ortam değişkeni her ikisini de ezer.
    $logPath = Join-Path $testDirectory 'log\root.log'
    $env:SAMEPATHCOPY_LOG = $logPath
    Assert-Equal $logPath (Initialize-SamePathCopyLog -ScriptDirectory $toolDirectory) 'SAMEPATHCOPY_LOG değişkeni günlük yolunu ezmeli.'

    # Satır biçimi: zaman damgası, seviye, çalıştırma kimliği, bileşen, mesaj.
    Write-SamePathCopyLog -Component 'Test' -Message 'ilk satır'
    Write-SamePathCopyLog -Component 'Test' -Level 'WARN' -Message 'uyarı satırı'
    Write-SamePathCopyLog -Component 'Test' -Level 'ERROR' -Message "iki`r`nsatır"
    $lines = @(Get-Content -LiteralPath $logPath -Encoding UTF8)
    Assert-Equal 3 $lines.Count 'Yazılan satır sayısı beklenenden farklı.'
    if ($lines[0] -notmatch '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \[INFO \] \[[0-9a-f]{8}\] \[Test\] ilk satır$') {
        throw "Günlük satır biçimi beklenenden farklı: $($lines[0])"
    }
    if ($lines[1] -notlike '*[WARN ]*uyarı satırı') { throw "Uyarı satırı yanlış: $($lines[1])" }
    # Çok satırlı mesaj tek satıra sıkıştırılmalı; yoksa günlük satır bazlı okunamaz.
    if ($lines[2] -notlike '*[ERROR]*iki | satır') { throw "Çok satırlı mesaj tek satıra indirilmedi: $($lines[2])" }

    # Aynı çalıştırma kimliği bütün satırlarda aynı olmalı.
    $runIds = @($lines | ForEach-Object { ($_ -split '\[')[2].TrimEnd(']', ' ') })
    Assert-Equal 1 @($runIds | Select-Object -Unique).Count 'Çalıştırma kimliği satırlar arasında değişmemeli.'

    # Başlangıç satırı süreç kimliği ve kullanıcıyı taşır.
    Write-SamePathCopyLogStart -Component 'Test' -Summary 'başlangıç'
    $startLine = @(Get-Content -LiteralPath $logPath -Encoding UTF8)[-1]
    if ($startLine -notlike "*başlangıç | pid $PID*") { throw "Başlangıç satırı beklenen bilgileri taşımıyor: $startLine" }

    # Günlük dosyası büyüdüğünde kaydırılır: root.log yeniden başlar, eskisi root.1.log olur.
    $bigContent = 'x' * 200KB
    for ($index = 0; $index -lt 26; $index++) {
        [System.IO.File]::AppendAllText($logPath, $bigContent)
    }
    Write-SamePathCopyLog -Component 'Test' -Message 'kaydırma sonrası'
    if (-not (Test-Path -LiteralPath (Join-Path $testDirectory 'log\root.1.log'))) {
        throw 'Boyut sınırı aşıldığında root.1.log oluşmadı.'
    }
    $rotatedLines = @(Get-Content -LiteralPath $logPath -Encoding UTF8)
    Assert-Equal 1 $rotatedLines.Count 'Kaydırmadan sonra root.log yalnızca yeni satırı taşımalı.'

    # Günlük yazılamıyorsa çağrı hata fırlatmamalı: kopyalama asla günlük yüzünden durmaz.
    $env:SAMEPATHCOPY_LOG = Join-Path $testDirectory 'olmayan:surucu\root.log'
    Write-SamePathCopyLog -Component 'Test' -Message 'yazılamayan yol'

    # Rapor özetleri: geçmiş listesi ve "hatalıları seç" bu ayrıştırıcıyla çalışır.
    $env:SAMEPATHCOPY_LOG = Join-Path $testDirectory 'log\root.log'
    [void](Initialize-SamePathCopyLog -ScriptDirectory $toolDirectory)
    $reportDirectory = Join-Path $testDirectory 'log\reports'
    [void](New-Item -ItemType Directory -Path $reportDirectory -Force)
    Assert-Equal $reportDirectory (Get-SamePathCopyReportDirectory) 'Rapor klasörü günlüğün yanında olmalı.'

    function New-TestReport {
        param([string]$Stamp, [object[]]$Rows)
        $reportPath = Join-Path $reportDirectory ("rapor-{0}.csv" -f $Stamp)
        @($Rows) | Export-Csv -LiteralPath $reportPath -NoTypeInformation -Encoding UTF8 -Delimiter ';'
        return $reportPath
    }
    function New-TestReportRow {
        param([string]$TargetId, [string]$Result, [string]$Source = 'C:\Kaynak\Data')
        return [pscustomobject]@{
            Zaman = '2026-08-21 10:00:00'; Hedef = "Ad $TargetId"; HedefKimlik = $TargetId; Kaynak = $Source
            HedefYolu = "\\ip\pay\Data"; Parametreler = ''; Sonuc = $Result; RobocopyKodu = 0; SaniyeSuresi = 1.0; Not = ''
        }
    }

    $oldReportPath = New-TestReport -Stamp '20260820-090000' -Rows @(
        New-TestReportRow -TargetId 'IG1' -Result 'başarılı'
        New-TestReportRow -TargetId 'IG2' -Result 'başarılı'
    )
    [void](New-TestReport -Stamp '20260821-100000' -Rows @(
        New-TestReportRow -TargetId 'IG1' -Result 'başarılı'
        New-TestReportRow -TargetId 'IG2' -Result 'hatalı'
        New-TestReportRow -TargetId 'IG2' -Result 'hatalı' -Source 'C:\Kaynak\Diger'
        New-TestReportRow -TargetId 'IG3' -Result 'iptal'
    ))

    $summary = Get-SamePathCopyReportRunSummary -Path (Join-Path $reportDirectory 'rapor-20260821-100000.csv')
    Assert-Equal 4 ([int]$summary.RowCount) 'Rapor satır sayısı yanlış.'
    Assert-Equal 1 ([int]$summary.SuccessCount) 'Başarılı sayısı yanlış.'
    Assert-Equal 2 ([int]$summary.FailedCount) 'Hatalı sayısı yanlış.'
    Assert-Equal 1 ([int]$summary.CancelledCount) 'İptal sayısı yanlış.'
    Assert-Equal 'IG2' (@($summary.FailedTargetIds) -join ',') 'Hatalı hedef kimlikleri tekilleşmedi.'
    Assert-Equal 3 @($summary.TargetIds).Count 'Hedef kimlikleri eksik.'
    Assert-Equal 2 ([int]$summary.SourceCount) 'Kaynak sayısı yanlış.'
    Assert-Equal '21.08.2026 10:00' ([string]$summary.StampText) 'Damga dosya adından okunmadı.'

    # En yeni rapor önce gelir; sınır uygulanır; bozuk dosya listeyi bozmaz.
    Set-Content -LiteralPath (Join-Path $reportDirectory 'rapor-20260821-110000.csv') -Value 'bozuk;csv' -Encoding UTF8
    $recent = @(Get-SamePathCopyRecentReportSummaries -Limit 5)
    Assert-Equal 2 $recent.Count 'Bozuk rapor atlanmalı, ikisi listelenmeli.'
    Assert-Equal '21.08.2026 10:00' ([string]$recent[0].StampText) 'En yeni rapor önce gelmeli.'
    Assert-Equal 1 @(Get-SamePathCopyRecentReportSummaries -Limit 1).Count 'Rapor sınırı uygulanmadı.'
    Assert-Equal 2 ([int]@(Get-SamePathCopyRecentReportSummaries -Limit 1)[0].FailedCount) 'En yeni raporun hatalı sayısı korunmalı.'

    # Uçtan uca: kopyalama betiği panel sonuçlarını ve oturum bilgilerini günlüğe yazmalı.
    $env:SAMEPATHCOPY_LOG = Join-Path $testDirectory 'log\e2e.log'
    $planOutput = & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectDirectory 'Copy-SamePath.ps1') -TargetId 'all' -SourcePath (Join-Path $projectDirectory 'README.md') -PlanOnly
    if (@($planOutput).Count -eq 0) { throw 'PlanOnly çıktısı boş döndü.' }
    $e2eLines = @(Get-Content -LiteralPath $env:SAMEPATHCOPY_LOG -Encoding UTF8)
    foreach ($expected in @('*[Kopyala]*Kopyalama isteği*', '*[Kopyala]*Yerel node:*', '*[Plan]*README.md*', '*[Kopyala]*PlanOnly*')) {
        if (@($e2eLines | Where-Object { $_ -like $expected }).Count -eq 0) {
            throw "Günlükte beklenen satır yok: $expected"
        }
    }

    Write-Host 'Günlük testleri başarılı.'
}
finally {
    $env:SAMEPATHCOPY_LOG = $previousLogPath
    if (Test-Path -LiteralPath $testDirectory) {
        Remove-Item -LiteralPath $testDirectory -Recurse -Force
    }
}
