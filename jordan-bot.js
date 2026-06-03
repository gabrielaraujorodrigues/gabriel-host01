'use strict';

// ═══════════════════════════════════════════════════════════════════
//  JORDAN BOT OFICIAL v3.0 — Bot WhatsApp Ultra Profissional
//  Dono: gabriel mods
// ═══════════════════════════════════════════════════════════════════

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  isJidGroup,
  downloadContentFromMessage,
} = require('baileys');

const pino          = require('pino');
const path          = require('path');
const fs            = require('fs-extra');
const { exec }      = require('child_process');
const { promisify } = require('util');
const execAsync     = promisify(exec);
const fetch         = require('node-fetch');
const ytSearch      = require('yt-search');
const moment        = require('moment-timezone');
const ffmpegLib     = require('fluent-ffmpeg');

// ═══════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════
const __root      = __dirname;
const CONFIG_PATH = path.join(__root, 'BANCO-DE-DADOS/P-INFORMACOES/media/Config-Kiimori.json');

let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}

const BOT_NAME   = config.NomeDoBot    || 'Jordan Bot Oficial';
const PREFIX     = config.prefix       || '/';
const OWNER_NUM  = (config.ownerNumber || config.Proprietário || '558694029686').replace(/\D/g, '');
const OWNER_NAME = config.ownerName    || 'gabriel mods';
const API_SITE   = (config.SITE        || 'https://yuta-apis.xyz').replace(/\/$/, '');
const API_TOKEN  = config.TOKEN        || 'Mery1079';

const SESSION_DIR = path.join(__root, 'session_data');
const TEMP_DIR    = path.join(__root, 'temp_media');

// ═══════════════════════════════════════════════════════════════════
// FFMPEG — localização automática
// ═══════════════════════════════════════════════════════════════════
let FFMPEG_PATH = null;
async function setupFfmpeg() {
  const candidates = [
    '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg',
    '/home/runner/.nix-profile/bin/ffmpeg',
  ];
  for (const p of candidates) {
    try { await fs.access(p, fs.constants.X_OK); FFMPEG_PATH = p; break; } catch {}
  }
  if (!FFMPEG_PATH) {
    try {
      const { stdout } = await execAsync('which ffmpeg', { timeout: 3000 });
      FFMPEG_PATH = stdout.trim() || null;
    } catch {}
  }
  if (FFMPEG_PATH) {
    ffmpegLib.setFfmpegPath(FFMPEG_PATH);
    console.log('[FFMPEG] Encontrado:', FFMPEG_PATH);
  } else {
    console.log('[FFMPEG] Não encontrado. Downloads de áudio limitados.');
  }
}

// yt-dlp auto-detect
async function getYtDlp() {
  const cands = [
    path.join(process.env.HOME || '', '.local/bin/yt-dlp'),
    '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp',
    '/home/runner/workspace/.pythonlibs/bin/yt-dlp',
  ];
  for (const p of cands) { try { await fs.access(p, fs.constants.X_OK); return p; } catch {} }
  try { const { stdout } = await execAsync('which yt-dlp', { timeout: 3000 }); return stdout.trim() || null; } catch {}
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// DATABASE
// ═══════════════════════════════════════════════════════════════════
const DB = {
  settings: path.join(__root, 'BANCO-DE-DADOS/group_settings.json'),
  presents: path.join(__root, 'BANCO-DE-DADOS/presentations.json'),
  grupos:   path.join(__root, 'BANCO-DE-DADOS/grupos/grupos.json'),
  warned:   path.join(__root, 'BANCO-DE-DADOS/warned.json'),
};

const readDB  = (f, d = {}) => { try { if (!fs.existsSync(f)) { fs.ensureDirSync(path.dirname(f)); fs.writeJSONSync(f, d); return d; } return fs.readJSONSync(f); } catch { return d; } };
const saveDB  = (f, d) => { try { fs.ensureDirSync(path.dirname(f)); fs.writeJSONSync(f, d, { spaces: 2 }); } catch {} };

let settings = readDB(DB.settings, {});
let presents = readDB(DB.presents, {});

const getS = (g, k, def) => settings[g]?.[k] !== undefined ? settings[g][k] : def;
const setS = (g, k, v)   => { if (!settings[g]) settings[g] = {}; settings[g][k] = v; saveDB(DB.settings, settings); };

// ═══════════════════════════════════════════════════════════════════
// ESTADO EM MEMÓRIA
// ═══════════════════════════════════════════════════════════════════
const quizMap        = new Map(); // gid → {a, timeout}
const challengeMap   = new Map(); // gid → {uid, correct, correctLetter, timeout}
const floodMap       = new Map(); // `${gid}:${uid}` → {count, ts}
const stickerFlood   = new Map(); // `${gid}:${uid}` → {count, timer}
const metaCache      = new Map(); // gid → {meta, ts}
const firedMinutes   = new Set(); // prevent double-firing schedules
let sock;
let retries = 0;

// ═══════════════════════════════════════════════════════════════════
// HELPERS GERAIS
// ═══════════════════════════════════════════════════════════════════
const norm    = t => (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const sleep   = ms => new Promise(r => setTimeout(r, ms));
const isOwner = jid => { const n = jid.replace('@s.whatsapp.net','').replace(/\D/g,''); return n === OWNER_NUM || n === OWNER_NUM.slice(2); };

const isAdminOf = (parts, jid) => {
  const p = parts.find(x => x.id === jid || x.id.split(':')[0]+'@s.whatsapp.net' === jid);
  return p?.admin === 'admin' || p?.admin === 'superadmin';
};
const botIsAdmin = parts => {
  if (!sock?.user?.id) return false;
  return isAdminOf(parts, sock.user.id.split(':')[0]+'@s.whatsapp.net');
};

// Cache de groupMetadata (2 min) para reduzir chamadas e acelerar o bot
async function getGroupMeta(gid) {
  const cached = metaCache.get(gid);
  if (cached && Date.now() - cached.ts < 120000) return cached.meta;
  try {
    const meta = await sock.groupMetadata(gid);
    metaCache.set(gid, { meta, ts: Date.now() });
    return meta;
  } catch { return null; }
}

// Pegar buffer de qualquer tipo de mídia
async function getMediaBuf(msgInner) {
  if (!msgInner) return null;
  const types = ['imageMessage','videoMessage','stickerMessage','audioMessage','documentMessage'];
  for (const t of types) {
    if (msgInner[t]) {
      try {
        const stream = await downloadContentFromMessage(msgInner[t], t.replace('Message',''));
        const chunks = []; for await (const c of stream) chunks.push(c);
        return Buffer.concat(chunks);
      } catch { return null; }
    }
  }
  return null;
}

// Converter imagem para sticker WebP (requer ffmpeg)
async function toStickerWebp(inputBuf, animated = false) {
  if (!FFMPEG_PATH) throw new Error('ffmpeg não encontrado no servidor');
  await fs.ensureDir(TEMP_DIR);
  const tag = Date.now();
  const inF = path.join(TEMP_DIR, `stk_in_${tag}`);
  const outF = path.join(TEMP_DIR, `stk_${tag}.webp`);
  await fs.writeFile(inF, inputBuf);
  await new Promise((res, rej) => {
    let cmd = ffmpegLib(inF).outputOptions([
      '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2',
      ...(animated ? ['-loop','0','-t','8','-an'] : ['-frames:v','1']),
    ]).output(outF).on('end', res).on('error', rej);
    cmd.run();
  });
  const buf = await fs.readFile(outF);
  fs.remove(inF).catch(() => {}); fs.remove(outF).catch(() => {});
  return buf;
}

// Decode HTML entities
const decodeHtml = s => (s||'')
  .replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&amp;/g,'&')
  .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&eacute;/g,'é')
  .replace(/&atilde;/g,'ã').replace(/&ccedil;/g,'ç').replace(/&ecirc;/g,'ê');

