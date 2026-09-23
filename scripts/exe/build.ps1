# Builds mdga-installer.exe with the C# compiler that ships with Windows
# (.NET Framework 4.x), embedding install.ps1 as a resource.
#
#   powershell -File scripts/exe/build.ps1 [-Script path/to/install.ps1] [-Out path/to/mdga-installer.exe]
param(
  [string]$Script = (Join-Path $PSScriptRoot '..\install.ps1'),
  [string]$Out = (Join-Path $PSScriptRoot '..\..\dist\release\mdga-installer.exe')
)
$ErrorActionPreference = 'Stop'

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found at $csc" }

$Out = [IO.Path]::GetFullPath($Out)
New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null
$src = Join-Path $PSScriptRoot 'mdga-installer.cs'

& $csc /nologo /target:exe /optimize+ /platform:anycpu `
  "/out:$Out" "/resource:$([IO.Path]::GetFullPath($Script)),install.ps1" $src
if ($LASTEXITCODE -ne 0) { throw "csc failed with exit code $LASTEXITCODE" }
Write-Host ("built {0} ({1:N1} KB)" -f $Out, ((Get-Item $Out).Length / 1KB))
