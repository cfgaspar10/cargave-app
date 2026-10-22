const syncService = require('../services/sync.service');
const pushService = require('../services/push.service');

/**
 * Controller responsável pela sincronização do catálogo externo
 */
class SyncController {
  /**
   * Varre o catálogo remoto e compara com o banco de dados
   */
  async verificar(req, res) {
    try {
      const resultado = await syncService.verificarNovidades();
      return res.json({
        sucesso: true,
        totalRemoto: resultado.totalRemoto,
        totalExistentes: resultado.totalExistentes,
        totalNovos: resultado.totalNovos,
        novos: resultado.novos
      });
    } catch (err) {
      console.error('Erro ao verificar catálogo remoto:', err);
      return res.status(500).json({
        sucesso: false,
        erro: 'Falha ao consultar fonte externa eletricos.app: ' + err.message
      });
    }
  }

  /**
   * Executa a importação dos modelos selecionados emitindo progresso em tempo real via SSE
   */
  async executar(req, res) {
    const { veiculos } = req.body;

    if (!Array.isArray(veiculos) || veiculos.length === 0) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Nenhum veículo selecionado para importação.'
      });
    }

    // Configura resposta SSE (Server-Sent Events)
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Desativa buffering no Nginx
    if (res.flushHeaders) res.flushHeaders();

    const enviarSSE = (tipo, payload) => {
      res.write(`event: ${tipo}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    enviarSSE('inicio', {
      total: veiculos.length,
      mensagem: `Iniciando importação de ${veiculos.length} veículos...`
    });

    try {
      const resultado = await syncService.importarVeiculos(veiculos, (progresso) => {
        enviarSSE('progresso', progresso);
      });

      if (resultado.importados > 0) {
        const pushTitle = resultado.importados === 1
          ? '🚗 Novo veículo no CargaVE!'
          : `🚗 ${resultado.importados} novos veículos no CargaVE!`;
        const pushBody = resultado.importados === 1
          ? `${veiculos[0].brand} ${veiculos[0].model} (${veiculos[0].type} • ${veiculos[0].battery} kWh) foi adicionado ao catálogo!`
          : `O catálogo acaba de ser atualizado com ${resultado.importados} novos modelos elétricos e híbridos. Confira!`;

        pushService.enviarNotificacaoParaTodos({
          title: pushTitle,
          body: pushBody,
          type: 'SYNC',
          vehicleId: resultado.importados === 1 ? (veiculos[0].id || null) : null,
          tag: `sync-veiculos-${Date.now()}`
        }).catch(err => console.warn('[SyncController] Aviso ao enviar push de sincronização:', err.message));
      }

      enviarSSE('fim', {
        sucesso: true,
        importados: resultado.importados,
        total: resultado.total,
        erros: resultado.erros,
        mensagem: `Sincronização concluída! ${resultado.importados} veículos importados com sucesso.`
      });
      res.end();
    } catch (err) {
      enviarSSE('erro', {
        sucesso: false,
        mensagem: 'Erro durante a importação: ' + err.message
      });
      res.end();
    }
  }
}

module.exports = new SyncController();
