Set-StrictMode -Version 2.0

# Sihirbaz ayarları config.json'a değil, bilgisayara özel bir duruma yazılır: config ortak (hatta salt okunur ağ)
# olabilir ve seçimler kullanıcıya göre değişir. SAMEPATHCOPY_WIZARD_STATE ortam değişkeni yolu değiştirir (testler kullanır).
function Get-SamePathCopyWizardStatePath {
    if (-not [string]::IsNullOrWhiteSpace($env:SAMEPATHCOPY_WIZARD_STATE)) {
        return [string]$env:SAMEPATHCOPY_WIZARD_STATE
    }
    $root = if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { $env:LOCALAPPDATA } else { [System.IO.Path]::GetTempPath() }
    return (Join-Path $root 'SamePathCopy\wizard-state.json')
}

function Get-SamePathCopyWizardOptionDefinitions {
    # Hedef başına parametreler: kolon başlığı, varsayılan ve açıklama tek yerde durur.
    # Yeni parametre eklemek için buraya bir satır yetiyor; kolon ve onay kutuları buradan üretilir.
    return @(
        [pscustomobject]@{ Name = 'Backup'; Key = 'backup'; Header = 'Yedek al'; Default = $false; Width = 92
            Description = 'Hedefte aynı yolda duran öğeyi, üzerine yazmadan önce _SamePathCopyYedek klasörüne kopyalar.' }
        [pscustomobject]@{ Name = 'OnlyNewer'; Key = 'onlyNewer'; Header = 'Yalnızca yeni'; Default = $false; Width = 112
            Description = 'Hedefteki dosya kaynaktan yeni ya da aynı yaştaysa dokunmaz (robocopy /XO).' }
        [pscustomobject]@{ Name = 'Mirror'; Key = 'mirror'; Header = 'Ayna'; Default = $false; Width = 92
            Description = 'Hedefi kaynağın aynası yapar: kaynakta olmayan dosyalar hedefte silinir (robocopy /MIR). Yalnızca klasör kopyalamada uygulanır.' }
    )
}

function Get-SamePathCopyWizardGlobalDefinitions {
    return @(
        [pscustomobject]@{ Name = 'DryRun'; Key = 'dryRun'; Header = 'Deneme çalıştırması — hiçbir şey kopyalanmaz'; Default = $false
            Description = 'Ne kopyalanacağını hesaplar, hedefe yazmaz (robocopy /L). Yedek adımı da atlanır.' }
        [pscustomobject]@{ Name = 'FastCopy'; Key = 'fastCopy'; Header = 'Hızlı kopyalama — çok iş parçacıklı'; Default = $false
            Description = 'robocopy /MT:8 kullanır. Yeniden başlatılabilir kip (/Z) bu durumda devre dışı kalır.' }
    )
}

function Get-SamePathCopyStoredBoolean {
    param($Container, [Parameter(Mandatory = $true)][string]$Name, [Parameter(Mandatory = $true)][bool]$Default)

    if ($null -eq $Container -or -not $Container.PSObject.Properties[$Name]) { return $Default }
    $value = $Container.$Name
    if ($null -eq $value) { return $Default }
    return [bool]$value
}

