Set-StrictMode -Version 2.0

function Get-SamePathCopyConfiguration {
    param([Parameter(Mandatory = $true)][string]$ConfigPath)

    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
        throw "Yapılandırma dosyası bulunamadı: $ConfigPath"
    }

    try {
        $config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        throw "Yapılandırma dosyası geçerli JSON değil: $($_.Exception.Message)"
    }

    if (-not $config.PSObject.Properties['version'] -or -not $config.version) {
        $config | Add-Member -NotePropertyName version -NotePropertyValue '1.0.0' -Force
    }
    if ([string]$config.version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$') {
        throw "version değeri SemVer biçiminde olmalı (örnek: 1.0.0): $($config.version)"
    }
    if (-not $config.PSObject.Properties['menuTitle'] -or -not $config.menuTitle) {
        $config | Add-Member -NotePropertyName menuTitle -NotePropertyValue "Aynı Dizine Kopyala" -Force
    }
    if (-not $config.PSObject.Properties['allLabel'] -or -not $config.allLabel) {
        $config | Add-Member -NotePropertyName allLabel -NotePropertyValue "Tümü" -Force
    }
    if (-not $config.PSObject.Properties['nodes'] -or -not $config.nodes) {
        throw "config.json içinde en az bir node tanımlanmalı."
    }

    $seenIds = @{}
    foreach ($node in $config.nodes) {
        $nodeId = if ($node.PSObject.Properties['id']) { ([string]$node.id).Trim() } else { '' }
        $isValidNodeId = -not [string]::IsNullOrWhiteSpace($nodeId) -and
            [System.Text.RegularExpressions.Regex]::IsMatch(
                $nodeId,
                '^[A-Za-z0-9._-]+$',
                [System.Text.RegularExpressions.RegexOptions]::CultureInvariant
            )
        if (-not $isValidNodeId) {
            throw "Node id değeri büyük/küçük İngilizce harf, rakam, nokta, alt çizgi ve tire içerebilir: '$nodeId'"
        }
        if ($seenIds.ContainsKey($nodeId)) {
            throw "Node id değerleri büyük/küçük harfe duyarsız olarak benzersiz olmalı. Tekrarlanan değer: $nodeId"
        }
        $seenIds[$nodeId] = $true
        $node.id = $nodeId

        if (-not $node.PSObject.Properties['name'] -or -not $node.PSObject.Properties['address'] -or -not $node.PSObject.Properties['networkRoot'] -or -not $node.name -or -not $node.address -or -not $node.networkRoot) {
            throw "Her node içinde id, name, address, networkRoot ve localRoot/localRoots alanları bulunmalı."
        }
        if ([string]$node.address -match '[\\/:*?"<>|]') {
            throw "Node address alanı yalnızca bilgisayar adı veya IP adresi olmalı: $($node.address)"
        }
        # Yerel kök tek bir localRoot ya da localRoots listesiyle verilebilir; ikisi birlikte de kullanılabilir.
        $declaredRoots = @(
            $(if ($node.PSObject.Properties['localRoot']) { [string]$node.localRoot }),
            $(if ($node.PSObject.Properties['localRoots']) { @($node.localRoots | ForEach-Object { [string]$_ }) })
        ) | ForEach-Object { $_ } | Where-Object { $null -ne $_ }
        if (@($declaredRoots).Count -eq 0) {
            throw "Node içinde localRoot ya da localRoots alanlarından biri bulunmalı: $nodeId"
        }
        foreach ($declaredRoot in @($declaredRoots)) {
            if ([string]::IsNullOrWhiteSpace($declaredRoot)) {
                throw "Node yerel kök değeri boş olamaz: $nodeId"
            }
            if ($declaredRoot -notmatch '^[A-Za-z]:\\') {
                throw "Node yerel kök değeri sürücü harfiyle başlayan mutlak bir yol olmalı: $declaredRoot"
            }
        }
        $networkRoot = ([string]$node.networkRoot).Trim('\')
        if ([string]::IsNullOrWhiteSpace($networkRoot) -or $networkRoot -match '[:*?"<>|]' -or $networkRoot -match '(^|\\)\.\.?($|\\)') {
            throw "Node networkRoot değeri paylaşım adıyla başlamalı ve geçerli bir ağ yolu olmalı: $($node.networkRoot)"
        }
        if ($node.PSObject.Properties['localNames']) {
            foreach ($localName in @($node.localNames)) {
                if ([string]::IsNullOrWhiteSpace([string]$localName)) {
                    throw "localNames içinde boş değer bulunamaz: $nodeId"
                }
            }
        }
        if ($node.PSObject.Properties['group']) {
            # Grup adı menüde etiket, komutlarda ise "group:<ad>" hedef kimliği olarak kullanıldığı için node id ile aynı karakterlerle sınırlıdır.
            $groupName = ([string]$node.group).Trim()
            if ($groupName -and -not [System.Text.RegularExpressions.Regex]::IsMatch(
                    $groupName,
                    '^[A-Za-z0-9._-]+$',
                    [System.Text.RegularExpressions.RegexOptions]::CultureInvariant)) {
                throw "Node group değeri büyük/küçük İngilizce harf, rakam, nokta, alt çizgi ve tire içerebilir: '$groupName'"
            }
            $node.group = $groupName
        }
    }

    if (-not $config.PSObject.Properties['copy'] -or -not $config.copy) {
        $config | Add-Member -NotePropertyName copy -NotePropertyValue ([pscustomobject]@{}) -Force
    }
    if (-not $config.copy.PSObject.Properties['retryCount'] -or $null -eq $config.copy.retryCount) {
        $config.copy | Add-Member -NotePropertyName retryCount -NotePropertyValue 2
    }
    if (-not $config.copy.PSObject.Properties['waitSeconds'] -or $null -eq $config.copy.waitSeconds) {
        $config.copy | Add-Member -NotePropertyName waitSeconds -NotePropertyValue 1
    }
    if ([int]$config.copy.retryCount -lt 0 -or [int]$config.copy.retryCount -gt 100) {
        throw "retryCount 0 ile 100 arasında olmalı."
    }
    if ([int]$config.copy.waitSeconds -lt 0 -or [int]$config.copy.waitSeconds -gt 60) {
        throw "waitSeconds 0 ile 60 arasında olmalı."
    }

    return $config
}

