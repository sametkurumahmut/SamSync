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
    <Style x:Key="InteractiveChip" TargetType="Border" BasedOn="{StaticResource Chip}">
        <Setter Property="Cursor" Value="Hand" />
        <Style.Triggers>
            <Trigger Property="IsMouseOver" Value="True">
                <Setter Property="Background" Value="{StaticResource RowHoverBrush}" />
                <Setter Property="BorderBrush" Value="{StaticResource BorderBrushStrong}" />
            </Trigger>
        </Style.Triggers>
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

    <Style x:Key="ModernComboBoxItem" TargetType="ComboBoxItem">
        <Setter Property="Foreground" Value="{StaticResource TextBrush}" />
        <Setter Property="FontSize" Value="12" />
        <Setter Property="Padding" Value="10,5,10,5" />
        <Setter Property="Template">
            <Setter.Value>
                <ControlTemplate TargetType="ComboBoxItem">
                    <Border x:Name="Face" Background="Transparent" CornerRadius="4" Padding="{TemplateBinding Padding}">
                        <ContentPresenter />
                    </Border>
                    <ControlTemplate.Triggers>
                        <Trigger Property="IsMouseOver" Value="True">
                            <Setter TargetName="Face" Property="Background" Value="{StaticResource RowHoverBrush}" />
                        </Trigger>
                        <Trigger Property="IsSelected" Value="True">
                            <Setter TargetName="Face" Property="Background" Value="{StaticResource RowHoverBrush}" />
                        </Trigger>
                    </ControlTemplate.Triggers>
                </ControlTemplate>
            </Setter.Value>
        </Setter>
    </Style>

    <Style x:Key="ModernComboBox" TargetType="ComboBox">
        <Setter Property="OverridesDefaultStyle" Value="True" />
        <Setter Property="Foreground" Value="{StaticResource TextBrush}" />
        <Setter Property="FontSize" Value="12" />
        <Setter Property="Height" Value="28" />
        <Setter Property="Cursor" Value="Hand" />
        <Setter Property="ItemContainerStyle" Value="{StaticResource ModernComboBoxItem}" />
        <Setter Property="Template">
            <Setter.Value>
                <ControlTemplate TargetType="ComboBox">
                    <Grid>
                        <ToggleButton x:Name="ToggleButton" Focusable="False" ClickMode="Press"
                                      IsChecked="{Binding IsDropDownOpen, Mode=TwoWay, RelativeSource={RelativeSource TemplatedParent}}">
                            <ToggleButton.Template>
                                <ControlTemplate TargetType="ToggleButton">
                                    <Border x:Name="Face" CornerRadius="6" Background="{StaticResource SurfaceAltBrush}"
                                            BorderBrush="{StaticResource BorderBrushStrong}" BorderThickness="1">
                                        <TextBlock Text="v" FontSize="10" HorizontalAlignment="Right" Margin="0,0,9,0"
                                                   VerticalAlignment="Center" Foreground="{StaticResource TextMutedBrush}" />
                                    </Border>
                                    <ControlTemplate.Triggers>
                                        <Trigger Property="IsMouseOver" Value="True">
                                            <Setter TargetName="Face" Property="BorderBrush" Value="{StaticResource AccentBrush}" />
                                        </Trigger>
                                    </ControlTemplate.Triggers>
                                </ControlTemplate>
                            </ToggleButton.Template>
                        </ToggleButton>
                        <ContentPresenter IsHitTestVisible="False" Content="{TemplateBinding SelectionBoxItem}"
                                          ContentTemplate="{TemplateBinding SelectionBoxItemTemplate}"
                                          Margin="10,0,26,0" VerticalAlignment="Center" HorizontalAlignment="Left" />
                        <Popup x:Name="Popup" Placement="Bottom" IsOpen="{TemplateBinding IsDropDownOpen}"
                               AllowsTransparency="True" Focusable="False" PopupAnimation="Fade">
                            <Border MinWidth="{TemplateBinding ActualWidth}" MaxHeight="260" Margin="0,2,0,0"
                                    Background="{StaticResource SurfaceBrush}" BorderBrush="{StaticResource BorderBrushSoft}"
                                    BorderThickness="1" CornerRadius="6" Padding="4">
                                <ScrollViewer VerticalScrollBarVisibility="Auto">
                                    <ItemsPresenter />
                                </ScrollViewer>
                            </Border>
                        </Popup>
                    </Grid>
                </ControlTemplate>
            </Setter.Value>
        </Setter>
    </Style>

    <Style x:Key="SearchBox" TargetType="TextBox">
        <Setter Property="Foreground" Value="{StaticResource TextBrush}" />
        <Setter Property="Background" Value="{StaticResource SurfaceAltBrush}" />
        <Setter Property="BorderBrush" Value="{StaticResource BorderBrushStrong}" />
        <Setter Property="CaretBrush" Value="{StaticResource TextBrush}" />
        <Setter Property="SelectionBrush" Value="{StaticResource AccentBrush}" />
        <Setter Property="FontSize" Value="12" />
        <Setter Property="Height" Value="28" />
        <Setter Property="Padding" Value="9,0,9,0" />
        <Setter Property="VerticalContentAlignment" Value="Center" />
        <Setter Property="Template">
            <Setter.Value>
                <ControlTemplate TargetType="TextBox">
                    <Border x:Name="Face" CornerRadius="6" Background="{TemplateBinding Background}"
                            BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="1">
                        <Grid>
                            <ScrollViewer x:Name="PART_ContentHost" Margin="{TemplateBinding Padding}"
                                          VerticalAlignment="Center" />
                            <!-- Yer tutucu metin Tag üzerinden verilir; kutu boşken görünür. -->
                            <TextBlock x:Name="Placeholder" Text="{TemplateBinding Tag}" Margin="{TemplateBinding Padding}"
                                       Foreground="{StaticResource TextMutedBrush}" FontSize="12"
                                       IsHitTestVisible="False" VerticalAlignment="Center" Visibility="Collapsed" />
                        </Grid>
                    </Border>
                    <ControlTemplate.Triggers>
                        <Trigger Property="Text" Value="">
                            <Setter TargetName="Placeholder" Property="Visibility" Value="Visible" />
                        </Trigger>
                        <Trigger Property="IsKeyboardFocused" Value="True">
                            <Setter TargetName="Face" Property="BorderBrush" Value="{StaticResource AccentBrush}" />
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

