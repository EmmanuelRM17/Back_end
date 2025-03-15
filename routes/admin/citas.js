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

    try {
        const formattedFechaHora = moment(fecha_hora).tz('America/Mexico_City').format('YYYY-MM-DD HH:mm:ss');
        const formattedFechaSolicitud = moment().tz('America/Mexico_City').format('YYYY-MM-DD HH:mm:ss');

        // Verificamos si el servicio es un tratamiento
        const checkServiceQuery = `
            SELECT tratamiento, citasEstimadas, duration, price, category
            FROM servicios 
            WHERE id = ?
        `;

        db.query(checkServiceQuery, [servicio_id], async (err, serviceResult) => {
            if (err) {
                logger.error('Error al verificar el tipo de servicio: ', err);
                return res.status(500).json({ message: 'Error al verificar el tipo de servicio.' });
            }

            if (!serviceResult || serviceResult.length === 0) {
                return res.status(404).json({ message: 'El servicio seleccionado no existe.' });
            }

            const isTratamiento = serviceResult[0].tratamiento === 1;
            const citasEstimadas = serviceResult[0].citasEstimadas || 1;
            const precioServicio = serviceResult[0].price || precio_servicio;
            const categoriaServicio = serviceResult[0].category || categoria_servicio;

            // Verificar disponibilidad del horario
            const checkQuery = `
                SELECT COUNT(*) as count FROM citas 
                WHERE fecha_consulta = ? AND odontologo_id = ? AND estado IN ('Confirmada', 'Pendiente')
            `;

            db.query(checkQuery, [formattedFechaHora, odontologo_id], async (err, result) => {
                if (err) {
                    logger.error('Error al verificar disponibilidad: ', err);
                    return res.status(500).json({ message: 'Error al verificar disponibilidad.' });
                }

                if (result[0].count > 0) {
                    return res.status(400).json({
                        message: 'El horario seleccionado no está disponible para este odontólogo. Por favor, seleccione otro horario.'
                    });
                }

                // CASO 1: Si el paciente está registrado (tiene paciente_id)
                if (paciente_id) {
                    // SUBCASO 1A: Si es un tratamiento
                    if (isTratamiento) {
                        // Calculamos fecha estimada de fin
                        const fechaInicio = moment(fecha_hora);
                        const fechaEstimadaFin = moment(fecha_hora).add(citasEstimadas - 1, 'weeks');
                        const formattedFechaEstimadaFin = fechaEstimadaFin.format('YYYY-MM-DD');

                        // Creamos un registro en tratamientos
                        const insertTratamientoQuery = `
                            INSERT INTO tratamientos (
                                paciente_id, servicio_id, odontologo_id, nombre_tratamiento,
                                fecha_inicio, fecha_estimada_fin, total_citas_programadas,
                                citas_completadas, estado, notas, costo_total, creado_en
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                        `;

                        const tratamientoValues = [
                            parseInt(xss(paciente_id)),
                            parseInt(xss(servicio_id)),
                            odontologo_id ? parseInt(xss(odontologo_id)) : null,
                            xss(servicio_nombre),
                            formattedFechaHora.split(' ')[0], // Solo tomamos la fecha
                            formattedFechaEstimadaFin,
                            citasEstimadas,
                            0, // Citas completadas inicialmente en 0
                            'Pendiente', // Estado inicial pendiente
                            notas ? xss(notas) : `Fecha primera cita propuesta: ${formattedFechaHora}`,
                            precioServicio
                        ];

                        db.query(insertTratamientoQuery, tratamientoValues, (err, tratamientoResult) => {
                            if (err) {
                                logger.error('Error al crear tratamiento: ', err);
                                return res.status(500).json({
                                    message: 'Error al registrar el tratamiento.',
                                    error: err.message
                                });
                            }

                            const tratamientoId = tratamientoResult.insertId;

                            // Para pacientes registrados, también creamos la cita en estado pendiente
                            const insertCitaQuery = `
                                INSERT INTO citas (
                                    paciente_id, nombre, apellido_paterno, apellido_materno, genero, fecha_nacimiento,
                                    correo, telefono, odontologo_id, odontologo_nombre, servicio_id, servicio_nombre,
                                    categoria_servicio, precio_servicio, fecha_consulta, fecha_solicitud, estado, notas, 
                                    tratamiento_id, numero_cita_tratamiento
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            `;

                            const citaValues = [
                                parseInt(xss(paciente_id)),
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
                                categoriaServicio ? xss(categoriaServicio) : null,
                                precioServicio ? parseFloat(precioServicio) : 0.00,
                                formattedFechaHora,
                                formattedFechaSolicitud,
                                'Pendiente',
                                notas ? xss(notas) : `Primera cita del tratamiento #${tratamientoId} (pendiente de confirmación)`,
                                tratamientoId,
                                1 // Es la primera cita del tratamiento
                            ];

                            db.query(insertCitaQuery, citaValues, (err, citaResult) => {
                                if (err) {
                                    logger.error('Error al insertar cita inicial para tratamiento: ', err);
                                    return res.status(201).json({
                                        message: 'Tratamiento registrado, pero hubo un error al registrar la cita inicial.',
                                        tratamiento_id: tratamientoId,
                                        es_tratamiento: true,
                                        error_cita: true
                                    });
                                }

                                res.status(201).json({
                                    message: 'Tratamiento registrado correctamente. Un odontólogo revisará y confirmará tu solicitud.',
                                    tratamiento_id: tratamientoId,
                                    cita_id: citaResult.insertId,
                                    es_tratamiento: true,
                                    estado: 'Pendiente'
                                });
                            });
                        });
                    }
                    // SUBCASO 1B: Si es una cita normal (no tratamiento) para paciente registrado
                    else {
                        const insertCitaQuery = `
                            INSERT INTO citas (
                                paciente_id, nombre, apellido_paterno, apellido_materno, genero, fecha_nacimiento,
                                correo, telefono, odontologo_id, odontologo_nombre, servicio_id, servicio_nombre,
                                categoria_servicio, precio_servicio, fecha_consulta, fecha_solicitud, estado, notas, 
                                horario_id, tratamiento_id, numero_cita_tratamiento
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
                        `;

                        const citaValues = [
                            parseInt(xss(paciente_id)),
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
                            categoriaServicio ? xss(categoriaServicio) : null,
                            precioServicio ? parseFloat(precioServicio) : 0.00,
                            formattedFechaHora,
                            formattedFechaSolicitud,
                            'Pendiente',
                            notas ? xss(notas) : null,
                            horario_id ? parseInt(xss(horario_id)) : null
                        ];

                        db.query(insertCitaQuery, citaValues, (err, citaResult) => {
                            if (err) {
                                logger.error('Error al insertar cita: ', err);
                                return res.status(500).json({ message: 'Error al registrar la cita.' });
                            }

                            res.status(201).json({
                                message: 'Cita creada correctamente.',
                                cita_id: citaResult.insertId,
                                es_tratamiento: false
                            });
                        });
                    }
                }
                // CASO 2: Si el paciente NO está registrado (no tiene paciente_id)
                else {
                    // Para cualquier caso (cita o tratamiento), primero creamos el registro en pre_registro_citas
                    const insertPreRegistroQuery = `
                        INSERT INTO pre_registro_citas (
                            nombre, aPaterno, aMaterno, telefono, email, 
                            servicio_id, fecha_hora, estado, fecha_creacion,
                            es_tratamiento, odontologo_id, odontologo_nombre,
                            genero, fecha_nacimiento, categoria_servicio,
                            precio_servicio, notas
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?)
                    `;

                    const preRegistroValues = [
                        xss(nombre),
                        xss(apellido_paterno),
                        xss(apellido_materno),
                        telefono ? xss(telefono) : '',
                        correo ? xss(correo) : '',
                        parseInt(xss(servicio_id)),
                        formattedFechaHora,
                        'Pendiente',
                        isTratamiento ? 1 : 0, // es_tratamiento
                        odontologo_id ? parseInt(xss(odontologo_id)) : null,
                        xss(odontologo_nombre),
                        xss(genero),
                        xss(fecha_nacimiento),
                        categoriaServicio ? xss(categoriaServicio) : null,
                        precioServicio ? parseFloat(precioServicio) : 0.00,
                        notas ? xss(notas) : isTratamiento ? 'Solicitud de tratamiento pendiente de confirmación' : 'Solicitud de cita pendiente de confirmación'
                    ];

                    db.query(insertPreRegistroQuery, preRegistroValues, (err, preRegistroResult) => {
                        if (err) {
                            logger.error('Error al crear pre-registro: ', err);
                            return res.status(500).json({
                                message: 'Error al registrar la solicitud.',
                                error: err.message
                            });
                        }

                        const preRegistroId = preRegistroResult.insertId;

                        // Si es un tratamiento, también creamos una cita en la tabla citas
                        // con paciente_id NULL, pero con pre_registro_id para referencia
                        if (isTratamiento) {
                            // Creamos una cita en estado "PRE-REGISTRO" que aparecerá en el sistema
                            const insertCitaQuery = `
                                INSERT INTO citas (
                                    paciente_id, nombre, apellido_paterno, apellido_materno, genero, fecha_nacimiento,
                                    correo, telefono, odontologo_id, odontologo_nombre, servicio_id, servicio_nombre,
                                    categoria_servicio, precio_servicio, fecha_consulta, fecha_solicitud, estado, notas, 
                                    pre_registro_id, tratamiento_pendiente
                                ) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, 1)
                            `;

                            const citaValues = [
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
                                categoriaServicio ? xss(categoriaServicio) : null,
                                precioServicio ? parseFloat(precioServicio) : 0.00,
                                formattedFechaHora,
                                'PRE-REGISTRO', // Estado especial para citas de pre-registro
                                `Solicitud de tratamiento pendiente. Pre-registro ID: ${preRegistroId}`,
                                preRegistroId
                            ];

                            db.query(insertCitaQuery, citaValues, (err, citaResult) => {
                                if (err) {
                                    logger.error('Error al crear cita preliminar para tratamiento: ', err);
                                    // Continuar aunque haya error, no es crítico
                                    res.status(201).json({
                                        message: 'Solicitud de tratamiento registrada correctamente pero hubo un error al crear la cita preliminar.',
                                        pre_registro_id: preRegistroId,
                                        es_tratamiento: true,
                                        estado: 'Pendiente'
                                    });
                                } else {
                                    // Actualizar el pre-registro con el ID de la cita
                                    db.query('UPDATE pre_registro_citas SET cita_id = ? WHERE id = ?',
                                        [citaResult.insertId, preRegistroId],
                                        (err) => {
                                            if (err) {
                                                logger.error('Error al actualizar pre-registro con ID de cita: ', err);
                                                // No es crítico
                                            }
                                        }
                                    );

                                    res.status(201).json({
                                        message: 'Solicitud de tratamiento registrada correctamente. Un odontólogo revisará tu caso y te contactará.',
                                        pre_registro_id: preRegistroId,
                                        cita_id: citaResult.insertId,
                                        es_tratamiento: true,
                                        estado: 'PRE-REGISTRO'
                                    });
                                }
                            });
                        } else {
                            // Si es una cita regular, solo respondemos con el pre-registro
                            res.status(201).json({
                                message: 'Solicitud de cita registrada correctamente. Te contactaremos para confirmar.',
                                pre_registro_id: preRegistroId,
                                es_tratamiento: false,
                                estado: 'Pendiente'
                            });
                        }
                    });
                }
            });
        });
    } catch (error) {
        logger.error('Error en la ruta /citas/nueva: ', error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

// Endpoint para confirmar solicitudes de pre-registro
router.put('/confirmar-pre-registro/:id', async (req, res) => {
    const { id } = req.params;
    const {
        observaciones,
        paciente_id, // ID de un paciente existente si se quiere asociar
        registrar_paciente // true/false para indicar si se debe registrar al paciente
    } = req.body;

    if (!id || isNaN(id)) {
        return res.status(400).json({ message: 'ID de pre-registro inválido.' });
    }

    try {
        // 1. Obtener información del pre-registro
        const getPreRegistroQuery = `
            SELECT p.*, c.id as cita_relacionada_id
            FROM pre_registro_citas p
            LEFT JOIN citas c ON p.cita_id = c.id
            WHERE p.id = ?
        `;

        db.query(getPreRegistroQuery, [id], async (err, preRegistroResult) => {
            if (err) {
                logger.error('Error al obtener información del pre-registro:', err);
                return res.status(500).json({ message: 'Error al procesar la solicitud.' });
            }

            if (!preRegistroResult || preRegistroResult.length === 0) {
                return res.status(404).json({ message: 'Pre-registro no encontrado.' });
            }

            const preRegistro = preRegistroResult[0];
            const esTratamiento = preRegistro.es_tratamiento === 1;
            const citaRelacionadaId = preRegistro.cita_relacionada_id;

            // 2. Verificar si está disponible el horario (a menos que ya tengamos una cita relacionada)
            if (!citaRelacionadaId) {
                const checkDisponibilidadQuery = `
                    SELECT COUNT(*) as count FROM citas 
                    WHERE fecha_consulta = ? AND odontologo_id = ? AND estado IN ('Confirmada', 'Pendiente')
                `;

                const [disponibilidadResult] = await db.promise().query(
                    checkDisponibilidadQuery,
                    [preRegistro.fecha_hora, preRegistro.odontologo_id]
                );

                // Si el horario ya no está disponible
                if (disponibilidadResult[0].count > 0) {
                    return res.status(409).json({
                        message: 'El horario ya no está disponible. Por favor, asigne un nuevo horario para esta solicitud.',
                        conflicto_horario: true
                    });
                }
            }

            // 3. Determinar qué paciente_id usar
            let usePacienteId = null;

            // Si se proporcionó un paciente_id existente para asociar
            if (paciente_id) {
                usePacienteId = paciente_id;
            }
            // Si se solicitó registrar al paciente
            else if (registrar_paciente) {
                try {
                    // Crear un nuevo paciente en la tabla pacientes
                    const insertPacienteQuery = `
                        INSERT INTO pacientes (
                            nombre, aPaterno, aMaterno, genero, fechaNacimiento,
                            email, telefono, lugar, creado_en
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Registrado desde pre-cita', NOW())
                    `;

                    const pacienteValues = [
                        preRegistro.nombre,
                        preRegistro.aPaterno,
                        preRegistro.aMaterno,
                        preRegistro.genero || '',
                        preRegistro.fecha_nacimiento || null,
                        preRegistro.email || null,
                        preRegistro.telefono || null
                    ];

                    const [insertResult] = await db.promise().query(insertPacienteQuery, pacienteValues);
                    usePacienteId = insertResult.insertId;
                    logger.info(`Nuevo paciente registrado: ${usePacienteId}`);
                } catch (error) {
                    logger.error('Error al registrar paciente:', error);
                    return res.status(500).json({
                        message: 'Error al registrar el paciente. Por favor, inténtelo manualmente.',
                        error: error.message
                    });
                }
            }

            // 4. Procesar según el tipo (tratamiento o cita) y si tenemos paciente_id

            // 4A. Si es tratamiento y tenemos paciente_id
            if (esTratamiento && usePacienteId) {
                // Calcular fechas para el tratamiento
                const fechaInicio = moment(preRegistro.fecha_hora).format('YYYY-MM-DD');

                // Obtener información del servicio para citas estimadas
                const getServicioQuery = `SELECT citasEstimadas FROM servicios WHERE id = ?`;
                const [servicioResult] = await db.promise().query(getServicioQuery, [preRegistro.servicio_id]);
                const citasEstimadas = servicioResult[0]?.citasEstimadas || 1;

                const fechaEstimadaFin = moment(preRegistro.fecha_hora)
                    .add(citasEstimadas - 1, 'weeks')
                    .format('YYYY-MM-DD');

                // Crear un tratamiento
                const insertTratamientoQuery = `
                    INSERT INTO tratamientos (
                        paciente_id, servicio_id, odontologo_id, nombre_tratamiento,
                        fecha_inicio, fecha_estimada_fin, total_citas_programadas,
                        citas_completadas, estado, notas, costo_total, creado_en
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                `;

                const servNombre = await getServiceName(preRegistro.servicio_id);

                const tratamientoValues = [
                    usePacienteId,
                    preRegistro.servicio_id,
                    preRegistro.odontologo_id,
                    servNombre,
                    fechaInicio,
                    fechaEstimadaFin,
                    citasEstimadas,
                    0, // citas completadas
                    'Activo', // Estado activo desde el inicio
                    `Tratamiento creado desde pre-registro #${id}. ${observaciones || ''}`,
                    preRegistro.precio_servicio || 0
                ];

                const [tratamientoResult] = await db.promise().query(insertTratamientoQuery, tratamientoValues);
                const tratamientoId = tratamientoResult.insertId;

                // Si hay una cita relacionada, actualizarla
                if (citaRelacionadaId) {
                    const updateCitaQuery = `
                        UPDATE citas 
                        SET paciente_id = ?, 
                            estado = 'Confirmada', 
                            tratamiento_id = ?, 
                            numero_cita_tratamiento = 1,
                            notas = CONCAT(IFNULL(notas, ''), '\n', ?),
                            tratamiento_pendiente = 0
                        WHERE id = ?
                    `;

                    const updateValues = [
                        usePacienteId,
                        tratamientoId,
                        `Cita confirmada como primera sesión del tratamiento #${tratamientoId}. ${observaciones || ''}`,
                        citaRelacionadaId
                    ];

                    await db.promise().query(updateCitaQuery, updateValues);

                    // Actualizar el pre-registro
                    await db.promise().query(
                        'UPDATE pre_registro_citas SET estado = "Confirmada" WHERE id = ?', [id]
                    );

                    res.status(200).json({
                        message: 'Tratamiento y cita confirmados correctamente.',
                        tratamiento_id: tratamientoId,
                        cita_id: citaRelacionadaId,
                        paciente_id: usePacienteId
                    });
                }
                // Si no hay cita relacionada, crear una nueva
                else {
                    // Crear la primera cita del tratamiento
                    const insertCitaQuery = `
                        INSERT INTO citas (
                            paciente_id, nombre, apellido_paterno, apellido_materno, genero, fecha_nacimiento,
                            correo, telefono, odontologo_id, odontologo_nombre, servicio_id, servicio_nombre,
                            categoria_servicio, precio_servicio, fecha_consulta, fecha_solicitud, estado, notas, 
                            tratamiento_id, numero_cita_tratamiento, pre_registro_id
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?)
                    `;

                    const citaValues = [
                        usePacienteId,
                        preRegistro.nombre,
                        preRegistro.aPaterno,
                        preRegistro.aMaterno,
                        preRegistro.genero || '',
                        preRegistro.fecha_nacimiento || null,
                        preRegistro.email || '',
                        preRegistro.telefono || '',
                        preRegistro.odontologo_id,
                        preRegistro.odontologo_nombre || '',
                        preRegistro.servicio_id,
                        servNombre,
                        preRegistro.categoria_servicio || '',
                        preRegistro.precio_servicio || 0,
                        preRegistro.fecha_hora,
                        'Confirmada',
                        `Primera cita del tratamiento #${tratamientoId} creado desde pre-registro #${id}. ${observaciones || ''}`,
                        tratamientoId,
                        1, // Primera cita
                        id // pre_registro_id
                    ];

                    const [citaResult] = await db.promise().query(insertCitaQuery, citaValues);

                    // Actualizar el pre-registro
                    await db.promise().query(
                        'UPDATE pre_registro_citas SET estado = "Confirmada", cita_id = ? WHERE id = ?',
                        [citaResult.insertId, id]
                    );

                    res.status(200).json({
                        message: 'Tratamiento y primera cita confirmados correctamente.',
                        tratamiento_id: tratamientoId,
                        cita_id: citaResult.insertId,
                        paciente_id: usePacienteId
                    });
                }
            }
            // 4B. Si es un tratamiento pero no tenemos paciente_id
            else if (esTratamiento && !usePacienteId) {
                return res.status(400).json({
                    message: 'Para confirmar un tratamiento, debe proporcionar un paciente_id o solicitar la creación de un nuevo paciente.',
                    error: 'Paciente requerido'
                });
            }
            // 4C. Si es una cita regular (no tratamiento)
            else {
                // Si hay una cita relacionada, actualizarla
                if (citaRelacionadaId) {
                    const updateCitaQuery = `
                        UPDATE citas 
                        SET paciente_id = ?, 
                            estado = 'Confirmada', 
                            notas = CONCAT(IFNULL(notas, ''), '\n', ?)
                        WHERE id = ?
                    `;

                    const updateValues = [
                        usePacienteId, // Puede ser NULL
                        `Cita confirmada desde pre-registro #${id}. ${observaciones || ''}`,
                        citaRelacionadaId
                    ];

                    await db.promise().query(updateCitaQuery, updateValues);

                    // Actualizar el pre-registro
                    await db.promise().query(
                        'UPDATE pre_registro_citas SET estado = "Confirmada" WHERE id = ?', [id]
                    );

                    res.status(200).json({
                        message: 'Cita confirmada correctamente.',
                        cita_id: citaRelacionadaId,
                        paciente_id: usePacienteId
                    });
                }
                // Si no hay cita relacionada, crear una nueva
                else {
                    // Crear la cita a partir del pre-registro
                    const insertCitaQuery = `
                        INSERT INTO citas (
                            paciente_id, nombre, apellido_paterno, apellido_materno, genero, fecha_nacimiento,
                            correo, telefono, odontologo_id, odontologo_nombre, servicio_id, servicio_nombre,
                            categoria_servicio, precio_servicio, fecha_consulta, fecha_solicitud, estado, notas, 
                            pre_registro_id
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)
                    `;

                    const servNombre = await getServiceName(preRegistro.servicio_id);

                    const citaValues = [
                        usePacienteId, // Puede ser NULL
                        preRegistro.nombre,
                        preRegistro.aPaterno,
                        preRegistro.aMaterno,
                        preRegistro.genero || '',
                        preRegistro.fecha_nacimiento || null,
                        preRegistro.email || '',
                        preRegistro.telefono || '',
                        preRegistro.odontologo_id,
                        preRegistro.odontologo_nombre || '',
                        preRegistro.servicio_id,
                        servNombre,
                        preRegistro.categoria_servicio || '',
                        preRegistro.precio_servicio || 0,
                        preRegistro.fecha_hora,
                        'Confirmada',
                        `Cita confirmada desde pre-registro #${id}. ${observaciones || ''}`,
                        id // pre_registro_id
                    ];

                    const [citaResult] = await db.promise().query(insertCitaQuery, citaValues);

                    // Actualizar el pre-registro
                    await db.promise().query(
                        'UPDATE pre_registro_citas SET estado = "Confirmada", cita_id = ? WHERE id = ?',
                        [citaResult.insertId, id]
                    );

                    res.status(200).json({
                        message: 'Cita confirmada correctamente.',
                        cita_id: citaResult.insertId,
                        paciente_id: usePacienteId
                    });
                }
            }
        });
    } catch (error) {
        logger.error('Error en la confirmación de pre-registro:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

// Función auxiliar para obtener el nombre del servicio
async function getServiceName(serviceId) {
    try {
        const [result] = await db.promise().query(
            'SELECT title FROM servicios WHERE id = ?', [serviceId]
        );
        return result[0]?.title || 'Servicio no especificado';
    } catch (error) {
        logger.error('Error al obtener nombre del servicio:', error);
        return 'Servicio no especificado';
    }
}

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
