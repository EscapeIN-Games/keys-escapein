import fetch from 'node-fetch';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {

  console.log("Payload recebido:", JSON.stringify(req.body, null, 2));

  if (req.method !== 'POST') {
    return res.status(405).send('Método não permitido');
  }

  try {
    const email = req.body.email || req.body.customer?.email;
    const orderId = req.body.id || req.body.order_id;
    const dataEncomenda =
      req.body.created_at || req.body.order?.created_at || new Date().toISOString();
    const lineItems = req.body.line_items || [];

    if (!email || !orderId || lineItems.length === 0) {
      return res.status(400).send('Dados incompletos no payload');
    }

    const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
    const FIREBASE_COLLECTION = 'keys';
    const firestoreURL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;

    const chavesEnviadas = [];
    const chavesEsgotadas = [];

    for (const item of lineItems) {
      const sku = item.sku || item.variant_sku;
      if (!sku) continue;

      const query = {
        structuredQuery: {
          from: [{ collectionId: FIREBASE_COLLECTION }],
          where: {
            compositeFilter: {
              op: "AND",
              filters: [
                {
                  fieldFilter: {
                    field: { fieldPath: 'sku' },
                    op: 'EQUAL',
                    value: { stringValue: sku }
                  }
                },
                {
                  fieldFilter: {
                    field: { fieldPath: 'utilizada' },
                    op: 'EQUAL',
                    value: { booleanValue: false }
                  }
                }
              ]
            }
          },
          limit: 1
        }
      };

      const response = await fetch(firestoreURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query)
      });

      const data = await response.json();
      const found = data.find(doc => doc.document);

      if (!found) {
        chavesEsgotadas.push(sku);
        continue;
      }

      const docName = found.document.name;
      const chave = found.document.fields.chave.stringValue;

      // Atualizar Firestore com nova data_encomenda
      await fetch(
        `https://firestore.googleapis.com/v1/${docName}?updateMask.fieldPaths=utilizada&updateMask.fieldPaths=email_cliente&updateMask.fieldPaths=order_id&updateMask.fieldPaths=data_encomenda`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              utilizada: { booleanValue: true },
              email_cliente: { stringValue: email },
              order_id: { stringValue: orderId.toString() },
              data_encomenda: {
                timestampValue: new Date(dataEncomenda).toISOString()
              }
            }
          })
        }
      );

      // Enviar e-mail com Resend
      await resend.emails.send({
        from: process.env.EMAIL_FROM,
        to: email,
        bcc: ['comercialmapazero@gmail.com'],
        subject: `A chave para o teu jogo EscapeIN`,
        html: `
          <div style="font-family: sans-serif; max-width: 500px; margin: auto; padding: 20px; text-align: center;">
            <img src="https://escapeingames.pt/cdn/shop/files/Logo.png?v=1744067828" alt="EscapeIN Games" style="max-width: 200px; margin-bottom: 20px;">
            
            <p style="color: #eee; font-size: 14px;">Encomenda ID: ${orderId}</p>
            <h3>Licença Única para jogar:</h3>
            
            <h3 style="font-size: 18px; color: #374d56;">Utilizador <span style="color: #f4a300;">${sku}</span></h3>
            <h3 style="font-size: 18px; color: #374d56;">Chave: <span style="color: #f4a300;">${chave}</span></h3>
            <p style="color: #374d56;">Obs: Usar apenas no Dia e Local de Início do Jogo</p>

            <p style="font-size:14px; color: #374d56; margin: 32px 0 8px">Resta apenas o download da App para estar preparado para jogar.</p>

            <a href="https://cdn.shopify.com/s/files/1/0923/3154/0815/files/ESCAPE_IN_-_Dicas_Uteis.pdf" style="display: inline-block; background: #374d56; color: #fff; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 6px; margin-top: 5px;">
              Como utilizar esta chave?
            </a>
            <p style="font-size:14px; color: #374d56; margin: 32px 0 8px">Aproveita os descontos e experiências exclusivas</p>
            <a href="https://cdn.shopify.com/s/files/1/0923/3154/0815/files/FICA_IN_2025.pdf?v=1757338178" style="display: inline-block; background: #fff; color: #374d56; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 6px; border: 2px solid #374d56; margin-top: 5px;">
              EXPERIÊNCIAS FICA IN
            </a>
          </div>
        `
      });

      chavesEnviadas.push({ sku, chave });

      // Verificar se restam < 5 chaves
      const countQuery = {
        structuredQuery: {
          from: [{ collectionId: FIREBASE_COLLECTION }],
          where: {
            compositeFilter: {
              op: "AND",
              filters: [
                {
                  fieldFilter: {
                    field: { fieldPath: 'sku' },
                    op: 'EQUAL',
                    value: { stringValue: sku }
                  }
                },
                {
                  fieldFilter: {
                    field: { fieldPath: 'utilizada' },
                    op: 'EQUAL',
                    value: { booleanValue: false }
                  }
                }
              ]
            }
          }
        }
      };

      const countResp = await fetch(firestoreURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(countQuery)
      });

      const countData = await countResp.json();
      const restantes = countData.filter(d => d.document).length;

      if (restantes < 5) {
        await resend.emails.send({
          from: process.env.EMAIL_FROM,
          to: process.env.EMAIL_FROM,
          subject: `⚠️ Baixo stock de chaves para SKU ${sku}`,
          html: `<p>Restam apenas ${restantes} chaves disponíveis para o jogo: <strong>${sku}</strong></p>`
        });
      }
    }

    return res.status(200).json({ status: 'ok', chavesEnviadas, chavesEsgotadas });
  } catch (err) {
    console.error('Erro geral:', err);
    return res.status(500).send('Erro interno no servidor');
  }
}