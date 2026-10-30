# Seguranca, configuracao e uso de dados

## Acao imediata sobre a credencial

A URI MongoDB informada na conversa contem usuario e senha. Tratar a senha como exposta: rotacionar ou revogar a credencial no Atlas antes de usar esse cluster. Nao repetir a URI em documentos, commits, tickets, logs ou exemplos. Configure uma credencial nova e restrita diretamente na Vercel.

Provisionar usuario de aplicacao dedicado ao banco `MAPS`, com privilegios minimos. Separar usuario de migracao/administracao. Restringir a lista de acesso de rede aos enderecos necessarios, sem liberar indiscriminadamente a internet. Manter TLS com validacao de certificados.

## Variaveis propostas

As variaveis de provedores abaixo sao propostas para a integracao futura. As chaves atualmente
consumidas, o `.env.example`, as variaveis privadas na Vercel e o passo a
passo para rotacionar/provisionar o acesso Atlas estao em
[Deploy na Vercel](07-deploy-vercel.md). O backend exige
`MONGODB_URI` privada explicita; nao compoe conexoes a partir de senhas avulsas.
O navegador nunca recebe URI ou credenciais.

Exemplo documental com placeholders; nao e uma configuracao pronta para executar:

```dotenv
MONGODB_URI=mongodb+srv://<usuario>:<senha-codificada>@<cluster>/MAPS?retryWrites=true&w=majority
MONGODB_DB_NAME=MAPS
GOOGLE_PLACES_API_KEY=<chave-exclusiva-do-backend>
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=<chave-publica-restrita-por-dominio>
NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=<map-id>
NEXTAUTH_SECRET=<segredo-de-sessao-gerado-no-ambiente>
GOOGLE_COLLECTION_ENABLED=false
```

A URI SRV so deve ser usada se fornecida pelo Atlas para o cluster real. Caso seja usada a URI padrao com hosts e replica set, obter seu valor atualizado diretamente no Atlas e manter as opcoes TLS e autenticacao corretas. Nao inferir hosts a partir deste exemplo. Codificar caracteres reservados em usuario e senha conforme o formato URI.

Segredos reais devem ser inseridos diretamente pelo responsavel no ambiente seguro ou gerenciador de segredos. Nunca solicitar que sejam colados no chat. Nao expor `MONGODB_URI`, chave Places ou segredo de sessao no bundle frontend.

Na implementacao, ignorar arquivos de ambiente locais no Git e versionar apenas exemplo sem valores reais. A chave de mapa no navegador e visivel por natureza: restringir por dominio e APIs permitidas. Chave Places deve ter restricoes adequadas ao backend e cotas.

## Politica de fonte e retencao

A consulta Google explicita implementada usa resposta temporaria em memoria,
sem persistir nomes, enderecos ou coordenadas. Politicas, configuracao de
franquia compartilhada e limites estao em [Google Places](09-google-places.md).
Nao habilita varredura territorial, exportacao ou base comercial permanente.

Antes de habilitar Google, registrar aprovacao para o caso concreto: busca sistematica por cidade, armazenamento, constituicao de base, exibicao, periodos de cache e eventual exportacao. Revisar restricoes sobre scraping, prefetching, caching, criacao de conteudo/base a partir do Google e usos substitutivos dos servicos. O projeto nao presume que a grade territorial ou a base comercial sao permitidas pelo contrato padrao.

| Tipo de dado | Tratamento proposto |
| --- | --- |
| Google Place ID | Pode ser armazenado indefinidamente conforme politica publicada; prever verificacao de IDs desatualizados |
| Nomes, enderecos, telefones, site, notas e categorias do Google | Nao presumir armazenamento permanente nem cache generico; persistir apenas com autorizacao aplicavel documentada por campo |
| Coordenadas do provedor | Aplicar regras especificas do servico/contrato; nao generalizar eventual permissao temporaria para outros campos |
| Fotos e avaliacoes publicas | Fora do MVP; se adicionadas, revisar armazenamento, autoria, atribuicao e links obrigatorios |
| Comentarios, favoritos e preferencias internas | Persistencia propria, sujeita a controles de acesso, LGPD e politica interna |
| Dados de fonte independente licenciada | Seguir licenca e proveniencia dessa fonte, sem disfarcar copia de conteudo Google |

