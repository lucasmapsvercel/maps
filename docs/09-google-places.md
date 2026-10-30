# Google Places: consultas sob demanda e coleta paginada

## Escopo implementado

- Consulta explicita por termo/cidade de uma busca salva do workspace.
- Busca direta: uma chamada Text Search (New). Coleta: paginacao com limite
  de requisicoes por execucao, sempre com `pageSize=20`, sem retry automatico.
- Campos: ID, nome, endereco, localizacao, categoria, telefone, site e
  atribuicoes; sem fotos, avaliacoes ou mapa JavaScript pago.
- Bairro (quando disponivel) e cidade incluidos no texto da consulta: nao ha filtro por poligono municipal,
  geocodificacao, grade ou garantia de pertencimento/cobertura do municipio.
- O adaptador retorna atribuicoes; o filtro dos resultados salvos e local
  e nao faz novas chamadas. O painel atual e o de coleta incremental;
  a antiga tela isolada de consulta temporaria nao e mais usada.
- Resposta HTTP `no-store`; a busca direta retorna dados temporarios. A coleta
  em segundo plano importa resultados no workspace MongoDB e o mapa Leaflet
  usa as coordenadas salvas.
- Persistencia e exibicao devem ser revisadas contra as politicas e contrato
  aplicaveis. O prazo de exibicao da busca direta nao autoriza retencao de
  conteudo Google; a flag de reconhecimento nao substitui essa revisao.

## Coleta incremental por requisicoes

A coleta em segundo plano (`POST /api/v1/collection/run`) usa o limite de
Configuracoes como **quantidade maxima de requisicoes por execucao**, nao
como quantidade de estabelecimentos nem como teto acumulado da busca salva.
O padrao e 100 requisicoes; sao aceitos inteiros entre 1 e 5000.
Cada nova execucao tem seu proprio limite e continua do bairro/pagina anterior.
O limite e compartilhado entre todos os bairros, nao multiplicado por bairro.

A documentacao oficial consultada em 2026-10-30 define `pageSize` maximo de
**20 resultados por requisicao**. O portal sempre solicita 20, inclusive nas
paginas seguintes. Configurar 100 nao significa garantir 2000 resultados:
Text Search (New) limita a mesma consulta a **60 resultados somando todas
as paginas**, normalmente tres chamadas de 20. O Google pode retornar menos
itens ou encerrar a paginacao antes. Esse limite vale separadamente para cada
consulta por bairro; nao ha pagina forcada, grade territorial ou garantia
de obter todos os estabelecimentos.

Exemplo: com limite 100 e cota mensal do sistema de 5000, uma execucao que
realizar 100 chamadas consome 100 e deixa 4900 disponiveis. Se o Google
encerrar apos 3 paginas e nao houver outros bairros pendentes, somente 3 sao consumidas. O limite mensal efetivo
continua sendo `GOOGLE_PLACES_MONTHLY_LIMIT`, compartilhado entre usuarios e
workspaces do mesmo escopo. Nenhuma reserva antecipada de 100 e feita.

`GET/PUT /api/v1/collection/config` usa `{ "maxRequestsPerRun": 100 }`;
o campo antigo `maxResultsPerSearch` nao e reinterpretado como requisicoes.
Se apenas o campo antigo existir, aplica-se o novo padrao de 100; ao salvar,
o campo antigo e removido. Jobs novos salvam `maxRequestsPerRun` e
`requestsMade`, expostos nos endpoints de progresso. O limite vigente no
inicio do job e preservado mesmo se a configuracao mudar durante a execucao.

### Todos os bairros automaticamente

Novas buscas com municipio selecionado pelo codigo IBGE usam todos os nomes
de bairros disponiveis no catalogo oficial incluido no deploy. Nao ha selecao
manual de bairros. A copia da malha de bairros do Censo 2022 publicada pelo
IBGE em novembro de 2024 contem **17.575 bairros em 895 municipios**; Belem/PA
possui **71**, incluindo Cremacao, Nazare e Tenone. Isso nao cobre todos os
municipios brasileiros nem garante refletir alteracoes territoriais recentes.
Fonte: [IBGE, bairros CD2022](https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/bairros/shp/BR/).

