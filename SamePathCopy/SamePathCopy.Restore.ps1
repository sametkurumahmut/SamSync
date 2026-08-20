Set-StrictMode -Version 2.0

# Yedekten geri alma penceresi: hangi bilgisayarda hangi yedeğin geri yazılacağı seçilir.
# Yedekler kopyalama sırasında "Yedek al" parametresiyle oluşan _SamePathCopyYedek\<tarih-saat> klasörleridir.
if (-not (Get-Command -Name 'Write-SamePathCopyLog' -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot 'SamePathCopy.Log.ps1')
}

function Get-SamePathCopyRestoreCandidates {
    param(
        [Parameter(Mandatory = $true)][object[]]$Plans
    )

    # Her plan için hedefteki yedeklerden bu öğeyi içerenler bulunur; yedeği olmayan hedef listeye girmez.
    $candidates = @()
    foreach ($plan in $Plans) {
        $relativePath = Get-SamePathCopyRelativeDestinationPath -Destination $plan.Destination `
            -Address ([string]$plan.Target.address) -NetworkRoot ([string]$plan.Target.networkRoot)
        $stamps = @(Get-SamePathCopyBackupStamps -Address ([string]$plan.Target.address) `
            -NetworkRoot ([string]$plan.Target.networkRoot) -RelativePath $relativePath)
        if ($stamps.Count -eq 0) { continue }
        $candidates += [pscustomobject]@{
            Plan = $plan
            TargetId = [string]$plan.Target.id
            TargetName = [string]$plan.Target.name
            RelativePath = $relativePath
            Destination = [string]$plan.Destination
            Stamps = $stamps
        }
    }
    return @($candidates)
}

function Get-SamePathCopyRestoreBodyXaml {
    return @'
    <Grid Margin="20,18,20,18">
        <Grid.RowDefinitions>
            <RowDefinition Height="Auto" />
            <RowDefinition Height="Auto" />
            <RowDefinition Height="*" />
            <RowDefinition Height="Auto" />
            <RowDefinition Height="Auto" />
        </Grid.RowDefinitions>

        <StackPanel>
            <TextBlock Style="{StaticResource TitleText}" Text="Yedekten geri al" />
            <TextBlock x:Name="SourceText" Style="{StaticResource SubtitleText}" Margin="0,4,0,0" />
        </StackPanel>

        <Grid Grid.Row="1" Margin="0,16,0,8">
            <TextBlock Style="{StaticResource SectionText}" Text="Yedeği olan bilgisayarlar" VerticalAlignment="Center" />
            <StackPanel Orientation="Horizontal" HorizontalAlignment="Right" VerticalAlignment="Center">
                <Button x:Name="SelectAllButton" Style="{StaticResource GhostButton}" Content="Tümünü seç" Margin="0,0,8,0" />
                <Button x:Name="SelectNoneButton" Style="{StaticResource GhostButton}" Content="Hiçbirini seçme" Margin="0,0,10,0" />
                <TextBlock x:Name="SelectionCountText" Style="{StaticResource MutedText}" VerticalAlignment="Center" />
            </StackPanel>
        </Grid>

        <Border Grid.Row="2" Style="{StaticResource Card}" Padding="6">
            <ScrollViewer VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Disabled" CanContentScroll="False">
                <Grid x:Name="RestoreGrid">
                    <Grid.ColumnDefinitions>
                        <ColumnDefinition Width="70" />
                        <ColumnDefinition Width="*" MinWidth="200" />
                        <ColumnDefinition Width="220" />
                    </Grid.ColumnDefinitions>
                    <Grid.RowDefinitions>
                        <RowDefinition Height="26" />
                    </Grid.RowDefinitions>
                    <TextBlock Grid.Column="0" Style="{StaticResource ColumnHeaderText}" Text="Geri al" HorizontalAlignment="Center" />
                    <TextBlock Grid.Column="1" Style="{StaticResource ColumnHeaderText}" Text="Bilgisayar" Margin="6,0,0,0" />
                    <TextBlock Grid.Column="2" Style="{StaticResource ColumnHeaderText}" Text="Yedek tarihi" />
                </Grid>
            </ScrollViewer>
        </Border>

        <Border Grid.Row="3" Style="{StaticResource Card}" Margin="0,12,0,0" Padding="16,12,16,12">
            <StackPanel>
                <TextBlock Style="{StaticResource SectionText}" Text="Geri alma ayarları" Margin="0,0,0,8" />
                <CheckBox x:Name="BackupCurrentBox" Style="{StaticResource ModernCheckBox}"
                          Content="Geri almadan önce hedefin şu anki hâlini yedekle" />
                <TextBlock x:Name="WarningText" Style="{StaticResource MutedText}" Margin="0,8,0,0" TextWrapping="Wrap"
                           Text="Geri alma, yedekteki dosyaları hedefe yazar. Hedefte olup yedekte olmayan dosyalar silinmez." />
            </StackPanel>
        </Border>

        <Grid Grid.Row="4" Margin="0,16,0,0">
            <TextBlock x:Name="HintText" Style="{StaticResource MutedText}" VerticalAlignment="Center" />
            <StackPanel Orientation="Horizontal" HorizontalAlignment="Right">
                <Button x:Name="CancelButton" Style="{StaticResource SecondaryButton}" Content="Vazgeç" Margin="0,0,10,0" />
                <Button x:Name="StartButton" Style="{StaticResource PrimaryButton}" Content="Geri almayı başlat" MinWidth="160" />
            </StackPanel>
        </Grid>
    </Grid>
'@
}

