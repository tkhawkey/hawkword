<#
  Hawkword local dev server (PowerShell 7, no installs needed).
  Serves the app and the same /api/guardian/* endpoints as worker/worker.js.

    pwsh -File dev-server.ps1            # then open http://localhost:8787
#>
param([int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 8787 }))

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Series = @('cryptic', 'quick', 'quiptic', 'speedy', 'prize', 'everyman', 'quick-cryptic', 'sunday-quick')
$Cache = @{}
$Types = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8';
  '.json' = 'application/json'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.ico' = 'image/x-icon'; '.webmanifest' = 'application/manifest+json' }

# Scrapes one series page -> list of @{series,id,title,date}. Kept as source text so parallel runspaces can use it.
$ListSrc = @'
param($series, $page)
$url = "https://www.theguardian.com/crosswords/series/$series" + $(if ($page -gt 1) { "?page=$page" } else { '' })
$html = (Invoke-WebRequest -UseBasicParsing -Uri $url -Headers @{ 'User-Agent' = 'Mozilla/5.0 (personal crossword reader)' }).Content
$re = "href=""/crosswords/$series/(\d+)""[^>]*?aria-label=""([^""]*)""[\s\S]{0,1500}?dateTime=""([^""]+)"""
$seen = @{}
$out = foreach ($m in [regex]::Matches($html, $re)) {
  $id = [int]$m.Groups[1].Value
  if ($seen[$id]) { continue }
  $seen[$id] = $true
  [ordered]@{ series = $series; id = $id; title = [System.Net.WebUtility]::HtmlDecode($m.Groups[2].Value); date = $m.Groups[3].Value }
}
@($out | Sort-Object { $_.id } -Descending)
'@
$ListSeries = [scriptblock]::Create($ListSrc)

function Get-Cached($key, $seconds, [scriptblock]$make) {
  $hit = $Cache[$key]
  if ($hit -and $hit.until -gt (Get-Date)) { return $hit.value }
  $value = & $make
  $Cache[$key] = @{ value = $value; until = (Get-Date).AddSeconds($seconds) }
  $value
}

function Get-Api($path, $query) {
  switch ($path) {
    '/api/guardian/today' {
      return Get-Cached 'today' 600 {
        $src = $ListSrc
        $items = $Series | ForEach-Object -ThrottleLimit 8 -Parallel {
          try { (& ([scriptblock]::Create($using:src)) $_ 1)[0] } catch { $null }
        }
        @{ items = @($items | Where-Object { $_ }) } | ConvertTo-Json -Depth 5 -Compress
      }
    }
    '/api/guardian/list' {
      $s = $query['series']; if ($s -notin $Series) { throw [System.ArgumentException]'unknown series' }
      $p = [Math]::Max(1, [int]('0' + $query['page']))
      return Get-Cached "list:${s}:$p" 600 { @{ series = $s; page = $p; items = @(& $ListSeries $s $p) } | ConvertTo-Json -Depth 5 -Compress }
    }
    '/api/guardian/puzzle' {
      $s = $query['series']; $id = $query['id']
      if ($s -notin $Series -or $id -notmatch '^\d{1,6}$') { throw [System.ArgumentException]'bad series or id' }
      return Get-Cached "p:${s}:$id" 900 {
        $html = (Invoke-WebRequest -UseBasicParsing -Uri "https://www.theguardian.com/crosswords/$s/$id" -Headers @{ 'User-Agent' = 'Mozilla/5.0 (personal crossword reader)' }).Content
        $m = [regex]::Match($html, 'name="CrosswordComponent"[^>]*?props="([^"]*)"')
        if (-not $m.Success) { throw 'no crossword data on page' }
        [System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value)   # {"data":{...}} - the app reads .data
      }
    }
    default { throw [System.Collections.Generic.KeyNotFoundException]'not found' }
  }
}

function Send($ctx, [int]$status, [string]$type, [byte[]]$bytes) {
  $res = $ctx.Response
  $res.StatusCode = $status
  $res.ContentType = $type
  $res.Headers['Cache-Control'] = 'no-store'
  $res.ContentLength64 = $bytes.Length
  if ($ctx.Request.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
  $res.Close()
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Hawkword running at http://localhost:$Port  (Ctrl+C to stop)"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $path = $ctx.Request.Url.AbsolutePath
    try {
      if ($path.StartsWith('/api/') -and $env:HAWKWORD_KEY -and $ctx.Request.Headers['X-Hawkword-Key'] -cne $env:HAWKWORD_KEY) {
        # optional: set $env:HAWKWORD_KEY to try the key prompt locally
        Send $ctx 401 'application/json' ([Text.Encoding]::UTF8.GetBytes('{"error":"key required"}'))
      } elseif ($path.StartsWith('/api/')) {
        $json = Get-Api $path $ctx.Request.QueryString
        Send $ctx 200 'application/json; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($json))
      } else {
        $rel = [Uri]::UnescapeDataString($path.TrimStart('/'))
        if ($rel -eq '' -or $rel.EndsWith('/')) { $rel += 'index.html' }
        $file = [IO.Path]::GetFullPath((Join-Path $Root $rel))
        if (-not $file.StartsWith($Root) -or -not (Test-Path $file -PathType Leaf)) {
          Send $ctx 404 'text/plain' ([Text.Encoding]::UTF8.GetBytes('not found'))
        } else {
          $type = $Types[[IO.Path]::GetExtension($file).ToLower()] ?? 'application/octet-stream'
          Send $ctx 200 $type ([IO.File]::ReadAllBytes($file))
        }
      }
      Write-Host "$($ctx.Request.HttpMethod) $($ctx.Request.Url.PathAndQuery)"
    } catch {
      $err = $_.Exception
      $status = if ($err -is [System.ArgumentException]) { 400 } elseif ($err -is [System.Collections.Generic.KeyNotFoundException]) { 404 }
                elseif ($err.Response.StatusCode -eq 'NotFound') { 404 } else { 502 }
      Write-Host "ERROR $path : $($err.Message)"
      try { Send $ctx $status 'application/json' ([Text.Encoding]::UTF8.GetBytes((@{ error = $err.Message } | ConvertTo-Json -Compress))) } catch {}
    }
  }
} finally {
  $listener.Stop()
}
