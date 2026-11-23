# Relie le serveur intermédiaire DHIS2 aux identifiants de l'extraction de complétude (secrets GitHub).
# À lancer UNE fois depuis la racine du dépôt :  powershell -ExecutionPolicy Bypass -File dhis2-proxy\lier-a-github.ps1
# Génère une clé aléatoire (jamais affichée), l'enregistre dans Cloudflare (SYNC_KEY) et dans GitHub
# (PROXY_SYNC_KEY), puis lance le workflow qui envoie DHIS2_USER / DHIS2_PASSWORD de GitHub au proxy.
$ErrorActionPreference = "Stop"
$octets = New-Object byte[] 40
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($octets)
$cle = [Convert]::ToBase64String($octets).TrimEnd("=").Replace("+", "-").Replace("/", "_")

Push-Location (Join-Path $PSScriptRoot ".")
try {
  $cle | npx wrangler secret put SYNC_KEY
  if ($LASTEXITCODE -ne 0) { throw "Échec de l'enregistrement de SYNC_KEY dans Cloudflare." }
} finally { Pop-Location }

gh secret set PROXY_SYNC_KEY --body $cle
if ($LASTEXITCODE -ne 0) { throw "Échec de l'enregistrement de PROXY_SYNC_KEY dans GitHub." }
Remove-Variable cle

gh workflow run configurer-proxy-dhis2.yml
Write-Host "Clé enregistrée des deux côtés. Synchronisation lancée : suivez-la avec « gh run watch » ou dans l'onglet Actions."
