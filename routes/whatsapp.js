const express = require('express');
const router = express.Router();
const xss = require('xss');
const logger = require('../utils/logger');

// Configuración del cliente Twilio
const accountSid = 'ACd16f5fc4f667177531a763fffd7e81ab'; // Tu SID
const authToken = 'f41b5dd14e8bbed485e8079ce3dc25f0';    // Tu token 
const client = require('twilio')(accountSid, authToken);

// Endpoint para enviar mensaje de WhatsApp
router.post('/send', async (req, res) => {
    try {
        const { to, body } = req.body;
        
        // Validar campos requeridos
        if (!to || !body) {
            return res.status(400).json({ message: 'El número de teléfono y el mensaje son obligatorios' });
        }
        
        logger.info(`Intento de envío de mensaje WhatsApp a: ${to}`);
        
        // Enviar mensaje usando Twilio
        const message = await client.messages.create({
            body: xss(body),
            from: 'whatsapp:+14155238886', // Tu número de Twilio WhatsApp
            to: `whatsapp:+${xss(to)}`
        });
        
        logger.info(`Mensaje WhatsApp enviado con SID: ${message.sid}`);
        
        res.status(200).json({ 
            success: true, 
            message: 'Mensaje enviado correctamente',
            messageId: message.sid 
        });
    } catch (error) {
        logger.error(`Error en envío de WhatsApp: ${error.message}`);
        res.status(500).json({ message: 'Error en el servidor al enviar el mensaje' });
    }
});

// Endpoint de prueba para enviar mensaje específico
router.post('/test', async (req, res) => {
    try {
        // Datos específicos para la prueba
        const testNumber = '7721535706';
        const testMessage = 'Hola carol 20879';
        
        logger.info(`Enviando mensaje de prueba a: ${testNumber}`);
        
        // Enviar mensaje usando Twilio
        const message = await client.messages.create({
            body: testMessage,
            from: 'whatsapp:+14155238886', // Tu número de Twilio WhatsApp
            to: `whatsapp:+${testNumber}`
        });
        
        logger.info(`Mensaje de prueba enviado con SID: ${message.sid}`);
        
        res.status(200).json({ 
            success: true, 
            message: 'Mensaje de prueba enviado correctamente',
            messageId: message.sid,
            details: {
                to: testNumber,
                body: testMessage
            }
        });
    } catch (error) {
        logger.error(`Error en envío de WhatsApp de prueba: ${error.message}`);
        res.status(500).json({ message: 'Error en el servidor al enviar el mensaje de prueba' });
    }
});

module.exports = router;