const express = require('express');
const nodemailer = require('nodemailer');
const db = require('../../db'); // Conexión a MySQL
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

            // Configurar el correo con diseño profesional
            const mailOptions = {
                from: '"Odontología Carol" <sistema@odontologiacarol.com>',
                to: 'emma041117@gmail.com',
                subject: `Nuevo Mensaje de Contacto - ${nombre}`,
                html: `
                    <div style="font-family: 'Roboto', Arial, sans-serif; background-color: #f8f9fa; padding: 20px; margin: 0;">
                        <div style="max-width: 600px; background-color: #ffffff; padding: 30px; margin: auto; border-radius: 6px; box-shadow: 0px 2px 8px rgba(0, 0, 0, 0.08);">
                            <div style="text-align: center; margin-bottom: 25px; border-bottom: 1px solid #e0e0e0; padding-bottom: 20px;">
                                <h2 style="color: #1976d2; font-weight: 500; margin: 0 0 10px 0;">Nuevo Mensaje de Contacto</h2>
                                <p style="font-size: 15px; color: #546e7a; margin: 0;">Ha recibido un nuevo mensaje a través del formulario de contacto</p>
                            </div>
                            
                            <div style="margin-bottom: 25px;">
                                <h3 style="color: #37474f; font-weight: 500; font-size: 16px; margin: 0 0 15px; padding-bottom: 8px; border-bottom: 1px solid #f0f0f0;">Información del Remitente</h3>
                                <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                                    <tr>
                                        <td style="padding: 8px 5px; color: #616161; width: 90px;">Nombre:</td>
                                        <td style="padding: 8px 5px; color: #263238; font-weight: 500;">${nombre}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 5px; color: #616161;">Email:</td>
                                        <td style="padding: 8px 5px;"><a href="mailto:${email}" style="color: #1976d2; text-decoration: none;">${email}</a></td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 5px; color: #616161;">Teléfono:</td>
                                        <td style="padding: 8px 5px;"><a href="tel:${telefono}" style="color: #1976d2; text-decoration: none;">${telefono}</a></td>
                                    </tr>
                                </table>
                            </div>
                            
                            <div style="margin-bottom: 25px;">
                                <h3 style="color: #37474f; font-weight: 500; font-size: 16px; margin: 0 0 15px; padding-bottom: 8px; border-bottom: 1px solid #f0f0f0;">Mensaje</h3>
                                <div style="font-size: 14px; background-color: #f5f7f9; padding: 16px; border-radius: 4px; border-left: 3px solid #1976d2; color: #37474f; line-height: 1.5;">
                                    ${mensaje}
                                </div>
                            </div>
                            
                            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; text-align: center; color: #78909c; font-size: 13px;">
                                <p style="margin: 0 0 8px;"><strong>Odontología Carol</strong> - Cuidando de tu salud bucal</p>
                                <p style="margin: 0 0 8px;"><a href="mailto:sistema@odontologiacarol.com" style="color: #1976d2; text-decoration: none;">Responder a este mensaje</a></p>
                                <p style="font-size: 12px; color: #90a4ae; margin: 8px 0 0;">Este es un correo automático generado por el sistema.</p>
                            </div>
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
