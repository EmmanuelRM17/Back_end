const express = require('express');
const db = require('../../db');
const router = express.Router();
const logger = require('../../utils/logger');
const xss = require('xss'); // Para sanitización de entradas

router.post('/nueva', async (req, res) => {
    const {
        paciente_id,
        nombre,
        apellido_patern,
        apellido_matern,
        genero,
        fecha_nacimient,
        correo,
        telefono,
        odontologo_id,
        odontologo_nomb,
        servicio_id,
        servicio_nombre,
        categoria_servi,
        precio_servicio,
        fecha_hora,
        estado,
        notas
    } = req.body;

    // Validaciones básicas
    if (!nombre || !apellido_patern || !apellido_matern || !genero || !fecha_nacimient || !servicio_id || !fecha_hora) {
        return res.status(400).json({ message: 'Los campos obligatorios no están completos.' });
    }

    try {
        const insertQuery = `
            INSERT INTO citas (
                paciente_id, nombre, apellido_patern, apellido_matern, genero, fecha_nacimient,
                correo, telefono, odontologo_id, odontologo_nomb, servicio_id, servicio_nombre,
                categoria_servi, precio_servicio, fecha_hora, estado, notas
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            paciente_id ? parseInt(xss(paciente_id)) : null, 
            xss(nombre),
            xss(apellido_patern),
            xss(apellido_matern),
            xss(genero),
            xss(fecha_nacimient),
            correo ? xss(correo) : null, 
            telefono ? xss(telefono) : null, 
            odontologo_id ? parseInt(xss(odontologo_id)) : null,
            xss(odontologo_nomb),
            parseInt(xss(servicio_id)),
            xss(servicio_nombre),
            categoria_servi ? xss(categoria_servi) : null, 
            precio_servicio ? parseFloat(xss(precio_servicio)) : 0.00, 
            xss(fecha_hora),
            xss(estado) || 'Pendiente',
            notas ? xss(notas) : null 
        ];

        db.query(insertQuery, values, (err, result) => {
            if (err) {
                logger.error('Error al insertar cita: ', err);
                return res.status(500).json({ message: 'Error al registrar la cita.' });
            }

            res.status(201).json({ message: 'Cita creada correctamente.', cita_id: result.insertId });
        });

    } catch (error) {
        logger.error('Error en la ruta /citas/nueva: ', error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

module.exports = router;
