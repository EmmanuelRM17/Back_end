const express = require('express');
const db = require('../../db');
const router = express.Router();
const logger = require('../../utils/logger');
const xss = require('xss'); // Para sanitización de entradas
const moment = require('moment-timezone');

/**
 * Obtener todos los tratamientos con información detallada
 * GET /api/tratamientos/all
 */
router.get("/all", async (req, res) => {
    try {
        // Consulta modificada para incluir información de pre_registro cuando no hay paciente
        const query = `
            SELECT 
                t.id,
                t.paciente_id,
                t.servicio_id,
                t.odontologo_id,
                t.nombre_tratamiento,
                t.fecha_inicio,
                t.fecha_estimada_fin,
                t.total_citas_programadas,
                t.citas_completadas,
                t.estado,
                t.notas,
                t.costo_total,
                t.creado_en,
                t.actualizado_en,
                t.pre_registro_id,
                -- Usar información del paciente si existe, de lo contrario usar pre_registro
                COALESCE(p.nombre, pr.nombre) AS paciente_nombre,
                COALESCE(p.aPaterno, pr.aPaterno) AS paciente_apellido_paterno,
                COALESCE(p.aMaterno, pr.aMaterno) AS paciente_apellido_materno,
                e.nombre AS odontologo_nombre,
                s.title AS servicio_nombre,
                s.category AS categoria_servicio
            FROM tratamientos t
            LEFT JOIN pacientes p ON t.paciente_id = p.id
            LEFT JOIN pre_registro_citas pr ON t.pre_registro_id = pr.id
            LEFT JOIN empleados e ON t.odontologo_id = e.id
            LEFT JOIN servicios s ON t.servicio_id = s.id
            ORDER BY t.creado_en DESC
        `;

        const [tratamientos] = await db.promise().query(query);
        
        res.json(tratamientos);
    } catch (error) {
        logger.error("Error al obtener tratamientos:", error);
        res.status(500).json({ error: "Error interno del servidor al obtener tratamientos" });
    }
});

/**
 * Obtener un tratamiento específico por ID
 * GET /api/tratamientos/:id
 */
router.get("/:id", async (req, res) => {
    const { id } = req.params;
    
    if (!id || isNaN(id)) {
        return res.status(400).json({ message: 'ID de tratamiento inválido.' });
    }
    
    try {
        // Consulta para obtener los detalles de un tratamiento específico
        const tratamientoQuery = `
            SELECT 
                t.id,
                t.paciente_id,
                t.servicio_id,
                t.odontologo_id,
                t.nombre_tratamiento,
                t.fecha_inicio,
                t.fecha_estimada_fin,
                t.total_citas_programadas,
                t.citas_completadas,
                t.estado,
                t.notas,
                t.costo_total,
                t.creado_en,
                t.actualizado_en,
                p.nombre AS paciente_nombre,
                p.aPaterno AS paciente_apellido_paterno,
                p.aMaterno AS paciente_apellido_materno,
                e.nombre AS odontologo_nombre,
                s.title AS servicio_nombre,
                s.category AS categoria_servicio
            FROM tratamientos t
            LEFT JOIN pacientes p ON t.paciente_id = p.id
            LEFT JOIN empleados e ON t.odontologo_id = e.id
            LEFT JOIN servicios s ON t.servicio_id = s.id
            WHERE t.id = ?
        `;
        
        const [tratamiento] = await db.promise().query(tratamientoQuery, [id]);
        
        if (tratamiento.length === 0) {
            return res.status(404).json({ message: 'No se encontró el tratamiento con el ID proporcionado.' });
        }
        
        // Consulta para obtener las citas asociadas a este tratamiento
        const citasQuery = `
            SELECT 
                c.id AS consulta_id,
                c.fecha_consulta,
                c.estado,
                c.notas,
                c.numero_cita_tratamiento
            FROM citas c
            WHERE c.tratamiento_id = ?
            ORDER BY c.fecha_consulta ASC
        `;
        
        const [citas] = await db.promise().query(citasQuery, [id]);
        
        // Combinar los resultados
        const resultado = {
            ...tratamiento[0],
            citas: citas
        };
        
        res.json(resultado);
    } catch (error) {
        logger.error("Error al obtener tratamiento:", error);
        res.status(500).json({ error: "Error interno del servidor al obtener tratamiento" });
    }
});

/**
 * Crear un nuevo tratamiento
 * POST /api/tratamientos/nuevo
 */
