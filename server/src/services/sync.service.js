const https = require('https');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Remove acentos, caracteres especiais e converte para minúsculas
 */
function normalizarTexto(txt) {
  return (txt || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Gera um ID único em snake_case para o veículo
 */
function gerarIdVeiculo(brand, model) {
  return `${brand}_${model}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Tabela de especificações oficiais de recarga homologadas para o Brasil
 * Carregada do catálogo oficial consolidado do Carregados
 */
let POTENCIAS_HOMOLOGADAS = {};
try {
  POTENCIAS_HOMOLOGADAS = require('./potencias_homologadas.json');
} catch (e) {
  POTENCIAS_HOMOLOGADAS = {};
}

/**
 * Estima ou recupera potências máximas de recarga AC e DC baseadas na química, bateria e categoria
 */
function calibrarPotenciasRecarga(tipo, bateria, marca, modeloId = '') {
  // 1. Checa potências homologadas conhecidas (busca direta ou parcial)
  const idChave = (modeloId || '').toLowerCase();
  if (POTENCIAS_HOMOLOGADAS[idChave]) {
    return { ...POTENCIAS_HOMOLOGADAS[idChave] };
  }
  for (const [chave, pot] of Object.entries(POTENCIAS_HOMOLOGADAS)) {
    if (idChave.includes(chave) || chave.includes(idChave)) {
      return { maxAc: pot.maxAc, maxDc: pot.maxDc };
    }
  }

  const brandNorm = (marca || '').toLowerCase();
  const bat = Number(bateria) || 0;

  if (tipo === 'EREV' || tipo === 'REEV') {
    // Autonomia Estendida (EREV / REEV)
    if (bat >= 35) {
      return { maxAc: 11.0, maxDc: 60.0 };
    }
    return { maxAc: 6.6, maxDc: 30.0 };
  }

  if (tipo === 'PHEV') {
    // Híbridos Plug-in
    if (brandNorm.includes('porsche')) {
      return { maxAc: 11.0, maxDc: 0.0 };
    }
    if (brandNorm.includes('mercedes')) {
      return { maxAc: 3.7, maxDc: 0.0 };
    }
    if (bat < 12) {
      return { maxAc: 3.3, maxDc: 0.0 };
    }
    if (bat < 25) {
      return { maxAc: 6.6, maxDc: bat > 18 ? 18.0 : 0.0 };
    }
    // Baterias grandes em PHEV (30-45 kWh)
    return { maxAc: 6.6, maxDc: bat >= 35 ? 50.0 : 30.0 };
  }

  // 100% Elétricos (BEV)
  const isPremiumHighSpeed = ['audi', 'porsche', 'zeekr', 'avatr', 'denza', 'lucid', 'lotus'].some(p => brandNorm.includes(p));

  if (isPremiumHighSpeed) {
    if (bat >= 90) {
      return { maxAc: 22.0, maxDc: 270.0 };
    }
    return { maxAc: 11.0, maxDc: 200.0 };
  }

  if (bat <= 40) {
    return { maxAc: 6.6, maxDc: 70.0 };
  }
  if (bat <= 65) {
    return { maxAc: 7.0, maxDc: 85.0 };
  }
  if (bat <= 85) {
    return { maxAc: 11.0, maxDc: 150.0 };
  }
  return { maxAc: 11.0, maxDc: 200.0 };
}

/**
 * Auxiliar para requisição HTTPS com JSON
 */
function fetchHttpsJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 12000,
      headers: {
        'User-Agent': 'CargaVE/1.3 (https://cargave.app; Central de Recarga)',
        'Accept': 'application/json'
      }
    }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`Status HTTP ${res.statusCode} ao consultar ${url}`));
      }
      let rawData = '';
      res.on('data', chunk => rawData += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(rawData));
        } catch (e) {
          reject(new Error(`Resposta JSON inválida de ${url}: ${e.message}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Tempo limite esgotado (timeout 12s) ao consultar Carregados API.'));
    });

    req.on('error', (err) => {
      reject(new Error(`Falha de conexão com Carregados API: ${err.message}`));
    });
  });
}

/**
 * Determina com precisão o tipo de propulsão (BEV, PHEV ou REEV)
 */
