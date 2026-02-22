# Add Node.js to PATH for this session
$env:Path = $env:Path + ";C:\Program Files\nodejs"

# Explicitly install vite if missing (just in case)
if (-not (Test-Path "node_modules/.bin/vite.cmd")) {
    Write-Host "Vite not found. Installing..." -ForegroundColor Yellow
    npm install vite
}

# Run dev server by executing the JS file directly with Node
# This avoids issues with .cmd shims and non-ASCII paths (Korean characters)
Write-Host "Starting Development Server (Direct Node Mode)..." -ForegroundColor Green
& "C:\Program Files\nodejs\node.exe" "node_modules/vite/bin/vite.js"
