# Instala el servicio de vídeo con presentador en esta carpeta (idempotente: se puede repetir).
#   npm run avatar:setup        (desde la raíz del proyecto)
# Requisitos: Python 3.10 (py -3.10), Git, GPU NVIDIA con driver reciente. Descarga ~5 GB.

$ErrorActionPreference = 'Stop'
$ServiceDir = $PSScriptRoot
$JoyVasaDir = Join-Path $ServiceDir 'JoyVASA'
$JoyVasaCommit = '916a90f8de490e8648fee460c1200bd5d9a795af'
$Weights = Join-Path $JoyVasaDir 'pretrained_weights'
$Python = Join-Path $ServiceDir '.venv\Scripts\python.exe'
$env:HF_HUB_DISABLE_PROGRESS_BARS = '1'
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = '1'

function Step($message) { Write-Host "`n==> $message" -ForegroundColor Cyan }

# Ejecuta un programa externo y aborta si falla (los errores nativos no detienen el script solos;
# y en Windows PowerShell 5.1 los avisos de pip por stderr no deben tratarse como error).
function Run {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $args[0] $args[1..($args.Count - 1)] 2>&1 |
            ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" } } |
            Where-Object { $_.Trim() }
    }
    finally { $ErrorActionPreference = $previous }
    if ($LASTEXITCODE -ne 0) { throw "Falló: $($args -join ' ')" }
}

Step 'Comprobando requisitos'
if (-not (Get-Command py -ErrorAction SilentlyContinue)) { throw 'Falta el lanzador "py" de Python. Instala Python 3.10: winget install Python.Python.3.10' }
Run py -3.10 --version
Run git --version
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Host 'ffmpeg no está en el PATH: se instala con winget (abre una terminal nueva después).' -ForegroundColor Yellow
    Run winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements --silent
}

Step "Clonando JoyVASA ($($JoyVasaCommit.Substring(0, 7)))"
if (-not (Test-Path $JoyVasaDir)) {
    Run git clone https://github.com/jdh-algo/JoyVASA.git $JoyVasaDir
}
Run git -C $JoyVasaDir fetch --quiet origin
Run git -C $JoyVasaDir -c advice.detachedHead=false checkout --quiet $JoyVasaCommit

Step 'Creando el entorno virtual (.venv, Python 3.10)'
if (-not (Test-Path $Python)) { Run py -3.10 -m venv (Join-Path $ServiceDir '.venv') }
Run $Python -m pip install --quiet --upgrade pip wheel "setuptools<81"

Step 'Instalando PyTorch con CUDA 12.8 (compatible con RTX 50xx)'
Run $Python -m pip install --quiet torch==2.11.0 torchvision==0.26.0 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cu128

Step 'Instalando el resto de dependencias'
Run $Python -m pip install --quiet -r (Join-Path $ServiceDir 'requirements.txt')
# mediapipe usa opencv-contrib-python; si alguna dependencia añadió opencv-python, ambos pisan el
# mismo módulo cv2: se quita el duplicado y se reinstala el contrib.
$installed = Run $Python -m pip list --format=freeze
if ($installed -match '^opencv-python==') {
    Run $Python -m pip uninstall --quiet -y opencv-python
    Run $Python -m pip install --quiet --force-reinstall --no-deps opencv-contrib-python==5.0.0.93
}

Step 'Descargando pesos (solo modelos con licencia apta para uso comercial)'
# - LivePortrait (MIT): solo la parte humana; NO se descargan los modelos de InsightFace.
# - JoyVASA (MIT) y chinese-hubert-base (MIT). MediaPipe Face Landmarker (Apache 2.0).
Run $Python -c @"
from huggingface_hub import snapshot_download
w = r'$Weights'
snapshot_download('KwaiVGI/LivePortrait', local_dir=w, allow_patterns=['liveportrait/*'])
snapshot_download('jdh-algo/JoyVASA', local_dir=w + r'\JoyVASA', allow_patterns=['motion_generator/*', 'motion_template/*'])
snapshot_download('TencentGameMate/chinese-hubert-base', local_dir=w + r'\chinese-hubert-base', allow_patterns=['config.json', 'preprocessor_config.json', 'pytorch_model.bin'])
"@
$Landmarker = Join-Path $Weights 'mediapipe\face_landmarker.task'
if (-not (Test-Path $Landmarker)) {
    New-Item -ItemType Directory -Force (Split-Path $Landmarker) | Out-Null
    Invoke-WebRequest 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task' -OutFile $Landmarker
}

Step 'Verificando la GPU'
Run $Python -c "import torch; assert torch.cuda.is_available(), 'CUDA no disponible'; print(torch.cuda.get_device_name(0), torch.version.cuda)"

New-Item -ItemType Directory -Force (Join-Path $ServiceDir 'presenter') | Out-Null
Write-Host "`nListo. Pon la imagen del presentador en avatar-service\presenter\ y arranca con: npm run avatar" -ForegroundColor Green
