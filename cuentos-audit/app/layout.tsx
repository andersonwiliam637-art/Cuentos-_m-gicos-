import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Cuentos Mágicos AI', description: 'Aventuras educativas personalizadas para niños.' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