O plano usa nomes em ordem alfabetica. Bairros homonimos no mesmo municipio
sao agrupados, pois gerariam a mesma consulta textual. Cada consulta usa
`<termo> em <bairro>, <municipio/UF/pais da busca>`, sem geocodificacao paga,
geometria ou filtro estrito de pertencimento ao bairro. Resultados proximos
podem aparecer e sao deduplicados por Place ID entre todas as paginas/bairros.
Quando nao ha `nextPageToken`, avanca para o proximo bairro sem reutilizar o
token anterior, inclusive se a resposta estiver vazia. Cada pagina efetivamente
solicitada consome uma requisicao, mesmo que todos os seus resultados se repitam.

O plano e copiado para o cursor na primeira execucao: lista, ordem, ano da
base, bairro atual e token nao mudam durante retomadas, mesmo apos atualizar o
catalogo. O progresso mostra bairro atual, quantidade concluida e total.
Ao atingir o teto global da execucao, continuar retoma o mesmo bairro/token,
sem voltar aos bairros concluidos. A cota mensal continua unica.

Municipios sem catalogo e buscas sem codigo IBGE consultam o municipio
inteiro e mostram explicitamente "Divisao por bairros indisponivel".
Cursores anteriores permanecem no fluxo municipal para evitar repetir
consultas; a interface orienta criar outra busca para adotar os bairros.
Falha de carregamento/validacao nao vira fallback silencioso: bloqueia o
inicio e mostra erro. A consulta direta continua sendo apenas uma pagina
municipal, sem percorrer bairros.

`npm.cmd run neighborhoods:update` baixa o ZIP oficial, extrai apenas os
atributos DBF e valida codigos, nomes, unicidade e volume nacional antes de
substituir `src/infrastructure/data/ibge-neighborhoods.json`. Aceita tambem
o caminho de um ZIP oficial previamente baixado como argumento.
Nao inclui geometrias nem faz download durante a coleta ou o build.
Atualizacoes devem ser revisadas e publicadas em novo deploy.

O cursor de cada busca/workspace fica em `collectionCursors`: proxima pagina,
itens da pagina ainda nao importados e indicacao de esgotamento. Cada pagina
e importada integralmente, sem cortes por quantidade de estabelecimentos.
Itens pendentes de uma falha ou do formato anterior de lotes sao importados
antes de novas chamadas e nao consomem novamente a cota. Esse buffer segue
a mesma politica de armazenamento dos dados da coleta;
nao faz parte dos logs de consultas e nao e exposto pelos endpoints de jobs.

A pagina e salva antes da importacao, e o cursor so descarta itens apos
importacao bem-sucedida. Falhas preservam o cursor; registros ja importados
sao reconhecidos por Place ID. Apenas um job por busca pode executar por vez.
A proxima pagina ou primeiro pedido do bairro seguinte e solicitado enquanto a atual e importada, se houver continuacao,
limite por execucao e cota disponivel. Ha no maximo uma chamada Google em
andamento por job e uma pagina antecipada, sem consultas fora do plano salvo.
O buffer pode conter ate duas paginas nesse fluxo; dados antigos
maiores sao drenados em grupos de ate 20 antes de antecipar novas paginas.
Acrescentar resultados e remover o prefixo importado sao operacoes atomicas,
evitando perder a pagina seguinte se ela chegar durante a importacao.
Em falha, o job aguarda tambem a chamada em voo e sua persistencia antes de
liberar o cursor. Uma pagina antecipada consome cota mesmo se a importacao
falhar; os dados recebidos ficam salvos para retomar sem outra chamada.

