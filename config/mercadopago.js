// config/mercadopago.js
const { MercadoPagoConfig, Preference } = require('mercadopago');

// Configurar MercadoPago con TUS credenciales reales (Nueva API)
const configureMercadoPago = () => {
  // 🔑 TUS CREDENCIALES DE MERCADOPAGO
  const ACCESS_TOKEN = 'APP_USR-6653608768790886-061601-70337bfbc5f798a0fd5c1d7f8fe125a1-1325788447';
  const PUBLIC_KEY = 'APP_USR-cb039339-b22d-4738-a21d-36bbcd0f1074';
  const CLIENT_ID = '6653608768790886';
  const CLIENT_SECRET = 'm501YJijn2vBf42EbxktiAwGsxijDIgY';
  
  // Configurar cliente MercadoPago (Nueva API)
  const client = new MercadoPagoConfig({ 
    accessToken: ACCESS_TOKEN,
    options: { timeout: 5000, idempotencyKey: 'abc' }
  });
  
  // Crear instancia de Preference
  const preference = new Preference(client);
  
  console.log('🦷 MercadoPago configurado para Dental Clinic (Nueva API)');
  console.log('🔑 Access Token configurado correctamente');
  
  return {
    client,
    preference,
    publicKey: PUBLIC_KEY,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    accessToken: ACCESS_TOKEN,
    getUserInfo: () => ({
      userId: '1325788447',
      appId: '6653608768790886'
    })
  };
};

module.exports = configureMercadoPago;