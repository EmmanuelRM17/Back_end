const express = require("express");
const router = express.Router();
const db = require("../../db");
const xss = require("xss");
const moment = require("moment-timezone");
const logger = require('../../utils/logger');

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
        // Ignoramos los odontólogos enviados y forzamos los valores:
        servicio_id,
        servicio_nombre,
        categoria_servicio,
        precio_servicio,
        fecha_hora,
        estado,
        notas,
        horario_id
    } = req.body;

    // Forzar odontólogo a Hugo Gómez Ramírez
    const odontologo_id = 3;
    const odontologo_nombre = "Hugo Gómez Ramírez";

    try {
        // Formatear fechas usando moment
        const formattedFechaHora = moment.parseZone(fecha_hora).format('YYYY-MM-DD HH:mm:ss');
        const formattedFechaSolicitud = moment().tz('America/Mexico_City').format('YYYY-MM-DD HH:mm:ss');

        // Validar que la fecha no sea pasada
        if (moment(formattedFechaHora).isBefore(moment().tz('America/Mexico_City'))) {
            return res.status(400).json({ message: "La fecha de la cita no puede ser en el pasado." });
        }

        // Validar que el horario exista
        const [horarioExistente] = await db.promise().query(
            `SELECT * FROM horarios WHERE id = ?`,
            [horario_id]
        );
        if (!horarioExistente || horarioExistente.length === 0) {
            return res.status(400).json({ message: "El horario seleccionado no existe." });
        }

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
        const isTratamiento = serviceResult[0].tratamiento == 1;
        const citasEstimadas = serviceResult[0].citasEstimadas || 1;
        const precioServicio = serviceResult[0].price || precio_servicio;
        const categoriaServicio = serviceResult[0].category || categoria_servicio;

        logger.info(`Servicio ID: ${servicio_id} - Es tratamiento: ${isTratamiento}`);

        // 2. Verificar disponibilidad del horario para el odontólogo 3
        const [disponibilidadResult] = await db.promise().query(
            `SELECT COUNT(*) as count FROM citas 
             WHERE fecha_consulta = ? AND odontologo_id = ? AND estado IN ('Confirmada', 'Pendiente')`,
            [formattedFechaHora, odontologo_id]
        );

        if (disponibilidadResult[0].count > 0) {
            return res.status(400).json({
                message: 'El horario seleccionado no está disponible para el odontólogo Hugo Gómez Ramírez. Por favor, seleccione otro horario.'
            });
        }

        // CASO 1: Paciente registrado (tiene paciente_id)
        if (paciente_id) {
            if (isTratamiento) {
                const fechaInicio = moment(fecha_hora).format('YYYY-MM-DD');
                const fechaEstimadaFin = moment(fecha_hora)
                    .add(citasEstimadas, 'months')
                    .format('YYYY-MM-DD');

                const [tratamientoResult] = await db.promise().query(
                    `INSERT INTO tratamientos (
                        paciente_id, servicio_id, odontologo_id, nombre_tratamiento,
                        fecha_inicio, fecha_estimada_fin, total_citas_programadas,
                        citas_completadas, estado, notas, costo_total, creado_en
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                    [
                        parseInt(xss(paciente_id)),
                        parseInt(xss(servicio_id)),
                        odontologo_id,
                        xss(servicio_nombre),
                        fechaInicio,
                        fechaEstimadaFin,
                        citasEstimadas,
                        0,
                        'Pendiente',
                        notas ? xss(notas) : `Fecha primera cita propuesta: ${formattedFechaHora}`,
                        precioServicio
                    ]
                );

                const tratamientoId = tratamientoResult.insertId;

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
                        odontologo_id,
                        odontologo_nombre,
                        parseInt(xss(servicio_id)),
                        xss(servicio_nombre),
                        categoriaServicio ? xss(categoriaServicio) : null,
                        precioServicio ? parseFloat(precioServicio) : 0.00,
                        formattedFechaHora,
                        formattedFechaSolicitud,
                        'Pendiente',
                        notas ? xss(notas) : `Primera cita del tratamiento #${tratamientoId} (pendiente de confirmación)`,
                        tratamientoId,
                        1,
                        1
                    ]
                );

                return res.status(201).json({
                    message: 'Tratamiento registrado correctamente. Un odontólogo revisará y confirmará tu solicitud.',
                    tratamiento_id: tratamientoId,
                    cita_id: citaResult.insertId,
                    es_tratamiento: true,
                    estado: 'Pendiente'
                });
            } else {
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
                        odontologo_id,
                        odontologo_nombre,
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
            // Aquí va igual que tu código original pero forzando odontólogo

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
                    isTratamiento ? 1 : 0,
                    odontologo_id,
                    odontologo_nombre,
                    xss(genero),
                    xss(fecha_nacimiento),
                    categoriaServicio ? xss(categoriaServicio) : null,
                    precioServicio ? parseFloat(precioServicio) : 0.00,
                    notas ? xss(notas) : isTratamiento ? 'Solicitud de tratamiento pendiente de confirmación' : 'Solicitud de cita pendiente de confirmación'
                ]
            );

            const preRegistroId = preRegistroResult.insertId;
            logger.info(`Pre-registro creado. ID: ${preRegistroId}`);

            if (isTratamiento) {
                try {
                    const fechaInicio = moment(formattedFechaHora).format('YYYY-MM-DD');
                    const fechaEstimadaFin = moment(fecha_hora)
                        .add(citasEstimadas, 'months')
                        .format('YYYY-MM-DD');

                    const [tratamientoResult] = await db.promise().query(
                        `INSERT INTO tratamientos (
                            paciente_id, servicio_id, odontologo_id, nombre_tratamiento,
                            fecha_inicio, fecha_estimada_fin, total_citas_programadas,
                            citas_completadas, estado, notas, costo_total, creado_en,
                            pre_registro_id
                        ) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,

                        [
                            parseInt(xss(servicio_id)),
                            odontologo_id,
                            xss(servicio_nombre),
                            fechaInicio,
                            fechaEstimadaFin,
                            citasEstimadas,
                            0,
                            'Pre-Registro',
                            `Tratamiento preliminar para pre-registro #${preRegistroId}. ${notas || ''}`,
                            precioServicio,
                            preRegistroId
                        ]
                    );

                    const tratamientoId = tratamientoResult.insertId;

                    await db.promise().query(
                        'UPDATE pre_registro_citas SET tratamiento_id = ? WHERE id = ?',
                        [tratamientoId, preRegistroId]
                    );

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
                            odontologo_id,
                            odontologo_nombre,
                            parseInt(xss(servicio_id)),
                            xss(servicio_nombre),
                            categoriaServicio ? xss(categoriaServicio) : null,
                            precioServicio ? parseFloat(precioServicio) : 0.00,
                            formattedFechaHora,
                            'PRE-REGISTRO',
                            `Solicitud de tratamiento pendiente. Pre-registro ID: ${preRegistroId}, Tratamiento ID: ${tratamientoId}`,
                            preRegistroId,
                            tratamientoId
                        ]
                    );

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
                try {
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
                            odontologo_id,
                            odontologo_nombre,
                            parseInt(xss(servicio_id)),
                            xss(servicio_nombre),
                            categoriaServicio ? xss(categoriaServicio) : null,
                            precioServicio ? parseFloat(precioServicio) : 0.00,
                            formattedFechaHora,
                            'PRE-REGISTRO',
                            `Solicitud de cita pendiente de confirmación. Pre-registro ID: ${preRegistroId}`,
                            preRegistroId
                        ]
                    );

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