function Get-SamePathCopyWizardSettings {
    param(
        [Parameter(Mandatory = $true)][string]$ConfigPath,
        [Parameter(Mandatory = $true)][object[]]$Targets
    )

    $statePath = Get-SamePathCopyWizardStatePath
    $storedConfig = $null
    if (Test-Path -LiteralPath $statePath -PathType Leaf) {
        try {
            $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
            $configKey = $ConfigPath.ToLowerInvariant()
            if ($state.PSObject.Properties['configs'] -and $state.configs.PSObject.Properties[$configKey]) {
                $storedConfig = $state.configs.$configKey
            }
        }
        catch {
            # Bozuk durum dosyası kopyalamayı engellemez; varsayılanlarla devam edilir.
            $storedConfig = $null
        }
    }

    $storedTargets = if ($null -ne $storedConfig -and $storedConfig.PSObject.Properties['targets']) { $storedConfig.targets } else { $null }
    $storedGlobal = if ($null -ne $storedConfig -and $storedConfig.PSObject.Properties['global']) { $storedConfig.global } else { $null }

    $global = [pscustomobject]@{}
    foreach ($definition in Get-SamePathCopyWizardGlobalDefinitions) {
        $global | Add-Member -NotePropertyName $definition.Name -NotePropertyValue (Get-SamePathCopyStoredBoolean -Container $storedGlobal -Name $definition.Key -Default $definition.Default)
    }

    # config.json'a sonradan eklenen bilgisayarlar varsayılan olarak seçili gelir; silinenler durumdan düşer.
    $targetSettings = @{}
    foreach ($target in $Targets) {
        $targetId = [string]$target.id
        $stored = if ($null -ne $storedTargets -and $storedTargets.PSObject.Properties[$targetId]) { $storedTargets.$targetId } else { $null }
        $entry = [pscustomobject]@{ Selected = (Get-SamePathCopyStoredBoolean -Container $stored -Name 'selected' -Default $true) }
        foreach ($definition in Get-SamePathCopyWizardOptionDefinitions) {
            $entry | Add-Member -NotePropertyName $definition.Name -NotePropertyValue (Get-SamePathCopyStoredBoolean -Container $stored -Name $definition.Key -Default $definition.Default)
        }
        $targetSettings[$targetId] = $entry
    }

    return [pscustomobject]@{
        Global = $global
        Targets = $targetSettings
    }
}

