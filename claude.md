Esse é o design system completo do Verum Tracker. Tudo documentado para você replicar em qualquer futuro componente ou tela do ecossistema Verum.

Resumo rápido do padrão:

As duas fontes do projeto são Cinzel (para títulos, logo, datas — dá o ar nobre/clássico) e Rajdhani (para todos os dados, valores, body — dá legibilidade e personalidade tech). Nunca use Arial, Inter ou Roboto no universo Verum.

A paleta gira em torno de preto absoluto + 3 tons de dourado (
#C9A84C base, 
#F0D080 para valores, 
#8A6A1A para gradientes de botão) com superfícies em 3 camadas (#111 → 
#181818 → #222). Verde 
#2ECC71 só para ganhos positivos, vermelho 
#E74C3C só para erros — nunca decorativamente.

O arredondamento segue uma regra simples: 8px para inputs/botões, 10–12px para cards, 20px para pills/badges. Bordas são sempre ouro com opacidade baixa (0.2) para o padrão e opacidade maior (0.5) quando precisa de destaque.

O espaçamento lateral global é sempre 20px — nunca quebre isso, é o que dá a sensação de respiro do app.

Me faça um comando curo e objetivo pra eu pedir para o antigravity fazer  aplicar esse dados na minha wallet sem altera o Beck and

22:36
Aqui está o comando direto:

"Aplique o design system Verum no frontend do app de wallet. Use exatamente estas especificações:

Cores: background 
#0A0A0A, surfaces 
#111111 / 
#181818 / 
#222222, gold principal 
#C9A84C, gold light 
#F0D080, gold dark 
#8A6A1A, texto 
#F0E8D0, muted 
#888070, success 
#2ECC71, danger 
#E74C3C

Fontes: Cinzel (títulos, logo, datas) + Rajdhani (valores, body, labels) — importar via Google Fonts

Border radius: inputs/botões 8px, cards 10–12px, pills/badges 20px

Bordas: 1px solid rgba(201,168,76,0.2) padrão, 1px solid rgba(201,168,76,0.5) destaque

Padding lateral global: 20px fixo. Cards compactos 14px, cards padrão 16px, admin/modal 36px.