A interface restaura o ultimo job ao reabrir a busca e permite continuar mesmo
independentemente do total de estabelecimentos salvos. `hasMore: false` indica
que nao ha pagina nem bairro pendente e nao ha itens pendentes no buffer;
novas coletas sao bloqueadas sem consumir cota.
O progresso inclui `collectedSoFar`; a cada leitura de progresso (intervalo
de 2,5 segundos apos a anterior), resultados salvos e cota sao atualizados
quando ha novas importacoes, e novamente ao concluir ou falhar. A lista e o
mapa nao precisam esperar o fim de toda a execucao. Esses refreshes nao
consultam o Google e preservam navegacao, abas e filtros.

Tokens sao controlados pelo Google e podem deixar de ser validos. Nao ha
reinicio automatico da primeira pagina em caso de token recusado. Buscas
antigas cujos tokens foram descartados retornam `COLLECTION_CURSOR_UNAVAILABLE`;
e necessario criar uma nova busca, pois nao existe continuacao confiavel
recuperavel desses jobs. O esgotamento indica apenas o fim dos resultados
disponibilizados pela API, nao cobertura de todos os estabelecimentos da cidade.

Cada pagina, inclusive vazia ou contendo IDs repetidos, conta como uma
requisicao. Falhas do provedor tambem contam e encerram a execucao sem retry.
A reserva mensal, o contador do job e o recibo/log sao gravados na mesma
transacao antes de cada chamada. O limite por execucao nunca e ultrapassado;
ao atingi-lo, o job conclui com `hasMore: true` se ainda houver continuacao.
A cota mensal menor que o limite por execucao interrompe novas chamadas com
erro explicito, sem perder as paginas ja importadas nem o cursor.

### Durabilidade e chamadas interrompidas

O POST agenda Vercel Workflow, em vez de manter uma promessa solta na funcao
HTTP. O workflow recebe apenas jobId e executa preparacao, planejamento,
consulta, importacao e finalizacao em etapas persistidas.
Chaves sao lidas apenas no servidor; tokens e resultados ficam no MongoDB,
nao no journal do workflow. Configuracao/flag e validada a cada nova pagina.

Uma etapa tecnica pode ser reentregue (tres retries por padrao do SDK).
O ID deterministico da chamada e o checkpoint do cursor impedem reenviar
uma pagina ja persistida. Importacao, recibo, contagem e remocao do buffer
sao confirmados na mesma transacao, evitando duplicacao apos perda do
acknowledgement. Erros Google/comerciais encerram a execucao sem retry.

Nao e possivel garantir exatamente uma chamada entre o Google e o MongoDB
em caso de queda: se uma etapa reentregue encontra reserva/recibo, mas nao
checkpoint da pagina, a continuacao e bloqueada com `COLLECTION_RESPONSE_UNCERTAIN`, sem repetir
a chamada nem estornar consumo. O buffer confirmado permanece recuperavel.
Uma nova busca e necessaria para voltar a consultar apos essa incerteza.
Uma falha explicita do provedor que encerrou normalmente o job preserva o
comportamento anterior: o usuario pode confirmar outra execucao usando o
mesmo token, sem voltar a primeira pagina; a nova tentativa consome cota.

Leituras autenticadas do historico/progresso recuperam jobs interrompidos
sem atividade ha pelo menos 15 minutos. Runs duraveis ainda ativos sao
preservados; runs terminais ou jobs legados sem runId sao encerrados com
erro explicito e liberacao do bloqueio ativo. O cursor permanece bloqueado
para chamadas externas incertas, sem apagar resultados, buffer ou logs.
Ativacao e operacao: [Deploy na Vercel](07-deploy-vercel.md).

## Franquia gratuita nao significa garantia de custo zero

Tabela global oficial consultada em 2026-10-29:

| SKU | Franquia mensal publicada |
| --- | --- |
| Text Search Pro | 5.000 eventos |
| Dynamic Maps | 10.000 eventos, nao utilizado nesta versao |

