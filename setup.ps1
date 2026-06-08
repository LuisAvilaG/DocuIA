# ==============================================================
# DocuIA — Setup local completo (primera vez)
# Ejecuta: SETUP.bat  o  doble clic en SETUP.bat
# ==============================================================

$ErrorActionPreference = "Continue"
$Host.UI.RawUI.WindowTitle = "DocuIA Setup"

# Credenciales fijas de superadmin
$ADMIN_EMAIL    = "admin@docuia.com"
$ADMIN_PASSWORD = "DocuIA2024!"

function Write-Step  { param($msg) Write-Host "`n  ► $msg" -ForegroundColor Cyan }
function Write-OK    { param($msg) Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "  ⚠ $msg" -ForegroundColor Yellow }
function Write-Fail  { param($msg) Write-Host "`n  ✗ $msg" -ForegroundColor Red }
function Write-Title {
  Clear-Host
  Write-Host ""
  Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor DarkCyan
  Write-Host "  ║       DocuIA — Setup Local            ║" -ForegroundColor DarkCyan
  Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor DarkCyan
  Write-Host ""
}

Write-Title

# ── Directorio del script ──────────────────────────────────────
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir
Write-OK "Directorio: $scriptDir"

# ── 1. Node.js ─────────────────────────────────────────────────
Write-Step "Verificando Node.js..."
$nodeVersion = node --version 2>$null
if ($LASTEXITCODE -ne 0 -or -not $nodeVersion) {
  Write-Fail "Node.js no encontrado. Instálalo desde https://nodejs.org"
  Read-Host "Presiona Enter para salir"; exit 1
}
Write-OK "Node.js $nodeVersion"

# ── 2. Docker ──────────────────────────────────────────────────
Write-Step "Verificando Docker..."
$dockerVersion = docker --version 2>$null
if ($LASTEXITCODE -ne 0 -or -not $dockerVersion) {
  Write-Fail "Docker no encontrado. Instala Docker Desktop desde https://docker.com"
  Read-Host "Presiona Enter para salir"; exit 1
}
Write-OK "Docker: $dockerVersion"

# ── 3. Esperar daemon Docker ───────────────────────────────────
Write-Step "Esperando que Docker Desktop esté activo..."
Write-Host "  (Si Docker Desktop no está abierto, ábrelo ahora)" -ForegroundColor DarkGray
$dockerReady = $false
for ($i = 0; $i -lt 30; $i++) {
  docker info 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $dockerReady = $true; break }
  Write-Host "  . esperando Docker ($($i+1)/30)..." -ForegroundColor DarkGray
  Start-Sleep -Seconds 2
}
if (-not $dockerReady) {
  Write-Fail "Docker no respondió. Abre Docker Desktop y vuelve a intentar."
  Read-Host "Presiona Enter para salir"; exit 1
}
Write-OK "Docker activo"

# ── 4. npm install ─────────────────────────────────────────────
if (-not (Test-Path "node_modules")) {
  Write-Step "Instalando dependencias npm..."
  npm install --silent
  if ($LASTEXITCODE -ne 0) {
    Write-Fail "npm install falló"
    Read-Host "Presiona Enter para salir"; exit 1
  }
  Write-OK "Dependencias instaladas"
} else {
  Write-OK "node_modules ya existe — se omite npm install"
}

