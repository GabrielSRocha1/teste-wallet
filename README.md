# 🚀 Verum Compound Engine

**Calculadora Avançada de Acumulação Crypto — Production-Grade**

> Dashboard institucional para simulação de juros compostos, DCA, crescimento de comunidade e projeção patrimonial no ecossistema Solana.

---

## ✨ Funcionalidades

| Módulo | Descrição |
|--------|-----------|
| 📊 Preços em Tempo Real | Bode Coin, Escoteiro Coin, Brutos Coin via DexScreener |
| 🧮 Simulador de Acumulação | DCA com juros compostos, reinvestimento automático |
| ⚖️ Comparação de Estratégias | Compra imediata vs 12/36/48/60 meses parcelado |
| 👥 Crescimento da Comunidade | Pressão compradora, escassez, market cap |
| 📅 Projeção de 10 Anos | Cenários conservador, moderado e agressivo |
| 📤 Exportação | PDF premium, PNG, WhatsApp, link único |

---

## 🛠️ Stack Técnico

- **Framework:** Next.js 15 + TypeScript
- **UI:** Tailwind CSS + Framer Motion
- **Estado:** Zustand
- **Gráficos:** Recharts + Chart.js
- **Blockchain:** Solana Web3.js + Jupiter API + DexScreener
- **Export:** jsPDF + html2canvas
- **Deploy:** Vercel

---

## 🚀 Setup Local

```bash
# 1. Clone e instale dependências
npm install

# 2. Configure variáveis de ambiente
cp .env.example .env.local
# Edite .env.local com seus valores

# 3. Rode o servidor de desenvolvimento
npm run dev

# 4. Acesse http://localhost:3000
```

---

## 📁 Estrutura

```
src/
├── app/
│   ├── api/tokens/route.ts     # API de tokens
│   ├── layout.tsx              # Layout raiz
│   └── page.tsx                # Página principal
├── components/
│   ├── calculators/
│   │   ├── AccumulationSimulator.tsx
│   │   ├── StrategyComparison.tsx
│   │   ├── CommunityGrowth.tsx
│   │   └── TenYearProjection.tsx
│   ├── TokenPriceCard.tsx
│   └── ExportPanel.tsx
├── hooks/
│   └── useTokenData.ts
├── services/
│   └── tokenService.ts
├── store/
│   └── index.ts
├── types/
│   └── index.ts
├── utils/
│   └── financialCalculations.ts
└── styles/
    └── globals.css
```

---

## 🌐 Deploy Vercel

```bash
# Instale Vercel CLI
npm i -g vercel

# Deploy
vercel

# Produção
vercel --prod
```

Adicione as variáveis de ambiente no painel da Vercel em **Settings → Environment Variables**.

---

## 🔧 Integração com Tokens Reais

1. Acesse [DexScreener](https://dexscreener.com) e encontre os endereços dos tokens
2. Atualize `.env.local` com os endereços reais
3. Atualize `src/services/tokenService.ts` com os endereços corretos
4. O sistema buscará dados reais automaticamente

---

## ⚖️ Aviso Legal

Esta ferramenta é educacional. Todas as projeções são cenários hipotéticos baseados em premissas matemáticas e **NÃO** constituem garantia de rentabilidade, promessa de lucro ou recomendação de investimento. Consulte um profissional financeiro certificado antes de investir.

---

## 📄 Licença

Propriedade de **Verum Wallet** — Todos os direitos reservados.
