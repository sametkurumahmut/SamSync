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
$expectedOrder = @('all', 'wizard', 'wizard:last', 'restore', 'group:Unit1', 'U1Trainer', 'U1IG1', 'group:unit2', 'U2Trainer', 'U2IG1', 'Arsiv')
Assert-Equal ($expectedOrder -join ' > ') (@($entries | ForEach-Object { $_.Id }) -join ' > ') 'Menü sırası beklenenden farklı.'
Assert-Equal 'Tümü' ([string]$entries[0].Label) 'İlk girdi allLabel etiketini taşımalı.'
Assert-Equal 'Wizard' ([string]$entries[1].Label) 'Sihirbaz girdisi Tümü''den hemen sonra gelmeli.'
Assert-Equal 'Wizard (son ayar)' ([string]$entries[2].Label) 'Son ayar girdisi sihirbazdan hemen sonra gelmeli.'
Assert-Equal 'Yedekten geri al' ([string]$entries[3].Label) 'Geri alma girdisi toplu girdilerin sonunda gelmeli.'
Assert-Equal 'Unit1' ([string]$entries[4].Label) 'Grup girdisinin etiketi grup adı olmalı.'

# İkon yalnızca toplu girdilerde: Tümü, sihirbaz ve gruplar.
Assert-Equal 'all wizard wizard:last restore group:Unit1 group:unit2' (@($entries | Where-Object { $_.IsAggregate } | ForEach-Object { $_.Id }) -join ' ') 'Toplu girdiler yalnızca Tümü, sihirbaz ve gruplar olmalı.'
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

# --- menü bütçesi planı ---------------------------------------------------------------------------
# Windows sağ tık menüsü bütün ağaçta en fazla 16 öğe gösteriyor. Plan, bu bütçeyi kimin harcayacağına
# karar veriyor: bu makinenin kendi grubu tek tek açılıyor, sığmayan gruplar grup girdisi olarak kalıyor.
function New-PlanEntries {
    param(
        [Parameter(Mandatory = $true)][int]$GroupCount,
        [Parameter(Mandatory = $true)][int]$MembersPerGroup,
        [int]$UngroupedCount = 0,
        [int]$AggregateCount = 4
    )

    # Gerçek girdi listesinin plan için önemli olan kısmı: Kind ve GroupName.
    $entries = @()
    foreach ($aggregateIndex in 1..$AggregateCount) {
        $entries += [pscustomobject]@{ Kind = 'all'; Id = "toplu$aggregateIndex"; Label = "Toplu $aggregateIndex"; GroupName = '' }
    }
    if ($GroupCount -gt 0) {
        foreach ($groupIndex in 1..$GroupCount) {
            $groupName = "Unit$groupIndex"
            $entries += [pscustomobject]@{ Kind = 'group'; Id = "group:$groupName"; Label = $groupName; GroupName = $groupName }
            if ($MembersPerGroup -gt 0) {
                foreach ($memberIndex in 1..$MembersPerGroup) {
                    $entries += [pscustomobject]@{ Kind = 'node'; Id = "U${groupIndex}M$memberIndex"; Label = "Makine $memberIndex"; GroupName = $groupName }
                }
            }
        }
    }
    if ($UngroupedCount -gt 0) {
        foreach ($ungroupedIndex in 1..$UngroupedCount) {
            $entries += [pscustomobject]@{ Kind = 'node'; Id = "Tek$ungroupedIndex"; Label = "Tek $ungroupedIndex"; GroupName = '' }
        }
    }
    return $entries
}

Assert-Equal 16 (Get-SamePathCopyMenuItemBudget) 'Menü bütçesi 16 olmalı.'

# Kullanıcının ortamı: 4 toplu + 3 grup + 1 gruba ait olmayan makine. Kendi grubunda 3 üye var.
# 4 + 3 + 1 = 8, kendi grubu +1 (grubun "Tümü" girdisi) +3 üye = 12; öbür gruplar 5+5 ile sığmıyor.
$realisticEntries = @(New-PlanEntries -GroupCount 3 -MembersPerGroup 4 -UngroupedCount 1)
$ownGroupPlan = Get-SamePathCopyMenuPlan -Entries @(New-PlanEntries -GroupCount 3 -MembersPerGroup 3 -UngroupedCount 1) -LocalGroup 'Unit2'
Assert-Equal 'Unit2' (@($ownGroupPlan.ExpandedGroups) -join ',') 'Yalnızca bu makinenin grubu açılmalı.'
Assert-Equal 'Unit1,Unit3' (@($ownGroupPlan.CollapsedGroups) -join ',') 'Öbür gruplar grup girdisi olarak kalmalı.'
Assert-Equal $true ([bool]$ownGroupPlan.LocalGroupExpanded) 'Kendi grubu açıldı olarak işaretlenmeli.'
Assert-Equal $true ([bool]$ownGroupPlan.IncludeUngroupedNodes) 'Gruba ait olmayan makine menüde kalmalı.'
Assert-Equal 12 ([int]$ownGroupPlan.ItemCount) 'Öğe sayısı yanlış (4 toplu + 3 grup + 1 tek + 1 grup Tümü + 3 üye).'
Assert-Equal $false ([bool]$ownGroupPlan.OverBudget) 'Plan bütçeyi aşmamalı.'
Assert-Equal 6 ([int]$ownGroupPlan.HiddenNodeCount) 'Menüye girmeyen makine sayısı yanlış (kapalı iki grubun üçer üyesi).'

