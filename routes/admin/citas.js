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
        // Formatear fechas usando moment
        const formattedFechaHora = moment(fecha_hora).tz('America/Mexico_City').format('YYYY-MM-DD HH:mm:ss');
        const formattedFechaSolicitud = moment().tz('America/Mexico_City').format('YYYY-MM-DD HH:mm:ss');

        // 1. Verificar información del servicio
        const [serviceResult] = await db.promise().query(
            `SELECT tratamiento, citasEstimadas, duration, price, category 
             FROM servicios WHERE id = ?`,
            [servicio_id]
        );

        if (!serviceResult || serviceResult.length === 0) {
            return res.status(404).json({ message: 'El servicio seleccionado no existe.' });
        }

        // Determinar si es tratamiento y obtener información del servicio
        const isTratamiento = serviceResult[0].tratamiento == 1; // Uso == para comparación flexible
        const citasEstimadas = serviceResult[0].citasEstimadas || 1;
        const precioServicio = serviceResult[0].price || precio_servicio;
        const categoriaServicio = serviceResult[0].category || categoria_servicio;

        logger.info(`Servicio ID: ${servicio_id} - Es tratamiento: ${isTratamiento}`);

        // 2. Verificar disponibilidad del horario
        const [disponibilidadResult] = await db.promise().query(
            `SELECT COUNT(*) as count FROM citas 
             WHERE fecha_consulta = ? AND odontologo_id = ? AND estado IN ('Confirmada', 'Pendiente')`,
            [formattedFechaHora, odontologo_id]
        );

        if (disponibilidadResult[0].count > 0) {
            return res.status(400).json({
                message: 'El horario seleccionado no está disponible para este odontólogo. Por favor, seleccione otro horario.'
            });
        }

        // 3. Manejo según tipo de paciente (registrado o no)

        // CASO 1: Paciente registrado (tiene paciente_id)
        if (paciente_id) {
            // SUBCASO 1A: Tratamiento para paciente registrado
            if (isTratamiento) {
                // Calcular fechas para el tratamiento
                const fechaInicio = moment(fecha_hora).format('YYYY-MM-DD');

                // MODIFICADO: Las citas son mensuales (no semanales)
                const fechaEstimadaFin = moment(fecha_hora)
                    .add(citasEstimadas, 'months')
                    .format('YYYY-MM-DD');

                logger.info(`Fechas del tratamiento - Inicio: ${fechaInicio}, Fin estimado: ${fechaEstimadaFin} (${citasEstimadas} citas mensuales)`);

                // Crear un tratamiento
                const [tratamientoResult] = await db.promise().query(
                    `INSERT INTO tratamientos (
                        paciente_id, servicio_id, odontologo_id, nombre_tratamiento,
                        fecha_inicio, fecha_estimada_fin, total_citas_programadas,
                        citas_completadas, estado, notas, costo_total, creado_en
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                    [
                        parseInt(xss(paciente_id)),
                        parseInt(xss(servicio_id)),
                        odontologo_id ? parseInt(xss(odontologo_id)) : null,
                        xss(servicio_nombre),
                        fechaInicio,
                        fechaEstimadaFin,
                        citasEstimadas,
                        0, // Citas completadas inicialmente en 0
                        'Pendiente', // Estado inicial pendiente
                        notas ? xss(notas) : `Fecha primera cita propuesta: ${formattedFechaHora}`,
                        precioServicio
                    ]
                );

                const tratamientoId = tratamientoResult.insertId;
                logger.info(`Tratamiento creado para paciente registrado. ID: ${tratamientoId}`);

                // Crear primera cita del tratamiento
                const [citaResult] = await db.promise().query(
                    `INSERT INTO citas (
                        paciente_id, nombre, apellido_paterno, apellido_materno, genero, fecha_nacimiento,
                        correo, telefono, odontologo_id, odontologo_nombre, servicio_id, servicio_nombre,
                        categoria_servicio, precio_servicio, fecha_consulta, fecha_solicitud, estado, notas, 
                        tratamiento_id, numero_cita_tratamiento, tratamiento_pendiente
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
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
                        1, // Es la primera cita del tratamiento
                        1  // AÑADIDO: Tratamiento pendiente = 1
                    ]
                );

                return res.status(201).json({
                    message: 'Tratamiento registrado correctamente. Un odontólogo revisará y confirmará tu solicitud.',
                    tratamiento_id: tratamientoId,
                    cita_id: citaResult.insertId,
                    es_tratamiento: true,
                    estado: 'Pendiente'
                });
            }
            // SUBCASO 1B: Cita normal (no tratamiento) para paciente registrado
            else {
                // Insertar cita regular para paciente registrado
                const [citaResult] = await db.promise().query(
                    `INSERT INTO citas (
                        paciente_id, nombre, apellido_paterno, apellido_materno, genero, fecha_nacimiento,
                        correo, telefono, odontologo_id, odontologo_nombre, servicio_id, servicio_nombre,
                        categoria_servicio, precio_servicio, fecha_consulta, fecha_solicitud, estado, notas
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
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
                        notas ? xss(notas) : 'Cita pendiente de confirmación'
                    ]
                );

                return res.status(201).json({
                    message: 'Cita registrada correctamente. Un odontólogo revisará y confirmará tu solicitud.',
                    cita_id: citaResult.insertId,
                    es_tratamiento: false,
                    estado: 'Pendiente'
                });
            }
        }

        // CASO 2: Paciente NO registrado (no tiene paciente_id)
        else {
            // 2.1. Primero crear registro en pre_registro_citas
            const [preRegistroResult] = await db.promise().query(
                `INSERT INTO pre_registro_citas (
                    nombre, aPaterno, aMaterno, telefono, email, 
                    servicio_id, fecha_hora, estado, fecha_creacion,
                    es_tratamiento, odontologo_id, odontologo_nombre,
                    genero, fecha_nacimiento, categoria_servicio,
                    precio_servicio, notas
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
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
                ]
            );

            const preRegistroId = preRegistroResult.insertId;
            logger.info(`Pre-registro creado. ID: ${preRegistroId}`);

            // 2.2. Si es tratamiento, crear entrada en tratamientos con paciente_id NULL
            if (isTratamiento) {
                try {
                    // Calcular fechas para el tratamiento
                    const fechaInicio = moment(formattedFechaHora).format('YYYY-MM-DD');
                    const fechaEstimadaFin = moment(fecha_hora)
                        .add(citasEstimadas, 'months')  // Correcto
                        .format('YYYY-MM-DD');

                    logger.info(`Fechas del tratamiento (paciente no registrado) - Inicio: ${fechaInicio}, Fin estimado: ${fechaEstimadaFin}`);

                    // Crear tratamiento con paciente_id NULL
                    const [tratamientoResult] = await db.promise().query(
                        `INSERT INTO tratamientos (
                            paciente_id, servicio_id, odontologo_id, nombre_tratamiento,
                            fecha_inicio, fecha_estimada_fin, total_citas_programadas,
                            citas_completadas, estado, notas, costo_total, creado_en,
                            pre_registro_id
                        ) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
                        [
                            parseInt(xss(servicio_id)),
                            odontologo_id ? parseInt(xss(odontologo_id)) : null,
                            xss(servicio_nombre),
                            fechaInicio,
                            fechaEstimadaFin,
                            citasEstimadas,
                            0, // Citas completadas inicialmente en 0
                            'Pre-Registro', // Estado especial para tratamientos en pre-registro
                            `Tratamiento preliminar para pre-registro #${preRegistroId}. ${notas || ''}`,
                            precioServicio,
                            preRegistroId
                        ]
                    );

                    const tratamientoId = tratamientoResult.insertId;
                    logger.info(`Tratamiento creado para paciente no registrado. ID: ${tratamientoId}`);

                    // Actualizar el pre-registro con el ID del tratamiento
                    await db.promise().query(
                        'UPDATE pre_registro_citas SET tratamiento_id = ? WHERE id = ?',
                        [tratamientoId, preRegistroId]
                    );

                    // Crear cita preliminar
                    const [citaResult] = await db.promise().query(
                        `INSERT INTO citas (
                            paciente_id, nombre, apellido_paterno, apellido_materno, genero, fecha_nacimiento,
                            correo, telefono, odontologo_id, odontologo_nombre, servicio_id, servicio_nombre,
                            categoria_servicio, precio_servicio, fecha_consulta, fecha_solicitud, estado, notas, 
                            pre_registro_id, tratamiento_pendiente, tratamiento_id, numero_cita_tratamiento
                        ) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, 1, ?, 1)`,
                        [
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
                            `Solicitud de tratamiento pendiente. Pre-registro ID: ${preRegistroId}, Tratamiento ID: ${tratamientoId}`,
                            preRegistroId,
                            tratamientoId
                        ]
                    );

                    // Actualizar el pre-registro con el ID de la cita
                    await db.promise().query(
                        'UPDATE pre_registro_citas SET cita_id = ? WHERE id = ?',
                        [citaResult.insertId, preRegistroId]
                    );

                    return res.status(201).json({
                        message: 'Solicitud de tratamiento registrada correctamente. Un odontólogo revisará tu caso y te contactará.',
                        pre_registro_id: preRegistroId,
                        tratamiento_id: tratamientoId,
                        cita_id: citaResult.insertId,
                        es_tratamiento: true,
                        estado: 'PRE-REGISTRO'
                    });
                } catch (error) {
                    logger.error('Error al procesar tratamiento preliminar:', error);
                    return res.status(500).json({
                        message: 'Error al procesar la solicitud de tratamiento.',
                        pre_registro_id: preRegistroId,
                        error: error.message
                    });
                }
            } else {
                // 2.3. Si es cita regular (no tratamiento) para paciente no registrado
                // TAMBIÉN NECESITAMOS CREAR UNA ENTRADA EN LA TABLA CITAS
                try {
                    // Insertar cita con paciente_id NULL pero con pre_registro_id
                    const [citaResult] = await db.promise().query(
                        `INSERT INTO citas (
                            paciente_id, nombre, apellido_paterno, apellido_materno, genero, fecha_nacimiento,
                            correo, telefono, odontologo_id, odontologo_nombre, servicio_id, servicio_nombre,
                            categoria_servicio, precio_servicio, fecha_consulta, fecha_solicitud, estado, notas,
                            pre_registro_id
                        ) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)`,
                        [
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
                            `Solicitud de cita pendiente de confirmación. Pre-registro ID: ${preRegistroId}`,
                            preRegistroId
                        ]
                    );

                    // Actualizar el pre-registro con el ID de la cita
                    await db.promise().query(
                        'UPDATE pre_registro_citas SET cita_id = ? WHERE id = ?',
                        [citaResult.insertId, preRegistroId]
                    );

                    return res.status(201).json({
                        message: 'Solicitud de cita registrada correctamente. Te contactaremos para confirmar.',
                        pre_registro_id: preRegistroId,
                        cita_id: citaResult.insertId,
                        es_tratamiento: false,
                        estado: 'Pendiente'
                    });
                } catch (error) {
                    logger.error('Error al procesar cita preliminar:', error);
                    return res.status(500).json({
                        message: 'Error al procesar la solicitud de cita.',
                        pre_registro_id: preRegistroId,
                        error: error.message
                    });
                }
            }
        }
    } catch (error) {
        logger.error('Error en la ruta /citas/nueva: ', error);
        res.status(500).json({
            message: 'Error en el servidor.',
            error: error.message
        });
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
                    .add(citasEstimadas, 'months')  // Correcto
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
    const { estado, mensaje } = req.body;

    // Validaciones básicas
    if (!id || isNaN(id)) {
        return res.status(400).json({ message: 'ID de cita inválido.' });
    }

    if (!estado || !['Pendiente', 'Confirmada', 'Cancelada', 'Completada'].includes(estado)) {
        return res.status(400).json({ 
            message: 'Estado de cita inválido. Los valores permitidos son: Pendiente, Confirmada, Cancelada o Completada.' 
        });
    }

    try {
        // 1. Primero obtener la información de la cita para verificar si es parte de un tratamiento
        const getCitaQuery = `
            SELECT c.*, t.estado AS tratamiento_estado, t.id AS tratamiento_id 
            FROM citas c
            LEFT JOIN tratamientos t ON c.tratamiento_id = t.id
            WHERE c.id = ?
        `;
        
        const [citaResult] = await db.promise().query(getCitaQuery, [parseInt(id)]);
        
        if (citaResult.length === 0) {
            return res.status(404).json({ 
                message: 'No se encontró la cita con el ID proporcionado.' 
            });
        }
        
        const cita = citaResult[0];
        
        // 2. Verificar las reglas de negocio según el estado actual y el nuevo estado
        
        // Si la cita ya está en el estado solicitado, no hacer nada
        if (cita.estado === estado) {
            return res.json({
                message: `La cita ya se encuentra en estado "${estado}".`,
                estado: estado
            });
        }
        
        // 2.1 Si es una cita asociada a un tratamiento, aplicar reglas específicas
        if (cita.tratamiento_id) {
            // Si el tratamiento está en "Pre-Registro" o "Pendiente" y se intenta confirmar directamente la cita
            if ((cita.tratamiento_estado === 'Pre-Registro' || cita.tratamiento_estado === 'Pendiente') && 
                estado === 'Confirmada') {
                return res.status(400).json({ 
                    message: 'No se puede confirmar la cita porque el tratamiento al que pertenece debe ser activado primero desde la gestión de tratamientos.',
                    cita_id: cita.id,
                    tratamiento_id: cita.tratamiento_id,
                    tratamiento_estado: cita.tratamiento_estado
                });
            }
            
            // Si el tratamiento está "Finalizado" o "Abandonado" y se intenta modificar la cita
            if ((cita.tratamiento_estado === 'Finalizado' || cita.tratamiento_estado === 'Abandonado') &&
                estado !== 'Cancelada') {
                return res.status(400).json({ 
                    message: `No se puede modificar la cita porque el tratamiento al que pertenece está en estado "${cita.tratamiento_estado}".`,
                    cita_id: cita.id,
                    tratamiento_id: cita.tratamiento_id,
                    tratamiento_estado: cita.tratamiento_estado
                });
            }
        }
        
        // 2.2 Verificar transiciones de estado válidas para cualquier tipo de cita
        const esTransicionValida = validarTransicionEstado(cita.estado, estado);
        if (!esTransicionValida) {
            return res.status(400).json({ 
                message: `No se puede cambiar el estado de la cita de "${cita.estado}" a "${estado}".`,
                cita_id: cita.id
            });
        }
        
        // 3. Proceder con la actualización si todas las validaciones pasaron
        const notasActualizadas = mensaje 
            ? (cita.notas ? `${cita.notas}\n\n[${new Date().toLocaleString()}] ${mensaje}` : mensaje)
            : cita.notas;
            
        const updateQuery = `
            UPDATE citas 
            SET estado = ?, 
                notas = ?
            WHERE id = ?
        `;
        
        const result = await db.promise().query(updateQuery, [
            xss(estado),
            notasActualizadas ? xss(notasActualizadas) : null,
            parseInt(id)
        ]);

        // 4. Si es una cita de tratamiento y se está completando, actualizar contador
        if (cita.tratamiento_id && estado === 'Completada') {
            // El incremento se manejará en el endpoint específico /incrementarCitas
            // por eso no lo incrementamos aquí directamente
            logger.info(`Cita ${id} completada. Pertenece al tratamiento ${cita.tratamiento_id}.`);
        }

        // 5. Responder con éxito
        res.json({
            message: `Estado de la cita actualizado correctamente a "${estado}".`,
            estado: estado,
            cita_id: parseInt(id),
            tratamiento_id: cita.tratamiento_id || null
        });
    } catch (error) {
        logger.error('Error en la actualización de estado de cita:', error);
        res.status(500).json({ 
            message: 'Error interno del servidor al actualizar el estado de la cita.' 
        });
    }
});

