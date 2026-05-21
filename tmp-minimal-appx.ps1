$makeappx = 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.19041.0\x64\makeappx.exe'
$signtool = 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.19041.0\x64\signtool.exe'
$cert = Join-Path $PSScriptRoot 'testappxleaf.pfx'
if (-not (Test-Path $makeappx)) { Write-Error 'makeappx not found'; exit 1 }
if (-not (Test-Path $signtool)) { Write-Error 'signtool not found'; exit 1 }
if (-not (Test-Path $cert)) { Write-Error 'cert not found'; exit 1 }
$tmp = Join-Path $env:TEMP 'SnapAwayMinimalAppx'
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp
New-Item -ItemType Directory -Path $tmp | Out-Null
$manifest = @"
<?xml version='1.0' encoding='utf-8'?>
<Package xmlns='http://schemas.microsoft.com/appx/manifest/foundation/windows10' xmlns:uap='http://schemas.microsoft.com/appx/manifest/uap/windows10' xmlns:rescap='http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities'>
  <Identity Name='Edenware.app.Snapcover.Minimal' Publisher='CN=31770A1C-AE43-4A48-A8CA-86C8455BB6F2' Version='1.0.0.0' ProcessorArchitecture='x64'/>
  <Properties><DisplayName>SnapAwayMinimal</DisplayName><PublisherDisplayName>Edenware</PublisherDisplayName><Description>Test package</Description><Logo>logo.png</Logo></Properties>
  <Resources>
    <Resource Language='en-US'/>
  </Resources>
  <Capabilities>
    <rescap:Capability Name='runFullTrust'/>
  </Capabilities>
  <Dependencies><TargetDeviceFamily Name='Windows.Desktop' MinVersion='10.0.14316.0' MaxVersionTested='10.0.14316.0'/></Dependencies>
  <Applications><Application Id='App' Executable='app.exe' EntryPoint='Windows.FullTrustApplication'><uap:VisualElements BackgroundColor='transparent' DisplayName='SnapAwayMinimal' Square150x150Logo='logo.png' Square44x44Logo='logo.png' Description='Test package'/></Application></Applications>
</Package>
"@
Set-Content -Path (Join-Path $tmp 'AppxManifest.xml') -Value $manifest -Encoding utf8
Set-Content -Path (Join-Path $tmp 'app.exe') -Value 'dummy' -Encoding ascii
Set-Content -Path (Join-Path $tmp 'logo.png') -Value '' -Encoding ascii
$package = Join-Path $env:TEMP 'SnapAwayMinimal.appx'
Remove-Item -Force -ErrorAction SilentlyContinue $package
& $makeappx pack /d $tmp /p $package
Write-Host 'Pack status' $LASTEXITCODE
& $signtool sign /fd SHA256 /f $cert /p 'snapaway-test' /td SHA256 /tr http://timestamp.sectigo.com /a /v $package
Write-Host 'Sign status' $LASTEXITCODE
& $signtool verify /pa /v $package
Write-Host 'Verify status' $LASTEXITCODE
try { Add-AppxPackage -Path $package -ForceApplicationShutdown -Verbose; Write-Host 'Minimal appx installed OK' } catch { Write-Host 'Minimal install failed:' $_.Exception.Message; if ($_.Exception.InnerException) { $_.Exception.InnerException.Message } }
