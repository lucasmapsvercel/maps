# Google Places: consultas sob demanda, sem mapa pago

## Escopo implementado

- Consulta explicita por termo/cidade de uma busca salva do workspace.
- Uma chamada Text Search (New), com `pageSize=20`, sem paginacao ou retry automatico.
- Campos: ID, nome, endereco, localizacao e atribuicoes; sem telefone, site,
  fotos, avaliacoes, detalhes adicionais ou mapa JavaScript.
- Cidade incluida no texto da consulta: nao ha filtro por poligono municipal,
  geocodificacao, grade ou garantia de pertencimento/cobertura do municipio.
- Lista com atribuicao Google Maps e de terceiros; filtro textual local
  nao faz novas chamadas. Resultados Google nao aparecem no mapa ilustrativo.
- Resposta HTTP `no-store`; conteudo so em memoria da tela, removido ao sair,
  trocar de busca ou apos dez minutos. Esse prazo de exibicao nao e uma
  autorizacao de cache/retencao. Nao ha exportacao nem persistencia dos resultados.
- Favoritos/comentarios/overrides legados continuam funcionando para registros
  internos existentes. Esta etapa nao conecta essas anotacoes aos resultados
  temporarios Google e nao promove dados Google a dados internos.

## Franquia gratuita nao significa garantia de custo zero

Tabela global oficial consultada em 2026-10-29:

| SKU | Franquia mensal publicada |
| --- | --- |
| Text Search Pro | 5.000 eventos |
| Dynamic Maps | 10.000 eventos, nao utilizado nesta versao |

`displayName`, `formattedAddress` e `location` enquadram a consulta em Pro.
Cada pagina/consulta pode ser um evento; o portal requisita apenas uma pagina.
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
Nao usar consultas repetidas para varredura sistematica ou formar um diretorio.

Nao assumimos direito de armazenar todos os campos por um prazo generico.
O MVP nao grava nem mesmo IDs retornados: nomes/enderecos/coordenadas nao
entram no agregado do portal, recibos, auditoria ou logs da aplicacao.
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
- `googleSearchRequests`: recibo unico de solicitacao, ator/workspace/data,
  sem termo/cidade ou conteudo externo.

Mesmo timeout, erro do Google ou queda depois da reserva permanece contabilizado.
Nao ha reembolso de tentativa nem retry automatico: pode haver cobranca de
chamada em voo. Repetir UUID nao chama o Google novamente; retorna 409, pois
a resposta nao esta armazenada. Nova consulta exige nova confirmacao e UUID.
Os recibos/contadores sao pequenos metadados persistentes sem TTL nesta etapa;
nao os apague durante a janela em que protegem a alocacao e a idempotencia.

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
- [Politicas e atribuicao](https://developers.google.com/maps/documentation/places/web-service/policies)
- [Uso e faturamento](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing)
