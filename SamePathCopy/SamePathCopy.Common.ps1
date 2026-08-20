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
    # Yedekler hedef paylaşımda birikmesin diye kaç tanesinin tutulacağı yapılandırılır (0 = sınırsız).
    if (-not $config.copy.PSObject.Properties['backupKeep'] -or $null -eq $config.copy.backupKeep) {
        $config.copy | Add-Member -NotePropertyName backupKeep -NotePropertyValue 5 -Force
    }
    if ([int]$config.copy.backupKeep -lt 0 -or [int]$config.copy.backupKeep -gt 500) {
        throw "backupKeep 0 ile 500 arasında olmalı (0 = sınırsız)."
    }
    # Kopyalama sonrası çalıştırılacak komut (isteğe bağlı). Yalnızca config.json'da tanımlıysa çalışır;
    # arayüzden serbest komut girilemez. Hedef başına bir kez, kopyalama başarılıysa çağrılır.
    if (-not $config.copy.PSObject.Properties['postCommand'] -or $null -eq $config.copy.postCommand) {
        $config.copy | Add-Member -NotePropertyName postCommand -NotePropertyValue '' -Force
    }
    if (-not $config.copy.PSObject.Properties['postCommandTimeoutSeconds'] -or $null -eq $config.copy.postCommandTimeoutSeconds) {
        $config.copy | Add-Member -NotePropertyName postCommandTimeoutSeconds -NotePropertyValue 60 -Force
    }
    if ([int]$config.copy.postCommandTimeoutSeconds -lt 1 -or [int]$config.copy.postCommandTimeoutSeconds -gt 3600) {
        throw "postCommandTimeoutSeconds 1 ile 3600 arasında olmalı."
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

function Get-SamePathCopyOptionText {
    param($Options, [Parameter(Mandatory = $true)][string]$Name)

    if ($null -eq $Options -or -not $Options.PSObject.Properties[$Name]) { return '' }
    return ([string]$Options.$Name).Trim()
}

function Get-SamePathCopyOptionNumber {
    param($Options, [Parameter(Mandatory = $true)][string]$Name, [int]$Default = -1)

    if ($null -eq $Options -or -not $Options.PSObject.Properties[$Name] -or $null -eq $Options.$Name) { return $Default }
    $parsed = 0
    if ([int]::TryParse([string]$Options.$Name, [ref]$parsed)) { return $parsed }
    return $Default
}

function Split-SamePathCopyPatternList {
    param([string]$Text)

    # "*.pdb;*.tmp, desktop.ini" gibi listeleri ayirir; bos parcalar atilir.
    if ([string]::IsNullOrWhiteSpace($Text)) { return @() }
    return @($Text -split '[;,]' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

function Get-SamePathCopyBackupRoot {
    param(
        [Parameter(Mandatory = $true)][string]$Address,
        [Parameter(Mandatory = $true)][string]$NetworkRoot
    )

    return "\\$Address\$($NetworkRoot.Trim('\'))\$(Get-SamePathCopyBackupFolderName)"
}

function Remove-SamePathCopyOldBackups {
    param(
        [Parameter(Mandatory = $true)][string]$BackupRoot,
        [Parameter(Mandatory = $true)][int]$Keep
    )

    # Yedek klasörleri "yyyyMMdd-HHmmss" adlarıyla oluşur; en yeni $Keep tanesi kalır, eskiler silinir.
    # Keep 0 ise temizlik yapılmaz. Silme hataları kopyalamayı etkilemez, silinen klasör adları döner.
    if ($Keep -le 0) { return @() }
    if (-not (Test-Path -LiteralPath $BackupRoot -PathType Container)) { return @() }

    $removed = @()
    try {
        $stampFolders = @(Get-ChildItem -LiteralPath $BackupRoot -Directory -ErrorAction Stop |
            Where-Object { $_.Name -match '^\d{8}-\d{6}$' } |
            Sort-Object Name -Descending)
        if ($stampFolders.Count -le $Keep) { return @() }
        foreach ($folder in @($stampFolders | Select-Object -Skip $Keep)) {
            try {
                Remove-Item -LiteralPath $folder.FullName -Recurse -Force -ErrorAction Stop
                $removed += [string]$folder.Name
            }
            catch {
                # Kilitli ya da yetkisiz klasör atlanır.
            }
        }
    }
    catch {
        return @($removed)
    }
    return @($removed)
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
        [string]$LogPath,
        # Listeleme kipinde robocopy hiçbir şey kopyalamaz, değişecek öğeleri satır satır yazar.
        [switch]$Listing
    )

    $quote = { param([string]$Value) '"' + $Value.Replace('"', '""') + '"' }
    $useMirror = $IsDirectory -and (Get-SamePathCopyOptionValue -Options $Options -Name 'Mirror')
    $arguments = @((& $quote $SourceDirectory), (& $quote $DestinationDirectory))
    if ($FileFilter) { $arguments += (& $quote $FileFilter) }
    if ($IsDirectory) {
        # /MIR zaten /E içerir; ikisini birlikte vermek gereksiz.
        $arguments += $(if ($useMirror) { '/MIR' } else { '/E' })
        $arguments += '/DCOPY:DAT'
        # Yedek klasörü hedefin altında durduğu için kopyalamaya dahil edilmez; kullanıcının verdiği klasörler de eklenir.
        $excludedDirectories = @((Get-SamePathCopyBackupFolderName)) + @(Split-SamePathCopyPatternList -Text (Get-SamePathCopyOptionText -Options $Options -Name 'ExcludeDirectories'))
        $arguments += ('/XD ' + ((@($excludedDirectories | Select-Object -Unique) | ForEach-Object { & $quote $_ }) -join ' '))
    }
    $excludedFiles = @(Split-SamePathCopyPatternList -Text (Get-SamePathCopyOptionText -Options $Options -Name 'ExcludeFiles'))
    if ($excludedFiles.Count -gt 0) {
        $arguments += ('/XF ' + ((@($excludedFiles) | ForEach-Object { & $quote $_ }) -join ' '))
    }
    $throttle = Get-SamePathCopyOptionNumber -Options $Options -Name 'ThrottleMilliseconds' -Default 0
    if ($throttle -gt 0) { $arguments += "/IPG:$throttle" }
    if (Get-SamePathCopyOptionValue -Options $Options -Name 'FastCopy') {
        # /MT yeniden başlatılabilir kip (/Z) ile birlikte kullanılmaz; hız seçilince /Z düşer.
        $arguments += '/MT:8'
    }
    else {
        $arguments += '/Z'
    }
    if (Get-SamePathCopyOptionValue -Options $Options -Name 'OnlyNewer') { $arguments += '/XO' }
    if (Get-SamePathCopyOptionValue -Options $Options -Name 'DryRun') { $arguments += '/L' }
    # Sihirbazda deger verilmisse yeniden deneme ayarlari config.json degerlerini ezer.
    $effectiveRetryCount = Get-SamePathCopyOptionNumber -Options $Options -Name 'RetryCount' -Default -1
    if ($effectiveRetryCount -lt 0) { $effectiveRetryCount = $RetryCount }
    $effectiveWaitSeconds = Get-SamePathCopyOptionNumber -Options $Options -Name 'WaitSeconds' -Default -1
    if ($effectiveWaitSeconds -lt 0) { $effectiveWaitSeconds = $WaitSeconds }
    if ($Listing) {
        # Önizleme/deneme kipi: hiçbir şey yazılmaz ve değişecek öğeler tek tek listelenir.
        $arguments += @('/L', '/COPY:DAT', '/FFT', "/R:$effectiveRetryCount", "/W:$effectiveWaitSeconds", '/NP', '/NJH', '/NJS', '/FP', '/NS')
    }
    else {
        $arguments += @('/COPY:DAT', '/FFT', "/R:$effectiveRetryCount", "/W:$effectiveWaitSeconds", '/NP', '/NJH', '/NJS', '/NFL', '/NDL')
    }
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

function Get-SamePathCopyBackupStamps {
    param(
        [Parameter(Mandatory = $true)][string]$Address,
        [Parameter(Mandatory = $true)][string]$NetworkRoot,
        # Verilirse yalnızca bu göreli yolu içeren yedekler döner; böylece "bu klasörün eski hâli hangi yedeklerde var" sorusu yanıtlanır.
        [string]$RelativePath
    )

    $backupRoot = Get-SamePathCopyBackupRoot -Address $Address -NetworkRoot $NetworkRoot
    if (-not (Test-Path -LiteralPath $backupRoot -PathType Container)) { return @() }
    try {
        $stamps = @(Get-ChildItem -LiteralPath $backupRoot -Directory -ErrorAction Stop |
            Where-Object { $_.Name -match '^\d{8}-\d{6}$' } |
            Sort-Object Name -Descending)
    }
    catch {
        return @()
    }

    $results = @()
    foreach ($stamp in $stamps) {
        $itemPath = if ([string]::IsNullOrWhiteSpace($RelativePath)) { $stamp.FullName } else { Join-Path $stamp.FullName $RelativePath }
        if (-not (Test-Path -LiteralPath $itemPath)) { continue }
        $results += [pscustomobject]@{
            Stamp = [string]$stamp.Name
            Path = $itemPath
            # 20260820-162243 -> 20.08.2026 16:22:43 gibi okunur bir etikete çevrilir.
            Label = try {
                ([datetime]::ParseExact($stamp.Name, 'yyyyMMdd-HHmmss', [System.Globalization.CultureInfo]::InvariantCulture)).ToString('dd.MM.yyyy HH:mm:ss')
            }
            catch {
                [string]$stamp.Name
            }
        }
    }
    return @($results)
}

function Get-SamePathCopyRelativeDestinationPath {
    param(
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][string]$Address,
        [Parameter(Mandatory = $true)][string]$NetworkRoot
    )

    # Hedef yolunun paylaşım kökünden sonraki kısmı; yedekten geri almada aynı göreli yol kullanılır.
    $uncRoot = "\\$Address\$($NetworkRoot.Trim('\'))"
    if (-not $Destination.StartsWith($uncRoot, [System.StringComparison]::OrdinalIgnoreCase)) { return '' }
    return $Destination.Substring($uncRoot.Length).TrimStart('\')
}

function Expand-SamePathCopyCommandTemplate {
    param(
        [Parameter(Mandatory = $true)][string]$Template,
        [Parameter(Mandatory = $true)]$Target,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][string]$Source
    )

    # Komut kalıbındaki yer tutucular doldurulur. Kullanılabilir alanlar:
    # {address} {targetId} {targetName} {networkRoot} {destination} {source}
    $result = $Template
    foreach ($pair in @(
        @{ Key = '{address}'; Value = [string]$Target.address }
        @{ Key = '{targetId}'; Value = [string]$Target.id }
        @{ Key = '{targetName}'; Value = [string]$Target.name }
        @{ Key = '{networkRoot}'; Value = [string]$Target.networkRoot }
        @{ Key = '{destination}'; Value = $Destination }
        @{ Key = '{source}'; Value = $Source }
    )) {
        $result = $result.Replace([string]$pair.Key, [string]$pair.Value)
    }
    return $result
}

function Get-SamePathCopyListingSummary {
    param([string[]]$Lines)

    # robocopy /L çıktısında her satırın başında sınıf adı olur: "*EXTRA File" hedefte fazla olanı,
    # "New File" / "Newer" / "Older" / "Changed" ise kopyalanacak olanı gösterir. Sayılar ve örnek
    # yollar buradan çıkarılır; ayna onayında ve deneme çalıştırmasında kullanılır.
    $extras = New-Object System.Collections.Generic.List[string]
    $changes = New-Object System.Collections.Generic.List[string]
    foreach ($line in @($Lines)) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $trimmed = $line.Trim()
        if ($trimmed -match '^\*EXTRA (File|Dir)\s+(?<path>.+)$') {
            $extras.Add($Matches['path'].Trim())
            continue
        }
        if ($trimmed -match '^(New File|Newer|Older|Changed|New Dir)\s+(?<path>.+)$') {
            $changes.Add($Matches['path'].Trim())
        }
    }
    return [pscustomobject]@{
        ExtraCount = $extras.Count
        ChangeCount = $changes.Count
        Extras = @($extras)
        Changes = @($changes)
    }
}

function Get-SamePathCopyFreeSpace {
    param([Parameter(Mandatory = $true)][string]$Path)

    # UNC paylaşımlarında da çalışan boş alan sorgusu; okunamazsa $null döner (denetim atlanır).
    try {
        $fileSystem = New-Object -ComObject Scripting.FileSystemObject
        try {
            $drive = $fileSystem.GetDrive($fileSystem.GetDriveName($Path))
            if ($null -eq $drive) { return $null }
            return [long]$drive.FreeSpace
        }
        finally {
            [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($fileSystem)
        }
    }
    catch {
        return $null
    }
}

function Get-SamePathCopySourceSize {
    param([Parameter(Mandatory = $true)][string]$Path)

    # Kaynak boyutu: dosya ise kendi boyutu, klasör ise altındaki bütün dosyaların toplamı.
    try {
        $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
        if (-not $item.PSIsContainer) { return [long]$item.Length }
        return [long](@(Get-ChildItem -LiteralPath $Path -File -Recurse -Force -ErrorAction SilentlyContinue |
            Measure-Object -Property Length -Sum).Sum)
    }
    catch {
        return $null
    }
}

function Format-SamePathCopySize {
    param([Parameter(Mandatory = $true)][long]$Bytes)

    if ($Bytes -ge 1TB) { return "{0:0.0} TB" -f ($Bytes / 1TB) }
    if ($Bytes -ge 1GB) { return "{0:0.0} GB" -f ($Bytes / 1GB) }
    if ($Bytes -ge 1MB) { return "{0:0.0} MB" -f ($Bytes / 1MB) }
    if ($Bytes -ge 1KB) { return "{0:0.0} KB" -f ($Bytes / 1KB) }
    return "$Bytes B"
}

function Get-SamePathCopyNodeGroup {
    param([Parameter(Mandatory = $true)]$Node)

    if (-not $Node.PSObject.Properties['group']) { return '' }
    return ([string]$Node.group).Trim()
}

function Get-SamePathCopyMenuEntries {
    param(
        [Parameter(Mandatory = $true)]$Configuration,
        [string]$ExcludeId,
        # Sihirbazda kaydedilmiş profiller; menüye "profile:<ad>" girdisi olarak eklenir.
        [string[]]$ProfileNames
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
    $restoreLabel = if ($Configuration.PSObject.Properties['restoreLabel'] -and -not [string]::IsNullOrWhiteSpace([string]$Configuration.restoreLabel)) {
        [string]$Configuration.restoreLabel
    }
    else {
        'Yedekten geri al'
    }
    $entries = @(
        [pscustomobject]@{ Kind = 'all'; Id = 'all'; Label = [string]$Configuration.allLabel; IsAggregate = $true }
        [pscustomobject]@{ Kind = 'wizard'; Id = 'wizard'; Label = $wizardLabel; IsAggregate = $true }
        [pscustomobject]@{ Kind = 'wizardLast'; Id = 'wizard:last'; Label = $wizardLastLabel; IsAggregate = $true }
        [pscustomobject]@{ Kind = 'restore'; Id = 'restore'; Label = $restoreLabel; IsAggregate = $true }
    )
    foreach ($profileName in @($ProfileNames | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)) {
        $entries += [pscustomobject]@{
            Kind = 'profile'
            Id = "profile:$profileName"
            Label = "$profileName (profil)"
            IsAggregate = $true
        }
    }

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
    # wizard:last ve profile:<ad> aynı listeyle başlar; seçim kaydedilmiş sihirbaz ayarından/profilden uygulanır.
    if ($TargetId -eq 'all' -or $TargetId -eq 'wizard' -or $TargetId -eq 'wizard:last' -or $TargetId -eq 'restore' -or
        $TargetId.StartsWith('profile:', [System.StringComparison]::OrdinalIgnoreCase)) {
        return $targets
    }

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
