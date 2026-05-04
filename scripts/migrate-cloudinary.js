/**
 * Script de migration massive des photos vers Cloudinary.
 * Exécution : node scripts/migrate-cloudinary.js
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch'; // Assurez-vous d'avoir node-fetch ou utilisez le fetch natif de Node 18+

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLOUD_NAME = process.env.PUBLIC_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = process.env.PUBLIC_CLOUDINARY_UPLOAD_PRESET;

if (!SUPABASE_URL || !SUPABASE_KEY || !CLOUD_NAME || !UPLOAD_PRESET) {
  console.error("Erreur : Variables d'environnement manquantes dans .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function uploadToCloudinary(base64Data) {
  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;
  const body = new URLSearchParams();
  body.append('file', base64Data);
  body.append('upload_preset', UPLOAD_PRESET);

  const res = await fetch(url, { method: 'POST', body });
  const data = await res.json();

  if (!res.ok) throw new Error(data.error?.message || "Erreur Cloudinary");
  return data.secure_url;
}

async function run() {
  console.log("🔍 Recherche d'articles avec photos Base64...");
  
  const { data: articles, error } = await supabase
    .from('articles')
    .select('id, numero_article, photo_url')
    .like('photo_url', 'data:image%');

  if (error) {
    console.error("Erreur Supabase :", error.message);
    return;
  }

  if (!articles || articles.length === 0) {
    console.log("✅ Aucun article à migrer.");
    return;
  }

  console.log(`🚀 Migration de ${articles.length} articles en cours...`);

  let success = 0;
  let fail = 0;

  for (const article of articles) {
    try {
      process.stdout.write(`  Migrating ${article.numero_article}... `);
      const newUrl = await uploadToCloudinary(article.photo_url);
      
      const { error: updateErr } = await supabase
        .from('articles')
        .update({ photo_url: newUrl, updated_at: Date.now() })
        .eq('id', article.id);

      if (updateErr) throw updateErr;

      console.log("✅");
      success++;
    } catch (err) {
      console.log("❌");
      console.error(`     Erreur pour ${article.numero_article}:`, err.message);
      fail++;
    }
  }

  console.log(`\n🏁 Migration terminée !`);
  console.log(`📊 Succès : ${success}`);
  console.log(`📊 Échecs : ${fail}`);
}

run();
