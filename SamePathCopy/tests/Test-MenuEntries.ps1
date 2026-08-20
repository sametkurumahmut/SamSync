$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $projectDirectory 'SamePathCopy.Common.ps1')

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
    return [pscustomobject]@{
        allLabel = 'Tümü'
        nodes = @(
            [pscustomobject]@{ id = 'Root'; name = 'Root'; address = '10.10.2.82'; localRoot = 'C:\Kok'; networkRoot = 'proje' }
            [pscustomobject]@{ id = 'U1Trainer'; group = 'Unit1'; name = 'Eğitmen 1'; address = '10.10.1.10'; localRoot = 'D:\U1'; networkRoot = 'Sim' }
            [pscustomobject]@{ id = 'U1IG1'; group = 'Unit1'; name = 'IG1 - 1'; address = '10.10.1.11'; localRoot = 'C:\U1'; networkRoot = 'Sim' }
            [pscustomobject]@{ id = 'U2Trainer'; group = 'unit2'; name = 'Eğitmen 2'; address = '10.10.1.30'; localRoot = 'D:\U2'; networkRoot = 'Sim' }
            [pscustomobject]@{ id = 'U2IG1'; group = 'Unit2'; name = 'IG1 - 2'; address = '10.10.1.31'; localRoot = 'C:\U2'; networkRoot = 'Sim' }
            [pscustomobject]@{ id = 'Yedek'; name = 'Yedek sunucu'; address = '10.10.1.90'; localRoot = 'E:\Yedek'; networkRoot = 'Yedek'; enabled = $false }
            [pscustomobject]@{ id = 'Arsiv'; name = 'Arşiv'; address = '10.10.1.91'; localRoot = 'E:\Arsiv'; networkRoot = 'Arsiv' }
        )
    }
}

$configuration = New-TestConfiguration

# Root üzerinde çalışırken: Tümü, her grup kendi makinelerinin başında, gruba ait olmayanlar sonda.
$entries = @(Get-SamePathCopyMenuEntries -Configuration $configuration -ExcludeId 'Root')
$expectedOrder = @('all', 'wizard', 'wizard:last', 'group:Unit1', 'U1Trainer', 'U1IG1', 'group:unit2', 'U2Trainer', 'U2IG1', 'Arsiv')
Assert-Equal ($expectedOrder -join ' > ') (@($entries | ForEach-Object { $_.Id }) -join ' > ') 'Menü sırası beklenenden farklı.'
Assert-Equal 'Tümü' ([string]$entries[0].Label) 'İlk girdi allLabel etiketini taşımalı.'
Assert-Equal 'Wizard' ([string]$entries[1].Label) 'Sihirbaz girdisi Tümü''den hemen sonra gelmeli.'
Assert-Equal 'Wizard (son ayar)' ([string]$entries[2].Label) 'Son ayar girdisi sihirbazdan hemen sonra gelmeli.'
Assert-Equal 'Unit1' ([string]$entries[3].Label) 'Grup girdisinin etiketi grup adı olmalı.'

# İkon yalnızca toplu girdilerde: Tümü, sihirbaz ve gruplar.
Assert-Equal 'all wizard wizard:last group:Unit1 group:unit2' (@($entries | Where-Object { $_.IsAggregate } | ForEach-Object { $_.Id }) -join ' ') 'Toplu girdiler yalnızca Tümü, sihirbaz ve gruplar olmalı.'
Assert-Equal 0 @($entries | Where-Object { $_.Kind -eq 'node' -and $_.IsAggregate }).Count 'Tek makine girdileri toplu işaretlenmemeli.'

# Devre dışı node ne menüde ne de grupta görünür.
Assert-Equal 0 @($entries | Where-Object { $_.Id -eq 'Yedek' }).Count 'enabled=false node menüye eklendi.'

# Unit1 eğitmeninde çalışırken kendisi hem menüden hem grubundan çıkar, grup girdisi kalır.
$trainerEntries = @(Get-SamePathCopyMenuEntries -Configuration $configuration -ExcludeId 'U1Trainer')
Assert-Equal 0 @($trainerEntries | Where-Object { $_.Id -eq 'U1Trainer' }).Count 'Yerel makine menüde kaldı.'
Assert-Equal 1 @($trainerEntries | Where-Object { $_.Id -eq 'group:Unit1' }).Count 'Yerel makinenin grubu menüden kayboldu.'