function Get-EnabledSamePathCopyNodes {
    param(
        [Parameter(Mandatory = $true)]$Configuration,
        [string]$ExcludeId
    )

    return @($Configuration.nodes | Where-Object {
        ($null -eq $ExcludeId -or [string]$_.id -ne $ExcludeId) -and
        (-not $_.PSObject.Properties['enabled'] -or $null -eq $_.enabled -or [bool]$_.enabled)
    })
}

function ConvertTo-SamePathCopyIdentity {
    param([Parameter(Mandatory = $true)]$Node)

    $roots = @(Get-SamePathCopyLocalRoots -Node $Node)
    return [pscustomobject]@{
        Id = [string]$Node.id
        Name = [string]$Node.name
        Roots = $roots
        # Root, tek köklü kullanımlar ve ekranda gösterim için ilk kökü verir.
        Root = if ($roots.Count -gt 0) { [string]$roots[0] } else { '' }
    }
}

function Get-LocalSamePathCopyIdentity {
    param(
        [Parameter(Mandatory = $true)]$Configuration,
        [string]$LocalMachineName,
        [string[]]$LocalAddresses,
        [string]$NodeId
    )

    if (-not $PSBoundParameters.ContainsKey('LocalMachineName')) {
        $LocalMachineName = [System.Environment]::MachineName
    }
    if (-not $PSBoundParameters.ContainsKey('LocalAddresses')) {
        $LocalAddresses = @(
            [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
                ForEach-Object { $_.GetIPProperties().UnicastAddresses } |
                ForEach-Object { $_.Address.IPAddressToString }
        )
    }
    if (-not $PSBoundParameters.ContainsKey('NodeId')) {
        $NodeId = [string]$env:SAMEPATHCOPY_NODE_ID
    }

    # Aynı config dosyası tüm bilgisayarlara olduğu gibi dağıtılabilsin diye kimlik en belirleyici ölçütten
    # başlanarak çözülür: 1) SAMEPATHCOPY_NODE_ID, 2) IP adresi, 3) bilgisayar adı, 4) localRoot'un varlığı.
    if (-not [string]::IsNullOrWhiteSpace($NodeId)) {
        $requestedNodeId = $NodeId.Trim()
        $requestedNodes = @($Configuration.nodes | Where-Object { ([string]$_.id).Equals($requestedNodeId, [System.StringComparison]::OrdinalIgnoreCase) })
        if ($requestedNodes.Count -ne 1) {
            throw "SAMEPATHCOPY_NODE_ID / NodeId ile verilen '$requestedNodeId' config içindeki node kimlikleriyle eşleşmedi."
        }
        return ConvertTo-SamePathCopyIdentity -Node $requestedNodes[0]
    }

    $addressSet = @{}
    foreach ($value in @($LocalAddresses)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$value)) { $addressSet[[string]$value] = $true }
    }
    $nameSet = @{}
    foreach ($value in @($LocalMachineName, "$LocalMachineName.$env:USERDNSDOMAIN")) {
        if (-not [string]::IsNullOrWhiteSpace([string]$value)) { $nameSet[[string]$value] = $true }
    }

    $addressNodes = @($Configuration.nodes | Where-Object { $addressSet.ContainsKey([string]$_.address) })
    $nameNodes = @($Configuration.nodes | Where-Object {
        $candidateValues = @([string]$_.address)
        if ($_.PSObject.Properties['localNames']) {
            $candidateValues += @($_.localNames | ForEach-Object { [string]$_ })
        }
        @($candidateValues | Where-Object { $nameSet.ContainsKey($_) }).Count -gt 0
    })

    foreach ($tier in @(
        [pscustomobject]@{ Nodes = $addressNodes; Source = 'IP adresi' },
        [pscustomobject]@{ Nodes = $nameNodes; Source = 'bilgisayar adı' }
    )) {
        $candidateNodes = @($tier.Nodes)
        if ($candidateNodes.Count -eq 0) { continue }
        if ($candidateNodes.Count -gt 1) {
            # Birden fazla node aynı adresi/adı paylaşıyorsa, köklerinden biri bu bilgisayarda var olan tek node seçilir.
            $existingRootNodes = @($candidateNodes | Where-Object {
                @(Get-SamePathCopyLocalRoots -Node $_ | Where-Object { Test-Path -LiteralPath $_ -PathType Container }).Count -gt 0
            })
            if ($existingRootNodes.Count -eq 1) { $candidateNodes = $existingRootNodes }
        }
        if ($candidateNodes.Count -eq 1) {
            return ConvertTo-SamePathCopyIdentity -Node $candidateNodes[0]
        }
        throw "Bu bilgisayar $($tier.Source) ile birden fazla node ile eşleşti: $(@($candidateNodes | ForEach-Object { $_.id }) -join ', '). Bu bilgisayarın adresi/adı yalnızca bir node içinde kalmalı, localRoot değerleri ayrışmalı ya da SAMEPATHCOPY_NODE_ID ortam değişkeniyle node kimliği verilmelidir."
    }

    $addressesText = @($LocalAddresses) -join ', '
    throw "Bu bilgisayar config içindeki hiçbir node ile eşleşmedi. Bilgisayar adı: $LocalMachineName; IP: $addressesText. nodes listesine bu bilgisayarı ekleyin."
}

