import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente ausente: ${name}`);
  }
  return value;
}

function getServiceAccount() {
  return {
    type: requiredEnv("FIREBASE_TYPE"),
    project_id: requiredEnv("FIREBASE_PROJECT_ID"),
    private_key_id: requiredEnv("FIREBASE_PRIVATE_KEY_ID"),
    private_key: requiredEnv("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    client_email: requiredEnv("FIREBASE_CLIENT_EMAIL"),
    client_id: requiredEnv("FIREBASE_CLIENT_ID"),
    auth_uri: requiredEnv("FIREBASE_AUTH_URI"),
    token_uri: requiredEnv("FIREBASE_TOKEN_URI"),
    auth_provider_x509_cert_url: requiredEnv("FIREBASE_AUTH_PROVIDER"),
    client_x509_cert_url: requiredEnv("FIREBASE_CLIENT_CERT_URL")
  };
}

if (!getApps().length) {
  initializeApp({ credential: cert(getServiceAccount()) });
}

export const db = getFirestore();
