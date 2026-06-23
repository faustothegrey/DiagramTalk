import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'DiagramTalk',
  description: 'An interactive whiteboard where humans and LLMs discuss diagrams.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
