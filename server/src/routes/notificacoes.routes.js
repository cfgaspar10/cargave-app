const express = require('express');
const router = express.Router();
const notificacoesController = require('../controllers/notificacoes.controller');
const authAdmin = require('../middlewares/authAdmin');

// Rotas públicas para gerenciamento de inscrição e histórico do usuário
router.get('/vapid-public-key', notificacoesController.obterChavePublica);
router.get('/historico', notificacoesController.listarHistorico);
router.post('/inscrever', notificacoesController.inscreverDispositivo);
router.post('/cancelar', notificacoesController.cancelarInscricao);

// Rotas administrativas para disparo manual e gestão de histórico
router.post('/disparar', authAdmin, notificacoesController.dispararNotificacaoAdmin);
router.delete('/historico/:id', authAdmin, notificacoesController.excluirHistorico);

module.exports = router;
