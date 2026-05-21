$publisherSubject = 'CN=31770A1C-AE43-4A48-A8CA-86C8455BB6F2'
$rootSubject = 'CN=SnapAway Test Root'
$pwd = ConvertTo-SecureString 'snapaway-test' -Force -AsPlainText
$pfxPath = Join-Path (Get-Location) 'testappxleaf.pfx'
$rootCer = Join-Path (Get-Location) 'testappxroot.cer'
$rootPfx = Join-Path (Get-Location) 'testappxroot.pfx'
Remove-Item -ErrorAction SilentlyContinue $pfxPath,$rootCer,$rootPfx,testappxcert.cer,testappxcert.pfx
Write-Host 'Generating root CA certificate...'
$root = New-SelfSignedCertificate -Type Custom -Subject $rootSubject -KeyAlgorithm RSA -KeyLength 2048 -KeyExportPolicy Exportable -KeyUsage CertSign,CRLSign,DigitalSignature -TextExtension '2.5.29.19={text}CA=TRUE&pathlength=0' -CertStoreLocation Cert:\CurrentUser\My
if (-not $root) { Write-Error 'Root certificate creation failed'; exit 1 }
Write-Host 'Generating code signing certificate signed by root...'
$leaf = New-SelfSignedCertificate -Type Custom -Subject $publisherSubject -KeyAlgorithm RSA -KeyLength 2048 -KeyExportPolicy Exportable -KeyUsage DigitalSignature -TextExtension '2.5.29.37={text}1.3.6.1.5.5.7.3.3' -CertStoreLocation Cert:\CurrentUser\My -Signer $root
if (-not $leaf) { Write-Error 'Leaf certificate creation failed'; exit 2 }
Write-Host 'Exporting certificates...'
Export-PfxCertificate -Cert $leaf -FilePath $pfxPath -Password $pwd
Export-Certificate -Cert $root -FilePath $rootCer
Write-Host 'Importing root CA into Trusted Root...'
Import-Certificate -FilePath $rootCer -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
Write-Host 'Signing AppX...'
$signtool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '\\x64\\' } | Select-Object -First 1 -ExpandProperty FullName
if (-not $signtool) { $signtool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName }
if (-not $signtool) { Write-Error 'signtool.exe not found'; exit 3 }
& $signtool sign /v /fd SHA256 /sha1 $leaf.Thumbprint /f $pfxPath /p 'snapaway-test' .\dist\SnapAway_1.0.0_win_x64.appx
if ($LASTEXITCODE -ne 0) { Write-Error 'signtool signing failed'; exit 4 }
Write-Host 'Installing AppX package...'
Add-AppxPackage -Path .\dist\SnapAway_1.0.0_win_x64.appx -ForceApplicationShutdown
Write-Host 'APPX_INSTALLED_OK'