Set-StrictMode -Version 2.0

# Karşılaştırma katmanı: bir hedefe gönderilecek dosyaların listesi (sihirbazdaki ayrıntı tablosu bunu
# kullanıyor) ile seçilen dosyanın kaynak/hedef arasındaki satır satır farkı. Hedefe hiçbir şey yazılmaz;
# yalnızca okuma yapılır. Metin farkı LCS ile hesaplanır ve unified diff gibi bağlam satırlarıyla verilir.

function Get-SamePathCopyTextDiff {
    param(
        [string[]]$SourceLines,
        [string[]]$DestinationLines,
        [int]$ContextLines = 3,
        # Ortak baş/son kırpıldıktan sonra kalan parça bu sınırı geçerse satır farkı hesaplanmaz:
        # LCS tablosu satır sayısının karesi kadar yer tutuyor.
        [int]$MaxCompareLines = 1200,
        [int]$MaxOutputLines = 3000
    )

    # Boş taraf $null olarak gelebiliyor (hedefte olmayan dosya): @($null) tipli boş diziyi diziye
    # çevirmiyor ve StrictMode altında .Count hata veriyor, bu yüzden boş dizi elle kurulur.
    $source = @()
    if ($null -ne $SourceLines) { $source = @($SourceLines) }
    $destination = @()
    if ($null -ne $DestinationLines) { $destination = @($DestinationLines) }
    $sourceCount = $source.Count
    $destinationCount = $destination.Count

    # Ortak baş ve son kısımlar kırpılır: büyük dosyalarda yalnızca değişen orta parça karşılaştırılır.
    # Karşılaştırma büyük/küçük harfe duyarlı olmalı, bu yüzden -ceq kullanılıyor (-eq harf ayırmıyor).
    $prefix = 0
    while ($prefix -lt $sourceCount -and $prefix -lt $destinationCount -and $source[$prefix] -ceq $destination[$prefix]) {
        $prefix++
    }
    $suffix = 0
    while (($suffix -lt ($sourceCount - $prefix)) -and ($suffix -lt ($destinationCount - $prefix)) -and
        ($source[$sourceCount - 1 - $suffix] -ceq $destination[$destinationCount - 1 - $suffix])) {
        $suffix++
    }
    $middleSourceCount = $sourceCount - $prefix - $suffix
    $middleDestinationCount = $destinationCount - $prefix - $suffix

    if ($middleSourceCount -eq 0 -and $middleDestinationCount -eq 0) {
        return [pscustomobject]@{
            Lines = @(); AddedCount = 0; RemovedCount = 0; Identical = $true; Truncated = $false
            Reason = 'ayni'; ReasonText = 'Dosyanın içeriği hedeftekiyle birebir aynı.'
        }
    }
    if ($middleSourceCount -gt $MaxCompareLines -or $middleDestinationCount -gt $MaxCompareLines) {
        return [pscustomobject]@{
            Lines = @(); AddedCount = $middleSourceCount; RemovedCount = $middleDestinationCount
            Identical = $false; Truncated = $true; Reason = 'buyuk'
            ReasonText = ("Değişen bölüm satır satır karşılaştırılamayacak kadar büyük: kaynakta {0}, hedefte {1} satır." -f
                $middleSourceCount, $middleDestinationCount)
        }
    }

    # LCS tablosu sondan başa doldurulur; ileri yönde yürüyerek işlem listesi çıkarılır.
    $table = New-Object 'int[,]' ($middleDestinationCount + 1), ($middleSourceCount + 1)
    for ($destinationIndex = $middleDestinationCount - 1; $destinationIndex -ge 0; $destinationIndex--) {
        for ($sourceIndex = $middleSourceCount - 1; $sourceIndex -ge 0; $sourceIndex--) {
            if ($destination[$prefix + $destinationIndex] -ceq $source[$prefix + $sourceIndex]) {
                $table[$destinationIndex, $sourceIndex] = $table[($destinationIndex + 1), ($sourceIndex + 1)] + 1
            }
            else {
                # İki boyutlu dizinde her boyut ayrı parantez ister: PowerShell virgülü toplamadan önce
                # bağlıyor ($i + 1, $j -> $i + (1, $j)), metot çağrısının içinde de bağımsız değişken ayırıcısı sayıyor.
                $table[$destinationIndex, $sourceIndex] = [Math]::Max(($table[($destinationIndex + 1), $sourceIndex]), ($table[$destinationIndex, ($sourceIndex + 1)]))
            }
        }
    }

    $newLine = {
        param([string]$Kind, [string]$Text, $SourceNumber, $DestinationNumber, [int]$Count)
        $sign = switch ($Kind) { 'Added' { '+' } 'Removed' { '-' } 'Skip' { '@' } default { ' ' } }
        return [pscustomobject]@{
            Kind = $Kind; Sign = $sign; Text = $Text; Count = $Count
            SourceNumber = $SourceNumber; DestinationNumber = $DestinationNumber
        }
    }

    $middle = New-Object System.Collections.Generic.List[object]
    $destinationIndex = 0
    $sourceIndex = 0
    while ($destinationIndex -lt $middleDestinationCount -and $sourceIndex -lt $middleSourceCount) {
        if ($destination[$prefix + $destinationIndex] -ceq $source[$prefix + $sourceIndex]) {
            $middle.Add((& $newLine 'Same' $source[$prefix + $sourceIndex] ($prefix + $sourceIndex + 1) ($prefix + $destinationIndex + 1) 0))
            $destinationIndex++
            $sourceIndex++
        }
        elseif ($table[($destinationIndex + 1), $sourceIndex] -ge $table[$destinationIndex, ($sourceIndex + 1)]) {
            $middle.Add((& $newLine 'Removed' $destination[$prefix + $destinationIndex] $null ($prefix + $destinationIndex + 1) 0))
            $destinationIndex++
        }
        else {
            $middle.Add((& $newLine 'Added' $source[$prefix + $sourceIndex] ($prefix + $sourceIndex + 1) $null 0))
            $sourceIndex++
        }
    }
    while ($destinationIndex -lt $middleDestinationCount) {
        $middle.Add((& $newLine 'Removed' $destination[$prefix + $destinationIndex] $null ($prefix + $destinationIndex + 1) 0))
        $destinationIndex++
    }
    while ($sourceIndex -lt $middleSourceCount) {
        $middle.Add((& $newLine 'Added' $source[$prefix + $sourceIndex] ($prefix + $sourceIndex + 1) $null 0))
        $sourceIndex++
    }

    # Bağlam: değişmeyen uzun bloklar "@ N satır aynı" satırına indirilir. Kırpılan ortak baş ve son
    # da aynı kurala uyar; böylece 10 bin satırlık dosyada yalnızca değişiklik çevresi görünür.
    $lines = New-Object System.Collections.Generic.List[object]
    if ($prefix -gt 0) {
        $shown = [Math]::Min($ContextLines, $prefix)
        if ($prefix -gt $shown) {
            $lines.Add((& $newLine 'Skip' '' $null $null ($prefix - $shown)))
        }
        for ($index = $prefix - $shown; $index -lt $prefix; $index++) {
            $lines.Add((& $newLine 'Same' $source[$index] ($index + 1) ($index + 1) 0))
        }
    }
    $position = 0
    while ($position -lt $middle.Count) {
        if ([string]$middle[$position].Kind -ne 'Same') {
            $lines.Add($middle[$position])
            $position++
            continue
        }
        $runEnd = $position
        while ($runEnd -lt $middle.Count -and [string]$middle[$runEnd].Kind -eq 'Same') { $runEnd++ }
        $runLength = $runEnd - $position
        if ($runLength -le (2 * $ContextLines)) {
            for ($index = $position; $index -lt $runEnd; $index++) { $lines.Add($middle[$index]) }
        }
        else {
            for ($index = $position; $index -lt ($position + $ContextLines); $index++) { $lines.Add($middle[$index]) }
            $lines.Add((& $newLine 'Skip' '' $null $null ($runLength - (2 * $ContextLines))))
            for ($index = ($runEnd - $ContextLines); $index -lt $runEnd; $index++) { $lines.Add($middle[$index]) }
        }
        $position = $runEnd
    }
    if ($suffix -gt 0) {
        $shown = [Math]::Min($ContextLines, $suffix)
        for ($index = 0; $index -lt $shown; $index++) {
            $sourceLineIndex = $sourceCount - $suffix + $index
            $destinationLineIndex = $destinationCount - $suffix + $index
            $lines.Add((& $newLine 'Same' $source[$sourceLineIndex] ($sourceLineIndex + 1) ($destinationLineIndex + 1) 0))
        }
        if ($suffix -gt $shown) {
            $lines.Add((& $newLine 'Skip' '' $null $null ($suffix - $shown)))
        }
    }

    $addedCount = @(@($middle.ToArray()) | Where-Object { [string]$_.Kind -eq 'Added' }).Count
    $removedCount = @(@($middle.ToArray()) | Where-Object { [string]$_.Kind -eq 'Removed' }).Count
    $truncated = $false
    $output = $lines.ToArray()
    if ($output.Count -gt $MaxOutputLines) {
        $output = @($output | Select-Object -First $MaxOutputLines)
        $truncated = $true
    }
    return [pscustomobject]@{
        Lines = $output
        AddedCount = $addedCount
        RemovedCount = $removedCount
        Identical = $false
        Truncated = $truncated
        Reason = 'tamam'
        ReasonText = ''
    }
}

