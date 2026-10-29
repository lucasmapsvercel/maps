# Execucao, MongoDB, Google OAuth e Docker

## O que esta implementado

- Portal Next.js/React/TypeScript, autenticado com Google OAuth via NextAuth.
- E-mails verificados e explicitamente permitidos pelo administrador.
- MongoDB autenticado no Compose, replica set de um membro, volumes persistentes,
  usuario da aplicacao separado do administrador, migracao e indices idempotentes.
- Buscas, favoritos, comentarios com autor, ajustes e ocultacao persistentes.
  Dados comerciais compartilhados no workspace; abas e filtros por usuario.
- API de comandos validada no servidor, transacoes, auditoria sem conteudo
  dos comentarios, controle de versao e protecao de origem nas mutacoes.
- Liveness e readiness separados; falha de banco nao substitui dados por demo.

**Ainda nao e um coletor de estabelecimentos pronto para producao.**
O responsavel informou que nao possui fonte autorizada nem limites aprovados.
Por isso, nao ha coleta real, worker de coleta, catalogo territorial ou mapa
cartografico. O banco comeca vazio; salvar busca nao descobre estabelecimentos.
Nao ha semeadura sintetica automatica nem importacao silenciosa do localStorage.
Os dados do demonstrador antigo permanecem no navegador, sem serem enviados.
Consulte as pendencias de aceite em [Entrega](05-entrega-e-aceite.md).

## 1. Preparar o ambiente privado

Requisitos: Node.js 24 para a preparacao, Docker Desktop iniciado com containers
Linux e Docker Compose v2. Nenhuma senha precisa ser enviada no chat.

Na raiz, no PowerShell:

```powershell
npm.cmd ci
npm.cmd run setup:docker
```

O comando cria `.env` somente se nao existir e gera segredos aleatorios em
`.secrets`. Nao sobrescreve senhas existentes nem mostra os valores.
O arquivo do client secret Google e criado vazio, para preenchimento privado.
Se ja havia `.env`, acrescente as chaves de `.env.example`.

No Linux, `.secrets` tem permissao 0700 e os arquivos 0644: o diretorio impede
acesso de outros usuarios do host, enquanto o bind mount individual de secrets
permite leitura pelo usuario nao root do portal. Nao torne o diretorio publico.
No Windows, restrinja as ACLs da pasta ao responsavel/administrador. Secrets
locais do Compose nao sao um cofre criptografado. Restrinja tambem acesso ao
daemon Docker e mantenha copia protegida dos segredos para recuperacao.

Nao versione `.env`, `.secrets`, `.backups`, `.next` ou `node_modules`.
A URI Atlas exposta anteriormente nao foi utilizada e deve ser revogada.

## 2. Criar as credenciais Google OAuth

Google OAuth identifica usuarios; **nao e a API Places** e nao habilita coleta.
Nao e necessario configurar Places, Maps ou faturamento para este login.