// ═══════════════════════════════════════════════════════════════════
// TTS — Google Translate (retorna MP3)
// ═══════════════════════════════════════════════════════════════════
async function getTTS(text, lang = 'pt-BR') {
  const enc = encodeURIComponent(text.slice(0, 200));
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${enc}&tl=${lang}&client=tw-ob`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    timeout: 12000,
  });
  if (!r.ok) throw new Error('TTS falhou');
  return r.buffer();
}

// Enviar TTS como PTT (voz) — converte MP3→OGG com ffmpeg ou envia como áudio normal
async function sendTTS(gid, text, lang = 'pt-BR', quotedMsg = null) {
  try {
    const mp3 = await getTTS(text, lang);
    const opts = quotedMsg ? { quoted: quotedMsg } : {};
    // Tenta enviar como voz (ptt) — WhatsApp aceita MP3 como ptt internamente
    await sock.sendMessage(gid, { audio: mp3, mimetype: 'audio/mpeg', ptt: true }, opts);
  } catch { /* silencioso */ }
}

// ═══════════════════════════════════════════════════════════════════
// DOWNLOAD — Música (ytdl-core + ffmpeg)
// ═══════════════════════════════════════════════════════════════════
async function baixarMusica(query) {
  const ytdl = require('@distube/ytdl-core');
  await fs.ensureDir(TEMP_DIR);

  const isUrl = /^https?:\/\//i.test(query);
  let videoUrl = query, title = query.slice(0,40), duration = '';

  if (!isUrl) {
    const res = await ytSearch(query);
    const vid = res?.videos?.[0];
    if (!vid) throw new Error('Música não encontrada 🔍');
    if (vid.seconds > 600) throw new Error('Música muito longa (máx 10 min)');
    videoUrl = vid.url; title = vid.title; duration = vid.timestamp;
  }

  // Se tiver ffmpeg, converte para MP3 (melhor qualidade)
  if (FFMPEG_PATH) {
    const outFile = path.join(TEMP_DIR, `music_${Date.now()}.mp3`);
    await new Promise((resolve, reject) => {
      const stream = ytdl(videoUrl, { filter: 'audioonly', quality: 'highestaudio', requestOptions: { headers: { 'User-Agent': 'Mozilla/5.0' } } });
      stream.on('error', reject);
      ffmpegLib(stream).audioBitrate(128).format('mp3').on('error', reject).on('end', resolve).save(outFile);
    });
    return { file: outFile, title, dur: duration, mime: 'audio/mpeg', ext: 'mp3' };
  }

  // Sem ffmpeg: baixa webm direto (sem conversão)
  const outFile = path.join(TEMP_DIR, `music_${Date.now()}.webm`);
  await new Promise((resolve, reject) => {
    const stream = ytdl(videoUrl, { filter: 'audioonly', quality: 'lowestaudio', requestOptions: { headers: { 'User-Agent': 'Mozilla/5.0' } } });
    stream.on('error', reject);
    const out = fs.createWriteStream(outFile);
    stream.pipe(out);
    out.on('finish', resolve); out.on('error', reject);
  });
  return { file: outFile, title, dur: duration, mime: 'audio/webm', ext: 'webm' };
}

// ═══════════════════════════════════════════════════════════════════
// DOWNLOAD — Vídeo YouTube
// ═══════════════════════════════════════════════════════════════════
async function baixarVideoYT(query) {
  const ytdl = require('@distube/ytdl-core');
  await fs.ensureDir(TEMP_DIR);
  const isUrl = /^https?:\/\//i.test(query);
  let url = query;
  if (!isUrl) {
    const res = await ytSearch(query);
    const vid = res?.videos?.[0];
    if (!vid) throw new Error('Vídeo não encontrado');
    url = vid.url;
  }
  const outFile = path.join(TEMP_DIR, `vid_${Date.now()}.mp4`);
  if (FFMPEG_PATH) {
    await new Promise((resolve, reject) => {
      const stream = ytdl(url, { filter: fmt => fmt.container==='mp4' && fmt.hasVideo && fmt.hasAudio, quality: 'lowestvideo', requestOptions: { headers: { 'User-Agent': 'Mozilla/5.0' } } });
      stream.on('error', reject);
      ffmpegLib(stream).outputOptions(['-movflags','faststart']).format('mp4').on('error', reject).on('end', resolve).save(outFile);
    });
  } else {
    const stream = ytdl(url, { filter: fmt => fmt.container==='mp4' && fmt.hasVideo && fmt.hasAudio, quality: 'lowestvideo' });
    const out = fs.createWriteStream(outFile);
    await new Promise((res, rej) => { stream.pipe(out); out.on('finish', res); out.on('error', rej); stream.on('error', rej); });
  }
  return outFile;
}

// ═══════════════════════════════════════════════════════════════════
// DOWNLOAD — TikTok (tikwm.com)
// ═══════════════════════════════════════════════════════════════════
async function baixarTikTok(url) {
  const r = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&web=1&hd=1`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' }, timeout: 20000,
  });
  const d = await r.json();
  if (!d?.data?.play) throw new Error('Não foi possível baixar o TikTok');
  const vr = await fetch(d.data.play, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } });
  return { buf: await vr.buffer(), title: d.data.title || 'TikTok' };
}

async function baixarTikTokAudio(url) {
  const r = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&web=1`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' }, timeout: 20000,
  });
  const d = await r.json();
  const musicUrl = d?.data?.music || d?.data?.play;
  if (!musicUrl) throw new Error('Áudio do TikTok não encontrado');
  const ar = await fetch(musicUrl, { timeout: 30000 });
  return { buf: await ar.buffer(), title: d.data?.music_info?.title || 'TikTok Audio' };
}

// ═══════════════════════════════════════════════════════════════════
// DOWNLOAD — Instagram
// ═══════════════════════════════════════════════════════════════════
async function baixarInstagram(url) {
  try {
    const r = await fetch('https://api.snapinsta.app/v1/download', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `url=${encodeURIComponent(url)}`, timeout: 25000,
    });
    const d = await r.json();
    const videoUrl = d?.data?.[0]?.url || d?.url;
    if (videoUrl) { const vr = await fetch(videoUrl, { timeout: 30000 }); return vr.buffer(); }
  } catch {}
  const ytdlp = await getYtDlp();
  if (!ytdlp) throw new Error('Não foi possível baixar. Instale yt-dlp no servidor.');
  await fs.ensureDir(TEMP_DIR);
  const outFile = path.join(TEMP_DIR, `ig_${Date.now()}.mp4`);
  await execAsync(`"${ytdlp}" -o "${outFile}" "${url}" --no-playlist -q`, { timeout: 60000 });
  if (!fs.existsSync(outFile)) throw new Error('Download falhou');
  const buf = await fs.readFile(outFile);
  fs.remove(outFile).catch(() => {});
  return buf;
}

// ═══════════════════════════════════════════════════════════════════
// API — GPT (múltiplas fontes com fallback)
// ═══════════════════════════════════════════════════════════════════
async function perguntarGpt(texto) {
  const endpoints = [
    async () => { const r = await fetch(`${API_SITE}/api/ai/gpt?text=${encodeURIComponent(texto)}&apikey=${API_TOKEN}`, {timeout:20000}); const d = await r.json(); return d.result||d.message; },
    async () => { const r = await fetch(`https://api.paxsenix.biz.id/ai/chatgpt?text=${encodeURIComponent(texto)}`, {timeout:20000}); const d = await r.json(); return d.message||d.result; },
    async () => { const r = await fetch(`https://api.siputzx.my.id/api/ai/chatgpt3?prompt=${encodeURIComponent(texto)}`, {timeout:20000}); const d = await r.json(); return d.data; },
    async () => { const r = await fetch('https://luminai.my.id/', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({content:texto,user:'user',web:false}), timeout:20000 }); const d = await r.json(); return d.result; },
  ];
  for (const fn of endpoints) { try { const res = await fn(); if (res && String(res).length > 2) return String(res); } catch {} }
  throw new Error('Serviço de IA temporariamente indisponível. Tente novamente.');
}

// ═══════════════════════════════════════════════════════════════════
// APIS — Clima, Wiki, Filme, Tradução
// ═══════════════════════════════════════════════════════════════════
async function buscarClima(cidade) {
  const r = await fetch(`https://wttr.in/${encodeURIComponent(cidade)}?format=j1`, { headers: {'User-Agent':'curl/7.68.0',Accept:'application/json'}, timeout:10000 });
  if (!r.ok) throw new Error('Cidade não encontrada');
  const d = await r.json(); const c = d.current_condition[0]; const area = d.nearest_area?.[0];
  return { temp:c.temp_C, feel:c.FeelsLikeC, humid:c.humidity, wind:c.windspeedKmph, desc:c.lang_pt?.[0]?.value||c.weatherDesc?.[0]?.value||'N/A', city:area?.areaName?.[0]?.value||cidade, country:area?.country?.[0]?.value||'', uv:c.uvIndex };
}

async function buscarWiki(termo) {
  const r = await fetch(`https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(termo)}`, {timeout:10000});
  if (!r.ok) throw new Error('Nada encontrado para esse termo');
  const d = await r.json();
  if (d.type==='disambiguation'||!d.extract) throw new Error('Termo muito genérico. Seja mais específico.');
  return { title:d.title, extract:d.extract.slice(0,900), link:d.content_urls?.desktop?.page||'', thumb:d.thumbnail?.source||null };
}

async function buscarFilme(titulo) {
  const keys = ['trilogy','12345678','poster'];
  for (const key of keys) { try { const r = await fetch(`https://www.omdbapi.com/?t=${encodeURIComponent(titulo)}&apikey=${key}`,{timeout:10000}); const d = await r.json(); if (d.Response==='True') return d; } catch {} }
  throw new Error('Filme/série não encontrado');
}