// Nueva ruta POST: /agendarcita
router.post("/agendarcita", (req, res) => {
  const { paciente_id, nombre, servicio, precio, fecha_de_cita } = req.body;

  // Validar los datos recibidos
  if (!paciente_id || !nombre || !servicio || !precio || !fecha_de_cita) {
    return res.status(400).json({ message: "Todos los campos son requeridos." });
  }

  // Sanitizar los inputs
  const sanitizedNombre = xss(nombre);
  const sanitizedServicio = xss(servicio);
  const sanitizedFecha = xss(fecha_de_cita);

  // Validar formato de fecha (puede ajustarse según necesidades)
  const dateRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  if (!dateRegex.test(sanitizedFecha)) {
    return res.status(400).json({ message: "Formato de fecha inválido. Usa YYYY-MM-DD HH:MM:SS." });
  }

  // Validar que el paciente_id existe (opcional, dependiendo de tu lógica)
  const checkPatientSql = "SELECT id FROM pacientes WHERE id = ?";
  db.query(checkPatientSql, [paciente_id], (err, result) => {
    if (err) {
      return res.status(500).json({ message: "Error del servidor." });
    }
    if (result.length === 0) {
      return res.status(404).json({ message: "Paciente no encontrado." });
    }

    // Insertar la cita en la base de datos
    const insertSql = "INSERT INTO citasAlexa (paciente_id, nombre, servicio, precio, fecha_de_cita) VALUES (?, ?, ?, ?, ?)";
    db.query(insertSql, [paciente_id, sanitizedNombre, sanitizedServicio, precio, sanitizedFecha], (err, result) => {
      if (err) {
        console.error("Error al agendar cita:", err);
        return res.status(500).json({ message: "Error al agendar la cita." });
      }

      return res.status(201).json({
        message: "Cita agendada exitosamente.",
        cita: {
          id: result.insertId,
          paciente_id,
          nombre: sanitizedNombre,
          servicio: sanitizedServicio,
          precio,
          fecha_de_cita: sanitizedFecha
        }
      });
    });
  });
});

module.exports = router;
