# test-helper.ps1
# Testa o SnapAwayHelper.exe localmente com uma ação dummy e grava o resultado

$helperExe = "J:\Github\SnapAway\src\helper\SnapAwayHelper.exe"
if (-not (Test-Path $helperExe)) {
    Write-Error "Helper não encontrado: $helperExe"
    exit 1
}

$payload = @{ action = 'hide-window'; hwnd = '0' } | ConvertTo-Json -Compress
$payloadBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload))
$resultFile = "$env:TEMP\snapaway-helper-result.json"
if (Test-Path $resultFile) { Remove-Item $resultFile -Force }

$cmd = "& '$helperExe' --payloadBase64 '$payloadBase64' --resultFile '$resultFile'"
Invoke-Expression $cmd

Start-Sleep -Seconds 1
if (-not (Test-Path $resultFile)) {
    Write-Error "Resultado não gerado pelo helper."
    exit 1
}

Write-Host "Resultado do helper:"
Get-Content $resultFile -Raw | Write-Host

$parsed = Get-Content $resultFile -Raw | ConvertFrom-Json
if ($parsed.success -eq $true) {
    Write-Host "Teste do helper ok"
    exit 0
} else {
    Write-Host "Teste do helper falhou: $($parsed.code) - $($parsed.message)"
    exit 2
}
