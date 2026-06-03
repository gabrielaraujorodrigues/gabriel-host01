'use strict';

// ═══════════════════════════════════════════════════
//  JORDAN BOT OFICIAL — Bot WhatsApp Profissional
//  Dono: gabriel mods
// ═══════════════════════════════════════════════════

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  isJidGroup,
} = require('baileys');

const pino = require('pino');
const path = require('path');
const fs = require('fs-extra');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fetch = require('node-fetch');
const ytSearch = require('yt-search');
const moment = require('moment-timezone');

// ═══════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════
const __root = __dirname;
const BOT_NAME = 'Jordan Bot Oficial';
const CONFIG_PATH = path.join(__root, 'BANCO-DE-DADOS/P-INFORMACOES/media/Config-Kiimori.json');

let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}

const PREFIX      = config.prefix      || '/';
const OWNER_NUM   = (config.ownerNumber || config.Proprietário || '558694029686').replace(/\D/g,'');
const OWNER_NAME  = config.ownerName   || 'gabriel mods';
const SESSION_DIR = path.join(__root, 'session_data');
const TEMP_DIR    = path.join(__root, 'temp_media');
const YTDLP       = '/home/runner/workspace/.pythonlibs/bin/yt-dlp';

// ═══════════════════════════════════════════════════
// DATABASE (JSON simples)
// ═══════════════════════════════════════════════════
const DB = {
  settings: path.join(__root, 'BANCO-DE-DADOS/group_settings.json'),
  presents: path.join(__root, 'BANCO-DE-DADOS/presentations.json'),
  grupos:   path.join(__root, 'BANCO-DE-DADOS/grupos/grupos.json'),
};

const readDB = (f, d={}) => {
  try {
    if (!fs.existsSync(f)) { fs.ensureDirSync(path.dirname(f)); fs.writeJSONSync(f,d); return d; }
    return fs.readJSONSync(f);
  } catch { return d; }
};
const saveDB = (f,d) => { try { fs.ensureDirSync(path.dirname(f)); fs.writeJSONSync(f,d,{spaces:2}); } catch {} };

let settings   = readDB(DB.settings, {});
let presents   = readDB(DB.presents, {});

const getS = (g,k,def) => settings[g]?.[k] !== undefined ? settings[g][k] : def;
const setS = (g,k,v)   => { if(!settings[g]) settings[g]={}; settings[g][k]=v; saveDB(DB.settings,settings); };

// ═══════════════════════════════════════════════════
// ESTADO EM MEMÓRIA
// ═══════════════════════════════════════════════════
const floodMap   = new Map();
const stickerMap = new Map();
const quizMap    = new Map();
let sock;
let retries = 0;

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════
const isOwner = jid => {
  const n = jid.replace('@s.whatsapp.net','').replace(/\D/g,'');
  return n === OWNER_NUM || n === OWNER_NUM.slice(2);
};

const isAdminOf = (parts, jid) => {
  const p = parts.find(x => x.id === jid || x.id.split(':')[0]+'@s.whatsapp.net' === jid);
  return p?.admin === 'admin' || p?.admin === 'superadmin';
};

const botIsAdmin = parts => {
  if (!sock?.user?.id) return false;
  const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
  return isAdminOf(parts, botJid);
};