async function traduzir(texto, para = 'en', de = 'auto') {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${de}&tl=${para}&dt=t&q=${encodeURIComponent(texto)}`;
  const r = await fetch(url, { headers:{'User-Agent':'Mozilla/5.0'}, timeout:8000 });
  if (!r.ok) throw new Error('Tradução falhou');
  const d = await r.json();
  const result = d[0]?.map(t=>t[0]).filter(Boolean).join('')||'';
  if (!result) throw new Error('Sem resultado');
  return { result, srcLang:d[2]||de };
}

// ═══════════════════════════════════════════════════════════════════
// TRIVIA — Open Trivia DB + fallback local
// ═══════════════════════════════════════════════════════════════════
const QUIZ_LOCAL = [
  {q:'🐘 Qual é o maior animal terrestre?',a:'elefante'},
  {q:'🦁 O rei dos animais é?',a:'leao'},
  {q:'🌊 Maior oceano do mundo?',a:'pacifico'},
  {q:'🌍 Maior país do mundo em área?',a:'russia'},
  {q:'🏔️ Montanha mais alta do mundo?',a:'everest'},
  {q:'⚡ Pokémon elétrico mais famoso?',a:'pikachu'},
  {q:'🍕 De qual país é a pizza?',a:'italia'},
  {q:'💧 Maior rio do mundo?',a:'amazonas'},
  {q:'🔴 Capital do Brasil?',a:'brasilia'},
  {q:'🧪 Fórmula da água?',a:'h2o'},
  {q:'🌙 Satélite natural da Terra?',a:'lua'},
  {q:'🦷 Quantos dentes tem um adulto?',a:'32'},
  {q:'🐍 Maior cobra do mundo?',a:'anaconda'},
  {q:'☀️ Centro do sistema solar?',a:'sol'},
  {q:'🐬 Mamífero marinho mais inteligente?',a:'golfinho'},
  {q:'🌎 Continente mais populoso?',a:'asia'},
  {q:'🏆 País com mais copas do mundo?',a:'brasil'},
  {q:'🎸 Famoso guitarrista do AC/DC?',a:'angus young'},
  {q:'🎭 Quem escreveu Romeu e Julieta?',a:'shakespeare'},
  {q:'🔬 Pai da teoria da relatividade?',a:'einstein'},
];

async function buscarPerguntaTrivia() {
  try {
    const r = await fetch('https://opentdb.com/api.php?amount=1&type=multiple',{timeout:8000});
    const d = await r.json(); const q = d.results?.[0];
    if (!q) throw new Error('vazio');
    const question = decodeHtml(q.question); const correct = decodeHtml(q.correct_answer);
    const all = [...q.incorrect_answers.map(decodeHtml), correct].sort(()=>Math.random()-0.5);
    const letters = ['A','B','C','D'];
    const options = all.map((a,i)=>`*${letters[i]})* ${a}`);
    const cl = letters[all.indexOf(correct)];
    const diff = q.difficulty==='easy'?'🟢 Fácil':q.difficulty==='medium'?'🟡 Médio':'🔴 Difícil';
    return { question, options, correct, correctLetter:cl, diff, isLocal:false };
  } catch {
    const loc = QUIZ_LOCAL[Math.floor(Math.random()*QUIZ_LOCAL.length)];
    return { question:loc.q, options:[], correct:loc.a, correctLetter:'', diff:'🟡 Médio', isLocal:true };
  }
}

// ═══════════════════════════════════════════════════════════════════
// GERADOR CPF
// ═══════════════════════════════════════════════════════════════════
function gerarCPF() {
  const r=()=>Math.floor(Math.random()*9); const d=Array.from({length:9},r);
  const v1=d.reduce((s,v,i)=>s+v*(10-i),0); const c1=(v1*10%11)%10;
  const d2=[...d,c1]; const v2=d2.reduce((s,v,i)=>s+v*(11-i),0); const c2=(v2*10%11)%10;
  return `${d.slice(0,3).join('')}.${d.slice(3,6).join('')}.${d.slice(6,9).join('')}-${c1}${c2}`;
}

// ═══════════════════════════════════════════════════════════════════
// DETECÇÃO — Links, Brigas, NSFW, Flood, Fake
// ═══════════════════════════════════════════════════════════════════
const FIGHT_WORDS = [
  'vou te matar','te mato','vou te bater','vai tomar no','desgraçado',
  'filho da puta','vai se fuder','babaca','vou te achar','querendo briga',
  'te acerto','vai me pagar','te pego','te odeio','infeliz','miseravel',
  'sua vadia','vai pagar','deixa eu te pegar','voce vai ver','sua prostituta',
  'te processo','mando te matar','vou te pegar','ameaca de morte',
];
const NSFW_TAGS = ['+18','18+','nsfw','adult','nude','hentai','porno','sexy','explicit','xxx','lewd','naked','pelada'];

const hasGroupLink = t => /chat\.whatsapp\.com\/[A-Za-z0-9_-]{10,}/i.test(t||'');
const hasFight     = t => FIGHT_WORDS.some(w => norm(t).includes(w));

function isNSFWSticker(message) {
  const s = message?.stickerMessage;
  if (!s) return false;
  const tags = [s.stickerName||'', s.stickerAuthor||'', ...(s.categories||[])].join(' ').toLowerCase();
  return NSFW_TAGS.some(t => tags.includes(t));
}

function isViewOnce(message) {
  return !!(
    message?.viewOnceMessage?.message?.imageMessage ||
    message?.viewOnceMessageV2?.message?.imageMessage ||
    message?.viewOnceMessageV2Extension?.message?.imageMessage
  );
}

// Heurística para detectar número fake/spam
async function isFakeNumber(jid) {
  try {
    const num = jid.replace('@s.whatsapp.net','').replace(/\D/g,'');
    // Números muito curtos (< 10 dígitos sem código do país) → suspeito
    if (num.length < 11) return true;
    // Tentativa de pegar status (se lançar exceção → conta suspeita/recente)
    let status = '';
    try {
      const s = await sock.fetchStatus(jid).catch(()=>null);
      status = (s?.status||'').toLowerCase();
    } catch {}
    // Palavras de spam no status
    const spamWords = ['invest','crypto','bitcoin','ganhe','renda extra','forex','trade','compre agora','promoção','desconto'];
    if (spamWords.some(w => status.includes(w))) return true;
    return false;
  } catch { return false; }
}

// ═══════════════════════════════════════════════════════════════════
// DESAFIO ALEATÓRIO
// ═══════════════════════════════════════════════════════════════════
const STAR_LINE = '✩ ─────────────────────────── ✩';
const STAR_DIV  = '✩ · · · · · · · · · · · · · · · ✩';

async function iniciarDesafio(gid, parts) {
  if (challengeMap.has(gid)) return;
  if (!botIsAdmin(parts)) return;
  const botJid = sock?.user?.id?.split(':')[0]+'@s.whatsapp.net';
  const candidates = parts.filter(p => !p.admin && !isOwner(p.id) && p.id !== botJid);
  if (!candidates.length) return;
  const chosen = candidates[Math.floor(Math.random()*candidates.length)];
  const uid = chosen.id;
  const perg = await buscarPerguntaTrivia();
  const opStr = perg.options.length ? perg.options.join('\n') : '_Responda com a palavra certa_';
  const txt =
`${STAR_LINE}
⚔️ *HORA DO DESAFIO!* ⚔️
${STAR_DIV}
🎯 @${uid.split('@')[0]} *você foi escolhido(a)!*

⚠️ *Regras do desafio:*
• Diga *NÃO* → você sai do grupo 🚪
• *Erre* a resposta → você sai do grupo 😬
• *Acerte* → você fica e ganha respeito! 🏆

⏱️ Você tem *45 segundos* para responder!

📝 *Pergunta (${perg.diff}):*
${perg.question}

${opStr}
${STAR_LINE}`;
  await sock.sendMessage(gid, { text: txt, mentions: [uid] });
  const timeout = setTimeout(async () => {
    challengeMap.delete(gid);
    try {
      await sock.sendMessage(gid, { text: `⏰ @${uid.split('@')[0]} *não respondeu a tempo* e foi removido(a)! 😬\n\n✅ Resposta certa era: *${perg.correct}*`, mentions:[uid] });
      await sock.groupParticipantsUpdate(gid, [uid], 'remove');
    } catch {}
  }, 45000);
  challengeMap.set(gid, { uid, correct: perg.correct, correctLetter: perg.correctLetter, timeout, isLocal: perg.isLocal });
}

// ═══════════════════════════════════════════════════════════════════
// CONSULTA NÚMERO
// ═══════════════════════════════════════════════════════════════════
async function consultarNumero(rawNum) {
  const num = rawNum.replace(/\D/g,'');
  if (num.length < 8) throw new Error('Número inválido');
  const ddd = num.length >= 11 ? num.slice(-11,-9) : num.slice(0,2);
  let estado='', cidade='';
  try { const r=await fetch(`https://brasilapi.com.br/api/ddd/v1/${ddd}`,{timeout:8000}); if(r.ok){const x=await r.json();estado=x.state||'';cidade=(x.cities||[]).slice(0,3).join(', ');} } catch {}
  const ops = {'11':'Vivo','12':'Claro','13':'TIM','15':'Vivo','17':'TIM','18':'Claro','21':'Claro','25':'Oi','27':'Vivo','31':'TIM','41':'Vivo','51':'Claro','61':'Vivo','71':'Claro','81':'TIM','85':'Vivo','86':'TIM','91':'Claro','92':'Vivo','95':'Oi','96':'Vivo'};
  return `📱 *Consulta de Número*\n\nNúmero: *+55 ${num}*\nDDD: *${ddd}*\nEstado: *${estado||'N/A'}*\nCidades: *${cidade||'N/A'}*\nOperadora provável: *${ops[ddd]||'Desconhecida'}*\n\n_Resultado aproximado baseado em DDD_`;
}

// ═══════════════════════════════════════════════════════════════════
// BOLA 8
// ═══════════════════════════════════════════════════════════════════
const BALL8 = [
  '✅ Com certeza!','✅ Definitivamente sim!','✅ Pode contar!','✅ Todas as evidências apontam que sim!',
  '🤔 Talvez...','🤔 Não tenho certeza.','🤔 As perspectivas são incertas.','🤔 Pergunte novamente mais tarde.',
  '❌ Não conte com isso.','❌ Definitivamente não.','❌ Muito improvável.','❌ Minha resposta é não.',
];

// ═══════════════════════════════════════════════════════════════════
// MENU
// ═══════════════════════════════════════════════════════════════════
const MENU_IMG_URL = 'https://i.pinimg.com/originals/6b/61/7c/6b617c6c1abcd53c4a69cf1a5c1d13da.gif';

async function cmdMenu(msg, gid) {
  const sender = msg.key?.participant||msg.key?.remoteJid||gid;
  const cargo  = isOwner(sender) ? '👑 Dono' : 'Membro';

  const txt =
`✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩
🩷  *${BOT_NAME}*  🩷
✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩
🤖 *Bot:* ${BOT_NAME}
👤 *Usuário:* @${sender.split('@')[0]}
👑 *Dono:* ${OWNER_NAME}
👥 *Cargo:* ${cargo}
${STAR_LINE}

✩ ▸ *MENUS ESPECIALIZADOS*
${STAR_DIV}
🩷 ✩ → ${PREFIX}MenuPrincipal
🩷 ✩ → ${PREFIX}MenuDono
🩷 ✩ → ${PREFIX}MenuAdm
🩷 ✩ → ${PREFIX}MenuDownloads
🩷 ✩ → ${PREFIX}MenuPesquisas
🩷 ✩ → ${PREFIX}MenuFigurinhas
🩷 ✩ → ${PREFIX}MenuBrincadeira
🩷 ✩ → ${PREFIX}MenuDinheiro
🩷 ✩ → ${PREFIX}MenuLogos
${STAR_LINE}

✩ ▸ *PRINCIPAIS*
${STAR_DIV}
🎵 ${PREFIX}play • 📹 ${PREFIX}yt • 🎵 ${PREFIX}tiktok
📸 ${PREFIX}insta • 🤖 ${PREFIX}gpt • 🌤️ ${PREFIX}clima
📚 ${PREFIX}wiki • 🎬 ${PREFIX}movie • 🌐 ${PREFIX}traduzir
📱 ${PREFIX}qrcode • 🔊 ${PREFIX}gtts • 🖼️ ${PREFIX}sticker
📄 ${PREFIX}gerarcpf • 🧮 ${PREFIX}calcular • 📸 ${PREFIX}perfil
${STAR_LINE}

✩ ▸ *AGENDAMENTOS / PROTEÇÃO*
${STAR_DIV}
🔒 ${PREFIX}gf HH:mm — fechar automático
🔓 ${PREFIX}ga HH:mm — abrir automático
🔔 ${PREFIX}acordar on/off — marcação 2h
⚔️ ${PREFIX}desafiodiario on/off
⚔️ ${PREFIX}desafio — desafio imediato
🛡️ ${PREFIX}antilink on/off
🎭 ${PREFIX}bemvindo on/off
${STAR_LINE}

🤖 *${BOT_NAME}* — Sempre online, sempre inteligente! 💪`;

  // Envia com imagem animada
  try {
    const imgBuf = await fetch(MENU_IMG_URL, { timeout: 12000 }).then(r => r.buffer());
    await sock.sendMessage(gid, { video: imgBuf, caption: txt, gifPlayback: true, mimetype: 'video/mp4', mentions: [sender] }, { quoted: msg });
  } catch {
    try {
      const imgBuf = await fetch(MENU_IMG_URL, { timeout: 12000 }).then(r => r.buffer());
      await sock.sendMessage(gid, { image: imgBuf, caption: txt, mentions: [sender] }, { quoted: msg });
    } catch {
      await sock.sendMessage(gid, { text: txt, mentions: [sender] }, { quoted: msg });
    }
  }

  // Áudio de boas-vindas do menu
  await sleep(800);
  try {
    const tts = await getTTS('Aqui está o seu menu! Aproveite as funcionalidades. Sou o seu assistente inteligente disponível 24 horas por dia!');
    await sock.sendMessage(gid, { audio: tts, mimetype: 'audio/mpeg', ptt: true });
  } catch {}
}

