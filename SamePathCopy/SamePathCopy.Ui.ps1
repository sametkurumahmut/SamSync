Set-StrictMode -Version 2.0

# Arayüz WPF ile kurulur: WinForms ile modern görünüm (yuvarlatılmış köşeler, tema renkleri, özel denetim şablonları)
# mümkün değil. Pencereler XAML metninden üretilir; renkler sistem temasına ve Windows vurgu rengine göre değişir.
function Assert-SamePathCopyUiReady {
    if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
        throw 'Arayüz için PowerShell STA kipinde çalışmalı. Betiği powershell.exe -sta ile çağırın.'
    }
    Add-Type -AssemblyName PresentationFramework
    Add-Type -AssemblyName PresentationCore
    Add-Type -AssemblyName WindowsBase
}

function Get-SamePathCopyAccentColor {
    try {
        $accent = (Get-ItemProperty 'HKCU:\SOFTWARE\Microsoft\Windows\DWM' -Name AccentColor -ErrorAction Stop).AccentColor
        $value = [uint32]$accent
        # Kayıt değeri ABGR düzeninde tutulur.
        $r = $value -band 0xFF
        $g = ($value -shr 8) -band 0xFF
        $b = ($value -shr 16) -band 0xFF
        # Beyaz yazının okunabilmesi için çok açık vurgu renkleri kullanılmaz.
        $luminance = (0.299 * $r + 0.587 * $g + 0.114 * $b) / 255
        if ($luminance -gt 0.62) { return '#0067C0' }
        return ('#{0:X2}{1:X2}{2:X2}' -f $r, $g, $b)
    }
    catch {
        return '#0067C0'
    }
}