const norm = t => (t||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');

// ═══════════════════════════════════════════════════
// TTS (Google Translate)
// ═══════════════════════════════════════════════════
async function getTTS(text) {
  const enc = encodeURIComponent(text.slice(0,200));
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${enc}&tl=pt-BR&client=tw-ob`;
  const r = await fetch(url, {
    headers: {'User-Agent':'Mozilla/5.0 (X11; Linux x86_64)'},
    timeout: 12000,
  });
  if (!r.ok) throw new Error('TTS falhou');
  return r.buffer();
}

// ═══════════════════════════════════════════════════
// MÚSICA — yt-dlp
// ═══════════════════════════════════════════════════
async function baixarMusica(query) {
  await fs.ensureDir(TEMP_DIR);
  const res = await ytSearch(query);
  const vid = res?.videos?.[0];
  if (!vid) throw new Error('Música não encontrada');
  if (vid.seconds > 600) throw new Error('Música muito longa (máx 10 min)');

  const base = path.join(TEMP_DIR, `music_${Date.now()}`);
  await execAsync(
    `${YTDLP} -x --audio-format mp3 --audio-quality 5 -o "${base}.%(ext)s" "${vid.url}" --no-playlist -q`,
    { timeout: 120000 }
  );

  const latest = fs.readdirSync(TEMP_DIR)
    .filter(f => f.startsWith('music_'))
    .map(f => ({ f, t: fs.statSync(path.join(TEMP_DIR,f)).mtimeMs }))
    .sort((a,b) => b.t - a.t)[0];

  if (!latest) throw new Error('Download falhou');
  return { file: path.join(TEMP_DIR, latest.f), title: vid.title, dur: vid.timestamp };
}

// ═══════════════════════════════════════════════════
// VÍDEO — yt-dlp universal (YT, TikTok, Instagram…)
// ═══════════════════════════════════════════════════
async function baixarVideo(input) {
  await fs.ensureDir(TEMP_DIR);

  // Se não for URL, busca no YouTube
  const isUrl = /^https?:\/\//i.test(input);
  const target = isUrl ? input : `ytsearch1:${input}`;

  const tag  = `vid_${Date.now()}`;
  const base = path.join(TEMP_DIR, tag);

  await execAsync(
    `${YTDLP} -f "best[ext=mp4][filesize<48M]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" ` +
    `--max-filesize 48M --merge-output-format mp4 ` +
    `-o "${base}.%(ext)s" "${target}" --no-playlist -q`,
    { timeout: 180000 }
  );

  const latest = fs.readdirSync(TEMP_DIR)
    .filter(f => f.startsWith(tag))
    .map(f => ({ f, t: fs.statSync(path.join(TEMP_DIR,f)).mtimeMs }))
    .sort((a,b) => b.t - a.t)[0];

  if (!latest) throw new Error('Download do vídeo falhou');
  return path.join(TEMP_DIR, latest.f);
}

// ═══════════════════════════════════════════════════
// CONSULTA DE NÚMERO (só dono)
// ═══════════════════════════════════════════════════
async function consultarNumero(rawNum) {
  const num = rawNum.replace(/\D/g,'');
  if (num.length < 8) throw new Error('Número inválido');

  const ddd = num.length >= 11 ? num.slice(-11,-9) : num.slice(0,2);

  let estado = '', cidade = '';
  try {
    const r = await fetch(`https://brasilapi.com.br/api/ddd/v1/${ddd}`, {timeout: 8000});
    if (r.ok) {
      const d = await r.json();
      estado = d.state  || '';
      cidade = (d.cities || []).slice(0,3).join(', ');
    }
  } catch {}

  const operadoras = {
    '11':'Vivo','12':'Claro','13':'TIM','15':'Vivo','17':'TIM','18':'Claro','21':'Claro',
    '25':'Oi','27':'Vivo','31':'TIM','41':'Vivo','51':'Claro','61':'Vivo','71':'Claro',
    '81':'TIM','85':'Vivo','86':'TIM','91':'Claro','92':'Vivo','95':'Oi','96':'Vivo',
  };
  const op = operadoras[ddd] || 'Desconhecida';

  return `📱 *Consulta de Número*\n\n` +
         `Número: *+55 ${num}*\n` +
         `DDD: *${ddd}*\n` +
         `Estado: *${estado || 'N/A'}*\n` +
         `Cidades: *${cidade || 'N/A'}*\n` +
         `Operadora provável: *${op}*\n\n` +
         `_Resultado aproximado baseado em DDD_`;
}

// ═══════════════════════════════════════════════════
// DETECÇÃO
// ═══════════════════════════════════════════════════
const FIGHT = ['vou te matar','te mato','vou te bater','vai tomar no','ameaça','desgraçado',
  'filho da puta','vai se fuder','babaca','vou te achar','tá querendo','vem aqui',
  'querendo briga','querendo guerra','te acerto','vai me pagar','te pego','te odeio',
  'infeliz','miserável','sua vadia','vai pagar','te processo','vou denunciar',
  'deixa eu te pegar','você vai ver'];

const hasLink  = t => /chat\.whatsapp\.com\/[A-Za-z0-9_-]+/.test(t||'');
const hasFight = t => FIGHT.some(w => norm(t).includes(w));
const isNSFW   = m => {
  const s = m?.stickerMessage; if (!s) return false;
  const tags = [s.stickerName,s.stickerAuthor,...(s.categories||[])].join(' ').toLowerCase();
  return ['+18','18+','nsfw','adult','nude','hentai','porno','sexy','explicit'].some(t=>tags.includes(t));
};

