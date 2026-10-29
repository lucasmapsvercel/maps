# MAPS - Especificacao do projeto

Status: portal Next.js com Google OAuth e persistencia MongoDB; coleta real bloqueada. Data: 2026-10-29.

Portal de pesquisa de estabelecimentos por termo e municipio, com buscas salvas em abas, mapa de resultados e acompanhamento comercial em MongoDB, no banco `MAPS`.

## Exemplo principal

1. Criar uma busca com o termo **Aparelho Auditivo**.
2. Selecionar **Belem, Para, Brasil**, confirmando o limite municipal.
3. Solicitar a coleta nas regioes do municipio e acompanhar o progresso.
4. Persistir os resultados permitidos, sem duplicar o mesmo estabelecimento.
5. Reabrir a busca para consultar mapa e lista sem executar outra busca de estabelecimentos.
6. Adicionar comentarios internos, favoritar, editar dados locais e ocultar resultados sem excluir registros.

## Documentos

| Documento | Conteudo |
| --- | --- |
| [Produto e requisitos](docs/01-produto.md) | Escopo, abas, telas, regras e requisitos funcionais |
| [Arquitetura e busca](docs/02-arquitetura-e-busca.md) | Componentes, varredura territorial, limites, custos e retomada |
| [Dados e API](docs/03-dados-e-api.md) | Colecoes MongoDB, indices e contratos HTTP |
| [Seguranca e configuracao](docs/04-seguranca-e-configuracao.md) | Segredos, acesso ao banco, LGPD e regras do provedor |
| [Entrega e aceite](docs/05-entrega-e-aceite.md) | Etapas de implementacao, testes e decisoes pendentes |
| [Estrutura e padroes](docs/06-estrutura-e-padroes.md) | Clean Code, Arquitetura Limpa, SOLID, OO e responsabilidades |
| [Execucao, Docker e Vercel](docs/07-execucao-e-docker.md) | Variaveis, Compose, deploy Vercel, testes e preparacao segura do Atlas |

## Condicoes essenciais

- "Toda a cidade" significa executar o plano de cobertura do territorio selecionado, nao garantir todos os estabelecimentos existentes. A fonte pode omitir empresas ou limitar resultados.
- "Sem buscar novamente" significa consultar os dados locais que podem ser legalmente armazenados e ainda estao validos. Nao significa mapa offline nem isencao de cobranca pelo carregamento do mapa.
- O Google permite armazenar Place IDs indefinidamente, mas isso nao autoriza persistir indefinidamente nomes, telefones, enderecos e demais conteudos.
- A viabilidade de coleta sistematica municipal e de constituir esta base deve ser validada contra o contrato aplicavel antes de ativar a integracao. Usar a API oficial nao elimina essas restricoes.
- Se a retencao permanente de todos os dados e obrigatoria, selecionar uma fonte ou contrato que autorize expressamente esse uso. Nao substituir por scraping para contornar os termos.
- A credencial MongoDB compartilhada na conversa nao foi gravada nos documentos nem utilizada. Sua senha deve ser rotacionada antes do uso.

## Portal implementado

O portal utiliza Next.js com App Router, React e TypeScript estrito, com componentes TSX e camadas de dominio, aplicacao, infraestrutura e apresentacao. Login Google exige e-mail verificado e allowlist. Buscas, favoritos, comentarios com autor, ajustes e ocultacao persistem no MongoDB. Abas e filtros sao individuais; dados do workspace sao compartilhados. O banco inicia vazio, sem semeadura ou importacao automatica do demonstrador antigo.

Nao ha arquivos HTML implementados manualmente. A entrada e definida em
`src/app/layout.tsx` e `src/app/page.tsx`. O Next gerencia a resposta HTTP e
seus artefatos internos em `.next`, que nao sao versionados.

### Executar com Docker

Com Docker Desktop e Compose v2, na raiz do projeto:

```powershell
npm.cmd ci
npm.cmd run setup:docker
# Configure OAuth Google e allowlist antes de iniciar (veja o guia abaixo).
docker compose config --quiet
docker compose up --build -d
```

O preparador preserva `.env` e segredos existentes. Siga obrigatoriamente o
[passo a passo Google OAuth e Docker](docs/07-execucao-e-docker.md) para criar
o Client ID e preencher privadamente o Client Secret. Abra <http://localhost:3000>.
O Compose inclui MongoDB autenticado, replica set persistente, init/migracao e portal.
Para encerrar: `docker compose down`.

### Executar com Node.js

Com Node.js 24 e MongoDB autenticado com replica set acessivel, variaveis
OAuth/allowlist/segredo configuradas e banco migrado conforme o guia:

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd test
npm.cmd run build
npm.cmd start
```

Abra <http://localhost:3000>. Para desenvolver com atualizacao automatica,
use `npm.cmd run dev` e abra a URL informada pelo Next.js (normalmente
<http://127.0.0.1:3000>). Use HTTP, nao abertura direta por `file://`.

Esta entrega implementa autenticacao, API persistente, transacoes, auditoria,
controle de concorrencia e verificacoes de processo/banco. A fonte real e os
limites ainda nao foram definidos pelo responsavel: nao ha coleta, worker,
catalogo territorial ou mapa cartografico. Criar busca nao descobre empresas.
Os contratos normalizados e criterios de producao da especificacao continuam
como alvo; veja o escopo efetivo em [Dados e API](docs/03-dados-e-api.md).

### Publicar na Vercel

Importe o repositorio como projeto **Next.js**, mantenha build e saida nos
padroes do framework e use Node.js 24.x. Nao utilize Docker nem configure
exportacao estatica na Vercel. O passo a passo, as variaveis e a separacao
do futuro worker estao no [guia de execucao](docs/07-execucao-e-docker.md).

Na Vercel, configure MongoDB externo com replica set, segredos OAuth e callback
HTTPS; o Mongo local do Compose nao e acessivel pela Vercel.
A credencial Atlas exposta nao foi utilizada e deve ser revogada.