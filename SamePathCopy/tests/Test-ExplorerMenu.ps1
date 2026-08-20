$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $projectDirectory 'SamePathCopy.Common.ps1')

# Explorer menüsü kayıt defterine yazılır; test -WhatIf çıktısını okuyarak yapıyı doğrular, hiçbir şey yazmaz.
$testDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('SamePathCopy-Menu-' + [guid]::NewGuid().ToString('N'))
$menuRoot = 'HKCU:\Software\Classes\AllFilesystemObjects\shell\SamePathCopy'

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) {
        throw "$Message Beklenen: $Expected; gerçek: $Actual"
    }
}

function New-TestConfigFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][int]$GroupCount,
        [Parameter(Mandatory = $true)][int]$MachinesPerGroup,
        [int]$UngroupedCount = 0,
        [string]$MenuShowNodes = 'auto'
    )

    $nodes = @(@{ id = 'Yerel'; name = 'Yerel'; address = '10.10.1.209'; localRoot = 'C:\Kaynak'; networkRoot = 'proje' })
    if ($GroupCount -gt 0) {
        foreach ($setIndex in 1..$GroupCount) {
            foreach ($machineIndex in 1..$MachinesPerGroup) {
                $nodes += @{ id = "U${setIndex}M$machineIndex"; group = "Unit$setIndex"; name = "Makine $machineIndex - set $setIndex"
                    address = "10.10.1.$setIndex$machineIndex"; localRoot = 'C:\Sim'; networkRoot = 'Sim\ActiveRelease' }
            }
        }
    }
    if ($UngroupedCount -gt 0) {
        foreach ($extraIndex in 1..$UngroupedCount) {
            $nodes += @{ id = "Tek$extraIndex"; name = "Tek makine $extraIndex"; address = "10.10.4.$extraIndex"
                localRoot = 'E:\Tek'; networkRoot = 'Tek' }
        }
    }
    (@{ version = '1.0.0'; menuTitle = 'SamePathCopy'; allLabel = 'Tümü'; menuShowNodes = $MenuShowNodes; nodes = $nodes } |
        ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Get-MenuWhatIfText {
    param([Parameter(Mandatory = $true)][string]$ConfigPath)

    # -WhatIf iletileri konsola yazılır, akışlarla yakalanamaz; kurulum ayrı süreçte çalıştırılıp çıkışı okunur.
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $startInfo.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -ConfigPath "{1}" -WhatIf' -f `
        (Join-Path $projectDirectory 'Install-ContextMenu.ps1'), $ConfigPath
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $startInfo.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $startInfo.EnvironmentVariables['SAMEPATHCOPY_LOG'] = $env:SAMEPATHCOPY_LOG
    $startInfo.EnvironmentVariables['SAMEPATHCOPY_WIZARD_STATE'] = $env:SAMEPATHCOPY_WIZARD_STATE
    $startInfo.EnvironmentVariables['SAMEPATHCOPY_NODE_ID'] = 'Yerel'
    $process = [System.Diagnostics.Process]::Start($startInfo)
    $standardOutput = $process.StandardOutput.ReadToEnd()
    $standardError = $process.StandardError.ReadToEnd()
    if (-not $process.WaitForExit(120000)) {
        try { $process.Kill() } catch { }
        throw 'Install-ContextMenu -WhatIf bitmedi.'
    }
    return [pscustomobject]@{ Output = $standardOutput; Error = $standardError }
}

function Get-TopLevelKeys {
    param([Parameter(Mandatory = $true)][string]$WhatIfText)

    $pattern = [regex]::Escape("$menuRoot\shell\") + '(?<key>\d{3}_[^\\"]+)'
    return @([regex]::Matches($WhatIfText, $pattern) | ForEach-Object { $_.Groups['key'].Value } |
        Select-Object -Unique | Sort-Object)
}

function Get-GroupChildKeys {
    param(
        [Parameter(Mandatory = $true)][string]$WhatIfText,
        [Parameter(Mandatory = $true)][string]$GroupKey
    )

    $pattern = [regex]::Escape("$menuRoot\shell\$GroupKey\shell\") + '(?<key>\d{3}_[^\\"]+)'
    return @([regex]::Matches($WhatIfText, $pattern) | ForEach-Object { $_.Groups['key'].Value } |
        Select-Object -Unique | Sort-Object)
}