// Sub-menu helper
async function sendSubMenu(gid, msg, titulo, cmds) {
  const linhas = cmds.map(c => `🩷 ✩ → ${c}`).join('\n');
  await sock.sendMessage(gid, { text: `${STAR_LINE}\n✩ ▸ *${titulo}*\n${STAR_DIV}\n${linhas}\n${STAR_LINE}\n🤖 *${BOT_NAME}*  👑 Dono: *${OWNER_NAME}*` }, { quoted: msg });
}

async function cmdMenuPrincipal(msg, gid) { await sendSubMenu(gid,msg,'MENU PRINCIPAL',[`${PREFIX}ping`,`${PREFIX}perfil`,`${PREFIX}gtts <texto>`,`${PREFIX}traduzir <lang> <texto>`,`${PREFIX}calcular <expr>`,`${PREFIX}gerarcpf`,`${PREFIX}qrcode <texto>`,`${PREFIX}8ball <pergunta>`,`${PREFIX}dado`,`${PREFIX}quiz`,`${PREFIX}clima <cidade>`,`${PREFIX}wiki <termo>`,`${PREFIX}movie <filme>`,`${PREFIX}gpt <pergunta>`]); }
async function cmdMenuDono(msg, gid)      { await sendSubMenu(gid,msg,'MENU DONO (só dono)',[`${PREFIX}numero <num>`,`${PREFIX}monitoring on/off`,`${PREFIX}antilink on/off`,`${PREFIX}antifake on/off`,`${PREFIX}acordar on/off`,`${PREFIX}desafiodiario on/off`,`${PREFIX}gf HH:mm`,`${PREFIX}ga HH:mm`]); }
async function cmdMenuAdm(msg, gid)       { await sendSubMenu(gid,msg,'MENU ADMINISTRAÇÃO',[`${PREFIX}fechar`,`${PREFIX}abrir`,`${PREFIX}bemvindo on/off`,`${PREFIX}bemvindo texto <msg>`,`${PREFIX}bemvindo foto <url>`,`${PREFIX}kick @pessoa`,`${PREFIX}ban @pessoa`,`${PREFIX}desafio`,`${PREFIX}apresentados`]); }
async function cmdMenuDownloads(msg, gid) { await sendSubMenu(gid,msg,'MENU DOWNLOADS',[`${PREFIX}play <música>`,`${PREFIX}yt <link/busca>`,`${PREFIX}tiktok <link>`,`${PREFIX}tiktok_audio <link>`,`${PREFIX}insta <link>`]); }
async function cmdMenuPesquisas(msg, gid) { await sendSubMenu(gid,msg,'MENU PESQUISAS',[`${PREFIX}clima <cidade>`,`${PREFIX}wiki <termo>`,`${PREFIX}movie <título>`,`${PREFIX}traduzir <lang> <texto>`,`${PREFIX}numero <num>`]); }
async function cmdMenuFigurinhas(msg, gid){ await sendSubMenu(gid,msg,'MENU FIGURINHAS',[`${PREFIX}sticker (responda imagem)`,`${PREFIX}toimg (responda sticker)`]); }
async function cmdMenuBrincadeira(msg, gid){await sendSubMenu(gid,msg,'MENU BRINCADEIRAS',[`${PREFIX}quiz`,`${PREFIX}dado`,`${PREFIX}8ball <pergunta>`,`${PREFIX}desafio`,`${PREFIX}calcular <expr>`,`${PREFIX}gerarcpf`,`${PREFIX}qrcode <texto>`]); }
async function cmdMenuDinheiro(msg, gid)  { await sendSubMenu(gid,msg,'MENU DINHEIRO',[`${PREFIX}loja`,`${PREFIX}comprar`,`${PREFIX}vender`,`${PREFIX}meucelular`,`${PREFIX}coins`,`${PREFIX}cassino`,`${PREFIX}slot`,`${PREFIX}trabalhar`]); }
async function cmdMenuLogos(msg, gid)     { await sendSubMenu(gid,msg,'MENU LOGOS',[`${PREFIX}marvel <texto>`,`${PREFIX}neon <texto>`,`${PREFIX}gelo <texto>`,`${PREFIX}toxic <texto>`,`${PREFIX}rainbow <texto>`,`${PREFIX}3dgold <texto>`]); }

