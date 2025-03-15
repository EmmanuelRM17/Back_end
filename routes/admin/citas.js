const express = require('express');
const db = require('../../db');
const router = express.Router();
const logger = require('../../utils/logger');
const xss = require('xss'); // Para sanitización de entradas
const moment = require('moment-timezone');

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
        const formattedFechaHora = moment(fecha_hora).tz('America/Mexico_City').format('YYYY-MM-DD HH:mm:ss');
        const formattedFechaSolicitud = moment().tz('America/Mexico_City').format('YYYY-MM-DD HH:mm:ss');

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

            // Si no hay citas duplicadas, primero verificamos si el servicio es un tratamiento
            const checkServiceQuery = `
                SELECT tratamiento, citasEstimadas, duration 
                FROM servicios 
                WHERE id = ?
            `;
            
            db.query(checkServiceQuery, [servicio_id], (err, serviceResult) => {
                if (err) {
                    logger.error('Error al verificar el tipo de servicio: ', err);
                    return res.status(500).json({ message: 'Error al verificar el tipo de servicio.' });
                }
                
                // Si no se encuentra el servicio
                if (!serviceResult || serviceResult.length === 0) {
                    return res.status(404).json({ message: 'El servicio seleccionado no existe.' });
                }
                
                const isTratamiento = serviceResult[0].tratamiento === 1;
                const citasEstimadas = serviceResult[0].citasEstimadas || 1;
                const duration = serviceResult[0].duration || 'No especificada';

                // Insertar la cita
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

                db.query(insertQuery, values, (err, citaResult) => {
                    if (err) {
                        logger.error('Error al insertar cita: ', err);
                        return res.status(500).json({ message: 'Error al registrar la cita.' });
                    }
                    
                    const cita_id = citaResult.insertId;
                    
                    // Si el servicio es un tratamiento, crear entrada en la tabla tratamientos
                    if (isTratamiento) {
                        // Calculamos fecha estimada de fin basada en la duración o las citas estimadas
                        const fechaInicio = moment(fecha_hora);
                        // Asumimos que cada cita es semanal para una estimación simple
                        const fechaEstimadaFin = moment(fecha_hora).add(citasEstimadas - 1, 'weeks');
                        const formattedFechaEstimadaFin = fechaEstimadaFin.format('YYYY-MM-DD');
                        
                        const insertTratamientoQuery = `
                            INSERT INTO tratamientos (
                                paciente_id, servicio_id, odontologo_id, nombre_tratamiento,
                                fecha_inicio, fecha_estimada_fin, total_citas_programadas,
                                citas_completadas, estado, notas, costo_total, creado_en
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                        `;
                        
                        const tratamientoValues = [
                            paciente_id ? parseInt(xss(paciente_id)) : null,
                            parseInt(xss(servicio_id)),
                            odontologo_id ? parseInt(xss(odontologo_id)) : null,
                            xss(servicio_nombre),
                            formattedFechaHora.split(' ')[0], // Solo tomamos la fecha
                            formattedFechaEstimadaFin,
                            citasEstimadas,
                            0, // Citas completadas inicialmente en 0
                            'Pendiente', // Estado inicial pendiente
                            notas ? xss(notas) : null,
                            precio_servicio ? parseFloat(xss(precio_servicio)) : 0.00
                        ];
                        
                        db.query(insertTratamientoQuery, tratamientoValues, (err, tratamientoResult) => {
                            if (err) {
                                logger.error('Error al crear tratamiento: ', err);
                                // Continuamos aunque haya error en tratamiento
                                return res.status(201).json({ 
                                    message: 'Cita creada correctamente, pero hubo un error al registrar el tratamiento.',
                                    cita_id: cita_id,
                                    error_tratamiento: true
                                });
                            }
                            
                            res.status(201).json({ 
                                message: 'Cita creada correctamente y tratamiento registrado.',
                                cita_id: cita_id,
                                tratamiento_id: tratamientoResult.insertId,
                                es_tratamiento: true
                            });
                        });
                    } else {
                        // Si no es un tratamiento, solo respondemos con la cita creada
                        res.status(201).json({ 
                            message: 'Cita creada correctamente.',
                            cita_id: cita_id,
                            es_tratamiento: false
                        });
                    }
                });
            });
        });

    } catch (error) {
        logger.error('Error en la ruta /citas/nueva: ', error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

router.get("/all", async (req, res) => {
    try {
        const query = `
        SELECT 
            c.id AS consulta_id,
            c.paciente_id,
            c.nombre AS paciente_nombre,
            c.apellido_paterno AS paciente_apellido_paterno,
            c.apellido_materno AS paciente_apellido_materno,
            c.genero AS paciente_genero,
            c.fecha_nacimiento AS paciente_fecha_nacimiento,
            c.correo AS paciente_correo,
            c.telefono AS paciente_telefono,
            c.odontologo_id,
            c.odontologo_nombre,
            c.servicio_id,
            c.servicio_nombre,
            c.categoria_servicio,
            c.precio_servicio,
            c.fecha_consulta,
            c.estado,
            c.notas,
            c.horario_id,
            c.fecha_solicitud,
            c.archivado,
            s.tratamiento AS es_tratamiento, 
            COALESCE(COUNT(c2.id), 0) + 1 AS numero_cita_tratamiento
        FROM citas c
        LEFT JOIN servicios s ON c.servicio_id = s.id
        LEFT JOIN citas c2 ON c2.paciente_id = c.paciente_id 
                         AND c2.servicio_id = c.servicio_id 
                         AND c2.fecha_consulta < c.fecha_consulta
                         AND c2.archivado = FALSE
        GROUP BY c.id
        ORDER BY c.fecha_consulta DESC;
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
        servicio_nombre,
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
        servicio_nombre = ?,
        categoria_servicio = ?,
        precio_servicio = ?,
        fecha_consulta = ?,
        estado = ?,
        notas = ?
    WHERE id = ?
`;
        const values = [
            parseInt(servicio_id),
            xss(servicio_nombre),
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

router.put('/archive/:id', async (req, res) => {
    const { id } = req.params;

    if (!id || isNaN(id)) {
        return res.status(400).json({ message: 'ID de cita inválido.' });
    }

    try {
        const selectQuery = `SELECT * FROM citas WHERE id = ?`;
        const fechaRegistro = moment().tz('America/Mexico_City').format('YYYY-MM-DD HH:mm:ss');

        db.query(selectQuery, [id], (err, results) => {
            if (err) {
                logger.error('Error al obtener la cita:', err);
                return res.status(500).json({ message: 'Error al obtener la cita.' });
            }

            if (results.length === 0) {
                return res.status(404).json({ message: 'No se encontró la cita.' });
            }

            const cita = results[0];

            // Insertar en historial médico
            const insertHistorialQuery = `
                INSERT INTO historial_medico (paciente_id, cita_id, fecha_registro, enfermedades_previas, tratamientos_recientes)
                VALUES (?, ?, ?, ?, ?)
            `;

            const valuesHistorial = [
                cita.paciente_id,
                cita.id,
                fechaRegistro,
                null,  // ✅ Ahora se pueden dejar en NULL en lugar de 'N/A'
                null
            ];

            db.query(insertHistorialQuery, valuesHistorial, (err) => {
                if (err) {
                    logger.error('Error al registrar en historial médico:', err);
                    return res.status(500).json({ message: 'Error al mover la cita al historial médico.' });
                }

                // Actualizar el estado de la cita como archivada
                const updateCitaQuery = `UPDATE citas SET archivado = TRUE WHERE id = ?`;

                db.query(updateCitaQuery, [id], (err) => {
                    if (err) {
                        logger.error('Error al archivar la cita:', err);
                        return res.status(500).json({ message: 'Error al archivar la cita.' });
                    }

                    res.json({ message: 'Cita archivada correctamente y movida al historial médico.' });
                });
            });
        });

    } catch (error) {
        logger.error('Error en la función de archivar cita:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

router.put('/cancel/:id', async (req, res) => {
    const { id } = req.params;

    if (!id || isNaN(id)) {
        return res.status(400).json({ message: 'ID de cita inválido.' });
    }

    try {
        const updateQuery = `UPDATE citas SET estado = 'Cancelada' WHERE id = ?`;

        db.query(updateQuery, [id], (err, result) => {
            if (err) {
                logger.error('Error al cancelar la cita:', err);
                return res.status(500).json({ message: 'Error al cancelar la cita en la base de datos.' });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'No se encontró la cita con el ID proporcionado.' });
            }

            res.json({ message: 'Cita cancelada correctamente.' });
        });

    } catch (error) {
        logger.error('Error en la cancelación de cita:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

// Endpoint para actualizar solo el estado de una cita
router.put('/updateStatus/:id', async (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;

    // Validaciones
    if (!id || isNaN(id)) {
        return res.status(400).json({ message: 'ID de cita inválido.' });
    }
    
    if (!estado || !['Pendiente', 'Confirmada', 'Cancelada', 'Completada'].includes(estado)) {
        return res.status(400).json({ message: 'Estado de cita inválido. Los valores permitidos son: Pendiente, Confirmada, Cancelada o Completada.' });
    }

    try {
        const updateQuery = `UPDATE citas SET estado = ? WHERE id = ?`;
        
        db.query(updateQuery, [xss(estado), parseInt(id)], (err, result) => {
            if (err) {
                logger.error('Error al actualizar el estado de la cita:', err);
                return res.status(500).json({ message: 'Error al actualizar el estado de la cita en la base de datos.' });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'No se encontró la cita con el ID proporcionado.' });
            }

            res.json({ 
                message: `Estado de la cita actualizado correctamente a "${estado}".`,
                estado: estado
            });
        });
    } catch (error) {
        logger.error('Error en la actualización de estado de cita:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

module.exports = router;
