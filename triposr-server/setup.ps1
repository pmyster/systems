# ---------------------------------------------------------------------------
# TripoSR local server — one-shot setup (Windows, PowerShell).
#
# Reproduces the working install:
#   1. Clone TripoSR (image -> 3D model, Stability AI / VAST-AI-Research)
#   2. Apply the Windows PyMCubes patch (avoids the torchmcubes source build)
#   3. Create a Python 3.11 venv
#   4. Install PyTorch 2.3.0 + CUDA 12.1, then TripoSR + server deps
#
# Prereqs: Python 3.11 on PATH (py -3.11), git, an NVIDIA GPU w/ recent driver.
# Model weights (~1.7 GB) download automatically on the first server start.
#
# Run from this folder:   powershell -ExecutionPolicy Bypass -File .\setup.ps1
# Then start the server:  .\start-server.bat
# ---------------------------------------------------------------------------

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "[1/5] Cloning TripoSR..." -ForegroundColor Cyan
if (-not (Test-Path "TripoSR")) {
    git clone --depth 1 https://github.com/VAST-AI-Research/TripoSR.git
} else {
    Write-Host "      TripoSR already present — skipping clone."
}

Write-Host "[2/5] Applying PyMCubes patch (Windows-friendly marching cubes)..." -ForegroundColor Cyan
Copy-Item -Force "patches\isosurface.py" "TripoSR\tsr\models\isosurface.py"
# Swap the unbuildable torchmcubes git dep for pip-installable PyMCubes.
(Get-Content "TripoSR\requirements.txt") `
    -replace "git\+https://github.com/tatsy/torchmcubes\.git", "PyMCubes" `
    | Set-Content "TripoSR\requirements.txt"

Write-Host "[3/5] Creating Python 3.11 venv..." -ForegroundColor Cyan
if (-not (Test-Path "venv")) {
    py -3.11 -m venv venv
} else {
    Write-Host "      venv already present — skipping."
}
$py = ".\venv\Scripts\python.exe"

Write-Host "[4/5] Installing PyTorch 2.3.0 + CUDA 12.1 (large download)..." -ForegroundColor Cyan
& $py -m pip install --upgrade pip setuptools wheel
& $py -m pip install torch==2.3.0 torchvision==0.18.0 --index-url https://download.pytorch.org/whl/cu121

Write-Host "[5/5] Installing TripoSR + server dependencies..." -ForegroundColor Cyan
& $py -m pip install -r TripoSR\requirements.txt -r requirements-server.txt
& $py -m pip install onnxruntime  # rembg (background removal) needs this; not auto-pulled

Write-Host ""
Write-Host "Done. Start the server with:  .\start-server.bat" -ForegroundColor Green
Write-Host "First start downloads the model (~1.7 GB) and warms up — give it a couple minutes." -ForegroundColor Green