router.post('/nuevo', async (req, res) => {
    const {
        paciente_id,
        servicio_id,
        odontologo_id,
        nombre_tratamiento,
        fecha_inicio,
        fecha_estimada_fin,
        total_citas_programadas,
        costo_total,
        notas
    } = req.body;

    // Validaciones básicas
    if (!paciente_id || !servicio_id || !nombre_tratamiento || !fecha_inicio || !fecha_estimada_fin || !total_citas_programadas) {
        return res.status(400).json({ message: 'Faltan campos obligatorios para crear el tratamiento.' });
    }

    try {
        // Verificar que el empleado (odontólogo) existe
        if (odontologo_id) {
            const [empleado] = await db.promise().query(
                'SELECT * FROM empleados WHERE id = ? AND puesto = "Odontólogo"', 
                [odontologo_id]
            );
            
            if (empleado.length === 0) {
                return res.status(400).json({ message: 'El empleado seleccionado no existe o no es odontólogo.' });
            }
        }

        const fechaInicio = moment(fecha_inicio).tz('America/Mexico_City').format('YYYY-MM-DD');
        const fechaEstimadaFin = moment(fecha_estimada_fin).tz('America/Mexico_City').format('YYYY-MM-DD');
        const fechaCreacion = moment().tz('America/Mexico_City').format('YYYY-MM-DD HH:mm:ss');

        const insertQuery = `
            INSERT INTO tratamientos (
                paciente_id,
                servicio_id,
                odontologo_id,
                nombre_tratamiento,
                fecha_inicio,
                fecha_estimada_fin,
                total_citas_programadas,
                citas_completadas,
                estado,
                notas,
                costo_total,
                creado_en,
                actualizado_en
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            parseInt(xss(paciente_id)),
            parseInt(xss(servicio_id)),
            odontologo_id ? parseInt(xss(odontologo_id)) : null,
            xss(nombre_tratamiento),
            fechaInicio,
            fechaEstimadaFin,
            parseInt(xss(total_citas_programadas)),
            0, // Inicia con 0 citas completadas
            'Activo', // Estado inicial
            notas ? xss(notas) : null,
            costo_total ? parseFloat(xss(costo_total)) : 0.00,
            fechaCreacion,
            fechaCreacion
        ];

        const [result] = await db.promise().query(insertQuery, values);

        res.status(201).json({ 
            message: 'Tratamiento creado correctamente.',
            tratamiento_id: result.insertId
        });

    } catch (error) {
        logger.error('Error al crear tratamiento:', error);
        res.status(500).json({ message: 'Error interno del servidor al crear el tratamiento.' });
    }
});

/**
 * Actualizar un tratamiento existente
 * PUT /api/tratamientos/update/:id
 */
router.put('/update/:id', async (req, res) => {
    const { id } = req.params;
    const {
        nombre_tratamiento,
        fecha_inicio,
        fecha_estimada_fin,
        total_citas_programadas,
        odontologo_id,
        notas,
        costo_total
    } = req.body;

    if (!id || isNaN(id)) {
        return res.status(400).json({ message: 'ID de tratamiento inválido.' });
    }

    try {
        // Verificar si el tratamiento existe y su estado actual
        const [tratamientoActual] = await db.promise().query(
            'SELECT * FROM tratamientos WHERE id = ?', 
            [id]
        );

        if (tratamientoActual.length === 0) {
            return res.status(404).json({ message: 'No se encontró el tratamiento con el ID proporcionado.' });
        }

        // Si el tratamiento está finalizado o abandonado, no permitir ediciones
        if (tratamientoActual[0].estado !== 'Activo') {
            return res.status(400).json({ 
                message: `No se puede modificar el tratamiento porque su estado actual es "${tratamientoActual[0].estado}".`
            });
        }

        // Validar que el nuevo total de citas programadas no sea menor que las citas completadas
        if (total_citas_programadas && parseInt(total_citas_programadas) < tratamientoActual[0].citas_completadas) {
            return res.status(400).json({ 
                message: 'El total de citas programadas no puede ser menor que el número de citas ya completadas.'
            });
        }

        // Si se proporciona un ID de odontólogo, verificar que existe y es odontólogo
        if (odontologo_id) {
            const [empleado] = await db.promise().query(
                'SELECT * FROM empleados WHERE id = ? AND puesto = "Odontólogo"', 
                [odontologo_id]
            );
            
            if (empleado.length === 0) {
                return res.status(400).json({ message: 'El empleado seleccionado no existe o no es odontólogo.' });
            }
        }

        const fechaActualizacion = moment().tz('America/Mexico_City').format('YYYY-MM-DD HH:mm:ss');

        const updateQuery = `
            UPDATE tratamientos SET
                nombre_tratamiento = ?,
                fecha_inicio = ?,
                fecha_estimada_fin = ?,
                total_citas_programadas = ?,
                odontologo_id = ?,
                notas = ?,
                costo_total = ?,
                actualizado_en = ?
            WHERE id = ?
        `;

        const values = [
            xss(nombre_tratamiento),
            moment(fecha_inicio).tz('America/Mexico_City').format('YYYY-MM-DD'),
            moment(fecha_estimada_fin).tz('America/Mexico_City').format('YYYY-MM-DD'),
            parseInt(xss(total_citas_programadas)),
            odontologo_id ? parseInt(xss(odontologo_id)) : null,
            notas ? xss(notas) : tratamientoActual[0].notas,
            costo_total ? parseFloat(xss(costo_total)) : tratamientoActual[0].costo_total,
            fechaActualizacion,
            parseInt(id)
        ];

        await db.promise().query(updateQuery, values);

        res.json({ message: 'Tratamiento actualizado correctamente.' });

    } catch (error) {
        logger.error('Error al actualizar tratamiento:', error);
        res.status(500).json({ message: 'Error interno del servidor al actualizar el tratamiento.' });
    }
});

/**
 * Actualizar el estado de un tratamiento
 * PUT /api/tratamientos/updateStatus/:id
 */
router.put('/updateStatus/:id', async (req, res) => {
    const { id } = req.params;
    const { estado, notas } = req.body;

    if (!id || isNaN(id)) {
        return res.status(400).json({ message: 'ID de tratamiento inválido.' });
    }
    
    if (!estado || !['Pre-Registro', 'Pendiente', 'Activo', 'Finalizado', 'Abandonado'].includes(estado)) {
        return res.status(400).json({ 
            message: 'Estado de tratamiento inválido. Los valores permitidos son: Pre-Registro, Pendiente, Activo, Finalizado o Abandonado.' 
        });
    }

    try {
        // Verificar si el tratamiento existe y su estado actual
        const [tratamientoActual] = await db.promise().query(
            'SELECT * FROM tratamientos WHERE id = ?', 
            [id]
        );

        if (tratamientoActual.length === 0) {
            return res.status(404).json({ message: 'No se encontró el tratamiento con el ID proporcionado.' });
        }

        // Validar cambios de estado según reglas de negocio
        const estadoActual = tratamientoActual[0].estado;
        
        if (estadoActual === estado) {
            return res.status(400).json({ message: `El tratamiento ya se encuentra en estado "${estado}".` });
        }
        
        // Validar transiciones de estado permitidas
        if (estadoActual === 'Finalizado' || estadoActual === 'Abandonado') {
            return res.status(400).json({ 
                message: `No se puede cambiar el estado del tratamiento porque ya está en estado "${estadoActual}".` 
            });
        }
        
        // Validaciones específicas para ciertos cambios de estado
        if (estado === 'Finalizado' && tratamientoActual[0].citas_completadas < tratamientoActual[0].total_citas_programadas) {
            return res.status(400).json({ 
                message: 'No se puede finalizar el tratamiento porque aún no se han completado todas las citas programadas.' 
            });
        }

        // Si cambiamos a Activo desde Pre-Registro o Pendiente, necesitamos activar también la primera cita
        let activarPrimeraCita = (estadoActual === 'Pre-Registro' || estadoActual === 'Pendiente') && estado === 'Activo';

        const fechaActualizacion = moment().tz('America/Mexico_City').format('YYYY-MM-DD HH:mm:ss');
        
        // Si se proporcionaron nuevas notas, agregarlas a las existentes
        let notasActualizadas = tratamientoActual[0].notas || '';
        if (notas) {
            if (notasActualizadas.length > 0) {
                notasActualizadas += '\n\n';
            }
            notasActualizadas += xss(notas);
        }

        const updateQuery = `
            UPDATE tratamientos SET
                estado = ?,
                notas = ?,
                actualizado_en = ?
            WHERE id = ?
        `;

        const values = [
            xss(estado),
            notasActualizadas,
            fechaActualizacion,
            parseInt(id)
        ];

        await db.promise().query(updateQuery, values);

        // Si cambiamos a estado Activo, actualizar la primera cita asociada a este tratamiento
        if (activarPrimeraCita) {
            const updateCitaQuery = `
                UPDATE citas 
                SET estado = 'Confirmada', 
                    notas = CONCAT(IFNULL(notas, ''), '\n\nCita confirmada automáticamente al activar el tratamiento.')
                WHERE tratamiento_id = ? AND numero_cita_tratamiento = 1
            `;
            
            await db.promise().query(updateCitaQuery, [parseInt(id)]);
        }
        
        // Si el tratamiento se marcó como abandonado, cancelar todas las citas pendientes
        if (estado === 'Abandonado') {
            const updateCitasQuery = `
                UPDATE citas 
                SET estado = 'Cancelada', 
                    notas = CONCAT(IFNULL(notas, ''), '\n\nCancelada automáticamente por abandono del tratamiento.')
                WHERE tratamiento_id = ? AND estado IN ('Pendiente', 'Confirmada')
            `;
            
            await db.promise().query(updateCitasQuery, [parseInt(id)]);
        }

        res.json({ 
            message: `Estado del tratamiento actualizado correctamente a "${estado}".`,
            estado: estado
        });

    } catch (error) {
        logger.error('Error al actualizar estado de tratamiento:', error);
        res.status(500).json({ message: 'Error interno del servidor al actualizar el estado del tratamiento.' });
    }
});

/**
 * Incrementar contador de citas completadas para un tratamiento y programar la siguiente
 * PUT /api/tratamientos/incrementarCitas/:id
 */
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
                        numero_cita_tratamiento
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
                        'Cita programada automáticamente después de completar cita anterior.', 
                        tratamiento_id,
                        ? -- nuevo número de cita
                    FROM citas
                    WHERE id = ?
                `;
                
                const [nuevaCita] = await db.promise().query(insertCitaQuery, [
                    moment(fechaSiguiente).format('YYYY-MM-DD HH:mm:ss'),
                    numeroCitaSiguiente,
                    cita_id
                ]);
                
                // Respuesta con información de la siguiente cita
                return res.json({ 
                    message: 'Contador de citas completadas incrementado correctamente.',
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
            message: 'Contador de citas completadas incrementado correctamente.',
            citas_completadas: tratamientoActualizado[0].citas_completadas,
            tratamiento_completado: estaCompleto,
            estado: tratamientoActualizado[0].estado
        });

    } catch (error) {
        logger.error('Error al incrementar citas completadas:', error);
        res.status(500).json({ message: 'Error interno del servidor al actualizar el contador de citas.' });
    }
});

