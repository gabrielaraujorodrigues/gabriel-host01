'use strict';

// ═══════════════════════════════════════════════════
//  JORDAN BOT OFICIAL — Bot WhatsApp Profissional
//  Dono: gabriel mods
// ═══════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════
const __root      = __dirname;
const CONFIG_PATH = path.join(__root, 'BANCO-DE-DADOS/P-INFORMACOES/media/Config-Kiimori.json');

let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}

const BOT_NAME    = config.NomeDoBot    || 'Jordan Bot Oficial';
const PREFIX      = config.prefix       || '/';
const OWNER_NUM   = (config.ownerNumber || config.Proprietário || '558694029686').replace(/\D/g, '');
const OWNER_NAME  = config.ownerName    || 'gabriel mods';
const API_SITE    = (config.SITE        || 'https://yuta-apis.xyz').replace(/\/$/, '');
const API_TOKEN   = config.TOKEN        || 'Mery1079';
const SESSION_DIR = path.join(__root, 'session_data');
const TEMP_DIR    = path.join(__root, 'temp_media');

// ── yt-dlp auto-detect ───────────────────────────────
async function getYtDlp() {
  const candidates = [
    path.join(process.env.HOME || '', '.local/bin/yt-dlp'),
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    '/home/runner/workspace/.pythonlibs/bin/yt-dlp',
  ];
  for (const p of candidates) {
    try { await fs.access(p, fs.constants.X_OK); return p; } catch {}
  }
  try {
    const { stdout } = await execAsync('which yt-dlp', { timeout: 3000 });
    const p = stdout.trim();
    if (p) return p;
  } catch {}
  return null;
}

// ═══════════════════════════════════════════════════
// DATABASE (JSON simples)
// ═══════════════════════════════════════════════════
const DB = {
  settings: path.join(__root, 'BANCO-DE-DADOS/group_settings.json'),
  presents: path.join(__root, 'BANCO-DE-DADOS/presentations.json'),
  grupos:   path.join(__root, 'BANCO-DE-DADOS/grupos/grupos.json'),
};

const readDB = (f, d = {}) => {
  try {
    if (!fs.existsSync(f)) { fs.ensureDirSync(path.dirname(f)); fs.writeJSONSync(f, d); return d; }
    return fs.readJSONSync(f);
  } catch { return d; }
};
const saveDB = (f, d) => {
  try { fs.ensureDirSync(path.dirname(f)); fs.writeJSONSync(f, d, { spaces: 2 }); } catch {}
};

let settings = readDB(DB.settings, {});
let presents = readDB(DB.presents, {});

const getS = (g, k, def) => settings[g]?.[k] !== undefined ? settings[g][k] : def;
const setS = (g, k, v) => {
  if (!settings[g]) settings[g] = {};
  settings[g][k] = v;
  saveDB(DB.settings, settings);
};

// ═══════════════════════════════════════════════════
// ESTADO EM MEMÓRIA
// ═══════════════════════════════════════════════════
const quizMap      = new Map(); // gid → {a, timeout}
const challengeMap = new Map(); // gid → {uid, correct, correctLetter, timeout, isLocal}
const floodMap     = new Map();
let sock;
let retries = 0;

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════
const isOwner = jid => {
  const n = jid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
  return n === OWNER_NUM || n === OWNER_NUM.slice(2);
};

const isAdminOf = (parts, jid) => {
  const p = parts.find(x => x.id === jid || x.id.split(':')[0] + '@s.whatsapp.net' === jid);
  return p?.admin === 'admin' || p?.admin === 'superadmin';
};

const botIsAdmin = parts => {
  if (!sock?.user?.id) return false;
  const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
  return isAdminOf(parts, botJid);
};

const norm = t => (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Pegar buffer de qualquer mídia citada ────────────
async function getMediaBuf(msgInner) {
  if (!msgInner) return null;
  const types = ['imageMessage', 'videoMessage', 'stickerMessage', 'audioMessage', 'documentMessage'];
  for (const t of types) {
    if (msgInner[t]) {
      try {
        const stream = await downloadContentFromMessage(msgInner[t], t.replace('Message', ''));
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        return Buffer.concat(chunks);
      } catch { return null; }
    }
  }
  return null;
}

// ── Converter imagem para sticker .webp via ffmpeg ───
async function toStickerWebp(inputBuf, animated = false) {
  await fs.ensureDir(TEMP_DIR);
  const tag     = Date.now();
  const inFile  = path.join(TEMP_DIR, `stk_in_${tag}`);
  const outFile = path.join(TEMP_DIR, `stk_${tag}.webp`);
  await fs.writeFile(inFile, inputBuf);

  await new Promise((resolve, reject) => {
    let cmd = ffmpegLib(inFile);
    if (animated) {
      cmd.outputOptions([
        '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2',
        '-loop', '0', '-t', '8', '-an',
      ]);
    } else {
      cmd.outputOptions([
        '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2',
        '-frames:v', '1',
      ]);
    }
    cmd.output(outFile).on('end', resolve).on('error', reject).run();
  });

  const buf = await fs.readFile(outFile);
  fs.remove(inFile).catch(() => {});
  fs.remove(outFile).catch(() => {});
  return buf;
}

// ── HTML entity decoder ──────────────────────────────
const decodeHtml = s => (s || '')
  .replace(/&quot;/g, '"')
  .replace(/&#039;/g, "'")
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&eacute;/g, 'é')
  .replace(/&ecirc;/g, 'ê')
  .replace(/&atilde;/g, 'ã')
  .replace(/&ccedil;/g, 'ç');

// ═══════════════════════════════════════════════════
// TTS — Google Translate (voz real)
// ═══════════════════════════════════════════════════
async function getTTS(text, lang = 'pt-BR') {
  const enc = encodeURIComponent(text.slice(0, 200));
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${enc}&tl=${lang}&client=tw-ob`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
    timeout: 12000,
  });
  if (!r.ok) throw new Error('TTS falhou');
  return r.buffer();
}

// ═══════════════════════════════════════════════════
// DOWNLOAD — Música (ytdl-core + ffmpeg)
// ═══════════════════════════════════════════════════
async function baixarMusica(query) {
  const ytdl = require('@distube/ytdl-core');
  await fs.ensureDir(TEMP_DIR);

  const isUrl = /^https?:\/\//i.test(query);
  let videoUrl = query;
  let title    = query.slice(0, 40);
  let duration = '';

  if (!isUrl) {
    const res = await ytSearch(query);
    const vid = res?.videos?.[0];
    if (!vid) throw new Error('Música não encontrada 🔍');
    if (vid.seconds > 600) throw new Error('Música muito longa (máx 10 min)');
    videoUrl = vid.url;
    title    = vid.title;
    duration = vid.timestamp;
  }

  const outFile = path.join(TEMP_DIR, `music_${Date.now()}.mp3`);

  await new Promise((resolve, reject) => {
    const stream = ytdl(videoUrl, {
      filter: 'audioonly',
      quality: 'highestaudio',
      requestOptions: { headers: { 'User-Agent': 'Mozilla/5.0' } },
    });
    stream.on('error', reject);
    ffmpegLib(stream)
      .audioBitrate(128)
      .format('mp3')
      .on('error', reject)
      .on('end', resolve)
      .save(outFile);
  });

  return { file: outFile, title, dur: duration };
}

// ═══════════════════════════════════════════════════
// DOWNLOAD — Vídeo YouTube (ytdl-core + ffmpeg)
// ═══════════════════════════════════════════════════
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

  // Tenta formato com áudio+vídeo direto (mais rápido)
  await new Promise((resolve, reject) => {
    const stream = ytdl(url, {
      filter: fmt => fmt.container === 'mp4' && fmt.hasVideo && fmt.hasAudio,
      quality: 'lowestvideo',
      requestOptions: { headers: { 'User-Agent': 'Mozilla/5.0' } },
    });
    stream.on('error', reject);
    ffmpegLib(stream)
      .outputOptions(['-movflags', 'faststart'])
      .format('mp4')
      .on('error', reject)
      .on('end', resolve)
      .save(outFile);
  });

  return outFile;
}

// ═══════════════════════════════════════════════════
// DOWNLOAD — TikTok (tikwm.com — sem chave)
// ═══════════════════════════════════════════════════
async function baixarTikTok(url) {
  const r = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&web=1&hd=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
    timeout: 20000,
  });
  const d = await r.json();
  if (!d?.data?.play) throw new Error('Não foi possível baixar o TikTok');
  const vr = await fetch(d.data.play, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } });
  return { buf: await vr.buffer(), title: d.data.title || 'TikTok' };
}

async function baixarTikTokAudio(url) {
  const r = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&web=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
    timeout: 20000,
  });
  const d = await r.json();
  const musicUrl = d?.data?.music || d?.data?.play;
  if (!musicUrl) throw new Error('Áudio do TikTok não encontrado');
  const ar = await fetch(musicUrl, { timeout: 30000 });
  return { buf: await ar.buffer(), title: d.data?.music_info?.title || 'TikTok Audio' };
}

// ═══════════════════════════════════════════════════
// DOWNLOAD — Instagram / Multi (yt-dlp fallback)
// ═══════════════════════════════════════════════════
async function baixarInstagram(url) {
  // Tenta API pública primeiro
  try {
    const r = await fetch('https://api.snapinsta.app/v1/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `url=${encodeURIComponent(url)}`,
      timeout: 25000,
    });
    const d = await r.json();
    const videoUrl = d?.data?.[0]?.url || d?.url;
    if (videoUrl) {
      const vr = await fetch(videoUrl, { timeout: 30000 });
      return vr.buffer();
    }
  } catch {}

  // Fallback: yt-dlp
  const ytdlp = await getYtDlp();
  if (!ytdlp) throw new Error('Não foi possível baixar. Instale o yt-dlp no servidor.');
  await fs.ensureDir(TEMP_DIR);
  const outFile = path.join(TEMP_DIR, `ig_${Date.now()}.mp4`);
  await execAsync(`"${ytdlp}" -o "${outFile}" "${url}" --no-playlist -q`, { timeout: 60000 });
  if (!fs.existsSync(outFile)) throw new Error('Download falhou');
  const buf = await fs.readFile(outFile);
  fs.remove(outFile).catch(() => {});
  return buf;
}

// ═══════════════════════════════════════════════════
// API — GPT (múltiplas APIs gratuitas com fallback)
// ═══════════════════════════════════════════════════
async function perguntarGpt(texto) {
  // Primeiro tenta a API do próprio bot (yuta-apis.xyz)
  const endpoints = [
    async () => {
      const r = await fetch(`${API_SITE}/api/ai/gpt?text=${encodeURIComponent(texto)}&apikey=${API_TOKEN}`, { timeout: 20000 });
      const d = await r.json();
      return d.result || d.message || d.response;
    },
    async () => {
      const r = await fetch(`https://api.paxsenix.biz.id/ai/chatgpt?text=${encodeURIComponent(texto)}`, { timeout: 20000 });
      const d = await r.json();
      return d.message || d.result;
    },
    async () => {
      const r = await fetch(`https://api.siputzx.my.id/api/ai/chatgpt3?prompt=${encodeURIComponent(texto)}`, { timeout: 20000 });
      const d = await r.json();
      return d.data;
    },
    async () => {
      const r = await fetch('https://luminai.my.id/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: texto, user: 'user', web: false }),
        timeout: 20000,
      });
      const d = await r.json();
      return d.result;
    },
  ];
  for (const fn of endpoints) {
    try {
      const result = await fn();
      if (result && String(result).length > 2) return String(result);
    } catch {}
  }
  throw new Error('Serviço de IA temporariamente indisponível. Tente novamente.');
}

