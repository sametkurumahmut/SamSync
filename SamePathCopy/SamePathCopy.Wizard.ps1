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
    # Kolon başlıkları ve varsayılanlar tek yerde durur; yeni parametre eklemek için buraya bir satır yetiyor.
    return @(
        [pscustomobject]@{ Name = 'Backup'; Key = 'backup'; Header = 'Yedek al'; Default = $false; Width = 80 }
        [pscustomobject]@{ Name = 'OnlyNewer'; Key = 'onlyNewer'; Header = 'Yalnızca yeni'; Default = $false; Width = 100 }
        [pscustomobject]@{ Name = 'Mirror'; Key = 'mirror'; Header = 'Ayna (fazlayı sil)'; Default = $false; Width = 120 }
    )
}

function Get-SamePathCopyWizardGlobalDefinitions {
    return @(
        [pscustomobject]@{ Name = 'DryRun'; Key = 'dryRun'; Header = 'Deneme çalıştırması (hiçbir şey kopyalanmaz)'; Default = $false }
        [pscustomobject]@{ Name = 'FastCopy'; Key = 'fastCopy'; Header = 'Hızlı kopyalama (çok iş parçacıklı)'; Default = $false }
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

function Show-SamePathCopyWizard {
    param(
        [Parameter(Mandatory = $true)]$Configuration,
        [Parameter(Mandatory = $true)][object[]]$Targets,
        [Parameter(Mandatory = $true)][object[]]$SourceItems,
        [Parameter(Mandatory = $true)]$Settings,
        [string]$IconPath
    )

    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    $optionDefinitions = @(Get-SamePathCopyWizardOptionDefinitions)
    $globalDefinitions = @(Get-SamePathCopyWizardGlobalDefinitions)

    $form = New-Object System.Windows.Forms.Form
    $form.Text = "{0} - Sihirbaz" -f ([string]$Configuration.menuTitle)
    $form.StartPosition = 'CenterScreen'
    $form.Size = New-Object System.Drawing.Size(880, 580)
    $form.MinimumSize = New-Object System.Drawing.Size(720, 460)
    $formIcon = $null
    if ($IconPath -and (Test-Path -LiteralPath $IconPath -PathType Leaf)) {
        $formIcon = New-Object System.Drawing.Icon($IconPath)
        $form.Icon = $formIcon
    }

    $sourceLabel = New-Object System.Windows.Forms.Label
    $sourceLabel.Location = New-Object System.Drawing.Point(18, 16)
    $sourceLabel.Size = New-Object System.Drawing.Size(830, 20)
    $sourceLabel.Anchor = 'Top, Left, Right'
    $sourceLabel.AutoEllipsis = $true
    $sourceLabel.Text = if ($SourceItems.Count -eq 1) {
        "Kaynak: $($SourceItems[0].FullName)"
    }
    else {
        "Kaynaklar: $($SourceItems.Count) öğe (ilk: $($SourceItems[0].FullName))"
    }
    $form.Controls.Add($sourceLabel)

    $grid = New-Object System.Windows.Forms.DataGridView
    $grid.Location = New-Object System.Drawing.Point(18, 44)
    $grid.Size = New-Object System.Drawing.Size(830, 300)
    $grid.Anchor = 'Top, Bottom, Left, Right'
    $grid.AllowUserToAddRows = $false
    $grid.AllowUserToDeleteRows = $false
    $grid.AllowUserToResizeRows = $false
    $grid.RowHeadersVisible = $false
    $grid.SelectionMode = 'CellSelect'
    $grid.EditMode = 'EditOnEnter'
    # Kolonlar mevcut genişliği paylaşır; böylece pencere boyutundan bağımsız olarak hiçbir parametre kolonu kırpılmaz.
    $grid.AutoSizeColumnsMode = 'Fill'
    $grid.ColumnHeadersHeightSizeMode = 'AutoSize'
    $grid.BackgroundColor = [System.Drawing.SystemColors]::Window

    $idColumn = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $idColumn.Name = 'NodeId'
    $idColumn.Visible = $false
    [void]$grid.Columns.Add($idColumn)

    $selectedColumn = New-Object System.Windows.Forms.DataGridViewCheckBoxColumn
    $selectedColumn.Name = 'Selected'
    $selectedColumn.HeaderText = 'Gönder'
    $selectedColumn.FillWeight = 60
    $selectedColumn.MinimumWidth = 58
    [void]$grid.Columns.Add($selectedColumn)

    $nameColumn = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $nameColumn.Name = 'DisplayName'
    $nameColumn.HeaderText = 'Bilgisayar'
    $nameColumn.FillWeight = 230
    $nameColumn.MinimumWidth = 160
    $nameColumn.ReadOnly = $true
    [void]$grid.Columns.Add($nameColumn)

    $groupColumn = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
    $groupColumn.Name = 'GroupName'
    $groupColumn.HeaderText = 'Grup'
    $groupColumn.FillWeight = 90
    $groupColumn.MinimumWidth = 70
    $groupColumn.ReadOnly = $true
    [void]$grid.Columns.Add($groupColumn)

    foreach ($definition in $optionDefinitions) {
        $optionColumn = New-Object System.Windows.Forms.DataGridViewCheckBoxColumn
        $optionColumn.Name = $definition.Name
        $optionColumn.HeaderText = $definition.Header
        $optionColumn.FillWeight = [int]$definition.Width
        $optionColumn.MinimumWidth = [int]$definition.Width
        [void]$grid.Columns.Add($optionColumn)
    }

    foreach ($target in $Targets) {
        $targetId = [string]$target.id
        $entry = $Settings.Targets[$targetId]
        $groupName = if ($target.PSObject.Properties['group']) { [string]$target.group } else { '' }
        $values = New-Object System.Collections.Generic.List[object]
        $values.Add($targetId)
        $values.Add([bool]$entry.Selected)
        $values.Add([string]$target.name)
        $values.Add($groupName)
        foreach ($definition in $optionDefinitions) {
            $values.Add([bool]$entry.($definition.Name))
        }
        [void]$grid.Rows.Add($values.ToArray())
    }
    $form.Controls.Add($grid)

    $selectAllButton = New-Object System.Windows.Forms.Button
    $selectAllButton.Location = New-Object System.Drawing.Point(18, 352)
    $selectAllButton.Size = New-Object System.Drawing.Size(110, 26)
    $selectAllButton.Anchor = 'Bottom, Left'
    $selectAllButton.Text = 'Tümünü seç'
    $form.Controls.Add($selectAllButton)

    $selectNoneButton = New-Object System.Windows.Forms.Button
    $selectNoneButton.Location = New-Object System.Drawing.Point(134, 352)
    $selectNoneButton.Size = New-Object System.Drawing.Size(110, 26)
    $selectNoneButton.Anchor = 'Bottom, Left'
    $selectNoneButton.Text = 'Hiçbirini seçme'
    $form.Controls.Add($selectNoneButton)

    $setSelection = {
        param([bool]$Value)
        [void]$grid.EndEdit()
        foreach ($row in $grid.Rows) {
            $row.Cells['Selected'].Value = $Value
        }
    }
    $selectAllButton.Add_Click({ & $setSelection $true }.GetNewClosure())
    $selectNoneButton.Add_Click({ & $setSelection $false }.GetNewClosure())

    $parameterGroup = New-Object System.Windows.Forms.GroupBox
    $parameterGroup.Location = New-Object System.Drawing.Point(18, 386)
    $parameterGroup.Size = New-Object System.Drawing.Size(830, 84)
    $parameterGroup.Anchor = 'Bottom, Left, Right'
    $parameterGroup.Text = 'Parametreler (bütün hedefler için)'
    $form.Controls.Add($parameterGroup)

    $globalCheckBoxes = @{}
    $offsetY = 22
    foreach ($definition in $globalDefinitions) {
        $checkBox = New-Object System.Windows.Forms.CheckBox
        $checkBox.Location = New-Object System.Drawing.Point(14, $offsetY)
        $checkBox.Size = New-Object System.Drawing.Size(660, 22)
        $checkBox.Text = [string]$definition.Header
        $checkBox.Checked = [bool]$Settings.Global.($definition.Name)
        $parameterGroup.Controls.Add($checkBox)
        $globalCheckBoxes[[string]$definition.Name] = $checkBox
        $offsetY += 26
    }

    $startButton = New-Object System.Windows.Forms.Button
    $startButton.Location = New-Object System.Drawing.Point(628, 480)
    $startButton.Size = New-Object System.Drawing.Size(105, 30)
    $startButton.Anchor = 'Bottom, Right'
    $startButton.Text = 'Başlat'
    $form.Controls.Add($startButton)

    $cancelButton = New-Object System.Windows.Forms.Button
    $cancelButton.Location = New-Object System.Drawing.Point(743, 480)
    $cancelButton.Size = New-Object System.Drawing.Size(105, 30)
    $cancelButton.Anchor = 'Bottom, Right'
    $cancelButton.Text = 'İptal'
    $cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $form.Controls.Add($cancelButton)
    $form.CancelButton = $cancelButton

    $startButton.Add_Click({
        [void]$grid.EndEdit()
        $selectedRows = @($grid.Rows | Where-Object { [bool]$_.Cells['Selected'].Value })
        if ($selectedRows.Count -eq 0) {
            [void][System.Windows.Forms.MessageBox]::Show(
                'En az bir bilgisayar seçilmeli.',
                'Sihirbaz',
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Warning)
            return
        }
        # Ayna, hedefte kaynakta olmayan dosyaları sildiği için ayrıca onay ister.
        $mirrorRows = @($selectedRows | Where-Object { [bool]$_.Cells['Mirror'].Value })
        if ($mirrorRows.Count -gt 0) {
            $mirrorNames = (@($mirrorRows | ForEach-Object { [string]$_.Cells['DisplayName'].Value }) -join ', ')
            $answer = [System.Windows.Forms.MessageBox]::Show(
                "Ayna seçili hedeflerde, kaynakta bulunmayan dosyalar silinecek:`r`n`r`n$mirrorNames`r`n`r`nDevam edilsin mi?",
                'Ayna onayı',
                [System.Windows.Forms.MessageBoxButtons]::YesNo,
                [System.Windows.Forms.MessageBoxIcon]::Warning)
            if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { return }
        }
        $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
        $form.Close()
    }.GetNewClosure())

    # Arayüzün etkileşimsiz sınanabilmesi için: değer verilirse diyalog o kadar milisaniye sonra kendini onaylayıp kapatır.
    $autoCloseTimer = $null
    if (-not [string]::IsNullOrWhiteSpace($env:SAMEPATHCOPY_WIZARD_AUTOCLOSE)) {
        $autoCloseTimer = New-Object System.Windows.Forms.Timer
        $autoCloseTimer.Interval = [Math]::Max(1, [int]$env:SAMEPATHCOPY_WIZARD_AUTOCLOSE)
        $autoCloseTimer.Add_Tick({
            $autoCloseTimer.Stop()
            $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
            $form.Close()
        }.GetNewClosure())
        $autoCloseTimer.Start()
    }

    try {
        $dialogResult = $form.ShowDialog()
        [void]$grid.EndEdit()

        # Kullanıcı vazgeçse de tablodaki seçimler saklanır; bir sonraki açılış son hâliyle gelir.
        $updatedTargets = @{}
        foreach ($row in $grid.Rows) {
            $targetId = [string]$row.Cells['NodeId'].Value
            $entry = [pscustomobject]@{ Selected = [bool]$row.Cells['Selected'].Value }
            foreach ($definition in $optionDefinitions) {
                $entry | Add-Member -NotePropertyName $definition.Name -NotePropertyValue ([bool]$row.Cells[$definition.Name].Value)
            }
            $updatedTargets[$targetId] = $entry
        }
        $updatedGlobal = [pscustomobject]@{}
        foreach ($definition in $globalDefinitions) {
            $updatedGlobal | Add-Member -NotePropertyName $definition.Name -NotePropertyValue ([bool]$globalCheckBoxes[[string]$definition.Name].Checked)
        }

        return [pscustomobject]@{
            Confirmed = ($dialogResult -eq [System.Windows.Forms.DialogResult]::OK)
            Settings = [pscustomobject]@{ Global = $updatedGlobal; Targets = $updatedTargets }
        }
    }
    finally {
        if ($null -ne $autoCloseTimer) { $autoCloseTimer.Dispose() }
        if ($null -ne $formIcon) { $formIcon.Dispose() }
        $form.Dispose()
    }
}
