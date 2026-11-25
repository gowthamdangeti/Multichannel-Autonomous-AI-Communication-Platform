$repoRoot = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $repoRoot "api\.env"
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^([^#=]+)="?([^"]*)"?\s*$') {
        Set-Content -Path "env:$($matches[1])" -Value $matches[2]
    }
}
$python = Join-Path $repoRoot "venv\Scripts\python.exe"
& $python -m uvicorn api.app:app --reload --port 8000
