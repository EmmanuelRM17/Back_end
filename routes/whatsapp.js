const axios = require('axios');

// Configura estos valores con los que te dio Meta
const token = 'EAAJEOtlg2BgBO4wZCOfZADg10zVY3BKEKUW6XZBnZAm1AOMkkiW9ZAWE7uj7pnPyn4r1EwniiBmoJjqZBZCau1nW6GNBZAZCQMhsTEWO0srgDVmtKT5ZBXfwkaKV8e0ZCgHHaT0gxZC7aCH6ABwiZBH9tZCixBi8A2ZATibjWZBhQ4Y7E97M6HKrKVtla56QiqZClnDOYsdxSxSvoyTcGcPcgZB5svho0OPpeZAddsZD';
const phoneNumberId = '625096677355367'; // ID del número de envío asignado por Meta
const numeroDestino = '527721535706';     // Número de destino en formato internacional E.164 (52 = México)

// Función para enviar mensaje usando plantilla hello_world
const enviarMensajeWhatsApp = async () => {
    try {
        const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;

        const data = {
            messaging_product: 'whatsapp',
            to: numeroDestino,
            type: 'template',
            template: {
                name: 'hello_world',
                language: {
                    code: 'en_US'
                }
            }
        };

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };

        const response = await axios.post(url, data, { headers });

        console.log('✅ Mensaje enviado correctamente:', response.data);
    } catch (error) {
        console.error('❌ Error al enviar mensaje a WhatsApp:', error.response?.data || error.message);
    }
};

// Ejecutar función
enviarMensajeWhatsApp();