1. Acesse [Google Cloud Console](https://console.cloud.google.com/) com a conta
   responsavel e selecione/crie um projeto da organizacao.
2. Abra **Google Auth Platform**. Configure Branding, Audience e Data Access
   (em interfaces anteriores: APIs & Services / OAuth consent screen).
3. Configure nome da aplicacao, e-mail de suporte e contato do responsavel.
   Para teste, use audiencia externa em Testing e adicione os test users.
   Uma audiencia interna so atende usuarios da organizacao Workspace escolhida.
4. Solicite apenas `openid`, `email` e `profile`. Nao solicite escopos Places.
5. Em **Clients**, crie cliente OAuth de tipo **Web application**.
6. Para o endereco local padrao, registre exatamente:
   - Authorized JavaScript origin: `http://localhost:3000`
   - Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
7. Coloque o Client ID em `GOOGLE_CLIENT_ID` no `.env`.
8. Grave somente o Client Secret em `.secrets/google-client-secret.txt`,
   sem aspas ou formato JSON. Nao envie esse valor ao chat.
9. Em `.env`, configure `AUTH_ALLOWED_EMAILS` com e-mails completos, separados
   por virgula. Todos eles acessam o mesmo workspace. Nao ha cadastro publico.
10. Mantenha `NEXTAUTH_URL=http://localhost:3000`. Porta, hostname e origem devem
    coincidir com o navegador e o cliente Google. `127.0.0.1` e `localhost`
    nao sao a mesma origem.

Para homologacao/producao, registre as origens e callbacks HTTPS reais,
configure audiencia/publicacao/verificacao conforme o console exigir e
publique as politicas de privacidade/uso da organizacao. Use credenciais
separadas para desenvolvimento e producao.

Referencia: [OAuth para aplicacoes web](https://developers.google.com/identity/protocols/oauth2/web-server).

## 3. Iniciar no Docker

```powershell
docker compose config --quiet
docker compose up --build -d
docker compose ps -a
docker compose logs --tail 100 mongo-init portal
curl.exe --fail http://localhost:3000/api/ready
```

Abra <http://localhost:3000> e entre com uma conta autorizada.
O fluxo e `mongo healthy -> mongo-init concluido -> portal ready`.
O init configura `rs0`, cria o usuario `maps` com `readWrite` somente no banco
escolhido e aplica migracoes. Nao e necessario iniciar replica set manualmente.
MongoDB nao publica porta no host e fica em rede interna.

Readiness esperada:

```json
{"status":"ready","database":"ok","collection":"blocked"}
```

`GET /api/health` retorna `{"status":"ok"}` e testa somente processo.
`GET /api/ready` retorna 503 se configuracao, banco ou migracao faltarem;
nao comprova que o Client ID/Secret foram aceitos pelo Google. Valide login real.
O portal roda como usuario nao root, com filesystem somente leitura e sem
capabilities. Somente o init recebe o segredo administrativo do MongoDB.

Para encerrar e reiniciar sem perder dados:

```powershell
docker compose down
docker compose up -d
```

**Nao use `down -v`**: volumes contem o banco. Nao apague `.secrets` para
"reiniciar": os usuarios persistidos continuam usando as senhas anteriores.
Rotacao deve ser feita no banco e nos arquivos em procedimento coordenado.
Um replica set de um membro suporta transacoes, mas nao oferece alta
disponibilidade nem substitui backups/Atlas em producao.

Para trocar a porta, atualize `PORTAL_PORT`, `NEXTAUTH_URL` e callbacks Google.
Mantenha `PORTAL_BIND_ADDRESS=127.0.0.1` ate configurar HTTPS/reverse proxy.

## Variaveis e segredos

| Chave | Uso |
| --- | --- |
| `NEXTAUTH_URL` | Origem publica exata; HTTP somente loopback, HTTPS nos demais casos |
| `GOOGLE_CLIENT_ID` | ID do cliente OAuth web, nao e chave Places |
| `AUTH_ALLOWED_EMAILS` | Allowlist obrigatoria de contas Google verificadas |
| `PORTAL_WORKSPACE_ID` | Workspace confiavel do servidor; nao e recebido do cliente |
| `MONGODB_DB_NAME` | Banco da aplicacao; padrao `MAPS` |
| `PORTAL_PORT` / `PORTAL_BIND_ADDRESS` | Publicacao de porta Docker |
| `NEXTAUTH_SECRET_FILE` | Segredo aleatorio de sessao, montado pelo Compose |
| `GOOGLE_CLIENT_SECRET_FILE` | Segredo OAuth montado pelo Compose |
| `MONGODB_PASSWORD_FILE` | Senha do usuario `maps`, nao a senha root |
| `MONGODB_URI` | Alternativa privada ao Mongo local para execucao fora deste Compose |
| `BUILD_STANDALONE` | Builder Docker define `true`; nao usar na Vercel |
| `GOOGLE_COLLECTION_ENABLED` | Deve ser `false`; ativacao nao implementada e rejeitada |

O Compose monta somente os secrets necessarios em cada servico. Nao envie
segredos como build args. O contexto Docker exclui `.env` e `.secrets`.
Fora do Docker, segredos aceitam a variavel direta ou `*_FILE`; arquivo tem
precedencia. Nunca use `NEXT_PUBLIC_` para banco, OAuth secret ou sessao.

## Backup e restauracao

O servico Mongo inclui os scripts abaixo. Eles usam configuracao temporaria
privada para nao inserir senha na linha de comando e a removem ao terminar.
O backup inclui o banco escolhido, views, auditoria e marcador de migracao;
nao inclui os secrets do host. Proteja ambos e teste restauracao isolada.

```powershell
docker compose stop portal
docker compose exec mongo sh /opt/maps/mongo-backup.sh
New-Item -ItemType Directory -Force .backups
docker compose cp mongo:/backups/maps.archive.gz .backups\maps.archive.gz
docker compose up -d portal
```

As escritas devem estar interrompidas durante o dump: o backup de um banco
especifico nao e snapshot consistente com escritas concorrentes em colecoes.
O arquivo no volume de backups e sobrescrito a cada execucao; copie/versione
os arquivos em armazenamento protegido conforme a politica da organizacao.
Nao coloque backups no Git.

**Restauracao destrutiva**, somente apos aprovacao do responsavel e backup
atual: para o banco padrao `MAPS`, interrompa escritas do portal e execute:

```powershell
docker compose stop portal
docker compose cp .backups\maps.archive.gz mongo:/backups/maps.archive.gz
docker compose exec -e CONFIRM_RESTORE=MAPS mongo sh /opt/maps/mongo-backup.sh restore
docker compose run --rm mongo-init
docker compose up -d portal
```

O script usa `--drop` somente nas colecoes do banco selecionado. Se mudou
`MONGODB_DB_NAME`, use esse nome na confirmacao. Nunca teste restauracao
pela primeira vez no banco de producao. Backup/restore via containers
exige verificacao operacional no ambiente com Docker.

## Node local e Vercel

Fora do Compose, forneca MongoDB autenticado com replica set acessivel
ao processo Node, execute a migracao com credencial administrativa em ambiente
controlado e configure `MONGODB_URI`, OAuth, allowlist e segredo de sessao.
O hostname `mongo` do Compose nao e resolvido pelo Windows.
O fluxo de referencia completo desta entrega e o Compose.

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
npm.cmd start
```

`npm test` executa integracao com MongoDB temporario de teste, incluindo replica
set; o primeiro uso pode baixar o binario oficial. Nao usa o Atlas nem banco
de producao. `npm run test:integration` executa apenas a integracao.

Na Vercel, use preset Next.js/Node 24, sem `BUILD_STANDALONE` ou Docker.
Use Atlas ou outro Mongo acessivel por TLS, replica set e banco ja migrado.
Cadastre variaveis de servidor diretamente no painel, incluindo
`MONGODB_URI`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_SECRET`, ID OAuth, allowlist e
`NEXTAUTH_URL` HTTPS. Registre o callback desse dominio no Google.
Nao houve deploy automatico nem configuracao de rede Atlas nesta entrega.

## Diagnostico

- Compose informa chave ausente: preencha `.env` conforme o exemplo.
- Login `AccessDenied`: confira e-mail verificado, allowlist e test users Google.
- `redirect_uri_mismatch`: corrija esquema, hostname, porta e callback exatos.
- Init falha: consulte `mongo-init`; confira secrets originais, replica set,
  volumes, espaco em disco e autenticacao. Nao apague volumes como solucao.
- Readiness 503: confira secrets preenchidos, migracao e conexao do app.
- Erro 409: outra sessao alterou os dados; recarregue antes de repetir.
  Rascunhos sao preservados na tela enquanto o erro e exibido.
- Falha de rede apos salvar: a escrita pode ter sido confirmada; recarregue
  antes de repetir uma acao nao idempotente.
- Erro 429: limite de 300 mutacoes por minuto/usuario; aguarde o proximo minuto.
- Sem resultados: nao ha fonte de estabelecimentos configurada. Nao e falha
  do MongoDB e nao e resolvido criando uma chave OAuth.
