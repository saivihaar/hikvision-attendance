<#
Hikvision DS-K1T320EFWX configuration/attendance script.
Device found on LAN scan: 192.168.0.144 (port 8000 SDK, port 80 HTTP, realm "DS-016B6A9D").
Uses ISAPI over HTTP Digest auth via .NET CredentialCache (works on Windows PowerShell 5.1
without hand-rolling the digest handshake).
#>

param(
    [string]$DeviceIP = "192.168.0.144",
    [string]$HikUser  = "admin",
    [string]$HikPass,
    [string]$DeviceSecretsPath = "$PSScriptRoot\device-secrets.json",

    [string]$CloudConfigPath = "$PSScriptRoot\cloud-config.json",
    [string]$SyncStatePath   = "$PSScriptRoot\sync-state.json",
    [string]$SyncLogPath     = "$PSScriptRoot\sync-agent.log",
    [int]$SyncOverlapMinutes = 5,

    [ValidateSet("Info","Capabilities","SetTime","CreateUser","RemoveUser","ListUsers","CaptureFace","EnrollFace","EnrollCard","SearchEvents","ExportAttendance","SyncPeople","SyncEvents","All")]
    [string]$Action = "Info",

    # Used by CreateUser / EnrollFace / EnrollCard
    [string]$EmployeeNo,
    [string]$PersonName,
    [string]$FacePhotoPath,
    [string]$CardNo,
    [string]$CaptureOutPath = ".\captured-face.jpg",

    # Used by SearchEvents / ExportAttendance
    [datetime]$StartTime = (Get-Date).Date,
    [datetime]$EndTime   = (Get-Date).Date.AddDays(1).AddSeconds(-1),
    [string]$ExportCsvPath = ".\attendance-export.csv"
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not $HikPass -and (Test-Path $DeviceSecretsPath)) {
    $HikPass = (Get-Content $DeviceSecretsPath -Raw | ConvertFrom-Json).HikPassword
}

if (-not $HikPass -or $HikPass -eq "PASTE_YOUR_PASSWORD_HERE") {
    Write-Host "Set your device password in device-secrets.json (copy device-secrets.example.json, rename it, and edit HikPassword), then re-run." -ForegroundColor Yellow
    exit 1
}

$BaseUri = "http://$DeviceIP"

$script:Cache = New-Object System.Net.CredentialCache
$script:Cache.Add([Uri]$BaseUri, "Digest", (New-Object System.Net.NetworkCredential($HikUser, $HikPass)))

