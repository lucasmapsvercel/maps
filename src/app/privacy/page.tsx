export default function PrivacyPage() {
  return <main className="page-card"><h1>Privacidade no MAPS</h1>
    <p>O login utiliza Google OAuth. Identificador da conta, nome e e-mail são utilizados para autenticação,
      autorização e autoria de operações. O portal não solicita a senha da conta Google.</p>
    <p>Definições de busca, preferências e dados internos do workspace são armazenados no MongoDB Atlas.
      Os membros autorizados do mesmo workspace compartilham os dados comerciais.</p>
    <p>Ao confirmar uma consulta, o termo e a cidade são enviados do servidor à Google Places API.
      A coleta importa os estabelecimentos retornados para o workspace no MongoDB, incluindo nome,
      endereço, localização e contatos disponíveis. O cursor de continuação também é persistido.
      Esses dados não são automaticamente removidos ao trocar de página ou excluir somente a busca.</p>
    <p>Reservas de consumo e identificadores técnicos das solicitações são mantidos para controle de cota,
      com metadados permanentes. Request e response sanitizados, incluindo os estabelecimentos retornados,
      ficam disponíveis aos membros do workspace por 30 dias. Chaves e tokens são ocultados.
      Provedores de hospedagem e banco processam dados necessários ao serviço.</p>
    <p>A seleção de municípios utiliza o catálogo público do IBGE. Se o serviço estiver indisponível,
      o portal utiliza uma cópia oficial de reserva e informa sua data na interface.</p>
    <p>Aplica-se também a <a href="https://policies.google.com/privacy">Política de Privacidade do Google</a>.
      Solicitações de acesso, correção ou exclusão dos dados internos devem ser encaminhadas ao administrador
      que autorizou seu acesso ao workspace.</p>
    <p>Antes de uso público, o responsável pela operação deve informar aos usuários sua identidade,
      canal de contato, base legal e política de retenção aplicável aos dados internos.</p>
    <a href="/terms">Termos de uso</a>
  </main>;
}