$script:SamePathCopyBackupFolderName = '_SamePathCopyYedek'

function Get-SamePathCopyBackupFolderName {
    return $script:SamePathCopyBackupFolderName
}

function Get-SamePathCopyBackupPath {
    param(
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][string]$Address,
        [Parameter(Mandatory = $true)][string]$NetworkRoot,
        [Parameter(Mandatory = $true)][string]$Stamp
    )

    # Yedek, hedefin paylaşım kökü altındaki ayrı bir klasöre, hedefle aynı göreli yolu koruyarak alınır.
    $uncRoot = "\\$Address\$($NetworkRoot.Trim('\'))"
    $relativePath = ''
    if ($Destination.StartsWith($uncRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        $relativePath = $Destination.Substring($uncRoot.Length).TrimStart('\')
    }
    $backupRoot = "$uncRoot\$(Get-SamePathCopyBackupFolderName)\$Stamp"
    if ([string]::IsNullOrWhiteSpace($relativePath)) { return $backupRoot }
    return "$backupRoot\$relativePath"
}

function Get-SamePathCopyRobocopyArguments {
    param(
        [Parameter(Mandatory = $true)][string]$SourceDirectory,
        [Parameter(Mandatory = $true)][string]$DestinationDirectory,
        [string]$FileFilter,
        [Parameter(Mandatory = $true)][bool]$IsDirectory,
        [Parameter(Mandatory = $true)][int]$RetryCount,
        [Parameter(Mandatory = $true)][int]$WaitSeconds,
        $Options,
        [string]$LogPath
    )

    $quote = { param([string]$Value) '"' + $Value.Replace('"', '""') + '"' }
    $useMirror = $IsDirectory -and (Get-SamePathCopyOptionValue -Options $Options -Name 'Mirror')
    $arguments = @((& $quote $SourceDirectory), (& $quote $DestinationDirectory))
    if ($FileFilter) { $arguments += (& $quote $FileFilter) }
    if ($IsDirectory) {
        # /MIR zaten /E içerir; ikisini birlikte vermek gereksiz.
        $arguments += $(if ($useMirror) { '/MIR' } else { '/E' })
        $arguments += '/DCOPY:DAT'
        # Yedek klasörü hedefin altında durduğu için kopyalamaya dahil edilmez.
        $arguments += ('/XD ' + (& $quote (Get-SamePathCopyBackupFolderName)))
    }
    if (Get-SamePathCopyOptionValue -Options $Options -Name 'FastCopy') {
        # /MT yeniden başlatılabilir kip (/Z) ile birlikte kullanılmaz; hız seçilince /Z düşer.
        $arguments += '/MT:8'
    }
    else {
        $arguments += '/Z'
    }
    if (Get-SamePathCopyOptionValue -Options $Options -Name 'OnlyNewer') { $arguments += '/XO' }
    if (Get-SamePathCopyOptionValue -Options $Options -Name 'DryRun') { $arguments += '/L' }
    $arguments += @('/COPY:DAT', '/FFT', "/R:$RetryCount", "/W:$WaitSeconds", '/NP', '/NJH', '/NJS', '/NFL', '/NDL')
    if (-not [string]::IsNullOrWhiteSpace($LogPath)) {
        $arguments += ('/UNILOG:' + (& $quote $LogPath))
    }
    return @($arguments)
}

function Get-SamePathCopyOptionLabel {
    param([Parameter(Mandatory = $true)][string]$Name)

    # Arayüzde gösterilen kısa adlar; -PlanOnly çıktısı makine tarafından okunabilir kalsın diye İngilizce adları korur.
    $labels = @{
        Backup = 'yedek'
        OnlyNewer = 'yalnızca yeni'
        Mirror = 'ayna'
        DryRun = 'deneme'
        FastCopy = 'hızlı'
    }
    if ($labels.ContainsKey($Name)) { return [string]$labels[$Name] }
    return $Name
}

function Get-SamePathCopyOptionValue {
    param($Options, [Parameter(Mandatory = $true)][string]$Name)

    if ($null -eq $Options -or -not $Options.PSObject.Properties[$Name]) { return $false }
    return [bool]$Options.$Name
}

function Test-SamePathCopyTargetReachability {
    param(
        [Parameter(Mandatory = $true)][object[]]$Targets,
        [int]$TimeoutMilliseconds = 900,
        [int]$Port = 445
    )

    # SMB portuna eşzamanlı TCP yoklaması yapılır: kapalı bir eğitmen bilgisayarı kopyalama başlamadan görülür.
    # Paylaşım ve yetki denetimi kopyalama anında zaten yapılıyor; buradaki amaç yalnızca makinenin ayakta olması.
    $probes = @()
    foreach ($target in $Targets) {
        # Adresi olmayan girdi yoklanmaz; sonuç kümesinde yer almaz ve arayüzde "sınanmadı" olarak kalır.
        if (-not $target.PSObject.Properties['address'] -or [string]::IsNullOrWhiteSpace([string]$target.address)) { continue }
        $address = [string]$target.address
        $client = New-Object System.Net.Sockets.TcpClient
        $async = $null
        try { $async = $client.BeginConnect($address, $Port, $null, $null) } catch { $async = $null }
        $probes += [pscustomobject]@{ Id = [string]$target.id; Address = $address; Client = $client; Async = $async }
    }

    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
    $status = @{}
    foreach ($probe in $probes) {
        $reachable = $false
        try {
            if ($null -ne $probe.Async) {
                $remaining = [int][Math]::Max(0, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
                if ($probe.Async.AsyncWaitHandle.WaitOne($remaining)) {
                    $probe.Client.EndConnect($probe.Async)
                    $reachable = [bool]$probe.Client.Connected
                }
            }
        }
        catch {
            $reachable = $false
        }
        finally {
            try { $probe.Client.Close() } catch { }
        }
        $status[$probe.Id] = [pscustomobject]@{ Reachable = $reachable; Address = $probe.Address; Port = $Port }
    }
    return $status
}

function Get-SamePathCopyNodeGroup {
    param([Parameter(Mandatory = $true)]$Node)

    if (-not $Node.PSObject.Properties['group']) { return '' }
    return ([string]$Node.group).Trim()
}

function Get-SamePathCopyMenuEntries {
    param(
        [Parameter(Mandatory = $true)]$Configuration,
        [string]$ExcludeId
    )

    # Menü sırası: Tümü, ardından her grup kendi makinelerinin başında, en sonda gruba ait olmayan makineler.
    # Explorer ve Notepad++ menüleri aynı listeyi kullandığı için sıra ve etiketler her iki menüde birebir aynıdır.
    $targets = @(Get-EnabledSamePathCopyNodes -Configuration $Configuration -ExcludeId $ExcludeId)
    $wizardLabel = if ($Configuration.PSObject.Properties['wizardLabel'] -and -not [string]::IsNullOrWhiteSpace([string]$Configuration.wizardLabel)) {
        [string]$Configuration.wizardLabel
    }
    else {
        'Wizard'
    }
    # "wizard:last" sihirbaz penceresini açmaz: son kaydedilen seçim ve parametrelerle doğrudan kopyalar.
    # Klavye kısayolu bu girdiye bağlandığında tek tuşla, hedef seçmeye uğraşmadan gönderim yapılır.
    $wizardLastLabel = if ($Configuration.PSObject.Properties['wizardLastLabel'] -and -not [string]::IsNullOrWhiteSpace([string]$Configuration.wizardLastLabel)) {
        [string]$Configuration.wizardLastLabel
    }
    else {
        'Wizard (son ayar)'
    }
    $entries = @(
        [pscustomobject]@{ Kind = 'all'; Id = 'all'; Label = [string]$Configuration.allLabel; IsAggregate = $true }
        [pscustomobject]@{ Kind = 'wizard'; Id = 'wizard'; Label = $wizardLabel; IsAggregate = $true }
        [pscustomobject]@{ Kind = 'wizardLast'; Id = 'wizard:last'; Label = $wizardLastLabel; IsAggregate = $true }
    )

    $groupKeys = New-Object System.Collections.Generic.List[string]
    $groupLabels = @{}
    $groupMembers = @{}
    foreach ($target in $targets) {
        $groupName = Get-SamePathCopyNodeGroup -Node $target
        if ([string]::IsNullOrWhiteSpace($groupName)) { continue }
        $groupKey = $groupName.ToLowerInvariant()
        if (-not $groupLabels.ContainsKey($groupKey)) {
            $groupLabels[$groupKey] = $groupName
            $groupMembers[$groupKey] = New-Object System.Collections.Generic.List[object]
            $groupKeys.Add($groupKey)
        }
        $groupMembers[$groupKey].Add($target)
    }

    foreach ($groupKey in $groupKeys) {
        $entries += [pscustomobject]@{ Kind = 'group'; Id = "group:$($groupLabels[$groupKey])"; Label = [string]$groupLabels[$groupKey]; IsAggregate = $true }
        foreach ($member in $groupMembers[$groupKey]) {
            $entries += [pscustomobject]@{ Kind = 'node'; Id = [string]$member.id; Label = [string]$member.name; IsAggregate = $false }
        }
    }
    foreach ($target in $targets) {
        if (-not [string]::IsNullOrWhiteSpace((Get-SamePathCopyNodeGroup -Node $target))) { continue }
        $entries += [pscustomobject]@{ Kind = 'node'; Id = [string]$target.id; Label = [string]$target.name; IsAggregate = $false }
    }
    return $entries
}

function Resolve-SamePathCopyTargets {
    param(
        [Parameter(Mandatory = $true)]$Configuration,
        [Parameter(Mandatory = $true)][string]$TargetId,
        [Parameter(Mandatory = $true)]$LocalIdentity
    )

    $targets = @(Get-EnabledSamePathCopyNodes -Configuration $Configuration -ExcludeId $LocalIdentity.Id)
    # Sihirbaz bütün hedeflerle açılır; hangilerine gönderileceğini kullanıcı arayüzde seçer.
    # wizard:last aynı listeyle başlar, seçim kaydedilmiş sihirbaz ayarından uygulanır.
    if ($TargetId -eq 'all' -or $TargetId -eq 'wizard' -or $TargetId -eq 'wizard:last') { return $targets }

    if ($TargetId.StartsWith('group:', [System.StringComparison]::OrdinalIgnoreCase)) {
        $groupName = $TargetId.Substring(6).Trim()
        if ([string]::IsNullOrWhiteSpace($groupName)) { throw "Grup adı verilmedi: $TargetId" }
        $groupTargets = @($targets | Where-Object { (Get-SamePathCopyNodeGroup -Node $_).Equals($groupName, [System.StringComparison]::OrdinalIgnoreCase) })
        if ($groupTargets.Count -eq 0) {
            throw "'$groupName' grubunda bu bilgisayar dışında etkin hedef yok."
        }
        return $groupTargets
    }

    $nodeTargets = @($targets | Where-Object { [string]$_.id -eq $TargetId })
    if ($nodeTargets.Count -eq 0) {
        if ($TargetId -eq $LocalIdentity.Id) {
            throw "Kaynak bilgisayar hedef olarak seçilemez: $($LocalIdentity.Name)"
        }
        throw "Etkin hedef bulunamadı: $TargetId"
    }
    return $nodeTargets
}

function Get-SamePathCopyLocalRoots {
    param([Parameter(Mandatory = $true)]$Node)

    # Tek köklü eski yapılandırmalar da desteklenir: localRoot ilk kök, localRoots ek kökler.
    $roots = New-Object System.Collections.Generic.List[string]
    $seen = @{}
    foreach ($candidate in @(
        $(if ($Node.PSObject.Properties['localRoot']) { [string]$Node.localRoot }),
        $(if ($Node.PSObject.Properties['localRoots']) { @($Node.localRoots | ForEach-Object { [string]$_ }) })
    ) | ForEach-Object { $_ }) {
        $root = ([string]$candidate).Trim()
        if ([string]::IsNullOrWhiteSpace($root)) { continue }
        $normalized = [System.IO.Path]::GetFullPath($root)
        if ($normalized.Length -gt 3) { $normalized = $normalized.TrimEnd('\') }
        $key = $normalized.ToLowerInvariant()
        if ($seen.ContainsKey($key)) { continue }
        $seen[$key] = $true
        $roots.Add($normalized)
    }
    return @($roots)
}

function Get-SamePathCopyMatchingRoot {
    param(
        [Parameter(Mandatory = $true)][string]$FullPath,
        [string[]]$LocalRoots
    )

    # İç içe kökler tanımlanmışsa en uzun eşleşen kök kullanılır; göreli yol böylece en yakın köke göre hesaplanır.
    $bestRoot = $null
    foreach ($root in @($LocalRoots)) {
        if ([string]::IsNullOrWhiteSpace($root)) { continue }
        $isMatch = $FullPath.Equals($root, [System.StringComparison]::OrdinalIgnoreCase) -or
            $FullPath.StartsWith(($root.TrimEnd('\') + '\'), [System.StringComparison]::OrdinalIgnoreCase)
        if (-not $isMatch) { continue }
        if ($null -eq $bestRoot -or $root.Length -gt $bestRoot.Length) { $bestRoot = $root }
    }
    return $bestRoot
}

function Get-SamePathCopyDestination {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string[]]$LocalRoots,
        [Parameter(Mandatory = $true)][string]$Address,
        [Parameter(Mandatory = $true)][string]$NetworkRoot
    )

    $fullPath = [System.IO.Path]::GetFullPath($SourcePath)
    $normalizedRoots = @(@($LocalRoots) | ForEach-Object {
        if ([string]::IsNullOrWhiteSpace($_)) { return }
        $normalized = [System.IO.Path]::GetFullPath([string]$_)
        if ($normalized.Length -gt 3) { $normalized = $normalized.TrimEnd('\') }
        $normalized
    })
    $matchedRoot = Get-SamePathCopyMatchingRoot -FullPath $fullPath -LocalRoots $normalizedRoots

    $isInsideLocalRoot = $null -ne $matchedRoot
    if ($isInsideLocalRoot) {
        $relativePath = if ($fullPath.Equals($matchedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            ''
        }
        else {
            $fullPath.Substring(($matchedRoot.TrimEnd('\') + '\').Length)
        }
    }

    if (-not $isInsideLocalRoot) {
        $sourceDriveRoot = [System.IO.Path]::GetPathRoot($fullPath)
        if ($sourceDriveRoot -match '^([A-Za-z]):\\$') {
            $driveFolder = $Matches[1].ToUpperInvariant()
            $driveRelativePath = $fullPath.Substring($sourceDriveRoot.Length).TrimStart('\')
            $relativePath = if ([string]::IsNullOrWhiteSpace($driveRelativePath)) {
                $driveFolder
            }
            else {
                "$driveFolder\$driveRelativePath"
            }
        }
        elseif ($fullPath.StartsWith('\\')) {
            $relativePath = 'UNC\' + $fullPath.TrimStart('\')
        }
        else {
            throw "Seçilen öğenin tam yolu hedef altında güvenli biçimde oluşturulamadı: $fullPath"
        }
    }

    $normalizedNetworkRoot = $NetworkRoot.Trim('\')
    $uncRoot = "\\$Address\$normalizedNetworkRoot"
    if ([string]::IsNullOrWhiteSpace($relativePath)) {
        return $uncRoot
    }
    return "$uncRoot\$relativePath"
}
