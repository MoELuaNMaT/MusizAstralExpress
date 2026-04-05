param(
  [Parameter(Mandatory=$true)][string]$WsUrl,
  [Parameter(Mandatory=$true)][string]$Expression
)

$ws = [System.Net.WebSockets.ClientWebSocket]::new()
$cts = [System.Threading.CancellationToken]::None
$ws.ConnectAsync([Uri]$WsUrl, $cts).Wait()

function Send-Message([System.Net.WebSockets.ClientWebSocket]$socket, [hashtable]$payload) {
  $json = ($payload | ConvertTo-Json -Depth 10 -Compress)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $segment = [ArraySegment[byte]]::new($bytes)
  $socket.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts).Wait()
}

function Read-Json([System.Net.WebSockets.ClientWebSocket]$socket) {
  $buffer = New-Object byte[] 16384
  $segment = [ArraySegment[byte]]::new($buffer)
  $builder = [System.Text.StringBuilder]::new()

  do {
    $result = $socket.ReceiveAsync($segment, $cts).Result
    if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
      return $null
    }
    $chunk = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)
    [void]$builder.Append($chunk)
  } while (-not $result.EndOfMessage)

  return $builder.ToString() | ConvertFrom-Json
}

Send-Message $ws @{ id = 1; method = 'Runtime.enable' }
while ($true) {
  $msg = Read-Json $ws
  if ($null -eq $msg) { break }
  if ($msg.id -eq 1) { break }
}

Send-Message $ws @{ id = 2; method = 'Runtime.evaluate'; params = @{ expression = $Expression; returnByValue = $true; awaitPromise = $true } }
while ($true) {
  $msg = Read-Json $ws
  if ($null -eq $msg) { break }
  if ($msg.id -eq 2) {
    $msg | ConvertTo-Json -Depth 20
    break
  }
}

try {
  if ($ws.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
    $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', $cts).Wait()
  }
} catch {
  # Ignore remote-close races from WebView DevTools.
}
$ws.Dispose()
