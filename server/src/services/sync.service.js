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
 * Estima potências máximas de recarga AC e DC baseadas na química, bateria e categoria
 */
function calibrarPotenciasRecarga(tipo, bateria, marca) {
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
    // Baterias grandes em PHEV (30-45 kWh - ex: GWM Haval/Wey, BYD Shark/Song, Jetour)
    return { maxAc: 6.6, maxDc: bat >= 35 ? 50.0 : 30.0 };
  }

  // 100% Elétricos (BEV)
  const isPremiumHighSpeed = ['audi', 'porsche', 'zeekr', 'avatr', 'denza'].some(p => brandNorm.includes(p));

  if (isPremiumHighSpeed) {
    if (bat >= 90) {
      return { maxAc: 22.0, maxDc: 270.0 };
    }
    return { maxAc: 11.0, maxDc: 200.0 };
  }

  if (bat <= 40) {
    return { maxAc: 6.6, maxDc: 40.0 };
  }
  if (bat <= 65) {
    return { maxAc: 7.0, maxDc: 80.0 };
  }
  if (bat <= 85) {
    return { maxAc: 11.0, maxDc: 150.0 };
  }
  return { maxAc: 11.0, maxDc: 200.0 };
}

/**
 * Realiza requisição HTTPS para obter o catálogo do eletricos.app
 */
function baixarCatalogoHtml() {
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
      reject(new Error('Tempo limite de conexão esgotado ao contatar eletricos.app (timeout 15s).'));
    });

    req.on('error', (err) => {
      reject(new Error(`Falha de rede ao conectar com eletricos.app: ${err.message}`));
    });

    req.end();
  });
}

/**
 * Extrai veículos BEV, PHEV e EREV a partir do conteúdo HTML/RSC do eletricos.app
 */
function extrairVeiculosDoHtml(html) {
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

    const anoMatch = trechoCard.match(/<p class="text-muted-foreground text-sm">([0-9]{4})/);
    const ano = anoMatch ? anoMatch[1] : '';

    const precoMatch = trechoCard.match(/<div class="text-2xl font-bold">(R\$[^<]+)<\/div>/);
    const preco = precoMatch ? precoMatch[1].trim() : '';

    const autMatch = trechoCard.match(/Autonomia<\/div><div class="font-bold text-sm ">([0-9]+)\s*km<\/div>/);
    const range = autMatch ? parseInt(autMatch[1], 10) : 0;

    const batMatch = trechoCard.match(/Bateria<\/div><div class="font-bold text-sm ">([0-9]+(?:,[0-9]+)?)\s*kWh<\/div>/);
    const battery = batMatch ? parseFloat(batMatch[1].replace(',', '.')) : 0;

    // Classificação estrita: BEV, PHEV ou REEV (Autonomia Estendida)
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
      slugLower.includes('reev') ||
      modeloLower.includes('erev') ||
      modeloLower.includes('reev')
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
      const potencias = calibrarPotenciasRecarga(tipoPadronizado, battery, marca);
      const idSugerido = slug ? slug.replace(/-/g, '_') : gerarIdVeiculo(marca, modelo);

      veiculos.push({
        id: idSugerido,
        brand: marca,
        model: modelo,
        year: ano,
        type: tipoPadronizado,
        battery: battery || (tipoPadronizado === 'BEV' ? 60 : (tipoPadronizado === 'REEV' || tipoPadronizado === 'EREV' ? 28 : 18)),
        range: range || (tipoPadronizado === 'BEV' ? 300 : (tipoPadronizado === 'REEV' || tipoPadronizado === 'EREV' ? 140 : 60)),
        maxAc: potencias.maxAc,
        maxDc: potencias.maxDc,
        price: preco,
        slug,
        sourceUrl: `https://www.eletricos.app/veiculo/${slug}`
      });
    }
  }

  return veiculos;
}

/**
 * Conjunto de termos de propulsão e conectores genéricos
 * que não devem ser usados sozinhos para associar modelos diferentes.
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
    .filter(t => t.length >= 2 && !TERMOS_PROPULSAO.has(t));
}

/**
 * Compara veículos extraídos com o banco de dados do sistema
 */
async function verificarNovidades() {
  const html = await baixarCatalogoHtml();
  const veiculosRemotos = extrairVeiculosDoHtml(html);

  const veiculosLocais = await prisma.veiculo.findMany();

  const novos = [];
  const existentes = [];

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
        // O identificador base (primeiro termo, ex: 'b10', 'c10', 'dolphin') DEVE coincidir
        if (tokensLocal[0] !== tokensRemoto[0]) {
          return false;
        }

        // Se ambos compartilham o nome base e termos distintivos principais
        const palavrasComuns = tokensRemoto.filter(p => tokensLocal.includes(p));
        const minEsperado = Math.min(tokensLocal.length, tokensRemoto.length);
        if (palavrasComuns.length >= 2 || palavrasComuns.length >= minEsperado) {
          return true;
        }
      }

      return false;
    });

    if (matchLocal) {
      existentes.push({
        remoto: vRemoto,
        localId: matchLocal.id
      });
    } else {
      novos.push(vRemoto);
    }
  }

  return {
    totalRemoto: veiculosRemotos.length,
    totalExistentes: existentes.length,
    totalNovos: novos.length,
    novos: novos.sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model))
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
          mensagem: `[${i + 1}/${total}] Importado: ${item.brand} ${item.model} (${item.type})`
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
          mensagem: `[${i + 1}/${total}] Erro ao importar ${item.brand} ${item.model}: ${err.message}`
        });
      }
    }

    // Pequena pausa assíncrona para permitir emissão fluida de eventos SSE
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
  calibrarPotenciasRecarga
};
