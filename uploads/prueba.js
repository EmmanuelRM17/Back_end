const { enviarMensajeWhatsApp } = require('../routes/whatsapp');

(async () => {
    try {
        const numero = '527721535706'; // Formato E.164 (sin espacios, con código de país)
        await enviarMensajeWhatsApp(numero);
        console.log('✅ Mensaje enviado correctamente');
    } catch (err) {
        console.error('❌ Error al enviar el mensaje:', err.message);
    }
})();
