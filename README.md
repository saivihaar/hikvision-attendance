# Hikvision DS-K1T320EFWX Attendance Setup

Device found on your LAN: `192.168.0.121` (MAC `e0-ba-ad-9c-cc-af`, port 8000 SDK / port 80 HTTP).

**Important:** this IP is assigned by DHCP and *will* change again if the device
reboots or its lease expires - it already moved once (from `.144` to `.121`), which
silently broke syncing for two days until caught. Ask whoever manages your router to
set a **DHCP reservation** (or a static IP) for MAC `e0-ba-ad-9c-cc-af`, pinning it
permanently. Until that's done, if syncing ever goes stale again, check the device's
current IP first (`arp -a | grep e0-ba-ad`) before assuming something else is wrong.

## 1. Activate / reset the admin account (do this yourself, in SADP or Hik-Partner Pro)

This device already had an admin account set by a previous setup. Use the SADP tool
(already installed at `C:\Program Files (x86)\SADP\SADP\SADPTool.exe`) → select the
device → **Forgot Password** → **Generate QR Code** → scan with the **Hik-Partner Pro**
app → enter the code back into SADP → set a new admin password.

**Do not share that password with anyone/anything you don't trust with door/attendance
access** — including, deliberately, this assistant. The script below asks you to paste it
directly into the file instead.

## 2. Configure the script

The device password lives in its own file, not in the script itself. Copy
`device-secrets.example.json` to `device-secrets.json` and edit it:

```json
{
  "HikPassword": "your real admin password here"
}
```

Save it. (`device-secrets.json` is gitignored and only lives on your own machine —
don't commit it anywhere or send it to anyone.)

## 3. Usage

Run from a PowerShell window in this folder:

```powershell
# Confirm the script can talk to the device
.\configure-terminal.ps1 -Action Info

# Check exactly which modules this unit actually has (face/fingerprint/card, max users, etc.)
# — check accesscontrol-capabilities.json afterward before assuming fingerprint/card work
.\configure-terminal.ps1 -Action Capabilities

# Sync the device clock to NTP
.\configure-terminal.ps1 -Action SetTime

# Enroll a person
.\configure-terminal.ps1 -Action CreateUser -EmployeeNo "1001" -PersonName "Jane Doe"

# Capture a live face photo using the terminal's own camera (person stands in front of it)
# Saves a JPEG for you to review before enrolling - retake if eyes aren't looking straight at the camera
.\configure-terminal.ps1 -Action CaptureFace -CaptureOutPath ".\captured-face.jpg"

# Enroll a face photo (either the captured one above, or any JPEG: single frontal face, <=200KB, min 80x80px)
.\configure-terminal.ps1 -Action EnrollFace -EmployeeNo "1001" -FacePhotoPath "C:\path\to\jane.jpg"

# Enroll a card (only if Capabilities confirmed a card reader exists)
.\configure-terminal.ps1 -Action EnrollCard -EmployeeNo "1001" -CardNo "0012345678"

# View today's attendance events in the terminal
.\configure-terminal.ps1 -Action SearchEvents

# Export today's attendance to CSV
.\configure-terminal.ps1 -Action ExportAttendance -ExportCsvPath ".\today.csv"

# Export a specific date range
.\configure-terminal.ps1 -Action ExportAttendance -StartTime "2026-07-01" -EndTime "2026-07-29" -ExportCsvPath ".\july.csv"

# List everyone currently enrolled
.\configure-terminal.ps1 -Action ListUsers

# Remove a user (revokes their access immediately)
.\configure-terminal.ps1 -Action RemoveUser -EmployeeNo "1001"
```

## 4. Daily automatic export ("backup")

The device itself doesn't have a documented "auto-backup" toggle in its local API — the
practical equivalent is running the export on a schedule. To do that yourself:

```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument '-File "C:\Users\saivi\OneDrive\Desktop\hikvision-attendance\configure-terminal.ps1" -Action ExportAttendance -ExportCsvPath "C:\Users\saivi\OneDrive\Desktop\hikvision-attendance\daily-export.csv"'
$trigger = New-ScheduledTaskTrigger -Daily -At "11:59PM"
Register-ScheduledTask -TaskName "HikvisionAttendanceExport" -Action $action -Trigger $trigger
```

This creates a Windows scheduled task — review it before registering (`Register-ScheduledTask`
modifies your Task Scheduler, so run this line yourself rather than having it run for you
sight-unseen).

## 5. Cloud dashboard (view attendance live, from anywhere)

This lets a manager see who's currently in/out and browse history from their phone,
anywhere — not just on the office WiFi. It works by having this PC periodically push
attendance events up to a small cloud database, which a web page then reads from.
**The terminal itself is never exposed to the internet** — only this cloud sync
direction, one-way, out.

### 5.1 Create the cloud backend (Supabase) — you do this part

1. Go to supabase.com, sign up (free, no card required), create a new project.
2. In the project's **SQL Editor**, paste the contents of `cloud/schema.sql` and run it.
   (Read it first — it creates 3 tables, a view, and read-only security policies.)
3. Go to **Authentication → Users** and manually add one user: the manager's email +
   a password you choose. This is the only login for the dashboard.
4. Go to **Project Settings → API** and copy three values: the **Project URL**, the
   **anon public** key, and the **service_role** key (keep this last one secret — it
   can write to your database, unlike the anon key).

### 5.2 Wire up the local sync agent

Copy `cloud-config.example.json` to `cloud-config.json` and fill in the Project URL
and `service_role` key from above:

```json
{
  "SupabaseUrl": "https://xxxxx.supabase.co",
  "SupabaseServiceRoleKey": "your service_role key"
}
```

Test it manually first:

```powershell
.\configure-terminal.ps1 -Action SyncPeople
.\configure-terminal.ps1 -Action SyncEvents
```

Check Supabase's **Table Editor** to confirm rows appeared in `people` and `events`.

**Live sync (recommended) — event-driven, not time-based.** Rather than checking on
a timer, `configure-terminal.ps1 -Action LiveStream` opens a persistent connection to
the device's own event stream, so a successful check-in/check-out pushes to the
dashboard the instant it happens - no polling delay at all.

Double-click **`Start-Live-Sync.bat`** to start it. Leave the window open (or
minimized) for as long as you want live updates. Closing it just stops new events
from syncing - nothing else breaks.

**Auto-start at every login (no clicking required):** a shortcut is already placed in
your Windows Startup folder (`shell:startup`), so this starts automatically each time
you log in - Task Scheduler blocks automatic startup triggers on this machine, but the
Startup folder doesn't have that restriction. Note this only survives sleep, not a full
shutdown/restart - after those, either wait for next login or double-click the file
yourself. The `.bat` refuses to start a second copy if one's already running (the
device only allows a couple of concurrent connections, and running two would break
both).

