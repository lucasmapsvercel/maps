# Criacao de credenciais para a Vercel

Guia exclusivo para criar e cadastrar as credenciais do portal publicado em:

**https://maps-ten-ruddy.vercel.app**

O deploy e realizado exclusivamente na Vercel. Nao envie senhas,
Client Secrets, segredos de sessao ou URIs com credenciais no chat. Insira
os valores diretamente na Vercel ou no ambiente privado indicado.

## 1. O que sera necessario

| Item | Onde criar | Variavel na Vercel |
| --- | --- | --- |
| Client ID OAuth web | Google Cloud | `GOOGLE_CLIENT_ID` |
| Client Secret OAuth web | Google Cloud | `GOOGLE_CLIENT_SECRET` |
| Segredo aleatorio de sessao | Computador local | `NEXTAUTH_SECRET` |
| Usuario/senha e URI do banco | MongoDB Atlas | `MONGODB_URI` |
| Usuario temporario de migracao | MongoDB Atlas | Nao cadastrar na Vercel |

O Google OAuth autentica usuarios. Nao fornece estabelecimentos nem habilita
Places ou Maps. Nenhuma chave Places/Maps, token pessoal GitHub ou token Vercel
e necessario para login e persistencia. A consulta opcional de estabelecimentos
exige chave Places separada, conforme [Google Places](09-google-places.md).

## 2. Google OAuth: Client ID e Client Secret

### 2.1. Preparar o projeto e a audiencia

