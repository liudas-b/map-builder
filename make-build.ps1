# Zips the shareable Map Builder files into builds\MapBuilder-<timestamp>.zip.
# Skips zipping when nothing changed since the newest existing zip (use -Force to zip anyway).
param([switch]$Force)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$builds = Join-Path $root 'builds'
New-Item -ItemType Directory -Force $builds | Out-Null

$items = @('MapBuilder.exe', 'server.py', 'start-map-builder.bat', 'README.md',
           'public', 'TextureAssets', 'saves') |
  ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path $_ }
if (-not $items) { exit 0 }

$newest = ($items | Get-ChildItem -Recurse -File -ErrorAction SilentlyContinue |
  Measure-Object -Property LastWriteTimeUtc -Maximum).Maximum

$lastZip = Get-ChildItem $builds -Filter *.zip -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if (-not $Force -and $lastZip -and $newest -le $lastZip.LastWriteTimeUtc) {
  Write-Output "No changes since $($lastZip.Name) - skipping."
  exit 0
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$zip = Join-Path $builds "MapBuilder-$stamp.zip"
Compress-Archive -Path $items -DestinationPath $zip -CompressionLevel Optimal
Write-Output "Created builds\MapBuilder-$stamp.zip"
