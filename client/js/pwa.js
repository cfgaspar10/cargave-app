// ==============================================================================
// CargaVE - Integração PWA no Frontend
// Registro de Service Worker, Prompt de Instalação e Notificações Web Push
// Suporte Completo: Android, Apple (iOS/iPadOS/macOS) e Desktop
// Compatível com Raiz (PROD) e Subcaminhos de Proxy Reverso (HML /app-hml e /app)
// ==============================================================================

(function () {
  'use strict';

  let deferredInstallPrompt = null;
  let swRegistration = null;

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
    const btn = document.getElementById('btn-notificacoes-pwa');
    if (!btn) return;

    if (inscrito) {
      btn.textContent = '🔔';
      btn.classList.add('is-subscribed');
      btn.title = 'Notificações ativas! Toque para gerenciar ou desativar';
    } else {
      btn.textContent = '🔕';
      btn.classList.remove('is-subscribed');
      btn.title = 'Ativar notificações de novos veículos e atualizações';
    }
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

      // Se o usuário já havia concedido permissão antes de existir VAPID, inscreve automaticamente
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

  // 3. Captura do Evento de Instalação PWA (Chrome, Edge, Samsung Internet, Android, Desktop)
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstallPrompt = e;
    console.log('[CargaVE PWA] Evento beforeinstallprompt capturado. App instalável!');
    atualizarBotoesInstalacao(true);
  });

  // 4. Inicialização de Interface
  document.addEventListener('DOMContentLoaded', () => {
    const basePath = getContextBasePath();

    // Atualiza link do manifest dinamicamente se necessário para subcaminho
    if (basePath) {
      const manifestLink = document.querySelector('link[rel="manifest"]');
      if (manifestLink) {
        manifestLink.href = basePath + '/manifest.json';
      }
    }

    if (!isStandalone()) {
      // Se for dispositivo móvel ou iOS, mantém a opção de instalar visível
      if (isIOS() || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
        atualizarBotoesInstalacao(true);
      }
    } else {
      atualizarBotoesInstalacao(false);
    }

    // Vincula clique ao botão de instalar do cabeçalho se existir
    const btnInstalar = document.getElementById('btn-instalar-pwa-header');
    if (btnInstalar) {
      btnInstalar.addEventListener('click', window.instalarPWA);
    }

    // Vincula clique ao botão de notificações no cabeçalho
    const btnNotificacoes = document.getElementById('btn-notificacoes-pwa');
    if (btnNotificacoes) {
      btnNotificacoes.addEventListener('click', window.alternarNotificacoesPush);
    }
  });

  // 5. Ação de Instalar PWA
  window.instalarPWA = async function () {
    // Caso Android / Chrome / Edge / Desktop PWA com evento nativo capturado
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      console.log(`[CargaVE PWA] Resposta da instalação: ${outcome}`);
      if (outcome === 'accepted') {
        deferredInstallPrompt = null;
        atualizarBotoesInstalacao(false);
      }
      return;
    }

    // Caso Apple iOS (Safari)
    if (isIOS()) {
      alert('Para instalar o CargaVE no seu iPhone ou iPad:\n\n1. Toque no botão "Compartilhar" (ícone com quadrado e seta para cima ⎋ na barra do Safari);\n2. Role as opções e selecione "Adicionar à Tela de Início" ➕;\n3. Toque em "Adicionar" no canto superior direito.');
      return;
    }

    // Se já estiver em modo standalone
    if (isStandalone()) {
      alert('O CargaVE já está instalado e rodando como aplicativo em seu dispositivo!');
      return;
    }

    // Caso Android Chrome sem prompt automático disparado de imediato
    if (/Android/i.test(navigator.userAgent)) {
      alert('Para instalar o CargaVE no Android:\n\n1. Toque no menu de três pontos (⋮) no canto superior do navegador;\n2. Selecione a opção "Instalar aplicativo" ou "Adicionar à tela inicial".');
      return;
    }

    // Caso Desktop
    alert('Para instalar no Desktop:\n\nClique no ícone de instalação (computador com seta para baixo ⬇️) localizado no lado direito da barra de endereços do seu navegador (Google Chrome ou Microsoft Edge).');
  };

  // 6. Confirmação de Instalação Realizada
  window.addEventListener('appinstalled', () => {
    console.log('[CargaVE PWA] Aplicativo instalado com êxito!');
    deferredInstallPrompt = null;
    atualizarBotoesInstalacao(false);
  });

  // 7. Ativação e Gerenciamento de Notificações Web Push
  window.alternarNotificacoesPush = async function () {
    if (isIOS() && !isStandalone()) {
      alert('Para receber notificações no iPhone ou iPad:\n\n1. Primeiro adicione o CargaVE à Tela de Início (botão Compartilhar ⎋ -> "Adicionar à Tela de Início" ➕);\n2. Abra o aplicativo instalado pela Tela de Início;\n3. Toque neste ícone de sino 🔕 para ativar os alertas.');
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

      // Se já estiver inscrito, oferece opção de desativar
      if (currentSub) {
        const desejaDesativar = confirm('As notificações de novos veículos e atualizações já estão ATIVAS neste dispositivo.\n\nDeseja desativar as notificações?');
        if (!desejaDesativar) return true;

        const endpoint = currentSub.endpoint;
        await currentSub.unsubscribe();
        if (window.EV_API) {
          await window.EV_API.cancelarNotificacoes(endpoint).catch(() => {});
        }
        atualizarEstadoBotaoNotificacao(false);
        exibirToastPWA('🔕 Notificações desativadas neste dispositivo.');
        return false;
      }

      // Solicita permissão do sistema operacional / navegador
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
      exibirToastPWA('🔔 Notificações ativadas com sucesso!');
      return true;
    } catch (err) {
      console.error('[CargaVE PWA] Erro ao configurar notificações push:', err);
      alert('Não foi possível ativar as notificações: ' + (err.message || 'Erro inesperado.'));
      return false;
    }
  };

  window.solicitarPermissaoNotificacoes = window.alternarNotificacoesPush;
})();
