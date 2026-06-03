import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccount = {
  type: process.env.FIREBASE_TYPE,
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL
};

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const { keys } = req.body;
  if (!Array.isArray(keys) || keys.length === 0) {
    return res.status(400).json({ error: "Lista de chaves inválida" });
  }

  try {
    const batch = db.batch();
    keys.forEach((chave) => {
      const ref = db.collection("keys").doc();
      batch.set(ref, {
        chave: String(chave).trim(),
        utilizada: false,
        criado_em: new Date()
      });
    });

    await batch.commit();
    res.status(200).json({ status: "ok", inseridas: keys.length });
  } catch (error) {
    console.error("Erro ao inserir chaves:", error);
    res.status(500).json({ error: "Erro ao inserir chaves", detalhe: error.message });
  }
}