function Invoke-Hik {
    param(
        [Parameter(Mandatory)] [string]$Method,
        [Parameter(Mandatory)] [string]$Path,
        [string]$JsonBody,
        [byte[]]$RawBody,
        [string]$RawContentType,
        [switch]$ReturnBytes
    )
    $uri = "$BaseUri$Path"
    $req = [System.Net.HttpWebRequest]::Create($uri)
    $req.Credentials = $script:Cache
    $req.Method = $Method
    $req.Accept = "application/json"
    $req.Timeout = 20000

    if ($JsonBody) {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($JsonBody)
        $req.ContentType = "application/json"
        $req.ContentLength = $bytes.Length
        $s = $req.GetRequestStream(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
    } elseif ($RawBody) {
        $req.ContentType = $RawContentType
        $req.ContentLength = $RawBody.Length
        $s = $req.GetRequestStream(); $s.Write($RawBody, 0, $RawBody.Length); $s.Close()
    }

    try {
        $resp = $req.GetResponse()
    } catch [System.Net.WebException] {
        $resp = $_.Exception.Response
        if (-not $resp) { throw }
    }

    if ($ReturnBytes) {
        $ms = New-Object System.IO.MemoryStream
        $resp.GetResponseStream().CopyTo($ms)
        $resp.Close()
        return ,$ms.ToArray()
    }

    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
    $text = $reader.ReadToEnd()
    $reader.Close()
    $resp.Close()
    return $text
}

function Get-BytesIndexOf {
    param([byte[]]$Haystack, [byte[]]$Needle, [int]$StartAt = 0)
    for ($i = $StartAt; $i -le $Haystack.Length - $Needle.Length; $i++) {
        $match = $true
        for ($j = 0; $j -lt $Needle.Length; $j++) {
            if ($Haystack[$i + $j] -ne $Needle[$j]) { $match = $false; break }
        }
        if ($match) { return $i }
    }
    return -1
}

function Invoke-HikCaptureFace {
    param([string]$OutJpegPath)
    $xml = '<?xml version="1.0" encoding="UTF-8"?><CaptureFaceDataCond version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><captureInfrared>false</captureInfrared><dataType>binary</dataType></CaptureFaceDataCond>'
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($xml)
    $raw = Invoke-Hik -Method POST -Path "/ISAPI/AccessControl/CaptureFaceData" -RawBody $bytes -RawContentType "application/xml" -ReturnBytes

    $jpegHeader = [byte[]](0xFF, 0xD8, 0xFF)
    $jpegStart = Get-BytesIndexOf -Haystack $raw -Needle $jpegHeader
    if ($jpegStart -lt 0) {
        $text = [System.Text.Encoding]::UTF8.GetString($raw)
        throw "No JPEG found in capture response. Raw response: $text"
    }

    $boundaryMarker = [System.Text.Encoding]::ASCII.GetBytes("`r`n--MIME_boundary")
    $jpegEnd = Get-BytesIndexOf -Haystack $raw -Needle $boundaryMarker -StartAt $jpegStart
    if ($jpegEnd -lt 0) { $jpegEnd = $raw.Length }

    $jpegBytes = $raw[$jpegStart..($jpegEnd - 1)]
    [System.IO.File]::WriteAllBytes($OutJpegPath, $jpegBytes)
    Write-Host "Captured face saved to $OutJpegPath ($($jpegBytes.Length) bytes) - open it to confirm it's the right person before enrolling." -ForegroundColor Green
}

function ConvertFrom-HikResponse {
    param([string]$Raw)
    $trimmed = $Raw.TrimStart()
    if ($trimmed.StartsWith("<")) {
        return [xml]$Raw
    }
    return $Raw | ConvertFrom-Json
}

function Get-DeviceInfo {
    $raw = Invoke-Hik -Method GET -Path "/ISAPI/System/deviceInfo?format=json"
    $parsed = ConvertFrom-HikResponse -Raw $raw
    if ($parsed -is [xml]) {
        $parsed.DeviceInfo | Select-Object deviceName, model, serialNumber, macAddress, firmwareVersion, deviceType, manufacturer | Format-List
    } else {
        $parsed.DeviceInfo | Format-List
    }
}

function Get-Capabilities {
    $sys = Invoke-Hik -Method GET -Path "/ISAPI/System/capabilities?format=json"
    $acs = Invoke-Hik -Method GET -Path "/ISAPI/AccessControl/capabilities?format=json"
    $sys | Out-File "$PSScriptRoot\system-capabilities.json" -Encoding utf8
    $acs | Out-File "$PSScriptRoot\accesscontrol-capabilities.json" -Encoding utf8
    Write-Host "Saved system-capabilities.json and accesscontrol-capabilities.json next to this script." -ForegroundColor Cyan
    Write-Host "Check accesscontrol-capabilities.json to confirm whether this unit actually has a fingerprint sensor / card reader before relying on those features." -ForegroundColor Cyan
}

function Set-DeviceTime {
    # This firmware (V3.5.0) ignores ?format=json and expects legacy XML bodies.
    # NTP sync - adjust hostName to a server reachable from your LAN if pool.ntp.org is blocked.
    $ntpXml = @"
<?xml version="1.0" encoding="UTF-8"?>
<NTPServer version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
<id>1</id>
<addressingFormatType>hostname</addressingFormatType>
<hostName>pool.ntp.org</hostName>
<portNo>123</portNo>
<synchronizeInterval>1440</synchronizeInterval>
</NTPServer>
"@
    $ntpBytes = [System.Text.Encoding]::UTF8.GetBytes($ntpXml)
    Write-Host (Invoke-Hik -Method PUT -Path "/ISAPI/System/time/ntpServers/1" -RawBody $ntpBytes -RawContentType "application/xml")

    $timeXml = @"
<?xml version="1.0" encoding="UTF-8"?>
<Time version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
<timeMode>NTP</timeMode>
</Time>
"@
    $timeBytes = [System.Text.Encoding]::UTF8.GetBytes($timeXml)
    Write-Host (Invoke-Hik -Method PUT -Path "/ISAPI/System/time" -RawBody $timeBytes -RawContentType "application/xml")
}

function New-HikUser {
    param([string]$EmployeeNo, [string]$PersonName)
    if (-not $EmployeeNo -or -not $PersonName) { throw "Pass -EmployeeNo and -PersonName" }
    $body = @{
        UserInfo = @{
            employeeNo = $EmployeeNo
            name = $PersonName
            userType = "normal"
            Valid = @{
                enable = $true
                beginTime = "2026-01-01T00:00:00"
                endTime = "2035-12-31T23:59:59"
            }
            doorRight = "1"
            RightPlan = @(@{ doorNo = 1; planTemplateNo = "1" })
        }
    } | ConvertTo-Json -Depth 5
    $raw = Invoke-Hik -Method POST -Path "/ISAPI/AccessControl/UserInfo/Record?format=json" -JsonBody $body
    $parsed = ConvertFrom-HikResponse -Raw $raw
    if ($parsed -is [xml]) { $parsed.OuterXml } else { $raw }
}

function Add-HikFace {
    param([string]$EmployeeNo, [string]$PhotoPath)
    if (-not (Test-Path $PhotoPath)) { throw "Photo not found: $PhotoPath" }
    $jpeg = [System.IO.File]::ReadAllBytes($PhotoPath)
    if ($jpeg.Length -gt 200KB) { Write-Warning "Photo is over 200KB - device may reject it. Resize to a smaller JPEG (single frontal face, min 80x80)." }

    $meta = @{ faceLibType = "blackFD"; FDID = "1"; FPID = $EmployeeNo } | ConvertTo-Json -Compress
    $boundary = "----hik$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
    $CRLF = "`r`n"
    $preamble = "--$boundary$CRLF" +
                "Content-Disposition: form-data; name=`"FaceDataRecord`";$CRLF" +
                "Content-Type: application/json$CRLF$CRLF$meta" +
                "$CRLF--$boundary$CRLF" +
                "Content-Disposition: form-data; name=`"FaceImage`";$CRLF" +
                "Content-Type: image/jpeg$CRLF$CRLF"
    $tail = "$CRLF--$boundary--$CRLF"

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($preamble) + $jpeg + [System.Text.Encoding]::UTF8.GetBytes($tail)
    Invoke-Hik -Method POST -Path "/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json" -RawBody $bytes -RawContentType "multipart/form-data; boundary=$boundary"
}

function Remove-HikUser {
    param([string]$EmployeeNo)
    if (-not $EmployeeNo) { throw "Pass -EmployeeNo" }
    $body = @{ UserInfoDelCond = @{ EmployeeNoList = @(@{ employeeNo = $EmployeeNo }) } } | ConvertTo-Json -Depth 5
    Invoke-Hik -Method PUT -Path "/ISAPI/AccessControl/UserInfo/Delete?format=json" -JsonBody $body
}

function Get-HikUserList {
    $all = @()
    $pos = 0
    $searchId = "list-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
    while ($true) {
        $body = @{ UserInfoSearchCond = @{ searchID = $searchId; searchResultPosition = $pos; maxResults = 30 } } | ConvertTo-Json -Depth 5
        $raw = Invoke-Hik -Method POST -Path "/ISAPI/AccessControl/UserInfo/Search?format=json" -JsonBody $body
        $parsed = ConvertFrom-HikResponse -Raw $raw
        $node = $parsed.UserInfoSearch
        $users = @($node.UserInfo)
        if ($users) { $all += $users }
        $got = $node.numOfMatches
        if (-not $got -or $node.responseStatusStrg -eq "OK") { break }
        $pos += $got
    }
    return $all
}

function Add-HikCard {
    param([string]$EmployeeNo, [string]$CardNo)
    $body = @{ CardInfo = @{ employeeNo = $EmployeeNo; cardNo = $CardNo; cardType = "normalCard" } } | ConvertTo-Json -Depth 5
    Invoke-Hik -Method POST -Path "/ISAPI/AccessControl/CardInfo/Record?format=json" -JsonBody $body
}

function Search-HikEvents {
    param([datetime]$Start, [datetime]$End)
    $all = @()
    $pos = 0
    $searchId = "search-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
    while ($true) {
        $tzOffset = $Start.ToString("zzz")
        $body = @{
            AcsEventCond = @{
                searchID = $searchId
                searchResultPosition = $pos
                maxResults = 100
                major = 5
                minor = 0
                startTime = $Start.ToString("yyyy-MM-ddTHH:mm:ss") + $tzOffset
                endTime = $End.ToString("yyyy-MM-ddTHH:mm:ss") + $tzOffset
            }
        } | ConvertTo-Json -Depth 5
        $raw = Invoke-Hik -Method POST -Path "/ISAPI/AccessControl/AcsEvent?format=json" -JsonBody $body
        $parsed = ConvertFrom-HikResponse -Raw $raw
        if ($parsed -is [xml]) {
            $node = $parsed.AcsEvent
            $matches = @($node.InfoList.ChildNodes)
            $got = [int]($node.numOfMatches)
            $status = $node.responseStatusStrg
        } else {
            $node = $parsed.AcsEvent
            $matches = @($node.InfoList)
            $got = $node.numOfMatches
            $status = $node.responseStatusStrg
        }
        if ($matches) { $all += $matches }
        if (-not $got -or $status -eq "OK") { break }
        $pos += $got
    }
    return $all
}

function Export-HikAttendance {
    param([datetime]$Start, [datetime]$End, [string]$OutCsv)
    $events = Search-HikEvents -Start $Start -End $End
    $events | Select-Object time, employeeNoString, name, minor, currentVerifyMode |
        Export-Csv -Path $OutCsv -NoTypeInformation -Encoding UTF8
    Write-Host "Exported $($events.Count) events to $OutCsv" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# Cloud sync (Supabase) - pushes people/events up so the web dashboard can
# show live status + history from anywhere, without exposing the device
# itself to the internet. See cloud/schema.sql for the table definitions.
# ---------------------------------------------------------------------------

function Get-CloudConfig {
    if (-not (Test-Path $CloudConfigPath)) {
        throw "cloud-config.json not found at $CloudConfigPath. Copy cloud-config.example.json, rename it, and fill in your Supabase project URL + service_role key."
    }
    $cfg = Get-Content $CloudConfigPath -Raw | ConvertFrom-Json
    if ($cfg.SupabaseUrl -eq "PASTE_YOUR_SUPABASE_PROJECT_URL_HERE" -or $cfg.SupabaseServiceRoleKey -eq "PASTE_YOUR_SERVICE_ROLE_KEY_HERE") {
        throw "cloud-config.json still has placeholder values. Edit it with your real Supabase URL + service_role key."
    }
    return $cfg
}

function Invoke-CloudApi {
    param(
        [Parameter(Mandatory)] [string]$Method,
        [Parameter(Mandatory)] [string]$Path,
        $Body,
        [string]$Prefer
    )
    $cfg = Get-CloudConfig
    $uri = "$($cfg.SupabaseUrl)$Path"
    $headers = @{
        "apikey"        = $cfg.SupabaseServiceRoleKey
        "Authorization" = "Bearer $($cfg.SupabaseServiceRoleKey)"
        "Content-Type"  = "application/json"
    }
    if ($Prefer) { $headers["Prefer"] = $Prefer }

    $params = @{ Method = $Method; Uri = $uri; Headers = $headers; UserAgent = "HikvisionSyncAgent/1.0 (PowerShell)" }
    if ($Body) { $params["Body"] = ($Body | ConvertTo-Json -Depth 10) }
    Invoke-RestMethod @params
}

function Get-HikEventType {
    param([int]$Minor)
    switch ($Minor) {
        75  { "face_success" }
        38  { "card_success" }
        113 { "fingerprint_success" }
        76  { "face_fail" }
        default { "other" }
    }
}

function Write-SyncLog {
    param([string]$Message)
    $line = "$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss')) - $Message"
    Add-Content -Path $SyncLogPath -Value $line
    Write-Host $line
}

function Sync-HikPeopleToCloud {
    $users = Get-HikUserList
    if (-not $users -or $users.Count -eq 0) {
        Write-SyncLog "SyncPeople: no users found on device"
        return
    }
    $payload = $users | ForEach-Object { @{ employee_no = "$($_.employeeNo)"; name = "$($_.name)" } }
    try {
        Invoke-CloudApi -Method POST -Path "/rest/v1/people?on_conflict=employee_no" -Body $payload -Prefer "resolution=merge-duplicates,return=minimal" -ErrorAction Stop | Out-Null
        Write-SyncLog "SyncPeople: upserted $($payload.Count) people"
    } catch {
        Write-SyncLog "SyncPeople FAILED: $($_.Exception.Message)"
        throw
    }
}

function Sync-HikEventsToCloud {
    $state = @{ last_synced_time = (Get-Date).AddHours(-24) }
    if (Test-Path $SyncStatePath) {
        $saved = Get-Content $SyncStatePath -Raw | ConvertFrom-Json
        if ($saved.last_synced_time) { $state.last_synced_time = [datetime]$saved.last_synced_time }
    }

    $start = $state.last_synced_time.AddMinutes(-$SyncOverlapMinutes)
    $end = Get-Date

    try {
        Sync-HikPeopleToCloud
    } catch {
        Write-SyncLog "SyncEvents ABORTED: people sync failed, not touching sync-state.json"
        return
    }

    $events = Search-HikEvents -Start $start -End $end
    $withEmployee = @($events | Where-Object { $_.employeeNoString })
    $skipped = $events.Count - $withEmployee.Count

    if ($withEmployee.Count -gt 0) {
        $payload = $withEmployee | ForEach-Object {
            @{
                employee_no = "$($_.employeeNoString)"
                event_time  = ([datetime]$_.time).ToString("o")
                major       = [int]$_.major
                minor       = [int]$_.minor
                event_type  = Get-HikEventType -Minor ([int]$_.minor)
                verify_mode = "$($_.currentVerifyMode)"
                door_no     = if ($_.doorNo) { [int]$_.doorNo } else { $null }
                raw         = $_
            }
        }
        try {
            Invoke-CloudApi -Method POST -Path "/rest/v1/events" -Body $payload -Prefer "resolution=ignore-duplicates,return=minimal" -ErrorAction Stop | Out-Null
        } catch {
            Write-SyncLog "SyncEvents FAILED to push events: $($_.Exception.Message) - not advancing sync-state.json, will retry this window next run"
            return
        }
    }

    $stateBody = @{
        device_serial     = "DSK1T320EFWX20221110V030500ENL43488191"
        last_synced_time  = $end.ToString("o")
    }
    try {
        Invoke-CloudApi -Method POST -Path "/rest/v1/sync_state?on_conflict=device_serial" -Body $stateBody -Prefer "resolution=merge-duplicates,return=minimal" -ErrorAction Stop | Out-Null
    } catch {
        Write-SyncLog "SyncEvents: pushed $($withEmployee.Count) events but failed to update cloud sync_state: $($_.Exception.Message)"
        return
    }

    @{ last_synced_time = $end.ToString("o") } | ConvertTo-Json | Set-Content -Path $SyncStatePath -Encoding utf8

    Write-SyncLog "SyncEvents: pushed $($withEmployee.Count) events (skipped $skipped without employeeNoString), window $($start.ToString('o')) to $($end.ToString('o'))"
}

switch ($Action) {
    "Info"             { Get-DeviceInfo }
    "Capabilities"      { Get-Capabilities }
    "SetTime"           { Set-DeviceTime }
    "CreateUser"        { New-HikUser -EmployeeNo $EmployeeNo -PersonName $PersonName }
    "RemoveUser"        { Remove-HikUser -EmployeeNo $EmployeeNo }
    "ListUsers"         { Get-HikUserList | Select-Object employeeNo, name | Format-Table -AutoSize }
    "CaptureFace"       { Invoke-HikCaptureFace -OutJpegPath $CaptureOutPath }
    "EnrollFace"        { Add-HikFace -EmployeeNo $EmployeeNo -PhotoPath $FacePhotoPath }
    "EnrollCard"        { Add-HikCard -EmployeeNo $EmployeeNo -CardNo $CardNo }
    "SearchEvents"      { Search-HikEvents -Start $StartTime -End $EndTime | Format-Table time, employeeNoString, name, minor -AutoSize }
    "ExportAttendance"  { Export-HikAttendance -Start $StartTime -End $EndTime -OutCsv $ExportCsvPath }
    "SyncPeople"        { Sync-HikPeopleToCloud }
    "SyncEvents"        { Sync-HikEventsToCloud }
    "All" {
        Get-DeviceInfo
        Get-Capabilities
        Set-DeviceTime
        Export-HikAttendance -Start $StartTime -End $EndTime -OutCsv $ExportCsvPath
    }
}
