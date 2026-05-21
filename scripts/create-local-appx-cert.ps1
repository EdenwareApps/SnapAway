param(
    [string]$Subject = 'CN=31770A1C-AE43-4A48-A8CA-86C8455BB6F2',
    [string]$OutputPfx = 'dist\appx-local-test-cert.pfx',
    [string]$Password = 'SnapAway123!',
    [switch]$Trust
)

Write-Host "Creating local AppX code signing certificate with subject: $Subject"

$securePassword = ConvertTo-SecureString -String $Password -Force -AsPlainText

$cert = New-SelfSignedCertificate `
    -Subject $Subject `
    -Type CodeSigningCert `
    -KeyUsage DigitalSignature `
    -CertStoreLocation Cert:\CurrentUser\My `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -FriendlyName 'SnapAway Local AppX Test Cert' `
    -NotAfter (Get-Date).AddYears(5) `
    -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3')

if (-not $cert) {
    Write-Error 'Failed to create local AppX certificate.'
    exit 1
}

if (-not (Test-Path (Split-Path $OutputPfx))) {
    New-Item -ItemType Directory -Path (Split-Path $OutputPfx) -Force | Out-Null
}

Export-PfxCertificate -Cert $cert -FilePath $OutputPfx -Password $securePassword -Force | Out-Null
Write-Host "Generated PFX: $OutputPfx"
Write-Host "Thumbprint: $($cert.Thumbprint)"
Write-Host "Subject: $($cert.Subject)"

if ($Trust) {
    $cerPath = [System.IO.Path]::ChangeExtension($OutputPfx, '.cer')
    Export-Certificate -Cert $cert -FilePath $cerPath -Force | Out-Null
    Import-Certificate -FilePath $cerPath -CertStoreLocation Cert:\CurrentUser\TrustedPeople | Out-Null
    Import-Certificate -FilePath $cerPath -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
    Write-Host "Trusted cert imported to CurrentUser\TrustedPeople and CurrentUser\Root"
}
