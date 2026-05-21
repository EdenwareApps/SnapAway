# sign-installer.ps1
# Assina o instalador NSIS gerado pelo electron-builder

$signScript = "J:\PROJECTS\signtool.ps1"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$distDir = Resolve-Path -Path (Join-Path $scriptDir '..\dist') -ErrorAction SilentlyContinue

if ($env:SKIP_PE_SIGN -eq '1' -or $env:SKIP_PE_SIGN -eq 'true') {
    Write-Host "SKIP_PE_SIGN is set; skipping installer signing."
    exit 0
}

if (-not $distDir) {
    Write-Warning "Dist directory not found. Expected at: $(Join-Path $scriptDir '..\dist')"
    exit 0
}

# O Include só funciona corretamente quando o path contém wildcard.
# Aqui processamos EXE/DLL/NODE (PE) via script externo e AppX via signtool.exe
Get-ChildItem -Path "$distDir\*" -File -Include *.exe,*.dll,*.node | ForEach-Object {
    Write-Host "Assinando PE: $($_.FullName)"
    & $signScript $_.FullName -Description "SnapAway" -DescriptionURL "https://edenware.app/snapaway"
}

# AppX package is not a PE executable; sign with signtool.exe directly
if ($env:SKIP_APPX_SIGN -eq '1' -or $env:SKIP_APPX_SIGN -eq 'true') {
    Write-Host "SKIP_APPX_SIGN is set; skipping AppX signing."
    return
}
$appxFiles = Get-ChildItem -Path "$distDir\*" -File -Include *.appx
if ($appxFiles) {
    $signToolExe = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '\\x64\\' } | Select-Object -First 1 -ExpandProperty FullName
    if (-not $signToolExe) {
        $signToolExe = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '\\x86\\' } | Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $signToolExe) {
        Write-Warning "signtool.exe não encontrado para assinatura AppX. Instale o Windows SDK."
    } else {
        Write-Host "Using signtool: $signToolExe"
        foreach ($appx in $appxFiles) {
            Write-Host "Assinando AppX: $($appx.FullName)"

            $pfxPath = if ($env:APPX_CERT_PFX_PATH) { $env:APPX_CERT_PFX_PATH } else { Join-Path $distDir 'appx-local-test-cert.pfx' }
            $pfxPassword = if ($env:APPX_CERT_PFX_PASSWORD) { $env:APPX_CERT_PFX_PASSWORD } else { 'SnapAway123!' }
            if (Test-Path $pfxPath) {
                Write-Host "Using local PFX for AppX signing: $pfxPath"
                & $signToolExe sign /fd SHA256 /f "$pfxPath" /p "$pfxPassword" /td SHA256 "$($appx.FullName)"
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "AppX assinado com sucesso: $($appx.FullName)"
                    continue
                }
                Write-Warning "Local PFX signing failed with code $LASTEXITCODE; falling back to store certificate."
            }

            # Extract publisher from AppxManifest.xml (supports single or double quotes)
            $publisher = $null
            try {
                Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue | Out-Null
                $zip = [System.IO.Compression.ZipFile]::OpenRead($appx.FullName)
                $entry = $zip.Entries | Where-Object { $_.FullName -eq 'AppxManifest.xml' } | Select-Object -First 1
                if ($entry) {
                    $reader = New-Object System.IO.StreamReader($entry.Open())
                    $manifest = $reader.ReadToEnd()
                    $reader.Close()
                    $m = [regex]::Match($manifest, 'Publisher\s*=\s*["'']([^"'']+)["'']')
                    if ($m.Success) {
                        $publisher = $m.Groups[1].Value
                    }
                }
                $zip.Dispose()
            } catch {
                Write-Warning "Não foi possível ler AppxManifest.xml para detectar Publisher automaticamente."
            }

            $cert = $null
            if ($env:APPX_CERT_THUMBPRINT) {
                $thumb = ($env:APPX_CERT_THUMBPRINT -replace '\s','').ToUpperInvariant()
                $cert = @(Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $thumb -and $_.HasPrivateKey } | Select-Object -First 1)
                if (-not $cert) {
                    $cert = @(Get-ChildItem Cert:\LocalMachine\My -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $thumb -and $_.HasPrivateKey } | Select-Object -First 1)
                }
                if (-not $cert) {
                    Write-Warning "APPX_CERT_THUMBPRINT definido, mas certificado não encontrado: $thumb"
                }
            }

            if (-not $cert -and $env:APPX_CERT_SUBJECT) {
                $sub = $env:APPX_CERT_SUBJECT
                $cert = @(Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue | Where-Object { $_.Subject -eq $sub -and $_.HasPrivateKey } | Sort-Object NotAfter -Descending | Select-Object -First 1)
                if (-not $cert) {
                    $cert = @(Get-ChildItem Cert:\LocalMachine\My -ErrorAction SilentlyContinue | Where-Object { $_.Subject -eq $sub -and $_.HasPrivateKey } | Sort-Object NotAfter -Descending | Select-Object -First 1)
                }
                if (-not $cert) {
                    Write-Warning "APPX_CERT_SUBJECT definido, mas certificado não encontrado: $sub"
                }
            }

            if (-not $cert -and $publisher) {
                $cert = @(Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue | Where-Object { $_.Subject -eq $publisher -and $_.HasPrivateKey } | Sort-Object NotAfter -Descending | Select-Object -First 1)
                if (-not $cert) {
                    $cert = @(Get-ChildItem Cert:\LocalMachine\My -ErrorAction SilentlyContinue | Where-Object { $_.Subject -eq $publisher -and $_.HasPrivateKey } | Sort-Object NotAfter -Descending | Select-Object -First 1)
                }
            }

            if ($cert) {
                Write-Host "Using store certificate: $($cert.Subject) [$($cert.Thumbprint)]"
                & $signToolExe sign /fd SHA256 /sha1 $($cert.Thumbprint) /tr http://timestamp.sectigo.com /td SHA256 "$($appx.FullName)"
            } else {
                Write-Warning "Nenhum certificado válido disponível para assinatura AppX."
                Write-Warning "Instale/importe um certificado com Subject igual ao Publisher do AppxManifest ($publisher), ou defina APPX_CERT_THUMBPRINT."
            }
            if ($LASTEXITCODE -ne 0) {
                Write-Warning "Falha ao assinar AppX: $($appx.FullName) (codigo $LASTEXITCODE)"
            } else {
                Write-Host "AppX assinado com sucesso: $($appx.FullName)"
                Write-Host "Certificado usado: $($cert.Subject) [thumbprint: $($cert.Thumbprint)]"
                Write-Host "Se a instalação do APPX falhar com 0x800B0109, importe manualmente o certificado raiz na store Confiável do Windows."
            }
        }
    }
}

Write-Host "Assinatura de instaladores concluída."
