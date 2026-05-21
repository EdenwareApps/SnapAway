$paths = @('C:\Program Files','C:\Program Files (x86)','C:\Users','J:\Github\SnapAway')
Write-Output "Starting search at: $(Get-Date) by $(whoami)"
foreach ($p in $paths) {
    Write-Output "Searching $p"
    try {
        Get-ChildItem -Path $p -Filter 'SnapAway.exe' -Recurse -ErrorAction SilentlyContinue -Force | Select-Object FullName
    } catch {
        Write-Output ("Error searching {0}: {1}" -f $p, $_)
    }
}