Nao configurar "30 dias para tudo". O prazo depende do campo, servico, contrato e finalidade. A configuracao de retencao e condicao de ativacao, nao uma decisao a adiar para depois da coleta.

Se um campo nao puder ser retido, nao sera possivel prometer sua exibicao futura sem nova obtencao autorizada. Para cumprir consulta permanente completa sem repetir buscas, contratar fonte com esse direito ou rever o requisito. Comentarios e favoritos continuam disponiveis independentemente dos snapshots.

Usar Google Maps para exibir sobre mapa os dados Places quando exigido pelos termos aplicaveis. Preservar atribuicoes Google Maps e de terceiros, inclusive em listas e detalhes conforme necessario. Nao assumir que trocar para Leaflet/OSM torna licito reutilizar conteudo Google.

## Autenticacao e privacidade

Implementado: NextAuth com Google OAuth, cookies HttpOnly/SameSite e Secure
em HTTPS (HTTP somente em loopback), e-mails verificados/allowlist revisada
em cada acesso de negocio, origem exata nas mutacoes, JSON estrito e limitado,
autoria confiavel, versao/409, recibos idempotentes e auditoria sem conteudo.
Nao ha cadastro aberto nem gestao de papeis pela interface; todos os e-mails
autorizados compartilham um workspace definido pelo servidor.
Somente o processo de migracao recebe credencial temporaria com dbAdmin e
readWrite no banco especifico; a Vercel recebe apenas o usuario readWrite da
aplicacao. Acesso de rede Atlas deve ser restrito. TLS para o banco e HTTPS
publico permanecem obrigatorios. Rate limit de mutacoes: 300/minuto/usuario.
As obrigacoes operacionais e legais abaixo continuam exigindo aprovacao e teste.

- Sessoes seguras com cookies HttpOnly, Secure e politica SameSite adequada; protecao CSRF nas mutacoes quando aplicavel.
- Autorizacao no backend em todos os IDs, inclusive comentarios, execucoes e consultas geograficas. Nao confiar em filtros do frontend para isolamento.
- Validacao por lista de campos permitidos; rejeitar operadores MongoDB enviados pelo usuario e evitar regex arbitraria.
- Limites por usuario/workspace, protecao contra XSS e registro de alteracoes administrativas.
- Comentarios nao devem conter dados sensiveis de saude, pacientes ou consumidores. O termo "Aparelho Auditivo" nao autoriza coletar informacoes pessoais sobre deficiencia ou tratamento.
- Contatos comerciais podem identificar pessoas naturais; definir finalidade, base legal, minimizacao, acesso e atendimento a direitos conforme LGPD.
- Publicar politica de privacidade e termos do portal; definir retencao de dados internos, auditoria, backups e procedimento de exclusao legal. Ocultacao de interface nao equivale a exclusao para fins legais.
- Testar restauracao de backup e garantir que uma restauracao nao volte a disponibilizar conteudo expirado ou excluido.

## Referencias oficiais

Consultadas em 2026-10-29; revisar novamente antes da implementacao e de mudancas contratuais. Esta especificacao nao substitui validacao juridica.

- [Politicas da Places API](https://developers.google.com/maps/documentation/places/web-service/policies)
- [Text Search (New)](https://developers.google.com/maps/documentation/places/web-service/text-search)
- [Cotas e cobranca](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing)
- [Termos Google Maps Platform](https://cloud.google.com/maps-platform/terms)
- [Termos especificos dos servicos](https://cloud.google.com/maps-platform/terms/maps-service-terms)
- [Gerenciamento de Place IDs](https://developers.google.com/maps/documentation/places/web-service/place-id)