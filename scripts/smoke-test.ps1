$ErrorActionPreference = 'Stop'
$base = 'http://localhost:4321'
$out  = 'smoke-output.txt'
Set-Content $out -Value "=== Smoke test MCD ===`n"

function Log($msg) { Add-Content $out -Value $msg }
function Hit($method, $path, $body) {
  $tmp = New-TemporaryFile
  $args = @('-s','-X',$method,"$base$path",'-o',$tmp.FullName,'-w','%{http_code}')
  if ($body) {
    $bodyFile = New-TemporaryFile
    Set-Content -LiteralPath $bodyFile.FullName -Value $body -Encoding UTF8
    $args += @('-H','Content-Type: application/json','--data-binary',"@$($bodyFile.FullName)")
  }
  $code = & curl.exe @args
  $resp = Get-Content -LiteralPath $tmp.FullName -Raw
  Log "[$method $path] -> HTTP $code"
  Log "  body: $resp"
  Log ""
  if ($bodyFile) { Remove-Item $bodyFile.FullName -ErrorAction SilentlyContinue }
  Remove-Item $tmp.FullName -ErrorAction SilentlyContinue
  return $resp
}

# 1. Get next num
$r1 = Hit 'GET' '/api/next-num' $null
$num = ($r1 | ConvertFrom-Json).num

# 2. Create article with full MCD payload
$payload = @{
  numero_article = $num
  description = "Canape d'angle 3 places en velours bleu nuit"
  marque = "Maison du Monde"
  modele = "Stockholm"
  categorie = "Mobilier"
  couleur = "Bleu nuit"
  ref_couleur = "020"
  prix_achat = 450
  prix_vente = 899.99
  quantite = 3
  quantite_initiale = 5
  code_barres = "3760123456789"
  taille = "L240xP95xH88 cm"
  taille_canape = "3 places"
  shopify_product_id = "gid://shopify/Product/12345"
} | ConvertTo-Json -Compress
$r2 = Hit 'POST' '/api/articles' $payload
$created = ($r2 | ConvertFrom-Json).article
$id = $created.id
Log "Created article id: $id"
Log "  numero_article: $($created.numero_article)"
Log "  code_barres: $($created.code_barres)"
Log "  taille: $($created.taille)"
Log "  taille_canape: $($created.taille_canape)"
Log "  ref_couleur: $($created.ref_couleur)"
Log "  shopify_product_id: $($created.shopify_product_id)"
Log "  marge: $($created.marge)"
Log "  statut: $($created.statut)"
Log ""

# 3. List
Hit 'GET' '/api/articles' $null | Out-Null

# 4. Update -> drop quantity to 1 (should flip statut to stock_faible)
$update = @{
  quantite = 1
  taille_canape = "Angle"
} | ConvertTo-Json -Compress
$r4 = Hit 'PUT' "/api/articles/$id" $update
$updated = ($r4 | ConvertFrom-Json).article
Log "After PUT:"
Log "  quantite: $($updated.quantite)"
Log "  statut: $($updated.statut)"
Log "  taille_canape: $($updated.taille_canape)"
Log ""

# 5. Delete
Hit 'DELETE' "/api/articles/$id" $null | Out-Null

# 6. Final list (should be empty)
$r6 = Hit 'GET' '/api/articles' $null
$final = ($r6 | ConvertFrom-Json).articles
Log "Final article count: $($final.Count)"

Log "`n=== Smoke test DONE ==="
