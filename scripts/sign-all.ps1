# sign-all.ps1
# Assina todos os arquivos EXE, DLL e NODE antes do build final

$signScript = "J:\PROJECTS\signtool.ps1"
$roots = @(
    "J:\Github\SnapAway\dist",
    "J:\Github\SnapAway\out\main",
    "J:\Github\SnapAway\scripts\appx_extracted\app"
)

foreach ($root in $roots) {
    if (Test-Path $root) {
        Get-ChildItem -Path $root -Recurse -Include *.exe,*.dll,*.node | ForEach-Object {
            Write-Host "Assinando $($_.FullName)..."
            & $signScript $_.FullName -Description "SnapAway" -DescriptionURL "https://edenware.app/snapaway"
        }
    }
}
Write-Host "Assinatura em lote concluída."