/**
 * Obtener citas asociadas a un tratamiento
 * GET /api/tratamientos/:id/citas
 */
router.get("/:id/citas", async (req, res) => {
    const { id } = req.params;
    
    if (!id || isNaN(id)) {
        return res.status(400).json({ message: 'ID de tratamiento inválido.' });
    }
    
    try {
        const query = `
            SELECT 
                c.id AS consulta_id,
                c.paciente_id,
                c.nombre AS paciente_nombre,
                c.apellido_paterno AS paciente_apellido_paterno,
                c.apellido_materno AS paciente_apellido_materno,
                c.odontologo_id,
                c.odontologo_nombre,
                c.servicio_id,
                c.servicio_nombre,
                c.categoria_servicio,
                c.precio_servicio,
                c.fecha_consulta,
                c.estado,
                c.notas,
                c.numero_cita_tratamiento,
                c.tratamiento_id
            FROM citas c
            WHERE c.tratamiento_id = ? AND c.archivado = FALSE
            ORDER BY c.fecha_consulta ASC
        `;
        
        const [citas] = await db.promise().query(query, [id]);
        
        res.json(citas);
    } catch (error) {
        logger.error("Error al obtener citas del tratamiento:", error);
        res.status(500).json({ error: "Error interno del servidor al obtener citas del tratamiento" });
    }
});