// ═══════════════════════════════════════════════════
// QUIZ
// ═══════════════════════════════════════════════════
const QUIZ = [
  {q:'🐘 Qual é o maior animal terrestre?', a:'elefante'},
  {q:'🦁 O rei dos animais é?', a:'leao'},
  {q:'🐬 Mamífero marinho super inteligente?', a:'golfinho'},
  {q:'🦒 Animal com o pescoço mais longo?', a:'girafa'},
  {q:'🦅 Ave símbolo dos EUA?', a:'aguia'},
  {q:'🐧 Ave que nada mas não voa?', a:'pinguim'},
  {q:'🌍 Maior país do mundo em área?', a:'russia'},
  {q:'🏔️ Montanha mais alta do mundo?', a:'everest'},
  {q:'⚡ Pokémon elétrico mais famoso?', a:'pikachu'},
  {q:'🍕 De qual país é a pizza?', a:'italia'},
  {q:'🎵 Quem é o rei do pop?', a:'michael jackson'},
  {q:'🐍 Maior cobra do mundo?', a:'anaconda'},
  {q:'🌊 Maior oceano do mundo?', a:'pacifico'},
  {q:'🦷 Quantos dentes tem um adulto?', a:'32'},
  {q:'🏠 Quem mora na Casa Branca?', a:'presidente'},
];

const BALL8 = [
  '✅ Com certeza!','✅ Definitivamente sim!','✅ Pode contar!',
  '🤔 Talvez...','🤔 Não tenho certeza.','🤔 As perspectivas são incertas.',
  '❌ Não conte com isso.','❌ Definitivamente não.','❌ Muito improvável.',
];

// ═══════════════════════════════════════════════════
// COMANDOS
// ═══════════════════════════════════════════════════

async function cmdPlay(msg, gid, args) {
  if (!args.length) return sock.sendMessage(gid, {text:`🎵 Uso: ${PREFIX}play <música>`});
  await sock.sendMessage(gid, {text:`🔍 Buscando *${args.join(' ')}*...`}, {quoted:msg});
  try {
    const {file, title, dur} = await baixarMusica(args.join(' '));
    const buf = fs.readFileSync(file);
    await sock.sendMessage(gid, {
      audio: buf, mimetype:'audio/mpeg', fileName:`${title}.mp3`, ptt:false,
    }, {quoted:msg});
    await sock.sendMessage(gid, {text:`✅ *${title}*  ⏱️ ${dur}`});
    fs.remove(file).catch(()=>{});
  } catch(e) {
    await sock.sendMessage(gid, {text:`❌ ${e.message}`});
  }
}

