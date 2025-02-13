const express = require('express');
const nodemailer = require('nodemailer');
const db = require('../config/db'); // Conexión a MySQL
const { body, validationResult } = require('express-validator'); // Importamos express-validator
const router = express.Router();

// 📧 Configurar Nodemailer
const transporter = nodemailer.createTransport({
    host: 'smtp.hostinger.com',
    port: 465,
    secure: true,
    auth: {
        user: 'sistema@odontologiacarol.com',
        pass: 'sP8+?;Vs:', 
    },
});

// 📌 Endpoint para recibir el formulario de contacto con sanitización
router.post('/msj', [
    body('nombre').trim().escape().notEmpty().withMessage('El nombre es obligatorio'),
    body('email').trim().isEmail().withMessage('Email inválido').normalizeEmail(),
    body('telefono').trim().matches(/^\d{10,15}$/).withMessage('Teléfono inválido'),
    body('mensaje').trim().escape().notEmpty().withMessage('El mensaje es obligatorio')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { nombre, email, telefono, mensaje } = req.body;

    try {
        // 1️⃣ Guardar en la base de datos
        const sql = 'INSERT INTO contactanos (nombre, email, telefono, mensaje) VALUES (?, ?, ?, ?)';
        
        db.query(sql, [nombre, email, telefono, mensaje], async (err, result) => {
            if (err) {
                console.error('Error al guardar en la BD:', err);
                return res.status(500).json({ error: 'Error al guardar en la base de datos' });
            }

            // 2️⃣ Configurar el correo
            const mailOptions = {
                from: '"Odontología Carol" <sistema@odontologiacarol.com>',
                to: 'emma041117@gmail.com',
                subject: `📩 Nuevo Mensaje de Contacto - ${nombre}`,
                html: `
                    <div style="font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
                        <div style="max-width: 600px; background-color: #ffffff; padding: 20px; margin: auto; border-radius: 8px; box-shadow: 0px 0px 10px rgba(0, 0, 0, 0.1);">
                            <h2 style="color: #1976d2; text-align: center;">📩 Nuevo Mensaje de Contacto</h2>
                            <p style="font-size: 16px; text-align: center; color: #555;">Has recibido un nuevo mensaje a través del formulario de contacto.</p>
            
                            <hr style="border: 1px solid #ddd; margin: 20px 0;">
            
                            <h3 style="color: #333;">👤 Información del Usuario</h3>
                            <p><strong>📝 Nombre:</strong> ${nombre}</p>
                            <p><strong>📧 Email:</strong> <a href="mailto:${email}" style="color: #1976d2;">${email}</a></p>
                            <p><strong>📞 Teléfono:</strong> <a href="tel:${telefono}" style="color: #1976d2;">${telefono}</a></p>
            
                            <hr style="border: 1px solid #ddd; margin: 20px 0;">
            
                            <h3 style="color: #333;">✉️ Mensaje:</h3>
                            <p style="font-size: 16px; background-color: #f9f9f9; padding: 15px; border-radius: 5px; border-left: 5px solid #1976d2;">
                                ${mensaje}
                            </p>
            
                            <hr style="border: 1px solid #ddd; margin: 20px 0;">
            
                            <footer style="text-align: center; color: #888; font-size: 14px;">
                                <p>📍 <strong>Odontología Carol</strong> - Cuidando de tu salud bucal</p>
                                <p>📩 <a href="mailto:sistema@odontologiacarol.com" style="color: #1976d2;">Responder a este mensaje</a></p>
                                <p style="font-size: 12px;">Este es un correo automático, por favor no responder directamente.</p>
                            </footer>
                        </div>
                    </div>
                `,
            };

            // 3️⃣ Enviar el correo
            try {
                await transporter.sendMail(mailOptions);
                res.status(200).json({ message: 'Mensaje enviado y guardado correctamente' });
            } catch (mailError) {
                console.error('Error al enviar el correo:', mailError);
                res.status(500).json({ error: 'Error al enviar el correo' });
            }
        });

    } catch (error) {
        console.error('Error al procesar el formulario:', error);
        res.status(500).json({ error: 'Error en el servidor' });
    }
});

module.exports = router;