function Test-SamePathCopyBinaryContent {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [int]$SampleBytes = 8192
    )

    # İlk baytlarda NUL varsa dosya metin sayılmaz: satır farkı yerine boyut/tarih karşılaştırması gösterilir.
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $buffer = New-Object byte[] $SampleBytes
        $read = $stream.Read($buffer, 0, $SampleBytes)
        for ($index = 0; $index -lt $read; $index++) {
            if ($buffer[$index] -eq 0) { return $true }
        }
        return $false
    }
    finally {
        $stream.Dispose()
    }
}

function Get-SamePathCopyFileComparison {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string]$DestinationPath,
        [bool]$IsDirectory = $false,
        [long]$MaxBytes = 2097152,
        [int]$ContextLines = 3
    )

    # Bir dosyanın kaynak ve hedef hâlini karşılaştırır: her durumda boyut/tarih bilgisi, metin dosyalarında
    # ayrıca satır farkı döner. Okunamayan, ikili ya da çok büyük dosyalarda Reason alanı nedeni söyler.
    $sourceInfo = $null
    $destinationInfo = $null
    try { if ([System.IO.File]::Exists($SourcePath)) { $sourceInfo = New-Object System.IO.FileInfo($SourcePath) } } catch { $sourceInfo = $null }
    try { if ([System.IO.File]::Exists($DestinationPath)) { $destinationInfo = New-Object System.IO.FileInfo($DestinationPath) } } catch { $destinationInfo = $null }

    $result = [pscustomobject]@{
        SourcePath = $SourcePath
        DestinationPath = $DestinationPath
        SourceExists = ($null -ne $sourceInfo)
        DestinationExists = ($null -ne $destinationInfo)
        SourceSize = $(if ($null -ne $sourceInfo) { [long]$sourceInfo.Length } else { $null })
        DestinationSize = $(if ($null -ne $destinationInfo) { [long]$destinationInfo.Length } else { $null })
        SourceWriteTime = $(if ($null -ne $sourceInfo) { $sourceInfo.LastWriteTime } else { $null })
        DestinationWriteTime = $(if ($null -ne $destinationInfo) { $destinationInfo.LastWriteTime } else { $null })
        Reason = 'tamam'
        ReasonText = ''
        Diff = $null
    }

    if ($IsDirectory) {
        $result.Reason = 'klasor'
        $result.ReasonText = 'Klasörlerin içeriği satır satır karşılaştırılmaz; klasörün altındaki dosyalar listede tek tek duruyor.'
        return $result
    }
    if ($null -eq $sourceInfo -and $null -eq $destinationInfo) {
        $result.Reason = 'yok'
        $result.ReasonText = 'Dosya ne kaynakta ne hedefte okunabildi.'
        return $result
    }
    $largest = [long][Math]::Max(
        $(if ($null -ne $sourceInfo) { [long]$sourceInfo.Length } else { 0 }),
        $(if ($null -ne $destinationInfo) { [long]$destinationInfo.Length } else { 0 }))
    if ($largest -gt $MaxBytes) {
        $result.Reason = 'buyuk'
        $result.ReasonText = ("Dosya satır satır karşılaştırma sınırından büyük ({0} > {1})." -f
            (Format-SamePathCopySize -Bytes $largest), (Format-SamePathCopySize -Bytes $MaxBytes))
        return $result
    }

    try {
        $isBinary = $false
        if ($null -ne $sourceInfo -and (Test-SamePathCopyBinaryContent -Path $SourcePath)) { $isBinary = $true }
        if (-not $isBinary -and $null -ne $destinationInfo -and (Test-SamePathCopyBinaryContent -Path $DestinationPath)) { $isBinary = $true }
        if ($isBinary) {
            $result.Reason = 'ikili'
            $result.ReasonText = 'Dosya metin değil (ikili içerik); yalnızca boyut ve tarih karşılaştırılıyor.'
            return $result
        }
        # Olmayan taraf boş satır listesiyle karşılaştırılır: yeni dosyanın tamamı eklenmiş, hedefte
        # fazla dosyanın tamamı kalkmış görünür. Boş dizi $(if...) içinde $null'a düştüğü için elle kurulur.
        $sourceLines = @()
        if ($null -ne $sourceInfo) { $sourceLines = @([System.IO.File]::ReadAllLines($SourcePath)) }
        $destinationLines = @()
        if ($null -ne $destinationInfo) { $destinationLines = @([System.IO.File]::ReadAllLines($DestinationPath)) }
        $result.Diff = Get-SamePathCopyTextDiff -SourceLines $sourceLines -DestinationLines $destinationLines -ContextLines $ContextLines
        if ([string]$result.Diff.Reason -eq 'ayni') { $result.Reason = 'ayni' }
    }
    catch {
        $result.Reason = 'okunamadi'
        $result.ReasonText = ("Dosya okunamadı: {0}" -f $_.Exception.Message)
    }
    return $result
}

