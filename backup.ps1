$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dir = Join-Path $PSScriptRoot "backups"
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$out = Join-Path $dir "project-os-$stamp.zip"
$snapshot = Join-Path $PSScriptRoot "data\backup-snapshot.db"

try {
  node --no-warnings scripts/backup-db.mjs $snapshot | Out-Null

  $paths = @(
    "data\backup-snapshot.db",
    "data\uploads",
    "projects",
    "lib",
    "public",
    "server.mjs",
    "cli.mjs",
    "package.json",
    "README.md",
    "start.cmd",
    "start.ps1"
  ) | Where-Object { Test-Path (Join-Path $PSScriptRoot $_) }

  Compress-Archive -Path ($paths | ForEach-Object { Join-Path $PSScriptRoot $_ }) -DestinationPath $out -Force
  Get-Item $out | Select-Object FullName, Length, LastWriteTime
} finally {
  Remove-Item $snapshot, "$snapshot-wal", "$snapshot-shm" -Force -ErrorAction SilentlyContinue
}
