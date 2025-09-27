// checkEnv.js
const requiredVars = [
  "PORT",
  "MONGODB_URI",
  "JWT_SECRET",
  "BACKEND_URL",
  "CORS_ORIGIN",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
];

function checkEnv() {
  let missing = [];

  requiredVars.forEach((key) => {
    if (!process.env[key]) {
      missing.push(key);
    }
  });

  if (missing.length > 0) {
    console.error("❌ ERROR: Faltan variables de entorno:");
    missing.forEach((key) => console.error(`   - ${key}`));
    console.error(
      "\n💡 Solución: configura estas variables en tu archivo .env o en el Dashboard de Render."
    );
    process.exit(1);
  } else {
    console.log("✅ Todas las variables de entorno necesarias están configuradas.");
  }
}

module.exports = checkEnv;
