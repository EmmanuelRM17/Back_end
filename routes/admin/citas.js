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
        const formattedFechaHora = new Date(fecha_hora).toISOString().slice(0, 19).replace('T', ' ');
        const formattedFechaSolicitud = new Date().toISOString().slice(0, 19).replace('T', ' ');
        // Verificar si ya existe una cita en la misma fecha y hora con el mismo odontólogo
        const checkQuery = `
            SELECT COUNT(*) as count FROM citas 
            WHERE fecha_consulta = ? AND odontologo_id = ?
        `;
        db.query(checkQuery, [formattedFechaHora, odontologo_id], (err, result) => {
            if (err) {
                logger.error('Error al verificar citas duplicadas: ', err);
                return res.status(500).json({ message: 'Error al verificar disponibilidad de citas.' });
            }

            if (result[0].count > 0) {
                return res.status(400).json({ message: 'Ya existe una cita programada para este odontólogo en la misma fecha y hora.' });
            }

            // Si no hay citas duplicadas
            const insertQuery = `
                INSERT INTO citas (
                    paciente_id, nombre, apellido_paterno, apellido_materno, genero, fecha_nacimiento,
                    correo, telefono, odontologo_id, odontologo_nombre, servicio_id, servicio_nombre,
                    categoria_servicio, precio_servicio, fecha_consulta, fecha_solicitud, estado, notas, horario_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const values = [
                paciente_id ? parseInt(xss(paciente_id)) : null, 
                xss(nombre),
                xss(apellido_paterno),
                xss(apellido_materno),
                xss(genero),
                xss(fecha_nacimiento),
                correo ? xss(correo) : '',
                telefono ? xss(telefono) : '',
                odontologo_id ? parseInt(xss(odontologo_id)) : null,
                xss(odontologo_nombre),
                parseInt(xss(servicio_id)),
                xss(servicio_nombre),
                categoria_servicio ? xss(categoria_servicio) : null,
                precio_servicio ? parseFloat(xss(precio_servicio)) : 0.00,
                formattedFechaHora,
                formattedFechaSolicitud,
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
        });

    } catch (error) {
        logger.error('Error en la ruta /citas/nueva: ', error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

router.get('/pacientes/exists', async (req, res) => {
    const { email } = req.query;

    if (!email) {
        return res.status(400).json({ message: 'El correo electrónico es obligatorio.' });
    }

    try {
        const sanitizedEmail = xss(email);

        // Consulta para obtener todos los datos del paciente por su correo
        const query = 'SELECT * FROM pacientes WHERE email = ? LIMIT 1';
        db.query(query, [sanitizedEmail], (err, result) => {
            if (err) {
                logger.error('Error al obtener el paciente en la BDD: ', err);
                return res.status(500).json({ message: 'Error al obtener el paciente en la base de datos.' });
            }

            if (result.length > 0) {
                // Si se encuentra un paciente, se devuelven todos sus datos
                res.json({ exists: true, data: result[0] });
            } else {
                // Si no se encuentra el paciente
                res.json({ exists: false, data: null });
            }
        });
    } catch (error) {
        logger.error('Error en el endpoint /pacientes/exists: ', error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});
module.exports = router;