async function cmdMenu(msg, gid, meta) {
  const txt =
`╔══════════════════════════════════╗
║    🤖 *JORDAN BOT OFICIAL* 🤖    ║
╠══════════════════════════════════╣
║                                  ║
║  🎵 *MÚSICA & VÍDEOS*            ║
║  ${PREFIX}play <música>  — baixar MP3   ║
║  ${PREFIX}yt <link/busca> — vídeo YT   ║
║  ${PREFIX}tiktok <link> — vídeo TikTok ║
║  ${PREFIX}insta <link>  — vídeo Insta  ║
║                                  ║
║  🎮 *GAMES*                      ║
║  ${PREFIX}quiz   — Quiz surpresa        ║
║  ${PREFIX}dado   — Jogar dado           ║
║  ${PREFIX}8ball  — Bola mágica          ║
║                                  ║
║  🛡️ *PROTEÇÃO DE GRUPO*          ║
║  ${PREFIX}fechar / ${PREFIX}abrir             ║
║  ${PREFIX}bemvindo on/off                ║
║  ${PREFIX}autoclose on/off               ║
║  ${PREFIX}apresentados                   ║
║  ${PREFIX}monitoring on/off              ║
║                                  ║
║  ℹ️ *INFO*                        ║
║  ${PREFIX}ping   — Status do bot         ║
║  ${PREFIX}dono   — Info do dono          ║
║  ${PREFIX}numero — Consultar número 🔒   ║
║                                  ║
╚══════════════════════════════════╝
🤖 *${BOT_NAME}*
👑 Dono: *${OWNER_NAME}*`;

  // GIF de anime
  try {
    const gifBuf = await fetch(
      'https://media1.tenor.com/m/mMBbFTasFpUAAAAd/anime-girl.gif',
      {timeout:15000}
    ).then(r=>r.buffer());
    await sock.sendMessage(gid,
      {video: gifBuf, caption: txt, gifPlayback: true, mimetype:'video/mp4'},
      {quoted:msg}
    );
  } catch {
    await sock.sendMessage(gid, {text: txt}, {quoted:msg});
  }

  // Áudio de menu
  try {
    const tts = await getTTS(`Aqui está o seu menu, aproveite! Sou o ${BOT_NAME}, seu assistente inteligente disponível 24 horas.`);
    await sock.sendMessage(gid, {audio: tts, mimetype:'audio/ogg; codecs=opus', ptt:true});
  } catch {}
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

    // Metadados do grupo
    let meta;
    try { meta = await sock.groupMetadata(gid); } catch { return; }
    const parts      = meta.participants || [];
    const senderAdm  = isAdminOf(parts, uid);
    const senderOwn  = isOwner(uid);
    const botAdm     = botIsAdmin(parts);

    // ─────────────── PROTEÇÕES ───────────────

    // Anti-link de grupo
    if (hasLink(body) && !senderAdm && !senderOwn && botAdm) {
      try {
        await sock.sendMessage(gid, {delete: key});
        await sock.sendMessage(gid, {
          text: `🚫 @${uid.replace('@s.whatsapp.net','')} *Link de grupo proibido!* Mensagem removida. ⚠️`,
          mentions: [uid],
        });
      } catch {}
      return;
    }

    // Anti-flood
    {
      const fk = `${gid}:${uid}`;
      const fd = floodMap.get(fk) || {c:0, ts:now};
      if (now - fd.ts > 10000) { fd.c=1; fd.ts=now; } else fd.c++;
      floodMap.set(fk, fd);

      if (fd.c > 8 && !senderAdm && !senderOwn && botAdm) {
        try { await sock.sendMessage(gid, {delete:key}); } catch {}
        if (fd.c === 9) {
          await sock.sendMessage(gid, {
            text:`⚠️ @${uid.replace('@s.whatsapp.net','')} Para com o flood! Próxima remoção.`,
            mentions:[uid],
          });
        }
        if (fd.c > 14) {
          try {
            await sock.groupParticipantsUpdate(gid,[uid],'remove');
            await sock.sendMessage(gid, {
              text:`🚫 @${uid.replace('@s.whatsapp.net','')} removido por flood excessivo.`,
              mentions:[uid],
            });
          } catch {}
          floodMap.delete(fk);
        }
        return;
      }
    }

    // Anti-spam de figurinhas + figurinha +18
    if (message.stickerMessage) {
      if (isNSFW(message) && !senderAdm && !senderOwn && botAdm) {
        try {
          await sock.sendMessage(gid, {delete:key});
          await sock.sendMessage(gid, {
            text:`🔞 Figurinha +18 detectada e removida! @${uid.replace('@s.whatsapp.net','')}`,
            mentions:[uid],
          });
        } catch {}
        return;
      }
      const sk = `${gid}:${uid}`;
      const sd = stickerMap.get(sk) || {c:0, ts:now};
      if (now - sd.ts > 30000) { sd.c=1; sd.ts=now; } else sd.c++;
      stickerMap.set(sk, sd);
      if (sd.c > 5 && !senderAdm && !senderOwn && botAdm) {
        try { await sock.sendMessage(gid, {delete:key}); } catch {}
        if (sd.c === 6) {
          await sock.sendMessage(gid, {
            text:`⚠️ @${uid.replace('@s.whatsapp.net','')} Para com o spam de figurinhas!`,
            mentions:[uid],
          });
        }
        if (sd.c > 10) {
          try {
            await sock.groupParticipantsUpdate(gid,[uid],'remove');
            await sock.sendMessage(gid, {
              text:`🚫 @${uid.replace('@s.whatsapp.net','')} removido por spam de figurinhas.`,
              mentions:[uid],
            });
          } catch {}
          stickerMap.delete(sk);
        }
        return;
      }
    }

    // Anti foto de visualização única (nudez)
    const vo = message.viewOnceMessage?.message
      || message.viewOnceMessageV2?.message
      || message.viewOnceMessageV2Extension?.message;
    if (vo && (vo.imageMessage || vo.videoMessage) && !senderAdm && !senderOwn && botAdm) {
      try {
        await sock.sendMessage(gid, {delete:key});
        await sock.sendMessage(gid, {
          text:`🚫 @${uid.replace('@s.whatsapp.net','')} Fotos/vídeos de visualização única não são permitidos aqui!`,
          mentions:[uid],
        });
      } catch {}
      return;
    }

    // Detecção de briga → fechar grupo automaticamente
    if (hasFight(body) && getS(gid,'autoClose',true) && botAdm) {
      try {
        await sock.groupSettingUpdate(gid, 'announcement');
        await sock.sendMessage(gid, {
          text:`🔒 *O grupo foi fechado automaticamente.*\n\nO grupo só será aberto com autorização do meu dono, pois detectei briga, desrespeito às regras ou algo irregular. Obrigado ✍🏽`,
        });
      } catch {}
    }

    // Rastrear apresentações
    const apKw = ['me chamo','meu nome é','me apresento','sou o ','sou a ','me apresentando','olá sou','oi sou'];
    if (apKw.some(k => bodyN.includes(k))) {
      if (!presents[gid]) presents[gid] = [];
      if (!presents[gid].includes(uid)) {
        presents[gid].push(uid);
        saveDB(DB.presents, presents);
      }
    }

    // Detecção de número fake/suspeito (rakers/empresas com padrão suspeito)
    if (!senderAdm && !senderOwn && botAdm) {
      const n = uid.replace('@s.whatsapp.net','').replace(/\D/g,'');
      const fakePatterns = [/^0800/, /^0300/, /^4002/, /^4003/, /^4004/];
      if (fakePatterns.some(p => p.test(n))) {
        try {
          const tts = await getTTS(`Atenção! Identifiquei um número suspeito no grupo. Vou removê-lo para a proteção de todos.`).catch(()=>null);
          if (tts) await sock.sendMessage(gid, {audio:tts, mimetype:'audio/ogg; codecs=opus', ptt:true});
          await sock.sendMessage(gid, {
            text:`🚨 @${uid.replace('@s.whatsapp.net','')} *Número suspeito detectado!*\nVou removê-lo para o bem do grupo 😉⛑️`,
            mentions:[uid],
          });
          await sock.groupParticipantsUpdate(gid,[uid],'remove');
        } catch {}
        return;
      }
    }

    // Saudação de admins com áudio TTS
    const greetW = ['bom dia','boa tarde','boa noite'];
    if (greetW.some(g => bodyN.includes(g))) {
      const greet = bodyN.includes('bom dia') ? 'bom dia'
                  : bodyN.includes('boa tarde') ? 'boa tarde' : 'boa noite';
      try {
        if (senderOwn) {
          const tts = await getTTS(`Olá meu dono! ${greet}! Tudo bem?`);
          await sock.sendMessage(gid, {audio:tts, mimetype:'audio/ogg; codecs=opus', ptt:true}, {quoted:msg});
        } else if (senderAdm) {
          const name = uid.replace('@s.whatsapp.net','');
          const tts  = await getTTS(`Olá ${name}! ${greet}! Tudo bem?`);
          await sock.sendMessage(gid, {audio:tts, mimetype:'audio/ogg; codecs=opus', ptt:true}, {quoted:msg});
        }
      } catch {}
    }

    // Verificar resposta de quiz
    const quiz = quizMap.get(gid);
    if (quiz && bodyN.includes(quiz.a)) {
      clearTimeout(quiz.timeout);
      quizMap.delete(gid);
      await sock.sendMessage(gid, {
        text:`🎉 @${uid.replace('@s.whatsapp.net','')} acertou!\nResposta: *${quiz.a}* ✅`,
        mentions:[uid],
      });
      return;
    }

    // ─────────────── COMANDOS ───────────────
    if (!body.startsWith(PREFIX)) return;

    const [rawCmd, ...args] = body.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = rawCmd.toLowerCase();

    const adminCmds = ['fechar','abrir','bemvindo','boasvindas','autoclose','monitoring','kickflood'];
    if (adminCmds.includes(cmd) && !senderAdm && !senderOwn) {
      return sock.sendMessage(gid, {text:'🚫 Apenas administradores podem usar este comando!'});
    }

    switch(cmd) {

      // ── Música ──────────────────────────────
      case 'play': case 'musica': case 'música':
        await cmdPlay(msg, gid, args);
        break;

      // ── Menu ────────────────────────────────
      case 'menu': case 'ajuda': case 'help':
        await cmdMenu(msg, gid, meta);
        break;

      // ── Status ──────────────────────────────
      case 'ping': case 'status': {
        const up = process.uptime();
        const h  = Math.floor(up/3600), m = Math.floor((up%3600)/60);
        await sock.sendMessage(gid, {
          text:`🤖 *${BOT_NAME}*\n✅ Online!\n⏱️ Uptime: ${h}h ${m}min\n📅 ${moment().tz('America/Sao_Paulo').format('DD/MM/YYYY HH:mm:ss')}`,
        });
        break;
      }

      // ── Dono ────────────────────────────────
      case 'dono': case 'owner':
        await sock.sendMessage(gid, {
          text:`👑 *Dono do Bot*\n\nNome: *${OWNER_NAME}*\nContato: wa.me/${OWNER_NUM}`,
        });
        break;

      // ── Fechar grupo ────────────────────────
      case 'fechar':
        if (!botAdm) { await sock.sendMessage(gid,{text:'❌ Preciso ser admin!'}); break; }
        await sock.groupSettingUpdate(gid,'announcement');
        await sock.sendMessage(gid, {text:'🔒 *Grupo fechado!* Só admins podem enviar mensagens.'});
        break;

      // ── Abrir grupo ─────────────────────────
      case 'abrir':
        if (!botAdm) { await sock.sendMessage(gid,{text:'❌ Preciso ser admin!'}); break; }
        await sock.groupSettingUpdate(gid,'not_announcement');
        await sock.sendMessage(gid, {text:'🔓 *Grupo aberto!* Todos podem enviar mensagens.'});
        break;

      // ── Bem-vindo ───────────────────────────
      case 'bemvindo': case 'boasvindas': {
        const t = args[0]?.toLowerCase();
        if (t === 'on') {
          setS(gid,'welcome',true);
          await sock.sendMessage(gid,{text:'✅ Boas-vindas *ativadas!*'});
        } else if (t === 'off') {
          setS(gid,'welcome',false);
          await sock.sendMessage(gid,{text:'❌ Boas-vindas *desativadas.*'});
        } else if (t === 'texto' && args.length > 1) {
          setS(gid,'welcomeText', args.slice(1).join(' '));
          await sock.sendMessage(gid,{text:'✅ Texto de boas-vindas atualizado!'});
        } else {
          const st = getS(gid,'welcome',false);
          await sock.sendMessage(gid,{
            text:`📋 Boas-vindas: ${st?'✅ ON':'❌ OFF'}\n\nUso:\n${PREFIX}bemvindo on\n${PREFIX}bemvindo off\n${PREFIX}bemvindo texto <seu texto>`,
          });
        }
        break;
      }

      // ── Auto-close ──────────────────────────
      case 'autoclose': {
        const t = args[0]?.toLowerCase();
        if (t === 'on') {
          setS(gid,'autoClose',true);
          await sock.sendMessage(gid,{text:'✅ Fechamento automático *ativado!*\nO grupo fecha se detectar brigas.'});
        } else if (t === 'off') {
          setS(gid,'autoClose',false);
          await sock.sendMessage(gid,{text:'❌ Fechamento automático *desativado.*'});
        } else {
          const st = getS(gid,'autoClose',true);
          await sock.sendMessage(gid,{text:`Fechamento automático: ${st?'✅ ON':'❌ OFF'}`});
        }
        break;
      }

      // ── Apresentados ────────────────────────
      case 'apresentados': {
        const pList = presents[gid] || [];
        const notP  = parts.filter(p => !pList.includes(p.id) && !p.admin).slice(0,20);
        await sock.sendMessage(gid, {
          text:`📊 *Controle de Apresentações*\n\n` +
               `✅ Apresentados: ${pList.length}\n` +
               `❌ Não apresentados: ${notP.length}\n\n` +
               `${notP.map(p=>`@${p.id.replace('@s.whatsapp.net','')}`).join('\n')}`,
          mentions: notP.map(p=>p.id),
        });
        break;
      }

      // ── Quiz ────────────────────────────────
      case 'quiz': {
        if (quizMap.has(gid)) {
          await sock.sendMessage(gid,{text:'⚠️ Já há um quiz em andamento! Responda primeiro.'});
          break;
        }
        const q = QUIZ[Math.floor(Math.random()*QUIZ.length)];
        const timeout = setTimeout(async()=>{
          quizMap.delete(gid);
          await sock.sendMessage(gid,{text:`⏰ Tempo esgotado! A resposta era: *${q.a}*`}).catch(()=>{});
        },30000);
        quizMap.set(gid, {a: norm(q.a), timeout});
        await sock.sendMessage(gid,{
          text:`🎮 *QUIZ JORDAN BOT!*\n\n${q.q}\n\n⏱️ Você tem 30 segundos!`,
        });
        break;
      }

      // ── Dado ────────────────────────────────
      case 'dado': {
        const r = Math.floor(Math.random()*6)+1;
        const e = ['','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣'];
        await sock.sendMessage(gid,{
          text:`🎲 @${uid.replace('@s.whatsapp.net','')} jogou o dado e tirou: *${e[r]} (${r})*`,
          mentions:[uid],
        });
        break;
      }

      // ── Bola 8 ──────────────────────────────
      case '8ball': case 'bola8': {
        if (!args.length) { await sock.sendMessage(gid,{text:`Uso: ${PREFIX}8ball <sua pergunta>`}); break; }
        const resp = BALL8[Math.floor(Math.random()*BALL8.length)];
        await sock.sendMessage(gid,{
          text:`🎱 *Pergunta:* ${args.join(' ')}\n*Resposta:* ${resp}`,
        });
        break;
      }

      // ── Monitoramento ───────────────────────
      case 'monitoring': {
        const t = args[0]?.toLowerCase();
        const grupos = readDB(DB.grupos, {});
        if (!grupos[gid]) grupos[gid] = {};
        if (t === 'on') {
          grupos[gid].monitoring = true;
          saveDB(DB.grupos, grupos);
          await sock.sendMessage(gid,{text:'✅ Monitoramento *ativado!* Avisos periódicos serão enviados.'});
        } else if (t === 'off') {
          grupos[gid].monitoring = false;
          saveDB(DB.grupos, grupos);
          await sock.sendMessage(gid,{text:'❌ Monitoramento *desativado.*'});
        }
        break;
      }

      // ── YouTube Vídeo ────────────────────────
      case 'yt': case 'ytb': case 'youtube': case 'video': case 'vid': {
        const q = args.join(' ');
        if (!q) {
          await sock.sendMessage(gid, {
            text: `📹 *Download de Vídeo*\n\nUso:\n${PREFIX}yt <link do YouTube>\n${PREFIX}yt <busca>\n\nEx: ${PREFIX}yt https://youtu.be/abc\nEx: ${PREFIX}yt funk batidão 2024`,
          });
          break;
        }
        await sock.sendMessage(gid, {text:`⬇️ Baixando vídeo: *${q.slice(0,50)}*...\n⏳ Aguarde...`}, {quoted: msg});
        try {
          const file   = await baixarVideo(q);
          const buf    = fs.readFileSync(file);
          const sizeMB = (buf.length / 1024 / 1024).toFixed(1);
          await sock.sendMessage(gid, {
            video: buf, mimetype: 'video/mp4',
            caption: `✅ *Vídeo baixado!* 📹 ${sizeMB} MB`,
          }, {quoted: msg});
          fs.remove(file).catch(() => {});
        } catch (e) {
          await sock.sendMessage(gid, {text: `❌ Erro no download: ${e.message}`});
        }
        break;
      }

      // ── TikTok Vídeo ─────────────────────────
      case 'tiktok': case 'tt': {
        const url = args[0];
        if (!url) {
          await sock.sendMessage(gid, {text: `🎵 Uso: ${PREFIX}tiktok <link do TikTok>`});
          break;
        }
        await sock.sendMessage(gid, {text: `⬇️ Baixando TikTok...\n⏳ Aguarde...`}, {quoted: msg});
        try {
          const file   = await baixarVideo(url);
          const buf    = fs.readFileSync(file);
          const sizeMB = (buf.length / 1024 / 1024).toFixed(1);
          await sock.sendMessage(gid, {
            video: buf, mimetype: 'video/mp4',
            caption: `✅ *TikTok baixado!* 🎵 ${sizeMB} MB`,
          }, {quoted: msg});
          fs.remove(file).catch(() => {});
        } catch (e) {
          await sock.sendMessage(gid, {text: `❌ Erro: ${e.message}`});
        }
        break;
      }

      // ── Instagram Vídeo / Reel ────────────────
      case 'insta': case 'instagram': case 'ig': case 'reel': {
        const url = args[0];
        if (!url) {
          await sock.sendMessage(gid, {text: `📸 Uso: ${PREFIX}insta <link do Instagram/Reel>`});
          break;
        }
        await sock.sendMessage(gid, {text: `⬇️ Baixando Instagram...\n⏳ Aguarde...`}, {quoted: msg});
        try {
          const file   = await baixarVideo(url);
          const buf    = fs.readFileSync(file);
          const sizeMB = (buf.length / 1024 / 1024).toFixed(1);
          await sock.sendMessage(gid, {
            video: buf, mimetype: 'video/mp4',
            caption: `✅ *Instagram baixado!* 📸 ${sizeMB} MB`,
          }, {quoted: msg});
          fs.remove(file).catch(() => {});
        } catch (e) {
          await sock.sendMessage(gid, {text: `❌ Erro: ${e.message}`});
        }
        break;
      }

      // ── Consulta de Número (só dono) ──────────
      case 'numero': case 'num': case 'cel': {
        if (!senderOwn) {
          await sock.sendMessage(gid, {text: '🔒 Apenas o dono pode usar este comando!'});
          break;
        }
        const n = args[0];
        if (!n) {
          await sock.sendMessage(gid, {text: `🔍 Uso: ${PREFIX}numero <número>\nEx: ${PREFIX}numero 558694029686`});
          break;
        }
        try {
          const info = await consultarNumero(n);
          await sock.sendMessage(gid, {text: info}, {quoted: msg});
        } catch (e) {
          await sock.sendMessage(gid, {text: `❌ ${e.message}`});
        }
        break;
      }

      default: break;
    }

  } catch(e) {
    console.error('[MSG]', e.message);
  }
}