function Get-SamePathCopyTheme {
    $isLight = $true
    try {
        $value = (Get-ItemProperty 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Themes\Personalize' -Name AppsUseLightTheme -ErrorAction Stop).AppsUseLightTheme
        $isLight = ([int]$value -ne 0)
    }
    catch {
        $isLight = $true
    }

    $accent = Get-SamePathCopyAccentColor
    if ($isLight) {
        return @{
            Accent = $accent
            AccentText = '#FFFFFF'
            Background = '#F3F3F3'
            Surface = '#FFFFFF'
            SurfaceAlt = '#FAFAFA'
            RowHover = '#F0F0F0'
            Border = '#E4E4E4'
            BorderStrong = '#C8C8C8'
            Track = '#E6E6E6'
            Text = '#1B1B1B'
            TextMuted = '#5F5F5F'
            Success = '#0F7B0F'
            Danger = '#C42B1C'
            Warning = '#8A5300'
        }
    }
    return @{
        Accent = $accent
        AccentText = '#FFFFFF'
        Background = '#1F1F1F'
        Surface = '#2A2A2A'
        SurfaceAlt = '#303030'
        RowHover = '#3A3A3A'
        Border = '#3D3D3D'
        BorderStrong = '#575757'
        Track = '#3A3A3A'
        Text = '#F5F5F5'
        TextMuted = '#A6A6A6'
        Success = '#6CCB5F'
        Danger = '#FF99A4'
        Warning = '#FCE100'
    }
}

function Get-SamePathCopyThemeXaml {
    $resources = @'
    <SolidColorBrush x:Key="AccentBrush" Color="%%Accent%%" />
    <SolidColorBrush x:Key="AccentTextBrush" Color="%%AccentText%%" />
    <SolidColorBrush x:Key="BackgroundBrush" Color="%%Background%%" />
    <SolidColorBrush x:Key="SurfaceBrush" Color="%%Surface%%" />
    <SolidColorBrush x:Key="SurfaceAltBrush" Color="%%SurfaceAlt%%" />
    <SolidColorBrush x:Key="RowHoverBrush" Color="%%RowHover%%" />
    <SolidColorBrush x:Key="BorderBrushSoft" Color="%%Border%%" />
    <SolidColorBrush x:Key="BorderBrushStrong" Color="%%BorderStrong%%" />
    <SolidColorBrush x:Key="TrackBrush" Color="%%Track%%" />
    <SolidColorBrush x:Key="TextBrush" Color="%%Text%%" />
    <SolidColorBrush x:Key="TextMutedBrush" Color="%%TextMuted%%" />
    <SolidColorBrush x:Key="SuccessBrush" Color="%%Success%%" />
    <SolidColorBrush x:Key="DangerBrush" Color="%%Danger%%" />
    <SolidColorBrush x:Key="WarningBrush" Color="%%Warning%%" />

    <Style x:Key="TitleText" TargetType="TextBlock">
        <Setter Property="FontSize" Value="19" />
        <Setter Property="FontWeight" Value="SemiBold" />
        <Setter Property="Foreground" Value="{StaticResource TextBrush}" />
        <Setter Property="TextTrimming" Value="CharacterEllipsis" />
    </Style>
    <Style x:Key="SubtitleText" TargetType="TextBlock">
        <Setter Property="FontSize" Value="12" />
        <Setter Property="Foreground" Value="{StaticResource TextMutedBrush}" />
        <Setter Property="TextTrimming" Value="CharacterEllipsis" />
    </Style>
    <Style x:Key="SectionText" TargetType="TextBlock">
        <Setter Property="FontSize" Value="13" />
        <Setter Property="FontWeight" Value="SemiBold" />
        <Setter Property="Foreground" Value="{StaticResource TextBrush}" />
    </Style>
    <Style x:Key="BodyText" TargetType="TextBlock">
        <Setter Property="FontSize" Value="12" />
        <Setter Property="Foreground" Value="{StaticResource TextBrush}" />
        <Setter Property="TextTrimming" Value="CharacterEllipsis" />
        <Setter Property="VerticalAlignment" Value="Center" />
    </Style>
    <Style x:Key="MutedText" TargetType="TextBlock">
        <Setter Property="FontSize" Value="11" />
        <Setter Property="Foreground" Value="{StaticResource TextMutedBrush}" />
        <Setter Property="TextTrimming" Value="CharacterEllipsis" />
        <Setter Property="VerticalAlignment" Value="Center" />
    </Style>
    <Style x:Key="ColumnHeaderText" TargetType="TextBlock">
        <Setter Property="FontSize" Value="11" />
        <Setter Property="FontWeight" Value="SemiBold" />
        <Setter Property="Foreground" Value="{StaticResource TextMutedBrush}" />
        <Setter Property="VerticalAlignment" Value="Center" />
    </Style>

    <Style x:Key="Card" TargetType="Border">
        <Setter Property="Background" Value="{StaticResource SurfaceBrush}" />
        <Setter Property="BorderBrush" Value="{StaticResource BorderBrushSoft}" />
        <Setter Property="BorderThickness" Value="1" />
        <Setter Property="CornerRadius" Value="8" />
    </Style>
    <Style x:Key="Chip" TargetType="Border">
        <Setter Property="Background" Value="{StaticResource SurfaceAltBrush}" />
        <Setter Property="BorderBrush" Value="{StaticResource BorderBrushSoft}" />
        <Setter Property="BorderThickness" Value="1" />
        <Setter Property="CornerRadius" Value="11" />
        <Setter Property="Padding" Value="10,3,10,3" />
        <Setter Property="Margin" Value="0,0,8,0" />
    </Style>
    <Style x:Key="RowBorder" TargetType="Border">
        <Setter Property="Background" Value="Transparent" />
        <Setter Property="CornerRadius" Value="6" />
        <Style.Triggers>
            <Trigger Property="IsMouseOver" Value="True">
                <Setter Property="Background" Value="{StaticResource RowHoverBrush}" />
            </Trigger>
        </Style.Triggers>
    </Style>

    <Style x:Key="PrimaryButton" TargetType="Button">
        <Setter Property="Foreground" Value="{StaticResource AccentTextBrush}" />
        <Setter Property="FontSize" Value="12" />
        <Setter Property="Cursor" Value="Hand" />
        <Setter Property="MinWidth" Value="104" />
        <Setter Property="Height" Value="32" />
        <Setter Property="Template">
            <Setter.Value>
                <ControlTemplate TargetType="Button">
                    <Border x:Name="Face" CornerRadius="6" Background="{StaticResource AccentBrush}" Padding="16,0,16,0">
                        <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center" />
                    </Border>
                    <ControlTemplate.Triggers>
                        <Trigger Property="IsMouseOver" Value="True">
                            <Setter TargetName="Face" Property="Opacity" Value="0.88" />
                        </Trigger>
                        <Trigger Property="IsPressed" Value="True">
                            <Setter TargetName="Face" Property="Opacity" Value="0.74" />
                        </Trigger>
                        <Trigger Property="IsEnabled" Value="False">
                            <Setter TargetName="Face" Property="Background" Value="{StaticResource TrackBrush}" />
                            <Setter Property="Foreground" Value="{StaticResource TextMutedBrush}" />
                        </Trigger>
                    </ControlTemplate.Triggers>
                </ControlTemplate>
            </Setter.Value>
        </Setter>
    </Style>
    <Style x:Key="SecondaryButton" TargetType="Button">
        <Setter Property="Foreground" Value="{StaticResource TextBrush}" />
        <Setter Property="FontSize" Value="12" />
        <Setter Property="Cursor" Value="Hand" />
        <Setter Property="MinWidth" Value="104" />
        <Setter Property="Height" Value="32" />
        <Setter Property="Template">
            <Setter.Value>
                <ControlTemplate TargetType="Button">
                    <Border x:Name="Face" CornerRadius="6" Background="{StaticResource SurfaceBrush}"
                            BorderBrush="{StaticResource BorderBrushStrong}" BorderThickness="1" Padding="16,0,16,0">
                        <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center" />
                    </Border>
                    <ControlTemplate.Triggers>
                        <Trigger Property="IsMouseOver" Value="True">
                            <Setter TargetName="Face" Property="Background" Value="{StaticResource RowHoverBrush}" />
                        </Trigger>
                        <Trigger Property="IsEnabled" Value="False">
                            <Setter Property="Foreground" Value="{StaticResource TextMutedBrush}" />
                            <Setter TargetName="Face" Property="Opacity" Value="0.6" />
                        </Trigger>
                    </ControlTemplate.Triggers>
                </ControlTemplate>
            </Setter.Value>
        </Setter>
    </Style>
    <Style x:Key="GhostButton" TargetType="Button">
        <Setter Property="Foreground" Value="{StaticResource AccentBrush}" />
        <Setter Property="FontSize" Value="12" />
        <Setter Property="Cursor" Value="Hand" />
        <Setter Property="Height" Value="28" />
        <Setter Property="Template">
            <Setter.Value>
                <ControlTemplate TargetType="Button">
                    <Border x:Name="Face" CornerRadius="6" Background="Transparent" Padding="10,0,10,0">
                        <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center" />
                    </Border>
                    <ControlTemplate.Triggers>
                        <Trigger Property="IsMouseOver" Value="True">
                            <Setter TargetName="Face" Property="Background" Value="{StaticResource RowHoverBrush}" />
                        </Trigger>
                    </ControlTemplate.Triggers>
                </ControlTemplate>
            </Setter.Value>
        </Setter>
    </Style>

    <Style x:Key="IconButton" TargetType="Button">
        <Setter Property="Foreground" Value="{StaticResource TextMutedBrush}" />
        <Setter Property="FontSize" Value="13" />
        <Setter Property="Cursor" Value="Hand" />
        <Setter Property="Width" Value="22" />
        <Setter Property="Height" Value="20" />
        <Setter Property="Margin" Value="1,0,1,0" />
        <Setter Property="Template">
            <Setter.Value>
                <ControlTemplate TargetType="Button">
                    <Border x:Name="Face" CornerRadius="4" Background="Transparent">
                        <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center" />
                    </Border>
                    <ControlTemplate.Triggers>
                        <Trigger Property="IsMouseOver" Value="True">
                            <Setter TargetName="Face" Property="Background" Value="{StaticResource RowHoverBrush}" />
                            <Setter Property="Foreground" Value="{StaticResource AccentBrush}" />
                        </Trigger>
                        <Trigger Property="IsPressed" Value="True">
                            <Setter TargetName="Face" Property="Opacity" Value="0.7" />
                        </Trigger>
                    </ControlTemplate.Triggers>
                </ControlTemplate>
            </Setter.Value>
        </Setter>
    </Style>

    <Style x:Key="ModernCheckBox" TargetType="CheckBox">
        <Setter Property="Foreground" Value="{StaticResource TextBrush}" />
        <Setter Property="FontSize" Value="12" />
        <Setter Property="Cursor" Value="Hand" />
        <Setter Property="VerticalContentAlignment" Value="Center" />
        <Setter Property="Template">
            <Setter.Value>
                <ControlTemplate TargetType="CheckBox">
                    <StackPanel Orientation="Horizontal" Background="Transparent">
                        <Border x:Name="Box" Width="18" Height="18" CornerRadius="4" BorderThickness="1"
                                BorderBrush="{StaticResource BorderBrushStrong}" Background="{StaticResource SurfaceBrush}">
                            <Path x:Name="Check" Width="12" Height="12" Stretch="Uniform"
                                  Data="M 1,5.4 L 4.6,9 L 11,1.6" Stroke="{StaticResource AccentTextBrush}"
                                  StrokeThickness="1.8" StrokeStartLineCap="Round" StrokeEndLineCap="Round"
                                  Visibility="Collapsed" />
                        </Border>
                        <ContentPresenter x:Name="Label" Margin="8,0,0,0" VerticalAlignment="Center" />
                    </StackPanel>
                    <ControlTemplate.Triggers>
                        <Trigger Property="IsChecked" Value="True">
                            <Setter TargetName="Box" Property="Background" Value="{StaticResource AccentBrush}" />
                            <Setter TargetName="Box" Property="BorderBrush" Value="{StaticResource AccentBrush}" />
                            <Setter TargetName="Check" Property="Visibility" Value="Visible" />
                        </Trigger>
                        <Trigger Property="IsMouseOver" Value="True">
                            <Setter TargetName="Box" Property="BorderBrush" Value="{StaticResource AccentBrush}" />
                        </Trigger>
                        <Trigger Property="IsEnabled" Value="False">
                            <Setter Property="Opacity" Value="0.5" />
                        </Trigger>
                    </ControlTemplate.Triggers>
                </ControlTemplate>
            </Setter.Value>
        </Setter>
    </Style>

    <Style x:Key="ModernProgressBar" TargetType="ProgressBar">
        <Setter Property="Height" Value="6" />
        <Setter Property="Template">
            <Setter.Value>
                <ControlTemplate TargetType="ProgressBar">
                    <Border CornerRadius="3" Background="{StaticResource TrackBrush}" ClipToBounds="True">
                        <Grid>
                            <Border x:Name="PART_Track" />
                            <Border x:Name="PART_Indicator" CornerRadius="3" HorizontalAlignment="Left"
                                    Background="{StaticResource AccentBrush}" />
                        </Grid>
                    </Border>
                </ControlTemplate>
            </Setter.Value>
        </Setter>
    </Style>

    <Style TargetType="ScrollBar">
        <Setter Property="Width" Value="10" />
        <Setter Property="Background" Value="Transparent" />
        <Setter Property="Template">
            <Setter.Value>
                <ControlTemplate TargetType="ScrollBar">
                    <Grid Background="Transparent">
                        <Track x:Name="PART_Track" IsDirectionReversed="True">
                            <Track.Thumb>
                                <Thumb>
                                    <Thumb.Template>
                                        <ControlTemplate TargetType="Thumb">
                                            <Border CornerRadius="4" Background="{StaticResource BorderBrushStrong}"
                                                    Width="6" HorizontalAlignment="Center" Opacity="0.8" />
                                        </ControlTemplate>
                                    </Thumb.Template>
                                </Thumb>
                            </Track.Thumb>
                        </Track>
                    </Grid>
                </ControlTemplate>
            </Setter.Value>
        </Setter>
    </Style>
'@

    $theme = Get-SamePathCopyTheme
    foreach ($key in @($theme.Keys)) {
        $resources = $resources.Replace("%%$key%%", [string]$theme[$key])
    }
    return $resources
}

function New-SamePathCopyWindow {
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [Parameter(Mandatory = $true)][string]$BodyXaml,
        [Parameter(Mandatory = $true)][int]$Width,
        [Parameter(Mandatory = $true)][int]$Height,
        [int]$MinWidth = 640,
        [int]$MinHeight = 420,
        [string]$IconPath
    )

    Assert-SamePathCopyUiReady
    $template = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="%%TITLE%%" Width="%%WIDTH%%" Height="%%HEIGHT%%" MinWidth="%%MINWIDTH%%" MinHeight="%%MINHEIGHT%%"
        WindowStartupLocation="CenterScreen" Background="{DynamicResource BackgroundBrush}"
        FontFamily="Segoe UI Variable Text, Segoe UI" TextOptions.TextFormattingMode="Display"
        SnapsToDevicePixels="True" UseLayoutRounding="True">
    <Window.Resources>
%%RESOURCES%%
    </Window.Resources>
%%BODY%%
</Window>
'@

    $xaml = $template.
        Replace('%%TITLE%%', [System.Security.SecurityElement]::Escape($Title)).
        Replace('%%WIDTH%%', [string]$Width).
        Replace('%%HEIGHT%%', [string]$Height).
        Replace('%%MINWIDTH%%', [string]$MinWidth).
        Replace('%%MINHEIGHT%%', [string]$MinHeight).
        Replace('%%RESOURCES%%', (Get-SamePathCopyThemeXaml)).
        Replace('%%BODY%%', $BodyXaml)

    $window = [Windows.Markup.XamlReader]::Parse($xaml)
    if ($IconPath -and (Test-Path -LiteralPath $IconPath -PathType Leaf)) {
        try {
            $window.Icon = New-Object System.Windows.Media.Imaging.BitmapImage (New-Object System.Uri($IconPath))
        }
        catch {
            # Simge yüklenemezse pencere varsayılan simgeyle açılır.
        }
    }
    return $window
}

