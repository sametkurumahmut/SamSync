$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

# Kuyruk katmanı: Explorer, sağ tık fiilini seçilen her öğe için bir kez çalıştırıyor. Bu betik o
# çağrıları tek bir kopyalamada topluyor; 16 dosya seçildiğinde kopyalamanın 16 pencere açmaması ve
# hiçbir yolun düşmemesi buna bağlı. Kabuğun bütün seçimi tek komut satırına dizdiği durum da sınanır.
$testDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('SamePathCopy-Queue-' + [guid]::NewGuid().ToString('N'))
$queueScript = Join-Path $projectDirectory 'Queue-SamePathCopy.ps1'
$powershellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) {
        throw "$Message Beklenen: $Expected; gerçek: $Actual"
    }
}

function Start-QueueProcess {
    param(
        [Parameter(Mandatory = $true)][string]$ConfigPath,
        [Parameter(Mandatory = $true)][string[]]$SourcePath,
        [string]$TargetId = 'Hedef1'
    )

    # Argümanlar Explorer'ın kurduğu komut satırıyla aynı biçimde verilir: yollar -SourcePath'in
    # ardında boşlukla ayrılmış ve tırnaklı durur. Start-Process çıkış kodunu güvenilir vermediği için
    # .NET süreci kullanılır.
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $powershellExe
    $quotedPaths = (@($SourcePath) | ForEach-Object { '"{0}"' -f $_ }) -join ' '
    $startInfo.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -SourcePath {1} -TargetId "{2}" -ConfigPath "{3}" -PlanOnly' -f `
        $queueScript, $quotedPaths, $TargetId, $ConfigPath
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.EnvironmentVariables['SAMEPATHCOPY_NODE_ID'] = 'Yerel'
    $startInfo.EnvironmentVariables['SAMEPATHCOPY_LOG'] = $env:SAMEPATHCOPY_LOG
    return [System.Diagnostics.Process]::Start($startInfo)
}

function Complete-QueueProcess {
    param($Process, [int]$TimeoutSeconds = 90)

    $standardOutput = $Process.StandardOutput.ReadToEnd()
    $standardError = $Process.StandardError.ReadToEnd()
    if (-not $Process.WaitForExit($TimeoutSeconds * 1000)) {
        try { $Process.Kill() } catch { }
        throw 'Kuyruk süreci bitmedi.'
    }
    if (-not [string]::IsNullOrWhiteSpace($standardError)) {
        throw "Kuyruk hata akışına yazdı: $standardError"
    }
    Assert-Equal 0 $Process.ExitCode 'Kuyruk çıkış kodu sıfır olmalı.'
    if ([string]::IsNullOrWhiteSpace($standardOutput)) { return @() }
    # ConvertFrom-Json bu PowerShell sürümünde diziyi tek nesne olarak veriyor: çağrı @() ile sarılırsa
    # 16 satır tek öğe gibi görünüyor. Sonuç önce değişkene alınıp sonra diziye çevrilir.
    $plan = $standardOutput | ConvertFrom-Json
    return @(@($plan) | ForEach-Object { [string]$_.Source })
}

