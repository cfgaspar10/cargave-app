const pushService = require('../services/push.service');

/**
 * Retorna a chave pública VAPID para inscrição no PushManager do navegador
 */
async function obterChavePublica(req, res) {
  try {
    const { publicKey } = await pushService.obterChavesVapid();
    return res.json({ publicKey });
  } catch (err) {
    console.error('[NotificacoesController] Erro ao obter chave VAPID:', err);
    return res.status(500).json({ erro: 'Falha ao obter chave pública de notificações.' });
  }
}

/**
 * Registra a inscrição Web Push do dispositivo
 */
async function inscreverDispositivo(req, res) {
  try {
    const { subscription, enviarBoasVindas } = req.body;
    const userAgent = req.headers['user-agent'] || '';

    const sub = subscription || req.body;
    await pushService.salvarInscricao(sub, userAgent);

    if (enviarBoasVindas && sub.endpoint && sub.keys) {
      pushService.enviarParaInscricao(
        {
          endpoint: sub.endpoint,
          p256dh: sub.keys.p256dh,
          auth: sub.keys.auth
        },
        {
          title: '🔔 Notificações Ativadas!',
          body: 'Você receberá avisos quando novos veículos ou atualizações chegarem ao CargaVE.',
          tag: 'cargave-welcome'
        }
      ).catch(err => console.warn('[NotificacoesController] Aviso no push de boas-vindas:', err.message));
    }

    return res.status(201).json({
      sucesso: true,
      mensagem: 'Dispositivo inscrito para notificações com sucesso!'
    });
  } catch (err) {
    console.error('[NotificacoesController] Erro ao inscrever dispositivo:', err);
    return res.status(400).json({
      sucesso: false,
      erro: err.message || 'Falha ao registrar inscrição de notificações.'
    });
  }
}

/**
 * Cancela a inscrição Web Push do dispositivo
 */
async function cancelarInscricao(req, res) {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      return res.status(400).json({ erro: 'Endpoint não informado.' });
    }

    await pushService.removerInscricao(endpoint);
    return res.json({
      sucesso: true,
      mensagem: 'Notificações desativadas para este dispositivo.'
    });
  } catch (err) {
    console.error('[NotificacoesController] Erro ao cancelar inscrição:', err);
    return res.status(500).json({ erro: 'Falha ao cancelar inscrição de notificações.' });
  }
}

/**
 * [Admin] Dispara uma notificação personalizada para todos os inscritos
 */
async function dispararNotificacaoAdmin(req, res) {
  try {
    const { title, body } = req.body;
    if (!title || !body) {
      return res.status(400).json({ erro: 'Informe título e mensagem para a notificação.' });
    }

    const resultado = await pushService.enviarNotificacaoParaTodos({
      title: String(title).trim(),
      body: String(body).trim(),
      tag: 'cargave-admin-broadcast'
    });

    return res.json({
      sucesso: true,
      mensagem: `Notificação enviada para ${resultado.enviados} de ${resultado.total} dispositivos ativos.`,
      resultado
    });
  } catch (err) {
    console.error('[NotificacoesController] Erro ao disparar notificação admin:', err);
    return res.status(500).json({ erro: 'Falha ao disparar notificações push.' });
  }
}

module.exports = {
  obterChavePublica,
  inscreverDispositivo,
  cancelarInscricao,
  dispararNotificacaoAdmin
};
