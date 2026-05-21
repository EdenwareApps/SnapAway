$store = Get-ChildItem Cert:\CurrentUser\My
foreach ($cert in $store) {
    $match = $cert.Subject -like '*E9684142-39BB-4F4C-9106-0D71707084A5*'
    $flag = if ($match) { '[MATCH]' } else { '       ' }
    Write-Host "$flag $($cert.Subject) :: $($cert.Thumbprint) :: HasPrivateKey=$($cert.HasPrivateKey) :: NotAfter=$($cert.NotAfter)"
}
