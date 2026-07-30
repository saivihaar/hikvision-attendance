$existing = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like "*configure-terminal.ps1*LiveStream*" -and $_.ProcessId -ne $PID }
if ($existing) { exit 1 } else { exit 0 }
