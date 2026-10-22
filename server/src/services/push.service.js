const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

let cachedVapidKeys = null;
let tablesInitialized = false;

/**
 * Converte string base64 ou base64url em Buffer de forma resiliente
 */
function fromBase64Url(str) {
  const normalized = String(str)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const pad = normalized.length % 4;
  const padded = pad ? normalized + '='.repeat(4 - pad) : normalized;
  return Buffer.from(padded, 'base64');
}

/**
 * Garante que as tabelas de notificações existam no banco mesmo sem re-gerar Prisma Client
 */
async function garantirTabelas() {
  if (tablesInitialized) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "push_subscriptions" (
        "id" SERIAL NOT NULL,
        "endpoint" TEXT NOT NULL,
        "p256dh" TEXT NOT NULL,
        "auth" TEXT NOT NULL,
        "userAgent" TEXT,
        "active" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "configuracoes_sistema" (
        "chave" TEXT NOT NULL,
        "valor" TEXT NOT NULL,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "configuracoes_sistema_pkey" PRIMARY KEY ("chave")
      );
    `);
    tablesInitialized = true;
  } catch (err) {
    console.warn('[PushService] Aviso ao garantir tabelas de push:', err.message);
  }
}

/**
 * Obtém ou gera automaticamente o par de chaves VAPID (P-256)
 */
async function obterChavesVapid() {
  if (cachedVapidKeys) return cachedVapidKeys;

  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    cachedVapidKeys = {
      publicKey: process.env.VAPID_PUBLIC_KEY.trim(),
      privateKey: process.env.VAPID_PRIVATE_KEY.trim()
    };
    return cachedVapidKeys;
  }

  await garantirTabelas();

  try {
    const rows = await prisma.$queryRaw`
      SELECT "chave", "valor" FROM "configuracoes_sistema"
      WHERE "chave" IN ('vapid_public_key', 'vapid_private_key')
    `;

    const map = {};
    for (const r of rows) {
      map[r.chave] = r.valor;
    }

    if (map.vapid_public_key && map.vapid_private_key) {
      cachedVapidKeys = {
        publicKey: map.vapid_public_key,
        privateKey: map.vapid_private_key
      };
      return cachedVapidKeys;
    }
  } catch (err) {
    console.warn('[PushService] Aviso ao ler chaves VAPID do banco:', err.message);
  }

  // Gera novo par de chaves P-256 (prime256v1)
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const publicKey = ecdh.getPublicKey().toString('base64url');
  const privateKey = ecdh.getPrivateKey().toString('base64url');

  try {
    await prisma.$executeRaw`
      INSERT INTO "configuracoes_sistema" ("chave", "valor", "updatedAt")
      VALUES ('vapid_public_key', ${publicKey}, NOW()),
             ('vapid_private_key', ${privateKey}, NOW())
      ON CONFLICT ("chave") DO UPDATE SET "valor" = EXCLUDED."valor", "updatedAt" = NOW()
    `;
  } catch (err) {
    console.warn('[PushService] Aviso ao salvar chaves VAPID no banco:', err.message);
  }

  cachedVapidKeys = { publicKey, privateKey };
  return cachedVapidKeys;
}

/**
 * Gera cabeçalho Authorization VAPID (RFC 8292 - ES256)
 */
function criarCabecalhoVapid(endpoint, publicKeyB64, privateKeyB64) {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600; // 12h
  const subject = process.env.VAPID_SUBJECT || 'mailto:carlesandrogaspar@gmail.com';

  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ aud: audience, exp, sub: subject })).toString('base64url');
  const signingInput = `${header}.${payload}`;

  const pubBuf = fromBase64Url(publicKeyB64);
  const privBuf = fromBase64Url(privateKeyB64);

  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: pubBuf.subarray(1, 33).toString('base64url'),
    y: pubBuf.subarray(33, 65).toString('base64url'),
    d: privBuf.toString('base64url')
  };

  const privateKeyObj = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: privateKeyObj,
    dsaEncoding: 'ieee-p1363'
  }).toString('base64url');

  const jwt = `${signingInput}.${signature}`;
  return `vapid t=${jwt}, k=${publicKeyB64}`;
}

/**
 * Criptografa o payload segundo RFC 8291 (Content-Encoding: aes128gcm)
 */
function criptografarPayloadWebPush(payloadStr, p256dhB64, authB64) {
  const uaPublic = fromBase64Url(p256dhB64);
  const authSecret = fromBase64Url(authB64);

  const serverECDH = crypto.createECDH('prime256v1');
  serverECDH.generateKeys();
  const asPublic = serverECDH.getPublicKey();
  const sharedSecret = serverECDH.computeSecret(uaPublic);

  const salt = crypto.randomBytes(16);

  // RFC 8291: IKM via HKDF-SHA256(salt=authSecret, ikm=sharedSecret, info="WebPush: info\0" || uaPublic || asPublic)
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'ascii'),
    uaPublic,
    asPublic
  ]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32));

  // Derivação de CEK (16 bytes) e NONCE (12 bytes)
  const cekInfo = Buffer.from('Content-Encoding: aes128gcm\0', 'ascii');
  const nonceInfo = Buffer.from('Content-Encoding: nonce\0', 'ascii');
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, cekInfo, 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, nonceInfo, 12));

  // Delimitador de registro final 0x02 (RFC 8188)
  const plaintext = Buffer.concat([
    Buffer.from(payloadStr, 'utf8'),
    Buffer.from([0x02])
  ]);

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
    cipher.getAuthTag()
  ]);

  // Cabeçalho binário aes128gcm: salt (16B) + rs (4B uint32BE = 4096) + idlen (1B = 65) + keyid (65B asPublic)
  const rsBuf = Buffer.alloc(4);
  rsBuf.writeUInt32BE(4096, 0);
  const idLenBuf = Buffer.from([asPublic.length]);

  return Buffer.concat([salt, rsBuf, idLenBuf, asPublic, ciphertext]);
}

/**
 * Registra ou atualiza a inscrição de um dispositivo
 */
async function salvarInscricao(subscription, userAgent = '') {
  await garantirTabelas();

  if (!subscription || !subscription.endpoint || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
    throw new Error('Dados de inscrição Web Push inválidos ou incompletos.');
  }

  const endpoint = String(subscription.endpoint).trim();
  const p256dh = String(subscription.keys.p256dh).trim();
  const auth = String(subscription.keys.auth).trim();
  const ua = userAgent ? String(userAgent).slice(0, 500) : null;

  await prisma.$executeRaw`
    INSERT INTO "push_subscriptions" ("endpoint", "p256dh", "auth", "userAgent", "active", "createdAt", "updatedAt")
    VALUES (${endpoint}, ${p256dh}, ${auth}, ${ua}, true, NOW(), NOW())
    ON CONFLICT ("endpoint")
    DO UPDATE SET
      "p256dh" = EXCLUDED."p256dh",
      "auth" = EXCLUDED."auth",
      "userAgent" = EXCLUDED."userAgent",
      "active" = true,
      "updatedAt" = NOW()
  `;

  return { endpoint };
}

/**
 * Desativa/remove a inscrição de um dispositivo
 */
async function removerInscricao(endpoint) {
  if (!endpoint) return;
  await garantirTabelas();
  await prisma.$executeRaw`
    DELETE FROM "push_subscriptions" WHERE "endpoint" = ${String(endpoint).trim()}
  `;
}

/**
 * Envia uma notificação Web Push para uma única inscrição
 */
async function enviarParaInscricao(sub, payloadObj) {
  const { publicKey, privateKey } = await obterChavesVapid();
  const payloadStr = JSON.stringify(payloadObj);
  const bodyBuffer = criptografarPayloadWebPush(payloadStr, sub.p256dh, sub.auth);
  const vapidHeader = criarCabecalhoVapid(sub.endpoint, publicKey, privateKey);

  const response = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'Content-Length': String(bodyBuffer.length),
      'TTL': '86400',
      'Urgency': 'normal',
      'Authorization': vapidHeader
    },
    body: bodyBuffer
  });

  if (response.status === 404 || response.status === 410) {
    // Dispositivo revogou permissão ou inscrição expirou
    await removerInscricao(sub.endpoint);
    return { status: 'removido', code: response.status };
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${errText}`);
  }

  return { status: 'enviado', code: response.status };
}

