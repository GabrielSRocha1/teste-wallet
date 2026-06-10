import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

        {/* Favicon e PWA Icons */}
        <link rel="icon" type="image/png" href="/wallet-favicon.png" />
        <link rel="apple-touch-icon" href="/wallet-favicon.png" />

        {/* PWA */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#0a0a0a" />
        <meta name="application-name" content="Verum crypto" />

        {/* Meta tags para Adicionar à Tela de Início */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Verum" />

        <ScrollViewStyleReset />

        <style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />
        <script defer src="/sw-register.js" />
      </head>
      <body>{children}</body>
    </html>
  );
}

const responsiveBackground = `
body {
  background-color: #0a0a0a;
}
@media (prefers-color-scheme: dark) {
  body {
    background-color: #0a0a0a;
  }
}
`;