/**
 * Agregar una nueva cita a un tratamiento existente
 * POST /api/tratamientos/:id/agregarCita
 */
router.post('/:id/agregarCita', async (req, res) => {
    const { id } = req.params; // ID del tratamiento
    const { fecha_hora, notas, odontologo_id } = req.body;

    if (!id || isNaN(id)) {
        return res.status(400).json({ message: 'ID de tratamiento inválido.' });
    }

    if (!fecha_hora) {
        return res.status(400).json({ message: 'La fecha y hora de la cita son obligatorias.' });
    }

    try {
        // Obtener información del tratamiento
        const [tratamiento] = await db.promise().query(
            `SELECT t.*, 
                    p.nombre, p.aPaterno, p.aMaterno, p.genero, p.fecha_nacimiento, p.email, p.telefono,
                    s.title, s.category, s.price, s.tratamiento AS es_tratamiento,
                    e.nombre AS odontologo_nombre
             FROM tratamientos t
             JOIN pacientes p ON t.paciente_id = p.id
             JOIN servicios s ON t.servicio_id = s.id
             LEFT JOIN empleados e ON t.odontologo_id = e.id
             WHERE t.id = ?`, 
            [id]
        );

        if (tratamiento.length === 0) {
            return res.status(404).json({ message: 'No se encontró el tratamiento con el ID proporcionado.' });
        }

        if (tratamiento[0].estado !== 'Activo') {
            return res.status(400).json({ 
                message: `No se pueden agregar citas porque el tratamiento está en estado "${tratamiento[0].estado}".` 
            });
        }

        // Contar cuántas citas ya existen para este tratamiento
        const [citasCount] = await db.promise().query(
            'SELECT COUNT(*) as count FROM citas WHERE tratamiento_id = ? AND archivado = FALSE',
            [id]
        );

        const numeroCita = citasCount[0].count + 1;

        // Verificar que no se excedan las citas programadas
        if (numeroCita > tratamiento[0].total_citas_programadas) {
            return res.status(400).json({ 
                message: `No se pueden agregar más citas. El tratamiento tiene un límite de ${tratamiento[0].total_citas_programadas} citas.` 
            });
        }

        const formattedFechaHora = moment(fecha_hora).tz('America/Mexico_City').format('YYYY-MM-DD HH:mm:ss');
        const formattedFechaSolicitud = moment().tz('America/Mexico_City').format('YYYY-MM-DD HH:mm:ss');

        // Verificar disponibilidad del odontólogo en esa fecha y hora
        const checkQuery = `
            SELECT COUNT(*) as count FROM citas 
            WHERE fecha_consulta = ? AND odontologo_id = ? AND archivado = FALSE
        `;
        const [citasExistentes] = await db.promise().query(checkQuery, [
            formattedFechaHora, 
            odontologo_id || tratamiento[0].odontologo_id
        ]);

        if (citasExistentes[0].count > 0) {
            return res.status(400).json({ 
                message: 'Ya existe una cita programada para este odontólogo en la misma fecha y hora.' 
            });
        }

        // Si se especificó un odontólogo diferente, verificar que existe y es odontólogo
        let nombreOdontologo = tratamiento[0].odontologo_nombre || '';
        
        if (odontologo_id && odontologo_id !== tratamiento[0].odontologo_id) {
            const [empleado] = await db.promise().query(
                'SELECT nombre FROM empleados WHERE id = ? AND puesto = "Odontólogo"',
                [odontologo_id]
            );
            
            if (empleado.length === 0) {
                return res.status(400).json({ message: 'El empleado seleccionado no existe o no es odontólogo.' });
            }
            
            nombreOdontologo = empleado[0].nombre;
        }

        // Insertar la nueva cita
        const insertQuery = `
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
                numero_cita_tratamiento
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            tratamiento[0].paciente_id,
            tratamiento[0].nombre,
            tratamiento[0].aPaterno,
            tratamiento[0].aMaterno,
            tratamiento[0].genero,
            tratamiento[0].fecha_nacimiento,
            tratamiento[0].email || '',
            tratamiento[0].telefono || '',
            odontologo_id || tratamiento[0].odontologo_id,
            nombreOdontologo,
            tratamiento[0].servicio_id,
            tratamiento[0].title,
            tratamiento[0].category,
            tratamiento[0].price || 0.00,
            formattedFechaHora,
            formattedFechaSolicitud,
            'Pendiente',
            notas ? xss(notas) : null,
            parseInt(id),
            numeroCita
        ];

        const [result] = await db.promise().query(insertQuery, values);

        res.status(201).json({ 
            message: 'Cita agregada correctamente al tratamiento.',
            cita_id: result.insertId,
            numero_cita: numeroCita
        });

    } catch (error) {
        logger.error('Error al agregar cita al tratamiento:', error);
        res.status(500).json({ message: 'Error interno del servidor al agregar la cita.' });
    }
});

// Endpoint para confirmar un tratamiento y actualizar su primera cita

router.put('/confirmar/:id', async (req, res) => {
    const { id } = req.params; // ID del tratamiento
    const { observaciones } = req.body; 

    // Validaciones básicas
    if (!id || isNaN(id)) {
        return res.status(400).json({ message: 'ID de tratamiento inválido.' });
    }

    try {
        // 1. Obtener información del tratamiento
        const getTratamientoQuery = `
            SELECT t.*, s.title as servicio_nombre, s.price, s.category 
            FROM tratamientos t
            JOIN servicios s ON t.servicio_id = s.id
            WHERE t.id = ? AND t.estado = 'Pendiente'
        `;

        db.query(getTratamientoQuery, [id], (err, tratamientoResult) => {
            if (err) {
                logger.error('Error al obtener información del tratamiento:', err);
                return res.status(500).json({ message: 'Error al procesar la solicitud.' });
            }

            if (!tratamientoResult || tratamientoResult.length === 0) {
                return res.status(404).json({ message: 'Tratamiento no encontrado o ya no está pendiente.' });
            }

            const tratamiento = tratamientoResult[0];

            // 2. Buscar si ya existe una cita vinculada a este tratamiento
            const getCitaQuery = `
                SELECT * FROM citas 
                WHERE tratamiento_id = ? AND numero_cita_tratamiento = 1
                ORDER BY id DESC LIMIT 1
            `;

            db.query(getCitaQuery, [id], (err, citaResult) => {
                if (err) {
                    logger.error('Error al obtener información de la cita:', err);
                    return res.status(500).json({ message: 'Error al procesar la solicitud.' });
                }

                // Si no hay cita vinculada, es un error 
                if (!citaResult || citaResult.length === 0) {
                    return res.status(404).json({ 
                        message: 'No se encontró la cita inicial relacionada con este tratamiento.' 
                    });
                }

                const cita = citaResult[0];

                // 3. Verificar que el horario siga disponible (excepto para esta misma cita)
                const checkDisponibilidadQuery = `
                    SELECT COUNT(*) as count FROM citas 
                    WHERE fecha_consulta = ? AND odontologo_id = ? 
                    AND id != ? AND estado IN ('Confirmada', 'Pendiente')
                `;

                db.query(checkDisponibilidadQuery, [cita.fecha_consulta, cita.odontologo_id, cita.id], (err, disponibilidadResult) => {
                    if (err) {
                        logger.error('Error al verificar disponibilidad:', err);
                        return res.status(500).json({ message: 'Error al verificar disponibilidad.' });
                    }

                    // Si el horario ya no está disponible (otra cita lo está usando)
                    if (disponibilidadResult[0].count > 0) {
                        return res.status(409).json({ 
                            message: 'El horario ya no está disponible. Por favor, asigne un nuevo horario para esta cita.',
                            conflicto_horario: true
                        });
                    }

                    // 4. Actualizar estado del tratamiento a "Confirmado"
                    const updateTratamientoQuery = `
                        UPDATE tratamientos 
                        SET estado = 'Activo', 
                            notas = CONCAT(IFNULL(notas, ''), '\n', ?),
                            actualizado_en = NOW()
                        WHERE id = ?
                    `;

                    const notaConfirmacion = `[${moment().format('YYYY-MM-DD HH:mm')}] Tratamiento confirmado y activado. ${observaciones || ''}`;
                    
                    db.query(updateTratamientoQuery, [notaConfirmacion, id], (err) => {
                        if (err) {
                            logger.error('Error al actualizar el tratamiento:', err);
                            return res.status(500).json({ message: 'Error al confirmar el tratamiento.' });
                        }

                        // 5. Actualizar el estado de la cita a "Confirmada"
                        const updateCitaQuery = `
                            UPDATE citas 
                            SET estado = 'Confirmada', 
                                notas = CONCAT(IFNULL(notas, ''), '\n', ?)
                            WHERE id = ?
                        `;

                        const notaCita = `[${moment().format('YYYY-MM-DD HH:mm')}] Cita confirmada como parte del tratamiento #${id}. ${observaciones || ''}`;
                        
                        db.query(updateCitaQuery, [notaCita, cita.id], (err) => {
                            if (err) {
                                logger.error('Error al actualizar la cita:', err);
                                return res.status(200).json({ 
                                    message: 'Tratamiento confirmado, pero hubo un error al actualizar la cita.',
                                    tratamiento_id: id,
                                    tratamiento_confirmado: true,
                                    error_cita: true
                                });
                            }

                            res.status(200).json({
                                message: 'Tratamiento y primera cita confirmados correctamente.',
                                tratamiento_id: id,
                                cita_id: cita.id,
                                fecha_cita: cita.fecha_consulta
                            });
                        });
                    });
                });
            });
        });
    } catch (error) {
        logger.error('Error en la confirmación de tratamiento:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

module.exports = router;