function Get-SamePathCopyDiffBodyXaml {
    return @'
    <Grid Margin="18,16,18,16">
        <Grid.RowDefinitions>
            <RowDefinition Height="Auto" />
            <RowDefinition Height="*" />
            <RowDefinition Height="Auto" />
        </Grid.RowDefinitions>

        <StackPanel>
            <TextBlock x:Name="HeaderText" Style="{StaticResource TitleText}" />
            <TextBlock x:Name="AddressText" Style="{StaticResource SubtitleText}" Margin="0,4,0,0" />
            <TextBlock x:Name="SummaryText" Style="{StaticResource BodyText}" Margin="0,8,0,0" TextWrapping="Wrap" />
        </StackPanel>

        <Grid Grid.Row="1" Margin="0,14,0,0">
            <Grid.ColumnDefinitions>
                <ColumnDefinition Width="420" MinWidth="280" />
                <ColumnDefinition Width="*" MinWidth="320" />
            </Grid.ColumnDefinitions>

            <Border Style="{StaticResource Card}" Padding="8,8,4,8">
                <DockPanel LastChildFill="True">
                    <Grid DockPanel.Dock="Top" Margin="4,0,8,6">
                        <TextBlock Style="{StaticResource ColumnHeaderText}" Text="Gönderilecek / etkilenecek öğeler" />
                        <TextBlock x:Name="ListCountText" Style="{StaticResource MutedText}" HorizontalAlignment="Right" />
                    </Grid>
                    <ScrollViewer VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Disabled">
                        <StackPanel x:Name="ChangeListPanel" />
                    </ScrollViewer>
                </DockPanel>
            </Border>

            <Border Grid.Column="1" Style="{StaticResource Card}" Margin="12,0,0,0" Padding="14,12,8,12">
                <DockPanel LastChildFill="True">
                    <StackPanel x:Name="ComparePanel" DockPanel.Dock="Top" Margin="0,0,6,8" />
                    <ScrollViewer x:Name="DiffScroller" VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Auto">
                        <StackPanel x:Name="DiffPanel" />
                    </ScrollViewer>
                </DockPanel>
            </Border>
        </Grid>

        <Grid Grid.Row="2" Margin="0,14,0,0">
            <TextBlock x:Name="HintText" Style="{StaticResource MutedText}" VerticalAlignment="Center"
                       Text="Hedefe hiçbir şey yazılmaz; bu pencere yalnızca okuma yapar. + eklenecek, - hedeften kalkacak satır." />
            <StackPanel Orientation="Horizontal" HorizontalAlignment="Right">
                <Button x:Name="CopyButton" Style="{StaticResource GhostButton}" Content="Listeyi panoya kopyala" Margin="0,0,10,0" />
                <Button x:Name="CloseButton" Style="{StaticResource PrimaryButton}" Content="Kapat" MinWidth="110" />
            </StackPanel>
        </Grid>
    </Grid>
'@
}