// ═══════════════════════════════════════════════════
// WELCOME — novos participantes
// ═══════════════════════════════════════════════════
async function onParticipants({ id: gid, participants, action }) {
  if (action !== 'add') return;
  if (!getS(gid,'welcome',false)) return;

  let meta;
  try { meta = await sock.groupMetadata(gid); } catch { return; }

  for (const uid of participants) {
    const txt = getS(gid,'welcomeText',
      `👋 *Bem-vindo(a) ao ${meta.subject}!*\n\nPor favor se apresente! Diga seu nome e de onde você é 😊\n\n📋 Leia as regras do grupo.`);
    try {
      const ppUrl = await sock.profilePictureUrl(uid,'image').catch(()=>null);
      const caption = `@${uid.replace('@s.whatsapp.net','')} ${txt}`;
      if (ppUrl) {
        const buf = await fetch(ppUrl,{timeout:10000}).then(r=>r.buffer());
        await sock.sendMessage(gid,{image:buf, caption, mentions:[uid]});
      } else {
        await sock.sendMessage(gid,{text:caption, mentions:[uid]});
      }
    } catch {}
  }
}

// ═══════════════════════════════════════════════════
// AVISOS PERIÓDICOS
// ═══════════════════════════════════════════════════
function startPeriodic() {
  const msgs = [
    '🤖👀 *Assistente de olho nas conversas* 🫡',
    '⚡ *Jordan Bot Oficial* monitorando o grupo. Respeitem as regras! 📋',
    '🛡️ Bot ativo e protegendo o grupo. Bom comportamento! 😊',
  ];
  setInterval(async () => {
    const grupos = readDB(DB.grupos, {});
    for (const [gid, d] of Object.entries(grupos)) {
      if (d?.monitoring) {
        try {
          await sock.sendMessage(gid, {text: msgs[Math.floor(Math.random()*msgs.length)]});
        } catch {}
      }
    }
  }, 4 * 60 * 60 * 1000);
}

