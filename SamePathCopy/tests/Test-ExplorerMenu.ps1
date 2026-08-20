$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $projectDirectory 'SamePathCopy.Common.ps1')

# Explorer menüsü kayıt defterine yazılır; test -WhatIf çıktısını okuyarak yapıyı doğrular, hiçbir şey yazmaz.
$testDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('SamePathCopy-Menu-' + [guid]::NewGuid().ToString('N'))

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) {
        throw "$Message Beklenen: $Expected; gerçek: $Actual"
    }
}

$previousLogPath = $env:SAMEPATHCOPY_LOG
$previousStatePath = $env:SAMEPATHCOPY_WIZARD_STATE
$previousNodeId = $env:SAMEPATHCOPY_NODE_ID
try {
    [void](New-Item -ItemType Directory -Path $testDirectory)
    $env:SAMEPATHCOPY_LOG = Join-Path $testDirectory 'root.log'
    $env:SAMEPATHCOPY_WIZARD_STATE = Join-Path $testDirectory 'wizard-state.json'
    $env:SAMEPATHCOPY_NODE_ID = 'Yerel'

    # Üç grup × dört makine + gruba ait olmayan bir makine: eski düz menüde 19 girdi olurdu (16 sınırının üstü).
    $nodes = @(@{ id = 'Yerel'; name = 'Yerel'; address = '10.10.1.209'; localRoot = 'C:\Kaynak'; networkRoot = 'proje' })
    foreach ($setIndex in 1..3) {
        $nodes += @{ id = "U${setIndex}Trainer"; group = "Unit$setIndex"; name = "Eğitmen $setIndex"
            address = "10.10.1.$($setIndex)0"; localRoot = 'D:\Sim'; networkRoot = 'Sim\ActiveRelease' }
        foreach ($igIndex in 1..3) {
            $nodes += @{ id = "U${setIndex}IG$igIndex"; group = "Unit$setIndex"; name = "IG$igIndex - set $setIndex"
                address = "10.10.1.$($setIndex)$igIndex"; localRoot = 'C:\Sim'; networkRoot = 'Sim\ActiveRelease' }
        }
    }
    $nodes += @{ id = 'Arsiv'; name = 'Arşiv sunucusu'; address = '10.10.1.90'; localRoot = 'E:\Arsiv'; networkRoot = 'Arsiv' }

    $configPath = Join-Path $testDirectory 'config.json'
    (@{ version = '1.0.0'; menuTitle = 'SamePathCopy'; allLabel = 'Tümü'; nodes = $nodes } | ConvertTo-Json -Depth 6) |
        Set-Content -LiteralPath $configPath -Encoding UTF8

    # -WhatIf iletileri konsola yazılır, akışlarla yakalanamaz; bu yüzden kurulum ayrı süreçte çalıştırılıp
    # standart çıkışı okunur. Kayıt defterine hiçbir şey yazılmaz.
    $whatIfOutputPath = Join-Path $testDirectory 'whatif.txt'
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $startInfo.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -ConfigPath "{1}" -WhatIf' -f `
        (Join-Path $projectDirectory 'Install-ContextMenu.ps1'), $configPath
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $startInfo.EnvironmentVariables['SAMEPATHCOPY_LOG'] = $env:SAMEPATHCOPY_LOG
    $startInfo.EnvironmentVariables['SAMEPATHCOPY_WIZARD_STATE'] = $env:SAMEPATHCOPY_WIZARD_STATE
    $startInfo.EnvironmentVariables['SAMEPATHCOPY_NODE_ID'] = 'Yerel'
    $process = [System.Diagnostics.Process]::Start($startInfo)
    $whatIfText = $process.StandardOutput.ReadToEnd()
    $installError = $process.StandardError.ReadToEnd()
    if (-not $process.WaitForExit(120000)) {
        try { $process.Kill() } catch { }
        throw 'Install-ContextMenu -WhatIf bitmedi.'
    }
    Set-Content -LiteralPath $whatIfOutputPath -Value $whatIfText -Encoding UTF8
    if (-not [string]::IsNullOrWhiteSpace($installError)) {
        throw "Install-ContextMenu -WhatIf hata verdi: $installError"
    }
    $whatIfLines = @($whatIfText -split '\r?\n')
    if ($whatIfLines.Count -lt 10) {
        throw 'Install-ContextMenu -WhatIf çıktı üretmedi.'
    }

    $menuRoot = 'HKCU:\Software\Classes\AllFilesystemObjects\shell\SamePathCopy'
    $topLevelPattern = [regex]::Escape("$menuRoot\shell\") + '(?<key>\d{3}_[^\\"]+)'
    $topLevelKeys = @([regex]::Matches($whatIfText, $topLevelPattern) |
        ForEach-Object { $_.Groups['key'].Value } | Select-Object -Unique)

    # Üst seviyede 16 öğe sınırının altında kalınmalı: 4 toplu + 3 grup + 1 gruba ait olmayan makine = 8.
    Assert-Equal 8 $topLevelKeys.Count 'Üst seviye menü girdisi sayısı beklenenden farklı.'
    if ($topLevelKeys.Count -gt 16) { throw 'Üst seviye menü 16 öğe sınırını aşıyor.' }

    # Sıra: toplu girdiler, gruplar, sonra gruba ait olmayan makine.
    $orderedKeys = @($topLevelKeys | Sort-Object)
    $expectedOrder = @('000_all', '010_wizard', '020_wizard_last', '030_restore',
        '040_group_Unit1', '050_group_Unit2', '060_group_Unit3', '070_Arsiv')
    Assert-Equal ($expectedOrder -join ' > ') ($orderedKeys -join ' > ') 'Üst seviye menü sırası beklenenden farklı.'

    # Gruba ait makineler üst seviyede olmamalı.
    foreach ($groupedNodeId in @('U1Trainer', 'U1IG1', 'U2IG3', 'U3IG2')) {
        if (@($orderedKeys | Where-Object { $_ -like "*_$groupedNodeId" }).Count -gt 0) {
            throw "Gruba ait makine üst seviyede: $groupedNodeId"
        }
    }

    # Her grup alt menüsünde önce grubun kendi girdisi, sonra makineleri olmalı.
    foreach ($setIndex in 1..3) {
        $groupShell = "$menuRoot\shell\0$($setIndex + 3)0_group_Unit$setIndex\shell\"
        $childPattern = [regex]::Escape($groupShell) + '(?<key>\d{3}_[^\\"]+)'
        $childKeys = @([regex]::Matches($whatIfText, $childPattern) | ForEach-Object { $_.Groups['key'].Value } |
            Select-Object -Unique | Sort-Object)
        Assert-Equal 5 $childKeys.Count "Unit$setIndex alt menüsünde beklenen girdi sayısı yok."
        Assert-Equal "000_group_Unit$setIndex" $childKeys[0] "Unit$setIndex alt menüsünde grup girdisi başta değil."
        if (@($childKeys | Where-Object { $_ -like "*_U${setIndex}IG3" }).Count -eq 0) {
            throw "Unit$setIndex alt menüsünde IG3 yok (16 öğe sınırı yüzünden düşen makineler geri gelmedi)."
        }
    }

    # Grubun alt menüsündeki ilk girdi grubun tamamına gönderen komutu taşımalı.
    if ($whatIfText -notlike '*-TargetId "group:Unit3"*') {
        throw 'Grup alt menüsündeki toplu girdi grup hedefini geçirmiyor.'
    }
    # Kırpılan makineler artık komutlarını almalı.
    if ($whatIfText -notlike '*-TargetId "U3IG3"*') {
        throw 'Unit3 IG3 için komut yazılmadı.'
    }

    # Ayırıcılar: bölüm değişimlerinde CommandFlags = 0x20 (ECF_SEPARATORBEFORE) yazılmalı.
    $separatorLines = @($whatIfLines | Where-Object { $_ -like '*CommandFlags = 32*' })
    if ($separatorLines.Count -lt 2) {
        throw "Bölüm ayırıcıları yazılmadı (bulunan: $($separatorLines.Count))."
    }
    if (@($separatorLines | Where-Object { $_ -like '*040_group_Unit1*' }).Count -eq 0) {
        throw 'Toplu girdilerle gruplar arasına ayırıcı konmadı.'
    }
    if (@($separatorLines | Where-Object { $_ -like '*070_Arsiv*' }).Count -eq 0) {
        throw 'Gruplarla tek makineler arasına ayırıcı konmadı.'
    }
    # İlk girdinin önüne ayırıcı konmamalı.
    if (@($separatorLines | Where-Object { $_ -like '*000_all*' }).Count -gt 0) {
        throw 'Menünün ilk girdisine ayırıcı konuldu.'
    }

    Write-Host 'Explorer menüsü testleri başarılı.'
}
finally {
    $env:SAMEPATHCOPY_LOG = $previousLogPath
    $env:SAMEPATHCOPY_WIZARD_STATE = $previousStatePath
    $env:SAMEPATHCOPY_NODE_ID = $previousNodeId
    if (Test-Path -LiteralPath $testDirectory) {
        Remove-Item -LiteralPath $testDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}