function New-SamePathCopyDetailChip {
    param(
        [Parameter(Mandatory = $true)]$Window,
        [Parameter(Mandatory = $true)][string]$Text,
        [string]$Title,
        [string]$Description,
        $Sections,
        [string]$ClipboardText,
        [string]$ClipboardLabel = 'Yolları panoya kopyala',
        [double]$MaxTextWidth = 320
    )

    # Uzun listeler ve uzun yollar çipin içine sığmıyor; çip yalnızca özeti gösterir, tıklandığında
    # kayan bir liste açar. Olay işleyicileri kapanış kullanmadan çalışsın diye gereken nesneler
    # denetimlerin Tag alanına konur: işleyici $sender.Tag üzerinden erişir.
    $chip = New-Object System.Windows.Controls.Border
    $chip.Style = $Window.FindResource('InteractiveChip')

    $chipPanel = New-Object System.Windows.Controls.StackPanel
    $chipPanel.Orientation = 'Horizontal'

    $chipText = New-Object System.Windows.Controls.TextBlock
    $chipText.Style = $Window.FindResource('MutedText')
    $chipText.Text = $Text
    $chipText.MaxWidth = $MaxTextWidth
    [void]$chipPanel.Children.Add($chipText)

    $chipGlyph = New-Object System.Windows.Controls.TextBlock
    $chipGlyph.Style = $Window.FindResource('MutedText')
    $chipGlyph.Text = ' ⌄'
    $chipGlyph.Margin = New-Object System.Windows.Thickness(4, 0, 0, 0)
    [void]$chipPanel.Children.Add($chipGlyph)

    $popup = New-Object System.Windows.Controls.Primitives.Popup
    $popup.PlacementTarget = $chip
    $popup.Placement = 'Bottom'
    $popup.StaysOpen = $false
    $popup.AllowsTransparency = $true
    $popup.HorizontalOffset = 0
    $popup.VerticalOffset = 4

    $card = New-Object System.Windows.Controls.Border
    $card.Style = $Window.FindResource('Card')
    $card.Background = $Window.FindResource('SurfaceBrush')
    $card.Padding = New-Object System.Windows.Thickness(14, 12, 14, 12)
    $card.MaxWidth = 640
    $card.MinWidth = 320

    $layout = New-Object System.Windows.Controls.DockPanel
    $layout.LastChildFill = $true

    if ($Title) {
        $titleText = New-Object System.Windows.Controls.TextBlock
        $titleText.Style = $Window.FindResource('SectionText')
        $titleText.Text = $Title
        [System.Windows.Controls.DockPanel]::SetDock($titleText, 'Top')
        [void]$layout.Children.Add($titleText)
    }
    if ($Description) {
        $descriptionText = New-Object System.Windows.Controls.TextBlock
        $descriptionText.Style = $Window.FindResource('MutedText')
        $descriptionText.Text = $Description
        $descriptionText.TextWrapping = 'Wrap'
        $descriptionText.TextTrimming = 'None'
        $descriptionText.Margin = New-Object System.Windows.Thickness(0, 4, 0, 8)
        [System.Windows.Controls.DockPanel]::SetDock($descriptionText, 'Top')
        [void]$layout.Children.Add($descriptionText)
    }
    if ($ClipboardText) {
        $copyButton = New-Object System.Windows.Controls.Button
        $copyButton.Style = $Window.FindResource('GhostButton')
        $copyButton.Content = $ClipboardLabel
        $copyButton.HorizontalAlignment = 'Left'
        $copyButton.Margin = New-Object System.Windows.Thickness(-10, 6, 0, 0)
        $copyButton.Tag = $ClipboardText
        $copyButton.Add_Click({
            param($sender, $eventArgs)
            try { [System.Windows.Clipboard]::SetText([string]$sender.Tag) } catch { }
        })
        [System.Windows.Controls.DockPanel]::SetDock($copyButton, 'Bottom')
        [void]$layout.Children.Add($copyButton)
    }

    $scroller = New-Object System.Windows.Controls.ScrollViewer
    $scroller.VerticalScrollBarVisibility = 'Auto'
    $scroller.HorizontalScrollBarVisibility = 'Disabled'
    $scroller.MaxHeight = 320
    $listPanel = New-Object System.Windows.Controls.StackPanel
    $scroller.Content = $listPanel
    [void]$layout.Children.Add($scroller)

    $sectionIndex = 0
    foreach ($section in @($Sections)) {
        if ($null -eq $section) { continue }
        $sectionHeader = [string]$section.Header
        if ($sectionHeader) {
            $headerPanel = New-Object System.Windows.Controls.StackPanel
            $headerPanel.Orientation = 'Horizontal'
            $headerPanel.Margin = New-Object System.Windows.Thickness(0, $(if ($sectionIndex -eq 0) { 0 } else { 10 }), 0, 2)

            $headerText = New-Object System.Windows.Controls.TextBlock
            $headerText.Style = $Window.FindResource('ColumnHeaderText')
            $headerText.Text = $sectionHeader
            $headerText.MaxWidth = 460
            $headerText.ToolTip = $sectionHeader
            # Dikkat çekmesi gereken bölümler (ör. yerel kök dışındaki öğeler) uyarı renginde yazılır.
            if ($section.PSObject.Properties['HeaderBrush'] -and [string]$section.HeaderBrush) {
                $headerText.Foreground = $Window.FindResource([string]$section.HeaderBrush)
            }
            [void]$headerPanel.Children.Add($headerText)

            if ($section.PSObject.Properties['Note'] -and [string]$section.Note) {
                $headerNote = New-Object System.Windows.Controls.TextBlock
                $headerNote.Style = $Window.FindResource('MutedText')
                $headerNote.Text = [string]$section.Note
                $headerNote.Margin = New-Object System.Windows.Thickness(8, 0, 0, 0)
                [void]$headerPanel.Children.Add($headerNote)
            }
            [void]$listPanel.Children.Add($headerPanel)
        }

        foreach ($entry in @($section.Items)) {
            if ($null -eq $entry) { continue }
            $rowPanel = New-Object System.Windows.Controls.StackPanel
            $rowPanel.Orientation = 'Horizontal'
            $rowPanel.Margin = New-Object System.Windows.Thickness($(if ($sectionHeader) { 12 } else { 0 }), 2, 0, 2)

            $rowText = New-Object System.Windows.Controls.TextBlock
            $rowText.Style = $Window.FindResource('BodyText')
            $rowText.Text = [string]$entry.Text
            $rowText.MaxWidth = 460
            [void]$rowPanel.Children.Add($rowText)

            if ($entry.PSObject.Properties['Note'] -and [string]$entry.Note) {
                $rowNote = New-Object System.Windows.Controls.TextBlock
                $rowNote.Style = $Window.FindResource('MutedText')
                $rowNote.Text = [string]$entry.Note
                $rowNote.Margin = New-Object System.Windows.Thickness(8, 0, 0, 0)
                [void]$rowPanel.Children.Add($rowNote)
            }
            if ($entry.PSObject.Properties['ToolTip'] -and [string]$entry.ToolTip) {
                $rowPanel.ToolTip = [string]$entry.ToolTip
            }
            [void]$listPanel.Children.Add($rowPanel)
        }
        $sectionIndex++
    }

    $card.Child = $layout
    $popup.Child = $card
    [void]$chipPanel.Children.Add($popup)

    $chip.Child = $chipPanel
    $chip.ToolTip = 'Ayrıntılı liste için tıklayın.'
    $chip.Tag = $popup
    $chip.Add_MouseLeftButtonUp({
        param($sender, $eventArgs)
        $sender.Tag.IsOpen = -not [bool]$sender.Tag.IsOpen
    })
    return $chip
}