function Invoke-SamePathCopyUiPump {
    # WPF'nin DoEvents karşılığı: uzun süren kopyalama döngüsünde pencerenin yanıt vermesini sağlar.
    $frame = New-Object System.Windows.Threading.DispatcherFrame
    [void][System.Windows.Threading.Dispatcher]::CurrentDispatcher.BeginInvoke(
        [System.Windows.Threading.DispatcherPriority]::Background,
        [System.Windows.Threading.DispatcherOperationCallback] { param($state) $state.Continue = $false; return $null },
        $frame)
    [System.Windows.Threading.Dispatcher]::PushFrame($frame)
}

function Show-SamePathCopyConfirm {
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [Parameter(Mandatory = $true)][string]$Message,
        [string]$ConfirmText = 'Devam et',
        [string]$CancelText = 'Vazgeç',
        $Owner,
        [string]$IconPath
    )

    $body = @'
    <Grid Margin="24">
        <Grid.RowDefinitions>
            <RowDefinition Height="Auto" />
            <RowDefinition Height="*" />
            <RowDefinition Height="Auto" />
        </Grid.RowDefinitions>
        <TextBlock x:Name="HeaderText" Style="{StaticResource TitleText}" FontSize="16" TextWrapping="Wrap" />
        <TextBlock x:Name="MessageText" Grid.Row="1" Style="{StaticResource SubtitleText}" Margin="0,10,0,0"
                   TextWrapping="Wrap" TextTrimming="None" />
        <StackPanel Grid.Row="2" Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,18,0,0">
            <Button x:Name="CancelButton" Style="{StaticResource SecondaryButton}" Margin="0,0,10,0" />
            <Button x:Name="ConfirmButton" Style="{StaticResource PrimaryButton}" />
        </StackPanel>
    </Grid>
'@

    # Olay işleyicileri betik kapsamındaki değişkenleri görür; kapanış (GetNewClosure) kullanılmaz,
    # çünkü kapanışlar ayrı bir modül kapsamına bağlanır ve betikteki fonksiyonlara erişemez.
    $script:samePathCopyConfirmWindow = New-SamePathCopyWindow -Title $Title -BodyXaml $body -Width 520 -Height 260 -MinWidth 420 -MinHeight 220 -IconPath $IconPath
    $window = $script:samePathCopyConfirmWindow
    $window.ResizeMode = 'NoResize'
    $window.FindName('HeaderText').Text = $Title
    $window.FindName('MessageText').Text = $Message
    $confirmButton = $window.FindName('ConfirmButton')
    $cancelButton = $window.FindName('CancelButton')
    $confirmButton.Content = $ConfirmText
    $cancelButton.Content = $CancelText
    if ($Owner) { $window.Owner = $Owner }

    $confirmButton.Add_Click({ $script:samePathCopyConfirmWindow.DialogResult = $true })
    $cancelButton.Add_Click({ $script:samePathCopyConfirmWindow.DialogResult = $false })
    return [bool]($window.ShowDialog() -eq $true)
}