function Get-SamePathCopyDiffClipboardText {
    param(
        [Parameter(Mandatory = $true)]$Diff,
        [Parameter(Mandatory = $true)]$Target
    )

    # Panoya yazılan metin: hangi makinede ne olacağı satır satır, işaretiyle birlikte.
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add(("{0} ({1}) - {2}" -f [string]$Target.name, [string]$Target.address, (Get-SamePathCopyFileDiffSummaryText -Diff $Diff)))
    foreach ($entry in @($Diff.Entries)) {
        $lines.Add(("{0} {1}`t{2}`t{3}" -f [string]$entry.Sign, [string]$entry.DisplayPath, [string]$entry.StatusText, [string]$entry.DestinationPath))
    }
    return ($lines -join "`r`n")
}

function Show-SamePathCopyDiff {
    param(
        [Parameter(Mandatory = $true)]$Target,
        [Parameter(Mandatory = $true)]$Diff,
        [string]$SelectPath,
        $Owner,
        [string]$IconPath
    )

    # Hedef başına karşılaştırma penceresi: solda gönderilecek/etkilenecek öğeler, sağda seçilen dosyanın
    # kaynak ile hedef arasındaki farkı. Olay işleyicileri kapanış kullanmaz; gereken her şey betik
    # kapsamındaki değişkenlerde ve denetimlerin Tag alanında durur (bkz. Show-SamePathCopyWizard).
    $window = New-SamePathCopyWindow -Title ("Karşılaştırma - {0}" -f [string]$Target.name) `
        -BodyXaml (Get-SamePathCopyDiffBodyXaml) -Width 1180 -Height 720 -MinWidth 860 -MinHeight 520 -IconPath $IconPath
    if ($Owner) { $window.Owner = $Owner }

    $script:diffWindow = $window
    $script:diffTarget = $Target
    $script:diffResult = $Diff
    $script:diffEntries = @($Diff.Entries)
    $script:diffRowBorders = New-Object System.Collections.Generic.List[object]
    $script:diffComparePanel = $window.FindName('ComparePanel')
    $script:diffLinePanel = $window.FindName('DiffPanel')
    $script:diffSelectedIndex = -1

    $window.FindName('HeaderText').Text = "{0} ile karşılaştırma" -f [string]$Target.name
    $window.FindName('AddressText').Text = "\\{0}\{1}" -f [string]$Target.address, ([string]$Target.networkRoot).Trim('\')
    $summaryText = $window.FindName('SummaryText')
    $summaryText.Text = Get-SamePathCopyFileDiffSummaryText -Diff $Diff
    if ([bool]$Diff.Failed) { $summaryText.Foreground = $window.FindResource('WarningBrush') }
    $window.FindName('ListCountText').Text = if ([bool]$Diff.Truncated) {
        "{0} satır (+{1} listeye girmedi)" -f @($script:diffEntries).Count, [int]$Diff.HiddenCount
    }
    else {
        "{0} satır" -f @($script:diffEntries).Count
    }

    # --- sağ bölüm: seçilen öğenin karşılaştırması -------------------------------------------------
    $script:diffAddCompareLine = {
        param([string]$Label, [string]$Value, [string]$Brush)
        $linePanel = New-Object System.Windows.Controls.StackPanel
        $linePanel.Orientation = 'Horizontal'
        $linePanel.Margin = New-Object System.Windows.Thickness(0, 2, 0, 2)
        $labelText = New-Object System.Windows.Controls.TextBlock
        $labelText.Style = $script:diffWindow.FindResource('MutedText')
        $labelText.Text = $Label
        $labelText.Width = 74
        [void]$linePanel.Children.Add($labelText)
        $valueText = New-Object System.Windows.Controls.TextBlock
        $valueText.Style = $script:diffWindow.FindResource('BodyText')
        $valueText.Text = $Value
        $valueText.TextTrimming = 'CharacterEllipsis'
        if (-not [string]::IsNullOrWhiteSpace($Brush)) { $valueText.Foreground = $script:diffWindow.FindResource($Brush) }
        $valueText.ToolTip = $Value
        [void]$linePanel.Children.Add($valueText)
        [void]$script:diffComparePanel.Children.Add($linePanel)
    }

    $script:diffShowComparison = {
        param($Entry)
        $script:diffComparePanel.Children.Clear()
        $script:diffLinePanel.Children.Clear()

        $pathText = New-Object System.Windows.Controls.TextBlock
        $pathText.Style = $script:diffWindow.FindResource('SectionText')
        $pathText.Text = "{0} {1}" -f [string]$Entry.Sign, [string]$Entry.DisplayPath
        $pathText.TextTrimming = 'CharacterEllipsis'
        $pathText.ToolTip = [string]$Entry.SourcePath
        [void]$script:diffComparePanel.Children.Add($pathText)

        $statusText = New-Object System.Windows.Controls.TextBlock
        $statusText.Style = $script:diffWindow.FindResource('MutedText')
        $statusText.Text = [string]$Entry.StatusText
        $statusText.Foreground = $script:diffWindow.FindResource([string]$Entry.Brush)
        $statusText.Margin = New-Object System.Windows.Thickness(0, 2, 0, 8)
        $statusText.ToolTip = [string]$Entry.ToolTip
        [void]$script:diffComparePanel.Children.Add($statusText)

        # Dosya okuma ağ üzerinden sürebilir: pencere donmasın diye önce bir bekleme satırı yazılır.
        $waitText = New-Object System.Windows.Controls.TextBlock
        $waitText.Style = $script:diffWindow.FindResource('MutedText')
        $waitText.Text = 'Dosyalar okunuyor...'
        [void]$script:diffLinePanel.Children.Add($waitText)
        Invoke-SamePathCopyUiPump

        $comparison = Get-SamePathCopyFileComparison -SourcePath ([string]$Entry.SourcePath) `
            -DestinationPath ([string]$Entry.DestinationPath) -IsDirectory ([bool]$Entry.IsDirectory)
        & $script:diffAddCompareLine 'Kaynak' $(if ([bool]$comparison.SourceExists) {
            "{0}  •  {1}" -f (Format-SamePathCopySize -Bytes ([long]$comparison.SourceSize)), ([datetime]$comparison.SourceWriteTime).ToString('dd.MM.yyyy HH:mm:ss')
        } else { 'yok (kaynakta bulunmuyor)' }) ''
        & $script:diffAddCompareLine 'Hedef' $(if ([bool]$comparison.DestinationExists) {
            "{0}  •  {1}" -f (Format-SamePathCopySize -Bytes ([long]$comparison.DestinationSize)), ([datetime]$comparison.DestinationWriteTime).ToString('dd.MM.yyyy HH:mm:ss')
        } else { 'yok (hedefte bulunmuyor)' }) ''
        & $script:diffAddCompareLine 'Hedef yolu' ([string]$Entry.DestinationPath) ''

        $script:diffLinePanel.Children.Clear()
        if ([string]$comparison.Reason -ne 'tamam' -and [string]$comparison.Reason -ne 'ayni') {
            $reasonText = New-Object System.Windows.Controls.TextBlock
            $reasonText.Style = $script:diffWindow.FindResource('MutedText')
            $reasonText.Text = [string]$comparison.ReasonText
            $reasonText.TextWrapping = 'Wrap'
            $reasonText.TextTrimming = 'None'
            $reasonText.MaxWidth = 520
            $reasonText.HorizontalAlignment = 'Left'
            [void]$script:diffLinePanel.Children.Add($reasonText)
            return
        }
        $comparisonDiff = $comparison.Diff
        if ($null -eq $comparisonDiff) { return }
        if ([string]$comparisonDiff.Reason -ne 'tamam') {
            $reasonText = New-Object System.Windows.Controls.TextBlock
            $reasonText.Style = $script:diffWindow.FindResource('MutedText')
            $reasonText.Text = [string]$comparisonDiff.ReasonText
            $reasonText.TextWrapping = 'Wrap'
            $reasonText.TextTrimming = 'None'
            $reasonText.MaxWidth = 520
            $reasonText.HorizontalAlignment = 'Left'
            [void]$script:diffLinePanel.Children.Add($reasonText)
            return
        }

        $countText = New-Object System.Windows.Controls.TextBlock
        $countText.Style = $script:diffWindow.FindResource('MutedText')
        $countText.Text = "+{0} satır eklenecek, -{1} satır kalkacak" -f [int]$comparisonDiff.AddedCount, [int]$comparisonDiff.RemovedCount
        $countText.Margin = New-Object System.Windows.Thickness(0, 0, 0, 6)
        [void]$script:diffLinePanel.Children.Add($countText)

        foreach ($line in @($comparisonDiff.Lines)) {
            $lineBorder = New-Object System.Windows.Controls.Border
            $lineBorder.Padding = New-Object System.Windows.Thickness(4, 0, 4, 0)
            $lineGrid = New-Object System.Windows.Controls.Grid
            foreach ($width in @(38, 38, 14)) {
                $column = New-Object System.Windows.Controls.ColumnDefinition
                $column.Width = [System.Windows.GridLength]::new([double]$width)
                [void]$lineGrid.ColumnDefinitions.Add($column)
            }
            $textColumn = New-Object System.Windows.Controls.ColumnDefinition
            $textColumn.Width = [System.Windows.GridLength]::Auto
            [void]$lineGrid.ColumnDefinitions.Add($textColumn)

            $kind = [string]$line.Kind
            if ($kind -eq 'Added') { $lineBorder.Background = $script:diffWindow.FindResource('SuccessSoftBrush') }
            elseif ($kind -eq 'Removed') { $lineBorder.Background = $script:diffWindow.FindResource('DangerSoftBrush') }
            elseif ($kind -eq 'Skip') { $lineBorder.Background = $script:diffWindow.FindResource('SurfaceAltBrush') }

            $numberBrush = 'TextMutedBrush'
            $addCell = {
                param([int]$Column, [string]$Text, [string]$Brush, [string]$Alignment)
                $cellText = New-Object System.Windows.Controls.TextBlock
                $cellText.Style = $script:diffWindow.FindResource('MonoText')
                $cellText.Text = $Text
                $cellText.Foreground = $script:diffWindow.FindResource($Brush)
                $cellText.HorizontalAlignment = $Alignment
                [System.Windows.Controls.Grid]::SetColumn($cellText, $Column)
                [void]$lineGrid.Children.Add($cellText)
            }
            if ($kind -eq 'Skip') {
                & $addCell 3 ("... {0} satır aynı" -f [int]$line.Count) 'TextMutedBrush' 'Left'
            }
            else {
                & $addCell 0 $(if ($null -ne $line.DestinationNumber) { [string]$line.DestinationNumber } else { '' }) $numberBrush 'Right'
                & $addCell 1 $(if ($null -ne $line.SourceNumber) { [string]$line.SourceNumber } else { '' }) $numberBrush 'Right'
                $signBrush = switch ($kind) { 'Added' { 'SuccessBrush' } 'Removed' { 'DangerBrush' } default { 'TextMutedBrush' } }
                & $addCell 2 ([string]$line.Sign) $signBrush 'Center'
                & $addCell 3 ([string]$line.Text) $(if ($kind -eq 'Same') { 'TextMutedBrush' } else { 'TextBrush' }) 'Left'
            }
            $lineBorder.Child = $lineGrid
            [void]$script:diffLinePanel.Children.Add($lineBorder)
        }
        if ([bool]$comparisonDiff.Truncated) {
            $truncatedText = New-Object System.Windows.Controls.TextBlock
            $truncatedText.Style = $script:diffWindow.FindResource('MutedText')
            $truncatedText.Text = 'Fark listesi çok uzun olduğu için kesildi.'
            $truncatedText.Margin = New-Object System.Windows.Thickness(0, 6, 0, 0)
            [void]$script:diffLinePanel.Children.Add($truncatedText)
        }
    }

    $script:diffSelectIndex = {
        param([int]$Index)
        if ($Index -lt 0 -or $Index -ge @($script:diffEntries).Count) { return }
        $script:diffSelectedIndex = $Index
        foreach ($rowBorder in $script:diffRowBorders) {
            $rowBorder.Background = $(if ([int]$rowBorder.Tag -eq $Index) {
                $script:diffWindow.FindResource('AccentSoftBrush')
            }
            else {
                [System.Windows.Media.Brushes]::Transparent
            })
        }
        & $script:diffShowComparison @($script:diffEntries)[$Index]
    }

    $script:diffRowClickHandler = {
        param($sender, $eventArgs)
        & $script:diffSelectIndex ([int]$sender.Tag)
    }

    # --- sol bölüm: öğe listesi -------------------------------------------------------------------
    $listPanel = $window.FindName('ChangeListPanel')
    if (@($script:diffEntries).Count -eq 0) {
        $emptyText = New-Object System.Windows.Controls.TextBlock
        $emptyText.Style = $window.FindResource('MutedText')
        $emptyText.Text = 'Hedef kaynakla aynı: kopyalama hiçbir dosyayı değiştirmeyecek.'
        $emptyText.TextWrapping = 'Wrap'
        $emptyText.TextTrimming = 'None'
        $emptyText.Margin = New-Object System.Windows.Thickness(4, 4, 4, 4)
        [void]$listPanel.Children.Add($emptyText)
    }

    $showGroupHeaders = (@($Diff.Groups).Count -gt 1)
    $currentHeader = $null
    $entryIndex = 0
    foreach ($entry in $script:diffEntries) {
        if ($showGroupHeaders -and [string]$entry.ItemHeader -ne [string]$currentHeader) {
            $currentHeader = [string]$entry.ItemHeader
            $groupText = New-Object System.Windows.Controls.TextBlock
            $groupText.Style = $window.FindResource('ColumnHeaderText')
            $groupText.Text = $currentHeader
            $groupText.ToolTip = [string]$entry.SourceItemPath
            $groupText.Margin = New-Object System.Windows.Thickness(4, $(if ($entryIndex -eq 0) { 2 } else { 10 }), 4, 2)
            [void]$listPanel.Children.Add($groupText)
        }

        $rowBorder = New-Object System.Windows.Controls.Border
        $rowBorder.CornerRadius = New-Object System.Windows.CornerRadius(5)
        $rowBorder.Padding = New-Object System.Windows.Thickness(4, 3, 4, 3)
        $rowBorder.Background = [System.Windows.Media.Brushes]::Transparent
        $rowBorder.Cursor = 'Hand'
        $rowBorder.Tag = $entryIndex
        $rowBorder.ToolTip = "{0}`r`n{1}" -f [string]$entry.ToolTip, [string]$entry.DestinationPath
        $rowBorder.Add_MouseLeftButtonUp($script:diffRowClickHandler)

        $rowGrid = New-Object System.Windows.Controls.Grid
        foreach ($width in @(16, 0, 118, 70)) {
            $column = New-Object System.Windows.Controls.ColumnDefinition
            $column.Width = $(if ($width -eq 0) { [System.Windows.GridLength]::new(1, [System.Windows.GridUnitType]::Star) } else { [System.Windows.GridLength]::new([double]$width) })
            [void]$rowGrid.ColumnDefinitions.Add($column)
        }
        $signText = New-Object System.Windows.Controls.TextBlock
        $signText.Style = $window.FindResource('MonoText')
        $signText.Text = [string]$entry.Sign
        $signText.Foreground = $window.FindResource([string]$entry.Brush)
        $signText.FontWeight = 'Bold'
        [void]$rowGrid.Children.Add($signText)

        $pathText = New-Object System.Windows.Controls.TextBlock
        $pathText.Style = $window.FindResource('BodyText')
        $pathText.Text = [string]$entry.DisplayPath
        $pathText.ToolTip = [string]$entry.SourcePath
        [System.Windows.Controls.Grid]::SetColumn($pathText, 1)
        [void]$rowGrid.Children.Add($pathText)

        $statusText = New-Object System.Windows.Controls.TextBlock
        $statusText.Style = $window.FindResource('MutedText')
        $statusText.Text = [string]$entry.StatusText
        $statusText.Foreground = $window.FindResource([string]$entry.Brush)
        [System.Windows.Controls.Grid]::SetColumn($statusText, 2)
        [void]$rowGrid.Children.Add($statusText)

        $sizeText = New-Object System.Windows.Controls.TextBlock
        $sizeText.Style = $window.FindResource('MutedText')
        $sizeText.Text = $(if ($null -ne $entry.Size) { Format-SamePathCopySize -Bytes ([long]$entry.Size) } else { '' })
        $sizeText.HorizontalAlignment = 'Right'
        [System.Windows.Controls.Grid]::SetColumn($sizeText, 3)
        [void]$rowGrid.Children.Add($sizeText)

        $rowBorder.Child = $rowGrid
        [void]$listPanel.Children.Add($rowBorder)
        $script:diffRowBorders.Add($rowBorder)
        $entryIndex++
    }

    $window.FindName('CopyButton').Add_Click({
        try { [System.Windows.Clipboard]::SetText((Get-SamePathCopyDiffClipboardText -Diff $script:diffResult -Target $script:diffTarget)) } catch { }
    })
    $window.FindName('CloseButton').Add_Click({ $script:diffWindow.DialogResult = $false })

    # Açılışta bir satır seçili gelir: sağ bölüm boş durmaz. İstenirse belirli bir dosya öne çıkarılır.
    $initialIndex = 0
    if (-not [string]::IsNullOrWhiteSpace($SelectPath)) {
        $matchIndex = 0
        foreach ($entry in $script:diffEntries) {
            if (([string]$entry.ExcludePath).Equals($SelectPath, [System.StringComparison]::OrdinalIgnoreCase) -or
                ([string]$entry.SourcePath).Equals($SelectPath, [System.StringComparison]::OrdinalIgnoreCase)) {
                $initialIndex = $matchIndex
                break
            }
            $matchIndex++
        }
    }
    $window.Add_ContentRendered({
        if (@($script:diffEntries).Count -gt 0) { & $script:diffSelectIndex $script:diffInitialIndex }
    })
    $script:diffInitialIndex = $initialIndex

    # Arayüzün etkileşimsiz sınanabilmesi için: değer verilirse pencere kendini kapatır.
    if (-not [string]::IsNullOrWhiteSpace($env:SAMEPATHCOPY_DIFF_AUTOCLOSE)) {
        $timer = New-Object System.Windows.Threading.DispatcherTimer
        $timer.Interval = [TimeSpan]::FromMilliseconds([Math]::Max(1, [int]$env:SAMEPATHCOPY_DIFF_AUTOCLOSE))
        $script:diffAutoCloseTimer = $timer
        $timer.Add_Tick({
            $script:diffAutoCloseTimer.Stop()
            $script:diffWindow.DialogResult = $false
        })
        $timer.Start()
    }

    [void]$window.ShowDialog()
}