function determinarTipoVeiculo(marca, modelo, bateria, autonomia, conectorIds = []) {
  const full = `${marca} ${modelo}`.toLowerCase();

  if (/\b(reev|erev|estendida|extensor|super hybrid|super híbrido)\b/i.test(full)) {
    return 'REEV';
  }

  const phevKeywords = [
    'phev', 'plug-in', 'plugin', 'hybrid', 'hibrido', 'híbrido',
    'em-i', 'em-p', 'dm-i', 'dm-p', 'dht', 'hi4', 'tfsie', 'tfsi e',
    'e-hybrid', '4xe', 'e-tech plug', '450h+', 'gte', 'shs-p'
  ];

  if (phevKeywords.some(k => full.includes(k))) {
    if (!full.includes('bev') && !full.includes('100% elétrico')) {
      return 'PHEV';
    }
  }

  const bat = Number(bateria) || 0;
  const rng = Number(autonomia) || 0;
  if (bat > 0 && bat <= 35 && rng > 0 && rng <= 140) {
    if (!conectorIds.includes(20) || (bat <= 22 && rng <= 100)) {
      return 'PHEV';
    }
  }

  return 'BEV';
}

/**
 * Consulta a API pública do Carregados (https://carregados.com.br/api/public/vehicles)
 * Pagina todos os veículos e expande variantes para obter dados padronizados Inmetro PBEV.
 */
async function buscarCatalogoCarregados() {
  const listaVeiculos = [];
  const idsVistos = new Set();
  let page = 1;
  const maxPages = 6; // Proteção contra loops

  while (page <= maxPages) {
    const url = `https://carregados.com.br/api/public/vehicles?limit=100&page=${page}`;
    const data = await fetchHttpsJson(url);
    const vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];

    for (const v of vehicles) {
      const make = (v.make || '').trim();
      const baseModel = (v.model || '').trim();
      const variants = Array.isArray(v.variants) ? v.variants : [];
      const conns = Array.isArray(v.connectors) ? v.connectors.map(c => c.id) : [];

      if (variants.length > 0) {
        for (const variant of variants) {
          const varName = (variant.name || '').trim();
          let modelFinal = baseModel;
          if (varName && !baseModel.toLowerCase().includes(varName.toLowerCase())) {
            modelFinal = `${baseModel} ${varName}`;
          }

          const battery = Number(variant.batteryCapacityKwh || v.batteryCapacityKwh) || 0;
          const range = Number(variant.ratedRangeKm || v.ratedRangeKm) || 0;

          if (battery > 0 || range > 0) {
            let idSugerido = gerarIdVeiculo(make, modelFinal);
            if (idsVistos.has(idSugerido)) {
              idSugerido = `${idSugerido}_${Math.round(battery)}kwh`;
              if (idsVistos.has(idSugerido)) continue;
            }
            idsVistos.add(idSugerido);

            const tipoPadronizado = determinarTipoVeiculo(make, modelFinal, battery, range, conns);
            const pot = calibrarPotenciasRecarga(tipoPadronizado, battery, make, idSugerido);

            listaVeiculos.push({
              id: idSugerido,
              brand: make,
              model: modelFinal,
              type: tipoPadronizado,
              battery: Number(battery.toFixed(2)),
              range: Math.round(range),
              maxAc: pot.maxAc,
              maxDc: pot.maxDc,
              source: 'carregados.com.br'
            });
          }
        }
      } else {
        const battery = Number(v.batteryCapacityKwh) || 0;
        const range = Number(v.ratedRangeKm) || 0;

        if (battery > 0 || range > 0) {
          let idSugerido = gerarIdVeiculo(make, baseModel);
          if (idsVistos.has(idSugerido)) {
            idSugerido = `${idSugerido}_${Math.round(battery)}kwh`;
            if (idsVistos.has(idSugerido)) continue;
          }
          idsVistos.add(idSugerido);

          const tipoPadronizado = determinarTipoVeiculo(make, baseModel, battery, range, conns);
          const pot = calibrarPotenciasRecarga(tipoPadronizado, battery, make, idSugerido);

          listaVeiculos.push({
            id: idSugerido,
            brand: make,
            model: baseModel,
            type: tipoPadronizado,
            battery: Number(battery.toFixed(2)),
            range: Math.round(range),
            maxAc: pot.maxAc,
            maxDc: pot.maxDc,
            source: 'carregados.com.br'
          });
        }
      }
    }

    if (!data.pagination || !data.pagination.hasMore) {
      break;
    }
    page++;
  }

  return listaVeiculos;
}

