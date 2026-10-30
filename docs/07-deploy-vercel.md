# Deploy e operacao na Vercel

## Plataforma suportada

O deploy do portal e realizado exclusivamente na Vercel, com preset Next.js,
Node.js 24.x e MongoDB Atlas externo. Frontend e API compartilham o projeto.
Desenvolvimento e testes podem rodar localmente com Node.js.

Dados persistem no Atlas, nao no filesystem das funcoes Vercel.
O banco deve suportar transacoes/replica set. A aplicacao reutiliza o pool
de conexoes por instancia. Google Places permite consulta explicita temporaria
ou coleta paginada com importacao no MongoDB. Chave, politicas e franquia
alocada exigem configuracao conforme [Google Places](09-google-places.md).
Vercel Workflow executa a coleta duravel. Varredura territorial continua
pendente. Salvar busca nao dispara consulta.

## 1. Criar credenciais

Siga o guia exclusivo [Credenciais para a Vercel](08-credenciais-vercel.md)
para configurar Google OAuth, segredo de sessao e usuarios MongoDB Atlas.
Nunca envie senhas, tokens ou URIs privadas no chat ou no repositorio.
Revogue a credencial Atlas anteriormente exposta antes de usar esse cluster.

## 2. Configurar o projeto Vercel

1. Importe o repositorio ou abra o projeto existente na Vercel.
2. Em Settings, confirme preset **Next.js**, raiz do projeto e Node.js **24.x**.
3. Mantenha instalacao e Output Directory nos padroes do framework.
   O build e `npm run build`; nao configure exportacao estatica ou servidor proprio.
4. Em **Settings > Environment Variables**, cadastre em **Production**:

| Variavel | Valor |
| --- | --- |
| `NEXTAUTH_URL` | `https://maps-ten-ruddy.vercel.app` |
| `GOOGLE_CLIENT_ID` | ID do cliente OAuth web |
| `GOOGLE_CLIENT_SECRET` | Segredo do mesmo cliente OAuth |
| `NEXTAUTH_SECRET` | Segredo aleatorio com pelo menos 32 caracteres |
| `AUTH_ALLOWED_EMAILS` | E-mails completos autorizados, separados por virgula |
| `MONGODB_URI` | URI privada atual do usuario de aplicacao Atlas |
| `MONGODB_DB_NAME` | `MAPS` |
| `PORTAL_WORKSPACE_ID` | `maps` |
| `GOOGLE_COLLECTION_ENABLED` | `false` |

Use valores diretos, sem aspas adicionais, prefixo `NEXT_PUBLIC_` ou variaveis
que apontem para arquivos de segredos. Configure Preview separadamente, com
credenciais e banco de teste, nunca os dados de producao.
Variaveis modificadas exigem um novo deploy para entrar em vigor.

### Execucao duravel com Vercel Workflow

A dependencia `workflow` e o wrapper `withWorkflow` no Next geram as rotas
internas do runtime no build. Na Vercel:

1. Em **Settings > Environment Variables**, habilite
   **Enable access to System Environment Variables**.
2. Publique um novo deploy, inclusive apos alterar essa opcao.
3. Confirme acesso a `VERCEL_DEPLOYMENT_ID` no runtime: o SDK seleciona
   automaticamente o World gerenciado da Vercel. Nao defina
   `WORKFLOW_TARGET_WORLD=local` em Production/Preview nem use filesystem
   efemero para a fila. Forcar `vercel` sem o ID nao corrige a configuracao.
4. Acompanhe as execucoes/etapas no painel de observabilidade Workflow
   da Vercel e os logs de funcoes. A confirmacao do POST nao significa
   que todas as etapas terminaram; o portal consulta o progresso no MongoDB.

Fila e journal duraveis sao gerenciados pela plataforma e possuem limites
e cobranca proprios, separados da cota Google. Revise plano, precos e limites
de execucao/eventos antes de producao. Somente jobId, indices, decisoes de
controle e erros entram no journal; chave Google, tokens de paginacao e
estabelecimentos nao sao argumentos/resultados das etapas.

