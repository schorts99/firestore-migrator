import { getApps, initializeApp, cert, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fs from "node:fs";

export function initFirebase(config = {}) {
  if (getApps().length > 0) {
    return getFirestore(getApps()[0]);
  }

  let credential;

  if (config.credentialsPath) {
    if (!fs.existsSync(config.credentialsPath)) {
      throw new Error(
        `Credentials file not found: ${config.credentialsPath}\n` +
        "Set GOOGLE_APPLICATION_CREDENTIALS or pass --credentials <path>"
      );
    }

    const serviceAccount = JSON.parse(fs.readFileSync(config.credentialsPath, "utf8"));

    credential = cert(
      config.projectId
        ? { ...serviceAccount, projectId: config.projectId }
        : serviceAccount
    );
  } else if (config.privateKey && config.projectId && config.clientEmail) {
    credential = cert({
      projectId: config.projectId,
      privateKey: config.privateKey,
      clientEmail: config.clientEmail,
    });
  } else {
    credential = applicationDefault();
  }

  const appOptions = { credential };

  if (config.projectId) {
    appOptions.projectId = config.projectId;
  }

  const app = initializeApp(appOptions);

  return getFirestore(app);
}