// ═══════════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL DE MENSAGENS
// ═══════════════════════════════════════════════════════════════════
async function onMessage(msg) {
  try {
    const { key, message } = msg;
    if (!message || key.fromMe) return;

    const gid  = key.remoteJid;
    if (!isJidGroup(gid)) return;

    const uid   = key.participant || gid;
    const inner = message.extendedTextMessage?.contextInfo?.quotedMessage || null;
    const body  = message.conversation
      || message.extendedTextMessage?.text
      || message.imageMessage?.caption
      || message.videoMessage?.caption
      || '';
    const bodyN = norm(body);
    const now   = Date.now();

    // ── Cache/meta (não bloqueia) ──────────────────────
    const meta = await getGroupMeta(gid);
    if (!meta) return;
    const parts    = meta.participants || [];
    const senderAdm = isAdminOf(parts, uid);
    const senderOwn = isOwner(uid);
    const botAdm    = botIsAdmin(parts);
    const senderTag = `@${uid.split('@')[0]}`;

    // ═══════════ SISTEMAS DE PROTEÇÃO ════════════════

    // ── Sticker +18 → remover ──────────────────────────
    if (isNSFWSticker(message) && getS(gid,'antiNSFW',true) && !senderAdm && !senderOwn) {
      try {
        await sock.sendMessage(gid, { text: `🚫 ${senderTag} foi removido(a) por enviar conteúdo +18!`, mentions:[uid] });
        await sock.groupParticipantsUpdate(gid, [uid], 'remove');
      } catch {}
      return;
    }

    // ── Visu única suspeita → aviso + remover ──────────
    if (isViewOnce(message) && getS(gid,'antiViewOnce',true) && !senderAdm && !senderOwn) {
      try {
        await sock.sendMessage(gid, { delete: key });
      } catch {}
      try {
        await sock.sendMessage(gid, {
          text: `⚠️ ${senderTag} enviou uma mensagem de visualização única. Por segurança, a mensagem foi apagada e o usuário removido por suspeita de conteúdo inadequado.`,
          mentions: [uid],
        });
        await sock.groupParticipantsUpdate(gid, [uid], 'remove');
      } catch {}
      return;
    }

    // ── Link de grupo WhatsApp → apagar + remover ──────
    if (hasGroupLink(body) && getS(gid,'antiLink',false) && !senderAdm && !senderOwn) {
      // Tenta apagar a mensagem
      try { await sock.sendMessage(gid, { delete: key }); } catch {}
      // Remove o usuário mesmo sem conseguir apagar
      try {
        await sock.sendMessage(gid, {
          text: `🔗🚫 ${senderTag} foi *removido(a)* por divulgar link de outro grupo!\n\n_Divulgação de links não é permitida neste grupo._`,
          mentions: [uid],
        });
        await sock.groupParticipantsUpdate(gid, [uid], 'remove');
      } catch {}
      return;
    }

    // ── Flood de figurinhas → remover ──────────────────
    if (message.stickerMessage && !senderAdm && !senderOwn && getS(gid,'antiStickerFlood',true)) {
      const fKey = `${gid}:${uid}`;
      const fv   = stickerFlood.get(fKey)||{count:0,timer:null};
      clearTimeout(fv.timer);
      fv.count++;
      const timer = setTimeout(()=>stickerFlood.delete(fKey), 15000);
      fv.timer = timer;
      stickerFlood.set(fKey, fv);
      if (fv.count >= 5) {
        stickerFlood.delete(fKey);
        try {
          await sock.sendMessage(gid, { text: `🎭🚫 ${senderTag} foi removido(a) por flood de figurinhas!`, mentions:[uid] });
          await sock.groupParticipantsUpdate(gid, [uid], 'remove');
        } catch {}
        return;
      }
    }

    // ── Anti-flood de mensagens gerais ─────────────────
    const fKey2 = `${gid}:${uid}`;
    const fv2   = floodMap.get(fKey2)||{count:0,ts:now};
    if (now - fv2.ts < 8000) { fv2.count++; if (fv2.count > 10 && !senderAdm && !senderOwn) { floodMap.set(fKey2, fv2); return; } }
    else { floodMap.set(fKey2, {count:1,ts:now}); }

    // ── Detecção de briga/ameaça → fechar grupo ────────
    if (hasFight(body) && getS(gid,'autoClose',true) && botAdm && !senderAdm && !senderOwn) {
      try {
        await sock.groupSettingUpdate(gid, 'announcement');
        await sock.sendMessage(gid, {
          text: `🔒 *Grupo fechado automaticamente!*\n\nIdentifiquei algo suspeito, briga, desrespeito às regras ou comportamento irregular.\n\nO grupo só será aberto com autorização do meu dono. Obrigado ✍🏽`,
        });
      } catch {}
      return;
    }

    // ── Saudações ao dono/adm com TTS ─────────────────
    if (/\b(bom dia|boa tarde|boa noite)\b/.test(bodyN)) {
      const greetz = bodyN.includes('bom dia') ? 'bom dia' : bodyN.includes('boa tarde') ? 'boa tarde' : 'boa noite';
      if (senderOwn) {
        setImmediate(async () => {
          try { await sendTTS(gid, `Olá meu dono! ${greetz}! Tudo bem? Estou aqui para te ajudar no que precisar!`); } catch {}
        });
      } else if (senderAdm) {
        const admName = uid.split('@')[0];
        setImmediate(async () => {
          try { await sendTTS(gid, `Olá ${admName}! ${greetz}! Tudo bem? Qualquer coisa pode me chamar!`, 'pt-BR', msg); } catch {}
        });
      }
    }

    // ── Verificar resposta de QUIZ ─────────────────────
    const quiz = quizMap.get(gid);
    if (quiz && bodyN.includes(quiz.a)) {
      clearTimeout(quiz.timeout); quizMap.delete(gid);
      await sock.sendMessage(gid, { text: `🎉 ${senderTag} acertou! A resposta era *${quiz.a}* ✅`, mentions:[uid] });
      return;
    }

    // ── Verificar resposta de DESAFIO ─────────────────
    const challenge = challengeMap.get(gid);
    if (challenge && challenge.uid === uid) {
      const bL = body.toLowerCase().trim();
      if (['não','nao','n','nao quero','não quero','recuso','nop','no'].some(s => bL===s||bL.startsWith(s+' '))) {
        clearTimeout(challenge.timeout); challengeMap.delete(gid);
        await sock.sendMessage(gid, { text: `😤 ${senderTag} disse *NÃO* e foi removido(a)! 🚪 Até mais!`, mentions:[uid] });
        try { await sock.groupParticipantsUpdate(gid, [uid], 'remove'); } catch {}
        return;
      }
      const corrN = norm(challenge.correct); const ansN = norm(bL);
      const isCorrect = ansN.includes(corrN) || corrN.includes(ansN) || (challenge.correctLetter && ansN === challenge.correctLetter.toLowerCase());
      clearTimeout(challenge.timeout); challengeMap.delete(gid);
      if (isCorrect) {
        await sock.sendMessage(gid, { text: `🎉 *ACERTOU!* ${senderTag} permanece no grupo! Parabéns! 🏆🎊`, mentions:[uid] });
      } else {
        await sock.sendMessage(gid, { text: `❌ *ERROU!* ${senderTag} foi removido(a)!\n✅ Resposta certa: *${challenge.correct}* 😬`, mentions:[uid] });
        try { await sock.groupParticipantsUpdate(gid, [uid], 'remove'); } catch {}
      }
      return;
    }

    // ── Apresentação automática ────────────────────────
    if (getS(gid,'trackPresent',false)) {
      const triggerWords = ['me chamo','meu nome é','sou o','sou a','me apresentando','me apresento','olá sou','oi sou'];
      if (triggerWords.some(w => bodyN.includes(w))) {
        const pr = presents[gid] || [];
        if (!pr.includes(uid)) { pr.push(uid); presents[gid] = pr; saveDB(DB.presents, presents); }
      }
    }

    // ════════════════ COMANDOS ════════════════════════
    if (!body.startsWith(PREFIX)) return;

    const [rawCmd, ...args] = body.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = rawCmd.toLowerCase();

    const onlyAdmin = ['fechar','abrir','kick','ban','promover','rebaixar','gf','ga','acordar','desafiodiario','desafio','bemvindo','monitoring','antilink','antifake','antiNSFW','antiViewOnce','autoclose'];
    if (onlyAdmin.includes(cmd) && !senderAdm && !senderOwn) {
      return sock.sendMessage(gid, { text: '🚫 Apenas administradores podem usar este comando!' });
    }

    switch (cmd) {

      // ── 🎵 PLAY ──────────────────────────────────────
      case 'play': case 'musica': case 'música': {
        if (!args.length) { await sock.sendMessage(gid,{text:`🎵 Uso: ${PREFIX}play <música ou link>`}); break; }
        const query = args.join(' ');
        await sock.sendMessage(gid,{text:`🔍 Buscando *${query.slice(0,50)}*...\n⏳ Aguarde...`},{quoted:msg});
        try {
          const {file,title,dur,mime} = await baixarMusica(query);
          const buf = await fs.readFile(file);
          await sock.sendMessage(gid,{audio:buf,mimetype:mime,fileName:`${title}.mp3`,ptt:false},{quoted:msg});
          await sock.sendMessage(gid,{text:`✅ *${title}*  ⏱️ ${dur}`});
          fs.remove(file).catch(()=>{});
        } catch(e) {
          await sock.sendMessage(gid,{text:`❌ Erro no /play: ${e.message}`});
        }
        break;
      }

      // ── 📹 YOUTUBE ───────────────────────────────────
      case 'yt': case 'ytb': case 'youtube': case 'playvid': {
        const q = args.join(' ');
        if (!q) { await sock.sendMessage(gid,{text:`📹 Uso: ${PREFIX}yt <link ou busca>`}); break; }
        await sock.sendMessage(gid,{text:`⬇️ Baixando vídeo *${q.slice(0,50)}*...\n⏳ Aguarde...`},{quoted:msg});
        try {
          const file = await baixarVideoYT(q);
          const buf = await fs.readFile(file);
          const sizeMB = (buf.length/1024/1024).toFixed(1);
          await sock.sendMessage(gid,{video:buf,mimetype:'video/mp4',caption:`✅ Vídeo baixado! 📹 ${sizeMB} MB`},{quoted:msg});
          fs.remove(file).catch(()=>{});
        } catch(e) { await sock.sendMessage(gid,{text:`❌ Erro: ${e.message}`}); }
        break;
      }

      // ── 🎵 TIKTOK ────────────────────────────────────
      case 'tiktok': case 'tt': case 'tk': {
        const url = args[0];
        if (!url) { await sock.sendMessage(gid,{text:`🎵 Uso: ${PREFIX}tiktok <link>`}); break; }
        await sock.sendMessage(gid,{text:`⬇️ Baixando TikTok...`},{quoted:msg});
        try {
          const {buf,title} = await baixarTikTok(url);
          await sock.sendMessage(gid,{video:buf,mimetype:'video/mp4',caption:`✅ *${title}* 🎵`},{quoted:msg});
        } catch(e) { await sock.sendMessage(gid,{text:`❌ Erro: ${e.message}`}); }
        break;
      }

      case 'tiktok_audio': case 'tkaudio': {
        const url = args[0];
        if (!url) { await sock.sendMessage(gid,{text:`🎵 Uso: ${PREFIX}tiktok_audio <link>`}); break; }
        await sock.sendMessage(gid,{text:`⬇️ Baixando áudio...`},{quoted:msg});
        try {
          const {buf,title} = await baixarTikTokAudio(url);
          await sock.sendMessage(gid,{audio:buf,mimetype:'audio/mpeg',fileName:`${title}.mp3`,ptt:false},{quoted:msg});
        } catch(e) { await sock.sendMessage(gid,{text:`❌ Erro: ${e.message}`}); }
        break;
      }

      // ── 📸 INSTAGRAM ─────────────────────────────────
      case 'insta': case 'instagram': case 'ig': case 'reel': {
        const url = args[0];
        if (!url) { await sock.sendMessage(gid,{text:`📸 Uso: ${PREFIX}insta <link>`}); break; }
        await sock.sendMessage(gid,{text:`⬇️ Baixando Instagram...`},{quoted:msg});
        try {
          const buf = await baixarInstagram(url);
          await sock.sendMessage(gid,{video:buf,mimetype:'video/mp4',caption:`✅ Instagram baixado! 📸`},{quoted:msg});
        } catch(e) { await sock.sendMessage(gid,{text:`❌ Erro: ${e.message}`}); }
        break;
      }

      // ── 🤖 GPT ───────────────────────────────────────
      case 'gpt': case 'ia': case 'ai': case 'chat': {
        const pergunta = args.join(' ');
        if (!pergunta) { await sock.sendMessage(gid,{text:`🤖 Uso: ${PREFIX}gpt <pergunta>`}); break; }
        await sock.sendMessage(gid,{text:`🤖 *${BOT_NAME}* está pensando...`},{quoted:msg});
        try {
          const resposta = await perguntarGpt(pergunta);
          await sock.sendMessage(gid,{text:`🤖 *Jordan IA:*\n\n${resposta}`},{quoted:msg});
        } catch(e) { await sock.sendMessage(gid,{text:`❌ ${e.message}`}); }
        break;
      }

      // ── 🌤️ CLIMA ─────────────────────────────────────
      case 'clima': case 'weather': case 'tempo': {
        const cidade = args.join(' ')||'São Paulo';
        await sock.sendMessage(gid,{text:`🌤️ Buscando clima de *${cidade}*...`},{quoted:msg});
        try {
          const c = await buscarClima(cidade);
          await sock.sendMessage(gid,{text:`🌤️ *Clima em ${c.city}${c.country?', '+c.country:''}*\n\n🌡️ Temperatura: *${c.temp}°C*\n🤔 Sensação: *${c.feel}°C*\n💧 Umidade: *${c.humid}%*\n💨 Vento: *${c.wind} km/h*\n🔆 UV: *${c.uv}*\n☁️ ${c.desc}`},{quoted:msg});
        } catch(e) { await sock.sendMessage(gid,{text:`❌ ${e.message}`}); }
        break;
      }

      // ── 📚 WIKI ───────────────────────────────────────
      case 'wiki': case 'wikipedia': case 'pesquisa': {
        const q = args.join(' ');
        if (!q) { await sock.sendMessage(gid,{text:`📚 Uso: ${PREFIX}wiki <termo>`}); break; }
        try {
          const w = await buscarWiki(q);
          const txt = `📚 *${w.title}*\n\n${w.extract}${w.extract.length>=900?'...':''}\n\n🔗 ${w.link}`;
          if (w.thumb) { try { const imgBuf = await fetch(w.thumb,{timeout:8000}).then(r=>r.buffer()); await sock.sendMessage(gid,{image:imgBuf,caption:txt},{quoted:msg}); break; } catch {} }
          await sock.sendMessage(gid,{text:txt},{quoted:msg});
        } catch(e) { await sock.sendMessage(gid,{text:`❌ ${e.message}`}); }
        break;
      }

      // ── 🎬 FILME ─────────────────────────────────────
      case 'movie': case 'filme': case 'imdb': {
        const titulo = args.join(' ');
        if (!titulo) { await sock.sendMessage(gid,{text:`🎬 Uso: ${PREFIX}movie <título>`}); break; }
        try {
          const d = await buscarFilme(titulo);
          const txt = `🎬 *${d.Title}* (${d.Year})\n\n⭐ IMDB: *${d.imdbRating}/10*\n🎭 Gênero: *${d.Genre}*\n📅 Lançamento: *${d.Released}*\n🌍 País: *${d.Country}*\n⏱️ Duração: *${d.Runtime}*\n👥 Elenco: *${d.Actors}*\n\n📝 _${d.Plot}_`;
          if (d.Poster&&d.Poster!=='N/A') { try { const imgBuf=await fetch(d.Poster,{timeout:8000}).then(r=>r.buffer()); await sock.sendMessage(gid,{image:imgBuf,caption:txt},{quoted:msg}); break; } catch {} }
          await sock.sendMessage(gid,{text:txt},{quoted:msg});
        } catch(e) { await sock.sendMessage(gid,{text:`❌ ${e.message}`}); }
        break;
      }

      // ── 🌐 TRADUZIR ───────────────────────────────────
      case 'traduzir': case 'translate': case 'tr': {
        const lang = args[0]||'en'; const texto = args.slice(1).join(' ');
        if (!texto) { await sock.sendMessage(gid,{text:`🌐 Uso: ${PREFIX}traduzir <idioma> <texto>\nEx: ${PREFIX}traduzir en Olá mundo`}); break; }
        try {
          const {result,srcLang} = await traduzir(texto,lang);
          await sock.sendMessage(gid,{text:`🌐 *Tradução*\n\n🔤 De: *${srcLang}* → Para: *${lang}*\n\n${result}`},{quoted:msg});
        } catch(e) { await sock.sendMessage(gid,{text:`❌ ${e.message}`}); }
        break;
      }

      // ── 📱 QRCODE ────────────────────────────────────
      case 'qrcode': case 'qr': {
        const texto = args.join(' ');
        if (!texto) { await sock.sendMessage(gid,{text:`📱 Uso: ${PREFIX}qrcode <texto ou link>`}); break; }
        try {
          const url = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(texto)}`;
          const buf = await fetch(url,{timeout:10000}).then(r=>r.buffer());
          await sock.sendMessage(gid,{image:buf,caption:`✅ *QR Code gerado!*\n📝 ${texto.slice(0,60)}`},{quoted:msg});
        } catch(e) { await sock.sendMessage(gid,{text:`❌ ${e.message}`}); }
        break;
      }

      // ── 🖼️ STICKER ───────────────────────────────────
      case 'sticker': case 's': case 'fig': case 'figurinha': {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage || msg.message;
        const isVideo   = !!(quotedMsg?.videoMessage);
        const buf       = await getMediaBuf(quotedMsg);
        if (!buf) { await sock.sendMessage(gid,{text:`🖼️ Responda uma *imagem ou vídeo* com ${PREFIX}sticker`}); break; }
        await sock.sendMessage(gid,{text:'⏳ Criando sticker...'},{quoted:msg});
        try {
          const webp = await toStickerWebp(buf, isVideo);
          await sock.sendMessage(gid,{sticker:webp},{quoted:msg});
        } catch(e) { await sock.sendMessage(gid,{text:`❌ Erro: ${e.message}`}); }
        break;
      }

      // ── 🖼️ TOIMG ─────────────────────────────────────
      case 'toimg': {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage || msg.message;
        if (!quotedMsg?.stickerMessage) { await sock.sendMessage(gid,{text:`🖼️ Responda um *sticker* com ${PREFIX}toimg`}); break; }
        try {
          const stream = await downloadContentFromMessage(quotedMsg.stickerMessage,'sticker');
          const chunks=[]; for await(const c of stream) chunks.push(c);
          await sock.sendMessage(gid,{image:Buffer.concat(chunks),caption:'✅ Sticker convertido para imagem!'},{quoted:msg});
        } catch(e) { await sock.sendMessage(gid,{text:`❌ Erro: ${e.message}`}); }
        break;
      }

      // ── 🔊 TTS ────────────────────────────────────────
      case 'gtts': case 'tts': case 'falar': {
        const texto = args.join(' ');
        if (!texto) { await sock.sendMessage(gid,{text:`🔊 Uso: ${PREFIX}gtts <texto>`}); break; }
        try {
          const tts = await getTTS(texto);
          await sock.sendMessage(gid,{audio:tts,mimetype:'audio/mpeg',ptt:true},{quoted:msg});
        } catch(e) { await sock.sendMessage(gid,{text:`❌ ${e.message}`}); }
        break;
      }

      // ── 🧮 CALCULAR ───────────────────────────────────
      case 'calcular': case 'calc': {
        const expr = args.join(' ').replace(/[^0-9+\-*/().% ]/g,'');
        if (!expr) { await sock.sendMessage(gid,{text:`🧮 Uso: ${PREFIX}calcular <expressão>\nEx: ${PREFIX}calcular 2+2*10`}); break; }
        try {
          // eslint-disable-next-line no-new-func
          const result = Function(`"use strict"; return (${expr})`)();
          await sock.sendMessage(gid,{text:`🧮 *Calculadora*\n\n📝 \`${expr}\`\n✅ Resultado: *${result}*`},{quoted:msg});
        } catch { await sock.sendMessage(gid,{text:`❌ Expressão inválida`}); }
        break;
      }

      // ── 📄 GERAR CPF ─────────────────────────────────
      case 'gerarcpf': case 'cpf': {
        await sock.sendMessage(gid,{text:`📄 *CPF Gerado* _(apenas para testes)_\n\n\`${gerarCPF()}\`\n\n⚠️ Não use de forma ilegal.`},{quoted:msg});
        break;
      }

      // ── 📸 PERFIL ─────────────────────────────────────
      case 'perfil': case 'pp': case 'foto': {
        const ctx = msg.message?.extendedTextMessage?.contextInfo;
        const target = ctx?.participant||(args[0]?`${args[0].replace(/\D/g,'')}@s.whatsapp.net`:uid);
        try {
          const ppUrl = await sock.profilePictureUrl(target,'image');
          const buf   = await fetch(ppUrl,{timeout:10000}).then(r=>r.buffer());
          await sock.sendMessage(gid,{image:buf,caption:`📸 *Foto de perfil de @${target.split('@')[0]}*`,mentions:[target]},{quoted:msg});
        } catch { await sock.sendMessage(gid,{text:`❌ Foto de perfil não disponível ou privada.`}); }
        break;
      }

      // ── 🏓 PING ───────────────────────────────────────
      case 'ping': case 'status': case 'online': {
        const up=process.uptime(); const h=Math.floor(up/3600); const m=Math.floor((up%3600)/60);
        await sock.sendMessage(gid,{text:`🤖 *${BOT_NAME}*\n✅ Online!\n⏱️ Uptime: ${h}h ${m}min\n📅 ${moment().tz('America/Sao_Paulo').format('DD/MM/YYYY HH:mm:ss')}\n🔧 FFMPEG: ${FFMPEG_PATH?'✅':'❌'}`});
        break;
      }

      // ── 👑 DONO ───────────────────────────────────────
      case 'dono': case 'owner': {
        await sock.sendMessage(gid,{text:`👑 *Dono do Bot*\n\nNome: *${OWNER_NAME}*\nContato: wa.me/${OWNER_NUM}`});
        break;
      }

      // ── 📋 MENU ───────────────────────────────────────
      case 'menu': case 'ajuda': case 'help': await cmdMenu(msg, gid); break;
      case 'menuprincipal':   await cmdMenuPrincipal(msg, gid);   break;
      case 'menudono':        await cmdMenuDono(msg, gid);        break;
      case 'menuadm':         await cmdMenuAdm(msg, gid);         break;
      case 'menudownloads':   await cmdMenuDownloads(msg, gid);   break;
      case 'menupesquisas':   await cmdMenuPesquisas(msg, gid);   break;
      case 'menufigurinhas':  await cmdMenuFigurinhas(msg, gid);  break;
      case 'menubrincadeira': await cmdMenuBrincadeira(msg, gid); break;
      case 'menudinheiro':    await cmdMenuDinheiro(msg, gid);    break;
      case 'menulogos':       await cmdMenuLogos(msg, gid);       break;

      // ── 🔒 FECHAR / ABRIR ─────────────────────────────
      case 'fechar': case 'fechargp': {
        if (!botAdm) { await sock.sendMessage(gid,{text:'❌ Preciso ser admin!'}); break; }
        await sock.groupSettingUpdate(gid,'announcement');
        await sock.sendMessage(gid,{text:'🔒 *Grupo fechado!* Só admins podem enviar mensagens.'});
        break;
      }
      case 'abrir': case 'abrirgp': {
        if (!botAdm) { await sock.sendMessage(gid,{text:'❌ Preciso ser admin!'}); break; }
        await sock.groupSettingUpdate(gid,'not_announcement');
        await sock.sendMessage(gid,{text:'🔓 *Grupo aberto!* Todos podem enviar mensagens.'});
        break;
      }

      // ── ⏰ /gf — fechar horário ───────────────────────
      case 'gf': case 'horariofecha': {
        const hora = args[0]?.toLowerCase();
        if (!hora) { const a=getS(gid,'gf_time',null); await sock.sendMessage(gid,{text:`🕐 *Fechar grupo automaticamente*\n\nUso: ${PREFIX}gf HH:mm\nPara remover: ${PREFIX}gf off\n\n${a?`⏰ Atual: *${a}*`:'❌ Não definido'}`}); break; }
        if (hora==='off'||hora==='desativar') { setS(gid,'gf_time',null); await sock.sendMessage(gid,{text:'✅ Fechamento automático removido!'}); break; }
        if (!/^\d{1,2}:\d{2}$/.test(hora)) { await sock.sendMessage(gid,{text:'❌ Formato inválido. Use HH:mm (ex: 22:00)'}); break; }
        setS(gid,'gf_time',hora);
        await sock.sendMessage(gid,{text:`✅ Grupo será *fechado automaticamente às ${hora}* todos os dias! 🔒`});
        break;
      }

      // ── ⏰ /ga — abrir horário ────────────────────────
      case 'ga': case 'horarioabre': {
        const hora = args[0]?.toLowerCase();
        if (!hora) { const a=getS(gid,'ga_time',null); await sock.sendMessage(gid,{text:`🕐 *Abrir grupo automaticamente*\n\nUso: ${PREFIX}ga HH:mm\nPara remover: ${PREFIX}ga off\n\n${a?`⏰ Atual: *${a}*`:'❌ Não definido'}`}); break; }
        if (hora==='off'||hora==='desativar') { setS(gid,'ga_time',null); await sock.sendMessage(gid,{text:'✅ Abertura automática removida!'}); break; }
        if (!/^\d{1,2}:\d{2}$/.test(hora)) { await sock.sendMessage(gid,{text:'❌ Formato inválido. Use HH:mm (ex: 08:00)'}); break; }
        setS(gid,'ga_time',hora);
        await sock.sendMessage(gid,{text:`✅ Grupo será *aberto automaticamente às ${hora}* todos os dias! 🔓`});
        break;
      }

      // ── 🔔 ACORDAR ────────────────────────────────────
      case 'acordar': case 'wakeup': {
        const t = args[0]?.toLowerCase();
        const grupos = readDB(DB.grupos,{});
        if (!grupos[gid]) grupos[gid]={};
        if (t==='on')  { grupos[gid].wakeup=true;  saveDB(DB.grupos,grupos); await sock.sendMessage(gid,{text:'✅ Marcação a cada 2h *ativada!* 🔔\nO bot vai marcar todos a cada 2 horas!'}); }
        else if (t==='off') { grupos[gid].wakeup=false; saveDB(DB.grupos,grupos); await sock.sendMessage(gid,{text:'❌ Marcação 2h *desativada.*'}); }
        else { await sock.sendMessage(gid,{text:`🔔 *Acordar 2h:* ${grupos[gid]?.wakeup?'✅ ON':'❌ OFF'}\n\nUso: ${PREFIX}acordar on/off`}); }
        break;
      }

      // ── ⚔️ DESAFIO DIÁRIO ──────────────────────────────
      case 'desafiodiario': {
        const t = args[0]?.toLowerCase();
        const grupos = readDB(DB.grupos,{});
        if (!grupos[gid]) grupos[gid]={};
        if (t==='on')  { grupos[gid].desafio=true;  saveDB(DB.grupos,grupos); await sock.sendMessage(gid,{text:'✅ Desafio diário *ativado!* ⚔️\n3x por dia o bot vai desafiar alguém (10h, 15h e 20h)!'}); }
        else if (t==='off') { grupos[gid].desafio=false; saveDB(DB.grupos,grupos); await sock.sendMessage(gid,{text:'❌ Desafio diário *desativado.*'}); }
        else { await sock.sendMessage(gid,{text:`⚔️ *Desafio diário:* ${grupos[gid]?.desafio?'✅ ON':'❌ OFF'}\n\nUso: ${PREFIX}desafiodiario on/off`}); }
        break;
      }

      // ── ⚔️ DESAFIO IMEDIATO ───────────────────────────
      case 'desafio': case 'challenge': {
        if (challengeMap.has(gid)) { await sock.sendMessage(gid,{text:'⚠️ Já há um desafio em andamento!'}); break; }
        if (!botAdm) { await sock.sendMessage(gid,{text:'❌ Preciso ser admin para remover participantes!'}); break; }
        await iniciarDesafio(gid, parts);
        break;
      }

      // ── ANTILINK toggle ───────────────────────────────
      case 'antilink': {
        const t = args[0]?.toLowerCase();
        if (t==='on')  { setS(gid,'antiLink',true);  await sock.sendMessage(gid,{text:'✅ Anti-link de grupo *ativado!*'}); }
        else if (t==='off') { setS(gid,'antiLink',false); await sock.sendMessage(gid,{text:'❌ Anti-link *desativado.*'}); }
        else { await sock.sendMessage(gid,{text:`🔗 Anti-link: ${getS(gid,'antiLink',false)?'✅ ON':'❌ OFF'}\n\nUso: ${PREFIX}antilink on/off`}); }
        break;
      }

      // ── ANTIFAKE toggle ───────────────────────────────
      case 'antifake': {
        const t = args[0]?.toLowerCase();
        if (t==='on')  { setS(gid,'antiFake',true);  await sock.sendMessage(gid,{text:'✅ Anti-fake *ativado!* O bot vai verificar novos membros.'}); }
        else if (t==='off') { setS(gid,'antiFake',false); await sock.sendMessage(gid,{text:'❌ Anti-fake *desativado.*'}); }
        else { await sock.sendMessage(gid,{text:`🕵️ Anti-fake: ${getS(gid,'antiFake',false)?'✅ ON':'❌ OFF'}\n\nUso: ${PREFIX}antifake on/off`}); }
        break;
      }

      // ── AUTOCLOSE toggle ──────────────────────────────
      case 'autoclose': {
        const t = args[0]?.toLowerCase();
        if (t==='on')  { setS(gid,'autoClose',true);  await sock.sendMessage(gid,{text:'✅ Fechamento automático por briga *ativado!*'}); }
        else if (t==='off') { setS(gid,'autoClose',false); await sock.sendMessage(gid,{text:'❌ Fechamento automático *desativado.*'}); }
        else { await sock.sendMessage(gid,{text:`🛡️ Auto-close: ${getS(gid,'autoClose',true)?'✅ ON':'❌ OFF'}\n\nUso: ${PREFIX}autoclose on/off`}); }
        break;
      }

      // ── 👋 BEM-VINDO ──────────────────────────────────
      case 'bemvindo': case 'boasvindas': {
        const t = args[0]?.toLowerCase();
        if (t==='on')        { setS(gid,'welcome',true);  await sock.sendMessage(gid,{text:'✅ Boas-vindas *ativadas!*'}); }
        else if (t==='off')  { setS(gid,'welcome',false); await sock.sendMessage(gid,{text:'❌ Boas-vindas *desativadas.*'}); }
        else if (t==='texto' && args.length>1) { setS(gid,'welcomeText',args.slice(1).join(' ')); await sock.sendMessage(gid,{text:'✅ Texto de boas-vindas atualizado!\n\nDica: use {tag} para mencionar o usuário e {grupo} para o nome do grupo.'}); }
        else if (t==='foto'  && args.length>1) { setS(gid,'welcomeFoto',args[1]); await sock.sendMessage(gid,{text:'✅ Foto de boas-vindas atualizada!'}); }
        else {
          const st = getS(gid,'welcome',false);
          await sock.sendMessage(gid,{text:`📋 *Boas-vindas:* ${st?'✅ ON':'❌ OFF'}\n\nComandos:\n${PREFIX}bemvindo on\n${PREFIX}bemvindo off\n${PREFIX}bemvindo texto <mensagem> (use {tag} e {grupo})\n${PREFIX}bemvindo foto <url da imagem>`});
        }
        break;
      }

      // ── 📊 APRESENTADOS ───────────────────────────────
      case 'apresentados': {
        const pList = presents[gid]||[];
        const notP  = parts.filter(p=>!pList.includes(p.id)&&!p.admin).slice(0,20);
        await sock.sendMessage(gid,{
          text:`📊 *Controle de Apresentações*\n\n✅ Apresentados: ${pList.length}\n❌ Não apresentados: ${notP.length}\n\n${notP.map(p=>`@${p.id.split('@')[0]}`).join('\n')}`,
          mentions: notP.map(p=>p.id),
        });
        break;
      }

      // ── 🎮 QUIZ ───────────────────────────────────────
      case 'quiz': {
        if (quizMap.has(gid)) { await sock.sendMessage(gid,{text:'⚠️ Já há um quiz em andamento!'}); break; }
        const q = QUIZ_LOCAL[Math.floor(Math.random()*QUIZ_LOCAL.length)];
        const tout = setTimeout(async()=>{ quizMap.delete(gid); await sock.sendMessage(gid,{text:`⏰ Tempo esgotado! A resposta era: *${q.a}*`}).catch(()=>{}); }, 30000);
        quizMap.set(gid,{a:norm(q.a),timeout:tout});
        await sock.sendMessage(gid,{text:`🎮 *QUIZ JORDAN BOT!*\n\n${q.q}\n\n⏱️ Você tem 30 segundos para responder!`});
        break;
      }

      // ── 🎲 DADO ───────────────────────────────────────
      case 'dado': {
        const r=Math.floor(Math.random()*6)+1; const e=['','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣'];
        await sock.sendMessage(gid,{text:`🎲 @${uid.split('@')[0]} jogou o dado e tirou: *${e[r]} (${r})*`,mentions:[uid]});
        break;
      }

      // ── 🎱 BOLA 8 ─────────────────────────────────────
      case '8ball': case 'bola8': {
        if (!args.length) { await sock.sendMessage(gid,{text:`🎱 Uso: ${PREFIX}8ball <pergunta>`}); break; }
        await sock.sendMessage(gid,{text:`🎱 *Pergunta:* ${args.join(' ')}\n\n*Resposta:* ${BALL8[Math.floor(Math.random()*BALL8.length)]}`});
        break;
      }

      // ── 👥 KICK / BAN ─────────────────────────────────
      case 'kick': case 'ban': {
        if (!botAdm) { await sock.sendMessage(gid,{text:'❌ Preciso ser admin!'}); break; }
        const ctx = msg.message?.extendedTextMessage?.contextInfo;
        const target = ctx?.participant||(args[0]?`${args[0].replace(/\D/g,'')}@s.whatsapp.net`:null);
        if (!target) { await sock.sendMessage(gid,{text:`❌ Mencione alguém ou responda uma mensagem`}); break; }
        try {
          await sock.groupParticipantsUpdate(gid,[target],'remove');
          await sock.sendMessage(gid,{text:`✅ @${target.split('@')[0]} foi removido(a) do grupo!`,mentions:[target]});
        } catch(e) { await sock.sendMessage(gid,{text:`❌ Erro: ${e.message}`}); }
        break;
      }

      // ── 📊 MONITORING ─────────────────────────────────
      case 'monitoring': {
        const t = args[0]?.toLowerCase();
        const grupos = readDB(DB.grupos,{}); if (!grupos[gid]) grupos[gid]={};
        if (t==='on')  { grupos[gid].monitoring=true;  saveDB(DB.grupos,grupos); await sock.sendMessage(gid,{text:'✅ Monitoramento *ativado!*'}); }
        else if (t==='off') { grupos[gid].monitoring=false; saveDB(DB.grupos,grupos); await sock.sendMessage(gid,{text:'❌ Monitoramento *desativado.*'}); }
        break;
      }

      // ── 🔍 CONSULTA NÚMERO ────────────────────────────
      case 'numero': case 'num': case 'cel': {
        if (!senderOwn) { await sock.sendMessage(gid,{text:'🔒 Apenas o dono pode usar este comando!'}); break; }
        const n = args[0];
        if (!n) { await sock.sendMessage(gid,{text:`🔍 Uso: ${PREFIX}numero <número>`}); break; }
        try { await sock.sendMessage(gid,{text:await consultarNumero(n)},{quoted:msg}); } catch(e) { await sock.sendMessage(gid,{text:`❌ ${e.message}`}); }
        break;
      }

      default: break;
    }

  } catch(e) { console.error('[MSG ERR]', e.message); }
}

