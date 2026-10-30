export default function TermsPage() {
  return <main className="page-card"><h1>Termos de uso do MAPS</h1>
    <p>O acesso é restrito a contas autorizadas. Não inclua dados pessoais sensíveis em buscas ou comentários.</p>
    <p>A consulta Google é opcional, exige confirmação e está sujeita a limites.
      Resultados podem estar incompletos, desatualizados ou fora do município indicado.
      Não há garantia de inventário municipal completo.</p>
    <p>A coleta importa conteúdo Google para o workspace e mantém detalhes sanitizados das consultas por 30 dias.
      A persistência implementada não concede licença de retenção: o responsável deve validar o uso e os
      prazos permitidos antes de habilitar a integração. Não use a interface para varredura sistemática,
      extração em massa ou formação de diretório não autorizado a partir desse conteúdo.</p>
    <p>Ao utilizar a consulta, aplicam-se também os <a href="https://policies.google.com/terms">Termos de Serviço do Google</a>
      {" e os "}<a href="https://maps.google.com/help/terms_maps/">Termos adicionais do Google Maps</a>.</p>
    <p>O responsável pelo workspace deve revisar e aprovar as políticas e orientar seus usuários antes de habilitar o serviço.</p>
    <a href="/privacy">Política de privacidade</a>
  </main>;
}