# Grubun tek üyesi yerel makine ise grup girdisi hiç oluşmaz.
$singleMemberConfiguration = [pscustomobject]@{
    allLabel = 'Tümü'
    nodes = @(
        [pscustomobject]@{ id = 'Tek'; group = 'Tekli'; name = 'Tek makine'; address = '10.10.1.10'; localRoot = 'D:\Tek'; networkRoot = 'Sim' }
        [pscustomobject]@{ id = 'Diger'; name = 'Diğer'; address = '10.10.1.20'; localRoot = 'D:\Diger'; networkRoot = 'Sim' }
    )
}
Assert-Equal 0 @(Get-SamePathCopyMenuEntries -Configuration $singleMemberConfiguration -ExcludeId 'Tek' | Where-Object { $_.Kind -eq 'group' }).Count 'Üyesi kalmayan grup için girdi üretildi.'

# Hedef çözümü: grup kimliği o grubun makinelerini verir, yerel makine hiçbir zaman hedef olmaz.
$localIdentity = [pscustomobject]@{ Id = 'Root'; Name = 'Root'; Root = 'C:\Kok' }
Assert-Equal 'U1Trainer U1IG1' (@(Resolve-SamePathCopyTargets -Configuration $configuration -TargetId 'group:Unit1' -LocalIdentity $localIdentity | ForEach-Object { $_.id }) -join ' ') 'Grup hedefleri yanlış çözüldü.'
Assert-Equal 'U2Trainer U2IG1' (@(Resolve-SamePathCopyTargets -Configuration $configuration -TargetId 'GROUP:UNIT2' -LocalIdentity $localIdentity | ForEach-Object { $_.id }) -join ' ') 'Grup adı büyük/küçük harfe duyarsız olmalı.'
Assert-Equal 5 @(Resolve-SamePathCopyTargets -Configuration $configuration -TargetId 'all' -LocalIdentity $localIdentity).Count 'Tümü hedef sayısı yanlış (Root yerel, Yedek devre dışı).'
Assert-Equal 'U1IG1' (@(Resolve-SamePathCopyTargets -Configuration $configuration -TargetId 'U1IG1' -LocalIdentity $localIdentity | ForEach-Object { $_.id }) -join ' ') 'Tek node hedefi çözülemedi.'

$trainerIdentity = [pscustomobject]@{ Id = 'U1Trainer'; Name = 'Eğitmen 1'; Root = 'D:\U1' }
Assert-Equal 'U1IG1' (@(Resolve-SamePathCopyTargets -Configuration $configuration -TargetId 'group:Unit1' -LocalIdentity $trainerIdentity | ForEach-Object { $_.id }) -join ' ') 'Grup hedefleri yerel makineyi içermemeli.'

Assert-Throws -Action {
    Resolve-SamePathCopyTargets -Configuration $singleMemberConfiguration -TargetId 'group:Tekli' -LocalIdentity ([pscustomobject]@{ Id = 'Tek'; Name = 'Tek makine'; Root = 'D:\Tek' })
} -ExpectedPattern '*etkin hedef yok*' -Message 'Üyesi kalmayan grup için hata verilmedi.'

Assert-Throws -Action {
    Resolve-SamePathCopyTargets -Configuration $configuration -TargetId 'group:YokGrup' -LocalIdentity $localIdentity
} -ExpectedPattern '*etkin hedef yok*' -Message 'Bilinmeyen grup için hata verilmedi.'

Assert-Throws -Action {
    Resolve-SamePathCopyTargets -Configuration $configuration -TargetId 'Root' -LocalIdentity $localIdentity
} -ExpectedPattern '*Kaynak bilgisayar hedef olarak seçilemez*' -Message 'Yerel makine hedef seçilince hata verilmedi.'

Write-Host 'Menü girdisi ve hedef çözümü testleri başarılı.'
