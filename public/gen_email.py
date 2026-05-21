import base64

b64 = open(r'c:\Users\gabri\wallet crypto\public\logo-email-optimized.txt','r').read().strip()

html = f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Código de Verificação – Verum Crypto</title>
</head>
<body style="margin:0;padding:0;background-color:#000000;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#000000;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;border-radius:16px;border:1px solid #2a2a2a;overflow:hidden;max-width:520px;width:100%;">

          <!-- CABEÇALHO COM LOGO -->
          <tr>
            <td align="center" style="background-color:#000000;padding:32px 40px 24px;border-bottom:1px solid #1a1a1a;">
              <img src="data:image/png;base64,{b64}" alt="Verum Crypto" width="220" style="display:block;margin:0 auto;" />
            </td>
          </tr>

          <!-- CORPO -->
          <tr>
            <td align="center" style="padding:40px 40px 32px;">
              <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#C9A84C;letter-spacing:1px;font-family:Georgia,serif;">
                Bem-vindo à Verum Crypto
              </p>
              <p style="margin:0 0 32px;font-size:14px;color:#888888;line-height:1.6;">
                Use o código abaixo para validar seu acesso e proteger seus ativos.
              </p>

              <!-- BLOCO DO CÓDIGO -->
              <table cellpadding="0" cellspacing="0" style="background-color:#111111;border:2px solid #C9A84C;border-radius:12px;width:100%;max-width:360px;margin:0 auto 32px;">
                <tr>
                  <td align="center" style="padding:28px 20px 20px;">
                    <p style="margin:0 0 8px;font-size:11px;color:#888888;letter-spacing:3px;text-transform:uppercase;">Seu código de verificação</p>
                    <p style="margin:0;font-size:42px;font-weight:900;color:#C9A84C;letter-spacing:12px;font-family:'Courier New',monospace;">
                      {{{{ .Token }}}}
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:13px;color:#666666;line-height:1.7;">
                Este código expira em <strong style="color:#C9A84C;">20 minutos</strong>.<br/>
                Se você não solicitou este código, ignore este e-mail.
              </p>
            </td>
          </tr>

          <!-- RODAPÉ -->
          <tr>
            <td align="center" style="padding:20px 40px 28px;border-top:1px solid #1a1a1a;">
              <p style="margin:0 0 4px;font-size:11px;color:#444444;letter-spacing:2px;">VERUM CRYPTO</p>
              <p style="margin:0;font-size:10px;color:#333333;">© 2024 Verum Crypto. Todos os direitos reservados.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

with open(r'c:\Users\gabri\wallet crypto\public\email-template-otp.html', 'w', encoding='utf-8') as f:
    f.write(html)

print(f"Template salvo! Tamanho: {len(html)} bytes ({len(html)//1024}KB)")