// ═══════════════════════════════════════════════════════════════════
// WELCOME + DETECÇÃO DE FAKE
// ═══════════════════════════════════════════════════════════════════
async function onParticipants({ id: gid, participants, action }) {
  if (action !== 'add') return;

  let meta;
  try { meta = await sock.groupMetadata(gid); } catch { return; }

  for (const uid of participants) {
    // Verificação de fake/spam
    if (getS(gid,'antiFake',false)) {
      setImmediate(async () => {
        try {
          const fake = await isFakeNumber(uid);
          if (fake) {
            await sendTTS(gid, `Vou remover você pois identifiquei você como um número fake, golpe ou algo fraudulento. Irei removê-lo para o bem do grupo.`);
            await sleep(2000);
            await sock.sendMessage(gid, {
              text: `🚨 @${uid.split('@')[0]} *identificado como número suspeito* (fake, golpe ou fraudulento)!\n\nSendo removido para segurança do grupo. ⛑️😉`,
              mentions: [uid],
            });
            await sock.groupParticipantsUpdate(gid, [uid], 'remove');
            return;
          }
        } catch {}
      });
    }

    // Boas-vindas
    if (!getS(gid,'welcome',false)) continue;

    const rawText = getS(gid,'welcomeText',
      `👋 *Bem-vindo(a) ao {grupo}!*\n\n{tag} seja muito bem-vindo(a)!\n\nPor favor se apresente: diga seu nome e de onde você é 😊\n📋 Leia as regras do grupo.`);

    const txt = rawText
      .replace(/\{tag\}/g, `@${uid.split('@')[0]}`)
      .replace(/\{grupo\}/g, meta.subject);

    const fotoUrl = getS(gid,'welcomeFoto',null);

    try {
      let imgBuf = null;
      if (fotoUrl) { try { imgBuf = await fetch(fotoUrl,{timeout:10000}).then(r=>r.buffer()); } catch {} }
      if (!imgBuf) {
        try { const ppUrl = await sock.profilePictureUrl(uid,'image'); imgBuf = await fetch(ppUrl,{timeout:8000}).then(r=>r.buffer()); } catch {}
      }
      if (imgBuf) {
        await sock.sendMessage(gid,{image:imgBuf,caption:txt,mentions:[uid]});
      } else {
        await sock.sendMessage(gid,{text:txt,mentions:[uid]});
      }
    } catch {}
  }
}

