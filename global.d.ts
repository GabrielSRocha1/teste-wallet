// Declarações de tipos globais para elementos HTML usados na plataforma web
// Necessário porque React Native não inclui os tipos DOM por padrão

declare namespace JSX {
  interface IntrinsicElements {
    iframe: React.DetailedHTMLProps<React.IframeHTMLAttributes<HTMLIFrameElement>, HTMLIFrameElement>;
  }
}

declare module 'react-dom';