$previousLogPath = $env:SAMEPATHCOPY_LOG
$previousNodeId = $env:SAMEPATHCOPY_NODE_ID
try {
    [void](New-Item -ItemType Directory -Path $testDirectory)
    $env:SAMEPATHCOPY_LOG = Join-Path $testDirectory 'log\root.log'
    $sourceRoot = Join-Path $testDirectory 'kaynak'
    $sourceDirectory = Join-Path $sourceRoot 'Data'
    [void](New-Item -ItemType Directory -Path $sourceDirectory)
    # 16 dosya: kullanıcının bildirdiği sınır tam olarak burada (15 çalışıyor, 16 çalışmıyordu).
    $sourceFiles = @(1..16 | ForEach-Object {
        $filePath = Join-Path $sourceDirectory ("dosya{0:D2}.entity" -f $_)
        Set-Content -LiteralPath $filePath -Value "veri $_" -Encoding UTF8
        $filePath
    })

    $baseConfig = @{
        version = '1.0.0'
        menuTitle = 'SamePathCopy'
        nodes = @(
            @{ id = 'Yerel'; name = 'Yerel'; address = '127.0.0.1'; localRoot = $sourceRoot; networkRoot = 'C$\SamePathCopyYok' }
            @{ id = 'Hedef1'; name = 'Hedef1'; address = '127.0.0.1'; localRoot = $sourceRoot; networkRoot = ('C$\' + (Join-Path $testDirectory 'hedef').Substring(3)) }
        )
    }
    # Kuyruk klasörü hedef + config yoluna göre ayrıldığı için her durum kendi config kopyasını kullanır.
    $configPaths = @{}
    foreach ($caseName in @('tekcagri', 'coklucagri', 'yineleme')) {
        $casePath = Join-Path $testDirectory "config-$caseName.json"
        ($baseConfig | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $casePath -Encoding UTF8
        $configPaths[$caseName] = $casePath
    }

    # 1) Tek çağrıda birden çok yol: kabuk bütün seçimi tek komut satırına dizerse hepsi kopyalanmalı.
    $singleCallSources = Complete-QueueProcess -Process (Start-QueueProcess -ConfigPath $configPaths['tekcagri'] -SourcePath $sourceFiles)
    Assert-Equal 16 $singleCallSources.Count 'Tek çağrıda verilen 16 yolun hepsi plana girmeliydi.'
    Assert-Equal ((@($sourceFiles) | Sort-Object) -join '|') ((@($singleCallSources) | Sort-Object) -join '|') 'Tek çağrıdaki yollar plana eksik/yanlış geçti.'

    # 2) Dosya başına bir çağrı (Explorer'ın gerçek davranışı): çağrılar tek kopyalamada toplanmalı,
    # hiçbir yol düşmemeli ve aynı yol iki kez kopyalanmamalı.
    $processes = @(foreach ($sourceFile in $sourceFiles) {
        Start-QueueProcess -ConfigPath $configPaths['coklucagri'] -SourcePath @($sourceFile)
    })
    $collected = New-Object System.Collections.Generic.List[string]
    $collectorCounts = New-Object System.Collections.Generic.List[int]
    foreach ($process in $processes) {
        $processSources = @(Complete-QueueProcess -Process $process)
        if ($processSources.Count -eq 0) { continue }
        $collectorCounts.Add($processSources.Count)
        foreach ($processSource in $processSources) { $collected.Add([string]$processSource) }
    }
    $collectedPaths = @($collected.ToArray())
    Assert-Equal 16 $collectedPaths.Count 'Toplanan yol sayısı 16 olmalı (düşen ya da yinelenen yol var).'
    Assert-Equal ((@($sourceFiles) | Sort-Object) -join '|') ((@($collectedPaths) | Sort-Object) -join '|') 'Ayrı çağrılardaki yollar eksik/yinelenmiş toplandı.'
    # Toplama gerçekten çalışmalı: en az bir çalıştırma birden çok yolu birlikte kopyalamalı, yoksa
    # 16 seçimde 16 ayrı kopyalama penceresi açılırdı.
    if (@($collectorCounts.ToArray() | Where-Object { $_ -gt 1 }).Count -eq 0) {
        throw ("Çağrılar toplanmadı: her süreç kendi başına kopyalama başlattı ({0} toplayıcı)." -f $collectorCounts.Count)
    }
    # 16 süreç tek kopyalamada toplanmalı. Zamanlayıcı gürültüsüne yer bırakmak için birkaç toplayıcıya
    # izin verilir; ama sayı büyürse sessizlik penceresi çok kısa demektir (kullanıcı birden çok pencere görür).
    if ($collectorCounts.Count -gt 3) {
        throw ("16 seçim {0} ayrı kopyalamaya bölündü: kuyruk sessizlik penceresi yetmiyor ({1})." -f
            $collectorCounts.Count, (@($collectorCounts.ToArray()) -join '+'))
    }

    # 3) Aynı yol iki kez verilirse bir kez kopyalanır.
    $duplicateSources = Complete-QueueProcess -Process (Start-QueueProcess -ConfigPath $configPaths['yineleme'] `
        -SourcePath @($sourceFiles[0], $sourceFiles[0], $sourceFiles[1]))
    Assert-Equal 2 $duplicateSources.Count 'Yinelenen yol tekilleştirilmedi.'

    # Günlük, kaç isteğin toplandığını yazmalı (sorun ararken tek kaynak burası).
    $logText = [string](Get-Content -LiteralPath $env:SAMEPATHCOPY_LOG -Raw -Encoding UTF8)
    if ($logText -notlike '*[Kuyruk]*') { throw 'Kuyruk günlüğe yazmadı.' }
    if ($logText -notlike '*tekil kaynak*') { throw 'Kuyruk toplanan istek sayısını günlüğe yazmadı.' }

    Write-Host 'Kuyruk testleri başarılı.'
}
finally {
    $env:SAMEPATHCOPY_LOG = $previousLogPath
    $env:SAMEPATHCOPY_NODE_ID = $previousNodeId
    if (Test-Path -LiteralPath $testDirectory) {
        Remove-Item -LiteralPath $testDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}
