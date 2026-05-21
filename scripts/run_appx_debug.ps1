$log = "J:\\Github\\SnapAway\\scripts\\appx_debug_all.log"
"--- Run at $(Get-Date) by $(whoami) ---" | Out-File -FilePath $log -Encoding utf8
try {
    "-- AppxDeployment events (last 2 hours) --" | Out-File -FilePath $log -Append -Encoding utf8
    Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-AppxDeployment/Operational'; StartTime=(Get-Date).AddHours(-2)} |
        Where-Object { $_.Message -like "*SnapAway*" -or $_.Message -like "*SnapAway_1.0.0*" } |
        Format-List TimeCreated,Id,LevelDisplayName,Message | Out-File -FilePath $log -Append -Encoding utf8
} catch {
    "Error reading AppxDeployment events: $_" | Out-File -FilePath $log -Append -Encoding utf8
}

try {
    "-- Get-AppxPackage -AllUsers (filter SnapAway) --" | Out-File -FilePath $log -Append -Encoding utf8
    Get-AppxPackage -AllUsers | Where-Object { $_.Name -like "*SnapAway*" -or $_.PackageFullName -like "*SnapAway*" } | Select Name, PackageFullName, InstallLocation | Format-List | Out-File -FilePath $log -Append -Encoding utf8
} catch {
    "Error listing AppxPackage -AllUsers: $_" | Out-File -FilePath $log -Append -Encoding utf8
}

try {
    "-- WindowsApps directories matching SnapAway --" | Out-File -FilePath $log -Append -Encoding utf8
    Get-ChildItem 'C:\\Program Files\\WindowsApps' -Directory | Where-Object { $_.Name -like "*SnapAway*" } | Select Name, FullName | Format-List | Out-File -FilePath $log -Append -Encoding utf8
} catch {
    "Error reading WindowsApps directory: $_" | Out-File -FilePath $log -Append -Encoding utf8
}

"--- Done ---" | Out-File -FilePath $log -Append -Encoding utf8
