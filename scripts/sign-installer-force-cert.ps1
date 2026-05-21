param(
    [string]$thumbprint = '',
    [string]$subject = 'CN=31770A1C-AE43-4A48-A8CA-86C8455BB6F2'
)

function Ensure-LocalAppxPfx {
    param(
        [string]$Subject,
        [string]$OutputPfx,
        [string]$Password
    )

    if (Test-Path $OutputPfx) {
        return (Resolve-Path $OutputPfx).Path
    }

    Write-Host "Local AppX PFX not found; creating one at $OutputPfx"
    & "$PSScriptRoot\create-local-appx-cert.ps1" -Subject $Subject -OutputPfx $OutputPfx -Password $Password -Trust

    if (Test-Path $OutputPfx) {
        return (Resolve-Path $OutputPfx).Path
    }

    return $null
}

if ($thumbprint) {
    $env:APPX_CERT_THUMBPRINT = $thumbprint
    Write-Host "Using APPX_CERT_THUMBPRINT=$thumbprint"
} else {
    # Try to find a local certificate by subject if thumbprint is not provided
    $cert = @(Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue | Where-Object { $_.Subject -eq $subject -and $_.HasPrivateKey }) | Sort-Object NotAfter -Descending | Select-Object -First 1
    if ($cert) {
        $thumbprint = $cert.Thumbprint
        $env:APPX_CERT_THUMBPRINT = $thumbprint
        Write-Host "Found certificate by subject: $subject"
        Write-Host "Using APPX_CERT_THUMBPRINT=$thumbprint"
    } else {
        Write-Warning "Certificate not found by subject: $subject. Generating a new local AppX cert."
        $pfxPath = Ensure-LocalAppxPfx -Subject $subject -OutputPfx $OutputPfx -Password $Password
        if ($pfxPath) {
            $env:APPX_CERT_PFX_PATH = $pfxPath
            $env:APPX_CERT_PFX_PASSWORD = $Password
            Write-Host "Using generated local PFX for AppX signing: $pfxPath"
        } else {
            Write-Warning "Failed to create a local AppX cert PFX. Set -thumbprint or import the local cert."
        }
    }
}

# Call main signing script
& "$PSScriptRoot\sign-installer.ps1"

# Ensure cert chain is trusted for AppX install
function Ensure-AppxCertChainTrusted {
    param([System.Security.Cryptography.X509Certificates.X509Certificate2]$cert)

    if (-not $cert) { return }

    $tmpCer = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), [System.IO.Path]::GetRandomFileName() + '.cer')
    try {
        Export-Certificate -Cert $cert -FilePath $tmpCer -Force | Out-Null
        Import-Certificate -FilePath $tmpCer -CertStoreLocation 'Cert:\CurrentUser\TrustedPeople' | Out-Null
        Write-Host "Imported signer cert to CurrentUser\\TrustedPeople"

        # If self-signed cert, trust as root too; else trust chain root
        $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
        $chain.Build($cert) | Out-Null

        $root = $chain.ChainElements[$chain.ChainElements.Count - 1].Certificate
        if ($root -and $root.Thumbprint -and $root.Thumbprint -ne $cert.Thumbprint) {
            $rootTmp = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), [System.IO.Path]::GetRandomFileName() + '.cer')
            Export-Certificate -Cert $root -FilePath $rootTmp -Force | Out-Null
            Import-Certificate -FilePath $rootTmp -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
            Remove-Item $rootTmp -Force -ErrorAction SilentlyContinue
            Write-Host "Imported chain root to CurrentUser\\Root"
        } elseif ($cert.Subject -eq $cert.Issuer) {
            Import-Certificate -FilePath $tmpCer -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
            Write-Host "Imported self-signed cert to CurrentUser\\Root"
        }

        # Optionally trust system-wide (requires elevation)
        try {
            Import-Certificate -FilePath $tmpCer -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
            Import-Certificate -FilePath $tmpCer -CertStoreLocation 'Cert:\LocalMachine\Root' | Out-Null
            Write-Host "Imported cert to LocalMachine\\TrustedPeople and LocalMachine\\Root"
        } catch {
            Write-Warning "LocalMachine store import failed (run as Admin for system trust): $($_.Exception.Message)"
        }
    } catch {
        Write-Warning "Falha ao importar certificado: $($_.Exception.Message)"
    } finally {
        Remove-Item $tmpCer -Force -ErrorAction SilentlyContinue
    }
}

# Validate
$appx = Get-ChildItem "$PSScriptRoot\..\dist\*.appx" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $appx) { throw 'APPX not found' }

$sig = Get-AuthenticodeSignature -FilePath $appx.FullName
Write-Host "=== AuthenticodeSignature ==="
Write-Host "Status: $($sig.Status)"
Write-Host "StatusMessage: $($sig.StatusMessage)"
Write-Host "Subject: $($sig.SignerCertificate.Subject)"
Write-Host "Thumbprint: $($sig.SignerCertificate.Thumbprint)"

Ensure-AppxCertChainTrusted -cert $sig.SignerCertificate

$signTool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '\\x64\\' } | Select-Object -First 1 -ExpandProperty FullName
if (-not $signTool) { throw 'signtool.exe not found' }

& "$signTool" verify /pa /v "$($appx.FullName)"
Write-Host "=== End verify ==="

# optionally attempt install to verify 0x800B010A
try {
    Add-AppxPackage -Path $appx.FullName -ForceApplicationShutdown -ErrorAction Stop
    Write-Host 'Add-AppxPackage install succeeded'
} catch {
    Write-Host 'Add-AppxPackage failed: ' $_.Exception.Message
}