`displayName`, `formattedAddress` e `location` exigem pelo menos Pro.
O adaptador atual tambem solicita `nationalPhoneNumber` e `websiteUri`, que
acionam **Text Search Enterprise**, conforme a documentacao de campos/SKUs.
A franquia Pro de 5000 nao e garantia de gratuidade para esses campos.
O teto de 5000 no sistema e controle local de requisicoes, nao uma franquia
financeira validada para a conta. Cada pagina/consulta pode ser um evento.
Nao usar a franquia de IDs Only como se cobrisse os campos Pro.
Confirme precos, elegibilidade e agregacao do consumo na conta real antes de ativar.

O responsavel informou que o faturamento e compartilhado. Portanto, **o limite
inicial do portal e zero**. Verifique o consumo e reserve uma parcela explicita
da franquia para o portal. Se outros projetos continuarem consumindo livremente,
o contador local nao pode garantir gratuidade: mantenha desativado ate haver
alocacao coordenada, cotas adequadas ou conta dedicada.

O limite configurado e um teto de chamadas desta aplicacao, nao um teto de
faturamento Google. Vercel, Atlas e demais servicos tambem podem gerar custos.
Alertas de orcamento Google avisam; nao sao bloqueio automatico de cobranca.
Nao existe desligamento mensal de faturamento Google implementado pelo portal.

## Criar a chave Places

Esta chave e diferente do Client ID/Secret usados no login.

1. No Google Cloud Console, selecione o projeto de faturamento correto.
2. Vincule faturamento conforme exigido pelo Google, mesmo para uso da franquia.
3. Habilite somente **Places API (New)** para esta integracao.
4. Em APIs & Services > Credentials, crie uma API key exclusiva de servidor.
5. Em API restrictions, restrinja a **Places API (New)**.
6. Planeje application restrictions adequadas ao backend. Nao use restricao
   de HTTP referrer para uma chave chamada pelo servidor. Restricao por IP
   requer saida estatica compativel com seu plano Vercel; nao presuma IP fixo.
7. Cadastre a chave privadamente como `GOOGLE_PLACES_API_KEY` na Vercel.
   Nunca use `NEXT_PUBLIC_` nem envie o valor no chat.
8. Configure cotas disponiveis no Google, alertas e monitoramento do SKU,
   considerando todos os projetos ligados ao mesmo faturamento.

Nao habilite Maps JavaScript API ou crie chave de mapa para esta primeira etapa.

## Variaveis Production na Vercel

Mantenha as variaveis MongoDB/OAuth existentes e acrescente:

| Variavel | Valor |
| --- | --- |
| `GOOGLE_COLLECTION_ENABLED` | `true` para permitir consulta explicita |
| `GOOGLE_PLACES_API_KEY` | Chave privada de servidor restrita a Places API (New) |
| `GOOGLE_PLACES_POLICY_ACKNOWLEDGED` | `true` somente apos revisao das politicas e adequacao dos documentos publicos |
| `GOOGLE_PLACES_MONTHLY_LIMIT` | Inteiro entre 0 e 5000; parcela disponivel confirmada, nao a franquia total automaticamente |
| `GOOGLE_PLACES_BILLING_SCOPE` | Identificador estavel do orcamento, por exemplo `maps-production-places-pro`; nao e segredo nem ID Google validado |

Limite `0`, chave/politicas ausentes ou coleta desativada impedem chamadas.
Nao configure `5000` se a mesma franquia ja atende outros projetos sem
compensar o consumo deles. Limites/consumo externos nao sao descobertos automaticamente.
Valores invalidos sao tratados pelo endpoint, sem bloquear o build.
Faca Redeploy apos configurar variaveis.

