$ErrorActionPreference = 'Stop'

$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
    function New-HexSecret {
        $bytes = New-Object byte[] 32
        $rng.GetBytes($bytes)
        return [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
    }

    @(
        'JWT_SECRET=' + (New-HexSecret)
        'POSTGRES_PASSWORD=' + (New-HexSecret)
        'REDIS_PASSWORD=' + (New-HexSecret)
        'PAYMENT_WEBHOOK_SECRET=' + (New-HexSecret)
        'AUDIT_HMAC_SECRET=' + (New-HexSecret)
        'ADMIN_MFA_SECRET='
        'ADMIN_MFA_REQUIRED=false'
        'ALLOW_MOCK_PAYMENTS=true'
        'CORS_ORIGINS=http://localhost:8080'
        'ADMIN_CORS_ORIGINS=http://localhost:8080'
    ) | Set-Content -Encoding ascii -LiteralPath '.env'
}
finally {
    $rng.Dispose()
}