Documentacao oficial: [Next.js](https://workflow-sdk.dev/docs/getting-started/next)
e [World Vercel](https://workflow-sdk.dev/worlds/vercel).

A flag de coleta e validada em `POST /api/v1/collection` e
`POST /api/v1/collection/run`, apos autenticacao e verificacao de origem,
e novamente antes de cada pagina duravel; nao bloqueia o build, login ou uso do
portal. Ausente ou `false` retorna 409 `COLLECTION_DISABLED`; `true` retorna
409 `COLLECTION_NOT_CONFIGURED` sem chave/revisao das politicas e
`COLLECTION_BUDGET_REQUIRED` sem franquia alocada. Configuracao completa permite
uma consulta sob demanda. Outro
valor retorna 503 `COLLECTION_CONFIGURATION_INVALID`. Ativar a flag nao
habilita uma fonte automaticamente nem inicia chamadas externas.

### Callback Google

No cliente OAuth do tipo Web, registre exatamente:

- Origem: `https://maps-ten-ruddy.vercel.app`
- Callback: `https://maps-ten-ruddy.vercel.app/api/auth/callback/google`

Para audiencia externa em Testing, adicione as contas em Test users.
O e-mail deve constar tambem em `AUTH_ALLOWED_EMAILS`.
Todos os usuarios autorizados compartilham o workspace configurado no servidor.

### Rede e acesso Atlas

O usuario da aplicacao deve ter `readWrite` somente no banco `MAPS`.
Obtenha a URI em Connect > Drivers, mantendo TLS/opcoes e codificando
caracteres reservados da senha. Nao utilize credencial administrativa na Vercel.

Autorize a origem de rede da migracao e a saida da Vercel no Atlas.
Nao presuma IP fixo nos planos sem essa opcao; escolha uma estrategia de
saida estatica ou rede privada compativel com o administrador.
Nao abra `0.0.0.0/0` indiscriminadamente.

## 3. Preparar o banco Atlas

A migracao cria validadores, indices e marcador `portal-v1`, sem apagar dados.
Execute separadamente do build e nunca por endpoint publico.

1. Crie usuario temporario com `dbAdmin` e `readWrite` somente em `MAPS`.
2. Autorize temporariamente a rede da maquina de migracao no Atlas.
3. Com Node 24, instale as dependencias: `npm.cmd ci`.
4. Crie localmente `.env.migrate`, ignorado pelo Git, contendo:

   ```dotenv
   MONGODB_URI=<URI privada do usuario temporario de migracao>
   MONGODB_DB_NAME=MAPS
   ```

5. Execute:

   ```powershell
   npm.cmd run db:migrate
   ```

6. Confirme `migration_completed`. O comando pode ser repetido.
   Nao cria usuarios ou replica set; utiliza o cluster Atlas existente.
7. Revogue o usuario temporario e remova o arquivo privado quando desnecessario.
   Na Vercel, mantenha somente a URI do usuario restrito da aplicacao.

## 4. Deploy e verificacao

Em **Deployments > deploy de producao > menu > Redeploy**, publique com as
variaveis novas. Confirme:

```powershell
curl.exe --fail https://maps-ten-ruddy.vercel.app/api/health
curl.exe --fail https://maps-ten-ruddy.vercel.app/api/ready
```

Liveness esperada: `{"status":"ok"}`. Readiness esperada:

```json
{"status":"ready","database":"ok","collection":"COLLECTION_DISABLED"}
```

Readiness verifica configuracao basica, ping Mongo e marcador de migracao,
e informa `on_demand` quando a configuracao Google esta completa, sem chama-la.
Isso nao comprova que o Google aceitou Client ID/Secret ou a chave Places. Teste login real,
criacao de busca, recarga e logout. Configure dominio HTTPS, protecao de
deploy, politicas e monitoramento adequados antes do uso publico.

## Desenvolvimento local e testes

Copie `.env.example` para `.env.local` somente se o destino nao existir.
Configure valores privados de desenvolvimento, URI de banco de teste e
`NEXTAUTH_URL=http://localhost:3000`. Registre o callback local no cliente
Google de desenvolvimento. Nao use dados ou credenciais de producao nos testes.

```powershell
npm.cmd ci
npm.cmd run dev
```

Para validacao:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
```

`npm start` pode conferir o build local, mas nao e o comando de deploy Vercel.
O Workflow local usa `.workflow-data/`, ignorado pelo Git, sem exigir conta
Vercel. Nao compartilhe esse diretorio com workers/processos concorrentes.
O backend local e para desenvolvimento, nao substitui a fila gerenciada.
`npm test` usa MongoDB temporario com replica set e pode baixar o binario
oficial no primeiro uso; nao utiliza o Atlas. `npm run test:integration`
executa somente a integracao.

Arquivos privados existentes nao sao migrados nem removidos automaticamente.
Revise seu ambiente conforme `.env.example`; so as variaveis diretas sao
consumidas. Nunca versione `.env*`, exceto o exemplo sem segredos.

## Backup, restauracao e operacao

Use recursos de backup/snapshots do Atlas compativeis com o plano e a politica
da organizacao; configure retencao, acesso e alertas. O deploy Vercel nao faz
backup dos dados. Teste restauracao em cluster isolado antes de depender dela.
Uma restauracao deve respeitar exclusoes legais e retencao de dados.
Nao ha backup ou restauracao automatica implementados pelo portal.

Coletas novas usam Workflow com reentrega de etapas e checkpoints
transacionais. Nao dependem de promessa solta apos o retorno HTTP.
Falha de agendamento e explicita e libera o cursor se o job nao iniciou.
Se uma etapa reentregue encontra chamada Google reservada sem pagina salva,
nao a reenvia: seu consumo e mantido e o cursor fica bloqueado.

Ao consultar o historico/progresso, jobs sem atividade ha pelo menos
15 minutos sao verificados. Com runId duravel, somente runs terminais
(failed/cancelled/completed) permitem recuperar um job ainda ativo no Mongo;
runs ativos nao sao encerrados pela idade. Jobs legados sem runId podem ser
marcados como interrompidos apos essa janela. A recuperacao preserva buffer,
logs e consumo, libera activeJobId e bloqueia continuacao incerta.
Resultados do buffer podem ser importados em nova execucao sem Google;
para consultar novamente apos um cursor incerto, crie outra busca.
Nao ha reinicio automatico de jobs legados nem estorno de chamadas.

## Diagnostico

- `AccessDenied`: confira conta verificada, audiencia/test users e allowlist.
- `redirect_uri_mismatch`: corrija esquema, hostname e callback exatos no Google.
- Readiness `CONFIGURATION_OR_DATABASE_UNAVAILABLE`: confira variaveis diretas,
  credenciais, privilegios e rede Atlas; consulte Function Logs sem expor segredos.
- Readiness `MIGRATION_REQUIRED`: execute a migracao com credencial temporaria.
- Erro 409: houve alteracao concorrente; recarregue antes de repetir.
- Falha de rede apos salvar: a escrita pode ter sido confirmada; recarregue
  antes de repetir uma acao nao idempotente.
- Erro 429: limite de 300 mutacoes por minuto/usuario; aguarde o proximo minuto.
- Consulta bloqueada: revise configuracao Google Places, politicas e parcela
  da franquia. Chave OAuth nao substitui a chave Places.