// ═══════════════════════════════════════════════════
// API — Clima (wttr.in — sem chave)
// ═══════════════════════════════════════════════════
async function buscarClima(cidade) {
  const r = await fetch(`https://wttr.in/${encodeURIComponent(cidade)}?format=j1`, {
    headers: { 'User-Agent': 'curl/7.68.0', Accept: 'application/json' },
    timeout: 10000,
  });
  if (!r.ok) throw new Error('Cidade não encontrada');
  const d    = await r.json();
  const c    = d.current_condition[0];
  const area = d.nearest_area?.[0];
  return {
    temp:    c.temp_C,
    feel:    c.FeelsLikeC,
    humid:   c.humidity,
    wind:    c.windspeedKmph,
    desc:    c.lang_pt?.[0]?.value || c.weatherDesc?.[0]?.value || 'N/A',
    city:    area?.areaName?.[0]?.value || cidade,
    country: area?.country?.[0]?.value || '',
    uv:      c.uvIndex,
  };
}

// ═══════════════════════════════════════════════════
// API — Wikipedia PT (sem chave)
// ═══════════════════════════════════════════════════
async function buscarWiki(termo) {
  const r = await fetch(`https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(termo)}`, { timeout: 10000 });
  if (!r.ok) throw new Error('Nada encontrado para esse termo');
  const d = await r.json();
  if (d.type === 'disambiguation' || !d.extract) throw new Error('Termo muito genérico. Seja mais específico.');
  return {
    title:   d.title,
    extract: d.extract.slice(0, 900),
    link:    d.content_urls?.desktop?.page || '',
    thumb:   d.thumbnail?.source || null,
  };
}

// ═══════════════════════════════════════════════════
// API — Filme/Série (OMDB)
// ═══════════════════════════════════════════════════
async function buscarFilme(titulo) {
  const keys = ['trilogy', '12345678', 'poster'];
  for (const key of keys) {
    try {
      const r = await fetch(`https://www.omdbapi.com/?t=${encodeURIComponent(titulo)}&apikey=${key}`, { timeout: 10000 });
      const d = await r.json();
      if (d.Response === 'True') return d;
    } catch {}
  }
  throw new Error('Filme/série não encontrado');
}

// ═══════════════════════════════════════════════════
// API — Tradução (Google informal — sem chave)
// ═══════════════════════════════════════════════════
async function traduzir(texto, para = 'en', de = 'auto') {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${de}&tl=${para}&dt=t&q=${encodeURIComponent(texto)}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
  if (!r.ok) throw new Error('Tradução falhou');
  const d      = await r.json();
  const result = d[0]?.map(t => t[0]).filter(Boolean).join('') || '';
  if (!result) throw new Error('Sem resultado');
  return { result, srcLang: d[2] || de };
}

// ═══════════════════════════════════════════════════
// API — Trivia (Open Trivia DB + fallback local)
// ═══════════════════════════════════════════════════
const QUIZ_LOCAL = [
  { q: '🐘 Qual é o maior animal terrestre?',   a: 'elefante' },
  { q: '🦁 O rei dos animais é?',               a: 'leao' },
  { q: '🌊 Maior oceano do mundo?',             a: 'pacifico' },
  { q: '🌍 Maior país do mundo em área?',       a: 'russia' },
  { q: '🏔️ Montanha mais alta do mundo?',      a: 'everest' },
  { q: '⚡ Pokémon elétrico mais famoso?',       a: 'pikachu' },
  { q: '🍕 De qual país é a pizza?',            a: 'italia' },
  { q: '💧 Maior rio do mundo?',                a: 'amazonas' },
  { q: '🔴 Capital do Brasil?',                 a: 'brasilia' },
  { q: '🧪 Fórmula da água?',                  a: 'h2o' },
  { q: '🌙 Satélite natural da Terra?',         a: 'lua' },
  { q: '🦷 Quantos dentes tem um adulto?',      a: '32' },
  { q: '🐍 Maior cobra do mundo?',              a: 'anaconda' },
  { q: '☀️ Centro do sistema solar?',           a: 'sol' },
  { q: '🐬 Mamífero marinho super inteligente?', a: 'golfinho' },
];

async function buscarPerguntaTrivia() {
  try {
    const r = await fetch('https://opentdb.com/api.php?amount=1&type=multiple', { timeout: 8000 });
    const d = await r.json();
    const q = d.results?.[0];
    if (!q) throw new Error('vazio');

    const question = decodeHtml(q.question);
    const correct  = decodeHtml(q.correct_answer);
    const all      = [...q.incorrect_answers.map(decodeHtml), correct].sort(() => Math.random() - 0.5);
    const letters  = ['A', 'B', 'C', 'D'];
    const options  = all.map((a, i) => `*${letters[i]})* ${a}`);
    const cl       = letters[all.indexOf(correct)];

    const diff = q.difficulty === 'easy' ? '🟢 Fácil' : q.difficulty === 'medium' ? '🟡 Médio' : '🔴 Difícil';
    return { question, options, correct, correctLetter: cl, diff, isLocal: false };
  } catch {
    // Fallback local
    const loc = QUIZ_LOCAL[Math.floor(Math.random() * QUIZ_LOCAL.length)];
    return { question: loc.q, options: [], correct: loc.a, correctLetter: '', diff: '🟡 Médio', isLocal: true };
  }
}

// ═══════════════════════════════════════════════════
// DESAFIO ALEATÓRIO
// ═══════════════════════════════════════════════════
const STAR_LINE = '✩ ─────────────────────────── ✩';
const STAR_DIV  = '✩ · · · · · · · · · · · · · · · ✩';

async function iniciarDesafio(gid, parts) {
  if (challengeMap.has(gid)) return;
  if (!botIsAdmin(parts)) return;

  const candidates = parts.filter(p =>
    !p.admin &&
    !isOwner(p.id) &&
    p.id !== (sock?.user?.id?.split(':')[0] + '@s.whatsapp.net')
  );
  if (!candidates.length) return;

  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  const uid    = chosen.id;

  const perg = await buscarPerguntaTrivia();
  const opStr = perg.options.length ? perg.options.join('\n') : '_Responda com a palavra certa_';

  const txt =
`${STAR_LINE}
⚔️ *HORA DO DESAFIO!* ⚔️
${STAR_DIV}
🎯 @${uid.split('@')[0]} você foi escolhido(a)!

⚠️ *Regras do desafio:*
• Diga *NÃO* → você sai do grupo 🚪
• Erre a resposta → você sai do grupo 😬
• Acerte → você fica e ganha respeito! 🏆

⏱️ Você tem *45 segundos* para responder!

📝 *Pergunta (${perg.diff}):*
${perg.question}

${opStr}
${STAR_LINE}`;

  await sock.sendMessage(gid, { text: txt, mentions: [uid] });

  const timeout = setTimeout(async () => {
    challengeMap.delete(gid);
    try {
      await sock.sendMessage(gid, {
        text: `⏰ @${uid.split('@')[0]} *não respondeu a tempo* e foi removido(a)! 😬\n\n✅ Resposta certa: *${perg.correct}*`,
        mentions: [uid],
      });
      await sock.groupParticipantsUpdate(gid, [uid], 'remove');
    } catch {}
  }, 45000);

  challengeMap.set(gid, {
    uid,
    correct: perg.correct,
    correctLetter: perg.correctLetter,
    timeout,
    isLocal: perg.isLocal,
  });
}

// ═══════════════════════════════════════════════════
// GERADOR CPF (válido matematicamente)
// ═══════════════════════════════════════════════════
function gerarCPF() {
  const r  = () => Math.floor(Math.random() * 9);
  const d  = Array.from({ length: 9 }, r);
  const v1 = d.reduce((s, v, i) => s + v * (10 - i), 0);
  const c1 = (v1 * 10 % 11) % 10;
  const d2 = [...d, c1];
  const v2 = d2.reduce((s, v, i) => s + v * (11 - i), 0);
  const c2 = (v2 * 10 % 11) % 10;
  return `${d.slice(0,3).join('')}.${d.slice(3,6).join('')}.${d.slice(6,9).join('')}-${c1}${c2}`;
}

// ═══════════════════════════════════════════════════
// CONSULTA NÚMERO
// ═══════════════════════════════════════════════════
async function consultarNumero(rawNum) {
  const num = rawNum.replace(/\D/g, '');
  if (num.length < 8) throw new Error('Número inválido');
  const ddd = num.length >= 11 ? num.slice(-11, -9) : num.slice(0, 2);
  let estado = '', cidade = '';
  try {
    const r = await fetch(`https://brasilapi.com.br/api/ddd/v1/${ddd}`, { timeout: 8000 });
    if (r.ok) { const x = await r.json(); estado = x.state || ''; cidade = (x.cities || []).slice(0, 3).join(', '); }
  } catch {}
  const ops = { '11':'Vivo','12':'Claro','13':'TIM','15':'Vivo','17':'TIM','18':'Claro','21':'Claro',
    '25':'Oi','27':'Vivo','31':'TIM','41':'Vivo','51':'Claro','61':'Vivo','71':'Claro',
    '81':'TIM','85':'Vivo','86':'TIM','91':'Claro','92':'Vivo','95':'Oi','96':'Vivo' };
  return `📱 *Consulta de Número*\n\nNúmero: *+55 ${num}*\nDDD: *${ddd}*\nEstado: *${estado||'N/A'}*\nCidades: *${cidade||'N/A'}*\nOperadora provável: *${ops[ddd]||'Desconhecida'}*\n\n_Resultado aproximado baseado em DDD_`;
}

