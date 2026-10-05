# v8.1 字標：Windows 內建 System.Drawing；不需外部套件。
# Microsoft JhengHei Bold；黑底 #000000／白字 #FFFFFF。
# 字級以 PNG 邊長為基準：any/apple 36%，maskable 30%（像素單位）。
# GraphicsPath 依實際字形邊界居中，AntiAlias；maskable 的字形邊界須在中央半徑 40% 安全圓內。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) 'assets\icons'
New-Item -ItemType Directory -Path $iconDirectory -Force | Out-Null
$fontFamily = New-Object System.Drawing.FontFamily('Microsoft JhengHei')
try {
    foreach ($item in @(
        @{ Size = 180; Name = 'icon-180.png'; Ratio = 0.36 },
        @{ Size = 192; Name = 'icon-192.png'; Ratio = 0.36 },
        @{ Size = 512; Name = 'icon-512.png'; Ratio = 0.36 },
        @{ Size = 512; Name = 'icon-512-maskable.png'; Ratio = 0.30 }
    )) {
        $iconPath = Join-Path $iconDirectory $item.Name
        if (Test-Path -LiteralPath $iconPath) { throw "圖示已存在，停止產生：$iconPath" }
        $bitmap = New-Object System.Drawing.Bitmap($item.Size, $item.Size)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $glyph = New-Object System.Drawing.Drawing2D.GraphicsPath
        $matrix = New-Object System.Drawing.Drawing2D.Matrix
        try {
            $graphics.Clear([System.Drawing.Color]::Black)
            $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $glyph.AddString('三禾', $fontFamily, [int][System.Drawing.FontStyle]::Bold, [single]($item.Size * $item.Ratio), [System.Drawing.PointF]::Empty, [System.Drawing.StringFormat]::GenericTypographic)
            $bounds = $glyph.GetBounds()
            if ($item.Name -like '*maskable*' -and [Math]::Sqrt($bounds.Width * $bounds.Width + $bounds.Height * $bounds.Height) -gt $item.Size * 0.8) {
                throw '字形超出 maskable 安全圓'
            }
            $matrix.Translate([single](($item.Size - $bounds.Width) / 2 - $bounds.X), [single](($item.Size - $bounds.Height) / 2 - $bounds.Y))
            $glyph.Transform($matrix)
            $graphics.FillPath([System.Drawing.Brushes]::White, $glyph)
            $bitmap.Save($iconPath, [System.Drawing.Imaging.ImageFormat]::Png)
            Write-Output "$($item.Name): $($item.Size)x$($item.Size), font=$($fontFamily.Name) Bold, em=$($item.Size * $item.Ratio)px"
        } finally {
            $matrix.Dispose(); $glyph.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
        }
    }
} finally { $fontFamily.Dispose() }
