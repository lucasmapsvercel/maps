# Modelo MongoDB e contratos de API

## Convencoes

Banco: `MAPS`. IDs internos ObjectId, serializados como strings na API; datas BSON Date em UTC, serializadas em ISO 8601. Localizacoes GeoJSON usam `[longitude, latitude]`, nunca a ordem inversa. Toda entidade de negocio pertence a um `workspaceId` obtido da sessao, nunca confiado a partir do corpo enviado pelo cliente.

Aplicar validacao de schema, limites de tamanho e indices por migracoes versionadas. Exemplos de campos do provedor abaixo so existem se a politica aprovada autorizar sua persistencia.

## Colecoes

| Colecao | Campos principais | Finalidade |
| --- | --- | --- |
| `workspaces` | `_id`, `name`, `createdAt` | Organizacao proprietaria dos dados |
| `memberships` | `workspaceId`, `userId`, `role` | Vinculo com identidade autenticada |
| `cities` | `country`, `state`, `municipalityCode`, `name`, `boundary`, `boundaryVersion`, `source`, `license` | Catalogo municipal independente da fonte comercial |
| `searches` | `workspaceId`, `title`, `term`, `normalizedTerm`, `variants`, `cityId`, `createdBy`, `createdAt`, `lastRunId` | Definicao persistente de busca |
| `searchRuns` | `workspaceId`, `searchId`, `status`, `planVersion`, `boundaryVersion`, `fieldMask`, `limits`, `counters`, `startedAt`, `finishedAt` | Execucao, parametros imutaveis e consumo |
| `scanCells` | `workspaceId`, `runId`, `cellKey`, `parentId`, `bounds`, `variant`, `status`, `checkpoint`, `attempts`, `leaseOwner`, `leaseExpiresAt` | Trabalho territorial duravel |
| `places` | `workspaceId`, `provider`, `providerPlaceId`, `firstSeenAt`, `lastSeenAt` | Identidade do estabelecimento sem duplicacao |
| `providerSnapshots` | `workspaceId`, `placeId`, `runId`, `fields`, `location`, `fetchedAt`, `expiresAt`, `policyVersion`, `attributions` | Conteudo externo com validade e permissao especificas |
| `searchResults` | `workspaceId`, `searchId`, `placeId`, `firstSeenAt`, `lastSeenAt`, `lastSeenRunId`, `hiddenAt`, `hiddenBy` | Vinculo com a busca e ocultacao reversivel |
| `runResults` | `workspaceId`, `runId`, `placeId`, `foundAt` | Participacao em cada execucao; nao depender apenas da ultima |
| `placeAnnotations` | `workspaceId`, `placeId`, `favorite`, `overrides`, `version`, `updatedBy`, `updatedAt` | Organizacao interna compartilhada |
| `comments` | `workspaceId`, `placeId`, `authorId`, `body`, `createdAt`, `updatedAt`, `deletedAt` | Comentarios internos paginados |
| `userViews` | `workspaceId`, `userId`, `openSearchIds`, `activeSearchId`, `searchStates` | Abas, filtros e viewport de cada usuario |
| `auditEvents` | `workspaceId`, `actorId`, `entityType`, `entityId`, `action`, `changedFields`, `createdAt` | Rastreabilidade sem copiar segredos ou conteudo externo proibido |

`fields` pode conter `displayName`, `formattedAddress`, `phone`, `website`, `types`, `businessStatus`, `rating` e `userRatingCount`. Campos ausentes sao opcionais. Nao armazenar respostas brutas por conveniencia.

Nao presumir um TTL unico para todos os campos: separar snapshots por classe de retencao quando necessario. Se nao houver autorizacao de armazenamento, o campo nao entra na colecao. TTL nao concede licenca de uso.

`overrides` permite nome, contato, endereco, categoria e localizacao obtidos de forma independente, com `value`, `source`, `verifiedBy` e `verifiedAt` por campo. Valores externos restritos nao podem ser promovidos a dados proprios. Exibir origem do valor efetivo; uma atualizacao externa nao remove o override.

Place IDs diferentes nao devem ser fundidos automaticamente por nome parecido. Mudanca de ID requer procedimento de reconciliacao com auditoria. Filiais com IDs distintos sao estabelecimentos distintos.

## Indices obrigatorios