// ═══════════════════════════════════════════════════
// DETECÇÃO DE LINKS / BRIGA
// ═══════════════════════════════════════════════════
const FIGHT = ['vou te matar','te mato','vou te bater','vai tomar no','desgraçado',
  'filho da puta','vai se fuder','babaca','vou te achar','querendo briga','te acerto',
  'vai me pagar','te pego','te odeio','infeliz','miseravel','sua vadia'];
const hasLink  = t => /chat\.whatsapp\.com\/[A-Za-z0-9_-]+/.test(t || '');
const hasFight = t => FIGHT.some(w => norm(t).includes(w));

// ═══════════════════════════════════════════════════
// BOLA 8
// ═══════════════════════════════════════════════════
const BALL8 = [
  '✅ Com certeza!','✅ Definitivamente sim!','✅ Pode contar!',
  '🤔 Talvez...','🤔 Não tenho certeza.','🤔 As perspectivas são incertas.',
  '❌ Não conte com isso.','❌ Definitivamente não.','❌ Muito improvável.',
];

// ═══════════════════════════════════════════════════
// MENU PRINCIPAL
// ═══════════════════════════════════════════════════
async function cmdMenu(msg, gid) {
  const sender    = msg.key?.participant || msg.key?.remoteJid || gid;
  const isOwnSend = isOwner(sender);
  const cargo     = isOwnSend ? '👑 Dono' : 'Membro';

  const txt =
`✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩
🩷  *${BOT_NAME}*  🩷
✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩✩
🤖 *Bot:* ${BOT_NAME}
👤 *Usuário:* @${sender.split('@')[0]}
👑 *Dono:* ${OWNER_NAME}
👥 *Cargo:* ${cargo}
${STAR_LINE}

✩ ▸ *MENUS DOS MENUS*
${STAR_DIV}
🩷 ✩ → ${PREFIX}MenuPrincipal
🩷 ✩ → ${PREFIX}MenuDono
🩷 ✩ → ${PREFIX}MenuAdm
🩷 ✩ → ${PREFIX}MenuDownloads
🩷 ✩ → ${PREFIX}MenuPesquisas
🩷 ✩ → ${PREFIX}MenuFigurinhas
🩷 ✩ → ${PREFIX}MenuDinheiro
🩷 ✩ → ${PREFIX}MenuEfeitos
🩷 ✩ → ${PREFIX}MenuLogos
🩷 ✩ → ${PREFIX}MenuBrincadeira
🩷 ✩ → ${PREFIX}MenuNoPrefix
${STAR_LINE}

✩ ▸ *PRINCIPAIS*
${STAR_DIV}
🩷 ✩ → ${PREFIX}play <música>
🩷 ✩ → ${PREFIX}yt <link/busca>
🩷 ✩ → ${PREFIX}tiktok <link>
🩷 ✩ → ${PREFIX}tiktok_audio <link>
🩷 ✩ → ${PREFIX}insta <link>
🩷 ✩ → ${PREFIX}sticker (responda imagem)
🩷 ✩ → ${PREFIX}toimg (responda sticker)
🩷 ✩ → ${PREFIX}gpt <pergunta>
🩷 ✩ → ${PREFIX}clima <cidade>
🩷 ✩ → ${PREFIX}wiki <termo>
🩷 ✩ → ${PREFIX}traduzir <lang> <texto>
🩷 ✩ → ${PREFIX}qrcode <texto>
🩷 ✩ → ${PREFIX}gtts <texto>
🩷 ✩ → ${PREFIX}movie <filme>
🩷 ✩ → ${PREFIX}calcular <expr>
🩷 ✩ → ${PREFIX}perfil
🩷 ✩ → ${PREFIX}gerarcpf
🩷 ✩ → ${PREFIX}ping
${STAR_LINE}

✩ ▸ *AGENDAMENTOS / GRUPO*
${STAR_DIV}
🩷 ✩ → ${PREFIX}gf HH:mm (fechar horário)
🩷 ✩ → ${PREFIX}ga HH:mm (abrir horário)
🩷 ✩ → ${PREFIX}acordar on/off (marcação 2h)
🩷 ✩ → ${PREFIX}desafiodiario on/off
🩷 ✩ → ${PREFIX}desafio (iniciar desafio já)
${STAR_LINE}

🤖 *${BOT_NAME}*  👑 Dono: *${OWNER_NAME}*`;

  // Envia com GIF
  try {
    const gifBuf = await fetch('https://media1.tenor.com/m/mMBbFTasFpUAAAAd/anime-girl.gif', { timeout: 12000 }).then(r => r.buffer());
    await sock.sendMessage(gid, { video: gifBuf, caption: txt, gifPlayback: true, mimetype: 'video/mp4', mentions: [sender] }, { quoted: msg });
  } catch {
    await sock.sendMessage(gid, { text: txt, mentions: [sender] }, { quoted: msg });
  }

  // Áudio com voz de IA
  try {
    const tts = await getTTS('Aqui está o seu menu, aproveite as funcionalidades! Sou o seu assistente inteligente disponível 24 horas.');
    await sock.sendMessage(gid, { audio: tts, mimetype: 'audio/ogg; codecs=opus', ptt: true });
  } catch {}
}

// ── Sub-menu helper ──────────────────────────────────
async function sendSubMenu(gid, msg, titulo, cmds) {
  const linhas = cmds.map(c => `🩷 ✩ → ${c}`).join('\n');
  const txt =
`${STAR_LINE}
✩ ▸ *${titulo}*
${STAR_DIV}
${linhas}
${STAR_LINE}
🤖 *${BOT_NAME}*  👑 Dono: *${OWNER_NAME}*`;
  await sock.sendMessage(gid, { text: txt }, { quoted: msg });
}

async function cmdMenuPrincipal(msg, gid) {
  await sendSubMenu(gid, msg, 'MENU PRINCIPAL', [
    `${PREFIX}ping`,`${PREFIX}Atividade`,`${PREFIX}Rankativo`,`${PREFIX}Infodono`,
    `${PREFIX}avaliar`,`${PREFIX}me`,`${PREFIX}alugar`,`${PREFIX}Checkativo`,
    `${PREFIX}totext`,`${PREFIX}responda`,`${PREFIX}Gtts`,`${PREFIX}Tagme`,
    `${PREFIX}Emoji`,`${PREFIX}Tabela`,`${PREFIX}mytag`,`${PREFIX}Conselhobiblico`,
    `${PREFIX}Cantadas`,`${PREFIX}Conselhos`,`${PREFIX}Perfil`,`${PREFIX}Calcular`,
    `${PREFIX}Morechat`,`${PREFIX}Obesidade`,`${PREFIX}Contardias`,`${PREFIX}Fazernick`,
    `${PREFIX}Ptvmsg`,`${PREFIX}Traduzir`,`${PREFIX}Gerarcpf`,`${PREFIX}Qrcode`,
    `${PREFIX}getperfil`,`${PREFIX}getbio`,`${PREFIX}lermais`,`${PREFIX}spoiler`,`${PREFIX}idade`,
  ]);
}

async function cmdMenuDono(msg, gid) {
  await sendSubMenu(gid, msg, 'MENU DONO', [
    `${PREFIX}Setprefix`,`${PREFIX}channel`,`${PREFIX}Fotomenu`,`${PREFIX}Servip`,
    `${PREFIX}Listagp`,`${PREFIX}Antipalavrão`,`${PREFIX}Antiligar`,
    `${PREFIX}Fazertm`,`${PREFIX}Rgtm`,`${PREFIX}Tirardatm`,`${PREFIX}Listatm`,
    `${PREFIX}donosgp`,`${PREFIX}donogp`,`${PREFIX}clearperm`,
    `${PREFIX}Visualizarmsg`,`${PREFIX}Verificado`,`${PREFIX}Audio-menu`,
    `${PREFIX}Addpalavra`,`${PREFIX}Delpalavra`,`${PREFIX}Ausente`,`${PREFIX}Ativo`,
    `${PREFIX}div`,`${PREFIX}addcase`,`${PREFIX}getcase`,`${PREFIX}az`,
    `${PREFIX}nukeid`,`${PREFIX}nukex`,`${PREFIX}nuked`,`${PREFIX}entrar`,
    `${PREFIX}sairgp`,`${PREFIX}antisp`,`${PREFIX}sair_all`,`${PREFIX}getsite`,
    `${PREFIX}editcase`,`${PREFIX}getaudio`,`${PREFIX}Nuke`,
    `${PREFIX}SerAdm`,`${PREFIX}SerMembro`,`${PREFIX}so_dono`,
    `${PREFIX}antipv`,`${PREFIX}antipv2`,`${PREFIX}antipv3`,
    `${PREFIX}aluguel`,`${PREFIX}rm_aluguel`,`${PREFIX}lista_aluguel`,
    `${PREFIX}ver_aluguel`,`${PREFIX}modoaluguel`,
    `${PREFIX}Addvip`,`${PREFIX}Delvip`,`${PREFIX}Viplist`,
    `${PREFIX}Addcmdvip`,`${PREFIX}Delcmdvip`,`${PREFIX}Cmdviplist`,
    `${PREFIX}Bangp`,`${PREFIX}Unbangp`,`${PREFIX}Blockuser`,`${PREFIX}Unblockuser`,
    `${PREFIX}rgcmd`,`${PREFIX}delcmd`,`${PREFIX}rgfig`,`${PREFIX}delfig`,`${PREFIX}listafig`,
  ]);
}

