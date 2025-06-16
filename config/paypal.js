// config/paypal.js
const paypal = require('@paypal/checkout-server-sdk');

// Configurar PayPal con TUS credenciales reales
const configurePayPal = () => {
  // 🔑 TUS CREDENCIALES DE PAYPAL (SANDBOX)
  const CLIENT_ID = 'AYaRi5dbGmcaSuvEzcQFQVIDPJXZkBwm4jDBS1qtsj_z9cYzSU7lefnBIceXQyKE1NvJJOtOJdZh6_w7';
  const CLIENT_SECRET = 'EAcEJunfYrWNlslkLkyrzWEbdEq32byW6MEVezBsW8RkoaY7-8IMowmT0TpHoL8PdcCRAJtM9Uk7dAyp';
  
  // 📋 INFORMACIÓN DE SANDBOX
  const SANDBOX_EMAIL = 'sb-24ake43790735@business.example.com';
  const SANDBOX_PASSWORD = 'RYPJv4+<';
  const SANDBOX_URL = 'https://sandbox.paypal.com';
  
  // Configurar entorno PayPal (Sandbox para pruebas)
  const environment = new paypal.core.SandboxEnvironment(CLIENT_ID, CLIENT_SECRET);
  const client = new paypal.core.PayPalHttpClient(environment);
  
  console.log('🦷 PayPal configurado para Dental Clinic');
  console.log('🔧 Modo: SANDBOX (Pruebas)');
  console.log('📧 Email de prueba:', SANDBOX_EMAIL);
  
  return {
    client,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    sandboxInfo: {
      email: SANDBOX_EMAIL,
      password: SANDBOX_PASSWORD,
      url: SANDBOX_URL
    },
    // Función para convertir MXN a USD (PayPal funciona en USD)
    convertMXNToUSD: (amountMXN, exchangeRate = 0.056) => {
      return (parseFloat(amountMXN) * exchangeRate).toFixed(2);
    }
  };
};

module.exports = configurePayPal;