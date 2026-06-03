import { Resend } from "resend";
import { db } from "../_lib/firebase.js";

const resend = new Resend(process.env.RESEND_API_KEY);
const LOW_STOCK_LIMIT = 5;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeQuantity(quantity) {
  const parsed = Number.parseInt(quantity, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function safeDocId(...parts) {
  return parts
    .map((part) => encodeURIComponent(String(part ?? "").trim()))
    .join("__");
}

function buildKeysHtml(keys) {
  const rows = keys
    .map(
      ({ chave }, index) => `
        <p style="font-size: 18px; color: #374d56; margin: 8px 0;">
          Chave ${index + 1}: <span style="color: #f4a300; font-weight: bold;">${escapeHtml(chave)}</span>
        </p>
      `
    )
    .join("");

  return rows;
}

async function reserveKey({ email, orderId, orderDate, sku, lineItemId, unitIndex }) {
  const allocationId = safeDocId(orderId, lineItemId, sku, unitIndex);
  const allocationRef = db.collection("key_allocations").doc(allocationId);

  return db.runTransaction(async (transaction) => {
    const existingAllocation = await transaction.get(allocationRef);
    if (existingAllocation.exists) {
      return { ...existingAllocation.data(), repeated: true };
    }

    const availableKeys = await transaction.get(
      db.collection("keys")
        .where("sku", "==", sku)
        .where("utilizada", "==", false)
        .limit(1)
    );

    if (availableKeys.empty) {
      return null;
    }

    const keyDoc = availableKeys.docs[0];
    const keyData = keyDoc.data();
    const allocation = {
      allocation_id: allocationId,
      sku,
      chave: keyData.chave,
      key_id: keyDoc.id,
      email_cliente: email,
      order_id: String(orderId),
      line_item_id: String(lineItemId),
      unit_index: unitIndex,
      email_sent: false,
      data_encomenda: new Date(orderDate),
      criado_em: new Date()
    };

    transaction.update(keyDoc.ref, {
      utilizada: true,
      email_cliente: email,
      order_id: String(orderId),
      line_item_id: String(lineItemId),
      data_encomenda: new Date(orderDate)
    });
    transaction.set(allocationRef, allocation);

    return { ...allocation, repeated: false };
  });
}

async function countAvailableKeys(sku) {
  const snapshot = await db.collection("keys")
    .where("sku", "==", sku)
    .where("utilizada", "==", false)
    .get();

  return snapshot.size;
}

async function sendKeysEmail({ email, orderId, sku, keys }) {
  await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to: email,
    bcc: ["comercialmapazero@gmail.com"],
    subject: "A chave para o teu jogo EscapeIN",
    html: `
      <div style="font-family: sans-serif; max-width: 500px; margin: auto; padding: 20px; text-align: center;">
        <img src="https://escapeingames.pt/cdn/shop/files/Logo.png?v=1744067828" alt="EscapeIN Games" style="max-width: 200px; margin-bottom: 20px;">

        <p style="color: #eee; font-size: 14px;">Encomenda ID: ${escapeHtml(orderId)}</p>
        <h3>Licença Única para jogar:</h3>

        <h3 style="font-size: 18px; color: #374d56;">Utilizador <span style="color: #f4a300;">${escapeHtml(sku)}</span></h3>
        ${buildKeysHtml(keys)}
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
}

async function markKeysEmailSent(keys) {
  const batch = db.batch();

  keys.forEach((key) => {
    batch.update(db.collection("key_allocations").doc(key.allocation_id), {
      email_sent: true,
      email_sent_at: new Date()
    });
  });

  await batch.commit();
}

async function sendLowStockEmail({ sku, remaining }) {
  await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_FROM,
    subject: `Baixo stock de chaves para SKU ${sku}`,
    html: `<p>Restam apenas ${remaining} chaves disponíveis para o jogo: <strong>${escapeHtml(sku)}</strong></p>`
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Método não permitido");
  }

  try {
    const email = req.body.email || req.body.customer?.email;
    const orderId = req.body.id || req.body.order_id;
    const dataEncomenda =
      req.body.created_at || req.body.order?.created_at || new Date().toISOString();
    const lineItems = req.body.line_items || [];

    if (!email || !orderId || lineItems.length === 0) {
      return res.status(400).send("Dados incompletos no payload");
    }

    const chavesEnviadas = [];
    const chavesEsgotadas = [];
    const touchedSkus = new Set();

    for (const [itemIndex, item] of lineItems.entries()) {
      const sku = String(item.sku || item.variant_sku || "").trim();
      if (!sku) {
        continue;
      }

      const quantity = normalizeQuantity(item.quantity);
      const lineItemId = item.id || item.line_item_id || `${itemIndex}`;
      const reservedForItem = [];

      for (let unitIndex = 0; unitIndex < quantity; unitIndex += 1) {
        const reservedKey = await reserveKey({
          email,
          orderId,
          orderDate: dataEncomenda,
          sku,
          lineItemId,
          unitIndex
        });

        if (!reservedKey) {
          chavesEsgotadas.push({ sku, line_item_id: lineItemId, unidade: unitIndex + 1 });
          continue;
        }

        reservedForItem.push(reservedKey);
        chavesEnviadas.push({
          sku,
          chave: reservedKey.chave,
          line_item_id: lineItemId,
          unidade: unitIndex + 1,
          repetida: reservedKey.repeated,
          email_ja_enviado: Boolean(reservedKey.email_sent)
        });
      }

      const keysToEmail = reservedForItem.filter((key) => !key.email_sent);
      if (keysToEmail.length > 0) {
        await sendKeysEmail({ email, orderId, sku, keys: keysToEmail });
        await markKeysEmailSent(keysToEmail);
        touchedSkus.add(sku);
      }
    }

    for (const sku of touchedSkus) {
      const restantes = await countAvailableKeys(sku);

      if (restantes < LOW_STOCK_LIMIT) {
        await sendLowStockEmail({ sku, remaining: restantes });
      }
    }

    return res.status(200).json({ status: "ok", chavesEnviadas, chavesEsgotadas });
  } catch (err) {
    console.error("Erro geral:", err);
    return res.status(500).send("Erro interno no servidor");
  }
}