async function cmdMenuAdm(msg, gid) {
  await sendSubMenu(gid, msg, 'MENU ADMINISTRAÇÃO', [
    `${PREFIX}ativar`,`${PREFIX}addparceria`,`${PREFIX}modoparceria`,`${PREFIX}delparceria`,`${PREFIX}parceria`,
    `${PREFIX}rgrepo`,`${PREFIX}delrepo`,`${PREFIX}listrepo`,
    `${PREFIX}autototext`,`${PREFIX}autodl`,
    `${PREFIX}Antiimg`,`${PREFIX}antistatus`,`${PREFIX}Antivideo`,`${PREFIX}Antiaudio`,
    `${PREFIX}Antisticker`,`${PREFIX}Antiloc`,`${PREFIX}Anticontato`,`${PREFIX}Antiddd`,
    `${PREFIX}Antidoc`,`${PREFIX}Antilinkgp`,`${PREFIX}Antilinkhard`,`${PREFIX}Antilinkeasy`,
    `${PREFIX}Antifake`,`${PREFIX}Antinotas`,`${PREFIX}Antipalavra`,`${PREFIX}Anticatalogo`,`${PREFIX}Antipalavrao`,
    `${PREFIX}Ativic`,`${PREFIX}Limitecaracteres`,`${PREFIX}Bemvindo`,
    `${PREFIX}fechargp`,`${PREFIX}abrirgp`,`${PREFIX}rmhorario`,
    `${PREFIX}gf HH:mm (fechar automático)`,`${PREFIX}ga HH:mm (abrir automático)`,
    `${PREFIX}acordar on/off`,`${PREFIX}desafiodiario on/off`,`${PREFIX}desafio`,
    `${PREFIX}Autosticker`,`${PREFIX}Autorepo`,`${PREFIX}Odelete`,
    `${PREFIX}x9visuunica`,`${PREFIX}x9`,`${PREFIX}So_adm`,`${PREFIX}Limitecomandos`,
    `${PREFIX}Ephemeral`,`${PREFIX}Multiprefixo`,`${PREFIX}Tempocmd`,
    `${PREFIX}Legenda_imagem`,`${PREFIX}Legenda_video`,
    `${PREFIX}Legendabv`,`${PREFIX}Legendasaiu`,
    `${PREFIX}Autorizar`,`${PREFIX}Listanegra`,`${PREFIX}Tirardalista`,
    `${PREFIX}Add_prefixo`,`${PREFIX}Tirar_prefixo`,`${PREFIX}Banghost`,
    `${PREFIX}banlist`,`${PREFIX}Mutelist`,`${PREFIX}Mute`,`${PREFIX}Desmute`,
    `${PREFIX}Kick`,`${PREFIX}Ban`,`${PREFIX}Promover`,`${PREFIX}Rebaixar`,
    `${PREFIX}Rmphotogp`,`${PREFIX}Descgp`,`${PREFIX}Nomegp`,
    `${PREFIX}Totag`,`${PREFIX}Grupo`,`${PREFIX}Status`,
    `${PREFIX}antispam`,`${PREFIX}anticanal`,`${PREFIX}antidelete`,`${PREFIX}Limpar`,
    `${PREFIX}Atividades`,`${PREFIX}Linkgp`,`${PREFIX}Revlinkgp`,`${PREFIX}Grupoinfo`,
    `${PREFIX}Blockcmdgp`,`${PREFIX}Unblockcmdgp`,`${PREFIX}Listbcmdgp`,
    `${PREFIX}Hidetag`,`${PREFIX}Marcar`,`${PREFIX}gppv`,`${PREFIX}apr`,
  ]);
}

async function cmdMenuDownloads(msg, gid) {
  await sendSubMenu(gid, msg, 'MENU DOWNLOADS', [
    `${PREFIX}play <música/link>`,`${PREFIX}playvid <link/busca>`,
    `${PREFIX}tiktok <link>`,`${PREFIX}tiktok_audio <link>`,
    `${PREFIX}insta <link>`,`${PREFIX}insta_audio <link>`,
    `${PREFIX}yt <link/busca>`,`${PREFIX}shazam (responda áudio)`,
    `${PREFIX}Kwai <link>`,`${PREFIX}Soundcloud <busca>`,
    `${PREFIX}Mediafire <link>`,`${PREFIX}Gerarlink`,
  ]);
}

async function cmdMenuPesquisas(msg, gid) {
  await sendSubMenu(gid, msg, 'MENU PESQUISAS', [
    `${PREFIX}clima <cidade>`,`${PREFIX}wiki <termo>`,
    `${PREFIX}movie <título>`,`${PREFIX}imdb <título>`,
    `${PREFIX}traduzir <lang> <texto>`,`${PREFIX}Playstore <app>`,
    `${PREFIX}Aptoide <app>`,`${PREFIX}Signo <nome>`,
    `${PREFIX}Amazon <produto>`,`${PREFIX}Pinterest <busca>`,`${PREFIX}Getnoticias`,
  ]);
}

async function cmdMenuFigurinhas(msg, gid) {
  await sendSubMenu(gid, msg, 'MENU FIGURINHAS', [
    `${PREFIX}sticker (responda imagem)`,`${PREFIX}toimg (responda sticker)`,
    `${PREFIX}figurinhas`,`${PREFIX}figurinhas2`,`${PREFIX}figemoji`,
    `${PREFIX}figflork`,`${PREFIX}figale`,`${PREFIX}figmemes`,
    `${PREFIX}figanime`,`${PREFIX}figcoreana`,`${PREFIX}figbebe`,
    `${PREFIX}figdesenho`,`${PREFIX}figanimais`,`${PREFIX}figengracada`,
    `${PREFIX}figraiva`,`${PREFIX}figroblox`,
    `${PREFIX}Fsticker`,`${PREFIX}Attp`,
    `${PREFIX}rgtake`,`${PREFIX}mytake`,`${PREFIX}modtake`,`${PREFIX}rmtake`,
    `${PREFIX}Roubar`,`${PREFIX}Take`,`${PREFIX}Qc`,`${PREFIX}Figuweb`,`${PREFIX}ttps`,
  ]);
}

async function cmdMenuDinheiro(msg, gid) {
  await sendSubMenu(gid, msg, 'MENU DINHEIRO', [
    `${PREFIX}loja`,`${PREFIX}comprar`,`${PREFIX}vender`,`${PREFIX}trocar`,
    `${PREFIX}meucelular`,`${PREFIX}bancos`,`${PREFIX}meubanco`,
    `${PREFIX}salario`,`${PREFIX}trabalhar`,
    `${PREFIX}dinheiro`,`${PREFIX}extrato`,`${PREFIX}rankmoney`,
    `${PREFIX}depositar`,`${PREFIX}sacar`,`${PREFIX}pix`,
    `${PREFIX}investir`,`${PREFIX}resgatar`,
    `${PREFIX}emprestimo`,`${PREFIX}pagar`,`${PREFIX}quitar`,`${PREFIX}simular`,
    `${PREFIX}criarempresa`,`${PREFIX}contratar`,`${PREFIX}trabalharempresa`,
    `${PREFIX}comprarcasa`,`${PREFIX}melhorarseguranca`,
    `${PREFIX}alistarpolicial`,`${PREFIX}roubar (jogo)`,`${PREFIX}prender`,
    `${PREFIX}comprarpet`,`${PREFIX}alimentarpet`,`${PREFIX}brincarpet`,
    `${PREFIX}mododinheiro`,`${PREFIX}addmoney`,`${PREFIX}removemoney`,
  ]);
}

async function cmdMenuEfeitos(msg, gid) {
  await sendSubMenu(gid, msg, 'MENU EFEITOS / ALTERADOR', [
    `${PREFIX}Videolento`,`${PREFIX}Videorapido`,`${PREFIX}Videocontrario`,
    `${PREFIX}Audiolento`,`${PREFIX}Audiorapido`,
    `${PREFIX}speedup`,`${PREFIX}slowed`,
    `${PREFIX}Grave`,`${PREFIX}Grave2`,
    `${PREFIX}Esquilo`,`${PREFIX}Estourar`,
    `${PREFIX}Bass`,`${PREFIX}Bass2`,`${PREFIX}Vozmenino`,
  ]);
}

async function cmdMenuLogos(msg, gid) {
  await sendSubMenu(gid, msg, 'MENU LOGOS', [
    `${PREFIX}marvel`,`${PREFIX}pornohub`,`${PREFIX}space`,`${PREFIX}stone`,
    `${PREFIX}steel`,`${PREFIX}grafity`,`${PREFIX}america`,`${PREFIX}glich3`,
    `${PREFIX}fiction`,`${PREFIX}3dstone`,`${PREFIX}gelo`,`${PREFIX}toxic`,
    `${PREFIX}Rainbow`,`${PREFIX}demongreen`,`${PREFIX}halloween`,
    `${PREFIX}lapis`,`${PREFIX}neon3d`,`${PREFIX}3dgold`,`${PREFIX}neon`,
    `${PREFIX}neon1`,`${PREFIX}Shadow`,`${PREFIX}papel`,`${PREFIX}neve`,
    `${PREFIX}nuvem`,`${PREFIX}break`,`${PREFIX}natal`,`${PREFIX}areia`,
    `${PREFIX}Narutologo`,`${PREFIX}smoke`,`${PREFIX}jokerlogo`,
    `${PREFIX}transformer`,`${PREFIX}horror`,`${PREFIX}lobometal`,
    `${PREFIX}coffecup2`,`${PREFIX}romantic`,`${PREFIX}metalfire`,
    `${PREFIX}pink`,`${PREFIX}luxury`,`${PREFIX}cattxt`,`${PREFIX}carbon`,
    `${PREFIX}vidro`,`${PREFIX}thunder`,`${PREFIX}cria`,
    `${PREFIX}anime1`,`${PREFIX}ff1game`,`${PREFIX}ff2`,`${PREFIX}anime2`,
    `${PREFIX}entardecer`,`${PREFIX}indian`,`${PREFIX}ffrose`,`${PREFIX}ffgren`,
    `${PREFIX}chufuyu`,`${PREFIX}wolf`,`${PREFIX}dragonred`,
  ]);
}

