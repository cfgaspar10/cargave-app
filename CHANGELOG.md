# Changelog

## [1.3.1](https://github.com/cfgaspar10/cargave-app/compare/cargave-v1.3.0...cargave-v1.3.1) (2026-10-23)


### 🐛 Correções de Bugs

* **pwa:** corrige redirecionamento do clique na notificação Push para o escopo /cargave/ ([d277608](https://github.com/cfgaspar10/cargave-app/commit/d27760830ef2191a6162e0e4c81740c7360ef057))


### 🔧 Tarefas e Manutenção

* **release:** atualizar badge da interface para v1.3.0 [skip ci] ([f3f7cdd](https://github.com/cfgaspar10/cargave-app/commit/f3f7cdd2d2193b66d0f227492e28e92c2af0893a))

## [1.3.0](https://github.com/cfgaspar10/cargave-app/compare/cargave-v1.2.0...cargave-v1.3.0) (2026-10-23)


### ✨ Novas Funcionalidades

* **pwa:** adiciona Central de Notificações com histórico, badge de não lidas e painel de comunicados ([f2c0d57](https://github.com/cfgaspar10/cargave-app/commit/f2c0d57a8d8b689ef9a4c95eaa232164b38a5054))
* **pwa:** detalha modelos e adiciona botões individuais em notificações com múltiplos veículos ([3714c86](https://github.com/cfgaspar10/cargave-app/commit/3714c866e1ec25eeccd4e2cbef242b938c142210))
* **pwa:** implementa sistema completo de notificações Web Push para novos veículos e atualizações ([ee0ae3b](https://github.com/cfgaspar10/cargave-app/commit/ee0ae3bc073ce8465d47c751893c5bfbdc47a13e))


### 🔧 Tarefas e Manutenção

* **release:** atualizar badge da interface para v1.2.0 [skip ci] ([f849bc2](https://github.com/cfgaspar10/cargave-app/commit/f849bc29fc2f080ea2ae310d7d9d14eae77b150d))

## [1.2.0](https://github.com/cfgaspar10/cargave-app/compare/cargave-v1.1.0...cargave-v1.2.0) (2026-10-22)


### ✨ Novas Funcionalidades

* **ui:** aprimora navegação de marcas no desktop e prioriza montadoras populares ([49a4f4d](https://github.com/cfgaspar10/cargave-app/commit/49a4f4d2ab0463a3e21be601715155b8b42683c6))


### 🔧 Tarefas e Manutenção

* **release:** atualizar badge da interface para v1.1.0 [skip ci] ([43dcd85](https://github.com/cfgaspar10/cargave-app/commit/43dcd855a0256ef54506228448e81e72269ae5d8))

## [1.1.0](https://github.com/cfgaspar10/cargave-app/compare/cargave-v1.0.0...cargave-v1.1.0) (2026-10-17)


### ✨ Novas Funcionalidades

* add tab navigation and trip consumption calculator with charging stops support ([1735098](https://github.com/cfgaspar10/cargave-app/commit/173509824ba889620d458bd52c15a3aa3ad31401))
* **backup:** adicionar script de backup automatizado do PostgreSQL com retencao de 15 dias ([b791365](https://github.com/cfgaspar10/cargave-app/commit/b7913659472d62c38caff08008dec71022cccff9))
* **brand:** adotar identidade CargaVE e implementar versionamento semântico automatizado ([fcfe2ae](https://github.com/cfgaspar10/cargave-app/commit/fcfe2aee48b3dd72aee71e3c57e1ea46dd28a1ce))
* **brand:** adotar identidade visual kWhub e atualizar repositorio remoto ([411ff02](https://github.com/cfgaspar10/cargave-app/commit/411ff0263e2055534a0df17688b70968c77e1621))
* **brand:** adotar identidade visual kWhub e atualizar repositorio remoto ([493dd1e](https://github.com/cfgaspar10/cargave-app/commit/493dd1e9846bcd39082a9d89eb2fb1f58df67753))
* desacoplar frontend, implementar backend express com prisma e container docker na porta 3001 ([6306ada](https://github.com/cfgaspar10/cargave-app/commit/6306ada053a616a0ea98006c982c780d2bfbe913))
* **infra:** preparar suporte a subcaminhos proxy, compose flexivel e workflow de deploy ([04a3e27](https://github.com/cfgaspar10/cargave-app/commit/04a3e27dbc7b04c708c928eb34c1f36544e23944))
* **pwa:** preparar aplicacao para PWA com suporte offline e instalacao nativa ([6f0e1ab](https://github.com/cfgaspar10/cargave-app/commit/6f0e1ab972fcfc8cb7f334b119ef375f6f022741))
* **pwa:** preparar aplicacao para PWA com suporte offline e instalacao nativa ([a5f7490](https://github.com/cfgaspar10/cargave-app/commit/a5f7490ac5589dd606307614c80d53959f20bb17))
* **solicitacoes:** adiciona fluxo de sugestão de veículos, triagem admin e notificações por e-mail ([1ff02d0](https://github.com/cfgaspar10/cargave-app/commit/1ff02d0c3697f0001f33498bfded532a54be32e8))
* **sync:** adiciona suporte ao tipo REEV e sincronização de autonomia estendida ([5bc0ca8](https://github.com/cfgaspar10/cargave-app/commit/5bc0ca856f10261f1e407b5d526b6ffe5d12b656))
* **sync:** implementa sincronizacao web de catalogo com eletricos.app e progresso em tempo real ([b3aeda5](https://github.com/cfgaspar10/cargave-app/commit/b3aeda5e6c2fec0b2f9de3b88ca318cf22839c50))
* **ui:** adicionar link do repositorio GitHub no rodape da aplicacao ([6639019](https://github.com/cfgaspar10/cargave-app/commit/66390198b310bd45f71b951c4bb96a9ec629a56b))
* **ui:** otimizar presets de carregador, selecao de veiculo e carga alvo de 90% ([f3a0783](https://github.com/cfgaspar10/cargave-app/commit/f3a078318d1471c78ab1c5e70b7ddddd99b7d598))
* **veículo:** adicionar opção de zerar/limpar veículo selecionado, filtros e padrões ([2aec4f5](https://github.com/cfgaspar10/cargave-app/commit/2aec4f542c4070b3678377ac496af643279e2218))
* **veiculo:** implementar recurso de salvar meu veiculo offline com atalho rapido ([f52f3fe](https://github.com/cfgaspar10/cargave-app/commit/f52f3fe70b13197ddfa07fb31a8886eaefdfbdd5))
* **veiculos:** adiciona autenticação de admin, CRUD completo e gestão de inativos ([ecca722](https://github.com/cfgaspar10/cargave-app/commit/ecca72274e3089af4d1d28b4e1fb9d50a4d18945))


### 🐛 Correções de Bugs

* **ci:** corrigir expansao de diretorio remoto e resolucao de symlink no deploy ([cea50a4](https://github.com/cfgaspar10/cargave-app/commit/cea50a4a4e43e85af32a0f0f6dd38fa214157895))
* **ci:** modularizar comandos de deploy em script dedicado e corrigir sintaxe YAML ([af0e7f6](https://github.com/cfgaspar10/cargave-app/commit/af0e7f601d203563d5afada8367ef76a8526ec88))
* **mobile:** corrigir sobreposição do teclado virtual na busca de veículos ([7cae4b2](https://github.com/cfgaspar10/cargave-app/commit/7cae4b2cfea3ab2ac31eca775f490554e4c676cd))
* **modal:** corrigir sobreposição de pílulas de filtros adicionando flex-shrink e isolando recolhimento para busca ativa ([c64df1d](https://github.com/cfgaspar10/cargave-app/commit/c64df1de9d07fc3b71bb813535efb8e50d5b7f59))
* **security:** isolar banco de dados exclusivamente na rede interna sem expor portas no host ([bd7e05a](https://github.com/cfgaspar10/cargave-app/commit/bd7e05a1377d8c657f4c9959869e38477dd33879))


### 📚 Documentação

* add project documentation, configuration files, and gitignore rules ([f657103](https://github.com/cfgaspar10/cargave-app/commit/f657103fb3ec7a212f1a96d8b12d163e7ae35a05))
