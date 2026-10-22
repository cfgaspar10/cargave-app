const express = require('express');
const router = express.Router();
const notificacoesController = require('../controllers/notificacoes.controller');
const authAdmin = require('../middlewares/authAdmin');

// Rotas públicas para gerenciamento de inscrição do usuário
router.get('/vapid-public-key', notificacoesController.obterChavePublica);
router.post('/inscrever', notificacoesController.inscreverDispositivo);
router.post('/cancelar', notificacoesController.cancelarInscricao);

// Rota administrativa para disparo manual de comunicados/atualizações
router.post('/disparar', authAdmin, notificacoesController.dispararNotificacaoAdmin);

module.exports = router;