// ═══════════════════════════════════════════════════════════════════
// PERIÓDICOS — monitoramento, wake-up, desafio, agenda
// ═══════════════════════════════════════════════════════════════════
function startPeriodic() {
  // 1. Mensagem "assistente de olho" a cada 4h
  const watchMsgs = [
    '🤖👀 *Assistente de olho nas conversas* 🫡',
    '⚡ *Jordan Bot Oficial* monitorando o grupo. Respeitem as regras! 📋',
    '🛡️ Bot ativo e protegendo o grupo. Bom comportamento! 😊',
    '👀 Nada passa despercebido! *Jordan Bot* sempre de olho! 🤖',
  ];
  setInterval(async () => {
    const grupos = readDB(DB.grupos,{});
    for (const [gid,d] of Object.entries(grupos)) {
      if (!d?.monitoring) continue;
      try { await sock.sendMessage(gid,{text:watchMsgs[Math.floor(Math.random()*watchMsgs.length)]}); } catch {}
    }
  }, 4*60*60*1000);

  // 2. Wake-up a cada 2 horas
  setInterval(async () => {
    const grupos = readDB(DB.grupos,{});
    for (const [gid,d] of Object.entries(grupos)) {
      if (!d?.wakeup) continue;
      try {
        const meta = await sock.groupMetadata(gid).catch(()=>null); if (!meta) continue;
        const mentions = meta.participants.map(p=>p.id);
        const tags     = mentions.map(p=>`@${p.split('@')[0]}`).join(' ');
        await sock.sendMessage(gid,{
          text:`${tags}\n\n*BORAAA ACORDAR BANDO DE PREGUIÇA, SAI DA CAMA BANDO DE MIZERRAA ISSO NAO E HORA DE TA DORMINDO 🧐😅*`,
          mentions,
        });
      } catch {}
    }
  }, 2*60*60*1000);

  // 3. Verificação por minuto — agenda de horários + desafio 3x/dia
  setInterval(async () => {
    const now     = moment().tz('America/Sao_Paulo');
    const timeStr = now.format('HH:mm');
    const dateKey = now.format('YYYY-MM-DD HH:mm');

    // Desafio diário
    const challengeTimes = ['10:00','15:00','20:00'];
    if (challengeTimes.includes(timeStr) && !firedMinutes.has(`d_${dateKey}`)) {
      firedMinutes.add(`d_${dateKey}`);
      const grupos = readDB(DB.grupos,{});
      for (const [gid,d] of Object.entries(grupos)) {
        if (!d?.desafio) continue;
        try {
          const meta = await sock.groupMetadata(gid).catch(()=>null); if (!meta) continue;
          await iniciarDesafio(gid, meta.participants||[]);
        } catch {}
      }
    }

    // Agenda abrir/fechar
    if (!firedMinutes.has(`s_${dateKey}`)) {
      firedMinutes.add(`s_${dateKey}`);
      settings = readDB(DB.settings,{});
      for (const [gid,gs] of Object.entries(settings)) {
        if (gs.ga_time===timeStr) {
          try { await sock.groupSettingUpdate(gid,'not_announcement'); await sock.sendMessage(gid,{text:`🔓 *Grupo aberto automaticamente!* ✅\n⏰ ${timeStr}`}); } catch {}
        }
        if (gs.gf_time===timeStr) {
          try { await sock.groupSettingUpdate(gid,'announcement'); await sock.sendMessage(gid,{text:`🔒 *Grupo fechado automaticamente!* ✅\n⏰ ${timeStr}`}); } catch {}
        }
      }
    }

    // Limpar memória (evitar vazamento)
    if (firedMinutes.size>300) { const arr=[...firedMinutes]; arr.slice(0,150).forEach(k=>firedMinutes.delete(k)); }
    // Limpar cache de groupMetadata antigo
    for (const [gid,v] of metaCache.entries()) { if (Date.now()-v.ts>120000) metaCache.delete(gid); }

  }, 60*1000);
}

