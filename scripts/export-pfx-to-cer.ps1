param(
    [string]$PfxPath = 'dist\appx-local-test-cert.pfx',
    [string]$Password = 'SnapAway123!'
)

$fullPfx = Resolve-Path $PfxPath
if (-not $fullPfx) {
    Write-Error "PFX file not found: $PfxPath"
    exit 1
}

$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($fullPfx, $Password, [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable)
$cerPath = [System.IO.Path]::ChangeExtension($fullPfx, '.cer')
[System.IO.File]::WriteAllBytes($cerPath, $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))
Write-Host "Exported CER: $cerPath"
