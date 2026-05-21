# build-helper.ps1
# Compila SnapAwayHelper.cpp para SnapAwayHelper.exe usando cl.exe (Visual Studio developer tools)

$helperDir = Join-Path $PSScriptRoot "..\src\helper"
$source = Join-Path $helperDir "SnapAwayHelper.cpp"
$output = Join-Path $helperDir "SnapAwayHelper.exe"

if (-not (Test-Path $source)) {
    Write-Error "Arquivo de fonte do helper não encontrado: $source"
    exit 1
}

# Caminho fixo preferencial de cl.exe (determinístico para este ambiente de build)
$clPath = "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Tools\MSVC\14.29.30133\bin\Hostx64\x64\cl.exe"
if (-not (Test-Path $clPath)) {
    $clCommand = Get-Command cl.exe -ErrorAction SilentlyContinue
    if (-not $clCommand) {
        Write-Warning "compilador cl.exe não encontrado no PATH e nem no caminho fixo. Pule a compilação, mas será necessário compilar manualmente para uso de helper elevado."
        return 0
    }
    $clPath = $clCommand.Source
}

$vcvarsall = "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvarsall.bat"
if (-not (Test-Path $vcvarsall)) {
    Write-Warning "vcvarsall.bat não encontrado; compilação será tentada apenas com cl.exe, mas pode falhar sem variáveis de ambiente do cl."
}

Push-Location $helperDir
try {
    Write-Host "Compilando helper com cl: $clPath"

    if (Test-Path $vcvarsall) {
        # Usa cl via PATH após vcvarsall para evitar mspdbcore.dll não encontrado
        $cmd = "`"$vcvarsall`" x64 && cl /nologo /EHsc /std:c++17 /O2 `"SnapAwayHelper.cpp`" /Fe:`"SnapAwayHelper.exe`" /link user32.lib advapi32.lib"
        $psResult = cmd /c $cmd
        $exitCode = $LASTEXITCODE
        Write-Host $psResult
    } else {
        & "$clPath" /nologo /EHsc /std:c++17 /O2 "SnapAwayHelper.cpp" /Fe:"SnapAwayHelper.exe" /link user32.lib advapi32.lib
        $exitCode = $LASTEXITCODE
    }

    if ($exitCode -ne 0) {
        Write-Error "Falha na compilação do helper (cl.exe resultado $exitCode)"
        exit $exitCode
    }
    Write-Host "Helper compilado com sucesso em $output"
    return 0
} finally {
    Pop-Location
}