One device quirk worth knowing: this terminal only allows a small number of
simultaneous live-stream connections. If it ever gets stuck refusing new connections
(`deployExceedMax` in the log), a normal device reboot (not factory reset - no data
lost) clears it in under a minute:

```powershell
# Only needed if the log shows repeated "deployExceedMax" connection errors
$pass = (Get-Content "C:\Users\saivi\OneDrive\Desktop\hikvision-attendance\device-secrets.json" -Raw | ConvertFrom-Json).HikPassword
$cache = New-Object System.Net.CredentialCache
$cache.Add([Uri]"http://192.168.0.121", "Digest", (New-Object System.Net.NetworkCredential("admin", $pass)))
$req = [System.Net.HttpWebRequest]::Create("http://192.168.0.121/ISAPI/System/reboot")
$req.Credentials = $cache; $req.Method = "PUT"; $req.ContentLength = 0
$req.GetResponse() | Out-Null
```

**If this PC is off or offline, syncing pauses** — the dashboard will show a
"last synced" warning rather than silently going stale.

### 5.3 Deploy the dashboard

1. Open `dashboard\js\supabase-client.js` and fill in the Project URL and **anon**
   key (the anon key is safe to expose publicly — it's protected by the read-only
   policies from `schema.sql`).
2. For a quick test: go to netlify.com/drop and drag the `dashboard` folder in —
   it deploys instantly with a free HTTPS URL, no account needed.
3. For a permanent setup: create a Cloudflare Pages project connected to a git repo
   containing the `dashboard` folder, so future edits redeploy automatically.
4. Open the deployed URL, log in with the manager email/password from step 5.1.3.

### 5.4 What the manager sees

- **Live tab** — a card per person, green "IN" / gray "OUT", updates automatically
  as new scans come in, plus a "last synced" timestamp.
- **History tab** — date range + person filter, results table, "Export CSV" button.

Note: "IN"/"OUT" is inferred by alternating each person's successive successful
scans per day — the terminal itself doesn't report check-in vs. check-out, so this
is a best-effort heuristic, not device truth. A double-scan (e.g. a misread retry)
will flip it incorrectly until their next real scan.

## Notes / things that were verified vs. assumed

- **Verified via live probe:** device IP, MAC, model realm, ports 8000/80 open, ISAPI endpoints
  for time/NTP, UserInfo, CardInfo, FDLib face enrollment, and AcsEvent search all come from
  Hikvision's own ISAPI reference (see sources in chat).
- **Not verified — check yourself:** whether this specific unit has a physical fingerprint
  sensor at all (the "320" series is primarily face+card; run `-Action Capabilities` and read
  `accesscontrol-capabilities.json` before building fingerprint enrollment into your workflow).
- **Network/firewall/Windows Defender changes:** none were made by this script. If Windows
  Firewall blocks outbound requests to port 80/8000 on your LAN, you'll see connection errors
  when running the script — tell me and I'll help you add a specific rule, but I won't change
  firewall config without asking first.
