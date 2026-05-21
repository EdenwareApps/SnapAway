param (
    [string]$fileMappingsJson
)

Add-Type -AssemblyName System.Drawing

# Função para sanitizar apenas o nome do arquivo
function Sanitize-Filename($name) {
    $invalidChars = [IO.Path]::GetInvalidFileNameChars() -join ''
    $replacement = "_"
    $sanitized = $name -replace "[$invalidChars]", $replacement
    return $sanitized
}

$fileMappings = $fileMappingsJson | ConvertFrom-Json

foreach ($mapping in $fileMappings) {
    $filePath = $mapping.input
    $outputFile = $mapping.output

    # Separa o diretório e o nome do arquivo
    $outputDir = [System.IO.Path]::GetDirectoryName($outputFile)
    $fileName = [System.IO.Path]::GetFileName($outputFile)

    # Sanitiza somente o nome do arquivo
    $sanitizedFileName = Sanitize-Filename $fileName

    # Reconstrói o caminho completo, preservando o diretório intacto
    $finalOutputFile = Join-Path $outputDir $sanitizedFileName

    # Certifica-se de que o diretório de saída existe
    if (-not (Test-Path $outputDir)) {
        New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
    }

    try {
        $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($filePath)
        if ($null -eq $icon) {
            Write-Error "Failed to extract icon from: $filePath"
            continue
        }

        $bitmap = $icon.ToBitmap()
        $bitmap.Save($finalOutputFile, [System.Drawing.Imaging.ImageFormat]::Png)
        Write-Output "Icon saved to: $finalOutputFile"
    }
    catch {
        Write-Error "Failed to process $filePath : $_"
    }
    finally {
        if ($bitmap) { $bitmap.Dispose() }
        if ($icon) { $icon.Dispose() }
    }
}