# Grup adı büyük/küçük harf farkıyla verilse de kendi grubu bulunmalı.
Assert-Equal 'Unit2' (@((Get-SamePathCopyMenuPlan -Entries @(New-PlanEntries -GroupCount 3 -MembersPerGroup 3 -UngroupedCount 1) -LocalGroup 'unit2').ExpandedGroups) -join ',') 'Grup adı harf farkıyla eşleşmedi.'

# Bu makine bir gruba ait değilse (geliştirme makinesi) hiçbir grup açılmaz: bir grubu keyfî seçmek yerine
# hepsi grup girdisi olarak kalır. Bütçe yetse bile simetri korunur.
$noLocalGroupPlan = Get-SamePathCopyMenuPlan -Entries $realisticEntries -LocalGroup ''
Assert-Equal 0 @($noLocalGroupPlan.ExpandedGroups).Count 'Yerel grup yokken grup açılmamalı.'
Assert-Equal 8 ([int]$noLocalGroupPlan.ItemCount) 'Yerel grup yokken öğe sayısı yanlış.'
Assert-Equal $false ([bool]$noLocalGroupPlan.LocalGroupExpanded) 'Yerel grup yokken açık işaretlenmemeli.'

# Hepsi sığıyorsa bütün gruplar açılır (küçük yapılandırma): 4 + 2 grup + (1+2)*2 = 12.
$smallPlan = Get-SamePathCopyMenuPlan -Entries @(New-PlanEntries -GroupCount 2 -MembersPerGroup 2) -LocalGroup 'Unit1'
Assert-Equal 'Unit1,Unit2' (@($smallPlan.ExpandedGroups) -join ',') 'Sığan yapılandırmada bütün gruplar açılmalı.'
Assert-Equal 12 ([int]$smallPlan.ItemCount) 'Küçük yapılandırmada öğe sayısı yanlış.'
Assert-Equal 0 ([int]$smallPlan.HiddenNodeCount) 'Sığan yapılandırmada gizli makine olmamalı.'

# Kalan gruplar HEPSİ ya da HİÇBİRİ: biri sığıp öbürü sığmıyorsa ikisi de açılmaz.
# 4 toplu + 3 grup = 7; kendi grubu (1+2)=3 ile 10; kalan iki grup 3+6=9 ile 19 > 16.
$allOrNonePlan = Get-SamePathCopyMenuPlan -Entries @(
    @(New-PlanEntries -GroupCount 1 -MembersPerGroup 2) +
    @([pscustomobject]@{ Kind = 'group'; Id = 'group:Unit2'; Label = 'Unit2'; GroupName = 'Unit2' }) +
    @(1..2 | ForEach-Object { [pscustomobject]@{ Kind = 'node'; Id = "U2M$_"; Label = "Makine $_"; GroupName = 'Unit2' } }) +
    @([pscustomobject]@{ Kind = 'group'; Id = 'group:Unit3'; Label = 'Unit3'; GroupName = 'Unit3' }) +
    @(1..5 | ForEach-Object { [pscustomobject]@{ Kind = 'node'; Id = "U3M$_"; Label = "Makine $_"; GroupName = 'Unit3' } })
) -LocalGroup 'Unit1'
Assert-Equal 'Unit1' (@($allOrNonePlan.ExpandedGroups) -join ',') 'Kalan gruplar hepsi sığmıyorsa hiçbiri açılmamalı.'

# Bütçe kenarı: tam sınırda açılır, bir öğe fazlasında açılmaz.
Assert-Equal 'Unit1' (@((Get-SamePathCopyMenuPlan -Entries @(New-PlanEntries -GroupCount 1 -MembersPerGroup 3 -AggregateCount 11) -LocalGroup 'Unit1').ExpandedGroups) -join ',') 'Tam sınırda grup açılmalı (11+1+1+3=16).'
Assert-Equal 0 @((Get-SamePathCopyMenuPlan -Entries @(New-PlanEntries -GroupCount 1 -MembersPerGroup 3 -AggregateCount 12) -LocalGroup 'Unit1').ExpandedGroups).Count 'Sınırı bir öğe aşınca grup açılmamalı (12+1+1+3=17).'