// Función auxiliar para validar transiciones de estado de citas
function validarTransicionEstado(estadoActual, nuevoEstado) {
    // Define las transiciones permitidas
    const transicionesPermitidas = {
        'Pendiente': ['Confirmada', 'Cancelada'],
        'Confirmada': ['Completada', 'Cancelada'],
        'Completada': [], // No se puede cambiar desde Completada
        'Cancelada': [], // No se puede cambiar desde Cancelada
        'PRE-REGISTRO': ['Confirmada', 'Cancelada'] // Permitir cambiar desde PRE-REGISTRO (citas de pacientes no registrados)
    };
    
    // Verificar si la transición está permitida
    if (transicionesPermitidas[estadoActual] && 
        transicionesPermitidas[estadoActual].includes(nuevoEstado)) {
        return true;
    }
    
    return false;
}

router.put('/incrementarCitas/:id', async (req, res) => {
    const { id } = req.params;
    const { cita_id } = req.body; // ID de la cita que se completó

    if (!id || isNaN(id)) {
        return res.status(400).json({ message: 'ID de tratamiento inválido.' });
    }

    if (!cita_id || isNaN(cita_id)) {
        return res.status(400).json({ message: 'ID de cita inválido.' });
    }

    try {
        // Verificar si el tratamiento existe
        const [tratamiento] = await db.promise().query(
            'SELECT * FROM tratamientos WHERE id = ?', 
            [id]
        );

        if (tratamiento.length === 0) {
            return res.status(404).json({ message: 'No se encontró el tratamiento con el ID proporcionado.' });
        }

        // Verificar si el tratamiento está activo
        if (tratamiento[0].estado !== 'Activo') {
            return res.status(400).json({ 
                message: `No se puede incrementar las citas completadas porque el tratamiento está en estado "${tratamiento[0].estado}".` 
            });
        }

        // Verificar si la cita pertenece a este tratamiento y está en estado "Completada"
        const [cita] = await db.promise().query(
            'SELECT * FROM citas WHERE id = ? AND tratamiento_id = ?', 
            [cita_id, id]
        );
        

        if (cita.length === 0) {
            return res.status(404).json({ 
                message: 'No se encontró la cita especificada asociada a este tratamiento.' 
            });
        }

        if (cita[0].estado !== 'Completada') {
            return res.status(400).json({ 
                message: 'No se puede incrementar el contador porque la cita no está en estado "Completada".' 
            });
        }

        // Actualizar el contador de citas completadas
        const updateQuery = `
            UPDATE tratamientos 
            SET 
                citas_completadas = citas_completadas + 1,
                actualizado_en = ?,
                estado = CASE 
                    WHEN citas_completadas + 1 >= total_citas_programadas THEN 'Finalizado' 
                    ELSE estado 
                END
            WHERE id = ?
        `;

        const fechaActualizacion = moment().tz('America/Mexico_City').format('YYYY-MM-DD HH:mm:ss');
        await db.promise().query(updateQuery, [fechaActualizacion, parseInt(id)]);

        // Verificar si con esta actualización se completó el tratamiento
        const [tratamientoActualizado] = await db.promise().query(
            'SELECT * FROM tratamientos WHERE id = ?', 
            [id]
        );

        const estaCompleto = tratamientoActualizado[0].citas_completadas >= tratamientoActualizado[0].total_citas_programadas;

        // Si el tratamiento NO está completo, programar la siguiente cita
        if (!estaCompleto) {
            // Obtener todos los detalles de la cita actual
            const [citaDetallada] = await db.promise().query(
                'SELECT * FROM citas WHERE id = ?', 
                [cita_id]
            );
            
            if (citaDetallada.length > 0) {
                // Calcular la fecha para la próxima cita (un mes después)
                const fechaActual = new Date(citaDetallada[0].fecha_consulta);
                const fechaSiguiente = new Date(fechaActual);
                fechaSiguiente.setMonth(fechaSiguiente.getMonth() + 1);
                
                // Crear la siguiente cita con el mismo horario pero un mes después
                const numeroCitaSiguiente = tratamientoActualizado[0].citas_completadas + 1;
                
                const insertCitaQuery = `
                    INSERT INTO citas (
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
                        fecha_consulta, 
                        fecha_solicitud, 
                        estado, 
                        notas, 
                        tratamiento_id,
                        numero_cita_tratamiento,
                        es_tratamiento
                    ) 
                    SELECT
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
                        ?, -- nueva fecha 
                        NOW(), -- fecha de solicitud actual
                        'Pendiente', -- estado inicial
                        ?, -- notas 
                        tratamiento_id,
                        ?, -- nuevo número de cita
                        1  -- es tratamiento
                    FROM citas
                    WHERE id = ?
                `;

                const nuevasNotas = `Cita programada automáticamente después de completar cita #${numeroCitaSiguiente-1}. (Tratamiento #${id})`;
                
                const [nuevaCita] = await db.promise().query(insertCitaQuery, [
                    moment(fechaSiguiente).format('YYYY-MM-DD HH:mm:ss'),
                    nuevasNotas,
                    numeroCitaSiguiente,
                    cita_id
                ]);
                
                // Respuesta con información de la siguiente cita
                return res.json({ 
                    message: 'Contador de citas completadas incrementado correctamente. Se ha programado la siguiente cita.',
                    citas_completadas: tratamientoActualizado[0].citas_completadas,
                    tratamiento_completado: estaCompleto,
                    estado: tratamientoActualizado[0].estado,
                    siguiente_cita: {
                        cita_id: nuevaCita.insertId,
                        numero_cita: numeroCitaSiguiente,
                        fecha: moment(fechaSiguiente).format('YYYY-MM-DD HH:mm:ss')
                    }
                });
            }
        }
        
        // Respuesta sin siguiente cita (cuando el tratamiento está completo)
        res.json({ 
            message: 'Contador de citas completadas incrementado correctamente. Tratamiento completado.',
            citas_completadas: tratamientoActualizado[0].citas_completadas,
            tratamiento_completado: estaCompleto,
            estado: tratamientoActualizado[0].estado
        });

    } catch (error) {
        logger.error('Error al incrementar citas completadas:', error);
        res.status(500).json({ message: 'Error interno del servidor al actualizar el contador de citas.' });
    }
});

module.exports = router;
