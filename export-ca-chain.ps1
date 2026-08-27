$ErrorActionPreference = 'Stop'

[System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

$req = [System.Net.HttpWebRequest]::Create("https://api.supabase.com")
try {
    $resp = $req.GetResponse()
    $resp.Close()
} catch [System.Net.WebException] {
    if ($_.Exception.Response) { $_.Exception.Response.Close() }
}

$cert = $req.ServicePoint.Certificate
$cert2 = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($cert)

$chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
$chain.ChainPolicy.RevocationMode = [System.Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
$chain.Build($cert2) | Out-Null

$outFile = "$PSScriptRoot\ca-bundle.pem"
if (Test-Path $outFile) { Remove-Item $outFile }

foreach ($element in $chain.ChainElements) {
    $b64 = [Convert]::ToBase64String($element.Certificate.RawData, [System.Base64FormattingOptions]::InsertLineBreaks)
    $pem = "-----BEGIN CERTIFICATE-----`n$b64`n-----END CERTIFICATE-----`n"
    Add-Content -Path $outFile -Value $pem -Encoding ascii
    Write-Host "Added cert: $($element.Certificate.Subject)"
}

Write-Host "Wrote chain to $outFile"

[System.Net.ServicePointManager]::ServerCertificateValidationCallback = $null