function New-SamePathCopySourceChip {
    param(
        [Parameter(Mandatory = $true)]$Window,
        [Parameter(Mandatory = $true)]$Summary
    )

    # Kaynak listesi, öğelerin hedefte oluşacak göreli yoluyla gösterilir: kullanıcı hangi dosyanın
    # nereye gideceğini çipe tıklayarak görür. Klasörler yol sonundaki "\" ile ayırt edilir.
    $sections = @(foreach ($group in @($Summary.Groups)) {
        $items = @(foreach ($entry in @($group.Items)) {
            $displayPath = if ([string]::IsNullOrWhiteSpace([string]$entry.RelativePath)) {
                '(kökün kendisi)'
            }
            elseif ([bool]$entry.IsDirectory) { "{0}\" -f [string]$entry.RelativePath }
            else { [string]$entry.RelativePath }
            [pscustomobject]@{
                Text = $displayPath
                Note = $(if ([bool]$entry.IsDirectory) { 'klasör' } else { '' })
                ToolTip = [string]$entry.FullPath
            }
        })
        if ([int]$group.HiddenCount -gt 0) {
            $items += [pscustomobject]@{
                Text = "... ve {0} öğe daha" -f [int]$group.HiddenCount
                Note = ''
                ToolTip = 'Tam liste için "Yolları panoya kopyala" düğmesini kullanın.'
            }
        }
        [pscustomobject]@{
            Header = [string]$group.Header
            Note = "{0} öğe" -f [int]$group.ItemCount
            HeaderBrush = $(if ([bool]$group.IsInsideLocalRoot) { '' } else { 'WarningBrush' })
            Items = $items
        }
    })

    return New-SamePathCopyDetailChip -Window $Window -Text ([string]$Summary.ChipText) `
        -Title ("Kopyalanacak öğeler - {0}" -f [string]$Summary.KindText) `
        -Description 'Yollar yerel köke göre gösteriliyor; hedefte aynı göreli yol oluşturulur.' `
        -Sections $sections -ClipboardText ([string]$Summary.ClipboardText)
}

function New-SamePathCopyLocalRootChip {
    param(
        [Parameter(Mandatory = $true)]$Window,
        [Parameter(Mandatory = $true)]$Summary
    )

    # Birden çok kök tanımlıyken çipe hepsi sığmıyor ve yol yarıda kesiliyordu; çip artık kök sayısını
    # gösterip tam listeyi açılır pencerede veriyor. Her kökün yanında seçimden kaç öğe düştüğü yazar.
    $items = @(foreach ($root in @($Summary.Roots)) {
        [pscustomobject]@{
            Text = [string]$root.Path
            Note = $(if ([int]$root.ItemCount -gt 0) { "{0} öğe" -f [int]$root.ItemCount } else { 'seçimde yok' })
            ToolTip = [string]$root.Path
        }
    })
    if (@($items).Count -eq 0) {
        $items = @([pscustomobject]@{ Text = 'Bu bilgisayar için yerel kök tanımlı değil.'; Note = ''; ToolTip = '' })
    }
    $sections = @([pscustomobject]@{ Header = ''; Note = ''; Items = $items })
    if ([int]$Summary.OutsideRootCount -gt 0) {
        $sections += [pscustomobject]@{
            Header = 'Yerel kök dışında'
            Note = "{0} öğe" -f [int]$Summary.OutsideRootCount
            HeaderBrush = 'WarningBrush'
            Items = @([pscustomobject]@{
                Text = 'Sürücü harfi klasör adına çevrilerek kopyalanır (C:\Gecici\a.txt -> C\Gecici\a.txt).'
                Note = ''
                ToolTip = ''
            })
        }
    }

    return New-SamePathCopyDetailChip -Window $Window -Text ([string]$Summary.RootChipText) `
        -Title 'Yerel kökler' `
        -Description 'Kopyalama, öğenin bulunduğu kökten sonraki yolu hedefte aynen oluşturur.' `
        -Sections $sections -ClipboardText (@(@($Summary.Roots) | ForEach-Object { [string]$_.Path }) -join "`r`n") `
        -ClipboardLabel 'Kökleri panoya kopyala' -MaxTextWidth 420
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

function Show-SamePathCopyPrompt {
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [Parameter(Mandatory = $true)][string]$Message,
        [string]$DefaultText = '',
        [string]$Placeholder = '',
        [string]$ConfirmText = 'Kaydet',
        [string]$CancelText = 'Vazgec',
        $Owner,
        [string]$IconPath
    )

    # Tek satirlik metin sorar; vazgecilirse $null doner. Profil adi gibi kisa girdiler icin kullanilir.
    $body = @'
    <Grid Margin="24">
        <Grid.RowDefinitions>
            <RowDefinition Height="Auto" />
            <RowDefinition Height="Auto" />
            <RowDefinition Height="Auto" />
            <RowDefinition Height="Auto" />
        </Grid.RowDefinitions>
        <TextBlock x:Name="HeaderText" Style="{StaticResource TitleText}" FontSize="16" TextWrapping="Wrap" />
        <TextBlock x:Name="MessageText" Grid.Row="1" Style="{StaticResource SubtitleText}" Margin="0,10,0,0"
                   TextWrapping="Wrap" TextTrimming="None" />
        <TextBox x:Name="InputBox" Grid.Row="2" Style="{StaticResource SearchBox}" Margin="0,14,0,0" Height="30" />
        <StackPanel Grid.Row="3" Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,18,0,0">
            <Button x:Name="CancelButton" Style="{StaticResource SecondaryButton}" Margin="0,0,10,0" />
            <Button x:Name="ConfirmButton" Style="{StaticResource PrimaryButton}" />
        </StackPanel>
    </Grid>
'@

    $script:samePathCopyPromptWindow = New-SamePathCopyWindow -Title $Title -BodyXaml $body -Width 520 -Height 270 -MinWidth 420 -MinHeight 240 -IconPath $IconPath
    $window = $script:samePathCopyPromptWindow
    $window.ResizeMode = 'NoResize'
    $window.FindName('HeaderText').Text = $Title
    $window.FindName('MessageText').Text = $Message
    $script:samePathCopyPromptBox = $window.FindName('InputBox')
    $script:samePathCopyPromptBox.Text = $DefaultText
    $script:samePathCopyPromptBox.Tag = $Placeholder
    $script:samePathCopyPromptBox.SelectAll()
    $confirmButton = $window.FindName('ConfirmButton')
    $cancelButton = $window.FindName('CancelButton')
    $confirmButton.Content = $ConfirmText
    $cancelButton.Content = $CancelText
    if ($Owner) { $window.Owner = $Owner }

    $confirmButton.Add_Click({ $script:samePathCopyPromptWindow.DialogResult = $true })
    $cancelButton.Add_Click({ $script:samePathCopyPromptWindow.DialogResult = $false })
    # Enter kaydeder, Esc vazgecer.
    $script:samePathCopyPromptBox.Add_KeyDown({
        param($sender, $eventArgs)
        if ($eventArgs.Key -eq 'Return') { $script:samePathCopyPromptWindow.DialogResult = $true }
        elseif ($eventArgs.Key -eq 'Escape') { $script:samePathCopyPromptWindow.DialogResult = $false }
    })
    $window.Add_ContentRendered({ [void]$script:samePathCopyPromptBox.Focus() })

    if ($window.ShowDialog() -ne $true) { return $null }
    $value = [string]$script:samePathCopyPromptBox.Text
    if ([string]::IsNullOrWhiteSpace($value)) { return $null }
    return $value.Trim()
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
