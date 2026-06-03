import { db } from "./_lib/firebase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const { keys, sku } = req.body;
  if (!Array.isArray(keys) || keys.length === 0) {
    return res.status(400).json({ error: "Lista de chaves inválida" });
  }

  try {
    let inseridas = 0;
    let batch = db.batch();
    let batchSize = 0;
    const commits = [];

    keys.forEach((entry) => {
      const chave = typeof entry === "object" && entry !== null ? entry.chave || entry.key : entry;
      const chaveSku = typeof entry === "object" && entry !== null ? entry.sku || sku : sku;
      const chaveNormalizada = String(chave || "").trim();
      const skuNormalizado = String(chaveSku || "").trim();

      if (!chaveNormalizada || !skuNormalizado) {
        return;
      }

      const ref = db.collection("keys").doc();
      batch.set(ref, {
        chave: chaveNormalizada,
        sku: skuNormalizado,
        utilizada: false,
        criado_em: new Date()
      });
      inseridas += 1;
      batchSize += 1;

      if (batchSize === 500) {
        commits.push(batch.commit());
        batch = db.batch();
        batchSize = 0;
      }
    });

    if (inseridas === 0) {
      return res.status(400).json({
        error: "Nenhuma chave válida para inserir",
        exemplo: { sku: "JOGO-001", keys: ["CHAVE-1", "CHAVE-2"] }
      });
    }

    if (batchSize > 0) {
      commits.push(batch.commit());
    }

    await Promise.all(commits);
    res.status(200).json({ status: "ok", inseridas });
  } catch (error) {
    console.error("Erro ao inserir chaves:", error);
    res.status(500).json({ error: "Erro ao inserir chaves" });
  }
}
