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
    # Explorer menüsünde tek makine girdilerinin gösterilip gösterilmeyeceği. Windows'un 16 öğe sınırı
    # yüzünden "auto" (varsayılan) sığmadığında tek makineleri menüden çıkarır; "always" zorlar, "never" hiç koymaz.
    if (-not $config.PSObject.Properties['menuShowNodes'] -or [string]::IsNullOrWhiteSpace([string]$config.menuShowNodes)) {
        $config | Add-Member -NotePropertyName menuShowNodes -NotePropertyValue 'auto' -Force
    }
    $config.menuShowNodes = ([string]$config.menuShowNodes).Trim().ToLowerInvariant()
    if (@('auto', 'always', 'never') -notcontains [string]$config.menuShowNodes) {
        throw "menuShowNodes değeri auto, always veya never olmalı: $($config.menuShowNodes)"
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
        # ExcludeDirectoryPaths: sihirbazın ayrıntı tablosunda işareti kaldırılan klasörlerin tam yolları.
        $excludedDirectories = @((Get-SamePathCopyBackupFolderName)) +
            @(Split-SamePathCopyPatternList -Text (Get-SamePathCopyOptionText -Options $Options -Name 'ExcludeDirectories')) +
            @(Get-SamePathCopyOptionList -Options $Options -Name 'ExcludeDirectoryPaths')
        $arguments += ('/XD ' + ((@($excludedDirectories | Select-Object -Unique) | ForEach-Object { & $quote $_ }) -join ' '))
    }
    # ExcludeFilePaths: aynı tabloda işareti kaldırılan dosyaların tam yolları. Hedef tarafındaki fazlalık
    # da buraya girebilir: /XF verilen yol hem kopyalanmaz hem de /MIR ile silinmez.
    $excludedFiles = @(Split-SamePathCopyPatternList -Text (Get-SamePathCopyOptionText -Options $Options -Name 'ExcludeFiles')) +
        @(Get-SamePathCopyOptionList -Options $Options -Name 'ExcludeFilePaths')
    if ($excludedFiles.Count -gt 0) {
        $arguments += ('/XF ' + ((@($excludedFiles | Select-Object -Unique) | ForEach-Object { & $quote $_ }) -join ' '))
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

function Get-SamePathCopyOptionList {
    param($Options, [Parameter(Mandatory = $true)][string]$Name)

    # Yol listesi taşıyan parametreler (hedef başına düşürülen dosya/klasörler) için: eksik alan boş dizi döner.
    if ($null -eq $Options -or -not $Options.PSObject.Properties[$Name]) { return @() }
    return @(@($Options.$Name) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | ForEach-Object { [string]$_ })
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
    $entries = New-Object System.Collections.Generic.List[object]
    $classCounts = @{ 'New File' = 0; 'New Dir' = 0; 'Newer' = 0; 'Older' = 0; 'Changed' = 0 }
    foreach ($line in @($Lines)) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $trimmed = $line.Trim()
        # Satır biçimi: "<sınıf>  [<sayı>]  <tam yol>". Sınıfsız satırlar taranan klasör başlıklarıdır.
        # Sayı alanı yalnızca /NS verilmediğinde çıkar (klasörlerde dosya sayısı, fazlalıkta -1); atılır.
        if ($trimmed -notmatch '^(?<class>\*EXTRA File|\*EXTRA Dir|New File|New Dir|Newer|Older|Changed)\s+(?<rest>\S.*)$') { continue }
        $class = [string]$Matches['class']
        $path = ([string]$Matches['rest']).Trim()
        if ($path -match '^-?\d+\s+(?<real>\S.*)$') { $path = ([string]$Matches['real']).Trim() }
        # Sınıf adları arayüzde ve testlerde tek biçimde kullanılsın diye yıldız açılır: "Extra File".
        $normalizedClass = $class.Replace('*EXTRA ', 'Extra ')
        $entries.Add([pscustomobject]@{
            Class = $normalizedClass
            Path = $path
            IsDirectory = ($normalizedClass -eq 'New Dir' -or $normalizedClass -eq 'Extra Dir')
        })
        if ($normalizedClass.StartsWith('Extra ')) {
            $extras.Add($path)
            continue
        }
        $changes.Add($path)
        $classCounts[$normalizedClass] = [int]$classCounts[$normalizedClass] + 1
    }
    return [pscustomobject]@{
        ExtraCount = $extras.Count
        ChangeCount = $changes.Count
        Extras = @($extras)
        Changes = @($changes)
        # Satır dökümü: sihirbazın hedef başına dosya listesi bu girdilerden kurulur.
        Entries = $entries.ToArray()
        # Sınıf dökümü: "Older" kaynak dosyanın hedeftekinden ESKİ olduğunu söyler; robocopy yine de
        # üzerine yazacağı için hedefte daha yeni dosyayı ezme uyarısı bu sayıdan üretilir.
        NewCount = [int]$classCounts['New File'] + [int]$classCounts['New Dir']
        NewerCount = [int]$classCounts['Newer']
        OlderCount = [int]$classCounts['Older']
        ChangedCount = [int]$classCounts['Changed']
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

function Invoke-SamePathCopyTargetInspection {
    param(
        [Parameter(Mandatory = $true)]$SourceItems,
        [string[]]$LocalRoots,
        [Parameter(Mandatory = $true)]$Target,
        [int]$TimeoutSeconds = 120,
        [scriptblock]$PumpAction
    )

    # Hedefe hiçbir şey yazmadan "orada ne var" sorusuna yanıt verir: her kaynak öğe için hedef yol
    # hesaplanır, hedefte hiç yoksa "yok" sayılır, varsa robocopy /L farkları sınıflarıyla listeler.
    # Sihirbazdaki satır rozetleri ve -CheckOnly kipi bu özet üzerinden çalışır. PumpAction, arayüzden
    # çağrıldığında pencerenin donmaması için bekleme döngüsünde çalıştırılır; testler boş bırakır.
    $missing = 0
    $changeCount = 0
    $newCount = 0
    $newerCount = 0
    $olderCount = 0
    $changedCount = 0
    $extraCount = 0
    $failed = $false
    $items = @(@($SourceItems) | Where-Object { $null -ne $_ })

    foreach ($item in $items) {
        $isDirectory = [bool]$item.PSIsContainer
        $destination = Get-SamePathCopyDestination -SourcePath ([string]$item.FullName) -LocalRoots $LocalRoots `
            -Address ([string]$Target.address) -NetworkRoot ([string]$Target.networkRoot)

        try {
            $destinationExists = Test-Path -LiteralPath $destination -PathType $(if ($isDirectory) { 'Container' } else { 'Leaf' })
        }
        catch {
            $destinationExists = $false
        }
        if (-not $destinationExists) {
            $missing++
            continue
        }

        $run = Invoke-SamePathCopyListingRun -SourcePath ([string]$item.FullName) -DestinationPath $destination `
            -IsDirectory $isDirectory -Options $null -TimeoutSeconds $TimeoutSeconds -PumpAction $PumpAction
        if ([bool]$run.Failed) { $failed = $true }
        $summary = Get-SamePathCopyListingSummary -Lines $run.Lines
        $changeCount += [int]$summary.ChangeCount
        $newCount += [int]$summary.NewCount
        $newerCount += [int]$summary.NewerCount
        $olderCount += [int]$summary.OlderCount
        $changedCount += [int]$summary.ChangedCount
        # Dosya süzgeçli listelemede robocopy hedefteki diğer dosyaları da "fazla" sayabildiği için
        # fazlalıklar yalnızca klasör incelemesinde toplanır (dosya kopyalamada zaten anlamı yok).
        if ($isDirectory) { $extraCount += [int]$summary.ExtraCount }
    }

    return [pscustomobject]@{
        TargetId = [string]$Target.id
        ItemCount = $items.Count
        MissingCount = $missing
        ChangeCount = $changeCount
        NewCount = $newCount
        NewerCount = $newerCount
        OlderCount = $olderCount
        ChangedCount = $changedCount
        ExtraCount = $extraCount
        Failed = $failed
    }
}

function Get-SamePathCopyInspectionText {
    param([Parameter(Mandatory = $true)]$Inspection)

    # İnceleme sonucunu satıra sığan kısa bir rozete çevirir; ayrıntı ipucunda durur.
    # Fırça adları tema kaynaklarındaki anahtarlardır; arayüz FindResource ile çözer.
    $toolTipParts = New-Object System.Collections.Generic.List[string]
    if ([int]$Inspection.NewCount -gt 0) { $toolTipParts.Add("hedefte olmayan: {0}" -f [int]$Inspection.NewCount) }
    if ([int]$Inspection.NewerCount -gt 0) { $toolTipParts.Add("kaynak daha yeni: {0}" -f [int]$Inspection.NewerCount) }
    if ([int]$Inspection.OlderCount -gt 0) { $toolTipParts.Add("hedef daha yeni (üzerine yazılır): {0}" -f [int]$Inspection.OlderCount) }
    if ([int]$Inspection.ChangedCount -gt 0) { $toolTipParts.Add("boyutu farklı: {0}" -f [int]$Inspection.ChangedCount) }
    if ([int]$Inspection.ExtraCount -gt 0) { $toolTipParts.Add("hedefte fazladan: {0} (yalnızca Ayna siler)" -f [int]$Inspection.ExtraCount) }
    if ([int]$Inspection.MissingCount -gt 0) { $toolTipParts.Add("hedefte hiç olmayan öğe: {0}" -f [int]$Inspection.MissingCount) }

    if ([bool]$Inspection.Failed) {
        return [pscustomobject]@{ Text = 'inceleme hatası'; Brush = 'DangerBrush'
            ToolTip = 'robocopy /L hedefi listeleyemedi; paylaşım yetkisi ya da ağ sorunu olabilir.' }
    }
    if ([int]$Inspection.ItemCount -gt 0 -and [int]$Inspection.MissingCount -eq [int]$Inspection.ItemCount) {
        return [pscustomobject]@{ Text = 'hedefte yok'; Brush = 'TextMutedBrush'
            ToolTip = 'Seçilen öğelerin hiçbiri hedefte yok; tamamı yeni kopyalanır.' }
    }
    if ([int]$Inspection.ChangeCount -eq 0 -and [int]$Inspection.MissingCount -eq 0) {
        $sameToolTip = 'Hedef kaynakla aynı; kopyalama bir şey değiştirmez.'
        if ([int]$Inspection.ExtraCount -gt 0) {
            $sameToolTip = "Kopyalanacak fark yok. " + ("hedefte fazladan: {0} (yalnızca Ayna siler)" -f [int]$Inspection.ExtraCount)
        }
        return [pscustomobject]@{ Text = 'aynı'; Brush = 'SuccessBrush'; ToolTip = $sameToolTip }
    }

    $textParts = New-Object System.Collections.Generic.List[string]
    if (([int]$Inspection.ChangeCount) -gt 0) { $textParts.Add("{0} değişecek" -f [int]$Inspection.ChangeCount) }
    if (([int]$Inspection.MissingCount) -gt 0) { $textParts.Add("{0} öğe yok" -f [int]$Inspection.MissingCount) }
    $text = $textParts -join ', '
    $brush = 'TextBrush'
    if ([int]$Inspection.OlderCount -gt 0) {
        # Hedefteki daha yeni dosya ezilecek: rozet uyarı rengine döner ve başına ünlem konur.
        $text = "! " + $text
        $brush = 'WarningBrush'
    }
    return [pscustomobject]@{ Text = $text; Brush = $brush; ToolTip = ($toolTipParts -join "`r`n") }
}

function Get-SamePathCopyTrimmedPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    # Yol karşılaştırmaları için sondaki ters bölü atılır; "C:\" gibi sürücü kökleri korunur.
    if ($Path.Length -gt 3) { return $Path.TrimEnd('\') }
    return $Path
}

function Get-SamePathCopyMappedPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$FromRoot,
        [Parameter(Mandatory = $true)][string]$ToRoot
    )

    # Bir kökün altındaki yolu öbür köke taşır: robocopy'nin listelediği kaynak yolundan hedef yolunu
    # (ya da hedefteki fazlalıktan onun kaynak karşılığını) üretmek için kullanılır. Kök dışı yola dokunulmaz.
    $trimmedFrom = Get-SamePathCopyTrimmedPath -Path $FromRoot
    $trimmedTo = Get-SamePathCopyTrimmedPath -Path $ToRoot
    $trimmedPath = Get-SamePathCopyTrimmedPath -Path $Path
    if ($trimmedPath.Equals($trimmedFrom, [System.StringComparison]::OrdinalIgnoreCase)) { return $trimmedTo }
    if ($trimmedPath.StartsWith($trimmedFrom + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        return ($trimmedTo + '\' + $trimmedPath.Substring($trimmedFrom.Length + 1))
    }
    return $trimmedPath
}

function Get-SamePathCopyPathUnderRoot {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Root
    )

    # Yolun kökten sonraki kısmı; yol kökün kendisiyse boş metin döner. Kök dışı yol olduğu gibi kalır.
    $trimmedRoot = Get-SamePathCopyTrimmedPath -Path $Root
    $trimmedPath = Get-SamePathCopyTrimmedPath -Path $Path
    if ($trimmedPath.Equals($trimmedRoot, [System.StringComparison]::OrdinalIgnoreCase)) { return '' }
    if ($trimmedPath.StartsWith($trimmedRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        return $trimmedPath.Substring($trimmedRoot.Length + 1)
    }
    return $trimmedPath
}

function Get-SamePathCopyChangeClassInfo {
    param(
        [Parameter(Mandatory = $true)][string]$Class,
        [bool]$MirrorEnabled = $false
    )

    # robocopy sınıfını arayüz gösterimine çevirir. İşaretler git'teki gibi okunur: "+" hedefte olmayan,
    # "~" üzerine yazılacak, "!" hedefteki daha yeni dosyanın geri alınacağı, "-" hedefte fazla olan.
    # Fırça adları tema kaynaklarındaki anahtarlardır; pencere FindResource ile çözer.
    switch ($Class) {
        'New Dir' {
            return [pscustomobject]@{ Sign = '+'; Text = 'yeni klasör'; Brush = 'SuccessBrush'; Order = 0
                ToolTip = 'Bu klasör hedefte yok; içeriğiyle birlikte oluşturulacak.' }
        }
        'New File' {
            return [pscustomobject]@{ Sign = '+'; Text = 'yeni'; Brush = 'SuccessBrush'; Order = 1
                ToolTip = 'Dosya hedefte yok; ilk kez kopyalanacak.' }
        }
        'Newer' {
            return [pscustomobject]@{ Sign = '~'; Text = 'güncellenecek'; Brush = 'AccentBrush'; Order = 2
                ToolTip = 'Kaynak daha yeni; hedefteki dosyanın üzerine yazılacak.' }
        }
        'Changed' {
            return [pscustomobject]@{ Sign = '~'; Text = 'boyutu farklı'; Brush = 'AccentBrush'; Order = 3
                ToolTip = 'Tarihler aynı, boyut farklı; hedefteki dosyanın üzerine yazılacak.' }
        }
        'Older' {
            return [pscustomobject]@{ Sign = '!'; Text = 'hedef daha yeni'; Brush = 'WarningBrush'; Order = 4
                ToolTip = 'Hedefteki dosya kaynaktan DAHA YENİ; kopyalama onu eski hâline döndürür. İşareti kaldırmak bu dosyayı korur.' }
        }
        'Extra Dir' {
            if ($MirrorEnabled) {
                return [pscustomobject]@{ Sign = '-'; Text = 'silinecek klasör'; Brush = 'DangerBrush'; Order = 5
                    ToolTip = 'Kaynakta yok, hedefte var. Ayna açık olduğu için içeriğiyle birlikte silinecek.' }
            }
            return [pscustomobject]@{ Sign = '-'; Text = 'hedefte fazla klasör'; Brush = 'TextMutedBrush'; Order = 5
                ToolTip = 'Kaynakta yok, hedefte var. Ayna kapalı olduğu için silinmez, olduğu gibi kalır.' }
        }
        'Extra File' {
            if ($MirrorEnabled) {
                return [pscustomobject]@{ Sign = '-'; Text = 'silinecek'; Brush = 'DangerBrush'; Order = 6
                    ToolTip = 'Kaynakta yok, hedefte var. Ayna açık olduğu için silinecek; işareti kaldırmak dosyayı korur.' }
            }
            return [pscustomobject]@{ Sign = '-'; Text = 'hedefte fazla'; Brush = 'TextMutedBrush'; Order = 6
                ToolTip = 'Kaynakta yok, hedefte var. Ayna kapalı olduğu için silinmez, olduğu gibi kalır.' }
        }
    }
    return [pscustomobject]@{ Sign = '?'; Text = $Class; Brush = 'TextMutedBrush'; Order = 9; ToolTip = '' }
}

function Invoke-SamePathCopyListingRun {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string]$DestinationPath,
        [Parameter(Mandatory = $true)][bool]$IsDirectory,
        $Options,
        [int]$TimeoutSeconds = 120,
        [scriptblock]$PumpAction
    )

    # Tek bir kaynak öğe için "hedefe hiçbir şey yazmadan ne değişecek" listelemesi (robocopy /L).
    # Kaynak dosyaysa üst klasörler karşılaştırılıp yalnızca o dosya süzülür. Hedef klasör hiç yoksa
    # robocopy her şeyi "New" diye listeler; bu yüzden ayrı bir "yok" dalı gerekmez.
    # PumpAction arayüzden çağrıldığında pencerenin donmaması için bekleme döngüsünde çalıştırılır.
    if ($IsDirectory) {
        $sourceDirectory = $SourcePath
        $destinationDirectory = $DestinationPath
        $fileFilter = $null
    }
    else {
        $sourceDirectory = [System.IO.Path]::GetDirectoryName($SourcePath)
        $destinationDirectory = [System.IO.Path]::GetDirectoryName($DestinationPath)
        $fileFilter = [System.IO.Path]::GetFileName($SourcePath)
    }

    $failed = $false
    $lines = @()
    $logPath = Join-Path ([System.IO.Path]::GetTempPath()) ("SamePathCopy-Inspect-{0}.log" -f [guid]::NewGuid().ToString('N'))
    $arguments = @(Get-SamePathCopyRobocopyArguments -SourceDirectory $sourceDirectory -DestinationDirectory $destinationDirectory `
        -FileFilter $fileFilter -IsDirectory $IsDirectory -RetryCount 0 -WaitSeconds 0 -Options $Options -LogPath $logPath -Listing)
    try {
        # Start-Process -PassThru çıkış kodunu güvenilir vermiyor; süreç .NET üzerinden başlatılır.
        # /UNILOG çıktıyı dosyaya yazdığı için konsol akışlarını yönlendirmek gerekmiyor.
        $startInfo = New-Object System.Diagnostics.ProcessStartInfo
        $startInfo.FileName = 'robocopy.exe'
        $startInfo.Arguments = ($arguments -join ' ')
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $process = [System.Diagnostics.Process]::Start($startInfo)
        $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
        while (-not $process.WaitForExit(120)) {
            if ($null -ne $PumpAction) { & $PumpAction }
            if ([DateTime]::UtcNow -gt $deadline) {
                try { $process.Kill() } catch { }
                $failed = $true
                break
            }
        }
        $process.WaitForExit()
        # robocopy'de 8 ve üzeri hata demektir; /L kipinde de erişim hatası bu şekilde döner.
        if ($process.ExitCode -ge 8) { $failed = $true }
        if (Test-Path -LiteralPath $logPath -PathType Leaf) {
            $lines = @(Get-Content -LiteralPath $logPath -Encoding Unicode -ErrorAction SilentlyContinue)
        }
        # Erişilemeyen paylaşımda robocopy hızlı dönüyor ama çıkış kodu her zaman 8'in üstünde olmuyor;
        # günlüğe yazdığı "ERROR nn (0x...)" satırı hatayı kesin gösteriyor.
        foreach ($line in $lines) {
            if ([string]$line -match 'ERROR \d+ \(0x') {
                $failed = $true
                break
            }
        }
    }
    catch {
        $failed = $true
    }
    finally {
        if (Test-Path -LiteralPath $logPath -PathType Leaf) {
            Remove-Item -LiteralPath $logPath -Force -ErrorAction SilentlyContinue
        }
    }

    return [pscustomobject]@{
        Lines = @($lines)
        Failed = $failed
        SourceDirectory = $sourceDirectory
        DestinationDirectory = $destinationDirectory
        FileFilter = $fileFilter
    }
}

function Get-SamePathCopyTargetFileDiff {
    param(
        [Parameter(Mandatory = $true)]$SourceItems,
        [string[]]$LocalRoots,
        [Parameter(Mandatory = $true)]$Target,
        $Options,
        [bool]$MirrorEnabled = $false,
        [int]$MaxEntries = 400,
        [int]$TimeoutSeconds = 120,
        [scriptblock]$PumpAction
    )

    # Bir hedefe gerçekten hangi dosyaların gideceğini dosya dosya çıkarır: her kaynak öğe için
    # robocopy /L çalıştırılır, çıktının sınıf satırları girdiye çevrilir. Sihirbazdaki ayrıntı tablosu
    # ve diff penceresi bu listeyi kullanır; hedefe hiçbir şey yazılmaz.
    # Girdiler öğeye göre gruplanır: her grubun başlığı öğenin hedefteki göreli yoludur.
    $entries = New-Object System.Collections.Generic.List[object]
    $groups = New-Object System.Collections.Generic.List[object]
    $failed = $false
    $hiddenCount = 0
    $sameItemCount = 0
    # Sınıf sayıları listeleme özetinden toplanır, girdilerden sayılmaz: liste MaxEntries ile kırpılınca
    # sayılar yanlış olurdu. Rozet ve özet metni bu sayılardan üretiliyor.
    $newCount = 0
    $newerCount = 0
    $changedCount = 0
    $olderCount = 0
    $extraCount = 0
    $items = @(@($SourceItems) | Where-Object { $null -ne $_ })

    foreach ($item in $items) {
        $isDirectory = [bool]$item.PSIsContainer
        $sourcePath = [string]$item.FullName
        $destination = Get-SamePathCopyDestination -SourcePath $sourcePath -LocalRoots $LocalRoots `
            -Address ([string]$Target.address) -NetworkRoot ([string]$Target.networkRoot)
        $itemHeader = $sourcePath
        try {
            $relative = [string](Get-SamePathCopySourceRelativePath -SourcePath $sourcePath -LocalRoots $LocalRoots).RelativePath
            if (-not [string]::IsNullOrWhiteSpace($relative)) { $itemHeader = $relative }
        }
        catch { }

        $run = Invoke-SamePathCopyListingRun -SourcePath $sourcePath -DestinationPath $destination `
            -IsDirectory $isDirectory -Options $Options -TimeoutSeconds $TimeoutSeconds -PumpAction $PumpAction
        if ([bool]$run.Failed) { $failed = $true }
        $summary = Get-SamePathCopyListingSummary -Lines $run.Lines
        $newCount += [int]$summary.NewCount
        $newerCount += [int]$summary.NewerCount
        $changedCount += [int]$summary.ChangedCount
        $olderCount += [int]$summary.OlderCount
        # Dosya süzgeçli listelemede robocopy hedefteki diğer dosyaları da "fazla" sayıyor; fazlalıklar
        # yalnızca klasör kopyalamasında anlamlı (satır olarak da yalnızca orada listeleniyor).
        if ($isDirectory) { $extraCount += [int]$summary.ExtraCount }
        $itemEntryCount = 0

        foreach ($listed in @($summary.Entries)) {
            $isExtra = ([string]$listed.Class).StartsWith('Extra ')
            # Dosya süzgeçli listelemede robocopy hedefteki diğer dosyaları da "fazla" sayıyor;
            # tek dosya kopyalamasında fazlalığın anlamı olmadığı için atlanır (inceleme de böyle davranıyor).
            if ($isExtra -and -not $isDirectory) { continue }
            $itemEntryCount++
            if ($entries.Count -ge $MaxEntries) {
                $hiddenCount++
                continue
            }

            if ($isExtra) {
                $entryDestination = [string]$listed.Path
                $entrySource = Get-SamePathCopyMappedPath -Path $entryDestination -FromRoot ([string]$run.DestinationDirectory) -ToRoot ([string]$run.SourceDirectory)
                $relativeRoot = [string]$run.DestinationDirectory
                $relativeSource = $entryDestination
            }
            else {
                $entrySource = [string]$listed.Path
                $entryDestination = Get-SamePathCopyMappedPath -Path $entrySource -FromRoot ([string]$run.SourceDirectory) -ToRoot ([string]$run.DestinationDirectory)
                $relativeRoot = [string]$run.SourceDirectory
                $relativeSource = $entrySource
            }

            # Satırda gösterilen yol öğenin kendisine göredir; öğenin kökü listelendiğinde adı yazılır.
            $displayPath = [string](Get-SamePathCopyPathUnderRoot -Path $relativeSource -Root $relativeRoot)
            if ([string]::IsNullOrWhiteSpace($displayPath)) {
                $displayPath = [System.IO.Path]::GetFileName((Get-SamePathCopyTrimmedPath -Path $relativeRoot))
            }
            if ([bool]$listed.IsDirectory) { $displayPath = $displayPath.TrimEnd('\') + '\' }

            $size = $null
            if (-not [bool]$listed.IsDirectory -and -not $isExtra) {
                # Boyut yerel diskten okunur: hedef paylaşımını dosya dosya yoklamak listeyi yavaşlatır.
                try { $size = [long]([System.IO.FileInfo]::new($entrySource)).Length } catch { $size = $null }
            }
            $classInfo = Get-SamePathCopyChangeClassInfo -Class ([string]$listed.Class) -MirrorEnabled $MirrorEnabled
            $entries.Add([pscustomobject]@{
                SourceItemPath = $sourcePath
                ItemHeader = $itemHeader
                Class = [string]$listed.Class
                Sign = [string]$classInfo.Sign
                StatusText = [string]$classInfo.Text
                Brush = [string]$classInfo.Brush
                ToolTip = [string]$classInfo.ToolTip
                Order = [int]$classInfo.Order
                IsDirectory = [bool]$listed.IsDirectory
                IsExtra = $isExtra
                DisplayPath = $displayPath
                SourcePath = $entrySource
                DestinationPath = $entryDestination
                # Kopyalamadan düşürmek için robocopy'ye verilecek yol: kaynak tarafı kaynak yolunu,
                # hedefteki fazlalık ise hedef yolunu kullanır.
                ExcludePath = (Get-SamePathCopyTrimmedPath -Path $(if ($isExtra) { $entryDestination } else { $entrySource }))
                Size = $size
            })
        }

        if ($itemEntryCount -eq 0) { $sameItemCount++ }
        $groups.Add([pscustomobject]@{
            Header = $itemHeader
            SourcePath = $sourcePath
            DestinationPath = $destination
            IsDirectory = $isDirectory
            EntryCount = $itemEntryCount
        })
    }

    return [pscustomobject]@{
        TargetId = [string]$Target.id
        ItemCount = $items.Count
        SameItemCount = $sameItemCount
        # List[object] @() ile diziye çevrilemiyor ("bağımsız değişken türleri eşleşmiyor"): ToArray().
        Entries = $entries.ToArray()
        Groups = $groups.ToArray()
        NewCount = $newCount
        NewerCount = $newerCount
        ChangedCount = $changedCount
        UpdateCount = ($newerCount + $changedCount)
        OlderCount = $olderCount
        ExtraCount = $extraCount
        ChangeCount = ($newCount + $newerCount + $changedCount + $olderCount)
        HiddenCount = $hiddenCount
        Truncated = ($hiddenCount -gt 0)
        MirrorEnabled = $MirrorEnabled
        Failed = $failed
    }
}

function Get-SamePathCopyFileDiffInspection {
    param([Parameter(Mandatory = $true)]$Diff)

    # Dosya listesini "Hedefte" kolonundaki rozetin beklediği biçime çevirir: satıra tıklayıp listeyi
    # gören kullanıcı, kolonun boş kalmasını değil aynı sonucu görür. Hedefte hiç olmayan öğeler burada
    # ayrı sayılmaz; onların dosyaları "yeni" olarak listeye girdiği için değişecek sayısında görünür.
    return [pscustomobject]@{
        TargetId = [string]$Diff.TargetId
        ItemCount = [int]$Diff.ItemCount
        MissingCount = 0
        ChangeCount = [int]$Diff.ChangeCount
        NewCount = [int]$Diff.NewCount
        NewerCount = [int]$Diff.NewerCount
        OlderCount = [int]$Diff.OlderCount
        ChangedCount = [int]$Diff.ChangedCount
        ExtraCount = [int]$Diff.ExtraCount
        Failed = [bool]$Diff.Failed
    }
}

function Get-SamePathCopyFileDiffSummaryText {
    param([Parameter(Mandatory = $true)]$Diff)

    # Ayrıntı bölümünün başlığındaki tek satırlık döküm: sıfır olan sınıflar yazılmaz.
    if ([bool]$Diff.Failed -and @($Diff.Entries).Count -eq 0) { return 'liste alınamadı' }
    $parts = New-Object System.Collections.Generic.List[string]
    # Not: hata varken satırlar da gelebilir (ör. erişilemeyen paylaşımda robocopy her şeyi "yeni"
    # sayıyor); bu yüzden döküm yazılır ama sonuna listenin eksik olabileceği eklenir.
    if ([int]$Diff.NewCount -gt 0) { $parts.Add("+{0} yeni" -f [int]$Diff.NewCount) }
    if ([int]$Diff.UpdateCount -gt 0) { $parts.Add("~{0} güncellenecek" -f [int]$Diff.UpdateCount) }
    if ([int]$Diff.OlderCount -gt 0) { $parts.Add("!{0} hedef daha yeni" -f [int]$Diff.OlderCount) }
    if ([int]$Diff.ExtraCount -gt 0) {
        # Metot çağrısının içinde -f bağımsız değişkenleri parantezlenmezse virgül metoda ayrı argüman gider.
        $parts.Add(("-{0} {1}" -f [int]$Diff.ExtraCount, $(if ([bool]$Diff.MirrorEnabled) { 'silinecek' } else { 'hedefte fazla' })))
    }
    $text = $(if ($parts.Count -eq 0) { 'hedef kaynakla aynı' } else { $parts -join '  •  ' })
    if ([bool]$Diff.Truncated) { $text += ("  •  {0} satır listeye girmedi" -f [int]$Diff.HiddenCount) }
    if ([bool]$Diff.Failed) { $text += '  •  liste eksik olabilir: robocopy hata verdi' }
    return $text
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
    # Section, menüdeki bölümleri ayırır: Explorer menüsü bölüm başlarına ayırıcı koyar.
    # GroupName ise Explorer'da grubun alt menüsüne hangi makinelerin gireceğini belirler.
    $entries = @(
        [pscustomobject]@{ Kind = 'all'; Id = 'all'; Label = [string]$Configuration.allLabel; IsAggregate = $true; Section = 'tumu'; GroupName = '' }
        [pscustomobject]@{ Kind = 'wizard'; Id = 'wizard'; Label = $wizardLabel; IsAggregate = $true; Section = 'sihirbaz'; GroupName = '' }
        [pscustomobject]@{ Kind = 'wizardLast'; Id = 'wizard:last'; Label = $wizardLastLabel; IsAggregate = $true; Section = 'sihirbaz'; GroupName = '' }
        [pscustomobject]@{ Kind = 'restore'; Id = 'restore'; Label = $restoreLabel; IsAggregate = $true; Section = 'gerial'; GroupName = '' }
    )
    foreach ($profileName in @($ProfileNames | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)) {
        $entries += [pscustomobject]@{
            Kind = 'profile'
            Id = "profile:$profileName"
            Label = "$profileName (profil)"
            IsAggregate = $true
            Section = 'profil'
            GroupName = ''
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
        $groupLabel = [string]$groupLabels[$groupKey]
        $entries += [pscustomobject]@{ Kind = 'group'; Id = "group:$groupLabel"; Label = $groupLabel; IsAggregate = $true; Section = 'grup'; GroupName = $groupLabel }
        foreach ($member in $groupMembers[$groupKey]) {
            $entries += [pscustomobject]@{ Kind = 'node'; Id = [string]$member.id; Label = [string]$member.name; IsAggregate = $false; Section = 'grup'; GroupName = $groupLabel }
        }
    }
    foreach ($target in $targets) {
        if (-not [string]::IsNullOrWhiteSpace((Get-SamePathCopyNodeGroup -Node $target))) { continue }
        $entries += [pscustomobject]@{ Kind = 'node'; Id = [string]$target.id; Label = [string]$target.name; IsAggregate = $false; Section = 'tek'; GroupName = '' }
    }
    return $entries
}

function Get-SamePathCopyMenuSectionKey {
    param([Parameter(Mandatory = $true)]$Entry)

    # Düz listelenen menülerde (Notepad++ sekme menüsü) ayırıcı yerleri bu anahtara göre belirlenir:
    # bölüm değiştiğinde ve her yeni grupta bir ayırıcı çıkar. Grubun kendi girdisi ile o gruba ait
    # makineler aynı anahtarı paylaştığı için grubun içi bölünmez.
    if ([string]$Entry.Section -eq 'grup' -and -not [string]::IsNullOrWhiteSpace([string]$Entry.GroupName)) {
        return "grup:$([string]$Entry.GroupName)"
    }
    return [string]$Entry.Section
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

function Get-SamePathCopySourceRelativePath {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [string[]]$LocalRoots
    )

    # Bir kaynak öğenin hedefte hangi göreli yolla oluşacağını hesaplar. Öğe bir yerel kökün altındaysa
    # kökten sonraki yol korunur; hiçbir kökün altında değilse sürücü harfi klasör adına çevrilir
    # (C:\Gecici\a.txt -> C\Gecici\a.txt), ağ yolları ise UNC klasörünün altına düşer.
    $fullPath = [System.IO.Path]::GetFullPath($SourcePath)
    $normalizedRoots = @(@($LocalRoots) | ForEach-Object {
        if ([string]::IsNullOrWhiteSpace($_)) { return }
        $normalized = [System.IO.Path]::GetFullPath([string]$_)
        if ($normalized.Length -gt 3) { $normalized = $normalized.TrimEnd('\') }
        $normalized
    })
    $matchedRoot = Get-SamePathCopyMatchingRoot -FullPath $fullPath -LocalRoots $normalizedRoots

    if ($null -ne $matchedRoot) {
        $relativePath = if ($fullPath.Equals($matchedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            ''
        }
        else {
            $fullPath.Substring(($matchedRoot.TrimEnd('\') + '\').Length)
        }
        return [pscustomobject]@{
            FullPath = $fullPath
            MatchedRoot = $matchedRoot
            IsInsideLocalRoot = $true
            RelativePath = $relativePath
        }
    }

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

    return [pscustomobject]@{
        FullPath = $fullPath
        MatchedRoot = $null
        IsInsideLocalRoot = $false
        RelativePath = $relativePath
    }
}

function Get-SamePathCopySourceSummary {
    param(
        $SourceItems,
        [string[]]$LocalRoots,
        [int]$MaxListItems = 200
    )

    # Pencere başlığındaki "9 kaynak öğe" tek başına ne kopyalanacağını anlatmıyor. Bu özet, seçilen
    # öğeleri ait oldukları yerel köke göre gruplar ve her öğenin hedefte oluşacak göreli yolunu verir;
    # arayüz bu veriyi hem başlık satırında hem de tıklanan ayrıntı listesinde kullanır.
    # Seçim çok kalabalık olabildiği için listeye en fazla MaxListItems öğe girer, kalanı sayı olarak
    # bildirilir; tam liste panoya kopyalanabilir.
    $entries = New-Object System.Collections.Generic.List[object]
    foreach ($item in @(@($SourceItems) | Where-Object { $null -ne $_ })) {
        $fullPath = if ($item -is [string]) { [string]$item } else { [string]$item.FullName }
        if ([string]::IsNullOrWhiteSpace($fullPath)) { continue }
        $isDirectory = if ($item -isnot [string] -and $item.PSObject.Properties['PSIsContainer']) {
            [bool]$item.PSIsContainer
        }
        elseif ($item -isnot [string] -and $item.PSObject.Properties['IsDirectory']) {
            [bool]$item.IsDirectory
        }
        else {
            [System.IO.Directory]::Exists($fullPath)
        }

        $resolved = $null
        try { $resolved = Get-SamePathCopySourceRelativePath -SourcePath $fullPath -LocalRoots $LocalRoots } catch { }
        $name = [System.IO.Path]::GetFileName($fullPath.TrimEnd('\'))
        if ([string]::IsNullOrWhiteSpace($name)) { $name = $fullPath }
        $parent = [string][System.IO.Path]::GetDirectoryName($fullPath.TrimEnd('\'))

        $entries.Add([pscustomobject]@{
            FullPath = if ($resolved) { [string]$resolved.FullPath } else { $fullPath }
            Name = $name
            Parent = $parent
            IsDirectory = $isDirectory
            MatchedRoot = if ($resolved -and $resolved.IsInsideLocalRoot) { [string]$resolved.MatchedRoot } else { '' }
            IsInsideLocalRoot = [bool]($resolved -and $resolved.IsInsideLocalRoot)
            RelativePath = if ($resolved) { [string]$resolved.RelativePath } else { '' }
        })
    }

    $directoryCount = @($entries | Where-Object { $_.IsDirectory }).Count
    $fileCount = $entries.Count - $directoryCount
    $kindText = if ($directoryCount -gt 0 -and $fileCount -gt 0) {
        "{0} dosya, {1} klasör" -f $fileCount, $directoryCount
    }
    elseif ($directoryCount -gt 0) { "{0} klasör" -f $directoryCount }
    else { "{0} dosya" -f $fileCount }

    # Kökler config'teki sırayla listelenir; hiç öğesi olmayan kök de görünür, "eşleşme yok" diye işaretlenir.
    $rootSummaries = New-Object System.Collections.Generic.List[object]
    foreach ($root in @($LocalRoots)) {
        if ([string]::IsNullOrWhiteSpace($root)) { continue }
        $normalized = [System.IO.Path]::GetFullPath([string]$root)
        if ($normalized.Length -gt 3) { $normalized = $normalized.TrimEnd('\') }
        if (@($rootSummaries | Where-Object { $_.Path -eq $normalized }).Count -gt 0) { continue }
        $rootSummaries.Add([pscustomobject]@{
            Path = $normalized
            ItemCount = @($entries | Where-Object { $_.MatchedRoot -eq $normalized }).Count
        })
    }
    $outsideEntries = @($entries | Where-Object { -not $_.IsInsideLocalRoot })

    # Gruplar: önce öğesi olan kökler, sonra hiçbir kökün altında olmayanlar.
    $groups = New-Object System.Collections.Generic.List[object]
    $remaining = [Math]::Max(0, $MaxListItems)
    foreach ($rootSummary in $rootSummaries) {
        $rootEntries = @($entries | Where-Object { $_.MatchedRoot -eq $rootSummary.Path })
        if ($rootEntries.Count -eq 0) { continue }
        $shown = [Math]::Min($remaining, $rootEntries.Count)
        $remaining -= $shown
        $groups.Add([pscustomobject]@{
            Header = $rootSummary.Path
            IsInsideLocalRoot = $true
            Items = @($rootEntries | Select-Object -First $shown)
            HiddenCount = ($rootEntries.Count - $shown)
            ItemCount = $rootEntries.Count
        })
    }
    if ($outsideEntries.Count -gt 0) {
        $shown = [Math]::Min($remaining, $outsideEntries.Count)
        $remaining -= $shown
        $groups.Add([pscustomobject]@{
            Header = 'Yerel kök dışında (sürücü adıyla kopyalanır)'
            IsInsideLocalRoot = $false
            Items = @($outsideEntries | Select-Object -First $shown)
            HiddenCount = ($outsideEntries.Count - $shown)
            ItemCount = $outsideEntries.Count
        })
    }

    # Başlık satırı: tek öğede tam yol, çok öğede ortak klasör (varsa) ve sayı dökümü.
    $parents = @(@($entries | ForEach-Object { $_.Parent }) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Sort-Object -Unique)
    $headlineText = if ($entries.Count -eq 0) {
        'Kaynak seçilmedi'
    }
    elseif ($entries.Count -eq 1) {
        "{0}  ({1})" -f $entries[0].FullPath, $(if ($entries[0].IsDirectory) { 'klasör' } else { 'dosya' })
    }
    elseif ($parents.Count -eq 1) {
        "{0} içinden {1} öğe ({2})" -f $parents[0], $entries.Count, $kindText
    }
    else {
        "{0} öğe ({1}) - {2} ayrı klasörden" -f $entries.Count, $kindText, $parents.Count
    }

    $tooltipLimit = 12
    $tooltipLines = @(@($entries | Select-Object -First $tooltipLimit) | ForEach-Object { [string]$_.FullPath })
    if ($entries.Count -gt $tooltipLimit) {
        $tooltipLines += ("... ve {0} öğe daha" -f ($entries.Count - $tooltipLimit))
    }

    $rootChipText = if ($rootSummaries.Count -eq 0) { 'Yerel kök tanımsız' }
        elseif ($rootSummaries.Count -eq 1) { "Yerel kök: {0}" -f $rootSummaries[0].Path }
        else { "{0} yerel kök" -f $rootSummaries.Count }

    return [pscustomobject]@{
        Count = $entries.Count
        FileCount = $fileCount
        DirectoryCount = $directoryCount
        KindText = $kindText
        Items = $entries.ToArray()
        Groups = $groups.ToArray()
        Roots = $rootSummaries.ToArray()
        OutsideRootCount = $outsideEntries.Count
        HiddenCount = @($groups | ForEach-Object { [int]$_.HiddenCount } | Measure-Object -Sum).Sum
        HeadlineText = $headlineText
        ChipText = "Kaynak: {0} öğe" -f $entries.Count
        RootChipText = $rootChipText
        ToolTipText = ($tooltipLines -join "`r`n")
        ClipboardText = (@($entries | ForEach-Object { [string]$_.FullPath }) -join "`r`n")
    }
}

function Get-SamePathCopyDestination {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string[]]$LocalRoots,
        [Parameter(Mandatory = $true)][string]$Address,
        [Parameter(Mandatory = $true)][string]$NetworkRoot
    )

    $relativePath = [string](Get-SamePathCopySourceRelativePath -SourcePath $SourcePath -LocalRoots $LocalRoots).RelativePath
    $normalizedNetworkRoot = $NetworkRoot.Trim('\')
    $uncRoot = "\\$Address\$normalizedNetworkRoot"
    if ([string]::IsNullOrWhiteSpace($relativePath)) {
        return $uncRoot
    }
    return "$uncRoot\$relativePath"
}
