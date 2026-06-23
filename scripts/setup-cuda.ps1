# ============================================================
# setup-cuda.ps1 — LiangLLM CUDA 后端设置助手
# 下载/配置 NVIDIA CUDA 版本的 llama.cpp
# ============================================================

$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Split-Path $scriptDir -Parent
$projectDir = Split-Path $appDir -Parent

$cudaDir = Join-Path $projectDir "llama-cpp-cuda"
$llamaDir = Join-Path $projectDir "llama-cpp-vulkan"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  LiangLLM CUDA 后端设置助手" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── Check NVIDIA GPU ──────────────────────────

Write-Host "[1/4] 检测 NVIDIA GPU..." -ForegroundColor Yellow
$nvsmi = Get-Command "nvidia-smi" -ErrorAction SilentlyContinue
if ($nvsmi) {
    $gpuInfo = & nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader 2>$null
    if ($gpuInfo) {
        Write-Host "  [OK] NVIDIA GPU 已检测到:" -ForegroundColor Green
        $gpuInfo | ForEach-Object { Write-Host "       $_" }
    } else {
        Write-Host "  [WARN] nvidia-smi 找到但未返回数据" -ForegroundColor Yellow
    }
} else {
    Write-Host "  [WARN] 未找到 nvidia-smi" -ForegroundColor Yellow
    Write-Host "  请确保已安装 NVIDIA 显卡驱动" -ForegroundColor Gray
}

# ── Check CUDA Toolkit ────────────────────────

Write-Host ""
Write-Host "[2/4] 检测 CUDA Toolkit..." -ForegroundColor Yellow
$nvcc = Get-Command "nvcc" -ErrorAction SilentlyContinue
if ($nvcc) {
    $nvccVer = & nvcc --version 2>$null | Select-String "release"
    if ($nvccVer) {
        Write-Host "  [OK] CUDA Toolkit: $($nvccVer.ToString().Trim())" -ForegroundColor Green
    }
} else {
    Write-Host "  [WARN] 未找到 nvcc (CUDA Toolkit)" -ForegroundColor Yellow
    Write-Host "  如果已安装 CUDA 版 llama.cpp，无需 Toolkit" -ForegroundColor Gray
}

# ── Check/Create CUDA backend dir ─────────────

Write-Host ""
Write-Host "[3/4] 检查 CUDA 后端目录..." -ForegroundColor Yellow

if (Test-Path $cudaDir) {
    $exists = Get-ChildItem $cudaDir -Filter "llama-server.exe"
    if ($exists) {
        Write-Host "  [OK] CUDA 后端已就绪: $($exists[0].Name)" -ForegroundColor Green
        Write-Host "       $cudaDir" -ForegroundColor Gray
    } else {
        Write-Host "  [WARN] 目录存在但未找到 llama-server.exe" -ForegroundColor Yellow
        Write-Host "  请将 CUDA 版本的 llama.cpp 文件放入:" -ForegroundColor Cyan
        Write-Host "    $cudaDir" -ForegroundColor Gray
        Write-Host ""
        Write-Host "  下载方式:" -ForegroundColor Cyan
        Write-Host "    1. 访问 https://github.com/ggml-org/llama.cpp/releases" -ForegroundColor Gray
        Write-Host "    2. 下载 llama-bXXXX-bin-win-cuda-x64.zip" -ForegroundColor Gray
        Write-Host "    3. 解压到 $cudaDir" -ForegroundColor Gray
        Write-Host ""
        Write-Host "  或自行编译:" -ForegroundColor Cyan
        Write-Host "    git clone https://github.com/ggml-org/llama.cpp" -ForegroundColor Gray
        Write-Host "    cd llama.cpp && mkdir build && cd build" -ForegroundColor Gray
        Write-Host '    cmake .. -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release' -ForegroundColor Gray
        Write-Host "    cmake --build . --config Release" -ForegroundColor Gray
        Write-Host "    将 build/bin/Release/ 下的文件复制到 $cudaDir" -ForegroundColor Gray
    }
} else {
    Write-Host "  [INFO] CUDA 后端目录不存在，创建中..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $cudaDir -Force | Out-Null
    Write-Host "  已创建: $cudaDir" -ForegroundColor Green
    Write-Host "  请放入 CUDA 版本的 llama.cpp 文件" -ForegroundColor Cyan
}

# ── Current backend status ────────────────────

Write-Host ""
Write-Host "[4/4] 当前后端状态..." -ForegroundColor Yellow

$backends = @()
if (Test-Path (Join-Path $projectDir "llama-cpp-cuda\llama-server.exe")) {
    $backends += "CUDA (可用)"
}
if (Test-Path (Join-Path $projectDir "llama-cpp-vulkan\llama-server.exe")) {
    $backends += "Vulkan (可用)"
}
if (Test-Path (Join-Path $projectDir "llama-cpp-sycl\llama-server.exe")) {
    $backends += "SYCL (可用)"
}

if ($backends.Count -eq 0) {
    Write-Host "  [WARN] 未检测到任何 GPU 后端" -ForegroundColor Red
    Write-Host "  请至少准备一个 GPU 后端才能运行" -ForegroundColor Yellow
} else {
    Write-Host "  [OK] 已检测到以下后端:" -ForegroundColor Green
    $backends | ForEach-Object { Write-Host "    - $_" }
}

Write-Host ""
Write-Host "LiangLLM 会自动选择优先级最高的可用后端: CUDA > Vulkan > SYCL > CPU" -ForegroundColor Cyan
Write-Host ""