| Colecao | Indice | Opcoes |
| --- | --- | --- |
| `memberships` | `{ workspaceId: 1, userId: 1 }` | unique |
| `cities` | `{ country: 1, municipalityCode: 1, boundaryVersion: 1 }` | unique |
| `searches` | `{ workspaceId: 1, createdAt: -1, _id: -1 }` | listagem |
| `places` | `{ workspaceId: 1, provider: 1, providerPlaceId: 1 }` | unique |
| `searchResults` | `{ workspaceId: 1, searchId: 1, placeId: 1 }` | unique |
| `searchResults` | `{ workspaceId: 1, searchId: 1, hiddenAt: 1, _id: 1 }` | filtro padrao |
| `runResults` | `{ workspaceId: 1, runId: 1, placeId: 1 }` | unique |
| `placeAnnotations` | `{ workspaceId: 1, placeId: 1 }` | unique |
| `placeAnnotations` | `{ workspaceId: 1, favorite: 1, placeId: 1 }` | favoritos |
| `scanCells` | `{ workspaceId: 1, runId: 1, cellKey: 1, variant: 1 }` | unique |
| `scanCells` | `{ status: 1, leaseExpiresAt: 1 }` | reserva pelo worker |
| `providerSnapshots` | `{ workspaceId: 1, location: "2dsphere" }` | consulta espacial |
| `providerSnapshots` | `{ expiresAt: 1 }` | TTL, expireAfterSeconds: 0 |
| `comments` | `{ workspaceId: 1, placeId: 1, createdAt: -1, _id: -1 }` | paginacao |
| `userViews` | `{ workspaceId: 1, userId: 1 }` | unique |

Overrides de coordenadas devem ter indice geoespacial separado se utilizados para consulta por viewport. Validar o plano de consulta com `explain` e dados representativos antes de otimizar outros indices.

TTL e assincrono: aplicar `expiresAt > now` nas leituras. Apagar snapshot nao apaga `places`, anotacoes, comentarios nem favoritos. Backups e logs tambem precisam respeitar a politica de retencao.

## Contrato HTTP

Prefixo `/api/v1`. Todas as rotas exigem autenticacao e autorizacao no workspace. GET nunca dispara coleta, hidratacao externa ou atualizacao de dados do provedor.

| Metodo e rota | Resultado |
| --- | --- |
| `GET /cities?q=Belem&state=PA` | Cidades do catalogo com identificador e versao de limite |
| `POST /searches` | Cria definicao sem chamar Google; retorna 201 |
| `GET /searches?cursor=...&limit=50` | Buscas salvas |
| `GET /searches/:searchId` | Definicao, contadores e ultima execucao |
| `POST /searches/:searchId/runs` | Confirma plano e orcamento; enfileira; retorna 202 e runId |
| `GET /runs/:runId` | Estado, progresso, consumo e falhas |
| `POST /runs/:runId/cancel` | Solicita cancelamento idempotente |
| `POST /runs/:runId/resume` | Retoma unidades pendentes da mesma execucao, sujeito a saldo autorizado |
| `GET /searches/:searchId/results` | Lista local filtrada e paginada |
| `GET /searches/:searchId/map?bbox=...` | Pontos/clusters locais validos e indicador de truncamento |
| `GET /places/:placeId` | Dados locais permitidos, proveniencia e validade |
| `PATCH /places/:placeId/annotations` | Favorito e overrides; controle de versao |
| `PATCH /searches/:searchId/results/:placeId` | `{ "hidden": true }` ou false; nao exclui |
| `GET /places/:placeId/comments` | Comentarios paginados |
| `POST /places/:placeId/comments` | Novo comentario; retorna 201 |
| `PATCH /comments/:commentId` | Edita comentario do autor ou mediante permissao administrativa |
| `DELETE /comments/:commentId` | Exclusao logica do comentario com auditoria |
| `GET /favorites` | Favoritos unicos; nao remove os ocultos de uma busca, mas identifica essa condicao |
| `GET /me/view` e `PUT /me/view` | Estado das abas e visualizacao |

Filtros de resultados: `visibility=visible|hidden|all`, `favorite=true|false`, `q`, `runId` e `cursor`. Por padrao, conjunto historico acumulado com indicacao de ultima observacao; `runId` seleciona apenas membros de `runResults` daquela execucao. `bbox` usa `west,south,east,north`; validar coordenadas.

Lista retorna `{ items, nextCursor, counts }`; limite padrao 50, maximo 100. Mapa retorna `{ points, clusters, truncated, counts }`, com teto inicial de 2 mil pontos individuais; clusters devem informar quantidade representada. Aplicar os mesmos filtros de favoritos, texto, execucao e visibilidade na lista, mapa e contadores.

Exemplo de criacao de definicao:

```json
{
  "title": "Aparelho Auditivo - Belem",
  "term": "Aparelho Auditivo",
  "cityId": "<id-do-municipio-no-catalogo>",
  "variants": []
}
```

Iniciar execucao exige `Idempotency-Key` e corpo com `confirmedPlanVersion`, `maxRequests`, `maxEstimatedCost` e `currency`. Chave repetida com mesmo corpo retorna a mesma execucao; corpo diferente retorna 409. Bloquear segunda execucao ativa da mesma busca com reserva atomica.

Atualizacoes de anotacoes recebem `version`; conflito retorna 409 e exige recarregar, evitando sobrescrita concorrente. Corpo de comentario: texto simples de 1 a 5 mil caracteres; nunca renderizar como HTML confiavel.

Erros: `{ "error": { "code": "BUDGET_EXCEEDED", "message": "Limite da execucao atingido", "requestId": "..." } }`. Usar 400 para validacao, 401 para nao autenticado, 403 para acao sem permissao, 404 para recurso ausente ou de outro workspace, 409 para conflito e 429 para limite local. Nao devolver URI do banco, stack trace ou resposta sensivel do provedor.