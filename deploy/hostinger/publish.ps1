param(
  [string]$HostingServer = "195.35.49.244",
  [int]$SshPort = 65002,
  [string]$HostingUser = "u563036210",
  [string]$WebRoot = "/home/u563036210/domains/fanscore.pro/public_html",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$frontendOutput = Join-Path $repositoryRoot "frontend/dist/browser"
$remote = "${HostingUser}@${HostingServer}"

if ($WebRoot -notmatch "^/home/[A-Za-z0-9_-]+/[A-Za-z0-9_./-]+/public_html$") {
  throw "WebRoot güvenli bir Hostinger public_html yolu olmalıdır."
}

if (-not $SkipBuild) {
  & npm run build -w frontend --prefix $repositoryRoot
  if ($LASTEXITCODE -ne 0) { throw "Frontend production build başarısız oldu." }
}

if (-not (Test-Path -LiteralPath $frontendOutput)) {
  throw "Frontend build çıktısı bulunamadı: $frontendOutput"
}

& scp -P $SshPort -r "$frontendOutput/*" "${remote}:$WebRoot/"
if ($LASTEXITCODE -ne 0) { throw "Frontend dosyaları yüklenemedi." }

& scp -P $SshPort (Join-Path $PSScriptRoot ".htaccess") "${remote}:$WebRoot/.htaccess"
if ($LASTEXITCODE -ne 0) { throw "Ana .htaccess yüklenemedi." }

& scp -P $SshPort -r (Join-Path $PSScriptRoot "api") "${remote}:$WebRoot/"
if ($LASTEXITCODE -ne 0) { throw "API proxy dosyaları yüklenemedi." }

$permissionCommand = @"
find '$WebRoot/branding' '$WebRoot/media' '$WebRoot/api' -type d -exec chmod 755 {} + &&
find '$WebRoot/branding' '$WebRoot/media' '$WebRoot/api' -type f -exec chmod 644 {} + &&
chmod 644 '$WebRoot/.htaccess' '$WebRoot/index.html' '$WebRoot/main.js' '$WebRoot/styles.css'
"@ -replace "`r?`n", " "

& ssh -p $SshPort $remote $permissionCommand
if ($LASTEXITCODE -ne 0) { throw "Hostinger dosya izinleri ayarlanamadı." }

Write-Output "Frontend yayınlandı; statik klasörler 755, dosyalar 644 olarak ayarlandı."
