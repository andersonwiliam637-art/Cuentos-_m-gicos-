import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cuentos Mágicos | Donde cada historia abre un mundo',
  description: 'Cuentos personalizados, actividades educativas y aventuras para aprender jugando en familia.',
  applicationName: 'Cuentos Mágicos',
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
