[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string[]]$SourcePath,
    [Parameter(Mandatory = $true)][string]$TargetId,
    [string]$ConfigPath,
    [switch]$PlanOnly
)

$ErrorActionPreference = 'Stop'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($scriptDirectory)) {
    throw 'Copy-SamePath.ps1 dosyasının bulunduğu klasör belirlenemedi.'
}
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = Join-Path $scriptDirectory 'config.json'
}
. (Join-Path $scriptDirectory 'SamePathCopy.Common.ps1')

trap {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [void][System.Windows.Forms.MessageBox]::Show(
            $_.Exception.Message,
            'Aynı Dizine Kopyala - Hata',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        )
    }
    catch {
        # Explorer'dan çalışırken ana hatayı gizlememek için yalnızca GUI hatasını yut.
    }
    exit 1
}

function Invoke-Robocopy {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][bool]$IsDirectory,
        [Parameter(Mandatory = $true)][int]$RetryCount,
        [Parameter(Mandatory = $true)][int]$WaitSeconds,
        $Options,
        $Form
    )

    if ($Destination -match '^(\\\\[^\\]+\\[^\\]+)') {
        $shareRoot = $Matches[1]
        try {
            [void](Get-Item -LiteralPath $shareRoot -ErrorAction Stop)
        }
        catch {
            throw "Hedef SMB paylaşımına erişilemiyor: $shareRoot. Windows paylaşım ve NTFS izinlerini veya kayıtlı ağ kimlik bilgilerini kontrol edin. Ayrıntı: $($_.Exception.Message)"
        }
    }

    if ($IsDirectory) {
        $sourceDirectory = $Source
        $destinationDirectory = $Destination
        $fileFilter = $null
    }
    else {
        $sourceDirectory = [System.IO.Path]::GetDirectoryName($Source)
        $destinationDirectory = [System.IO.Path]::GetDirectoryName($Destination)
        $fileFilter = [System.IO.Path]::GetFileName($Source)
        if ([string]::IsNullOrWhiteSpace($sourceDirectory) -or
            [string]::IsNullOrWhiteSpace($destinationDirectory) -or
            [string]::IsNullOrWhiteSpace($fileFilter)) {
            throw "Dosya kopyalama yolları çözümlenemedi. Kaynak: $Source; Hedef: $Destination"
        }
    }

    $logPath = Join-Path ([System.IO.Path]::GetTempPath()) ("SamePathCopy-Robocopy-{0}.log" -f [guid]::NewGuid().ToString('N'))
    $arguments = @(Get-SamePathCopyRobocopyArguments -SourceDirectory $sourceDirectory -DestinationDirectory $destinationDirectory -FileFilter $fileFilter -IsDirectory $IsDirectory -RetryCount $RetryCount -WaitSeconds $WaitSeconds -Options $Options -LogPath $logPath)
    try {
        $process = Start-Process -FilePath 'robocopy.exe' -ArgumentList ($arguments -join ' ') -WindowStyle Hidden -PassThru
        while (-not $process.WaitForExit(150)) {
            if ($Form) {
                [System.Windows.Forms.Application]::DoEvents()
            }
        }
        $process.WaitForExit()

        $details = ''
        if ($process.ExitCode -ge 8 -and (Test-Path -LiteralPath $logPath -PathType Leaf)) {
            $detailLines = @(Get-Content -LiteralPath $logPath -Encoding Unicode -ErrorAction SilentlyContinue |
                ForEach-Object { $_.Trim() } |
                Where-Object { $_ } |
                Select-Object -Last 12)
            $details = $detailLines -join "`r`n"
        }
        return [pscustomobject]@{
            ExitCode = [int]$process.ExitCode
            Details = $details
        }
    }
    finally {
        if (Test-Path -LiteralPath $logPath -PathType Leaf) {
            Remove-Item -LiteralPath $logPath -Force -ErrorAction SilentlyContinue
        }
    }
}