/**
 * Fallback: Realiza requisição HTTPS para obter o catálogo do eletricos.app
 */
function baixarCatalogoHtmlFallback() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.eletricos.app',
      path: '/catalogo',
      method: 'GET',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8'
      }
    };

    const req = https.request(options, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`O site eletricos.app retornou status HTTP ${res.statusCode}`));
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Tempo limite esgotado ao contatar eletricos.app (timeout 15s).'));
    });

    req.on('error', (err) => {
      reject(new Error(`Falha de rede ao conectar com eletricos.app: ${err.message}`));
    });

    req.end();
  });
}

/**
 * Fallback: Extrai veículos BEV, PHEV e EREV a partir do conteúdo HTML do eletricos.app
 */
function extrairVeiculosDoHtmlFallback(html) {
  const secoes = html.split('<a class="block" href="/veiculo/');
  const veiculos = [];

  for (let i = 1; i < secoes.length; i++) {
    const bloco = secoes[i];
    const blocoAnterior = secoes[i - 1];

    const slugMatch = bloco.match(/^([^"]+)"/);
    const slug = slugMatch ? slugMatch[1] : '';

    const trechoCard = blocoAnterior.slice(-3500);

    const tipoMatch = trechoCard.match(/border-transparent hover:bg-muted\/80 bg-primary\/90 text-primary-foreground border-0">([^<]+)<\/div>/);
    const tipoTexto = tipoMatch ? tipoMatch[1].trim() : '';

    const marcaMatch = trechoCard.match(/<p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-0\.5">([^<]+)<\/p>/);
    const marca = marcaMatch ? marcaMatch[1].trim() : '';

    const modeloMatch = trechoCard.match(/<h3 class="text-xl font-bold text-foreground group-hover:text-primary transition-colors mb-1">([^<]+)<\/h3>/);
    const modelo = modeloMatch ? modeloMatch[1].trim() : '';

    const autMatch = trechoCard.match(/Autonomia<\/div><div class="font-bold text-sm ">([0-9]+)\s*km<\/div>/);
    const range = autMatch ? parseInt(autMatch[1], 10) : 0;

    const batMatch = trechoCard.match(/Bateria<\/div><div class="font-bold text-sm ">([0-9]+(?:,[0-9]+)?)\s*kWh<\/div>/);
    const battery = batMatch ? parseFloat(batMatch[1].replace(',', '.')) : 0;

    let tipoPadronizado = null;
    const tipoTextoLower = tipoTexto.toLowerCase();
    const slugLower = slug.toLowerCase();
    const modeloLower = modelo.toLowerCase();

    if (tipoTextoLower.includes('elétrico') || slugLower.includes('-bev') || modeloLower.includes('bev')) {
      tipoPadronizado = 'BEV';
    } else if (
      tipoTextoLower.includes('autonomia estendida') ||
      tipoTextoLower.includes('extensor') ||
      tipoTextoLower.includes('erev') ||
      tipoTextoLower.includes('reev') ||
      slugLower.includes('erev') ||
      slugLower.includes('reev')
    ) {
      tipoPadronizado = 'REEV';
    } else if (
      tipoTextoLower.includes('plug-in') ||
      slugLower.includes('-phev') ||
      modeloLower.includes('phev') ||
      tipoTextoLower.includes('híbrido plug-in')
    ) {
      tipoPadronizado = 'PHEV';
    }

    if (tipoPadronizado && marca && modelo) {
      const idSugerido = slug ? slug.replace(/-/g, '_') : gerarIdVeiculo(marca, modelo);
      const potencias = calibrarPotenciasRecarga(tipoPadronizado, battery, marca, idSugerido);

      veiculos.push({
        id: idSugerido,
        brand: marca,
        model: modelo,
        type: tipoPadronizado,
        battery: battery || (tipoPadronizado === 'BEV' ? 60 : (tipoPadronizado === 'REEV' ? 28 : 18)),
        range: range || (tipoPadronizado === 'BEV' ? 300 : (tipoPadronizado === 'REEV' ? 140 : 60)),
        maxAc: potencias.maxAc,
        maxDc: potencias.maxDc,
        source: 'eletricos.app'
      });
    }
  }

  return veiculos;
}

/**
 * Obtém catálogo remoto priorizando a API pública do Carregados com fallback para eletricos.app
 */
async function obterCatalogoRemoto() {
  try {
    const carregados = await buscarCatalogoCarregados();
    if (carregados && carregados.length > 0) {
      return { fonte: 'carregados.com.br (API REST)', veiculos: carregados };
    }
  } catch (err) {
    console.warn('[SyncService] Aviso: Carregados API indisponível, acionando fallback eletricos.app:', err.message);
  }

  const html = await baixarCatalogoHtmlFallback();
  const veiculosFallback = extrairVeiculosDoHtmlFallback(html);
  return { fonte: 'eletricos.app (HTML Fallback)', veiculos: veiculosFallback };
}

/**
 * Termos comuns de propulsão
 */
const TERMOS_PROPULSAO = new Set([
  'hibrido', 'híbrido', 'reev', 'erev', 'phev', 'bev', 'ev',
  'eletrico', 'elétrico', 'plugin', 'plug-in', 'plug', 'in'
]);

function extrairTokensModelo(modeloStr) {
  return (modeloStr || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 1 && !TERMOS_PROPULSAO.has(t));
}

/**
 * Compara veículos extraídos com o banco de dados do sistema
 * Identifica tanto modelos NÃO CADASTRADOS quanto modelos COM DIVERGÊNCIAS de bateria/autonomia.
 */
async function verificarNovidades() {
  const { fonte, veiculos: veiculosRemotos } = await obterCatalogoRemoto();
  const veiculosLocais = await prisma.veiculo.findMany();

  const novos = [];
  const existentes = [];
  const divergentes = [];

  for (const vRemoto of veiculosRemotos) {
    const marcaNorm = normalizarTexto(vRemoto.brand);
    const modeloNorm = normalizarTexto(vRemoto.model);

    const matchLocal = veiculosLocais.find(vLocal => {
      // 1. Checa ID direto
      if (vLocal.id === vRemoto.id) return true;

      // 2. Mesma marca obrigatória
      const vLocalMarcaNorm = normalizarTexto(vLocal.brand);
      if (vLocalMarcaNorm !== marcaNorm) return false;

      // 3. Tipo de propulsão: BEV (100% elétrico) NUNCA é igual a REEV/EREV ou PHEV
      const tipoLocal = (vLocal.type || '').toUpperCase();
      const tipoRemoto = (vRemoto.type || '').toUpperCase();
      const isReevLocal = tipoLocal === 'REEV' || tipoLocal === 'EREV';
      const isReevRemoto = tipoRemoto === 'REEV' || tipoRemoto === 'EREV';
      if (isReevLocal !== isReevRemoto) return false;
      if (tipoLocal !== tipoRemoto && !isReevLocal) {
        if (tipoLocal === 'BEV' || tipoRemoto === 'BEV') return false;
      }

      // 4. Modelo com string normalizada idêntica
      const vLocalModeloNorm = normalizarTexto(vLocal.model);
      if (vLocalModeloNorm === modeloNorm) return true;

      // 5. Comparação por tokens distintivos do modelo
      const tokensLocal = extrairTokensModelo(vLocal.model);
      const tokensRemoto = extrairTokensModelo(vRemoto.model);

      if (tokensLocal.length > 0 && tokensRemoto.length > 0) {
        // Se ambos têm exatamente os mesmos tokens distintivos
        if (tokensLocal.length === tokensRemoto.length && tokensLocal.every(t => tokensRemoto.includes(t))) {
          return true;
        }
      }

      return false;
    });

    if (matchLocal) {
      // Checa se as especificações técnicas divergem (Bateria, Autonomia, AC ou DC)
      const difBateria = Math.abs((matchLocal.battery || 0) - (vRemoto.battery || 0));
      const difRange = Math.abs((matchLocal.range || 0) - (vRemoto.range || 0));
      const difAc = Math.abs((matchLocal.maxAc || 0) - (vRemoto.maxAc || 0));
      const difDc = Math.abs((matchLocal.maxDc || 0) - (vRemoto.maxDc || 0));

      if (difBateria > 1.0 || difRange > 20 || difAc > 0.1 || difDc > 1.0) {
        // Veículo com dados desatualizados ou incorretos no banco
        const alteracoes = [];
        if (difBateria > 1.0) alteracoes.push(`Bateria: ${matchLocal.battery} ➔ ${vRemoto.battery} kWh`);
        if (difRange > 20) alteracoes.push(`Autonomia: ${matchLocal.range} ➔ ${vRemoto.range} km`);
        if (difAc > 0.1) alteracoes.push(`AC: ${matchLocal.maxAc} ➔ ${vRemoto.maxAc} kW`);
        if (difDc > 1.0) alteracoes.push(`DC: ${matchLocal.maxDc} ➔ ${vRemoto.maxDc} kW`);

        divergentes.push({
          ...vRemoto,
          id: matchLocal.id,
          isDivergencia: true,
          descricaoDivergencia: `Atualizar: ${alteracoes.join(' | ')}`
        });
      } else {
        existentes.push({
          remoto: vRemoto,
          localId: matchLocal.id
        });
      }
    } else {
      novos.push(vRemoto);
    }
  }

  // Lista unificada para o modal: primeiro os novos, seguidos das atualizações recomendadas
  const listaParaApresentacao = [
    ...novos,
    ...divergentes
  ].sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));

  return {
    fonte,
    totalRemoto: veiculosRemotos.length,
    totalExistentes: existentes.length,
    totalNovos: listaParaApresentacao.length,
    novos: listaParaApresentacao
  };
}

/**
 * Importa a lista de veículos selecionados para o banco de dados
 */
async function importarVeiculos(veiculosParaImportar, onProgress) {
  let importados = 0;
  let veiculosImportados = [];
  let erros = [];

  const total = veiculosParaImportar.length;

  for (let i = 0; i < total; i++) {
    const item = veiculosParaImportar[i];
    const percentual = Math.round(((i + 1) / total) * 100);

    try {
      const veiculoId = item.id || gerarIdVeiculo(item.brand, item.model);

      await prisma.veiculo.upsert({
        where: { id: veiculoId },
        update: {
          brand: item.brand,
          model: item.model,
          type: item.type,
          battery: Number(item.battery),
          maxAc: Number(item.maxAc),
          maxDc: Number(item.maxDc),
          range: Number(item.range),
          active: true
        },
        create: {
          id: veiculoId,
          brand: item.brand,
          model: item.model,
          type: item.type,
          battery: Number(item.battery),
          maxAc: Number(item.maxAc),
          maxDc: Number(item.maxDc),
          range: Number(item.range),
          active: true
        }
      });

      importados++;
      veiculosImportados.push({
        id: veiculoId,
        brand: item.brand,
        model: item.model,
        type: item.type,
        battery: Number(item.battery)
      });

      if (onProgress) {
        onProgress({
          index: i + 1,
          total,
          percent: percentual,
          veiculo: `${item.brand} ${item.model}`,
          status: 'sucesso',
          mensagem: `[${i + 1}/${total}] Salvo: ${item.brand} ${item.model} (${item.type} • ${item.battery} kWh • ${item.range} km)`
        });
      }
    } catch (err) {
      erros.push({ veiculo: item, erro: err.message });
      if (onProgress) {
        onProgress({
          index: i + 1,
          total,
          percent: percentual,
          veiculo: `${item.brand} ${item.model}`,
          status: 'erro',
          mensagem: `[${i + 1}/${total}] Erro ao salvar ${item.brand} ${item.model}: ${err.message}`
        });
      }
    }

    await new Promise(r => setTimeout(r, 40));
  }

  return {
    total,
    importados,
    veiculosImportados,
    erros
  };
}

module.exports = {
  verificarNovidades,
  importarVeiculos,
  gerarIdVeiculo,
  calibrarPotenciasRecarga,
  buscarCatalogoCarregados
};