function Show-SamePathCopyRestore {
    param(
        [Parameter(Mandatory = $true)]$Configuration,
        [Parameter(Mandatory = $true)][object[]]$Candidates,
        [Parameter(Mandatory = $true)][object[]]$SourceItems,
        [string]$IconPath
    )

    $window = New-SamePathCopyWindow -Title ("{0} - Yedekten geri al" -f [string]$Configuration.menuTitle) `
        -BodyXaml (Get-SamePathCopyRestoreBodyXaml) -Width 880 -Height 620 -MinWidth 720 -MinHeight 480 -IconPath $IconPath

    $restoreSummary = Get-SamePathCopySourceSummary -SourceItems $SourceItems
    $restoreSourceText = $window.FindName('SourceText')
    $restoreSourceText.Text = "Geri alınacak: {0}" -f [string]$restoreSummary.HeadlineText
    $restoreSourceText.ToolTip = [string]$restoreSummary.ToolTipText
    $window.FindName('HintText').Text = 'Yedekler kopyalama sırasında "Yedek al" seçiliyken oluşur.'
    $backupCurrentBox = $window.FindName('BackupCurrentBox')
    $backupCurrentBox.IsChecked = $true

    # Olay işleyicileri betik kapsamındaki değişkenleri görür; kapanış (GetNewClosure) kullanılmaz.
    $script:restoreWindow = $window
    $script:restoreRows = New-Object System.Collections.Generic.List[object]
    $script:restoreSelectionText = $window.FindName('SelectionCountText')
    $restoreGrid = $window.FindName('RestoreGrid')

    $updateCount = {
        $selected = @($script:restoreRows | Where-Object { [bool]$_.SelectBox.IsChecked }).Count
        $script:restoreSelectionText.Text = "{0} / {1} seçili" -f $selected, $script:restoreRows.Count
    }
    $script:restoreUpdateCount = $updateCount

    $rowIndex = 1
    foreach ($candidate in $Candidates) {
        $definition = New-Object System.Windows.Controls.RowDefinition
        $definition.Height = [System.Windows.GridLength]::new(36)
        [void]$restoreGrid.RowDefinitions.Add($definition)

        $rowBorder = New-Object System.Windows.Controls.Border
        $rowBorder.Style = $window.FindResource('RowBorder')
        [System.Windows.Controls.Grid]::SetRow($rowBorder, $rowIndex)
        [System.Windows.Controls.Grid]::SetColumnSpan($rowBorder, 3)
        if ($rowIndex % 2 -eq 1) { $rowBorder.Background = $window.FindResource('SurfaceAltBrush') }
        [void]$restoreGrid.Children.Add($rowBorder)

        $selectBox = New-Object System.Windows.Controls.CheckBox
        $selectBox.Style = $window.FindResource('ModernCheckBox')
        $selectBox.IsChecked = $true
        $selectBox.HorizontalAlignment = 'Center'
        $selectBox.VerticalAlignment = 'Center'
        $selectBox.Add_Checked($updateCount)
        $selectBox.Add_Unchecked($updateCount)
        [System.Windows.Controls.Grid]::SetRow($selectBox, $rowIndex)
        [System.Windows.Controls.Grid]::SetColumn($selectBox, 0)
        [void]$restoreGrid.Children.Add($selectBox)

        $nameText = New-Object System.Windows.Controls.TextBlock
        $nameText.Style = $window.FindResource('BodyText')
        $nameText.Text = "{0}    ({1} yedek)" -f $candidate.TargetName, @($candidate.Stamps).Count
        $nameText.Margin = New-Object System.Windows.Thickness(6, 0, 8, 0)
        $nameText.ToolTip = $candidate.Destination
        [System.Windows.Controls.Grid]::SetRow($nameText, $rowIndex)
        [System.Windows.Controls.Grid]::SetColumn($nameText, 1)
        [void]$restoreGrid.Children.Add($nameText)

        $stampBox = New-Object System.Windows.Controls.ComboBox
        $stampBox.Style = $window.FindResource('ModernComboBox')
        $stampBox.Margin = New-Object System.Windows.Thickness(0, 0, 6, 0)
        foreach ($stamp in @($candidate.Stamps)) { [void]$stampBox.Items.Add([string]$stamp.Label) }
        $stampBox.SelectedIndex = 0
        [System.Windows.Controls.Grid]::SetRow($stampBox, $rowIndex)
        [System.Windows.Controls.Grid]::SetColumn($stampBox, 2)
        [void]$restoreGrid.Children.Add($stampBox)

        $script:restoreRows.Add([pscustomobject]@{
            Candidate = $candidate
            SelectBox = $selectBox
            StampBox = $stampBox
        })
        $rowIndex++
    }
    & $updateCount

    $window.FindName('SelectAllButton').Add_Click({
        foreach ($row in $script:restoreRows) { $row.SelectBox.IsChecked = $true }
        & $script:restoreUpdateCount
    })
    $window.FindName('SelectNoneButton').Add_Click({
        foreach ($row in $script:restoreRows) { $row.SelectBox.IsChecked = $false }
        & $script:restoreUpdateCount
    })
    $window.FindName('CancelButton').Add_Click({ $script:restoreWindow.DialogResult = $false })
    $window.FindName('StartButton').Add_Click({
        if (@($script:restoreRows | Where-Object { [bool]$_.SelectBox.IsChecked }).Count -eq 0) {
            [void](Show-SamePathCopyConfirm -Title 'Bilgisayar seçilmedi' -Message 'Geri almak için en az bir bilgisayar işaretlenmeli.' `
                -ConfirmText 'Tamam' -CancelText 'Kapat' -Owner $script:restoreWindow)
            return
        }
        $script:restoreWindow.DialogResult = $true
    })

    # Testlerin arayüzü etkileşimsiz sınayabilmesi için: değer verilirse pencere kendini onaylayıp kapatır.
    if (-not [string]::IsNullOrWhiteSpace($env:SAMEPATHCOPY_RESTORE_AUTOCLOSE)) {
        # Kapanış (GetNewClosure) kullanılmaz: kapanışlar ayrı bir kapsama bağlanır ve betik değişkenlerini görmez.
        $timer = New-Object System.Windows.Threading.DispatcherTimer
        $timer.Interval = [TimeSpan]::FromMilliseconds([Math]::Max(1, [int]$env:SAMEPATHCOPY_RESTORE_AUTOCLOSE))
        $script:restoreAutoCloseTimer = $timer
        $timer.Add_Tick({
            $script:restoreAutoCloseTimer.Stop()
            $script:restoreWindow.DialogResult = $true
        })
        $timer.Start()
    }

    $dialogResult = $window.ShowDialog()
    $selections = @()
    foreach ($row in $script:restoreRows) {
        if (-not [bool]$row.SelectBox.IsChecked) { continue }
        $stampIndex = [Math]::Max(0, [int]$row.StampBox.SelectedIndex)
        $selections += [pscustomobject]@{
            Candidate = $row.Candidate
            Stamp = @($row.Candidate.Stamps)[$stampIndex]
        }
    }
    return [pscustomobject]@{
        Confirmed = ($dialogResult -eq $true)
        BackupCurrent = [bool]$backupCurrentBox.IsChecked
        Selections = @($selections)
    }
}
