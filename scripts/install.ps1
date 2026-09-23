# mdga installer for Windows.
#
#   irm https://github.com/BxdiS/mdga/releases/latest/download/install.ps1 | iex
#
# Downloads the release payload, lets you pick modules, and patches Discord's
# app.asar in place: our files are appended after Discord's data and the
# archive header is rewritten, so Discord's own bytes are copied unchanged.
# The untouched original is kept as app.asar.orig for uninstall and reinstall.
#
# Works in Windows PowerShell 5.1 and PowerShell 7. Nothing leaves the
# machine except the payload download from GitHub.
#
# Environment overrides (for testing and scripted use):
#   MDGA_PAYLOAD       path or URL of mdga-payload.json
#   MDGA_LOCALAPPDATA  where to look for Discord instead of %LOCALAPPDATA%
#   MDGA_ACTION        install | uninstall   (skips the menu)
#   MDGA_MODULES       comma-separated module ids to enable (skips the picker)
#   MDGA_NO_RESTART    1 = do not stop or start Discord

function Invoke-Mdga {
  $ErrorActionPreference = 'Stop'
  $Repo = 'BxdiS/mdga'
  $Utf8 = New-Object System.Text.UTF8Encoding $false
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

  $Interactive = $true
  try { $null = [Console]::KeyAvailable } catch { $Interactive = $false }

  # ---------------------------------------------------------------- output

  function Say($text, $color) {
    if ($color) { Write-Host $text -ForegroundColor $color } else { Write-Host $text }
  }
  function Fail($text) { Say "  x $text" Red; throw "mdga: $text" }

  # ------------------------------------------------------------------ menus

  # Single choice with arrow keys + Enter. Returns the index.
  function Select-One($title, [string[]]$items) {
    $i = 0
    while ($true) {
      Clear-Host
      Say "mdga - Make Discord Great Again" Cyan
      Say ""
      Say $title
      Say ""
      for ($n = 0; $n -lt $items.Count; $n++) {
        if ($n -eq $i) { Say ("  > " + $items[$n]) Green } else { Say ("    " + $items[$n]) }
      }
      Say ""
      Say "  Up/Down to move, Enter to choose" DarkGray
      $k = [Console]::ReadKey($true)
      switch ($k.Key) {
        'UpArrow'   { if ($i -gt 0) { $i-- } }
        'DownArrow' { if ($i -lt $items.Count - 1) { $i++ } }
        'Enter'     { return $i }
        'Escape'    { return -1 }
      }
    }
  }

  # Checkbox list. $rows: objects with Label, Detail, Checked. Returns the
  # rows with Checked updated, or $null on Escape.
  function Select-Many($title, $rows) {
    $i = 0
    while ($true) {
      Clear-Host
      Say "mdga - Make Discord Great Again" Cyan
      Say ""
      Say $title
      Say ""
      for ($n = 0; $n -lt $rows.Count; $n++) {
        $r = $rows[$n]
        $box = if ($r.Checked) { '(*)' } else { '( )' }
        $line = "  $box " + $r.Label
        if ($n -eq $i) { Say ("> " + $line.Substring(2)) Green } else { Say $line }
        if ($r.Detail) { Say ("        " + $r.Detail) DarkGray }
      }
      Say ""
      Say "  Up/Down to move, Space to toggle, A for all/none, Enter to continue, Esc to cancel" DarkGray
      $k = [Console]::ReadKey($true)
      switch ($k.Key) {
        'UpArrow'   { if ($i -gt 0) { $i-- } }
        'DownArrow' { if ($i -lt $rows.Count - 1) { $i++ } }
        'Spacebar'  { $rows[$i].Checked = -not $rows[$i].Checked }
        'A' {
          $all = @($rows | Where-Object { -not $_.Checked }).Count -gt 0
          foreach ($r in $rows) { $r.Checked = $all }
        }
        'Enter'     { return $rows }
        'Escape'    { return $null }
      }
    }
  }

  # ---------------------------------------------------------------- discord

  function Find-Installs {
    $base = if ($env:MDGA_LOCALAPPDATA) { $env:MDGA_LOCALAPPDATA } else { $env:LOCALAPPDATA }
    $flavors = @(
      @{ Name = 'Stable'; Dir = 'Discord';       Exe = 'Discord' },
      @{ Name = 'PTB';    Dir = 'DiscordPTB';    Exe = 'DiscordPTB' },
      @{ Name = 'Canary'; Dir = 'DiscordCanary'; Exe = 'DiscordCanary' }
    )
    $found = @()
    foreach ($f in $flavors) {
      $root = Join-Path $base $f.Dir
      if (-not (Test-Path $root)) { continue }
      $latest = Get-ChildItem $root -Directory -Filter 'app-*' |
        Sort-Object { try { [version]($_.Name.Substring(4)) } catch { [version]'0.0' } } |
        Select-Object -Last 1
      if (-not $latest) { continue }
      $resources = Join-Path $latest.FullName 'resources'
      $asar = Join-Path $resources 'app.asar'
      if (-not (Test-Path $asar)) { continue }
      $found += [pscustomobject]@{
        Name      = $f.Name
        Exe       = $f.Exe
        Root      = $root
        Version   = $latest.Name.Substring(4)
        Resources = $resources
        Asar      = $asar
        Orig      = Join-Path $resources 'app.asar.orig'
      }
    }
    return ,$found
  }

  function Test-Running($inst) {
    return @(Get-Process -Name $inst.Exe -ErrorAction SilentlyContinue).Count -gt 0
  }

  # A hard kill loses the login (Local Storage is not flushed), so ask an
  # mdga-patched Discord to quit itself first: mdga/main.js watches for this
  # file and calls app.quit(), same as "Quit Discord" in the tray.
  function Stop-Discord($inst) {
    if ($env:MDGA_NO_RESTART -eq '1') { return }
    if (-not (Test-Running $inst)) { return }
    if (Test-Path $inst.Orig) {
      $req = Join-Path $inst.Resources 'mdga-quit-request'
      [IO.File]::WriteAllText($req, [string][DateTime]::Now.Ticks)
      Say "  closing Discord $($inst.Name)..."
      for ($t = 0; $t -lt 60 -and (Test-Running $inst); $t++) { Start-Sleep -Milliseconds 250 }
      Remove-Item $req -Force -ErrorAction SilentlyContinue
      if (-not (Test-Running $inst)) { Start-Sleep -Milliseconds 500; return }
    }
    if ($Interactive) {
      Say ""
      Say "  Discord $($inst.Name) is running." Yellow
      Say "  Quit it from the tray (right-click the Discord icon > Quit Discord), then press Enter."
      Say "  Press F to force-close instead (this can log you out)." DarkGray
      while (Test-Running $inst) {
        $k = [Console]::ReadKey($true)
        if ($k.Key -eq 'F') { break }
      }
    }
    if (Test-Running $inst) {
      Get-Process -Name $inst.Exe -ErrorAction SilentlyContinue | Stop-Process -Force
      Start-Sleep -Seconds 1
    }
  }

  function Start-Discord($inst) {
    if ($env:MDGA_NO_RESTART -eq '1') { return }
    $update = Join-Path $inst.Root 'Update.exe'
    if (Test-Path $update) {
      Start-Process -FilePath $update -ArgumentList '--processStart', "$($inst.Exe).exe"
    }
  }

  # ------------------------------------------------------------------- asar
  # Layout: [UInt32 4][UInt32 headerSize][UInt32 payloadSize][UInt32 jsonLen]
  # [json][pad to 4] then file data. Offsets in the JSON are relative to the
  # data start (8 + headerSize).

  function Read-AsarHeader($path) {
    $fs = [IO.File]::OpenRead($path)
    try {
      $head = New-Object byte[] 16
      if ($fs.Read($head, 0, 16) -ne 16) { Fail "$path is not an asar archive" }
      $headerSize = [BitConverter]::ToUInt32($head, 4)
      $jsonLen = [BitConverter]::ToUInt32($head, 12)
      $json = New-Object byte[] $jsonLen
      $read = 0
      while ($read -lt $jsonLen) { $read += $fs.Read($json, $read, $jsonLen - $read) }
      return [pscustomobject]@{
        Json       = $Utf8.GetString($json)
        DataOffset = [int64]8 + $headerSize
        Length     = $fs.Length
      }
    } finally { $fs.Dispose() }
  }

  # Top-level entries of the root "files" object: key -> @{ Start; End } of
  # the value's text. A small scanner instead of a JSON parser: it keeps
  # Discord's header text byte-exact, and PowerShell's JSON cmdlets merge keys
  # that differ only by case.
  function Get-RootEntries($json) {
    $prefix = '{"files":{'
    if (-not $json.StartsWith($prefix)) { Fail 'unexpected asar header layout' }
    $entries = [ordered]@{}
    $i = $prefix.Length
    while ($i -lt $json.Length) {
      while ([char]::IsWhiteSpace($json[$i]) -or $json[$i] -eq ',') { $i++ }
      if ($json[$i] -eq '}') { break }
      if ($json[$i] -ne '"') { Fail 'unexpected asar header layout' }
      # Key kept as its raw (still escaped) text; it is written back verbatim.
      $k = $i + 1
      while ($json[$k] -ne '"') { if ($json[$k] -eq '\') { $k++ }; $k++ }
      $key = $json.Substring($i + 1, $k - $i - 1)
      $i = $k + 1
      while ($json[$i] -ne ':') { $i++ }
      $i++
      while ([char]::IsWhiteSpace($json[$i])) { $i++ }
      $start = $i
      $depth = 0; $inStr = $false
      do {
        $c = $json[$i]
        if ($inStr) {
          if ($c -eq '\') { $i++ } elseif ($c -eq '"') { $inStr = $false }
        } elseif ($c -eq '"') { $inStr = $true
        } elseif ($c -eq '{' -or $c -eq '[') { $depth++
        } elseif ($c -eq '}' -or $c -eq ']') { $depth-- }
        $i++
      } while ($depth -gt 0)
      $entries[$key] = @{ Start = $start; End = $i }
    }
    return $entries
  }

  function Read-AsarEntry($path, $header, $entryJson) {
    $e = $entryJson | ConvertFrom-Json
    $size = [int]$e.size
    $fs = [IO.File]::OpenRead($path)
    try {
      [void]$fs.Seek($header.DataOffset + [int64]$e.offset, 'Begin')
      $buf = New-Object byte[] $size
      $read = 0
      while ($read -lt $size) { $read += $fs.Read($buf, $read, $size - $read) }
      return $Utf8.GetString($buf)
    } finally { $fs.Dispose() }
  }

  function ConvertTo-JsonString($s) {
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('"')
    foreach ($ch in $s.ToCharArray()) {
      switch ($ch) {
        '"'  { [void]$sb.Append('\"') }
        '\'  { [void]$sb.Append('\\') }
        default {
          if ([int]$ch -lt 0x20) { [void]$sb.Append(('\u{0:x4}' -f [int]$ch)) } else { [void]$sb.Append($ch) }
        }
      }
    }
    [void]$sb.Append('"')
    return $sb.ToString()
  }

  # Writes $dest = $source with $files (ordered name -> string) added at the
  # archive root ("dir/name" creates a directory entry). Replaces root
  # entries with the same name.
  function Write-PatchedAsar($source, $dest, $files) {
    $header = Read-AsarHeader $source
    $json = $header.Json
    $roots = Get-RootEntries $json
    $dataLen = $header.Length - $header.DataOffset

    $blobs = New-Object System.Collections.Generic.List[byte[]]
    $offset = [int64]$dataLen
    $tree = [ordered]@{}
    foreach ($name in $files.Keys) {
      $bytes = $Utf8.GetBytes([string]$files[$name])
      $entry = '{"size":' + $bytes.Length + ',"offset":"' + $offset + '"}'
      $blobs.Add($bytes)
      $offset += $bytes.Length
      $parts = $name.Split('/')
      if ($parts.Count -eq 1) { $tree[$name] = $entry }
      else {
        if (-not $tree.Contains($parts[0])) { $tree[$parts[0]] = [ordered]@{} }
        $tree[$parts[0]][$parts[1]] = $entry
      }
    }

    # Rebuild the root object: Discord's entries (minus the ones we replace)
    # copied as text, then ours.
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('{"files":{')
    $first = $true
    foreach ($key in $roots.Keys) {
      if ($tree.Contains($key)) { continue }
      $r = $roots[$key]
      if (-not $first) { [void]$sb.Append(',') }
      $first = $false
      [void]$sb.Append('"' + $key + '":').Append($json.Substring($r.Start, $r.End - $r.Start))
    }
    foreach ($key in $tree.Keys) {
      if (-not $first) { [void]$sb.Append(',') }
      $first = $false
      [void]$sb.Append((ConvertTo-JsonString $key)).Append(':')
      $v = $tree[$key]
      if ($v -is [string]) { [void]$sb.Append($v) }
      else {
        $inner = @()
        foreach ($k2 in $v.Keys) { $inner += (ConvertTo-JsonString $k2) + ':' + $v[$k2] }
        [void]$sb.Append('{"files":{' + ($inner -join ',') + '}}')
      }
    }
    [void]$sb.Append('}}')

    $jsonBytes = $Utf8.GetBytes($sb.ToString())
    $pad = (4 - ($jsonBytes.Length % 4)) % 4
    $payloadSize = 4 + $jsonBytes.Length + $pad
    $headerSize = 4 + $payloadSize

    $tmp = "$dest.mdga-tmp"
    $out = [IO.File]::Create($tmp)
    try {
      $w = New-Object IO.BinaryWriter $out
      $w.Write([uint32]4); $w.Write([uint32]$headerSize)
      $w.Write([uint32]$payloadSize); $w.Write([uint32]$jsonBytes.Length)
      $w.Write($jsonBytes); $w.Write((New-Object byte[] $pad))
      $in = [IO.File]::OpenRead($source)
      try { [void]$in.Seek($header.DataOffset, 'Begin'); $in.CopyTo($out) } finally { $in.Dispose() }
      foreach ($b in $blobs) { $w.Write($b) }
      $w.Flush()
    } finally { $out.Dispose() }
    Move-Item -LiteralPath $tmp -Destination $dest -Force
  }

  # ------------------------------------------------------------ install/rm

  function Install-Mdga($inst, $payload, $enabledIds) {
    Say "  patching Discord $($inst.Name) $($inst.Version)"
    Stop-Discord $inst
    $source = if (Test-Path $inst.Orig) { $inst.Orig } else { $inst.Asar }
    $header = Read-AsarHeader $source
    $roots = Get-RootEntries $header.Json
    if ($roots.Contains('mdga_entry.js')) {
      Fail "$source is already patched and there is no clean app.asar.orig. Reinstall Discord, then run this again."
    }
    if (-not $roots.Contains('package.json')) { Fail 'app.asar has no package.json' }
    $pkg = (Read-AsarEntry $source $header $header.Json.Substring($roots['package.json'].Start, $roots['package.json'].End - $roots['package.json'].Start)) | ConvertFrom-Json
    $main = [string]$pkg.main
    if (-not $main) { Fail 'app.asar package.json has no main entry' }
    if (-not (Test-Path $inst.Orig)) { Copy-Item -LiteralPath $inst.Asar -Destination $inst.Orig }

    $pkg.main = 'mdga_entry.js'
    $mods = @()
    foreach ($m in $payload.modules) {
      $mods += [ordered]@{
        id = $m.id; label = $m.label; description = $m.description
        defaultEnabled = $m.defaultEnabled; enabled = ($enabledIds -contains $m.id); code = $m.code
      }
    }
    $entry = @"
"use strict";

try {
  require("./mdga/main.js");
} catch (err) {
  // Never let a failure in mdga break Discord itself.
  console.error("[mdga] payload failed to load:", err);
}

module.exports = require("./$($main.Replace('\', '/'))");
"@
    $files = [ordered]@{
      'package.json'      = ($pkg | ConvertTo-Json -Depth 20)
      'mdga_entry.js'     = $entry
      'mdga/main.js'      = $payload.files.'mdga/main.js'
      'mdga/preload.js'   = $payload.files.'mdga/preload.js'
      'mdga/bootstrap.js' = $payload.files.'mdga/bootstrap.js'
      'mdga/modules.json' = (ConvertTo-Json -InputObject @($mods) -Depth 5 -Compress)
    }
    Write-PatchedAsar $inst.Orig $inst.Asar $files
    Say "  done: $($enabledIds.Count) of $($payload.modules.Count) modules enabled" Green
    Start-Discord $inst
  }

  function Uninstall-Mdga($inst) {
    if (-not (Test-Path $inst.Orig)) { Say "  Discord $($inst.Name): mdga is not installed" DarkGray; return }
    Say "  restoring Discord $($inst.Name) $($inst.Version)"
    Stop-Discord $inst
    Copy-Item -LiteralPath $inst.Orig -Destination $inst.Asar -Force
    Remove-Item -LiteralPath $inst.Orig -Force
    Say "  done: original app.asar restored" Green
    Start-Discord $inst
  }

  # ------------------------------------------------------------------- main

  $installs = Find-Installs
  if ($installs.Count -eq 0) { Fail 'no Discord installation found under %LOCALAPPDATA%' }

  $action = $env:MDGA_ACTION
  if (-not $action) {
    if (-not $Interactive) { Fail 'no console to show the menu; set MDGA_ACTION=install or uninstall' }
    $status = ($installs | ForEach-Object { "$($_.Name) $($_.Version): " + $(if (Test-Path $_.Orig) { 'mdga installed' } else { 'clean' }) }) -join ', '
    $pick = Select-One "Found: $status" @('Install or update mdga', 'Uninstall mdga', 'Exit')
    $action = @('install', 'uninstall', 'exit')[[Math]::Max($pick, 0)]
    if ($pick -lt 0) { $action = 'exit' }
  }
  if ($action -eq 'exit') { return }

  # Which Discord flavors to act on.
  $targets = $installs
  if ($installs.Count -gt 1 -and $Interactive -and -not $env:MDGA_ACTION) {
    $rows = @($installs | ForEach-Object { [pscustomobject]@{ Label = "Discord $($_.Name) $($_.Version)"; Detail = $_.Resources; Checked = $true; Inst = $_ } })
    $rows = Select-Many 'Which Discord installations?' $rows
    if ($null -eq $rows) { return }
    $targets = @($rows | Where-Object { $_.Checked } | ForEach-Object { $_.Inst })
    if ($targets.Count -eq 0) { Say 'Nothing selected.'; return }
  }

  if ($action -eq 'uninstall') {
    foreach ($t in $targets) { Uninstall-Mdga $t }
    return
  }
  if ($action -ne 'install') { Fail "unknown MDGA_ACTION '$action'" }

  $src = if ($env:MDGA_PAYLOAD) { $env:MDGA_PAYLOAD } else { "https://github.com/$Repo/releases/latest/download/mdga-payload.json" }
  Say "  downloading $src"
  if (Test-Path -LiteralPath $src -ErrorAction SilentlyContinue) {
    $payload = [IO.File]::ReadAllText($src, $Utf8) | ConvertFrom-Json
  } else {
    $payload = Invoke-RestMethod -Uri $src -UseBasicParsing
  }
  if (-not $payload.modules) { Fail 'payload has no modules' }

  if ($env:MDGA_MODULES) {
    $enabledIds = @($env:MDGA_MODULES.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  } elseif ($Interactive) {
    $rows = @($payload.modules | ForEach-Object { [pscustomobject]@{ Label = $_.label; Detail = $_.description; Checked = [bool]$_.defaultEnabled; Id = $_.id } })
    $rows = Select-Many "mdga $($payload.version) - choose what to remove from Discord" $rows
    if ($null -eq $rows) { return }
    $enabledIds = @($rows | Where-Object { $_.Checked } | ForEach-Object { $_.Id })
  } else {
    $enabledIds = @($payload.modules | Where-Object { $_.defaultEnabled } | ForEach-Object { $_.id })
  }

  Clear-Host -ErrorAction SilentlyContinue
  foreach ($t in $targets) { Install-Mdga $t $payload $enabledIds }
  Say ""
  Say "mdga is installed. Run the installer again to change modules or uninstall." Cyan
  Say "Discord updates replace app.asar, so run it again after a Discord update." DarkGray
}

# Fail() has already printed its message; anything else is unexpected.
try { Invoke-Mdga } catch {
  if (-not $_.Exception.Message.StartsWith('mdga: ')) {
    Write-Host ""
    Write-Host ("mdga failed: " + $_.Exception.Message) -ForegroundColor Red
  }
}
