/**
 * Fix APPX package: Add MSIXAppInstallerData.xml to package root
 * This runs AFTER electron-builder creates the APPX
 * It unpacks, adds the file at root level, and repacks
 */

const fs = require('fs');
const path = require('path');
const exec = require('child_process').execSync;

function fixAppxPackage() {
  const appxFile = path.join(__dirname, '..', 'dist', 'SnapAway_1.0.0_win_x64.appx');
  const msixDataFile = path.join(__dirname, '..', 'MSIXAppInstallerData.xml');
  const tempDir = path.join(__dirname, '..', 'dist', 'appx-temp-fix');
  const backupFile = appxFile + '.backup';

  // Check files exist
  if (!fs.existsSync(appxFile)) {
    console.log('✗ APPX não encontrado:', appxFile);
    return;
  }

  if (!fs.existsSync(msixDataFile)) {
    console.log('✗ MSIXAppInstallerData.xml não encontrado');
    return;
  }

  try {
    // Backup original
    fs.copyFileSync(appxFile, backupFile);
    console.log('✓ Backup criado');

    // Create temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });

    // Unpack APPX (it's just a ZIP)
    console.log('↓ Decompactando APPX...');
    // Renomear .appx para .zip temporariamente (Expand-Archive não reconhece .appx)
    const tempZipFile = appxFile + '.temp.zip';
    fs.renameSync(appxFile, tempZipFile);
    
    // Use Expand-Archive (built-in do PowerShell 5.0+)
    exec(`powershell -NoProfile -Command "Expand-Archive -Path '${tempZipFile}' -DestinationPath '${tempDir}' -Force"`, { encoding: 'utf-8' });
    
    // Remover arquivo .zip temporário
    fs.unlinkSync(tempZipFile);

    // Add MSIXAppInstallerData.xml to root of extracted files
    const targetFile = path.join(tempDir, 'MSIXAppInstallerData.xml');
    fs.copyFileSync(msixDataFile, targetFile);
    console.log('✓ MSIXAppInstallerData.xml adicionado ao pacote');

    // Repack APPX
    console.log('↑ Recompactando APPX...');
    
    // Use Compress-Archive (built-in do PowerShell 5.0+) para .zip temporário
    const tempZipOut = appxFile + '.temp.zip';
    exec(`powershell -NoProfile -Command "Compress-Archive -Path '${tempDir}\\*' -DestinationPath '${tempZipOut}' -Force"`, { encoding: 'utf-8' });
    
    // Renomear .zip de volta para .appx
    fs.renameSync(tempZipOut, appxFile);
    
    console.log('✓ APPX recompactado com sucesso');

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.unlinkSync(backupFile);
    console.log('✓ Limpeza concluída');

  } catch (error) {
    console.error('✗ Erro ao processar APPX:', error.message);
    // Restore backup
    if (fs.existsSync(backupFile)) {
      fs.copyFileSync(backupFile, appxFile);
      fs.unlinkSync(backupFile);
      console.log('↩ Backup restaurado');
    }
    process.exit(1);
  }
}

fixAppxPackage();