// ═══════════════════════════════════════════════════════════════════
// CONEXÃO — AUTO-RECONEXÃO
// ═══════════════════════════════════════════════════════════════════
async function startBot() {
  await setupFfmpeg();
  await fs.ensureDir(SESSION_DIR);
  await fs.ensureDir(TEMP_DIR);

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  let version;
  try { const r=await fetchLatestWaWebVersion({}); version=r.version; console.log('[VERSÃO] WA Web:', JSON.stringify(version)); }
  catch { try { const r=await fetchLatestBaileysVersion(); version=r.version; } catch { version=[2,3000,1015901307]; } console.log('[VERSÃO] Fallback:', JSON.stringify(version)); }

  const needsPairing = !state.creds.registered;

  sock = makeWASocket({
    version,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({level:'silent'})) },
    logger: pino({ level: 'silent' }),
    printQRInTerminal: !needsPairing,
    browser: ['Ubuntu','Chrome','20.0.04'],
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    markOnlineOnConnect: true,
    connectTimeoutMs:    60_000,
    keepAliveIntervalMs: 15_000,
    retryRequestDelayMs:  2_000,
    maxMsgRetryCount: 5,
    defaultQueryTimeoutMs: 60_000,
  });

  if (needsPairing) {
    const phone = OWNER_NUM.startsWith('55') ? OWNER_NUM : `55${OWNER_NUM}`;
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phone);
        const c = code.match(/.{1,4}/g)?.join('-')||code;
        console.log('\n╔═══════════════════════════════════════════╗');
        console.log('║       📱 CÓDIGO DE PAREAMENTO             ║');
        console.log('║                                           ║');
        console.log(`║   👉  ${c.padEnd(35)} ║`);
        console.log('║                                           ║');
        console.log('║  WhatsApp → Aparelhos conectados          ║');
        console.log('║  → Conectar com número de telefone        ║');
        console.log('╚═══════════════════════════════════════════╝\n');
      } catch(e) { console.log('[PAIRING] Falha:', e.message); console.log('[PAIRING] Escaneie o QR Code.'); }
    }, 2000);
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const err  = lastDisconnect?.error;
      const code = err?.output?.statusCode ?? err?.output?.payload?.statusCode ?? err?.data?.reason ?? err?.status ?? 0;
      const shouldClearSession = [401,403,405,500].includes(code);
      console.log(`[CONEXÃO] Encerrada — código: ${code}`);
      if (shouldClearSession) {
        console.log('[SESSÃO] Limpando e reiniciando...');
        await fs.remove(SESSION_DIR).catch(()=>{});
        retries=0; setTimeout(startBot,3000); return;
      }
      retries++;
      const delay = Math.min(4000*retries, 60000);
      console.log(`[RECONEXÃO] Tentativa ${retries} em ${delay/1000}s...`);
      setTimeout(startBot, delay);
    }
    if (connection === 'open') {
      retries=0;
      console.log(`\n✅ ${BOT_NAME} CONECTADO! Usuário: ${sock.user?.id}\n`);
      startPeriodic();
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    messages.forEach(m => onMessage(m));
  });

  sock.ev.on('group-participants.update', onParticipants);
}

// ═══════════════════════════════════════════════════════════════════
// INICIAR
// ═══════════════════════════════════════════════════════════════════
console.log(`\n🚀 Iniciando ${BOT_NAME} v3.0...\n`);
startBot().catch(e => { console.error('[ERRO FATAL]', e.message); setTimeout(startBot, 10000); });