O contador e compartilhado por todos os workspaces/usuarios no mesmo banco
e escopo. Deploys que consumam a mesma alocacao precisam usar o mesmo banco
de contadores e escopo; mudar o escopo/banco reinicia o contador e pode
ultrapassar a franquia. Preview deve ficar desativado ou ter orcamento separado.
O mes e calculado no fuso America/Los_Angeles; confira a janela de faturamento
e os ajustes da conta Google. Reduzir o limite bloqueia novas chamadas se o
consumo ja o ultrapassou; aumentar exige nova confirmacao da parcela disponivel.

## Politicas publicas

Paginas `/terms` e `/privacy` descrevem o fluxo e vinculam termos/privacidade
Google. O responsavel deve revisar e complementar identidade do controlador,
contato, base legal e retencao de dados internos antes de habilitar para uso
publico. A flag de reconhecimento nao substitui revisao contratual/juridica.
Consultar todos os bairros nao concede permissao para extracao em massa ou
formacao de diretorio. Antes de ativar a coleta automatica, valide expressamente
esse uso e a retencao contra o contrato aplicavel; mantenha a coleta desativada
quando nao houver autorizacao. Nao usar a divisao por bairros para contornar
restricoes contratuais do provedor.

Nao assumimos direito de armazenar todos os campos por um prazo generico.
A coleta atual grava IDs e dados retornados no workspace e no buffer de
retomada. Os detalhes dos logs tambem incluem a resposta sanitizada por 30 dias,
conforme configuracao de produto solicitada. Esse prazo nao concede permissao
contratual de retencao: revisar conformidade antes da ativacao. Os recibos e a
auditoria permanente nao incluem nomes/enderecos/coordenadas dos estabelecimentos.
Garanta tambem que observabilidade externa nao capture corpos de resposta.

## Endpoint e consumo

`POST /api/v1/collection`, com sessao Google e origem autorizada:

```json
{
  "searchId": "<id de busca salva do proprio workspace>",
  "requestId": "<UUID novo>",
  "confirmed": true
}
```

O servidor resolve termo/cidade da busca; nao aceita chave, workspace ou
parametros arbitrarios do provedor no corpo. Antes da chamada, reserva
capacidade no MongoDB em transacao:

- `googleSearchBudgets`: contador por mes/escopo, atualizado atomicamente.
- `googleSearchRequests`: recibo unico de solicitacao e log de consulta, com
  ator/workspace/data, busca, termo/cidade informados pelo usuario, origem
  (direta ou coleta), indicador de continuacao, status, duracao, quantidade
  retornada e codigo de erro. Sem chave, token ou conteudo externo.

Mesmo timeout, erro do Google ou queda depois da reserva permanece contabilizado.
Nao ha reembolso de tentativa nem retry automatico: pode haver cobranca de
chamada em voo. Repetir UUID nao chama o Google novamente; retorna 409, pois
nao ha replay da resposta pelo endpoint de coleta. Nova consulta exige nova confirmacao e UUID.
Os recibos/contadores sao pequenos metadados persistentes sem TTL nesta etapa;
nao os apague durante a janela em que protegem a alocacao e a idempotencia.

### Historico em Configuracoes

`GET /api/v1/collection/logs` exige autenticacao e retorna no maximo as 100
consultas mais recentes do workspace da sessao, em ordem decrescente de data.
Nao depende de a integracao estar habilitada: o historico permanece acessivel
apos desativar as consultas. A resposta usa `no-store` e nao expoe IDs de
usuario, chaves ou tokens. Recibos antigos sem metadados nao sao apresentados.

A tela **Configuracoes > Logs de consultas ao Google** carrega esse historico
e oferece **Atualizar logs**, sem consultar o Google nem consumir cota.
Cada pagina de uma coleta em segundo plano gera seu proprio registro, assim
como a busca direta. O numero de resultados corresponde a pagina retornada,
nao a quantidade importada ou deduplicada.

