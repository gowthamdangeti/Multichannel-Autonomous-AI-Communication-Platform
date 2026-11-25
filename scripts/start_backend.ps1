$repoRoot = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $repoRoot "api\.env"
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^([^#=]+)="?([^"]*)"?\s*$') {
        Set-Content -Path "env:$($matches[1])" -Value $matches[2]
    }
}
$env:PYTHONPATH = $repoRoot
$python = "D:\v3.convozent\venv\Scripts\python.exe"
if (!(Test-Path $python)) {
    $python = Join-Path $repoRoot "venv\Scripts\python.exe"
}
& $python -m uvicorn api.app:app --host 0.0.0.0 --port 8000 --reload --reload-dir "$repoRoot\api"