function Save-SamePathCopyWizardSettings {
    param(
        [Parameter(Mandatory = $true)][string]$ConfigPath,
        [Parameter(Mandatory = $true)]$Settings
    )

    $statePath = Get-SamePathCopyWizardStatePath
    $state = $null
    if (Test-Path -LiteralPath $statePath -PathType Leaf) {
        try { $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $state = $null }
    }
    if ($null -eq $state -or -not $state.PSObject.Properties['configs'] -or $null -eq $state.configs) {
        $state = [pscustomobject]@{ version = 1; configs = [pscustomobject]@{} }
    }

    $globalObject = [pscustomobject]@{}
    foreach ($definition in Get-SamePathCopyWizardGlobalDefinitions) {
        $globalObject | Add-Member -NotePropertyName $definition.Key -NotePropertyValue ([bool]$Settings.Global.($definition.Name))
    }

    $targetsObject = [pscustomobject]@{}
    foreach ($targetId in @($Settings.Targets.Keys | Sort-Object)) {
        $entry = $Settings.Targets[$targetId]
        $stored = [pscustomobject]@{ selected = [bool]$entry.Selected }
        foreach ($definition in Get-SamePathCopyWizardOptionDefinitions) {
            $stored | Add-Member -NotePropertyName $definition.Key -NotePropertyValue ([bool]$entry.($definition.Name))
        }
        $targetsObject | Add-Member -NotePropertyName $targetId -NotePropertyValue $stored
    }

    $state.configs | Add-Member -NotePropertyName $ConfigPath.ToLowerInvariant() -NotePropertyValue ([pscustomobject]@{
        global = $globalObject
        targets = $targetsObject
    }) -Force

    $stateDirectory = Split-Path -Parent $statePath
    if ($stateDirectory -and -not (Test-Path -LiteralPath $stateDirectory -PathType Container)) {
        [void](New-Item -ItemType Directory -Path $stateDirectory -Force)
    }
    $temporaryPath = "$statePath.tmp"
    ($state | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
    Move-Item -LiteralPath $temporaryPath -Destination $statePath -Force
}

function Set-SamePathCopyWizardColumnState {
    param(
        [object[]]$Rows,
        [Parameter(Mandatory = $true)][string]$Key,
        [Parameter(Mandatory = $true)][bool]$Value
    )

    # Kolon başlığındaki toplu seçim ikonlarının yaptığı iş; arayüzden ayrı sınanabilmesi için burada durur.
    foreach ($row in @($Rows)) {
        $row.Controls[$Key].IsChecked = $Value
    }
}

function Get-SamePathCopyWizardBodyXaml {
    return @'
    <Grid Margin="20,18,20,18">
        <Grid.RowDefinitions>
            <RowDefinition Height="Auto" />
            <RowDefinition Height="Auto" />
            <RowDefinition Height="Auto" />
            <RowDefinition Height="*" />
            <RowDefinition Height="Auto" />
            <RowDefinition Height="Auto" />
        </Grid.RowDefinitions>

        <StackPanel>
            <TextBlock x:Name="HeaderText" Style="{StaticResource TitleText}" Text="Kopyalama sihirbazı" />
            <TextBlock x:Name="SourceText" Style="{StaticResource SubtitleText}" Margin="0,4,0,0" />
        </StackPanel>

        <StackPanel Grid.Row="1" Orientation="Horizontal" Margin="0,12,0,0">
            <Border Style="{StaticResource Chip}">
                <TextBlock x:Name="SourceCountText" Style="{StaticResource MutedText}" />
            </Border>
            <Border Style="{StaticResource Chip}">
                <TextBlock x:Name="LocalRootText" Style="{StaticResource MutedText}" MaxWidth="420" />
            </Border>
        </StackPanel>

        <Grid Grid.Row="2" Margin="0,16,0,8">
            <TextBlock Style="{StaticResource SectionText}" Text="Hedefler" VerticalAlignment="Center" />
            <TextBlock x:Name="SelectionCountText" Style="{StaticResource MutedText}" HorizontalAlignment="Right"
                       VerticalAlignment="Center" />
        </Grid>

        <Border Grid.Row="3" Style="{StaticResource Card}" Padding="6">
            <ScrollViewer VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Disabled"
                          CanContentScroll="False" Padding="0,0,4,0">
                <Grid x:Name="TargetGrid">
                    <Grid.ColumnDefinitions>
                        <ColumnDefinition Width="64" />
                        <ColumnDefinition Width="*" MinWidth="180" />
                        <ColumnDefinition Width="104" />
                    </Grid.ColumnDefinitions>
                    <Grid.RowDefinitions>
                        <RowDefinition Height="24" />
                        <RowDefinition Height="26" />
                    </Grid.RowDefinitions>
                    <TextBlock Grid.Column="0" Style="{StaticResource ColumnHeaderText}" Text="Gönder"
                               HorizontalAlignment="Center" />
                    <TextBlock Grid.Column="1" Style="{StaticResource ColumnHeaderText}" Text="Bilgisayar" Margin="6,0,0,0" />
                    <TextBlock Grid.Column="2" Style="{StaticResource ColumnHeaderText}" Text="Grup" />
                </Grid>
            </ScrollViewer>
        </Border>

        <Border Grid.Row="4" Style="{StaticResource Card}" Margin="0,12,0,0" Padding="16,12,16,12">
            <StackPanel>
                <TextBlock Style="{StaticResource SectionText}" Text="Bütün hedefler için" Margin="0,0,0,8" />
                <StackPanel x:Name="GlobalOptionPanel" />
            </StackPanel>
        </Border>

        <Grid Grid.Row="5" Margin="0,16,0,0">
            <TextBlock x:Name="HintText" Style="{StaticResource MutedText}" VerticalAlignment="Center"
                       Text="Seçimler bu bilgisayarda saklanır; pencere bir dahaki açılışta aynı gelir." />
            <StackPanel Orientation="Horizontal" HorizontalAlignment="Right">
                <Button x:Name="CancelButton" Style="{StaticResource SecondaryButton}" Content="Vazgeç" Margin="0,0,10,0" />
                <Button x:Name="StartButton" Style="{StaticResource PrimaryButton}" Content="Kopyalamayı başlat" MinWidth="150" />
            </StackPanel>
        </Grid>
    </Grid>
'@
}

function Show-SamePathCopyWizard {
    param(
        [Parameter(Mandatory = $true)]$Configuration,
        [Parameter(Mandatory = $true)][object[]]$Targets,
        [Parameter(Mandatory = $true)][object[]]$SourceItems,
        [Parameter(Mandatory = $true)]$Settings,
        [string[]]$LocalRoots,
        [string]$IconPath
    )

    $optionDefinitions = @(Get-SamePathCopyWizardOptionDefinitions)
    $globalDefinitions = @(Get-SamePathCopyWizardGlobalDefinitions)

    $window = New-SamePathCopyWindow -Title ("{0} - Sihirbaz" -f [string]$Configuration.menuTitle) `
        -BodyXaml (Get-SamePathCopyWizardBodyXaml) -Width 940 -Height 660 -MinWidth 760 -MinHeight 520 -IconPath $IconPath

    $window.FindName('SourceText').Text = if ($SourceItems.Count -eq 1) {
        [string]$SourceItems[0].FullName
    }
    else {
        "{0} öğe seçildi (ilk: {1})" -f $SourceItems.Count, $SourceItems[0].FullName
    }
    $window.FindName('SourceCountText').Text = "{0} kaynak öğe" -f $SourceItems.Count
    $localRootText = if ($LocalRoots -and @($LocalRoots).Count -gt 0) { @($LocalRoots) -join '  •  ' } else { 'Yerel kök tanımsız' }
    $window.FindName('LocalRootText').Text = "Yerel kök: $localRootText"

    # Satırlar XAML'deki başlık ızgarasına eklenir; böylece başlık ve hücreler aynı kolon genişliklerini paylaşır.
    # Parametre kolonları tanımlardan üretilir: yeni bir parametre eklendiğinde kolon ve başlık kendiliğinden oluşur.
    $targetGrid = $window.FindName('TargetGrid')
    $firstOptionColumn = $targetGrid.ColumnDefinitions.Count
    foreach ($optionDefinition in $optionDefinitions) {
        $column = New-Object System.Windows.Controls.ColumnDefinition
        $column.Width = [System.Windows.GridLength]::new([double]$optionDefinition.Width)
        [void]$targetGrid.ColumnDefinitions.Add($column)

        $headerText = New-Object System.Windows.Controls.TextBlock
        $headerText.Style = $window.FindResource('ColumnHeaderText')
        $headerText.Text = [string]$optionDefinition.Header
        $headerText.HorizontalAlignment = 'Center'
        $headerText.ToolTip = [string]$optionDefinition.Description
        [System.Windows.Controls.Grid]::SetRow($headerText, 0)
        [System.Windows.Controls.Grid]::SetColumn($headerText, ($firstOptionColumn + $optionDefinitions.IndexOf($optionDefinition)))
        [void]$targetGrid.Children.Add($headerText)
    }
    # Olay işleyicileri betik kapsamındaki değişkenleri ve fonksiyonları görür. Kapanış (GetNewClosure)
    # kullanılmaz: kapanışlar ayrı bir modül kapsamına bağlanır ve betikte tanımlı fonksiyonlara erişemez.
    $script:wizardWindow = $window
    $script:wizardIconPath = $IconPath
    $script:wizardOptionDefinitions = $optionDefinitions
    $script:wizardSelectionCountText = $window.FindName('SelectionCountText')
    $script:wizardRows = New-Object System.Collections.Generic.List[object]
    $rows = $script:wizardRows

    $updateSelectionCount = {
        $selected = @($script:wizardRows | Where-Object { [bool]$_.Controls['Selected'].IsChecked }).Count
        $script:wizardSelectionCountText.Text = "{0} / {1} seçili" -f $selected, $script:wizardRows.Count
    }

    # Her onay kutusu kolonunun başlığının altına, o kolonun tamamını işaretleyen/temizleyen iki küçük ikon konur.
    # Hangi kolonun hangi yöne çevrileceği düğmenin Tag değerinde taşınır; işleyici tek ve paylaşımlıdır.
    $columnToggleHandler = {
        param($sender, $eventArgs)
        $tag = $sender.Tag
        Set-SamePathCopyWizardColumnState -Rows $script:wizardRows -Key ([string]$tag.Key) -Value ([bool]$tag.Value)
    }

    $addColumnToggles = {
        param([int]$Column, [string]$Key, [string]$Label)

        $panel = New-Object System.Windows.Controls.StackPanel
        $panel.Orientation = 'Horizontal'
        $panel.HorizontalAlignment = 'Center'
        foreach ($toggle in @(
            [pscustomobject]@{ Glyph = '☑'; Value = $true; ToolTip = "Bütün hedeflerde '$Label' işaretle" }
            [pscustomobject]@{ Glyph = '☐'; Value = $false; ToolTip = "Bütün hedeflerde '$Label' işaretini kaldır" }
        )) {
            $button = New-Object System.Windows.Controls.Button
            $button.Style = $script:wizardWindow.FindResource('IconButton')
            $button.Content = [string]$toggle.Glyph
            $button.ToolTip = [string]$toggle.ToolTip
            $button.Tag = [pscustomobject]@{ Key = $Key; Value = [bool]$toggle.Value }
            $button.Add_Click($columnToggleHandler)
            [void]$panel.Children.Add($button)
        }
        [System.Windows.Controls.Grid]::SetRow($panel, 1)
        [System.Windows.Controls.Grid]::SetColumn($panel, $Column)
        [void]$targetGrid.Children.Add($panel)
    }

    & $addColumnToggles 0 'Selected' 'Gönder'
    foreach ($optionDefinition in $optionDefinitions) {
        & $addColumnToggles ($firstOptionColumn + $optionDefinitions.IndexOf($optionDefinition)) ([string]$optionDefinition.Name) ([string]$optionDefinition.Header)
    }

    # Veri satırları iki başlık satırının (kolon adları ve toplu seçim ikonları) ardından başlar.
    $rowIndex = 2
    foreach ($target in $Targets) {
        $targetId = [string]$target.id
        $entry = $Settings.Targets[$targetId]
        $definition = New-Object System.Windows.Controls.RowDefinition
        $definition.Height = [System.Windows.GridLength]::new(34)
        [void]$targetGrid.RowDefinitions.Add($definition)

        $rowBorder = New-Object System.Windows.Controls.Border
        $rowBorder.Style = $window.FindResource('RowBorder')
        [System.Windows.Controls.Grid]::SetRow($rowBorder, $rowIndex)
        [System.Windows.Controls.Grid]::SetColumn($rowBorder, 0)
        [System.Windows.Controls.Grid]::SetColumnSpan($rowBorder, $targetGrid.ColumnDefinitions.Count)
        if ($rowIndex % 2 -eq 0) {
            $rowBorder.Background = $window.FindResource('SurfaceAltBrush')
        }
        [void]$targetGrid.Children.Add($rowBorder)

        $controls = @{}
        $selectedBox = New-Object System.Windows.Controls.CheckBox
        $selectedBox.Style = $window.FindResource('ModernCheckBox')
        $selectedBox.IsChecked = [bool]$entry.Selected
        $selectedBox.HorizontalAlignment = 'Center'
        $selectedBox.VerticalAlignment = 'Center'
        $selectedBox.Add_Checked($updateSelectionCount)
        $selectedBox.Add_Unchecked($updateSelectionCount)
        [System.Windows.Controls.Grid]::SetRow($selectedBox, $rowIndex)
        [System.Windows.Controls.Grid]::SetColumn($selectedBox, 0)
        [void]$targetGrid.Children.Add($selectedBox)
        $controls['Selected'] = $selectedBox

        $nameText = New-Object System.Windows.Controls.TextBlock
        $nameText.Style = $window.FindResource('BodyText')
        $nameText.Text = [string]$target.name
        $nameText.Margin = New-Object System.Windows.Thickness(6, 0, 8, 0)
        [System.Windows.Controls.Grid]::SetRow($nameText, $rowIndex)
        [System.Windows.Controls.Grid]::SetColumn($nameText, 1)
        [void]$targetGrid.Children.Add($nameText)

        $groupText = New-Object System.Windows.Controls.TextBlock
        $groupText.Style = $window.FindResource('MutedText')
        $groupText.Text = if ($target.PSObject.Properties['group']) { [string]$target.group } else { '' }
        [System.Windows.Controls.Grid]::SetRow($groupText, $rowIndex)
        [System.Windows.Controls.Grid]::SetColumn($groupText, 2)
        [void]$targetGrid.Children.Add($groupText)

        $optionColumn = $firstOptionColumn
        foreach ($optionDefinition in $optionDefinitions) {
            $optionBox = New-Object System.Windows.Controls.CheckBox
            $optionBox.Style = $window.FindResource('ModernCheckBox')
            $optionBox.IsChecked = [bool]$entry.($optionDefinition.Name)
            $optionBox.HorizontalAlignment = 'Center'
            $optionBox.VerticalAlignment = 'Center'
            $optionBox.ToolTip = [string]$optionDefinition.Description
            [System.Windows.Controls.Grid]::SetRow($optionBox, $rowIndex)
            [System.Windows.Controls.Grid]::SetColumn($optionBox, $optionColumn)
            [void]$targetGrid.Children.Add($optionBox)
            $controls[[string]$optionDefinition.Name] = $optionBox
            $optionColumn++
        }

        $rows.Add([pscustomobject]@{ Id = $targetId; Name = [string]$target.name; Controls = $controls })
        $rowIndex++
    }
    & $updateSelectionCount

    $globalPanel = $window.FindName('GlobalOptionPanel')
    $globalBoxes = @{}
    foreach ($globalDefinition in $globalDefinitions) {
        $globalBox = New-Object System.Windows.Controls.CheckBox
        $globalBox.Style = $window.FindResource('ModernCheckBox')
        $globalBox.Content = [string]$globalDefinition.Header
        $globalBox.IsChecked = [bool]$Settings.Global.($globalDefinition.Name)
        $globalBox.Margin = New-Object System.Windows.Thickness(0, 4, 0, 4)
        $globalBox.ToolTip = [string]$globalDefinition.Description
        [void]$globalPanel.Children.Add($globalBox)
        $globalBoxes[[string]$globalDefinition.Name] = $globalBox
    }

    $window.FindName('CancelButton').Add_Click({ $script:wizardWindow.DialogResult = $false })
    $window.FindName('StartButton').Add_Click({
        $selectedRows = @($script:wizardRows | Where-Object { [bool]$_.Controls['Selected'].IsChecked })
        if ($selectedRows.Count -eq 0) {
            [void](Show-SamePathCopyConfirm -Title 'Hedef seçilmedi' -Message 'Kopyalamak için en az bir bilgisayar işaretlenmeli.' -ConfirmText 'Tamam' -CancelText 'Kapat' -Owner $script:wizardWindow -IconPath $script:wizardIconPath)
            return
        }
        # Ayna, hedefte kaynakta bulunmayan dosyaları sildiği için ayrıca onay ister.
        $mirrorRows = @($selectedRows | Where-Object { [bool]$_.Controls['Mirror'].IsChecked })
        if ($mirrorRows.Count -gt 0) {
            $mirrorNames = (@($mirrorRows | ForEach-Object { $_.Name }) -join ', ')
            $confirmed = Show-SamePathCopyConfirm -Title 'Ayna onayı' -Owner $script:wizardWindow -IconPath $script:wizardIconPath `
                -Message "Şu hedeflerde, kaynakta bulunmayan dosyalar silinecek:`r`n`r`n$mirrorNames" `
                -ConfirmText 'Sil ve kopyala' -CancelText 'Vazgeç'
            if (-not $confirmed) { return }
        }
        $script:wizardWindow.DialogResult = $true
    })

    # Arayüzün etkileşimsiz sınanabilmesi için: değer verilirse pencere o kadar milisaniye sonra kendini onaylayıp kapanır.
    if (-not [string]::IsNullOrWhiteSpace($env:SAMEPATHCOPY_WIZARD_AUTOCLOSE)) {
        $timer = New-Object System.Windows.Threading.DispatcherTimer
        $timer.Interval = [TimeSpan]::FromMilliseconds([Math]::Max(1, [int]$env:SAMEPATHCOPY_WIZARD_AUTOCLOSE))
        $script:wizardAutoCloseTimer = $timer
        $timer.Add_Tick({
            $script:wizardAutoCloseTimer.Stop()
            $script:wizardWindow.DialogResult = $true
        })
        $timer.Start()
    }

    $dialogResult = $window.ShowDialog()

    # Vazgeçilse bile tablodaki son hâl saklanır; pencere bir sonraki açılışta aynı gelir.
    $updatedTargets = @{}
    foreach ($row in $rows) {
        $entry = [pscustomobject]@{ Selected = [bool]$row.Controls['Selected'].IsChecked }
        foreach ($optionDefinition in $optionDefinitions) {
            $entry | Add-Member -NotePropertyName $optionDefinition.Name -NotePropertyValue ([bool]$row.Controls[[string]$optionDefinition.Name].IsChecked)
        }
        $updatedTargets[$row.Id] = $entry
    }
    $updatedGlobal = [pscustomobject]@{}
    foreach ($globalDefinition in $globalDefinitions) {
        $updatedGlobal | Add-Member -NotePropertyName $globalDefinition.Name -NotePropertyValue ([bool]$globalBoxes[[string]$globalDefinition.Name].IsChecked)
    }

    return [pscustomobject]@{
        Confirmed = ($dialogResult -eq $true)
        Settings = [pscustomobject]@{ Global = $updatedGlobal; Targets = $updatedTargets }
    }
}
