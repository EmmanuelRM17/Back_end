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

router.get("/all", async (req, res) => {
    try {
        const query = `
        SELECT 
            id AS consulta_id,
            paciente_id,
            nombre AS paciente_nombre,
            apellido_paterno AS paciente_apellido_paterno,
            apellido_materno AS paciente_apellido_materno,
            genero AS paciente_genero,
            fecha_nacimiento AS paciente_fecha_nacimiento,
            correo AS paciente_correo,
            telefono AS paciente_telefono,
            odontologo_id,
            odontologo_nombre,
            servicio_id,
            servicio_nombre,
            categoria_servicio,
            precio_servicio,
            fecha_consulta,
            estado,
            notas,
            horario_id,
            fecha_solicitud
        FROM citas
        ORDER BY fecha_consulta DESC;
    `;

        // Ejecutar consulta con async/await
        const [results] = await db.promise().query(query);

        res.json(results);
    } catch (error) {
        console.error("Error al obtener citas:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

router.put('/update/:id', async (req, res) => {
    const { id } = req.params; // Obtener el ID de la cita desde la URL
    const {
        servicio_id,
        categoria_servicio,
        precio_servicio,
        fecha_consulta,
        estado,
        notas
    } = req.body;

    // 🛑 Validaciones básicas
    if (!id || isNaN(id)) {
        return res.status(400).json({ message: 'ID de cita inválido.' });
    }
    if (!servicio_id || isNaN(servicio_id)) {
        return res.status(400).json({ message: 'El servicio es obligatorio y debe ser un número.' });
    }
    if (!fecha_consulta || isNaN(new Date(fecha_consulta).getTime())) {
        return res.status(400).json({ message: 'Fecha de consulta inválida.' });
    }
    if (!['Pendiente', 'Confirmada', 'Cancelada', 'Completada'].includes(estado)) {
        return res.status(400).json({ message: 'Estado de cita inválido.' });
    }

    try {
        const updateQuery = `
            UPDATE citas
            SET 
                servicio_id = ?, 
                categoria_servicio = ?, 
                precio_servicio = ?, 
                fecha_consulta = ?, 
                estado = ?, 
                notas = ?
            WHERE id = ?
        `;

        const values = [
            parseInt(servicio_id),
            xss(categoria_servicio),
            parseFloat(precio_servicio),
            new Date(fecha_consulta), // Se asegura de que el formato sea datetime
            xss(estado),
            xss(notas) || null,
            parseInt(id)
        ];

        db.query(updateQuery, values, (err, result) => {
            if (err) {
                logger.error('Error al actualizar la cita:', err);
                return res.status(500).json({ message: 'Error al actualizar la cita en la base de datos.' });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'No se encontró la cita con el ID proporcionado.' });
            }

            res.json({ message: 'Cita actualizada correctamente.' });
        });
    } catch (error) {
        logger.error('Error en la actualización de cita:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

router.delete('/delete/:id', async (req, res) => {
    const { id } = req.params;

    if (!id || isNaN(id)) {
        return res.status(400).json({ message: 'ID de cita inválido.' });
    }

    try {
        // Obtener los datos de la cita antes de "eliminarla"
        const selectQuery = `SELECT * FROM citas WHERE id = ?`;
        db.query(selectQuery, [id], (err, results) => {
            if (err) {
                logger.error('Error al obtener la cita:', err);
                return res.status(500).json({ message: 'Error al obtener la cita.' });
            }

            if (results.length === 0) {
                return res.status(404).json({ message: 'No se encontró la cita.' });
            }

            const cita = results[0];

            // Insertar la cita en el historial médico
            const insertHistorialQuery = `
                INSERT INTO historial_medico (paciente_id, cita_id, enfermedades_previas, tratamientos_recientes)
                VALUES (?, ?, ?, ?)
            `;

            const valuesHistorial = [
                cita.paciente_id,
                cita.id,
                'N/A', // Aquí puedes agregar lógica para enfermedades previas
                'N/A'  // Aquí puedes agregar lógica para tratamientos recientes
            ];

            db.query(insertHistorialQuery, valuesHistorial, (err) => {
                if (err) {
                    logger.error('Error al registrar en historial médico:', err);
                    return res.status(500).json({ message: 'Error al mover la cita al historial médico.' });
                }

                // Marcar la cita como "Archivada" en lugar de eliminarla
                const updateCitaQuery = `UPDATE citas SET archivado = TRUE WHERE id = ?`;
                db.query(updateCitaQuery, [id], (err) => {
                    if (err) {
                        logger.error('Error al archivar la cita:', err);
                        return res.status(500).json({ message: 'Error al archivar la cita.' });
                    }

                    res.json({ message: 'Cita archivada y movida al historial médico con éxito.' });
                });
            });
        });

    } catch (error) {
        logger.error('Error en la eliminación de cita:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

module.exports = router;
