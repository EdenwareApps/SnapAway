#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fix APPX package: Add MSIXAppInstallerData.xml to package root
This runs AFTER electron-builder creates the APPX
It unpacks, adds the file at root level, and repacks correctly
"""

import os
import sys
import shutil
import zipfile
import subprocess
from pathlib import Path
import io

# Configure UTF-8 output
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def find_makeappx():
    # Tenta localizar o makeappx.exe em locais comuns do Windows SDK
    import glob
    base = Path('C:/Program Files (x86)/Windows Kits/10/bin')
    if not base.exists():
        return None
    # Procura por makeappx.exe na pasta bin
    for version in sorted(base.iterdir(), reverse=True):
        exe = version / 'x64' / 'makeappx.exe'
        if exe.exists():
            return str(exe)
    return None

def fix_appx_package():
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    
    # Use the most recent APPX file (could be named with productName variations)
    appx_files = sorted(project_root.joinpath('dist').glob('*.appx'), key=lambda p: p.stat().st_mtime, reverse=True)
    if not appx_files:
        print('✗ Nenhum arquivo APPX encontrado em dist')
        return False
    appx_file = appx_files[0]
    temp_dir = project_root / 'dist' / 'appx-temp-fix'
    backup_file = Path(str(appx_file) + '.backup')
    
    # Check files exist
    if not appx_file.exists():
        print(f'✗ APPX não encontrado: {appx_file}')
        return False
    
    

    try:
        # Backup original
        shutil.copy2(appx_file, backup_file)
        print('✓ Backup criado')

        # Create temp directory
        if temp_dir.exists():
            shutil.rmtree(temp_dir)
        temp_dir.mkdir(parents=True, exist_ok=True)

        # Unpack APPX (é só um ZIP)
        print('↓ Decompactando APPX...')
        with zipfile.ZipFile(appx_file, 'r') as zip_ref:
            zip_ref.extractall(temp_dir)

        # Não adiciona mais MSIXAppInstallerData.xml
        pass

        # Corrige AppxManifest.xml para usar barras + atualizar identidade/publisher/displayname
        manifest_file = temp_dir / 'AppxManifest.xml'
        if manifest_file.exists():
            with open(manifest_file, 'r', encoding='utf-8') as f:
                manifest_content = f.read()
            fixed_manifest = manifest_content.replace('assets\\', 'assets/').replace('app\\', 'app/')

            # Ajuste alinhado com Store (Partner Center)
            fixed_manifest = fixed_manifest.replace('Name="app.edenware.snapaway"', 'Name="Edenware.app.Snapcover"')
            fixed_manifest = fixed_manifest.replace('Name="app.edenware.snapcover"', 'Name="Edenware.app.Snapcover"')
            fixed_manifest = fixed_manifest.replace('Publisher="CN=EDENWARE, O=EDENWARE, S=Rio Grande do Sul, C=BR"', 'Publisher="CN=31770A1C-AE43-4A48-A8CA-86C8455BB6F2"')
            fixed_manifest = fixed_manifest.replace('<DisplayName>SnapAway (with VanishKey)</DisplayName>', '<DisplayName>SnapAway</DisplayName>')
            fixed_manifest = fixed_manifest.replace('<PublisherDisplayName>Edenware.app</PublisherDisplayName>', '<PublisherDisplayName>EdenwareApps</PublisherDisplayName>')
            # Note: at this point 'app\' has already been replaced with 'app/' above
            fixed_manifest = fixed_manifest.replace('Executable="app/SnapAway (with VanishKey).exe"', 'Executable="app/SnapAway.exe"')

            # Normalize executable name in package from encoded form to stable name
            app_exe_dir = temp_dir / 'app'
            encoded_exe = app_exe_dir / 'SnapAway%20%28with%20VanishKey%29.exe'
            fallback_exe = app_exe_dir / 'SnapAway (with VanishKey).exe'
            stable_exe = app_exe_dir / 'SnapAway.exe'
            if encoded_exe.exists() and not stable_exe.exists():
                encoded_exe.replace(stable_exe)
            elif fallback_exe.exists() and not stable_exe.exists():
                fallback_exe.replace(stable_exe)

            # Inject all supported languages into <Resources> if not already present
            languages = ['ar','cs','de','el','en-US','es','fr','hi','hu','it','ja','ko','nl','pl','pt','ru','sv','th','tr','zh-CN']
            import re as _re
            resources_block = '\n'.join(f'    <Resource Language="{lang}" />' for lang in languages)
            resources_section = f'  <Resources>\n{resources_block}\n  </Resources>'
            if '<Resources>' in fixed_manifest:
                fixed_manifest = _re.sub(r'<Resources>.*?</Resources>', resources_section, fixed_manifest, flags=_re.DOTALL)
            else:
                fixed_manifest = fixed_manifest.replace('  <Dependencies>', resources_section + '\n  <Dependencies>')

            with open(manifest_file, 'w', encoding='utf-8') as f:
                f.write(fixed_manifest)
            print('✓ AppxManifest.xml corrigido para usar valores oficiais do Partner Center')

        # Reempacota usando makeappx.exe
        makeappx = find_makeappx()
        if not makeappx:
            print('✗ makeappx.exe não encontrado. Instale o Windows 10 SDK.')
            return False

        # Remove o APPX antigo
        appx_file.unlink()

        # Executa makeappx
        print(f'↑ Reempacotando com makeappx.exe: {makeappx}')
        cmd = [makeappx, 'pack', '/d', str(temp_dir), '/p', str(appx_file)]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print('✗ Erro ao rodar makeappx.exe:')
            print(result.stdout)
            print(result.stderr)
            # Restaura backup
            if backup_file.exists():
                shutil.copy2(backup_file, appx_file)
                backup_file.unlink()
                print('↩ Backup restaurado')
            return False
        print('✓ APPX reempacotado com sucesso')

        # Limpeza
        shutil.rmtree(temp_dir)
        backup_file.unlink()
        print('✓ Limpeza concluída')
        print('\nSe necessário, assine o pacote com signtool:')
        print('  signtool sign /fd SHA256 /a "{}"'.format(appx_file))
        return True

    except Exception as e:
        print(f'✗ Erro ao processar APPX: {e}')
        # Restore backup
        if backup_file.exists():
            shutil.copy2(backup_file, appx_file)
            backup_file.unlink()
            print('↩ Backup restaurado')
        return False

if __name__ == '__main__':
    success = fix_appx_package()
    sys.exit(0 if success else 1)
