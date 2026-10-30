# Plano de entrega e criterios de aceite

## Etapas

Fundacao de codigo: seguir [Estrutura e padroes](06-estrutura-e-padroes.md),
incluindo Next.js App Router, React/TypeScript estrito, Clean Code,
Arquitetura Limpa, SOLID e OO. Implementados: Next, login Google OAuth,
persistencia MongoDB transacional, API de comandos, auditoria, concorrencia,
migracao Atlas, configuracao Vercel e documentacao de credenciais.
Google Places integrado para consulta limitada em lista e memoria, com
confirmacao, reserva mensal e sem mapa pago. Falta configurar chave, revisar
politicas e alocar franquia compartilhada; nao houve consulta real de validacao.
Nao concluidos: catalogo/grade, coleta municipal,
worker, mapa cartografico e contratos normalizados/paginados.
Essas lacunas impedem afirmar atendimento integral de RF/CA ou prontidao de
producao. Foi escolhido Google para consultas explicitas; a parcela disponivel
da franquia compartilhada ainda precisa ser confirmada antes da ativacao.
Operacao em [Deploy na Vercel](07-deploy-vercel.md).

| Etapa | Entrega | Condicao para avancar |
| --- | --- | --- |
| 0. Viabilidade | Fonte, direitos de coleta/retencao, campos e orcamento definidos; senha rotacionada | Nao habilitar coleta Google sem aprovacao documentada |
| 1. Fundacao | Projeto, autenticacao, MongoDB, validadores, indices, catalogo municipal e ambientes | Conexao segura em homologacao, isolamento e migracoes testados |
| 2. Dashboard local | Abas persistentes, mapa/lista, filtros, comentarios, favoritos, edicao e ocultacao com dados sinteticos | Fluxo completo funcionando sem Places |
| 3. Motor de busca | Adaptador autorizado, grade, fila, paginacao, deduplicacao, checkpoint e limites | Testes deterministas com provedor simulado e retomada apos falha |
| 4. Piloto | "Aparelho Auditivo" em Belem/PA, sob limite aprovado | Relatorio de cobertura operacional, lacunas, custos e validade |
| 5. Publicacao | Monitoramento, politicas, backup/restauracao, acessibilidade e testes de carga | Criterios abaixo atendidos e operacao documentada |

Nao executar o piloto automaticamente durante a criacao do projeto. Coleta real depende de credenciais configuradas fora do chat, permissao de uso e confirmacao de gastos.

## Cenarios de aceite