1. Abra o [Google Cloud Console](https://console.cloud.google.com/).
2. Selecione o projeto correto ou crie um projeto da organizacao.
3. Acesse **Google Auth Platform**.
   Na interface antiga, use **APIs e servicos > Tela de permissao OAuth**.
4. Configure **Branding**: nome da aplicacao, e-mail de suporte e contato
   do responsavel. Preencha os demais campos exigidos pelo console.
5. Em **Audience**, selecione a audiencia adequada:
   - **Internal**: somente usuarios da organizacao Google Workspace elegivel.
   - **External / Testing**: adicione as contas permitidas em **Test users**.
6. Em **Data Access**, solicite somente os escopos de identidade:
   `openid`, `email` e `profile`.

Para publicar para uma audiencia mais ampla, siga as exigencias de publicacao,
dominios, privacidade e verificacao apresentadas pelo Google. Nao e necessario
habilitar Places ou faturamento Maps para o login.

### 2.2. Criar o cliente web

1. Acesse **Google Auth Platform > Clients > Create client**.
   Na interface antiga: **APIs e servicos > Credenciais > Criar credenciais >
   ID do cliente OAuth**.
2. Escolha **Web application / Aplicativo da Web**.
3. Defina um nome, por exemplo `MAPS - Vercel Production`.
4. Em **Authorized JavaScript origins / Origens JavaScript autorizadas**, adicione:

   ```text
   https://maps-ten-ruddy.vercel.app
   ```

5. Em **Authorized redirect URIs / URIs de redirecionamento autorizados**, adicione:

   ```text
   https://maps-ten-ruddy.vercel.app/api/auth/callback/google
   ```

6. Salve e copie os valores para o painel da Vercel:
   - Client ID -> `GOOGLE_CLIENT_ID`
   - Client Secret -> `GOOGLE_CLIENT_SECRET`

O callback nao e o Client ID: e o endereco completo ao qual o Google devolve
o usuario apos autenticar. Nao troque por `/login`, nao acrescente barra final
e nao use HTTP no deploy publico.

Se esqueceu o callback, abra **Clients**, clique no cliente existente,
adicione a URI na secao de redirecionamento e salve. Nao e necessario criar
outro cliente. Mudancas podem levar alguns minutos para entrar em vigor.
Alterar somente a configuracao Google nao exige redeploy.

Se o console permitir baixar um JSON com as credenciais, trate-o como segredo:
nao coloque no repositorio. Se o segredo nao estiver mais disponivel, use
o fluxo de criacao/rotacao de segredo oferecido pelo console e atualize a Vercel.

Referencia: [Google OAuth para aplicacoes web](https://developers.google.com/identity/protocols/oauth2/web-server).

## 3. Gerar NEXTAUTH_SECRET

Em um terminal local com Node.js instalado, execute:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copie o resultado diretamente para `NEXTAUTH_SECRET` na Vercel, sem aspas,
espacos ou quebras de linha. Esse comando gera 32 bytes aleatorios em
hexadecimal; nao use uma senha curta, e-mail ou Client Secret no lugar.

Guarde em um gerenciador de segredos. Nao gere novamente a cada build:
trocar esse valor invalida as sessoes existentes. Use valores diferentes
para Production e Preview.

## 4. MongoDB Atlas: credencial da aplicacao

**Revogue ou rotacione primeiro a credencial compartilhada anteriormente.**
Nao reutilize essa senha ou URI.

1. Abra o [MongoDB Atlas](https://cloud.mongodb.com/) e selecione o projeto.
2. Crie ou selecione um cluster compativel com transacoes/replica set.
3. Acesse **Security > Database Access > Add New Database User**
   (os nomes podem variar conforme a interface).
4. Escolha autenticacao por senha e um usuario exclusivo para a aplicacao,
   por exemplo `maps_portal`.
5. Gere uma senha forte e armazene-a em um gerenciador de segredos.
6. Em privilegios especificos, atribua **`readWrite` somente ao banco `MAPS`**.
   Nao conceda administracao do cluster ou acesso a todos os bancos.
7. Em **Connect > Drivers**, selecione o driver Node.js e copie a URI
   fornecida pelo proprio Atlas.
8. Substitua os placeholders pelo usuario/senha e selecione `MAPS` como banco
   da aplicacao. Preserve TLS e opcoes de conexao/autenticacao fornecidas.
9. Codifique caracteres reservados do usuario/senha conforme o formato URI.
   Nao codifique a URI inteira nem use codificadores online para senhas.
10. Cadastre a URI final como `MONGODB_URI` na Vercel.

Use o hostname atual fornecido pelo Atlas. O nome `MAPS` da
aplicacao nao significa que o banco de autenticacao deva ser alterado:
preserve o `authSource` indicado pelo Atlas.

Em **Security > Network Access**, permita as origens de rede necessarias.
A saida da Vercel pode ser dinamica; nao presuma um IP fixo do seu computador.
Defina com o administrador uma opcao compativel, como saida estatica ou rede
privada suportada pelo plano. Nao libere `0.0.0.0/0` indiscriminadamente.
Permita tambem a origem da maquina que executara a migracao, pelo tempo necessario.

### 4.1. Credencial temporaria para preparar o banco

A aplicacao nao deve receber privilegios administrativos. Para executar
a migracao inicial, crie outro usuario temporario no Atlas:

- Privilegios **`dbAdmin` e `readWrite` somente em `MAPS`**.
- Senha diferente da senha da aplicacao.
- URI mantida somente no ambiente privado de migracao.
- Nunca cadastrar essa URI na Vercel.

O uso dessa credencial, o comando `npm.cmd run db:migrate` e a preparacao do
arquivo privado `.env.migrate` estao no
[guia Vercel, secao de migracao](07-deploy-vercel.md#3-preparar-o-banco-atlas).
Depois de concluir a migracao, revogue o usuario temporario e remova o arquivo
privado quando nao for mais necessario.

## 5. Cadastrar na Vercel

Abra **Vercel > Projeto > Settings > Environment Variables** e selecione
**Production**. Cadastre as credenciais reais, sem aspas adicionais:

| Variavel | Valor |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Client ID do cliente OAuth web criado no Google |
| `GOOGLE_CLIENT_SECRET` | Client Secret desse mesmo cliente |
| `NEXTAUTH_SECRET` | Valor aleatorio gerado na etapa 3 |
| `MONGODB_URI` | URI do usuario da aplicacao, nao do usuario de migracao |

Use a opcao de valor sensivel/oculto quando disponivel. Nao coloque esses
valores em arquivos versionados, comandos de build ou variaveis `NEXT_PUBLIC_*`.

As configuracoes abaixo **nao sao credenciais**, mas tambem sao necessarias:

| Variavel | Valor |
| --- | --- |
| `NEXTAUTH_URL` | `https://maps-ten-ruddy.vercel.app` |
| `AUTH_ALLOWED_EMAILS` | E-mails completos autorizados, separados por virgula |
| `MONGODB_DB_NAME` | `MAPS` |
| `PORTAL_WORKSPACE_ID` | `maps` |
| `GOOGLE_COLLECTION_ENABLED` | `false` |

Todos os e-mails autorizados compartilham o workspace configurado. Se o
cliente Google estiver em Testing, adicione essas contas tambem aos Test users.
Nao ha cadastro publico automatico.

Configure os segredos como valores diretos, nao como caminhos de arquivos.
Configure Preview separadamente, sem compartilhar credenciais
ou banco de producao. Cada origem de login precisa de callback autorizado.

## 6. Checklist de conclusao

- [ ] Credencial Atlas exposta revogada.
- [ ] Cliente OAuth do tipo Web, com origem e callback exatos.
- [ ] Client ID e Client Secret pertencem ao mesmo cliente Google.
- [ ] Conta de teste permitida no Google e em `AUTH_ALLOWED_EMAILS`.
- [ ] `NEXTAUTH_SECRET` aleatorio cadastrado e protegido.
- [ ] URI da aplicacao usa usuario restrito ao banco `MAPS`.
- [ ] Rede Atlas permite o acesso autorizado da Vercel.
- [ ] Banco preparado com credencial temporaria, depois revogada.
- [ ] Variaveis salvas em Production e novo Redeploy executado.
- [ ] Login, recarga e logout testados no dominio publicado.

Alterar variaveis na Vercel exige novo deploy para aplica-las.
Se `/api/ready` responder `ready`, a configuracao basica e o banco estao
acessiveis; isso nao confirma que o Google aceitou as credenciais.
Teste o login real separadamente.

Em `redirect_uri_mismatch`, revise a URI completa do callback.
Em `AccessDenied`, revise e-mail verificado, audiencia/test users e allowlist.
Se um segredo vazar, rotacione no fornecedor, atualize a Vercel e faca Redeploy;
apenas apagar a mensagem ou o arquivo nao revoga a credencial.
