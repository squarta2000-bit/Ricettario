$ErrorActionPreference = 'Stop'

$outFile = "$PSScriptRoot\ca-bundle.pem"
if (Test-Path $outFile) { Remove-Item $outFile }

$stores = @("Cert:\LocalMachine\Root", "Cert:\CurrentUser\Root", "Cert:\LocalMachine\CA", "Cert:\CurrentUser\CA")
$found = 0

foreach ($store in $stores) {
    Get-ChildItem -Path $store -ErrorAction SilentlyContinue |
        Where-Object { $_.Subject -like "*Zscaler*" -or $_.Issuer -like "*Zscaler*" } |
        ForEach-Object {
            $b64 = [Convert]::ToBase64String($_.RawData, [System.Base64FormattingOptions]::InsertLineBreaks)
            $pem = "-----BEGIN CERTIFICATE-----`n$b64`n-----END CERTIFICATE-----`n"
            Add-Content -Path $outFile -Value $pem -Encoding ascii
            Write-Host "Added ($store): $($_.Subject)"
            $found++
        }
}

if ($found -eq 0) {
    Write-Host "No Zscaler certificates found in Root/CA stores."
} else {
    Write-Host "Wrote $found cert(s) to $outFile"
}