# ── 5. Generar .env.local ──────────────────────────────────────
Write-Step "Configurando variables de entorno..."
if (-not (Test-Path ".env.local")) {

  # Generar secretos aleatorios
  $jwtBytes  = [Security.Cryptography.RandomNumberGenerator]::GetBytes(48)
  $JWT_SECRET = [Convert]::ToBase64String($jwtBytes)

  $refBytes  = [Security.Cryptography.RandomNumberGenerator]::GetBytes(48)
  $REFRESH_SECRET = [Convert]::ToBase64String($refBytes)

  $encBytes  = [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
  $ENCRYPTION_KEY = ($encBytes | ForEach-Object { $_.ToString("x2") }) -join ""

  $envContent = @"
# DocuIA — Variables locales (generado por setup.ps1)
# NO subas este archivo a git

# ── App ────────────────────────────────────────────────────────
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=DocuIA

# ── Base de datos ──────────────────────────────────────────────
DATABASE_URL=postgresql://docuia_user:docuia_local_pass@localhost:5432/docuia

# ── Auth (generados automáticamente) ──────────────────────────
JWT_SECRET=$JWT_SECRET
REFRESH_SECRET=$REFRESH_SECRET
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# ── Encriptación (credenciales NetSuite en DB) ─────────────────
ENCRYPTION_KEY=$ENCRYPTION_KEY

# ── Google Gemini AI ──────────────────────────────────────────
GOOGLE_API_KEY=

# ── MinIO (storage local) ─────────────────────────────────────
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin123
MINIO_BUCKET=docuia-documents
MINIO_USE_SSL=false

# ── Email (Resend — dejar vacío para usar console.log) ────────
RESEND_API_KEY=
RESEND_FROM_EMAIL=noreply@docuia.com
RESEND_FROM_NAME=DocuIA

# ── Superadmin (solo seed inicial) ────────────────────────────
PLATFORM_ADMIN_EMAIL=$ADMIN_EMAIL
PLATFORM_ADMIN_PASSWORD=$ADMIN_PASSWORD
"@

  $envContent | Out-File -FilePath ".env.local" -Encoding utf8
  Write-OK ".env.local creado con secretos generados"
} else {
  Write-OK ".env.local ya existe — no se sobreescribe"
}

# ── 6. Docker Compose up ───────────────────────────────────────
Write-Step "Levantando PostgreSQL y MinIO..."
docker compose up -d
if ($LASTEXITCODE -ne 0) {
  Write-Fail "docker compose up falló"
  Read-Host "Presiona Enter para salir"; exit 1
}
Write-OK "Contenedores iniciados"

# ── 7. Esperar PostgreSQL ──────────────────────────────────────
Write-Step "Esperando que PostgreSQL esté listo..."
$pgReady = $false
for ($i = 0; $i -lt 30; $i++) {
  docker exec docuia-postgres pg_isready -U docuia_user -d docuia 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $pgReady = $true; break }
  Write-Host "  . esperando PostgreSQL ($($i+1)/30)..." -ForegroundColor DarkGray
  Start-Sleep -Seconds 2
}
if (-not $pgReady) {
  Write-Fail "PostgreSQL no respondió a tiempo"
  Read-Host "Presiona Enter para salir"; exit 1
}
Write-OK "PostgreSQL listo"

# ── 8. Drizzle push ───────────────────────────────────────────
Write-Step "Creando / actualizando tablas en la base de datos..."
$env:DATABASE_URL = "postgresql://docuia_user:docuia_local_pass@localhost:5432/docuia"
npx drizzle-kit push --force
if ($LASTEXITCODE -ne 0) {
  Write-Fail "drizzle-kit push falló"
  Read-Host "Presiona Enter para salir"; exit 1
}
Write-OK "Tablas listas"

# ── 9. Seed features ──────────────────────────────────────────
Write-Step "Sembrando features del sistema..."
npx tsx scripts/seed-features.ts
if ($LASTEXITCODE -ne 0) {
  Write-Warn "seed-features tuvo un problema (puede ignorarse si ya existían)"
} else {
  Write-OK "Features sembrados"
}

# ── 10. Seed demo ─────────────────────────────────────────────
Write-Step "Sembrando datos de demo..."
npx tsx scripts/seed-demo.ts
if ($LASTEXITCODE -ne 0) {
  Write-Warn "seed-demo tuvo un problema (puede ignorarse si ya existían)"
} else {
  Write-OK "Datos de demo sembrados"
}

# ── 11. Crear superadmin ───────────────────────────────────────
Write-Step "Creando cuenta de superadmin..."
npx tsx scripts/create-admin.ts $ADMIN_EMAIL $ADMIN_PASSWORD
Write-OK "Superadmin listo"

# ── 12. Iniciar dev server en ventana nueva ────────────────────
Write-Step "Iniciando servidor de desarrollo..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$scriptDir'; npm run dev" -WindowStyle Normal
Start-Sleep -Seconds 5
Start-Process "http://localhost:3000/admin/login"

# ── Resumen final ──────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔═══════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║   ✓  DocuIA corriendo en http://localhost:3000    ║" -ForegroundColor Green
Write-Host "  ╚═══════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Panel admin   →  http://localhost:3000/admin/login" -ForegroundColor White
Write-Host "  Login tenant  →  http://localhost:3000/login" -ForegroundColor White
Write-Host ""
Write-Host "  ┌─ Superadmin ──────────────────────────────────────" -ForegroundColor DarkCyan
Write-Host "  │  Email:      $ADMIN_EMAIL" -ForegroundColor White
Write-Host "  │  Contraseña: $ADMIN_PASSWORD" -ForegroundColor White
Write-Host "  └────────────────────────────────────────────────────" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  ┌─ Demo tenant ─────────────────────────────────────" -ForegroundColor DarkCyan
Write-Host "  │  Email:      carlos@acme.mx" -ForegroundColor White
Write-Host "  │  Contraseña: Demo1234!" -ForegroundColor White
Write-Host "  └────────────────────────────────────────────────────" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  Para detener: cierra la ventana 'npm run dev'" -ForegroundColor DarkGray
Write-Host "  Para volver a iniciar: usa START.bat" -ForegroundColor DarkGray
Write-Host ""
Read-Host "  Presiona Enter para cerrar este setup"