O registro inicial e gravado na mesma transacao da reserva, antes de chamar
o provedor. Sucesso e falha atualizam o registro com duracao em milissegundos;
os recibos permanentes registram somente o codigo de erro e metadados.
Se o processo terminar ou a gravacao final falhar, o registro fica **Sem
conclusao registrada**, sem indicar sucesso. Reservas recusadas por limite
ou UUID repetido nao geram novos logs, pois nao realizam chamadas.
Os registros nao comprovam recebimento ou cobranca do lado Google e nao tem
TTL, preservando a protecao de idempotencia dos recibos existentes.
Execute a migracao padrao para criar o indice de workspace/data do historico.

#### Request e response

Cada linha oferece **Request / response**, carregado sob demanda pelo endpoint
`GET /api/v1/collection/logs/:logId`. A leitura exige sessao, isola o workspace,
usa `no-store` e nao chama o Google nem consome cota. Consultas anteriores a
esta funcionalidade nao possuem detalhes retroativos.

`googleSearchDetails` guarda separadamente, por 30 dias a partir da chamada:

- Request: metodo, URL, Content-Type, mascara de campos e corpo enviado
  (`textQuery`, idioma, regiao, pageSize e indicador sanitizado de token).
- Response: status HTTP real do Google (nao o status traduzido pelo portal),
  Content-Type e corpo JSON original sanitizado, incluindo estabelecimentos
  e erros. Respostas nao JSON sao exibidas como texto, nunca como HTML.
- Chave da API, tokens de paginacao, autorizacao, cookies e campos de
  credenciais sao substituidos por `[REDACTED]`. Somente headers permitidos
  sao capturados; headers arbitrarios de resposta nao sao armazenados.
- Falhas de conexao registram ausencia de resposta HTTP, sem detalhes
  internos do transporte. Request sem response indica chamada em andamento
  ou interrompida. Corpo acima de 1 MiB e truncado explicitamente apos
  sanitizacao (preview de ate 100.000 caracteres).

O request e persistido antes do envio; response e capturado antes de validar
o formato ou tratar erros HTTP. Falhas ao gravar detalhes sao propagadas,
sem apresentar sucesso ficticio. Os corpos nunca sao enviados ao console.

Execute `npm.cmd run db:migrate` para criar o indice TTL de `expiresAt`.
Mongo remove documentos expirados assincronamente; o endpoint tambem aplica
`expiresAt > agora`, bloqueando imediatamente a leitura apos 30 dias.
Recibos, contadores e metadados continuam preservados sem esse TTL.
Backups devem seguir a mesma politica de retencao dos detalhes.

Codigos: `COLLECTION_DISABLED`, `COLLECTION_NOT_CONFIGURED`,
`COLLECTION_BUDGET_REQUIRED`, `COLLECTION_CONFIGURATION_INVALID`,
`GOOGLE_MONTHLY_LIMIT`, `GOOGLE_REQUEST_ALREADY_USED`, `GOOGLE_REQUEST_FAILED`,
`GOOGLE_CONNECTION_FAILED`, `GOOGLE_INVALID_RESPONSE`.
Falhas sao exibidas na tela; nao viram listas vazias com aparencia de sucesso.

`/api/ready` continua testando Mongo e configuracao basica; o campo `collection`
retorna `on_demand` quando a configuracao de consulta passa ou o codigo do bloqueio.
Isso nao valida a chave Google nem executa chamada paga.

## Validacao

Testes usam exclusivamente respostas sinteticas: mascara de campos, uma chamada,
erros sem retry, atribuicao, confirmacao, expiracao e reserva concorrente no Mongo.
Nenhuma chamada real foi executada durante a implementacao. O primeiro teste real
deve ser feito pelo responsavel depois de verificar franquia, cotas e politicas.

## Fontes oficiais

- [Precos globais](https://developers.google.com/maps/billing-and-pricing/pricing)
- [Text Search e campos/SKUs](https://developers.google.com/maps/documentation/places/web-service/text-search)
- [Referencia Text Search: pageSize e pageToken](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places/searchText)
- [Politicas e atribuicao](https://developers.google.com/maps/documentation/places/web-service/policies)
- [Uso e faturamento](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing)
