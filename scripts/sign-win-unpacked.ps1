# sign-win-unpacked.ps1
# Signs binaries inside dist/win-unpacked before NSIS packaging.

$signScript = "J:\PROJECTS\signtool.ps1"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$targetDir = Resolve-Path -Path (Join-Path $scriptDir '..\dist\win-unpacked') -ErrorAction SilentlyContinue

if (-not $targetDir) {
    Write-Host "Diretorio nao encontrado: $(Join-Path $scriptDir '..\dist\win-unpacked')"
    exit 1
}

# Garantir que SnapAway não esteja em execução para evitar erro de arquivo ocupado / formato inválido
$running = Get-Process -Name SnapAway -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "SnapAway em execução detectado; finalizando processo temporariamente para assinatura..."
    $running | Stop-Process -Force
    Start-Sleep -Seconds 1
}

function Test-IsPortableExecutable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath
    )

    try {
        $stream = [System.IO.File]::Open($FilePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try {
            if ($stream.Length -lt 2) {
                return $false
            }

            $buffer = New-Object byte[] 2
            $bytesRead = $stream.Read($buffer, 0, 2)
            return $bytesRead -eq 2 -and $buffer[0] -eq 0x4D -and $buffer[1] -eq 0x5A
        }
        finally {
            $stream.Dispose()
        }
    }
    catch {
        return $false
    }
}

$extensionsToSign = @('.exe', '.dll', '.node')
$explicitPaths = @(
    (Join-Path $targetDir 'resources\src\helper\SnapAwayHelper.exe')
)

$filesToSign = @(
    Get-ChildItem -Path $targetDir -Recurse -File | Where-Object {
        ($extensionsToSign -contains $_.Extension.ToLowerInvariant()) -and (Test-IsPortableExecutable -FilePath $_.FullName)
    }
)

foreach ($explicitPath in $explicitPaths) {
    if ((Test-Path $explicitPath) -and -not ($filesToSign.FullName -contains $explicitPath)) {
        $filesToSign += Get-Item $explicitPath
    }
}

$filesToSign = $filesToSign | Sort-Object FullName -Unique

if (-not $filesToSign -or $filesToSign.Count -eq 0) {
    Write-Host "Nenhum binario elegivel encontrado para assinatura em $targetDir"
    exit 1
}

foreach ($file in $filesToSign) {
    Write-Host "Assinando payload NSIS: $($file.FullName)"
    & $signScript $file.FullName -Description "SnapAway" -DescriptionURL "https://edenware.app/snapaway"

    $signature = Get-AuthenticodeSignature $file.FullName
    if ($signature.Status -ne 'Valid') {
        Write-Error "Falha ao assinar $($file.FullName). Status: $($signature.Status)"
        exit 1
    }
}

Write-Host "Assinatura do payload win-unpacked concluida."
