# Produto e requisitos

## Objetivo e premissas

Permitir descobrir estabelecimentos relacionados a um termo em um municipio, organizar conjuntos de resultados independentes e acompanhar cada estabelecimento sem repetir a coleta a cada visita ao dashboard.

Proposta de MVP: portal privado, usuarios autenticados e uma organizacao compartilhada. Todas as entidades devem carregar `workspaceId` para isolamento e evolucao futura. Administrador configura integracoes e acessos; operador pesquisa e organiza resultados; leitor apenas consulta.

Termos livres representam intencao de busca, nao correspondencia literal garantida. "Aparelho Auditivo" pode retornar clinicas, fornecedores e lojas relacionadas. O operador pode marcar um resultado como nao relevante e oculta-lo, sem alterar a resposta original da fonte.

## Requisitos funcionais

| ID | Requisito | Regra verificavel |
| --- | --- | --- |
| RF-01 | Criar busca por termo e cidade | Termo obrigatorio de 2 a 200 caracteres; cidade com identificador, UF, pais e poligono confirmado |
| RF-02 | Planejar cobertura municipal | Incluir partes continentais, ilhas e distritos pertencentes ao municipio; nao usar apenas o centro ou a regiao metropolitana |
| RF-03 | Coletar em segundo plano | Persistir execucao, progresso, unidades territoriais, falhas e limites |
| RF-04 | Salvar resultados | Deduplicar por identificador do provedor e manter origem e validade dos campos |
| RF-05 | Consultar busca salva | Navegacao, filtros e abertura de detalhes nao iniciam coleta externa |
| RF-06 | Exibir mapa e lista | Mesmos filtros, selecao sincronizada e agrupamento de marcadores |
| RF-07 | Comentar resultado | Comentarios internos com autor, data, edicao e exclusao autorizada |
| RF-08 | Favoritar resultado | Estado compartilhado no workspace; preservado em novas coletas |
| RF-09 | Editar resultado | Alteracoes locais separadas dos campos do provedor; permitir remover uma alteracao local |
| RF-10 | Ocultar sem excluir | Ocultacao por busca, reversivel, sem apagar estabelecimento, vinculo ou comentarios |
| RF-11 | Trabalhar com varias buscas | Abas de buscas salvas com estado persistente; fechar aba nao exclui a busca |
| RF-12 | Atualizar explicitamente | Criar outra execucao, confirmar custos e preservar historico e organizacao local |
| RF-13 | Controlar execucao | Cancelar e retomar trabalho pendente sem duplicar resultados |
| RF-14 | Filtrar dados locais | Nome, favoritos, visibilidade e regiao quando disponivel; paginacao e ordenacao estaveis |

## Abas e navegacao

- **Nova busca**: termo, municipio, variacoes opcionais do termo, campos desejados e limite de requisicoes/custo.
- **Buscas salvas**: lista persistente com termo, municipio, ultima execucao, contagem e situacao.
- **Abas de resultados**: uma por busca aberta, por exemplo `Aparelho Auditivo - Belem` e `Farmacia - Belem`. Cada aba preserva filtros, selecao e enquadramento do mapa por usuario.
- **Favoritos**: estabelecimentos unicos favoritados no workspace, com referencia as buscas de origem.
- **Configuracoes**: acessos, limites, integracoes e politicas de dados; somente administrador.

Tipos de busca do MVP: termo livre por municipio, consulta local aos resultados salvos e favoritos. Outras modalidades de coleta devem ganhar formularios proprios e reutilizar os mesmos contratos de resultados; nao fazem parte do MVP.

## Dashboard da busca

Cabecalho com termo, cidade, fonte, ultima coleta, validade dos dados e situacao da execucao. Contadores separados: encontrados unicos, visiveis, ocultos, favoritos e sem coordenadas utilizaveis. Contadores devem informar se representam a busca inteira ou o filtro atual.

Area principal com mapa e tabela. No desktop, exibicao lado a lado; no celular, alternancia entre mapa e lista. Mover ou ampliar o mapa nao dispara coleta: apenas altera a consulta local por area visivel. Informar quando o limite de marcadores exigir aproximar o mapa; nunca omitir pontos silenciosamente.

Detalhe do estabelecimento: nome, endereco, coordenadas, telefone, site, categoria, situacao comercial, nota e quantidade de avaliacoes, quando fornecidos e permitidos. Ausencia deve aparecer como indisponivel, nunca como dado inventado. Comentarios internos nao sao avaliacoes publicadas no Google.

Acoes: favorito, editar dados locais, comentar, ocultar/restaurar nesta busca e abrir no Google Maps. O link externo nao e necessario para consultar o registro salvo.

Filtros de visibilidade: `Visiveis` por padrao, `Ocultos` e `Todos`. Um resultado oculto nao aparece no mapa nem na tabela padrao; restaurar recupera sua exibicao. Favoritar um resultado oculto nao o restaura automaticamente.

## Regras de propriedade dos dados

- Comentarios, favoritos e alteracoes locais pertencem ao estabelecimento no workspace e aparecem em todas as buscas que o contenham.
- Ocultacao pertence ao vinculo estabelecimento-busca e nao interfere em outras buscas.
- Atualizacoes da fonte nunca sobrescrevem comentarios, favoritos, ocultacao ou alteracoes locais.
- Um campo digitado manualmente deve ter proveniencia independente. Copiar um dado do Google para um campo local nao remove as restricoes de origem.
- Nova execucao nao apaga registros ausentes na resposta; ausencia nao comprova fechamento. Registrar `lastSeenAt` e diferenciar encontrado nesta execucao de historico acumulado.

## Estados e acessibilidade

Prever carregamento, nenhum resultado, fonte indisponivel, falha parcial, cota excedida, cancelamento e dados expirados. Permitir consultar resultados ja persistidos durante a execucao. Progresso territorial nao deve ser apresentado como percentual de estabelecimentos encontrados.

Operacoes devem funcionar por teclado; botoes de icone precisam de nome acessivel e tooltip; favoritos, falhas e ocultacao nao podem depender somente de cor. Falhas ao salvar nao devem exibir sucesso nem descartar silenciosamente o texto digitado.

## Fora do MVP

Scraping do site do Google Maps, disparo automatico de mensagens, compra de listas, exportacao irrestrita de conteudo do provedor, mapa offline, rotas de visitas, busca nacional e garantia de completude.