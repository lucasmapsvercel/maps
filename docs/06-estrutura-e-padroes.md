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
| `src/infrastructure/server/google-places-provider.ts` | Text Search Pro, uma pagina, respostas temporarias e erros sem retry |
| `src/infrastructure/server/google-search-budget.ts` | Reserva mensal atomica e recibos sem conteudo do provedor |
| `src/presentation` | Componentes TSX, formularios, fila de comandos e mensagens |
| `scripts` | Migracao do schema no MongoDB Atlas, fora do build/deploy |
| `tests` | Dominio, React, SSR, API, politica OAuth e integracao Mongo |

As dependencias apontam para dentro. O dominio nao importa Next, React,
driver Mongo ou variaveis de ambiente. `PortalService` pode executar com estado,
relogio e gerador de IDs injetados sem persistencia; o adaptador Mongo coordena
a transacao. A infraestrutura HTTP implementa `PortalConnection`.

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
escritas apos perda de conexao. A versao global rejeita escritas concorrentes,
inclusive de usuarios distintos; prioriza evitar perda de alteracoes.

## Limite deliberado desta etapa

O backend do portal usa agregado Mongo por workspace (maximo 8 MiB), views
separadas por usuario e API de comandos. E uma implementacao funcional de
persistencia da interface atual, **nao** a implementacao normalizada de
coleta/consulta paginada descrita como alvo em `03-dados-e-api.md`.
Nao afirmar atendimento dos cenarios de carga, retencao de provedor ou coleta.

Para volumes maiores e coleta real, migrar por versao para colecoes
normalizadas/paginacao antes de elevar o limite. Nao introduzir provider
snapshots em um agregado irrestrito. Mantem-se pendente a escolha de fonte,
malha municipal licenciada, politica de retencao e orcamento para coleta
municipal. A consulta Google explicita em lista e uma integracao distinta,
sem persistencia dos resultados; veja [Google Places](09-google-places.md).

Worker de coleta devera ser processo separado com fila duravel, leases,
checkpoints e limites. Nao executar coleta longa em Route Handler ou
promessa solta na Vercel. Nenhum worker vazio ou provedor ficticio e
apresentado como integracao real nesta entrega.

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