function Invoke-SamePathCopyBackup {
    param(
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][string]$BackupPath,
        [Parameter(Mandatory = $true)][bool]$IsDirectory,
        [Parameter(Mandatory = $true)][int]$RetryCount,
        [Parameter(Mandatory = $true)][int]$WaitSeconds,
        $Form
    )

    # Yalnızca hedefte hâlihazırda var olan öğe yedeklenir; yeni gönderilen öğenin yedeklenecek bir önceki hâli yoktur.
    if (-not (Test-Path -LiteralPath $Destination)) {
        return [pscustomobject]@{ Performed = $false; ExitCode = 0; Details = ''; BackupPath = $BackupPath }
    }

    $result = Invoke-Robocopy -Source $Destination -Destination $BackupPath -IsDirectory $IsDirectory -RetryCount $RetryCount -WaitSeconds $WaitSeconds -Options $null -Form $Form
    return [pscustomobject]@{
        Performed = $true
        ExitCode = [int]$result.ExitCode
        Details = [string]$result.Details
        BackupPath = $BackupPath
    }
}

$config = Get-SamePathCopyConfiguration -ConfigPath $ConfigPath
$localIdentity = Get-LocalSamePathCopyIdentity -Configuration $config
$resolvedConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$isWizard = $TargetId -eq 'wizard'
$targets = @(Resolve-SamePathCopyTargets -Configuration $config -TargetId $TargetId -LocalIdentity $localIdentity)
if ($targets.Count -eq 0) {
    throw "Kopyalama için etkin hedef yok."
}

$wizardSettings = $null
if ($isWizard) {
    . (Join-Path $scriptDirectory 'SamePathCopy.Wizard.ps1')
    $wizardSettings = Get-SamePathCopyWizardSettings -ConfigPath $resolvedConfigPath -Targets $targets
}

$sourceItems = @(foreach ($path in @($SourcePath | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Kaynak bulunamadı: $path"
    }
    $item = Get-Item -LiteralPath $path -Force
    if ($item.PSProvider.Name -ne 'FileSystem') {
        throw "Yalnızca dosya sistemi öğeleri destekleniyor: $path"
    }
    $item
})
if ($sourceItems.Count -eq 0) {
    throw 'Kopyalanacak kaynak seçilmedi.'
}

$globalOptions = $null
if ($isWizard) {
    if (-not $PlanOnly) {
        # Arayüz, kullanıcı vazgeçse bile tablodaki son hâli döndürür; ayarlar her iki durumda da saklanır.
        $wizardResult = Show-SamePathCopyWizard -Configuration $config -Targets $targets -SourceItems $sourceItems -Settings $wizardSettings -IconPath (Join-Path $scriptDirectory 'assets\SamePathCopy.ico')
        Save-SamePathCopyWizardSettings -ConfigPath $resolvedConfigPath -Settings $wizardResult.Settings
        if (-not $wizardResult.Confirmed) { exit 0 }
        $wizardSettings = $wizardResult.Settings
    }
    $globalOptions = $wizardSettings.Global
    $targets = @($targets | Where-Object { [bool]$wizardSettings.Targets[[string]$_.id].Selected })
    if ($targets.Count -eq 0) {
        throw 'Sihirbazda hiçbir bilgisayar seçilmedi.'
    }
}

$backupStamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$plans = @(foreach ($target in $targets) {
    $targetId = [string]$target.id
    # Hedef başına parametreler sihirbazdan gelir; sihirbaz dışı çağrılarda hepsi kapalıdır (eski davranış).
    $targetOptions = if ($isWizard) { $wizardSettings.Targets[$targetId] } else { $null }
    $options = [pscustomobject]@{
        Backup = Get-SamePathCopyOptionValue -Options $targetOptions -Name 'Backup'
        OnlyNewer = Get-SamePathCopyOptionValue -Options $targetOptions -Name 'OnlyNewer'
        Mirror = Get-SamePathCopyOptionValue -Options $targetOptions -Name 'Mirror'
        DryRun = Get-SamePathCopyOptionValue -Options $globalOptions -Name 'DryRun'
        FastCopy = Get-SamePathCopyOptionValue -Options $globalOptions -Name 'FastCopy'
    }
    foreach ($sourceItem in $sourceItems) {
        # Kaynak hangi yerel kökün altındaysa göreli yol o köke göre hesaplanır; hiçbirinin altında değilse tam yol korunur.
        $matchedRoot = Get-SamePathCopyMatchingRoot -FullPath ([System.IO.Path]::GetFullPath($sourceItem.FullName)) -LocalRoots $localIdentity.Roots
        $destination = Get-SamePathCopyDestination -SourcePath $sourceItem.FullName -LocalRoots $localIdentity.Roots -Address ([string]$target.address) -NetworkRoot ([string]$target.networkRoot)
        [pscustomobject]@{
            SourceItem = $sourceItem
            IsDirectory = [bool]$sourceItem.PSIsContainer
            Target = $target
            MatchedRoot = $matchedRoot
            Destination = $destination
            Options = $options
            BackupPath = Get-SamePathCopyBackupPath -Destination $destination -Address ([string]$target.address) -NetworkRoot ([string]$target.networkRoot) -Stamp $backupStamp
        }
    }
})

function Get-SamePathCopyActiveOptionNames {
    param($Options)

    return @(@('Backup', 'OnlyNewer', 'Mirror', 'DryRun', 'FastCopy') |
        Where-Object { Get-SamePathCopyOptionValue -Options $Options -Name $_ })
}