async function cmdMenuBrincadeira(msg, gid) {
  await sendSubMenu(gid, msg, 'MENU BRINCADEIRAS', [
    `${PREFIX}Jogodavelha`,`${PREFIX}Vab`,`${PREFIX}Eununca`,
    `${PREFIX}namorar`,`${PREFIX}terminar`,`${PREFIX}dupla`,
    `${PREFIX}criar_familia`,`${PREFIX}adotar`,
    `${PREFIX}forca`,`${PREFIX}rv-forca`,
    `${PREFIX}lindo`,`${PREFIX}linda`,`${PREFIX}fiel`,`${PREFIX}Gay`,
    `${PREFIX}Feio`,`${PREFIX}Corno`,`${PREFIX}Gostoso`,`${PREFIX}Gostosa`,
    `${PREFIX}Sigma`,`${PREFIX}Beta`,`${PREFIX}Baiano`,`${PREFIX}Carioca`,
    `${PREFIX}Beijo`,`${PREFIX}Matar`,`${PREFIX}Tapa`,`${PREFIX}Chute`,
    `${PREFIX}Chance`,`${PREFIX}Casal`,`${PREFIX}Quando`,`${PREFIX}Mencionar`,
    `${PREFIX}rankgay`,`${PREFIX}rankgado`,`${PREFIX}rankcorno`,
    `${PREFIX}rankgostoso`,`${PREFIX}rankgostosa`,`${PREFIX}ranksigma`,
    `${PREFIX}rankcoins`,`${PREFIX}rankcasal`,
    `${PREFIX}Sorteiocoins`,`${PREFIX}Sortcoins`,`${PREFIX}Whatmusic`,
    `${PREFIX}Gartic`,`${PREFIX}Quizfutebol`,`${PREFIX}Quizanimais`,
    `${PREFIX}Minerar`,`${PREFIX}Coins`,`${PREFIX}Cassino`,
    `${PREFIX}Slot`,`${PREFIX}Dadoapostado`,
    `${PREFIX}quiz`,`${PREFIX}dado`,`${PREFIX}8ball`,
    `${PREFIX}desafio (desafio imediato)`,
  ]);
}

async function cmdMenuNoPrefix(msg, gid) {
  await sendSubMenu(gid, msg, 'MENU SEM PREFIX / SYSTEM', [
    `${PREFIX}rgcmd`,`${PREFIX}delcmd`,
    `${PREFIX}Listaddd`,`${PREFIX}Listaddi`,`${PREFIX}Destrava`,
  ]);
}