# Gruba ait olmayan makinelerin hakkı önce gelir: onlar düşerse menüden hiç erişilemezler, oysa bir
# grubun makinelerine grup girdisiyle gönderilebiliyor. 10 toplu + 1 grup + 4 tek = 15; kendi grubu
# (1+3)=4 ile 19'a çıkacağı için açılmaz, ama tek makineler menüde kalır.
$ungroupedFirstPlan = Get-SamePathCopyMenuPlan -Entries @(New-PlanEntries -GroupCount 1 -MembersPerGroup 3 -UngroupedCount 4 -AggregateCount 10) -LocalGroup 'Unit1'
Assert-Equal $true ([bool]$ungroupedFirstPlan.IncludeUngroupedNodes) 'Gruba ait olmayan makineler bütçede önce gelmeli.'
Assert-Equal 0 @($ungroupedFirstPlan.ExpandedGroups).Count 'Tek makineler yer aldıktan sonra grup açılmamalı.'
Assert-Equal 15 ([int]$ungroupedFirstPlan.ItemCount) 'Tek makineli planda öğe sayısı yanlış.'

# Tek makineler de sığmıyorsa menüye konmaz (grup girdileri kalır).
$ungroupedDroppedPlan = Get-SamePathCopyMenuPlan -Entries @(New-PlanEntries -GroupCount 1 -MembersPerGroup 2 -UngroupedCount 6 -AggregateCount 10) -LocalGroup 'Unit1'
Assert-Equal $false ([bool]$ungroupedDroppedPlan.IncludeUngroupedNodes) 'Sığmayan tek makineler menüye konmamalı.'
# Tek makineler kısmen konmaz: hepsi düşünce boşalan yer kendi grubuna gider.
Assert-Equal 'Unit1' (@($ungroupedDroppedPlan.ExpandedGroups) -join ',') 'Tek makineler düştükten sonra kendi grubu açılmalı.'
Assert-Equal 6 ([int]$ungroupedDroppedPlan.HiddenNodeCount) 'Gizli makine sayısı yanlış (menüye girmeyen 6 tek makine).'

# Grup hiç tanımlı değilse tek makineler menüdeki tek hedeftir: bütçeye ve ayara bakılmaz.
$onlyUngroupedPlan = Get-SamePathCopyMenuPlan -Entries @(New-PlanEntries -GroupCount 0 -MembersPerGroup 0 -UngroupedCount 20) -LocalGroup ''
Assert-Equal $true ([bool]$onlyUngroupedPlan.IncludeUngroupedNodes) 'Grup yokken tek makineler her hâlükârda konmalı.'
Assert-Equal $true ([bool]$onlyUngroupedPlan.OverBudget) 'Grup yokken bütçe aşımı bildirilmeli.'
Assert-Equal $true ([bool](Get-SamePathCopyMenuPlan -Entries @(New-PlanEntries -GroupCount 0 -MembersPerGroup 0 -UngroupedCount 20) -LocalGroup '' -ShowNodes 'never').IncludeUngroupedNodes) 'Grup yokken never bile tek makineleri düşürmemeli.'

# menuShowNodes = always: bütçeye bakılmadan hepsi açılır ve aşım bildirilir.
$alwaysPlan = Get-SamePathCopyMenuPlan -Entries $realisticEntries -LocalGroup 'Unit2' -ShowNodes 'always'
Assert-Equal 'Unit1,Unit2,Unit3' (@($alwaysPlan.ExpandedGroups) -join ',') 'always kipinde bütün gruplar açılmalı.'
Assert-Equal $true ([bool]$alwaysPlan.OverBudget) 'always kipinde bütçe aşımı bildirilmeli.'
Assert-Equal 0 ([int]$alwaysPlan.HiddenNodeCount) 'always kipinde gizli makine olmamalı.'

# menuShowNodes = never: hiçbir grup açılmaz, tek makineler de konmaz.
$neverPlan = Get-SamePathCopyMenuPlan -Entries $realisticEntries -LocalGroup 'Unit2' -ShowNodes 'never'
Assert-Equal 0 @($neverPlan.ExpandedGroups).Count 'never kipinde grup açılmamalı.'
Assert-Equal $false ([bool]$neverPlan.IncludeUngroupedNodes) 'never kipinde tek makineler konmamalı.'
Assert-Equal 7 ([int]$neverPlan.ItemCount) 'never kipinde öğe sayısı yanlış.'

# Kimlik nesnesi grubu taşımalı: kurulum yerel grubu buradan okuyor.
$groupedNode = [pscustomobject]@{ id = 'U2T'; name = 'Eğitmen'; group = 'Unit2'; localRoot = 'D:\Sim'; networkRoot = 'Sim' }
Assert-Equal 'Unit2' ([string](ConvertTo-SamePathCopyIdentity -Node $groupedNode).Group) 'Kimlik nesnesi grubu taşımıyor.'
Assert-Equal '' ([string](ConvertTo-SamePathCopyIdentity -Node ([pscustomobject]@{ id = 'Root'; name = 'Root'; localRoot = 'C:\K'; networkRoot = 'K' })).Group) 'Grubu olmayan node için grup boş olmalı.'

Write-Host 'Menü girdisi ve hedef çözümü testleri başarılı.'
