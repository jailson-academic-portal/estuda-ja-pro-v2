import * as React from 'react'

import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Text,
} from '@react-email/components'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="pt-BR" dir="ltr">
    <Head />
    <Preview>Seu código de verificação do EstudaJá</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>EstudaJá</Text>
        <Heading style={h1}>Código de verificação</Heading>
        <Text style={text}>
          Use o código abaixo para confirmar sua identidade no EstudaJá:
        </Text>
        <Text style={codeStyle}>{token}</Text>
        <Hr style={hr} />
        <Text style={footer}>
          O código expira em poucos minutos. Se você não fez esta solicitação, ignore este e-mail.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'Segoe UI', Arial, sans-serif" }
const container = { padding: '32px 28px', maxWidth: '560px' }
const brand = {
  fontSize: '20px',
  fontWeight: 'bold' as const,
  color: '#0E8FA3',
  letterSpacing: '-0.5px',
  margin: '0 0 24px',
}
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#0F172A',
  margin: '0 0 16px',
}
const text = {
  fontSize: '15px',
  color: '#475569',
  lineHeight: '1.6',
  margin: '0 0 22px',
}
const link = { color: '#0E8FA3', textDecoration: 'underline' }
const button = {
  backgroundColor: '#0E8FA3',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: 'bold' as const,
  borderRadius: '10px',
  padding: '13px 24px',
  textDecoration: 'none',
  display: 'inline-block',
}
const hr = { borderColor: '#E2E8F0', margin: '32px 0 16px' }
const footer = { fontSize: '12px', color: '#94A3B8', margin: '0', lineHeight: '1.5' }
const codeStyle = {
  fontFamily: 'Courier, monospace',
  fontSize: '28px',
  letterSpacing: '4px',
  fontWeight: 'bold' as const,
  color: '#0F172A',
  backgroundColor: '#F1F5F9',
  borderRadius: '10px',
  padding: '14px 20px',
  margin: '0 0 26px',
  display: 'inline-block',
}