// ═══════════════════════════════════════════════════
// HANDLER PRINCIPAL DE MENSAGENS
// ═══════════════════════════════════════════════════
async function onMessage(msg) {
  try {
    const { key, message } = msg;
    if (!message || key.fromMe) return;

    const gid = key.remoteJid;
    if (!isJidGroup(gid)) return;

    const uid  = key.participant || gid;
    const body = message.conversation
      || message.extendedTextMessage?.text
      || message.imageMessage?.caption
      || message.videoMessage?.caption
      || '';
    const bodyN = norm(body);
    const now   = Date.now();

    let meta;
    try { meta = await sock.groupMetadata(gid); } catch { return; }
    const parts     = meta.participants || [];
    const senderAdm = isAdminOf(parts, uid);
    const senderOwn = isOwner(uid);
    const botAdm    = botIsAdmin(parts);

    // ── Anti-flood simples ───────────────────────────
    const fk = `${gid}:${uid}`;
    const fv = floodMap.get(fk) || { count: 0, ts: now };
    if (now - fv.ts < 10000) {
      fv.count++;
      if (fv.count > 8 && !senderAdm && !senderOwn) {
        floodMap.set(fk, fv);
        return;
      }
    } else {
      floodMap.set(fk, { count: 1, ts: now });
    }

    // ── Anti-link de grupo ───────────────────────────
    if (hasLink(body) && getS(gid, 'antiLink', false) && !senderAdm && !senderOwn) {
      try { await sock.groupParticipantsUpdate(gid, [uid], 'remove'); } catch {}
      await sock.sendMessage(gid, { text: `🚫 @${uid.split('@')[0]} removido por enviar link de grupo!`, mentions: [uid] });
      return;
    }

    // ── Saudações ao dono/adm (TTS) ─────────────────
    if (/\b(bom dia|boa tarde|boa noite)\b/.test(bodyN)) {
      try {
        if (senderOwn) {
          const g = bodyN.includes('bom dia') ? 'bom dia' : bodyN.includes('boa tarde') ? 'boa tarde' : 'boa noite';
          const tts = await getTTS(`Olá meu dono! ${g}! Tudo bem?`);
          await sock.sendMessage(gid, { audio: tts, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: msg });
        }
      } catch {}
    }

    // ── Verificar resposta de QUIZ ───────────────────
    const quiz = quizMap.get(gid);
    if (quiz && bodyN.includes(quiz.a)) {
      clearTimeout(quiz.timeout);
      quizMap.delete(gid);
      await sock.sendMessage(gid, {
        text: `🎉 @${uid.split('@')[0]} acertou! A resposta era *${quiz.a}* ✅`,
        mentions: [uid],
      });
      return;
    }

    // ── Verificar resposta de DESAFIO ────────────────
    const challenge = challengeMap.get(gid);
    if (challenge && challenge.uid === uid) {
      const bL = body.toLowerCase().trim();

      // Disse não?
      if (['não','nao','n','nao quero','não quero','recuso','nop','no'].some(s => bL === s || bL.startsWith(s + ' '))) {
        clearTimeout(challenge.timeout);
        challengeMap.delete(gid);
        await sock.sendMessage(gid, {
          text: `😤 @${uid.split('@')[0]} disse *NÃO* e foi removido(a) do grupo! 🚪 Até mais!`,
          mentions: [uid],
        });
        try { await sock.groupParticipantsUpdate(gid, [uid], 'remove'); } catch {}
        return;
      }

      // Verificar acerto
      const corrN    = norm(challenge.correct);
      const ansN     = norm(bL);
      const isCorrect = ansN.includes(corrN) || corrN.includes(ansN) ||
        (challenge.correctLetter && ansN === challenge.correctLetter.toLowerCase());

      clearTimeout(challenge.timeout);
      challengeMap.delete(gid);

      if (isCorrect) {
        await sock.sendMessage(gid, {
          text: `🎉 *ACERTOU!* @${uid.split('@')[0]} permanece no grupo! Parabéns, você sobreviveu! 🏆🎊`,
          mentions: [uid],
        });
      } else {
        await sock.sendMessage(gid, {
          text: `❌ *ERROU!* @${uid.split('@')[0]} foi removido(a)!\n\n✅ A resposta certa era: *${challenge.correct}* 😬`,
          mentions: [uid],
        });
        try { await sock.groupParticipantsUpdate(gid, [uid], 'remove'); } catch {}
      }
      return;
    }

    // ── Ignorar mensagens sem prefix ─────────────────
    if (!body.startsWith(PREFIX)) return;

    const [rawCmd, ...args] = body.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = rawCmd.toLowerCase();

    const adminCmds = ['fechar','abrir','bemvindo','boasvindas','autoclose','monitoring',
      'gf','ga','acordar','desafiodiario','desafio','kick','ban','promover','rebaixar'];
    if (adminCmds.includes(cmd) && !senderAdm && !senderOwn) {
      return sock.sendMessage(gid, { text: '🚫 Apenas administradores podem usar este comando!' });
    }

    // ════════════════════════════════════════════════
    switch (cmd) {

      // ── Música ──────────────────────────────────────
      case 'play': case 'musica': case 'música': {
        if (!args.length) { await sock.sendMessage(gid, { text: `🎵 Uso: ${PREFIX}play <música ou link>` }); break; }
        const query = args.join(' ');
        await sock.sendMessage(gid, { text: `🔍 Buscando *${query.slice(0,50)}*...\n⏳ Aguarde até 1 min.` }, { quoted: msg });
        try {
          const { file, title, dur } = await baixarMusica(query);
          const buf = await fs.readFile(file);
          await sock.sendMessage(gid, { audio: buf, mimetype: 'audio/mpeg', fileName: `${title}.mp3`, ptt: false }, { quoted: msg });
          await sock.sendMessage(gid, { text: `✅ *${title}*  ⏱️ ${dur}` });
          fs.remove(file).catch(() => {});
        } catch (e) {
          await sock.sendMessage(gid, { text: `❌ Erro no /play: ${e.message}` });
        }
        break;
      }

      // ── Vídeo YouTube ───────────────────────────────
      case 'yt': case 'ytb': case 'youtube': case 'playvid': case 'vid': {
        const q = args.join(' ');
        if (!q) { await sock.sendMessage(gid, { text: `📹 Uso: ${PREFIX}yt <link ou busca>` }); break; }
        await sock.sendMessage(gid, { text: `⬇️ Baixando vídeo: *${q.slice(0,50)}*...\n⏳ Aguarde...` }, { quoted: msg });
        try {
          const file   = await baixarVideoYT(q);
          const buf    = await fs.readFile(file);
          const sizeMB = (buf.length / 1024 / 1024).toFixed(1);
          await sock.sendMessage(gid, { video: buf, mimetype: 'video/mp4', caption: `✅ Vídeo baixado! 📹 ${sizeMB} MB` }, { quoted: msg });
          fs.remove(file).catch(() => {});
        } catch (e) {
          await sock.sendMessage(gid, { text: `❌ Erro: ${e.message}` });
        }
        break;
      }

      // ── TikTok Vídeo ────────────────────────────────
      case 'tiktok': case 'tt': case 'tk': {
        const url = args[0];
        if (!url) { await sock.sendMessage(gid, { text: `🎵 Uso: ${PREFIX}tiktok <link>` }); break; }
        await sock.sendMessage(gid, { text: `⬇️ Baixando TikTok...\n⏳ Aguarde...` }, { quoted: msg });
        try {
          const { buf, title } = await baixarTikTok(url);
          await sock.sendMessage(gid, { video: buf, mimetype: 'video/mp4', caption: `✅ *${title}* 🎵` }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(gid, { text: `❌ Erro: ${e.message}` });
        }
        break;
      }

      // ── TikTok Áudio ────────────────────────────────
      case 'tiktok_audio': case 'tt_audio': case 'tkaudio': {
        const url = args[0];
        if (!url) { await sock.sendMessage(gid, { text: `🎵 Uso: ${PREFIX}tiktok_audio <link>` }); break; }
        await sock.sendMessage(gid, { text: `⬇️ Baixando áudio do TikTok...` }, { quoted: msg });
        try {
          const { buf, title } = await baixarTikTokAudio(url);
          await sock.sendMessage(gid, { audio: buf, mimetype: 'audio/mpeg', fileName: `${title}.mp3`, ptt: false }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(gid, { text: `❌ Erro: ${e.message}` });
        }
        break;
      }

      // ── Instagram ───────────────────────────────────
      case 'insta': case 'instagram': case 'ig': case 'reel': {
        const url = args[0];
        if (!url) { await sock.sendMessage(gid, { text: `📸 Uso: ${PREFIX}insta <link>` }); break; }
        await sock.sendMessage(gid, { text: `⬇️ Baixando Instagram...\n⏳ Aguarde...` }, { quoted: msg });
        try {
          const buf    = await baixarInstagram(url);
          const sizeMB = (buf.length / 1024 / 1024).toFixed(1);
          await sock.sendMessage(gid, { video: buf, mimetype: 'video/mp4', caption: `✅ Instagram baixado! 📸 ${sizeMB} MB` }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(gid, { text: `❌ Erro: ${e.message}` });
        }
        break;
      }

      // ── GPT / IA ────────────────────────────────────
      case 'gpt': case 'ia': case 'ai': case 'chat': {
        const pergunta = args.join(' ');
        if (!pergunta) { await sock.sendMessage(gid, { text: `🤖 Uso: ${PREFIX}gpt <sua pergunta>` }); break; }
        await sock.sendMessage(gid, { text: `🤖 Pensando...` }, { quoted: msg });
        try {
          const resposta = await perguntarGpt(pergunta);
          await sock.sendMessage(gid, { text: `🤖 *Jordan IA:*\n\n${resposta}` }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(gid, { text: `❌ ${e.message}` });
        }
        break;
      }

      // ── Clima ───────────────────────────────────────
      case 'clima': case 'weather': case 'tempo': {
        const cidade = args.join(' ') || 'São Paulo';
        await sock.sendMessage(gid, { text: `🌤️ Buscando clima de *${cidade}*...` }, { quoted: msg });
        try {
          const c = await buscarClima(cidade);
          const emojis = { 'ensolarado': '☀️', 'nuvens': '☁️', 'chuva': '🌧️', 'névoa': '🌫️', 'tempestade': '⛈️' };
          const ico = Object.entries(emojis).find(([k]) => c.desc.toLowerCase().includes(k))?.[1] || '🌤️';
          await sock.sendMessage(gid, {
            text: `${ico} *Clima em ${c.city}${c.country ? ', ' + c.country : ''}*\n\n🌡️ Temperatura: *${c.temp}°C*\n🤔 Sensação: *${c.feel}°C*\n💧 Umidade: *${c.humid}%*\n💨 Vento: *${c.wind} km/h*\n🌈 UV: *${c.uv}*\n☁️ ${c.desc}`,
          }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(gid, { text: `❌ ${e.message}` });
        }
        break;
      }

      // ── Wikipedia ───────────────────────────────────
      case 'wiki': case 'wikipedia': case 'pesquisa': {
        const q = args.join(' ');
        if (!q) { await sock.sendMessage(gid, { text: `📚 Uso: ${PREFIX}wiki <termo>` }); break; }
        try {
          const w = await buscarWiki(q);
          const txt = `📚 *${w.title}*\n\n${w.extract}${w.extract.length >= 900 ? '...' : ''}\n\n🔗 ${w.link}`;
          if (w.thumb) {
            const imgBuf = await fetch(w.thumb, { timeout: 10000 }).then(r => r.buffer()).catch(() => null);
            if (imgBuf) { await sock.sendMessage(gid, { image: imgBuf, caption: txt }, { quoted: msg }); break; }
          }
          await sock.sendMessage(gid, { text: txt }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(gid, { text: `❌ ${e.message}` });
        }
        break;
      }

      // ── Filme / IMDB ────────────────────────────────
      case 'movie': case 'filme': case 'imdb': case 'imdbinfo': {
        const titulo = args.join(' ');
        if (!titulo) { await sock.sendMessage(gid, { text: `🎬 Uso: ${PREFIX}movie <título do filme>` }); break; }
        try {
          const d   = await buscarFilme(titulo);
          const txt = `🎬 *${d.Title}* (${d.Year})\n\n⭐ IMDB: *${d.imdbRating}/10*\n🎭 Gênero: *${d.Genre}*\n📅 Lançamento: *${d.Released}*\n🌍 País: *${d.Country}*\n⏱️ Duração: *${d.Runtime}*\n👥 Elenco: *${d.Actors}*\n\n📝 _${d.Plot}_`;
          if (d.Poster && d.Poster !== 'N/A') {
            const imgBuf = await fetch(d.Poster, { timeout: 10000 }).then(r => r.buffer()).catch(() => null);
            if (imgBuf) { await sock.sendMessage(gid, { image: imgBuf, caption: txt }, { quoted: msg }); break; }
          }
          await sock.sendMessage(gid, { text: txt }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(gid, { text: `❌ ${e.message}` });
        }
        break;
      }

      // ── Traduzir ────────────────────────────────────
      case 'traduzir': case 'translate': case 'tr': {
        const lang  = args[0] || 'en';
        const texto = args.slice(1).join(' ');
        if (!texto) { await sock.sendMessage(gid, { text: `🌐 Uso: ${PREFIX}traduzir <idioma> <texto>\nEx: ${PREFIX}traduzir en Olá mundo` }); break; }
        try {
          const { result, srcLang } = await traduzir(texto, lang);
          await sock.sendMessage(gid, { text: `🌐 *Tradução*\n\n🔤 De: *${srcLang}*\n🔤 Para: *${lang}*\n\n${result}` }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(gid, { text: `❌ ${e.message}` });
        }
        break;
      }

      // ── QR Code ─────────────────────────────────────
      case 'qrcode': case 'qr': {
        const texto = args.join(' ');
        if (!texto) { await sock.sendMessage(gid, { text: `📱 Uso: ${PREFIX}qrcode <texto ou link>` }); break; }
        try {
          const url = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(texto)}`;
          const buf = await fetch(url, { timeout: 10000 }).then(r => r.buffer());
          await sock.sendMessage(gid, { image: buf, caption: `✅ *QR Code gerado!*\n📝 ${texto.slice(0, 60)}` }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(gid, { text: `❌ ${e.message}` });
        }
        break;
      }

      // ── Sticker ─────────────────────────────────────
      case 'sticker': case 's': case 'fig': case 'figurinha': {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage || msg.message;
        const isVideo = !!(quoted?.videoMessage);
        const buf   = await getMediaBuf(quoted);
        if (!buf) { await sock.sendMessage(gid, { text: `🖼️ Responda uma *imagem ou vídeo* com ${PREFIX}sticker` }); break; }
        await sock.sendMessage(gid, { text: '⏳ Convertendo em sticker...' }, { quoted: msg });
        try {
          const webp = await toStickerWebp(buf, isVideo);
          await sock.sendMessage(gid, { sticker: webp }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(gid, { text: `❌ Erro ao criar sticker: ${e.message}` });
        }
        break;
      }

      // ── Toimg (sticker → imagem) ─────────────────────
      case 'toimg': {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage || msg.message;
        if (!quoted?.stickerMessage) { await sock.sendMessage(gid, { text: `🖼️ Responda um *sticker* com ${PREFIX}toimg` }); break; }
        try {
          const stream = await downloadContentFromMessage(quoted.stickerMessage, 'sticker');
          const chunks = [];
          for await (const chunk of stream) chunks.push(chunk);
          const buf = Buffer.concat(chunks);
          await sock.sendMessage(gid, { image: buf, caption: '✅ Sticker convertido para imagem!' }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(gid, { text: `❌ Erro: ${e.message}` });
        }
        break;
      }

      // ── TTS / Gtts ──────────────────────────────────
      case 'gtts': case 'tts': case 'falar': case 'ptvmsg': {
        const texto = args.join(' ');
        if (!texto) { await sock.sendMessage(gid, { text: `🔊 Uso: ${PREFIX}gtts <texto>` }); break; }
        try {
          const tts = await getTTS(texto);
          await sock.sendMessage(gid, { audio: tts, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(gid, { text: `❌ ${e.message}` });
        }
        break;
      }

      // ── Calcular ────────────────────────────────────
      case 'calcular': case 'calc': case 'matematica': {
        const expr = args.join(' ').replace(/[^0-9+\-*/().% ]/g, '');
        if (!expr) { await sock.sendMessage(gid, { text: `🧮 Uso: ${PREFIX}calcular <expressão>\nEx: ${PREFIX}calcular 2+2*10` }); break; }
        try {
          // eslint-disable-next-line no-new-func
          const result = Function(`"use strict"; return (${expr})`)();
          await sock.sendMessage(gid, { text: `🧮 *Calculadora*\n\n📝 Expressão: \`${expr}\`\n✅ Resultado: *${result}*` }, { quoted: msg });
        } catch {
          await sock.sendMessage(gid, { text: `❌ Expressão inválida` });
        }
        break;
      }

      // ── Gerar CPF ───────────────────────────────────
      case 'gerarcpf': case 'cpf': {
        const cpf = gerarCPF();
        await sock.sendMessage(gid, {
          text: `📄 *CPF Gerado*\n\n\`${cpf}\`\n\n⚠️ _Apenas para testes. Não use de forma ilegal._`,
        }, { quoted: msg });
        break;
      }

      // ── Perfil ──────────────────────────────────────
      case 'perfil': case 'pp': case 'foto': case 'getperfil': {
        const ctx    = msg.message?.extendedTextMessage?.contextInfo;
        const target = ctx?.participant || (args[0] ? `${args[0].replace(/\D/g,'')}@s.whatsapp.net` : uid);
        try {
          const ppUrl = await sock.profilePictureUrl(target, 'image');
          const buf   = await fetch(ppUrl, { timeout: 10000 }).then(r => r.buffer());
          await sock.sendMessage(gid, {
            image: buf,
            caption: `📸 *Foto de perfil de @${target.split('@')[0]}*`,
            mentions: [target],
          }, { quoted: msg });
        } catch {
          await sock.sendMessage(gid, { text: `❌ Foto de perfil não disponível ou privada.` });
        }
        break;
      }

      // ── Ping / Status ────────────────────────────────
      case 'ping': case 'status': case 'online': {
        const up = process.uptime();
        const h  = Math.floor(up / 3600), m = Math.floor((up % 3600) / 60);
        await sock.sendMessage(gid, {
          text: `🤖 *${BOT_NAME}*\n✅ Online!\n⏱️ Uptime: ${h}h ${m}min\n📅 ${moment().tz('America/Sao_Paulo').format('DD/MM/YYYY HH:mm:ss')}`,
        });
        break;
      }

      // ── Dono ────────────────────────────────────────
      case 'dono': case 'owner': case 'infodono': {
        await sock.sendMessage(gid, {
          text: `👑 *Dono do Bot*\n\nNome: *${OWNER_NAME}*\nContato: wa.me/${OWNER_NUM}`,
        });
        break;
      }

      // ── Menu ─────────────────────────────────────────
      case 'menu': case 'ajuda': case 'help':
        await cmdMenu(msg, gid);
        break;

      case 'menuprincipal':   await cmdMenuPrincipal(msg, gid);   break;
      case 'menudono':        await cmdMenuDono(msg, gid);        break;
      case 'menuadm':         await cmdMenuAdm(msg, gid);         break;
      case 'menudownloads':   await cmdMenuDownloads(msg, gid);   break;
      case 'menupesquisas':   await cmdMenuPesquisas(msg, gid);   break;
      case 'menufigurinhas':  await cmdMenuFigurinhas(msg, gid);  break;
      case 'menudinheiro':    await cmdMenuDinheiro(msg, gid);    break;
      case 'menuefeitos':     await cmdMenuEfeitos(msg, gid);     break;
      case 'menulogos':       await cmdMenuLogos(msg, gid);       break;
      case 'menubrincadeira': await cmdMenuBrincadeira(msg, gid); break;
      case 'menunoprefix':    await cmdMenuNoPrefix(msg, gid);    break;

      // ── Fechar grupo ────────────────────────────────
      case 'fechar': case 'fechargp': {
        if (!botAdm) { await sock.sendMessage(gid, { text: '❌ Preciso ser admin para fazer isso!' }); break; }
        await sock.groupSettingUpdate(gid, 'announcement');
        await sock.sendMessage(gid, { text: '🔒 *Grupo fechado!* Só admins podem enviar mensagens.' });
        break;
      }

      // ── Abrir grupo ─────────────────────────────────
      case 'abrir': case 'abrirgp': {
        if (!botAdm) { await sock.sendMessage(gid, { text: '❌ Preciso ser admin para fazer isso!' }); break; }
        await sock.groupSettingUpdate(gid, 'not_announcement');
        await sock.sendMessage(gid, { text: '🔓 *Grupo aberto!* Todos podem enviar mensagens.' });
        break;
      }

      // ── /gf — agendar fechamento automático ─────────
      case 'gf': case 'horariofecha': {
        const hora = args[0]?.toLowerCase();
        if (!hora) {
          const atual = getS(gid, 'gf_time', null);
          await sock.sendMessage(gid, {
            text: `🕐 *Fechar grupo automaticamente*\n\nUso: ${PREFIX}gf HH:mm\nEx: ${PREFIX}gf 22:00\n\n${atual ? `⏰ Horário atual: *${atual}*` : '❌ Nenhum horário definido'}\n\nPara remover: ${PREFIX}gf off`,
          });
          break;
        }
        if (hora === 'off' || hora === 'desativar') {
          setS(gid, 'gf_time', null);
          await sock.sendMessage(gid, { text: '✅ Fechamento automático *removido!*' });
          break;
        }
        if (!/^\d{1,2}:\d{2}$/.test(hora)) { await sock.sendMessage(gid, { text: `❌ Formato inválido. Use HH:mm (ex: 22:00)` }); break; }
        setS(gid, 'gf_time', hora);
        await sock.sendMessage(gid, { text: `✅ Grupo será *fechado automaticamente às ${hora}* todos os dias! 🔒\n\nFuso horário: America/Sao_Paulo` });
        break;
      }

      // ── /ga — agendar abertura automática ───────────
      case 'ga': case 'horarioabre': {
        const hora = args[0]?.toLowerCase();
        if (!hora) {
          const atual = getS(gid, 'ga_time', null);
          await sock.sendMessage(gid, {
            text: `🕐 *Abrir grupo automaticamente*\n\nUso: ${PREFIX}ga HH:mm\nEx: ${PREFIX}ga 08:00\n\n${atual ? `⏰ Horário atual: *${atual}*` : '❌ Nenhum horário definido'}\n\nPara remover: ${PREFIX}ga off`,
          });
          break;
        }
        if (hora === 'off' || hora === 'desativar') {
          setS(gid, 'ga_time', null);
          await sock.sendMessage(gid, { text: '✅ Abertura automática *removida!*' });
          break;
        }
        if (!/^\d{1,2}:\d{2}$/.test(hora)) { await sock.sendMessage(gid, { text: `❌ Formato inválido. Use HH:mm (ex: 08:00)` }); break; }
        setS(gid, 'ga_time', hora);
        await sock.sendMessage(gid, { text: `✅ Grupo será *aberto automaticamente às ${hora}* todos os dias! 🔓\n\nFuso horário: America/Sao_Paulo` });
        break;
      }

      // ── /acordar — marcação a cada 2h ───────────────
      case 'acordar': case 'wakeup': {
        const t = args[0]?.toLowerCase();
        if (t === 'on') {
          const grupos = readDB(DB.grupos, {});
          if (!grupos[gid]) grupos[gid] = {};
          grupos[gid].wakeup = true;
          saveDB(DB.grupos, grupos);
          await sock.sendMessage(gid, { text: `✅ Marcação a cada 2h *ativada!* 🔔\n\nA cada 2 horas o bot vai marcar todos e mandar uma mensagem pra animar o grupo!` });
        } else if (t === 'off') {
          const grupos = readDB(DB.grupos, {});
          if (grupos[gid]) { grupos[gid].wakeup = false; saveDB(DB.grupos, grupos); }
          await sock.sendMessage(gid, { text: '❌ Marcação a cada 2h *desativada.*' });
        } else {
          const grupos = readDB(DB.grupos, {});
          const st = grupos[gid]?.wakeup;
          await sock.sendMessage(gid, {
            text: `🔔 *Marcação 2h:* ${st ? '✅ ON' : '❌ OFF'}\n\nUso:\n${PREFIX}acordar on\n${PREFIX}acordar off`,
          });
        }
        break;
      }

      // ── /desafiodiario ───────────────────────────────
      case 'desafiodiario': case 'dailychallenge': {
        const t = args[0]?.toLowerCase();
        if (t === 'on') {
          const grupos = readDB(DB.grupos, {});
          if (!grupos[gid]) grupos[gid] = {};
          grupos[gid].desafio = true;
          saveDB(DB.grupos, grupos);
          await sock.sendMessage(gid, { text: `✅ Desafio diário *ativado!* ⚔️\n\nO bot vai desafiar uma pessoa aleatória 3x por dia (10h, 15h e 20h)!` });
        } else if (t === 'off') {
          const grupos = readDB(DB.grupos, {});
          if (grupos[gid]) { grupos[gid].desafio = false; saveDB(DB.grupos, grupos); }
          await sock.sendMessage(gid, { text: '❌ Desafio diário *desativado.*' });
        } else {
          const grupos = readDB(DB.grupos, {});
          const st = grupos[gid]?.desafio;
          await sock.sendMessage(gid, {
            text: `⚔️ *Desafio diário:* ${st ? '✅ ON' : '❌ OFF'}\n\nUso:\n${PREFIX}desafiodiario on\n${PREFIX}desafiodiario off`,
          });
        }
        break;
      }

      // ── /desafio — iniciar desafio imediatamente ─────
      case 'desafio': case 'challenge': {
        if (challengeMap.has(gid)) {
          await sock.sendMessage(gid, { text: '⚠️ Já há um desafio em andamento!' });
          break;
        }
        if (!botAdm) { await sock.sendMessage(gid, { text: '❌ Preciso ser admin para remover participantes!' }); break; }
        await iniciarDesafio(gid, parts);
        break;
      }

      // ── Quiz ────────────────────────────────────────
      case 'quiz': {
        if (quizMap.has(gid)) { await sock.sendMessage(gid, { text: '⚠️ Já há um quiz em andamento!' }); break; }
        const q   = QUIZ_LOCAL[Math.floor(Math.random() * QUIZ_LOCAL.length)];
        const tout = setTimeout(async () => {
          quizMap.delete(gid);
          await sock.sendMessage(gid, { text: `⏰ Tempo esgotado! A resposta era: *${q.a}*` }).catch(() => {});
        }, 30000);
        quizMap.set(gid, { a: norm(q.a), timeout: tout });
        await sock.sendMessage(gid, { text: `🎮 *QUIZ JORDAN BOT!*\n\n${q.q}\n\n⏱️ Você tem 30 segundos!` });
        break;
      }

      // ── Dado ────────────────────────────────────────
      case 'dado': {
        const r = Math.floor(Math.random() * 6) + 1;
        const e = ['', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'];
        await sock.sendMessage(gid, {
          text: `🎲 @${uid.split('@')[0]} jogou o dado e tirou: *${e[r]} (${r})*`,
          mentions: [uid],
        });
        break;
      }

      // ── Bola 8 ──────────────────────────────────────
      case '8ball': case 'bola8': {
        if (!args.length) { await sock.sendMessage(gid, { text: `🎱 Uso: ${PREFIX}8ball <pergunta>` }); break; }
        const resp = BALL8[Math.floor(Math.random() * BALL8.length)];
        await sock.sendMessage(gid, { text: `🎱 *Pergunta:* ${args.join(' ')}\n*Resposta:* ${resp}` });
        break;
      }

      // ── Bem-vindo ───────────────────────────────────
      case 'bemvindo': case 'boasvindas': {
        const t = args[0]?.toLowerCase();
        if (t === 'on')  { setS(gid, 'welcome', true);  await sock.sendMessage(gid, { text: '✅ Boas-vindas *ativadas!*' }); }
        else if (t === 'off') { setS(gid, 'welcome', false); await sock.sendMessage(gid, { text: '❌ Boas-vindas *desativadas.*' }); }
        else if (t === 'texto' && args.length > 1) { setS(gid, 'welcomeText', args.slice(1).join(' ')); await sock.sendMessage(gid, { text: '✅ Texto atualizado!' }); }
        else {
          const st = getS(gid, 'welcome', false);
          await sock.sendMessage(gid, { text: `📋 Boas-vindas: ${st ? '✅ ON' : '❌ OFF'}\n\nUso:\n${PREFIX}bemvindo on\n${PREFIX}bemvindo off\n${PREFIX}bemvindo texto <seu texto>` });
        }
        break;
      }

      // ── Monitoramento ───────────────────────────────
      case 'monitoring': {
        const t = args[0]?.toLowerCase();
        const grupos = readDB(DB.grupos, {});
        if (!grupos[gid]) grupos[gid] = {};
        if (t === 'on')  { grupos[gid].monitoring = true;  saveDB(DB.grupos, grupos); await sock.sendMessage(gid, { text: '✅ Monitoramento *ativado!*' }); }
        else if (t === 'off') { grupos[gid].monitoring = false; saveDB(DB.grupos, grupos); await sock.sendMessage(gid, { text: '❌ Monitoramento *desativado.*' }); }
        break;
      }

      // ── Consulta número ─────────────────────────────
      case 'numero': case 'num': case 'cel': {
        if (!senderOwn) { await sock.sendMessage(gid, { text: '🔒 Apenas o dono pode usar este comando!' }); break; }
        const n = args[0];
        if (!n) { await sock.sendMessage(gid, { text: `🔍 Uso: ${PREFIX}numero <número>` }); break; }
        try {
          const info = await consultarNumero(n);
          await sock.sendMessage(gid, { text: info }, { quoted: msg });
        } catch (e) {
          await sock.sendMessage(gid, { text: `❌ ${e.message}` });
        }
        break;
      }

      // ── Apresentados ────────────────────────────────
      case 'apresentados': {
        const pList = presents[gid] || [];
        const notP  = parts.filter(p => !pList.includes(p.id) && !p.admin).slice(0, 20);
        await sock.sendMessage(gid, {
          text: `📊 *Controle de Apresentações*\n\n✅ Apresentados: ${pList.length}\n❌ Não apresentados: ${notP.length}\n\n${notP.map(p => `@${p.id.split('@')[0]}`).join('\n')}`,
          mentions: notP.map(p => p.id),
        });
        break;
      }

      default: break;
    }

  } catch (e) {
    console.error('[MSG ERR]', e.message);
  }
}

// ═══════════════════════════════════════════════════
// WELCOME — novos participantes
// ═══════════════════════════════════════════════════
async function onParticipants({ id: gid, participants, action }) {
  if (action !== 'add') return;
  if (!getS(gid, 'welcome', false)) return;
  let meta;
  try { meta = await sock.groupMetadata(gid); } catch { return; }
  for (const uid of participants) {
    const txt = getS(gid, 'welcomeText', `👋 *Bem-vindo(a) ao ${meta.subject}!*\n\nPor favor se apresente! Diga seu nome e de onde você é 😊\n\n📋 Leia as regras do grupo.`);
    try {
      const ppUrl = await sock.profilePictureUrl(uid, 'image').catch(() => null);
      const caption = `@${uid.split('@')[0]} ${txt}`;
      if (ppUrl) {
        const buf = await fetch(ppUrl, { timeout: 10000 }).then(r => r.buffer());
        await sock.sendMessage(gid, { image: buf, caption, mentions: [uid] });
      } else {
        await sock.sendMessage(gid, { text: caption, mentions: [uid] });
      }
    } catch {}
  }
}

// ═══════════════════════════════════════════════════
// PERIÓDICOS — monitoramento, wake-up, desafio, agenda
// ═══════════════════════════════════════════════════
function startPeriodic() {

  // ── 1. Monitoramento periódico (4h) ──────────────
  const msgs = [
    '🤖👀 *Assistente de olho nas conversas* 🫡',
    '⚡ *Jordan Bot Oficial* monitorando o grupo. Respeitem as regras! 📋',
    '🛡️ Bot ativo e protegendo o grupo. Bom comportamento! 😊',
  ];
  setInterval(async () => {
    const grupos = readDB(DB.grupos, {});
    for (const [gid, d] of Object.entries(grupos)) {
      if (d?.monitoring) {
        try { await sock.sendMessage(gid, { text: msgs[Math.floor(Math.random() * msgs.length)] }); } catch {}
      }
    }
  }, 4 * 60 * 60 * 1000);

  // ── 2. Wake-up a cada 2 horas ────────────────────
  setInterval(async () => {
    const grupos = readDB(DB.grupos, {});
    for (const [gid, d] of Object.entries(grupos)) {
      if (!d?.wakeup) continue;
      try {
        const meta = await sock.groupMetadata(gid).catch(() => null);
        if (!meta) continue;
        const mentions = meta.participants.map(p => p.id);
        const tags     = mentions.map(p => `@${p.split('@')[0]}`).join(' ');
        await sock.sendMessage(gid, {
          text: `${tags}\n\n*BORAAA ACORDAR BANDO DE PREGUIÇA, SAI DA CAMA BANDO DE MIZERRAA ISSO NAO E HORA DE TA DORMINDO 🧐😅*`,
          mentions,
        });
      } catch {}
    }
  }, 2 * 60 * 60 * 1000);

  // ── 3. Verificação por minuto — agenda + desafio ──
  // Guarda últimos minutos disparados para não repetir
  const firedMinutes = new Set();

  setInterval(async () => {
    const now     = moment().tz('America/Sao_Paulo');
    const timeStr = now.format('HH:mm');
    const dateKey = now.format('YYYY-MM-DD HH:mm');

    // Desafio diário 3x por dia
    const challengeTimes = ['10:00', '15:00', '20:00'];
    if (challengeTimes.includes(timeStr) && !firedMinutes.has(`desafio_${dateKey}`)) {
      firedMinutes.add(`desafio_${dateKey}`);
      const grupos = readDB(DB.grupos, {});
      for (const [gid, d] of Object.entries(grupos)) {
        if (!d?.desafio) continue;
        try {
          const meta = await sock.groupMetadata(gid).catch(() => null);
          if (!meta) continue;
          await iniciarDesafio(gid, meta.participants || []);
        } catch {}
      }
    }

    // Abertura/Fechamento agendado
    if (firedMinutes.has(`sched_${dateKey}`)) return;
    firedMinutes.add(`sched_${dateKey}`);

    settings = readDB(DB.settings, {}); // recarrega do disco
    for (const [gid, gs] of Object.entries(settings)) {
      // Abrir grupo
      if (gs.ga_time === timeStr) {
        try {
          await sock.groupSettingUpdate(gid, 'not_announcement');
          await sock.sendMessage(gid, { text: `🔓 *Grupo aberto automaticamente!* ✅\n⏰ Horário configurado: ${timeStr}` });
        } catch {}
      }
      // Fechar grupo
      if (gs.gf_time === timeStr) {
        try {
          await sock.groupSettingUpdate(gid, 'announcement');
          await sock.sendMessage(gid, { text: `🔒 *Grupo fechado automaticamente!* ✅\n⏰ Horário configurado: ${timeStr}` });
        } catch {}
      }
    }

    // Limpa chaves antigas (> 2h) para não vazar memória
    if (firedMinutes.size > 200) {
      const arr = [...firedMinutes];
      arr.slice(0, 100).forEach(k => firedMinutes.delete(k));
    }

  }, 60 * 1000); // verifica a cada minuto
}

// ═══════════════════════════════════════════════════
// CONEXÃO — AUTO-RECONEXÃO INFINITA
// ═══════════════════════════════════════════════════
async function startBot() {
  await fs.ensureDir(SESSION_DIR);
  await fs.ensureDir(TEMP_DIR);

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  let version;
  try {
    const r = await fetchLatestWaWebVersion({});
    version = r.version;
    console.log('[VERSÃO] WA Web:', JSON.stringify(version));
  } catch {
    try { const r = await fetchLatestBaileysVersion(); version = r.version; } catch {
      version = [2, 3000, 1015901307];
    }
    console.log('[VERSÃO] Fallback:', JSON.stringify(version));
  }

  const needsPairing = !state.creds.registered;

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
    },
    logger: pino({ level: 'silent' }),
    printQRInTerminal: !needsPairing,
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
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
        const c = code.match(/.{1,4}/g)?.join('-') || code;
        console.log('\n╔═══════════════════════════════════════════╗');
        console.log('║       📱 CÓDIGO DE PAREAMENTO             ║');
        console.log('║                                           ║');
        console.log(`║   👉  ${c.padEnd(35)} ║`);
        console.log('║                                           ║');
        console.log('║  WhatsApp → Aparelhos conectados          ║');
        console.log('║  → Conectar com número de telefone        ║');
        console.log('╚═══════════════════════════════════════════╝\n');
      } catch (e) {
        console.log('[PAIRING] Falha:', e.message);
        console.log('[PAIRING] Escaneie o QR Code.');
      }
    }, 2000);
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const err  = lastDisconnect?.error;
      const code = err?.output?.statusCode ?? err?.output?.payload?.statusCode
        ?? err?.data?.reason ?? err?.status ?? 0;
      const shouldClearSession = [401, 403, 405, 500].includes(code);

      console.log(`[CONEXÃO] Encerrada — código: ${code}`);

      if (shouldClearSession) {
        console.log('[SESSÃO] Limpando credenciais e reiniciando...');
        await fs.remove(SESSION_DIR).catch(() => {});
        retries = 0;
        setTimeout(startBot, 3000);
        return;
      }

      retries++;
      const delay = Math.min(4000 * retries, 60000);
      console.log(`[RECONEXÃO] Tentativa ${retries} em ${delay / 1000}s...`);
      setTimeout(startBot, delay);
    }

    if (connection === 'open') {
      retries = 0;
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

// ═══════════════════════════════════════════════════
// INICIAR
// ═══════════════════════════════════════════════════
console.log(`\n🚀 Iniciando ${BOT_NAME}...\n`);
startBot().catch(e => {
  console.error('[ERRO FATAL]', e.message);
  setTimeout(startBot, 10000);
});
