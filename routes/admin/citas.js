const express = require('express');
const db = require('../../db');
const router = express.Router();
const logger = require('../../utils/logger');
const xss = require('xss'); // Para sanitización de entradas

router.post('/nueva', async (req, res) => {
    const {
        paciente_id,
        nombre,
        apellido_paterno,
        apellido_materno,
        genero,
        fecha_nacimiento,
        correo,
        telefono,
        odontologo_id,
        odontologo_nombre,
        servicio_id,
        servicio_nombre,
        categoria_servicio,
        precio_servicio,
        fecha_hora,
        estado,
        notas,
        horario_id
    } = req.body;

    // Validaciones básicas con nombres correctos
    if (!nombre || !apellido_paterno || !apellido_materno || !genero || !fecha_nacimiento || !servicio_id || !fecha_hora) {
        return res.status(400).json({ message: 'Los campos obligatorios no están completos.' });
    }

    try {
        const insertQuery = `
            INSERT INTO citas (
                paciente_id, nombre, apellido_paterno, apellido_materno, genero, fecha_nacimiento,
                correo, telefono, odontologo_id, odontologo_nombre, servicio_id, servicio_nombre,
                categoria_servicio, precio_servicio, fecha_hora, estado, notas, horario_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            paciente_id ? parseInt(xss(paciente_id)) : null, 
            xss(nombre),
            xss(apellido_paterno),
            xss(apellido_materno),
            xss(genero),
            xss(fecha_nacimiento),
            correo ? xss(correo) : null, 
            telefono ? xss(telefono) : null, 
            odontologo_id ? parseInt(xss(odontologo_id)) : null,
            xss(odontologo_nombre),
            parseInt(xss(servicio_id)),
            xss(servicio_nombre),
            categoria_servicio ? xss(categoria_servicio) : null, 
            precio_servicio ? parseFloat(xss(precio_servicio)) : 0.00, 
            xss(fecha_hora),
            xss(estado) || 'Pendiente',
            notas ? xss(notas) : null,
            horario_id ? parseInt(xss(horario_id)) : null
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
