$subject = "CN=31770A1C-AE43-4A48-A8CA-86C8455BB6F2"
$pwd = ConvertTo-SecureString -String "snapaway-test" -Force -AsPlainText
$outPfx = Join-Path (Get-Location) 'testcert.pfx'
$outCer = Join-Path (Get-Location) 'testcert.cer'
Write-Host "Generating self-signed cert..."
$cert = New-SelfSignedCertificate -Type CodeSigning -Subject $subject -KeyExportPolicy Exportable -FriendlyName "SnapAway Test Cert" -NotAfter (Get-Date).AddYears(10) -CertStoreLocation "Cert:\CurrentUser\My"
if (-not $cert) {
  Write-Error "Failed to create certificate"
  exit 1
}
Write-Host "Exporting PFX and CER..."
Export-PfxCertificate -Cert $cert -FilePath $outPfx -Password $pwd
Export-Certificate -Cert $cert -FilePath $outCer
Write-Host "Installing .cer to TrustedPeople..."
Import-Certificate -FilePath $outCer -CertStoreLocation "Cert:\CurrentUser\TrustedPeople" | Out-Null
Write-Host "Looking for signtool.exe..."
# Prefer x64/x86 signtool, fall back to any if needed
$signtool = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '\\x64\\' -or $_.FullName -match '\\x86\\' } | Select-Object -First 1 -ExpandProperty FullName
if (-not $signtool) {
  $signtool = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $signtool) {
  Write-Error "signtool.exe not found in Windows Kits"
  exit 2
}
Write-Host "Signing APPX with signtool: $signtool"
& $signtool sign /fd SHA256 /f $outPfx /p "snapaway-test" (Join-Path (Get-Location) "dist\SnapAway_1.0.0_win_x64.appx")
if ($LASTEXITCODE -ne 0) {
  Write-Error "signtool failed"
  exit 3
}
Write-Host "Signing successful. Installing APPX..."
Add-AppxPackage -Path (Join-Path (Get-Location) "dist\SnapAway_1.0.0_win_x64.appx") -ForceApplicationShutdown
Write-Host "Done."