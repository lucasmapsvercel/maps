# Estrutura e padroes de projeto

## Diretriz

Next.js App Router, React, TypeScript estrito, Clean Code, Arquitetura Limpa,
SOLID e orientacao a objetos por composicao. Componentes visuais em TSX;
sem HTML manual, `innerHTML` ou `dangerouslySetInnerHTML`. `.next` pode conter
HTML gerado pelo framework e nao e versionado.

## Camadas implementadas

| Local | Responsabilidade |
| --- | --- |
| `src/app` | Paginas, composicao, protecao da pagina e adaptadores HTTP |
| `src/domain` | Estado, comandos tipados/validados, filtros e regras sem Next/React/banco |
| `src/application` | `PortalService`, contrato assincrono `PortalConnection` e erros de negocio |
| `src/infrastructure/http-portal-connection.ts` | Cliente HTTP; nao armazena dados no localStorage |
| `src/infrastructure/server/auth.ts` | Adaptador NextAuth/Google e identidade confiavel |
| `src/infrastructure/server/mongo.ts` | Pool Mongo reutilizado, somente servidor |
| `src/infrastructure/server/mongo-portal-store.ts` | Unidade de trabalho transacional, versao, views e auditoria |
| `src/infrastructure/server/mongo-schema.ts` | Migracao idempotente, validadores e indices |
| `src/infrastructure/server/api.ts` | Autorizacao, origem, tamanho do corpo e respostas de erro |
| `src/infrastructure/server/google-places-provider.ts` | Text Search (New), pagina de 20 resultados, captura sanitizada e erros sem retry |
| `src/infrastructure/server/google-search-budget.ts` | Reserva mensal atomica e recibos sem conteudo do provedor |
| `src/infrastructure/server/collection-runner.ts` | Jobs, cursor persistente, importacao de paginas e serializacao de progresso |
| `src/infrastructure/server/ibge-municipalities.ts` | Catalogo oficial, cache e reserva validada para indisponibilidade do IBGE |
| `src/infrastructure/ibge-catalog.ts` | Normalizacao e validacao do catalogo, compartilhadas com o atualizador |
| `src/presentation` | Componentes TSX, formularios, fila de comandos e mensagens |
| `scripts` | Migracao MongoDB e atualizacao da copia oficial IBGE, fora do build/deploy |
| `tests` | Dominio, React, SSR, API, politica OAuth e integracao Mongo |

As dependencias apontam para dentro. O dominio nao importa Next, React,
driver Mongo ou variaveis de ambiente. `PortalService` pode executar com estado,
relogio e gerador de IDs injetados sem persistencia; o adaptador Mongo coordena
a transacao. A infraestrutura HTTP implementa `PortalConnection`.

Os schemas de jobs e cota em `src/domain/collection-job.ts` e
`src/domain/collection-config.ts` definem os contratos compartilhados entre
servidor e painel. O painel usa polling sequencial, sem sobrepor leituras,
e cancela leituras ao desmontar. A antiga tela de consulta temporaria foi
removida por nao ter consumidores; o endpoint direto permanece compativel.

`PortalRepository` sincrono e `LocalStorageRepository` permanecem para os
testes legados do demonstrador, sem uso na pagina autenticada. Nao sao
substitutos silenciosos do banco quando o servidor falha.

## Caminho de uma alteracao

1. Componente emite comando explicito, sem enviar workspace, autor ou estado.
2. Hook serializa comandos; filtros e navegacao podem responder imediatamente.
3. Cliente envia comando, UUID da operacao e versao conhecida.
4. API valida sessao Google, allowlist atual, origem exata, JSON, tamanho e schema.
5. Adaptador consulta somente o workspace da sessao, valida versao e executa
   o mesmo `PortalService` usado nos testes.
6. Transacao confirma estado compartilhado, view individual, recibo idempotente
   e evento de auditoria juntos. Comentarios recebem autor/data do servidor.
7. Cliente confirma o estado; formularios so limpam apos resposta de sucesso.
   Em conflito/erro, preserva rascunhos e informa a necessidade de recarga.

O UUID e valido por sete dias: mesma operacao/conteudo nao e aplicada novamente;
conteudo diferente com a mesma chave e rejeitado. Nao ha retry silencioso de
escritas apos perda de conexao. A versao global protege escritas comerciais;
navegacao, abas e filtros alteram somente a view individual. Importacoes nao
reescrevem a view, e a fila do cliente preserva navegacao durante atualizacoes.

## Limite deliberado desta etapa

O backend do portal usa agregado Mongo por workspace (maximo 8 MiB), views
separadas por usuario e API de comandos. E uma implementacao funcional de
persistencia da interface atual, **nao** a implementacao normalizada descrita
como alvo em `03-dados-e-api.md`. A coleta Google ja pagina e importa no
agregado, com jobs/cursor separados; a consulta local ainda nao e paginada.
Nao afirmar atendimento dos cenarios de carga ou conformidade de retencao.

Para volumes maiores e coleta real, migrar por versao para colecoes
normalizadas/paginacao antes de elevar o limite. Nao introduzir provider
snapshots em um agregado irrestrito. Mantem-se pendente a escolha de fonte,
malha municipal licenciada, politica de retencao e orcamento para coleta
municipal. A integracao Google atual persiste resultados e detalhes
sanitizados de logs; veja [Google Places](09-google-places.md).

O runner agenda Vercel Workflow e aguarda a confirmacao de agendamento antes
de responder. O workflow recebe somente o ID do job; etapas carregam
credenciais e dados no servidor. A orquestracao sobrepoe importacao e proxima
pagina, aguardando ambas antes de finalizar inclusive em erro.
Checkpoints Mongo protegem reentregas: pagina salva nao consulta novamente
o Google; importacao, recibo, contador e remocao do buffer usam a mesma
transacao. Uma reserva sem checkpoint de pagina bloqueia a continuacao,
pois a API externa nao permite garantir exatamente uma chamada apos uma queda.
Falhas tecnicas usam retries do Workflow; erros comerciais/provedor sao fatais.
Jobs legados interrompidos sao recuperados conservadoramente pelo historico,
sem repetir chamadas, apagar resultados ou estornar consumo.

## SOLID, leitura e verificacao

- Responsabilidades delimitadas; rotas nao concentram regras do portal.
- Casos de uso e adaptadores testaveis separadamente, sem classes artificiais.
- Contratos pequenos, entradas externas `unknown`, sem `any` ou casts de evasao.
- Reutilizar regras/filtros entre testes e execucao; nao duplicar logica na API.
- Falhas de Mongo, OAuth, rede e concorrencia sao explicitas; sem fallback demo.
- Nunca importar modulos `infrastructure/server` na arvore cliente.
- `npm run check`, `npm test` e `npm run build` verificam tipagem, comportamento
  e empacotamento. Integracao usa replica set temporario independente.

Deploy exclusivamente na Vercel, sem saida standalone ou provisionamento de
banco pelo projeto. Variaveis privadas sao diretas; MongoDB exige URI explicita.
Operacao em [Deploy na Vercel](07-deploy-vercel.md); criterios de producao
e decisoes ainda pendentes em [Entrega](05-entrega-e-aceite.md).
