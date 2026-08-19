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

        if (-not $node.PSObject.Properties['name'] -or -not $node.PSObject.Properties['address'] -or -not $node.PSObject.Properties['localRoot'] -or -not $node.PSObject.Properties['networkRoot'] -or -not $node.name -or -not $node.address -or -not $node.localRoot -or -not $node.networkRoot) {
            throw "Her node içinde id, name, address, localRoot ve networkRoot alanları bulunmalı."
        }
        if ([string]$node.address -match '[\\/:*?"<>|]') {
            throw "Node address alanı yalnızca bilgisayar adı veya IP adresi olmalı: $($node.address)"
        }
        if ([string]$node.localRoot -notmatch '^[A-Za-z]:\\') {
            throw "Node localRoot değeri sürücü harfiyle başlayan mutlak bir yol olmalı: $($node.localRoot)"
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

    return [pscustomobject]@{
        Id = [string]$Node.id
        Name = [string]$Node.name
        Root = [string]$Node.localRoot
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
            # Birden fazla node aynı adresi/adı paylaşıyorsa, localRoot değeri bu bilgisayarda var olan tek node seçilir.
            $existingRootNodes = @($candidateNodes | Where-Object { Test-Path -LiteralPath ([string]$_.localRoot) -PathType Container })
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

function Get-SamePathCopyDestination {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string]$LocalRoot,
        [Parameter(Mandatory = $true)][string]$Address,
        [Parameter(Mandatory = $true)][string]$NetworkRoot
    )

    $fullPath = [System.IO.Path]::GetFullPath($SourcePath)
    $fullLocalRoot = [System.IO.Path]::GetFullPath($LocalRoot)
    if ($fullLocalRoot.Length -gt 3) {
        $fullLocalRoot = $fullLocalRoot.TrimEnd('\')
    }

    $isInsideLocalRoot = $false
    if ($fullPath.Equals($fullLocalRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        $isInsideLocalRoot = $true
        $relativePath = ''
    }
    else {
        $localPrefix = $fullLocalRoot.TrimEnd('\') + '\'
        if ($fullPath.StartsWith($localPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            $isInsideLocalRoot = $true
            $relativePath = $fullPath.Substring($localPrefix.Length)
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
