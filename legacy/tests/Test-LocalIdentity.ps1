$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $projectDirectory 'SamePathCopy.Common.ps1')

$testDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('SamePathCopy-Identity-' + [guid]::NewGuid().ToString('N'))

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) {
        throw "$Message Beklenen: $Expected; gerçek: $Actual"
    }
}

function Assert-Throws {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$Action,
        [Parameter(Mandatory = $true)][string]$ExpectedPattern,
        [Parameter(Mandatory = $true)][string]$Message
    )

    try {
        & $Action
    }
    catch {
        if ([string]$_.Exception.Message -notlike $ExpectedPattern) {
            throw "$Message Alınan hata: $($_.Exception.Message)"
        }
        return
    }
    throw $Message
}

function New-TestConfiguration {
    param([Parameter(Mandatory = $true)][string]$ExistingRoot)

    # Tüm bilgisayarlara aynı dosya dağıtıldığında oluşan durum: birden fazla node aynı bilgisayar adını taşıyor.
    return [pscustomobject]@{
        nodes = @(
            [pscustomobject]@{ id = 'Root'; name = 'Root'; address = '10.10.2.82'; localNames = @('MSI'); localRoot = $ExistingRoot; networkRoot = 'proje' }
            [pscustomobject]@{ id = 'Unit1Trainer'; name = 'Eğitmen 1'; address = '10.10.1.10'; localNames = @('MSI'); localRoot = 'D:\Yok\ActiveRelease'; networkRoot = 'Sim\ActiveRelease' }
            [pscustomobject]@{ id = 'Unit2Trainer'; name = 'Eğitmen 2'; address = '10.10.1.30'; localNames = @('MSI'); localRoot = 'D:\Yok\ActiveRelease'; networkRoot = 'Sim\ActiveRelease' }
            [pscustomobject]@{ id = 'Unit1IG1'; name = 'IG1'; address = '10.10.1.11'; localRoot = 'C:\Yok\ActiveRelease'; networkRoot = 'Sim\ActiveRelease' }
        )
    }
}

try {
    [void](New-Item -ItemType Directory -Path $testDirectory)
    $existingRoot = Join-Path $testDirectory 'proje'
    [void](New-Item -ItemType Directory -Path $existingRoot)
    $configuration = New-TestConfiguration -ExistingRoot $existingRoot

    # IP adresi eşleşmesi, bilgisayar adı eşleşmesini ezer: eğitmen bilgisayarının adı MSI olsa bile kendi node'unu bulur.
    $identity = Get-LocalSamePathCopyIdentity -Configuration $configuration -LocalMachineName 'MSI' -LocalAddresses @('10.10.1.10')
    Assert-Equal 'Unit1Trainer' $identity.Id 'IP adresi eşleşmesi bilgisayar adından önce gelmeliydi.'
    Assert-Equal 'D:\Yok\ActiveRelease' $identity.Root 'Eşleşen node localRoot değeri yanlış döndü.'

    # Yalnızca ada göre eşleşen birden fazla node varsa localRoot'u bu bilgisayarda var olan node seçilir.
    $identity = Get-LocalSamePathCopyIdentity -Configuration $configuration -LocalMachineName 'MSI' -LocalAddresses @('10.10.3.162')
    Assert-Equal 'Root' $identity.Id 'Ada göre çoklu eşleşme localRoot varlığıyla ayrışmalıydı.'

    # Ayrışmayan çoklu eşleşme hata vermeli: iki node'un da localRoot değeri bu bilgisayarda yok.
    $ambiguousConfiguration = New-TestConfiguration -ExistingRoot 'D:\Yok\ActiveRelease'
    Assert-Throws -Action {
        Get-LocalSamePathCopyIdentity -Configuration $ambiguousConfiguration -LocalMachineName 'MSI' -LocalAddresses @('10.10.3.162')
    } -ExpectedPattern '*birden fazla node ile eşleşti*' -Message 'Ayrışmayan çoklu eşleşme için hata verilmedi.'

    # Aynı adresi taşıyan iki node da localRoot varlığıyla ayrışmalı.
    $sameAddressConfiguration = [pscustomobject]@{
        nodes = @(
            [pscustomobject]@{ id = 'Yerel'; name = 'Yerel'; address = '10.10.1.10'; localRoot = $existingRoot; networkRoot = 'proje' }
            [pscustomobject]@{ id = 'Uzak'; name = 'Uzak'; address = '10.10.1.10'; localRoot = 'D:\Yok\ActiveRelease'; networkRoot = 'Sim\ActiveRelease' }
        )
    }
    $identity = Get-LocalSamePathCopyIdentity -Configuration $sameAddressConfiguration -LocalMachineName 'MSI' -LocalAddresses @('10.10.1.10')
    Assert-Equal 'Yerel' $identity.Id 'Adrese göre çoklu eşleşme localRoot varlığıyla ayrışmalıydı.'

    # NodeId, otomatik tanımayı tamamen geçersiz kılar.
    $identity = Get-LocalSamePathCopyIdentity -Configuration $configuration -LocalMachineName 'MSI' -LocalAddresses @('10.10.1.10') -NodeId 'unit2trainer'
    Assert-Equal 'Unit2Trainer' $identity.Id 'NodeId ile verilen kimlik kullanılmadı.'

    Assert-Throws -Action {
        Get-LocalSamePathCopyIdentity -Configuration $configuration -LocalMachineName 'MSI' -LocalAddresses @('10.10.1.10') -NodeId 'YokNode'
    } -ExpectedPattern '*eşleşmedi*' -Message 'Config içinde bulunmayan NodeId için hata verilmedi.'

    # Ortam değişkeni de kimlik verebilir.
    $previousNodeId = $env:SAMEPATHCOPY_NODE_ID
    try {
        $env:SAMEPATHCOPY_NODE_ID = 'Unit1IG1'
        $identity = Get-LocalSamePathCopyIdentity -Configuration $configuration -LocalMachineName 'MSI' -LocalAddresses @('10.10.1.10')
        Assert-Equal 'Unit1IG1' $identity.Id 'SAMEPATHCOPY_NODE_ID ortam değişkeni dikkate alınmadı.'
    }
    finally {
        $env:SAMEPATHCOPY_NODE_ID = $previousNodeId
    }

    # Hiç eşleşme yoksa hata mesajı bilgisayarı tarif etmeli.
    Assert-Throws -Action {
        Get-LocalSamePathCopyIdentity -Configuration $configuration -LocalMachineName 'BILINMEYEN' -LocalAddresses @('10.0.0.5')
    } -ExpectedPattern '*hiçbir node ile eşleşmedi*' -Message 'Eşleşme olmadığında hata verilmedi.'

    Write-Host 'Yerel kimlik testleri başarılı.'
}
finally {
    if (Test-Path -LiteralPath $testDirectory) {
        Remove-Item -LiteralPath $testDirectory -Recurse -Force
    }
}
