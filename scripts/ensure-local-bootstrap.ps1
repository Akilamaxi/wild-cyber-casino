$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath '.env')) { throw '.env does not exist.' }
$content = Get-Content -LiteralPath '.env'
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
    function Add-IfMissing([string]$Name, [string]$Value) {
        if (-not ($content | Where-Object { $_ -match ('^' + [regex]::Escape($Name) + '=') })) {
            Add-Content -Encoding ascii -LiteralPath '.env' -Value ($Name + '=' + $Value)
        }
    }
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $password = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
    Add-IfMissing 'ENABLE_LOCAL_BOOTSTRAP' 'true'
    Add-IfMissing 'BOOTSTRAP_ADMIN_EMAIL' 'admin@casino.com'
    Add-IfMissing 'BOOTSTRAP_ADMIN_PASSWORD' $password
}
finally { $rng.Dispose() }