/**
 * Dispara uma notificação Push para todos os dispositivos inscritos
 */
async function enviarNotificacaoParaTodos(dadosNotificacao) {
  await garantirTabelas();

  const inscricoes = await prisma.$queryRaw`
    SELECT "endpoint", "p256dh", "auth"
    FROM "push_subscriptions"
    WHERE "active" = true
  `;

  if (!inscricoes || inscricoes.length === 0) {
    return { total: 0, enviados: 0, removidos: 0, falhas: 0 };
  }

  const payload = {
    title: dadosNotificacao.title || 'CargaVE',
    body: dadosNotificacao.body || 'Nova atualização disponível no CargaVE!',
    tag: dadosNotificacao.tag || 'cargave-update',
    data: dadosNotificacao.data || '/'
  };

  let enviados = 0;
  let removidos = 0;
  let falhas = 0;

  await Promise.allSettled(
    inscricoes.map(async (sub) => {
      try {
        const res = await enviarParaInscricao(sub, payload);
        if (res.status === 'enviado') enviados++;
        else if (res.status === 'removido') removidos++;
      } catch (err) {
        falhas++;
        console.warn('[PushService] Falha ao enviar push para endpoint:', err.message);
      }
    })
  );

  return {
    total: inscricoes.length,
    enviados,
    removidos,
    falhas
  };
}

