export default function PrivacyPage() {
  return <main className="page-card"><h1>Privacidade no MAPS</h1>
    <p>O login utiliza Google OAuth. Identificador da conta, nome e e-mail são utilizados para autenticação,
      autorização e autoria de operações. O portal não solicita a senha da conta Google.</p>
    <p>Definições de busca, preferências e dados internos do workspace são armazenados no MongoDB Atlas.
      Os membros autorizados do mesmo workspace compartilham os dados comerciais.</p>
    <p>Ao confirmar uma consulta, o termo e a cidade são enviados do servidor à Google Places API.
      Nome, endereço e localização retornados não são salvos no MongoDB nem no armazenamento do navegador.
      A interface remove o resultado após dez minutos, ao trocar de busca ou sair da página.
      Essa duração de exibição não autoriza retenção permanente.</p>
    <p>Reservas de consumo e identificadores técnicos das solicitações são mantidos para controle de cota,
      sem armazenar a resposta Google. Provedores de hospedagem e banco processam dados necessários ao serviço.</p>
    <p>Aplica-se também a <a href="https://policies.google.com/privacy">Política de Privacidade do Google</a>.
      Solicitações de acesso, correção ou exclusão dos dados internos devem ser encaminhadas ao administrador
      que autorizou seu acesso ao workspace.</p>
    <p>Antes de uso público, o responsável pela operação deve informar aos usuários sua identidade,
      canal de contato, base legal e política de retenção aplicável aos dados internos.</p>
    <a href="/terms">Termos de uso</a>
  </main>;
}
