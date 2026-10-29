# MAPS - Especificacao do projeto

Status: proposta para desenvolvimento. Data: 2026-10-29.

Portal de pesquisa de estabelecimentos por termo e municipio, com buscas salvas em abas, mapa de resultados e acompanhamento comercial em MongoDB, no banco `MAPS`.

## Exemplo principal

1. Criar uma busca com o termo **Aparelho Auditivo**.
2. Selecionar **Belem, Para, Brasil**, confirmando o limite municipal.
3. Solicitar a coleta nas regioes do municipio e acompanhar o progresso.
4. Persistir os resultados permitidos, sem duplicar o mesmo estabelecimento.
5. Reabrir a busca para consultar mapa e lista sem executar outra busca de estabelecimentos.
6. Adicionar comentarios internos, favoritar, editar dados locais e ocultar resultados sem excluir registros.

## Documentos

| Documento | Conteudo |
| --- | --- |
| [Produto e requisitos](docs/01-produto.md) | Escopo, abas, telas, regras e requisitos funcionais |
| [Arquitetura e busca](docs/02-arquitetura-e-busca.md) | Componentes, varredura territorial, limites, custos e retomada |
| [Dados e API](docs/03-dados-e-api.md) | Colecoes MongoDB, indices e contratos HTTP |
| [Seguranca e configuracao](docs/04-seguranca-e-configuracao.md) | Segredos, acesso ao banco, LGPD e regras do provedor |
| [Entrega e aceite](docs/05-entrega-e-aceite.md) | Etapas de implementacao, testes e decisoes pendentes |

## Condicoes essenciais

- "Toda a cidade" significa executar o plano de cobertura do territorio selecionado, nao garantir todos os estabelecimentos existentes. A fonte pode omitir empresas ou limitar resultados.
- "Sem buscar novamente" significa consultar os dados locais que podem ser legalmente armazenados e ainda estao validos. Nao significa mapa offline nem isencao de cobranca pelo carregamento do mapa.
- O Google permite armazenar Place IDs indefinidamente, mas isso nao autoriza persistir indefinidamente nomes, telefones, enderecos e demais conteudos.
- A viabilidade de coleta sistematica municipal e de constituir esta base deve ser validada contra o contrato aplicavel antes de ativar a integracao. Usar a API oficial nao elimina essas restricoes.
- Se a retencao permanente de todos os dados e obrigatoria, selecionar uma fonte ou contrato que autorize expressamente esse uso. Nao substituir por scraping para contornar os termos.
- A credencial MongoDB compartilhada na conversa nao foi gravada nos documentos nem utilizada. Sua senha deve ser rotacionada antes do uso.

## Escopo desta entrega

Somente documentacao de especificacao. Nenhuma aplicacao foi implementada, nenhuma consulta ao Google foi executada e nenhuma conexao ao banco foi realizada.