// ═══════════════════════════════════════════════════
// CONEXÃO — AUTO-RECONEXÃO INFINITA
// ═══════════════════════════════════════════════════
async function startBot() {
  await fs.ensureDir(SESSION_DIR);
  await fs.ensureDir(TEMP_DIR);

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  // Usa versão real do WhatsApp Web; fallback para versão estável conhecida
  let version;
  try {
    const r = await fetchLatestWaWebVersion({});
    version = r.version;
    console.log('[VERSÃO] WA Web:', JSON.stringify(version));
  } catch {
    try {
      const r = await fetchLatestBaileysVersion();
      version = r.version;
    } catch {
      version = [2, 3000, 1015901307]; // versão estável de fallback
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
    printQRInTerminal: !needsPairing,   // QR só se não usar código
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

  // ── Pareamento por código de número ──────────────
  if (needsPairing) {
    const phone = OWNER_NUM.startsWith('55') ? OWNER_NUM : `55${OWNER_NUM}`;
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phone);
        const c = code.match(/.{1,4}/g)?.join('-') || code; // formata: XXXX-XXXX
        console.log('\n╔═══════════════════════════════════════════╗');
        console.log('║       📱 CÓDIGO DE PAREAMENTO             ║');
        console.log('║                                           ║');
        console.log(`║   👉  ${c.padEnd(35)} ║`);
        console.log('║                                           ║');
        console.log('║  Como usar:                               ║');
        console.log('║  WhatsApp → Aparelhos conectados          ║');
        console.log('║  → Conectar aparelho                      ║');
        console.log('║  → Conectar com número de telefone        ║');
        console.log('╚═══════════════════════════════════════════╝\n');
      } catch (e) {
        console.log('[PAIRING] Falha ao gerar código:', e.message);
        console.log('[PAIRING] Escaneie o QR Code no terminal.');
        // forçar exibição do QR como fallback
        sock.sendPresenceUpdate?.('unavailable').catch(() => {});
      }
    }, 2000);
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n📱 QR Code gerado — escaneie pelo WhatsApp!\n');
    }

    if (connection === 'close') {
      const err  = lastDisconnect?.error;
      // extrair código de forma segura sem @hapi/boom
      const code = err?.output?.statusCode
        ?? err?.output?.payload?.statusCode
        ?? err?.data?.reason
        ?? err?.status
        ?? (err?.isBoom ? err.output?.statusCode : undefined)
        ?? 0;

      // sessão inválida: loggedOut (401), badSession (500), forbidden (403) ou 405
      const shouldClearSession = [401, 403, 405, 500].includes(code);

      console.log(`[CONEXÃO] Encerrada — código: ${code}${shouldClearSession ? ' (limpando sessão)' : ''}`);

      if (shouldClearSession) {
        console.log('[SESSÃO] Credenciais inválidas — apagando session_data e reiniciando do zero...');
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