/**
 * Compara duas strings SemVer (ex: "1.2.0" vs "1.1.0").
 * Retorna 1 se vA > vB, -1 se vA < vB, 0 se iguais.
 */
function compararSemVer(vA, vB) {
  const partsA = String(vA || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const partsB = String(vB || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const a = partsA[i] || 0;
    const b = partsB[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

/**
 * Verifica no boot do servidor se houve avanço de versão da aplicação e notifica os inscritos
 */
async function verificarEAnunciarNovaVersao(versaoAtual) {
  if (!versaoAtual) return;
  await garantirTabelas();

  try {
    const rows = await prisma.$queryRaw`
      SELECT "valor" FROM "configuracoes_sistema"
      WHERE "chave" = 'ultima_versao_anunciada'
    `;

    const versaoAnterior = rows && rows[0] ? rows[0].valor : null;

    // Só grava e anuncia se não havia versão anterior ou se a versão atual for superior (evita divergência/downgrade)
    if (!versaoAnterior || compararSemVer(versaoAtual, versaoAnterior) > 0) {
      await prisma.$executeRaw`
        INSERT INTO "configuracoes_sistema" ("chave", "valor", "updatedAt")
        VALUES ('ultima_versao_anunciada', ${String(versaoAtual)}, NOW())
        ON CONFLICT ("chave") DO UPDATE SET "valor" = EXCLUDED."valor", "updatedAt" = NOW()
      `;

      if (versaoAnterior && compararSemVer(versaoAtual, versaoAnterior) > 0) {
        console.log(`[PushService] Nova versão detectada (${versaoAnterior} -> ${versaoAtual}). Disparando push...`);
        await enviarNotificacaoParaTodos({
          title: `⚡ CargaVE atualizado (v${versaoAtual})`,
          body: 'Uma nova atualização com melhorias e novidades já está disponível no seu aplicativo!',
          tag: `cargave-version-${versaoAtual}`
        });
      }
    }
  } catch (err) {
    console.warn('[PushService] Aviso ao verificar versão para push:', err.message);
  }
}

module.exports = {
  obterChavesVapid,
  salvarInscricao,
  removerInscricao,
  enviarParaInscricao,
  enviarNotificacaoParaTodos,
  verificarEAnunciarNovaVersao
};
