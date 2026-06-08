# ==============================================================
# DocuIA — Inicio rápido (después del setup inicial)
# Ejecuta: START.bat  o  doble clic en START.bat
# ==============================================================

$ErrorActionPreference = "Continue"
$Host.UI.RawUI.WindowTitle = "DocuIA Start"

function Write-Step { param($msg) Write-Host "`n  ► $msg" -ForegroundColor Cyan }
function Write-OK   { param($msg) Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "  ⚠ $msg" -ForegroundColor Yellow }
function Write-Fail { param($msg) Write-Host "`n  ✗ $msg" -ForegroundColor Red }

Clear-Host
Write-Host ""
Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor DarkCyan
Write-Host "  ║        DocuIA — Inicio rápido         ║" -ForegroundColor DarkCyan
Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor DarkCyan
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# ── Verificar setup previo ─────────────────────────────────────
if (-not (Test-Path ".env.local")) {
  Write-Fail ".env.local no encontrado. Ejecuta SETUP.bat primero."
  Read-Host "Presiona Enter para salir"; exit 1
}
if (-not (Test-Path "node_modules")) {
  Write-Fail "node_modules no encontrado. Ejecuta SETUP.bat primero."
  Read-Host "Presiona Enter para salir"; exit 1
}

# ── Docker ─────────────────────────────────────────────────────
Write-Step "Verificando Docker..."
docker info 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Warn "Docker no responde — intentando igualmente..."
}

Write-Step "Levantando contenedores (PostgreSQL + MinIO)..."
docker compose up -d
if ($LASTEXITCODE -ne 0) {
  Write-Fail "docker compose up falló. ¿Está Docker Desktop abierto?"
  Read-Host "Presiona Enter para salir"; exit 1
}
Write-OK "Contenedores activos"

# ── Esperar PostgreSQL ─────────────────────────────────────────
Write-Step "Esperando PostgreSQL..."
$pgReady = $false
for ($i = 0; $i -lt 20; $i++) {
  docker exec docuia-postgres pg_isready -U docuia_user -d docuia 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $pgReady = $true; break }
  Write-Host "  . esperando ($($i+1)/20)..." -ForegroundColor DarkGray
  Start-Sleep -Seconds 2
}
if (-not $pgReady) {
  Write-Warn "PostgreSQL tardó — el servidor puede no conectar al primer intento"
} else {
  Write-OK "PostgreSQL listo"
}

# ── Dev server ─────────────────────────────────────────────────
Write-Step "Iniciando Next.js dev server..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$scriptDir'; npm run dev" -WindowStyle Normal
Start-Sleep -Seconds 5
Start-Process "http://localhost:3000/login"

# ── Info ───────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔═══════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║   ✓  DocuIA corriendo en http://localhost:3000    ║" -ForegroundColor Green
Write-Host "  ╚═══════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Panel admin   →  http://localhost:3000/admin/login" -ForegroundColor White
Write-Host "  Login tenant  →  http://localhost:3000/login" -ForegroundColor White
Write-Host ""
Write-Host "  ┌─ Superadmin ──────────────────────────────────────" -ForegroundColor DarkCyan
Write-Host "  │  Email:      admin@docuia.com" -ForegroundColor White
Write-Host "  │  Contraseña: DocuIA2024!" -ForegroundColor White
Write-Host "  └────────────────────────────────────────────────────" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  ┌─ Demo tenant ─────────────────────────────────────" -ForegroundColor DarkCyan
Write-Host "  │  Email:      carlos@acme.mx" -ForegroundColor White
Write-Host "  │  Contraseña: Demo1234!" -ForegroundColor White
Write-Host "  └────────────────────────────────────────────────────" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  Para detener: cierra la ventana 'npm run dev'" -ForegroundColor DarkGray
Write-Host ""
Read-Host "  Presiona Enter para cerrar"