| ID | Cenario | Resultado esperado |
| --- | --- | --- |
| CA-01 | Informar termo e selecionar Belem/PA | Busca salva com municipio inequivoco e versao territorial, sem chamada externa ate iniciar execucao |
| CA-02 | Iniciar coleta aprovada | Execucao assincrona com ID, limites e progresso consultavel; fechar navegador nao interrompe worker |
| CA-03 | Mesmo local em paginas/celulas diferentes | Um `place` por workspace/provedor/ID; um vinculo por busca e por execucao |
| CA-04 | Grade intercepta ilhas, distrito e fronteira | Todas as partes do poligono entram no plano; ponto externo e rejeitado; borda e incluida |
| CA-05 | Limite de resultados da fonte e atingido | Refinamento apenas se permitido e dentro do teto; lacunas e saturacao potencial ficam visiveis |
| CA-06 | Reabrir busca e navegar no dashboard | Zero chamadas a busca/detalhes Places; dados locais validos aparecem; carregamento do mapa e contabilizado separadamente |
| CA-07 | Abrir duas buscas de termos distintos | Abas e filtros independentes; recarregar restaura estado; fechar aba nao apaga busca |
| CA-08 | Comentar e favoritar | Persistencia apos recarregar e em outras buscas do mesmo estabelecimento, com autor e data |
| CA-09 | Editar telefone local e executar nova coleta | Override independente preservado; valor da fonte continua separado; remover override restaura somente dado ainda valido |
| CA-10 | Ocultar resultado na busca A | Some do mapa/lista padrao de A; continua em B e no banco; filtro Ocultos permite restaurar |
| CA-11 | Worker cai apos salvar pagina | Retomada por lease e checkpoint sem duplicar entidades; chamadas repetidas sao contabilizadas |
| CA-12 | Cota, timeout ou credencial invalida | Repeticao limitada apenas para falha recuperavel; pausa/falha explicita e resultados parciais preservados |
| CA-13 | Cancelar durante execucao | Nenhuma nova chamada apos observar cancelamento; resultados ja gravados continuam acessiveis |
| CA-14 | Snapshot vence antes da limpeza TTL | Nenhuma leitura devolve campos expirados; comentarios e favoritos continuam; nenhum refresh automatico |
| CA-15 | Usuario tenta ID de outro workspace | Nenhum dado e retornado ou alterado; cobrir todas as rotas, inclusive mapa e comentarios |
| CA-16 | Repetir inicio com mesma Idempotency-Key | Mesma execucao; payload diferente causa 409; inicio concorrente nao duplica trabalho ativo |
| CA-17 | Dois usuarios editam a mesma anotacao | Segunda escrita com versao antiga recebe 409, sem perda silenciosa |
| CA-18 | Nova execucao nao encontra local antigo | Local anterior e preservado e identificado como historico; nao e marcado automaticamente como fechado |
| CA-19 | Duas chamadas concorrentes perto do teto | Reserva atomica respeita limite; mapa e retries nao ficam fora da estimativa de consumo |
| CA-20 | Ponto sem coordenadas autorizadas ou mapa indisponivel | Item continua na lista com estado adequado; interface nao inventa marcador e nao fica inutilizavel |

## Estrategia de testes

- Unitarios: normalizacao de termos, grade MultiPolygon, pertencimento na borda, subdivisao limitada, estados e precedencia de overrides com proveniencia.
- Integracao em MongoDB de teste com replica set: indices unicos, transacoes, leases, checkpoints, isolamento, TTL com filtro de validade e concorrencia de orcamento.
- Contrato do adaptador com fixtures sinteticas: paginas repetidas, token expirado, 429, 5xx, resposta vazia, campos ausentes e identificadores diferentes para filiais.
- E2E com Playwright: duas abas de busca, mapa/lista sincronizados, comentario, favorito, edicao, ocultacao/restauracao, recarga e falha ao salvar em desktop e celular.
- Espiao de rede: apos semear dados permitidos e concluir execucao simulada, navegar por todas as telas e comprovar zero chamadas Places; permitir apenas chamadas de mapa base previstas.
- Retencao: testar remocao fisica, omissao imediata de campos expirados, logs e restauracao de backup.
- Carga local: aplicar a meta p95 descrita na arquitetura com massa sintetica; nao usar dados reais restritos como fixtures de longa duracao.

## Decisoes pendentes para implementacao

1. A fonte/contrato autoriza varredura municipal e a base pretendida? Se nao, qual fornecedor licenciado sera usado?
2. Quais campos precisam permanecer disponiveis e por quanto tempo? Consulta permanente sem refresh e obrigatoria para todos eles?
3. Qual teto de requisicoes e custo em moeda definida por busca e por mes? Quem pode aprovar aumento?
4. Stack Next/React/TypeScript, Google OAuth, Vercel e MongoDB Atlas confirmados.
   Falta configurar cliente Google, e-mails autorizados, hospedagem publica,
   worker e quantidade de usuarios.
5. Aprovar fonte e versao da malha municipal e a inclusao de todo o territorio de Belem, nao apenas a area urbana central.
6. Confirmar favoritos/comentarios compartilhados e ocultacao por busca, conforme regra proposta.

## Definicao de pronto

Todos os requisitos RF-01 a RF-14 devem ter evidencias de teste e todos os cenarios CA-01 a CA-20 devem passar. Nenhum segredo versionado; politicas de dados aprovadas e aplicadas; coleta desligada por padrao; custos limitados; documentacao operacional e restauracao verificadas. Lacunas de cobertura e limitacoes de retencao devem ser comunicadas sem prometer um inventario completo.