$previousLogPath = $env:SAMEPATHCOPY_LOG
$previousStatePath = $env:SAMEPATHCOPY_WIZARD_STATE
$previousNodeId = $env:SAMEPATHCOPY_NODE_ID
try {
    [void](New-Item -ItemType Directory -Path $testDirectory)
    $env:SAMEPATHCOPY_LOG = Join-Path $testDirectory 'root.log'
    $env:SAMEPATHCOPY_WIZARD_STATE = Join-Path $testDirectory 'wizard-state.json'
    $env:SAMEPATHCOPY_NODE_ID = 'Yerel'

    # 1) Sığan yapılandırma: 4 toplu + 2 grup (grup girdisi + 2 makine) + 1 tek makine = 13 öğe.
    $smallConfigPath = Join-Path $testDirectory 'config-kucuk.json'
    New-TestConfigFile -Path $smallConfigPath -GroupCount 2 -MachinesPerGroup 2 -UngroupedCount 1
    $small = Get-MenuWhatIfText -ConfigPath $smallConfigPath
    if (-not [string]::IsNullOrWhiteSpace($small.Error)) { throw "Küçük yapılandırmada hata: $($small.Error)" }
    $smallKeys = @(Get-TopLevelKeys -WhatIfText $small.Output)
    $expectedSmall = @('000_all', '010_wizard', '020_wizard_last', '030_restore',
        '040_group_Unit1', '050_group_Unit2', '060_Tek1')
    Assert-Equal ($expectedSmall -join ' > ') ($smallKeys -join ' > ') 'Küçük yapılandırmada üst seviye sıra yanlış.'

    # Gruba ait makineler alt menüde: grup girdisi başta, sonra makineler.
    $groupChildren = @(Get-GroupChildKeys -WhatIfText $small.Output -GroupKey '040_group_Unit1')
    Assert-Equal 3 $groupChildren.Count 'Grup alt menüsünde girdi sayısı yanlış.'
    Assert-Equal '000_group_Unit1' $groupChildren[0] 'Grup alt menüsünde toplu girdi başta değil.'
    if ($small.Output -notlike '*-TargetId "U1M2"*') { throw 'Gruba ait makine için komut yazılmadı.' }
    foreach ($groupedId in @('U1M1', 'U2M2')) {
        if (@($smallKeys | Where-Object { $_ -like "*_$groupedId" }).Count -gt 0) {
            throw "Gruba ait makine üst seviyede: $groupedId"
        }
    }

    # Ayırıcılar bölüm sınırlarında: Tümü | sihirbaz girdileri | geri alma | gruplar | tek makineler.
    $smallSeparators = @($small.Output -split '\r?\n' | Where-Object { $_ -like '*CommandFlags = 32*' })
    foreach ($expectedSeparatorKey in @('010_wizard', '030_restore', '040_group_Unit1', '060_Tek1')) {
        if (@($smallSeparators | Where-Object { $_ -like "*$expectedSeparatorKey*" }).Count -eq 0) {
            throw "Ayırıcı beklenen girdide yok: $expectedSeparatorKey"
        }
    }
    foreach ($unexpectedSeparatorKey in @('000_all', '020_wizard_last', '050_group_Unit2')) {
        if (@($smallSeparators | Where-Object { $_ -like "*$unexpectedSeparatorKey*" }).Count -gt 0) {
            throw "Aynı bölümün içine ayırıcı konuldu: $unexpectedSeparatorKey"
        }
    }

    # 2) Sığmayan yapılandırma (3 grup × 4 makine): tek makineler menüye konmaz, gruplar doğrudan komut olur.
    $bigConfigPath = Join-Path $testDirectory 'config-buyuk.json'
    New-TestConfigFile -Path $bigConfigPath -GroupCount 3 -MachinesPerGroup 4
    $big = Get-MenuWhatIfText -ConfigPath $bigConfigPath
    if (-not [string]::IsNullOrWhiteSpace($big.Error)) { throw "Büyük yapılandırmada hata: $($big.Error)" }
    $bigKeys = @(Get-TopLevelKeys -WhatIfText $big.Output)
    $expectedBig = @('000_all', '010_wizard', '020_wizard_last', '030_restore',
        '040_group_Unit1', '050_group_Unit2', '060_group_Unit3')
    Assert-Equal ($expectedBig -join ' > ') ($bigKeys -join ' > ') 'Büyük yapılandırmada üst seviye sıra yanlış.'
    if ($bigKeys.Count -gt 16) { throw 'Üst seviye 16 öğe sınırını aşıyor.' }
    Assert-Equal 0 @(Get-GroupChildKeys -WhatIfText $big.Output -GroupKey '060_group_Unit3').Count 'Sığmayan yapılandırmada grup alt menüsü oluştu.'
    if ($big.Output -notlike '*-TargetId "group:Unit3"*') { throw 'Grup girdisi doğrudan komuta bağlanmadı.' }
    if ($big.Output -like '*-TargetId "U3M4"*') { throw 'Tek makine girdisi menüye konmuş.' }
    # Alt sürecin çıktısı konsol kod sayfasıyla geldiği için Türkçe karakterlere güvenilmez; ASCII parça aranır.
    if ($big.Output -notlike '*menuShowNodes=always*') { throw "Tek makinelerin çıkarıldığı bildirilmedi: $($big.Output)" }

    # 3) menuShowNodes = always: bütçe aşılsa da tek makineler konur ve uyarı verilir.
    $forcedConfigPath = Join-Path $testDirectory 'config-zorla.json'
    New-TestConfigFile -Path $forcedConfigPath -GroupCount 3 -MachinesPerGroup 4 -MenuShowNodes 'always'
    $forced = Get-MenuWhatIfText -ConfigPath $forcedConfigPath
    if ($forced.Output -notlike '*-TargetId "U3M4"*') { throw 'always kipinde tek makine girdisi konmadı.' }
    # Write-Warning çıktısı da konsola (standart çıkışa) düşer; sınır uyarısı orada aranır.
    if ($forced.Output -notlike '*Windows en fazla 16*') {
        throw "always kipinde sınır uyarısı verilmedi: $($forced.Output)"
    }

    # 4) menuShowNodes = never: grup varken tek makineler hiç konmaz.
    $neverConfigPath = Join-Path $testDirectory 'config-hicbir.json'
    New-TestConfigFile -Path $neverConfigPath -GroupCount 1 -MachinesPerGroup 2 -MenuShowNodes 'never'
    $never = Get-MenuWhatIfText -ConfigPath $neverConfigPath
    if ($never.Output -like '*-TargetId "U1M1"*') { throw 'never kipinde tek makine girdisi konuldu.' }
    if ($never.Output -notlike '*-TargetId "group:Unit1"*') { throw 'never kipinde grup girdisi konmadı.' }

    # 5) Hiç grup yoksa tek makineler her hâlükârda menüye konur (başka hedef yok).
    $flatConfigPath = Join-Path $testDirectory 'config-grupsuz.json'
    New-TestConfigFile -Path $flatConfigPath -GroupCount 0 -MachinesPerGroup 0 -UngroupedCount 14
    $flat = Get-MenuWhatIfText -ConfigPath $flatConfigPath
    if ($flat.Output -notlike '*-TargetId "Tek14"*') { throw 'Grupsuz yapılandırmada tek makine girdisi konmadı.' }

    # 6) Geçersiz menuShowNodes değeri reddedilmeli.
    $invalidConfigPath = Join-Path $testDirectory 'config-gecersiz.json'
    New-TestConfigFile -Path $invalidConfigPath -GroupCount 1 -MachinesPerGroup 1 -MenuShowNodes 'bazen'
    $invalid = Get-MenuWhatIfText -ConfigPath $invalidConfigPath
    if ($invalid.Error -notlike '*menuShowNodes*') { throw "Geçersiz menuShowNodes için hata verilmedi: $($invalid.Error)" }

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