if ($PlanOnly) {
    foreach ($plan in $plans) {
        [pscustomobject]@{
            Source = $plan.SourceItem.FullName
            LocalRoot = if ($plan.MatchedRoot) { $plan.MatchedRoot } else { '(kök dışı)' }
            LocalMachine = $localIdentity.Name
            Target = $plan.Target.name
            Destination = $plan.Destination
            Options = (@(Get-SamePathCopyActiveOptionNames -Options $plan.Options) -join ',')
        }
    }
    exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "{0} v{1}" -f ([string]$config.menuTitle), ([string]$config.version)
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(720, 430)
$form.MinimumSize = New-Object System.Drawing.Size(600, 350)
$form.TopMost = $false
$formIcon = $null
$iconPath = Join-Path $scriptDirectory 'assets\SamePathCopy.ico'
if (Test-Path -LiteralPath $iconPath -PathType Leaf) {
    $formIcon = New-Object System.Drawing.Icon($iconPath)
    $form.Icon = $formIcon
}

$sourceLabel = New-Object System.Windows.Forms.Label
$sourceLabel.AutoEllipsis = $true
$sourceLabel.Location = New-Object System.Drawing.Point(18, 18)
$sourceLabel.Size = New-Object System.Drawing.Size(670, 22)
$sourceLabel.Anchor = 'Top, Left, Right'
$sourceLabel.Text = if ($sourceItems.Count -eq 1) {
    "Kaynak: $($sourceItems[0].FullName)"
}
else {
    "Kaynaklar: $($sourceItems.Count) öğe (ilk: $($sourceItems[0].FullName))"
}
$form.Controls.Add($sourceLabel)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Location = New-Object System.Drawing.Point(18, 50)
$statusLabel.Size = New-Object System.Drawing.Size(670, 22)
$statusLabel.Anchor = 'Top, Left, Right'
$statusLabel.Text = "Yerel kök: $(@($localIdentity.Roots) -join ' ; ') | Sürüm: v$($config.version)"
$form.Controls.Add($statusLabel)

$progress = New-Object System.Windows.Forms.ProgressBar
$progress.Location = New-Object System.Drawing.Point(18, 78)
$progress.Size = New-Object System.Drawing.Size(670, 22)
$progress.Anchor = 'Top, Left, Right'
$progress.Minimum = 0
$progress.Maximum = $plans.Count
$form.Controls.Add($progress)

$resultBox = New-Object System.Windows.Forms.TextBox
$resultBox.Location = New-Object System.Drawing.Point(18, 112)
$resultBox.Size = New-Object System.Drawing.Size(670, 225)
$resultBox.Anchor = 'Top, Bottom, Left, Right'
$resultBox.Multiline = $true
$resultBox.ReadOnly = $true
$resultBox.ScrollBars = 'Vertical'
$resultBox.Font = New-Object System.Drawing.Font('Consolas', 9)
$form.Controls.Add($resultBox)

$closeButton = New-Object System.Windows.Forms.Button
$closeButton.Location = New-Object System.Drawing.Point(588, 348)
$closeButton.Size = New-Object System.Drawing.Size(100, 30)
$closeButton.Anchor = 'Bottom, Right'
$closeButton.Text = 'Kapat'
$closeButton.Enabled = $false
$closeButton.Add_Click({ $form.Close() })
$form.Controls.Add($closeButton)

$form.Add_Shown({
    $successCount = 0
    $failedCount = 0
    foreach ($plan in $plans) {
        $name = [string]$plan.Target.name
        $statusLabel.Text = "Kopyalanıyor: $name"
        $activeOptions = @(Get-SamePathCopyActiveOptionNames -Options $plan.Options)
        $optionText = if ($activeOptions.Count -gt 0) { " [$($activeOptions -join ', ')]" } else { '' }
        $resultBox.AppendText("[$name]$optionText $($plan.SourceItem.FullName) -> $($plan.Destination)`r`n")
        [System.Windows.Forms.Application]::DoEvents()
        try {
            if ((Get-SamePathCopyOptionValue -Options $plan.Options -Name 'Backup') -and -not (Get-SamePathCopyOptionValue -Options $plan.Options -Name 'DryRun')) {
                $backupResult = Invoke-SamePathCopyBackup -Destination $plan.Destination -BackupPath $plan.BackupPath -IsDirectory $plan.IsDirectory -RetryCount ([int]$config.copy.retryCount) -WaitSeconds ([int]$config.copy.waitSeconds) -Form $form
                if (-not $backupResult.Performed) {
                    $resultBox.AppendText("  YEDEK: hedefte önceki hâli yok, atlandı`r`n")
                }
                elseif ([int]$backupResult.ExitCode -le 7) {
                    $resultBox.AppendText("  YEDEK: $($backupResult.BackupPath)`r`n")
                }
                else {
                    throw "Yedek alınamadı (robocopy: $($backupResult.ExitCode)). Kopyalama yapılmadı: $($backupResult.BackupPath)"
                }
            }
            $copyResult = Invoke-Robocopy -Source $plan.SourceItem.FullName -Destination $plan.Destination -IsDirectory $plan.IsDirectory -RetryCount ([int]$config.copy.retryCount) -WaitSeconds ([int]$config.copy.waitSeconds) -Options $plan.Options -Form $form
            $exitCode = [int]$copyResult.ExitCode
            if ($exitCode -le 7) {
                $successCount++
                $resultBox.AppendText("  BAŞARILI (robocopy: $exitCode)`r`n")
            }
            else {
                $failedCount++
                $resultBox.AppendText("  HATA (robocopy: $exitCode)`r`n")
                if (-not [string]::IsNullOrWhiteSpace([string]$copyResult.Details)) {
                    foreach ($detailLine in ([string]$copyResult.Details -split "`r?`n")) {
                        $resultBox.AppendText("    $detailLine`r`n")
                    }
                }
            }
        }
        catch {
            $failedCount++
            $resultBox.AppendText("  HATA: $($_.Exception.Message)`r`n")
        }
        $progress.Value++
        [System.Windows.Forms.Application]::DoEvents()
    }

    if ($failedCount -eq 0) {
        $statusLabel.Text = "Tamamlandı: $successCount kopyalama başarılı."
    }
    else {
        $statusLabel.Text = "Tamamlandı: $successCount başarılı, $failedCount hatalı."
    }
    $closeButton.Enabled = $true
    $closeButton.Focus()
})

try {
    [void]$form.ShowDialog()
}
finally {
    if ($null -ne $formIcon) {
        $formIcon.Dispose()
    }
    $form.Dispose()
}
