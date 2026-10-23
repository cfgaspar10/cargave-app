// ==============================================================================
// CargaVE - Integração PWA e Central de Notificações no Frontend
// Registro de Service Worker, Prompt de Instalação e Notificações Web Push
// Suporte Completo: Android, Apple (iOS/iPadOS/macOS) e Desktop
// Compatível com Raiz (PROD) e Subcaminhos de Proxy Reverso (HML /app-hml e /app)
// ==============================================================================

(function () {
  'use strict';

  let deferredInstallPrompt = null;
  let swRegistration = null;
  let isDevicePushSubscribed = false;
  let cachedNotifications = [];

  const LAST_SEEN_KEY = 'ev_last_seen_notif_id';

  function getContextBasePath() {
    if (window.location.pathname.startsWith('/cargave-hml')) return '/cargave-hml';
    if (window.location.pathname.startsWith('/cargave')) return '/cargave';
    if (window.location.pathname.startsWith('/kwhub-hml')) return '/kwhub-hml';
    if (window.location.pathname.startsWith('/kwhub')) return '/kwhub';
    if (window.location.pathname.startsWith('/ev-calculator')) return '/ev-calculator';
    if (window.location.pathname.startsWith('/app-hml')) return '/app-hml';
    if (window.location.pathname.startsWith('/app')) return '/app';
    const redirect = new URLSearchParams(window.location.search).get('redirect');
    if (redirect && redirect.startsWith('/cargave-hml')) return '/cargave-hml';
    if (redirect && redirect.startsWith('/cargave')) return '/cargave';
    if (redirect && redirect.startsWith('/kwhub-hml')) return '/kwhub-hml';
    if (redirect && redirect.startsWith('/kwhub')) return '/kwhub';
    if (redirect && redirect.startsWith('/ev-calculator')) return '/ev-calculator';
    if (redirect && redirect.startsWith('/app-hml')) return '/app-hml';
    if (redirect && redirect.startsWith('/app')) return '/app';
    return '';
  }

  function exibirToastPWA(mensagem) {
    const toastEl = document.getElementById('app-toast');
    if (!toastEl) return;
    toastEl.textContent = mensagem;
    toastEl.classList.add('visible');
    setTimeout(() => {
      toastEl.classList.remove('visible');
    }, 3800);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatarDataNotificacao(isoDate) {
    if (!isoDate) return '';
    try {
      const dt = new Date(isoDate);
      return dt.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return '';
    }
  }

  function obterLabelTipo(type) {
    switch (String(type || '').toUpperCase()) {
      case 'NOVO_VEICULO':
        return '🚗 Novo Veículo';
      case 'SYNC':
        return '🔄 Catálogo';
      case 'VERSAO':
        return '⚡ Atualização';
      case 'COMUNICADO':
        return '📣 Comunicado';
      default:
        return '🔔 Aviso';
    }
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  function atualizarBotoesInstalacao(visivel) {
    const ids = ['btn-instalar-pwa', 'btn-instalar-pwa-header'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.style.display = visivel ? 'inline-flex' : 'none';
      }
    });
  }

  function atualizarEstadoBotaoNotificacao(inscrito) {
    isDevicePushSubscribed = Boolean(inscrito);
    const btn = document.getElementById('btn-notificacoes-pwa');
    const bellIcon = document.getElementById('notif-bell-icon');
    const statusCard = document.getElementById('notif-push-status-card');
    const statusTitle = document.getElementById('notif-push-status-title');
    const statusDesc = document.getElementById('notif-push-status-desc');
    const btnToggleModal = document.getElementById('btn-toggle-push-modal');

    if (btn) {
      if (inscrito) {
        btn.classList.add('is-subscribed');
        btn.title = 'Central de Notificações (Alertas Push ativos)';
      } else {
        btn.classList.remove('is-subscribed');
        btn.title = 'Central de Notificações (Alertas Push desativados)';
      }
    }

    if (bellIcon) {
      bellIcon.textContent = inscrito ? '🔔' : '🔕';
    }

    if (statusCard && statusTitle && statusDesc && btnToggleModal) {
      if (inscrito) {
        statusCard.classList.add('is-active');
        statusTitle.textContent = '🟢 Alertas Push ativos neste aparelho';
        statusDesc.textContent = 'Você recebe avisos no sistema mesmo quando o aplicativo está fechado.';
        btnToggleModal.textContent = '🔕 Desativar';
        btnToggleModal.className = 'btn-secondary notif-push-action-btn is-unsubscribe';
      } else {
        statusCard.classList.remove('is-active');
        statusTitle.textContent = '🔕 Alertas Push desativados neste aparelho';
        statusDesc.textContent = 'Ative para receber avisos no celular ou computador assim que novos carros ou atualizações saírem.';
        btnToggleModal.textContent = '🔔 Ativar Alertas';
        btnToggleModal.className = 'btn-primary notif-push-action-btn';
      }
    }
  }

  function atualizarBadgeNaoLidas(lista) {
    const badgeEl = document.getElementById('notif-unread-badge');
    if (!badgeEl) return;

    const lastSeenId = parseInt(localStorage.getItem(LAST_SEEN_KEY) || '0', 10) || 0;
    const naoLidas = (lista || []).filter(item => Number(item.id) > lastSeenId).length;

    if (naoLidas > 0) {
      badgeEl.textContent = naoLidas > 9 ? '9+' : String(naoLidas);
      badgeEl.classList.remove('hidden');
    } else {
      badgeEl.classList.add('hidden');
    }
  }

  async function carregarHistoricoNotificacoes(marcarComoLidas = false) {
    if (!window.EV_API || !window.EV_API.listarHistoricoNotificacoes) return;
    try {
      const res = await window.EV_API.listarHistoricoNotificacoes(35);
      cachedNotifications = (res && Array.isArray(res.notificacoes)) ? res.notificacoes : [];

      const lastSeenBefore = parseInt(localStorage.getItem(LAST_SEEN_KEY) || '0', 10) || 0;
      renderizarListaHistorico(cachedNotifications, lastSeenBefore);

      if (marcarComoLidas && cachedNotifications.length > 0) {
        const maxId = Math.max(...cachedNotifications.map(n => Number(n.id) || 0));
        if (maxId > lastSeenBefore) {
          localStorage.setItem(LAST_SEEN_KEY, String(maxId));
        }
        atualizarBadgeNaoLidas([]);
      } else {
        atualizarBadgeNaoLidas(cachedNotifications);
      }
    } catch (err) {
      console.warn('[CargaVE PWA] Aviso ao carregar histórico de notificações:', err.message);
    }
  }

  function renderizarListaHistorico(lista, lastSeenId) {
    const listEl = document.getElementById('notif-history-list');
    if (!listEl) return;

    if (!lista || lista.length === 0) {
      listEl.innerHTML = '<div class="notif-empty-state">Nenhuma notificação registrada até o momento.</div>';
      return;
    }

    const isAdmin = Boolean(window.EV_API && window.EV_API.hasAdminKey && window.EV_API.hasAdminKey());

    listEl.innerHTML = lista.map(item => {
      const isUnread = Number(item.id) > lastSeenId;
      const typeCode = escapeHtml(item.type || 'INFO');
      const labelTipo = obterLabelTipo(item.type);
      const dataStr = formatarDataNotificacao(item.createdAt);
      const vehicleIds = String(item.vehicleId || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      let botoesVeiculosHtml = '';
      if (vehicleIds.length === 1) {
        const vObj = window.obterVeiculoPorId ? window.obterVeiculoPorId(vehicleIds[0]) : null;
        const txtBtn = vObj
          ? `🚗 Selecionar ${escapeHtml(vObj.brand + ' ' + vObj.model)} na calculadora →`
          : '🚗 Selecionar veículo na calculadora →';
        botoesVeiculosHtml = `
          <div class="notif-vehicles-btns-row">
            <button type="button" class="notif-vehicle-link-btn" data-select-vehicle="${escapeHtml(vehicleIds[0])}">${txtBtn}</button>
          </div>
        `;
      } else if (vehicleIds.length > 1) {
        const pillsHtml = vehicleIds.map(vId => {
          const vObj = window.obterVeiculoPorId ? window.obterVeiculoPorId(vId) : null;
          const label = vObj ? `${vObj.brand} ${vObj.model}` : vId;
          return `<button type="button" class="notif-vehicle-link-btn" data-select-vehicle="${escapeHtml(vId)}">🚗 ${escapeHtml(label)} →</button>`;
        }).join('');
        botoesVeiculosHtml = `<div class="notif-vehicles-btns-row">${pillsHtml}</div>`;
      }

      return `
        <div class="notif-history-item ${isUnread ? 'is-unread' : ''}" data-notif-id="${item.id}">
          <div class="notif-item-top">
            <span class="notif-type-badge type-${typeCode}">${labelTipo}</span>
            <div class="notif-item-meta">
              <span class="notif-item-date">${escapeHtml(dataStr)}</span>
              ${isAdmin ? `<button type="button" class="notif-delete-btn" data-del-notif="${item.id}" title="Excluir do histórico (Admin)">🗑️</button>` : ''}
            </div>
          </div>
          <div class="notif-item-title">${escapeHtml(item.title)}</div>
          <div class="notif-item-body">${escapeHtml(item.body)}</div>
          ${botoesVeiculosHtml}
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('[data-select-vehicle]').forEach(btn => {
      btn.addEventListener('click', function () {
        const vId = this.getAttribute('data-select-vehicle');
        if (window.selecionarVeiculoPorId && window.selecionarVeiculoPorId(vId)) {
          fecharModalCentralNotificacoes();
        } else {
          exibirToastPWA('Veículo não encontrado no catálogo ativo.');
        }
      });
    });

    listEl.querySelectorAll('[data-del-notif]').forEach(btn => {
      btn.addEventListener('click', async function () {
        const notifId = this.getAttribute('data-del-notif');
        if (!confirm('Deseja remover este aviso do histórico de notificações?')) return;
        try {
          await window.EV_API.excluirHistoricoNotificacao(notifId);
          await carregarHistoricoNotificacoes(true);
          exibirToastPWA('🗑️ Notificação removida do histórico.');
        } catch (err) {
          alert('Erro ao remover notificação: ' + err.message);
        }
      });
    });
  }

  function abrirModalCentralNotificacoes() {
    const modal = document.getElementById('modal-central-notificacoes');
    if (!modal) return;
    modal.classList.add('active');
    carregarHistoricoNotificacoes(true);
  }

  function fecharModalCentralNotificacoes() {
    const modal = document.getElementById('modal-central-notificacoes');
    if (!modal) return;
    modal.classList.remove('active');
  }

  // 1. Detecção de Plataforma
  const isIOS = () => {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  };

  const isStandalone = () => {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true ||
           document.referrer.includes('android-app://');
  };

  // Sincroniza inscrição existente ou cria inscrição se permissão já foi concedida anteriormente
  async function sincronizarInscricaoPush(registration) {
    if (!registration || !('pushManager' in registration) || !window.EV_API) return;

    try {
      const existingSub = await registration.pushManager.getSubscription();
      if (existingSub) {
        atualizarEstadoBotaoNotificacao(true);
        await window.EV_API.inscreverNotificacoes(existingSub.toJSON(), false);
        return;
      }

      if ('Notification' in window && Notification.permission === 'granted') {
        const { publicKey } = await window.EV_API.obterChaveVapid();
        if (publicKey) {
          const newSub = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey)
          });
          await window.EV_API.inscreverNotificacoes(newSub.toJSON(), false);
          atualizarEstadoBotaoNotificacao(true);
          return;
        }
      }

      atualizarEstadoBotaoNotificacao(false);
    } catch (err) {
      console.warn('[CargaVE PWA] Aviso ao sincronizar inscrição push:', err.message);
    }
  }

  // 2. Registro do Service Worker com escopo dinâmico
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      const basePath = getContextBasePath();
      const swUrl = (basePath || '') + '/sw.js';
      const swOptions = basePath ? { scope: basePath + '/' } : {};

      carregarHistoricoNotificacoes(false);

      // Se abriu a partir do clique em uma notificação push (?notificacoes=1), abre a Central automaticamente
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('notificacoes') === '1') {
        abrirModalCentralNotificacoes();
        if (window.history && window.history.replaceState) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }

      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data && event.data.type === 'OPEN_NOTIFICATIONS_CENTER') {
          abrirModalCentralNotificacoes();
        }
      });

      navigator.serviceWorker.register(swUrl, swOptions)
        .then(registration => {
          swRegistration = registration;
          console.log('[CargaVE PWA] Service Worker ativo com escopo:', registration.scope);

          sincronizarInscricaoPush(registration);

          registration.onupdatefound = () => {
            const installingWorker = registration.installing;
            if (installingWorker) {
              installingWorker.onstatechange = () => {
                if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  console.log('[CargaVE PWA] Nova versão do app instalada em segundo plano.');
                  exibirToastPWA('⚡ CargaVE atualizado para a versão mais recente!');
                }
              };
            }
          };
        })
        .catch(error => {
          console.warn('[CargaVE PWA] Aviso ao registrar Service Worker:', error);
        });
    });
  }

  // 3. Captura do Evento de Instalação PWA
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstallPrompt = e;
    atualizarBotoesInstalacao(true);
  });

  // 4. Inicialização de Interface e Eventos da Central de Notificações
  document.addEventListener('DOMContentLoaded', () => {
    const basePath = getContextBasePath();

    if (basePath) {
      const manifestLink = document.querySelector('link[rel="manifest"]');
      if (manifestLink) {
        manifestLink.href = basePath + '/manifest.json';
      }
    }

    if (!isStandalone()) {
      if (isIOS() || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
        atualizarBotoesInstalacao(true);
      }
    } else {
      atualizarBotoesInstalacao(false);
    }

    const btnInstalar = document.getElementById('btn-instalar-pwa-header');
    if (btnInstalar) {
      btnInstalar.addEventListener('click', window.instalarPWA);
    }

    // Botão do sino abre a Central de Notificações
    const btnNotificacoes = document.getElementById('btn-notificacoes-pwa');
    if (btnNotificacoes) {
      btnNotificacoes.addEventListener('click', abrirModalCentralNotificacoes);
    }

    const btnCloseModal = document.getElementById('close-central-notificacoes-modal');
    if (btnCloseModal) {
      btnCloseModal.addEventListener('click', fecharModalCentralNotificacoes);
    }

    const modalCentral = document.getElementById('modal-central-notificacoes');
    if (modalCentral) {
      modalCentral.addEventListener('click', function (e) {
        if (e.target === modalCentral) {
          fecharModalCentralNotificacoes();
        }
      });
    }

    const btnTogglePushModal = document.getElementById('btn-toggle-push-modal');
    if (btnTogglePushModal) {
      btnTogglePushModal.addEventListener('click', window.alternarNotificacoesPush);
    }

    // Bloco Admin: expandir/recolher e enviar comunicado
    const btnToggleAdminBroadcast = document.getElementById('btn-toggle-admin-broadcast');
    const formAdminBroadcast = document.getElementById('form-admin-broadcast');
    const chevronAdmin = document.getElementById('notif-admin-chevron');

    if (btnToggleAdminBroadcast && formAdminBroadcast) {
      btnToggleAdminBroadcast.addEventListener('click', () => {
        const isHidden = formAdminBroadcast.classList.toggle('hidden');
        if (chevronAdmin) chevronAdmin.textContent = isHidden ? '▼' : '▲';
      });
    }

    if (formAdminBroadcast) {
      formAdminBroadcast.addEventListener('submit', async (e) => {
        e.preventDefault();
        const titleInput = document.getElementById('admin-broadcast-title');
        const bodyInput = document.getElementById('admin-broadcast-body');
        const submitBtn = document.getElementById('btn-submit-admin-broadcast');
        if (!titleInput || !bodyInput) return;

        const title = titleInput.value.trim();
        const body = bodyInput.value.trim();
        if (!title || !body) return;

        try {
          if (submitBtn) submitBtn.disabled = true;
          const res = await window.EV_API.dispararNotificacaoAdmin(title, body);
          titleInput.value = '';
          bodyInput.value = '';
          formAdminBroadcast.classList.add('hidden');
          if (chevronAdmin) chevronAdmin.textContent = '▼';
          await carregarHistoricoNotificacoes(true);
          exibirToastPWA(res.mensagem || '🚀 Comunicado disparado com sucesso!');
        } catch (err) {
          alert('Erro ao disparar comunicado: ' + err.message);
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }
  });

  // 5. Ação de Instalar PWA
  window.instalarPWA = async function () {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') {
        deferredInstallPrompt = null;
        atualizarBotoesInstalacao(false);
      }
      return;
    }

    if (isIOS()) {
      alert('Para instalar o CargaVE no seu iPhone ou iPad:\n\n1. Toque no botão "Compartilhar" (ícone com quadrado e seta para cima ⎋ na barra do Safari);\n2. Role as opções e selecione "Adicionar à Tela de Início" ➕;\n3. Toque em "Adicionar" no canto superior direito.');
      return;
    }

    if (isStandalone()) {
      alert('O CargaVE já está instalado e rodando como aplicativo em seu dispositivo!');
      return;
    }

    if (/Android/i.test(navigator.userAgent)) {
      alert('Para instalar o CargaVE no Android:\n\n1. Toque no menu de três pontos (⋮) no canto superior do navegador;\n2. Selecione a opção "Instalar aplicativo" ou "Adicionar à tela inicial".');
      return;
    }

    alert('Para instalar no Desktop:\n\nClique no ícone de instalação (computador com seta para baixo ⬇️) localizado no lado direito da barra de endereços do seu navegador (Google Chrome ou Microsoft Edge).');
  };

  // 6. Confirmação de Instalação Realizada
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    atualizarBotoesInstalacao(false);
  });

  // 7. Ativação e Desativação de Notificações Web Push
  window.alternarNotificacoesPush = async function () {
    if (isIOS() && !isStandalone()) {
      alert('Para receber notificações Push no iPhone ou iPad:\n\n1. Primeiro adicione o CargaVE à Tela de Início (botão Compartilhar ⎋ -> "Adicionar à Tela de Início" ➕);\n2. Abra o aplicativo instalado pela Tela de Início;\n3. Abra a Central de Notificações (🔔) e toque em "Ativar Alertas".');
      return false;
    }

    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      alert('Seu navegador ou dispositivo não suporta notificações Web Push.');
      return false;
    }

    try {
      const registration = swRegistration || await navigator.serviceWorker.ready;
      if (!registration || !('pushManager' in registration)) {
        alert('O gerenciador de notificações Push não está disponível neste navegador.');
        return false;
      }

      const currentSub = await registration.pushManager.getSubscription();

      if (currentSub) {
        const endpoint = currentSub.endpoint;
        await currentSub.unsubscribe();
        if (window.EV_API) {
          await window.EV_API.cancelarNotificacoes(endpoint).catch(() => {});
        }
        atualizarEstadoBotaoNotificacao(false);
        exibirToastPWA('🔕 Alertas Push desativados neste dispositivo.');
        return false;
      }

      if (Notification.permission === 'denied') {
        alert('As notificações estão bloqueadas nas configurações do seu navegador/celular.\n\nAcesse as permissões do site/aplicativo no seu aparelho e permita "Notificações".');
        return false;
      }

      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();

      if (permission !== 'granted') {
        exibirToastPWA('Permissão de notificações não concedida.');
        return false;
      }

      const { publicKey } = await window.EV_API.obterChaveVapid();
      if (!publicKey) {
        throw new Error('Chave VAPID não disponível no servidor.');
      }

      const newSub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });

      await window.EV_API.inscreverNotificacoes(newSub.toJSON(), true);
      atualizarEstadoBotaoNotificacao(true);
      exibirToastPWA('🔔 Alertas Push ativados com sucesso!');
      return true;
    } catch (err) {
      console.error('[CargaVE PWA] Erro ao configurar notificações push:', err);
      alert('Não foi possível ativar as notificações: ' + (err.message || 'Erro inesperado.'));
      return false;
    }
  };

  window.solicitarPermissaoNotificacoes = window.alternarNotificacoesPush;
  window.recarregarCentralNotificacoes = () => carregarHistoricoNotificacoes(false);
})();
